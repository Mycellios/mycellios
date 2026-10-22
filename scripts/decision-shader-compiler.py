"""MinGW compiler launcher: embed large generated SPIR-V arrays without huge C++ ASTs.

This changes only immutable shader byte storage, never shader instructions. It
keeps compilation within the existing isolated CI memory limit. No model runs.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import sys


ARRAY = re.compile(r'^const unsigned char ([A-Za-z0-9_]+)_data\[(\d+)\] = \{\s*$')
LENGTH = re.compile(r'^const uint64_t ([A-Za-z0-9_]+)_len = (\d+);\s*$')
HEX = re.compile(r'0x([0-9a-fA-F]+)')
MAX_SHADER_BYTES = 16 * 1024 * 1024


def convert(source):
    source = Path(source).resolve()
    output = source.with_name(source.name + '.incbin.cpp')
    folder = source.with_name(source.name + '.blobs')
    folder.mkdir(exist_ok=True)
    lengths, manifest = {}, []
    with source.open(encoding='utf-8') as src, output.open('w', encoding='utf-8', newline='\n') as out:
        lines = iter(src)
        for line in lines:
            length = LENGTH.match(line)
            if length:
                lengths[length[1]] = int(length[2])
            array = ARRAY.match(line)
            if not array:
                out.write(line)
                continue
            name, expected = array[1], int(array[2])
            if lengths.get(name) != expected or not 0 < expected <= MAX_SHADER_BYTES:
                raise ValueError('shader_declaration_geometry_mismatch')
            data = bytearray()
            closed = False
            for values in lines:
                if '};' in values:
                    values, trailing = values.split('};', 1)
                    if trailing.strip():
                        raise ValueError('shader_array_unexpected_trailer')
                    closed = True
                if re.sub(r'0x[0-9a-fA-F]+|[\s,]', '', values):
                    raise ValueError('shader_array_nonliteral_data')
                data.extend(int(v,16) for v in HEX.findall(values))
                if len(data) > expected:
                    raise ValueError('shader_array_size_exceeded')
                if closed:
                    break
            if not closed or len(data) != expected:
                raise ValueError('shader_array_incomplete')
            blob = folder / (name + '.spv')
            blob.write_bytes(data)
            assembly = ('.section .rdata,"dr"\n.balign 16\n.globl ' + name + '_data\n'
                        + name + '_data:\n.incbin "' + blob.as_posix() + '"\n.text\n')
            out.write('__asm__(' + json.dumps(assembly) + ');\n')
            manifest.append({'symbol':name+'_data','bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    if not manifest:
        raise ValueError('shader_source_not_recognized')
    output.with_suffix('.json').write_text(json.dumps({'source':str(source),'blobs':manifest},indent=2))
    return output


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit('compiler_required')
    if 'mingw32' in args[0] and '-c' in args:
        index = args.index('-c') + 1
        source = Path(args[index])
        if source.name.endswith('.comp.cpp') and source.stat().st_size > 8*1024*1024:
            args[index] = str(convert(source))
    os.execvp(args[0], args)


if __name__ == '__main__':
    main()
