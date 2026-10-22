"""Bounded GGUF graph partitioning. This module never loads or executes a model."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path


MAX_HEADER = 32 * 1024 * 1024
SCALARS = {0: 'B', 1: 'b', 2: 'H', 3: 'h', 4: 'I', 5: 'i',
           6: 'f', 7: '?', 10: 'Q', 11: 'q', 12: 'd'}
BLOCKS = {0: (1, 4), 1: (1, 2), 8: (32, 34)}


class HeaderReader:
    def __init__(self, source):
        self.source = source

    def read(self, size):
        if size < 0 or self.source.tell() + size > MAX_HEADER:
            raise ValueError('decision_header_too_large')
        data = self.source.read(size)
        if len(data) != size:
            raise ValueError('decision_header_incomplete')
        return data

    def number(self, fmt):
        return struct.unpack('<' + fmt, self.read(struct.calcsize('<' + fmt)))[0]

    def string(self):
        return self.read(self.number('Q')).decode('utf-8')

    def value(self, kind, depth=0):
        if depth > 2:
            raise ValueError('decision_metadata_nesting')
        if kind == 8:
            return self.string()
        if kind == 9:
            elem, count = self.number('I'), self.number('Q')
            if count > 1000000:
                raise ValueError('decision_metadata_array_too_large')
            return [self.value(elem, depth + 1) for _ in range(count)]
        if kind not in SCALARS:
            raise ValueError('decision_unknown_metadata_type')
        return self.number(SCALARS[kind])


@dataclass(frozen=True)
class TensorInfo:
    name: str
    dims: tuple[int, ...]
    kind: int
    offset: int

    @property
    def size(self):
        if self.kind not in BLOCKS:
            raise ValueError('decision_unsupported_quantization')
        block, size = BLOCKS[self.kind]
        if not self.dims or self.dims[0] % block:
            raise ValueError('decision_invalid_quantized_row')
        return math.prod(self.dims) // block * size


@dataclass
class GraphHeader:
    metadata: list[tuple[str, bytes]]
    values: dict
    tensors: dict[str, TensorInfo]
    graph: dict
    data_offset: int


def read_header(path):
    with Path(path).open('rb') as f:
        r = HeaderReader(f)
        if r.read(4) != b'GGUF' or r.number('I') != 3:
            raise ValueError('decision_requires_gguf_v3')
        count, kv_count = r.number('Q'), r.number('Q')
        if count > 100000 or kv_count > 10000:
            raise ValueError('decision_header_count_exceeded')
        metadata, values = [], {}
        for _ in range(kv_count):
            start = f.tell()
            key, kind = r.string(), r.number('I')
            if key in values:
                raise ValueError('decision_duplicate_metadata')
            values[key] = r.value(kind)
            end = f.tell()
            f.seek(start)
            metadata.append((key, r.read(end - start)))
        infos = {}
        for _ in range(count):
            name, rank = r.string(), r.number('I')
            if name in infos or rank < 1 or rank > 4:
                raise ValueError('decision_invalid_tensor_directory')
            dims = tuple(r.number('Q') for _ in range(rank))
            kind, offset = r.number('I'), r.number('Q')
            if any(d < 1 or d > 2**32 for d in dims):
                raise ValueError('decision_invalid_tensor_shape')
            infos[name] = TensorInfo(name, dims, kind, offset)
        alignment = values.get('general.alignment', 32)
        if alignment < 1 or alignment > 4096 or alignment & (alignment - 1):
            raise ValueError('decision_invalid_alignment')
        offset = (f.tell() + alignment - 1) // alignment * alignment
        graph = json.loads(values['ggmlc.graph_spec'])
        validate_graph(graph)
        if any(t['storage'] in (1, 2) and t['name'] not in infos
               for t in graph['tensors'].values()):
            raise ValueError('decision_static_tensor_missing')
        return GraphHeader(metadata, values, infos, graph, offset)


def validate_graph(graph):
    tensors = graph['tensors']
    if any(str(t['id']) != str(k) for k, t in tensors.items()):
        raise ValueError('decision_tensor_identity_mismatch')
    if any(t['storage'] == 4 for t in tensors.values()):
        raise ValueError('decision_stateful_graph_requires_explicit_protocol')
    available = set(graph['inputs']) | {
        t['id'] for t in tensors.values() if t['storage'] in (1, 2)
    }
    nodes = set()
    for node in graph['nodes']:
        if node['id'] in nodes or any(i not in available for i in node['inputs']):
            raise ValueError('decision_graph_not_topological')
        nodes.add(node['id'])
        for tid in node['outputs']:
            if tid in available or str(tid) not in tensors:
                raise ValueError('decision_graph_duplicate_output')
            available.add(tid)
    if any(t not in available for t in graph['outputs']):
        raise ValueError('decision_graph_missing_output')


def partition_graph(graph, cuts):
    """Preserve every live dependency across contiguous topological partitions."""
    validate_graph(graph)
    n = len(graph['nodes'])
    points = [0, *cuts, n]
    if points != sorted(set(points)) or points[0] != 0 or points[-1] != n:
        raise ValueError('decision_invalid_partition_cuts')
    result = []
    for lo, hi in zip(points, points[1:]):
        nodes = graph['nodes'][lo:hi]
        made = {t for node in nodes for t in node['outputs']}
        used = {t for node in nodes for t in node['inputs']}
        future = {t for node in graph['nodes'][hi:] for t in node['inputs']}
        future.update(graph['outputs'])
        outgoing = made & future
        incoming = used - made
        keep = made | used
        part = {k: copy.deepcopy(v) for k, v in graph.items()
                if k not in ('nodes', 'tensors', 'inputs', 'outputs', 'parameters')}
        part['name'] = graph['name'] + '_stage_' + str(len(result))
        part['nodes'] = copy.deepcopy(nodes)
        part['tensors'] = {str(t): copy.deepcopy(graph['tensors'][str(t)]) for t in sorted(keep)}
        part['inputs'] = sorted(t for t in incoming if part['tensors'][str(t)]['storage'] not in (1, 2))
        part['parameters'] = sorted(t for t in keep if part['tensors'][str(t)]['storage'] in (1, 2))
        part['outputs'] = sorted(outgoing)
        for t in part['inputs']:
            part['tensors'][str(t)]['storage'] = 0
            part['tensors'][str(t)]['producer_id'] = None
        for t in part['outputs']:
            part['tensors'][str(t)]['storage'] = 5
        validate_graph(part)
        result.append(part)
    return result


def _string(value):
    encoded = value.encode('utf-8')
    return struct.pack('<Q', len(encoded)) + encoded


def write_shard(source, header, graph, target):
    """Copy only referenced immutable weight bytes; never dequantize them."""
    names = {t['name'] for t in graph['tensors'].values()}
    infos = [t for name, t in header.tensors.items() if name in names]
    alignment = header.values.get('general.alignment', 32)
    if Path(target).exists():
        raise FileExistsError(target)
    for info in infos:
        if header.data_offset + info.offset + info.size > Path(source).stat().st_size:
            raise ValueError('decision_source_tensor_incomplete')
    meta = [raw for key, raw in header.metadata if key != 'ggmlc.graph_spec']
    spec = json.dumps(graph, separators=(',', ':'))
    meta.append(_string('ggmlc.graph_spec') + struct.pack('<I', 8) + _string(spec))
    directory, offset = bytearray(), 0
    for info in infos:
        directory.extend(_string(info.name) + struct.pack('<I', len(info.dims)))
        directory.extend(struct.pack('<' + 'Q' * len(info.dims), *info.dims))
        directory.extend(struct.pack('<IQ', info.kind, offset))
        offset = (offset + info.size + alignment - 1) // alignment * alignment
    with Path(source).open('rb') as src, Path(target).open('xb') as out:
        out.write(b'GGUF' + struct.pack('<IQQ', 3, len(infos), len(meta)))
        for raw in meta:
            out.write(raw)
        out.write(directory)
        out.write(b'\0' * (-out.tell() % alignment))
        data_start = out.tell()
        for info in infos:
            src.seek(header.data_offset + info.offset)
            remaining = info.size
            while remaining:
                buf = src.read(min(remaining, 1024 * 1024))
                if not buf:
                    raise ValueError('decision_source_changed_during_copy')
                out.write(buf)
                remaining -= len(buf)
            out.write(b'\0' * (-(out.tell() - data_start) % alignment))
    digest = hashlib.sha256()
    with Path(target).open('rb') as f:
        for buf in iter(lambda: f.read(1024 * 1024), b''):
            digest.update(buf)
    return {'sha256': digest.hexdigest(), 'bytes': Path(target).stat().st_size,
            'inputs': graph['inputs'], 'outputs': graph['outputs'], 'weightTensors': len(infos)}
