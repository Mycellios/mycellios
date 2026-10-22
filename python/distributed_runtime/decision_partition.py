"""Offline, hash-pinned decision graph partitioner. No tensor execution."""

import argparse
import hashlib
import json
from pathlib import Path

from .decision_graph import read_header, partition_graph, write_shard


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--sha256', required=True)
    p.add_argument('--after-layers', default='7,19')
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    if len(args.sha256) != 64 or any(c not in '0123456789abcdef' for c in args.sha256):
        raise ValueError('decision_source_digest_invalid')
    digest = hashlib.sha256()
    with args.source.open('rb') as src:
        for buf in iter(lambda: src.read(1024 * 1024), b''):
            digest.update(buf)
    if digest.hexdigest() != args.sha256:
        raise ValueError('decision_source_digest_mismatch')
    header = read_header(args.source)
    last = {}
    for i, node in enumerate(header.graph['nodes']):
        for tid in node['inputs']:
            name = header.graph['tensors'][str(tid)]['name']
            if name.startswith('layers.'):
                last[int(name.split('.')[1])] = i
    cuts = []
    for layer in map(int, args.after_layers.split(',')):
        # This pinned export ends each block with down-projection then residual add.
        i = last[layer]
        residual = header.graph['nodes'][i + 1]
        projection = header.graph['nodes'][i]
        if residual['opcode'] != 2 or not set(projection['outputs']).issubset(residual['inputs']):
            raise ValueError('decision_block_boundary_unrecognized')
        cuts.append(i + 2)
    graphs = partition_graph(header.graph, cuts)
    args.output.mkdir(parents=True, exist_ok=False)
    stages = []
    for i, graph in enumerate(graphs):
        name = f'stage-{i}.gguf'
        receipt = write_shard(args.source, header, graph, args.output / name)
        stages.append({'index': i, 'file': name, **receipt})
        print(json.dumps(stages[-1]), flush=True)
    manifest = {'schema': 'mycellios-decision-shards/1', 'sourceSha256': args.sha256,
                'graphCuts': cuts, 'stages': stages,
                'recipe': json.loads(header.values['ggmlc.decision']),
                'qualification': 'unexecuted'}
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
