"""Copy contiguous safetensors using a bounded, reusable source buffer."""
from __future__ import annotations
import json,math,struct
from pathlib import Path
import torch

SOURCE_BUFFER_BYTES = 16 * 1024 * 1024
_DTYPES = {'BF16':torch.bfloat16,'F16':torch.float16,'F32':torch.float32,'F64':torch.float64,'I64':torch.int64,'I32':torch.int32,'I16':torch.int16,'I8':torch.int8,'U8':torch.uint8,'BOOL':torch.bool}

def copy_checkpoint_tensor(file: Path, name: str, target: torch.Tensor, tensors) -> tuple[int,int]:
    """Return source payload bytes and maximum explicit source buffer bytes.

    Authentication and exact checkpoint coverage remain the caller's gates.
    Noncontiguous adapter assignments retain the existing mmap copy path.
    File cache activity is not an anonymous allocation or measured disk traffic.
    """
    shape = tuple(tensors.get_slice(name).get_shape())
    if shape != tuple(target.shape):
        raise ValueError(f'shape mismatch for {name}: checkpoint {shape}, stage {tuple(target.shape)}')
    if target.device.type not in ('cpu', 'cuda') or not target.is_contiguous():
        value = tensors.get_tensor(name)
        target.copy_(value)
        size = value.numel() * value.element_size()
        return size, size
    with file.open('rb', buffering=0) as source:
        prefix = source.read(8)
        if len(prefix) != 8:
            raise ValueError('truncated safetensors length')
        header_size = struct.unpack('<Q',prefix)[0]
        if not 0 < header_size <= 16 * 1024 * 1024:
            raise ValueError('unbounded safetensors header')
        header = json.loads(source.read(header_size))
        row = header[name]
        dtype = _DTYPES.get(row['dtype'])
        if dtype is None or tuple(row['shape']) != shape:
            raise ValueError('unsupported checkpoint dtype or inconsistent shape')
        width = torch.empty((),dtype=dtype).element_size()
        start,end = row['data_offsets']
        size = math.prod(shape) * width
        if type(start) is not int or type(end) is not int or start < 0 or end-start != size or 8+header_size+end > file.stat().st_size:
            raise ValueError('invalid checkpoint payload extent')
        source.seek(8+header_size+start)
        buffer = bytearray(min(SOURCE_BUFFER_BYTES,size))
        destination = target.reshape(-1)
        copied = 0
        while copied < size:
            count = min(len(buffer),size-copied)
            view = memoryview(buffer)[:count]
            filled = 0
            while filled < count:
                read = source.readinto(view[filled:])
                if not read:
                    raise ValueError('truncated checkpoint payload')
                filled += read
            value = torch.frombuffer(buffer,dtype=dtype,count=count//width)
            begin = copied//width
            # Blocking copies complete before the reusable CPU buffer is filled
            # again. CUDA destinations need no full source tensor materialization.
            destination[begin:begin+value.numel()].copy_(value, non_blocking=False)
            copied += count
        return size,len(buffer)
