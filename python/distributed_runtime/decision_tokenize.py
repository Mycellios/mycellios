"""Pinned Hugging Face preprocessing for Kev; no model tensor execution.

The community GGUF mislabels Qwen's 248077-token ByteLevel vocabulary as
Gemma/Metaspace. Its vocabulary and all merges match this exact checkpoint
tokenizer. Use its actual NFC/Unicode Split/ByteLevel pipeline instead of that
heuristic label. Preserve the compiled decision recipe and all model weights.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct

if __package__:
    from . import decision_contract as contract
    from . import decision_reverse as wire
else:
    def sibling(name):
        spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name+'.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    contract, wire = sibling('decision_contract'), sibling('decision_reverse')

TOKENIZER_REVISION = '6cfce5c2fa4b4bd64026336ab649c5ca78857d52'
TOKENIZER_SHA256 = contract.TOKENIZER_SHA256
RECIPE_SHA256 = '5e60cb2e43042278a2dfb82f040912f75716acc5b5b23e7b6b714c396fd5db9e'
SPECIAL = {'<|fim_prefix|>': 248060, '<|fim_middle|>': 248061, '<|box_start|>': 248049,
           '<|box_end|>': 248050, '<|fim_suffix|>': 248062, '<|endoftext|>': 248044}


def sanitize(text):
    return re.sub(r'<\|([A-Za-z0-9_]*)\|>', lambda m: '<¦'+m.group(1)+'¦>', text)


def encode_input(value, encode_text):
    """Interpret this pinned recipe, with an independently supplied text encoder.

    Only HfDecisionEncoder supplies the production tokenizer. The function is
    separate so tensor formatting has dependency-free contract tests.
    """
    value = contract.parse_input(value)
    name, question = next(iter(value['questions'].items()))
    kind = question['type']
    if kind == 'choice':
        options = [label + ': ' + text if text else label for label, text in question['criteria'].items()]
    elif kind == 'score':
        options = question['criteria']
    else:
        criteria = question.get('criteria', {})
        options = [criteria.get('false') or 'no', criteria.get('true') or 'yes']

    def user(text):
        ids = encode_text(sanitize(text))
        if not isinstance(ids, list) or any(type(i) is not int or not 0 <= i < 248077 for i in ids):
            raise ValueError('decision_tokenizer_invalid_ids')
        return ids

    ids = [248060] + user(value['state']) + [248061] + user(question['instructions'])
    markers = []
    for option in options:
        ids += [248049] + user(option)
        markers.append(len(ids))
        ids.append(248050)
    decide = len(ids)
    ids.append(248062)
    tokens = len(ids)
    if tokens > contract.CONTEXT_LIMIT:
        raise ValueError('decision_input_exceeds_qualified_context')
    sequence = max(64, tokens)
    tensors = {
        433: struct.pack('<'+'i'*sequence, *(ids + [248044]*(sequence-tokens))),
        434: struct.pack('<'+'f'*sequence, *([1.0]*tokens + [0.0]*(sequence-tokens))),
        435: struct.pack('<16i', *(markers + [0]*(16-len(markers)))),
        436: struct.pack('<i', decide),
        437: struct.pack('<16f', *([1.0]*len(markers)+[0.0]*(16-len(markers)))),
    }
    raw = wire.make_frame({'s20': 1, 's53': sequence}, tensors)
    header, _ = wire.read_frame(raw)
    header.update(questionId=name, inputTokens=tokens, tokenizerSha256=TOKENIZER_SHA256,
                  requestDigest=contract.request_digest(value))
    encoded = json.dumps(header, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')
    frame = struct.pack('<I', len(encoded)) + encoded + b''.join(tensors.values())
    wire.read_frame(frame)
    return frame


class HfDecisionEncoder:
    def __init__(self, tokenizer_path):
        path = Path(tokenizer_path)
        if path.is_symlink() or path.stat().st_size != 19989325 \
                or hashlib.sha256(path.read_bytes()).hexdigest() != TOKENIZER_SHA256:
            raise ValueError('decision_tokenizer_artifact_mismatch')
        import tokenizers
        if tokenizers.__version__ != '0.22.2':
            raise ValueError('decision_tokenizer_backend_version')
        from tokenizers import Tokenizer
        self.tokenizer = Tokenizer.from_file(str(path))
        if self.tokenizer.get_vocab_size(with_added_tokens=True) != 248077 \
                or any(self.tokenizer.token_to_id(text) != token for text, token in SPECIAL.items()):
            raise ValueError('decision_tokenizer_vocabulary_mismatch')

    def encode(self, value):
        return encode_input(value, lambda text: self.tokenizer.encode(text, add_special_tokens=False).ids)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tokenizer', required=True)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    raw = Path(args.input).read_bytes()
    if len(raw) > 32768:
        raise ValueError('decision_input_boundary')
    value = wire._json(raw)
    result = HfDecisionEncoder(args.tokenizer).encode(value)
    Path(args.output).write_bytes(result)
    header, _ = wire.read_frame(result)
    print(json.dumps({'inputTokens': header['inputTokens'], 'symbols': header['symbols'],
        'frameSha256': hashlib.sha256(result).hexdigest(), 'tokenizerSha256': TOKENIZER_SHA256,
        'modelExecuted': False}))


if __name__ == '__main__':
    main()
