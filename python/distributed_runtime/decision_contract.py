"""Typed decision semantics only; no model execution or serving admission."""
from __future__ import annotations

import hashlib
import json
import math
import re

MODEL = 'jev'
REVISION = '9e37a4eb7def2f73a1bd1301218b063a48ad12c9'
DIGEST = 'sha256:51c9353a5ff0b8e2f7cd7262359c0b26ea54b327214fe26a5da52b505b2978e8'
TOKENIZER_SHA256 = '06b9509352d2af50381ab2247e083b80d32d5c0aba91c272ca9ff729b6a0e523'
CORE_SHA256 = '6fbea65343c24216c5208230c8447187d1a7f25c6271efdda20ded5e19b0b429'
CONTEXT_LIMIT = 256
LABEL = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z', re.ASCII)


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def _text(value, maximum, *, nonempty=False):
    if not isinstance(value, str) or len(value.encode('utf-16-le'))//2 > maximum or nonempty and not value:
        raise ValueError('decision_text_boundary')
    # Encoding also rejects lone surrogate code points.
    value.encode('utf-8')
    return value


def parse_input(value):
    if not isinstance(value, dict) or set(value) != {'schema', 'state', 'questions'} \
            or value['schema'] != 'mycellios-decisions/1':
        raise ValueError('decision_input_schema')
    state = _text(value['state'], 16384, nonempty=True)
    questions = value['questions']
    if not isinstance(questions, dict) or len(questions) != 1:
        raise ValueError('decision_one_question_required')
    name, question = next(iter(questions.items()))
    if not isinstance(name, str) or not LABEL.fullmatch(name) or not isinstance(question, dict):
        raise ValueError('decision_question_identity')
    kind = question.get('type')
    if kind not in ('choice', 'score', 'noul'):
        raise ValueError('decision_question_type')
    required = {'type', 'instructions'} | ({'criteria'} if kind != 'noul' else set())
    allowed = {'type', 'instructions', 'criteria'}
    if not required <= set(question) <= allowed:
        raise ValueError('decision_question_fields')
    definition = {'type': kind, 'instructions': _text(question['instructions'], 4096)}
    if kind == 'choice':
        criteria = question['criteria']
        if not isinstance(criteria, dict) or not 2 <= len(criteria) <= 16 \
                or any(not isinstance(key, str) or not LABEL.fullmatch(key) for key in criteria):
            raise ValueError('decision_choice_options')
        definition['criteria'] = {key: _text(criteria[key], 4096) for key in sorted(criteria)}
    elif kind == 'score':
        criteria = question['criteria']
        if not isinstance(criteria, list) or not 2 <= len(criteria) <= 16:
            raise ValueError('decision_score_levels')
        definition['criteria'] = [_text(text, 4096) for text in criteria]
    elif 'criteria' in question:
        criteria = question['criteria']
        if not isinstance(criteria, dict) or set(criteria) != {'false', 'true'}:
            raise ValueError('decision_noul_criteria')
        definition['criteria'] = {key: _text(criteria[key], 4096) for key in ('false', 'true')}
    result = {'schema': value['schema'], 'state': state, 'questions': {name: definition}}
    if len(_json(result).encode('utf-8')) > 32768:
        raise ValueError('decision_input_boundary')
    return result


def request_digest(value):
    value = parse_input(value)
    name, question = next(iter(value['questions'].items()))
    definition = {'id': name, 'type': question['type'], 'instructions': question['instructions']}
    if 'criteria' in question:
        definition['criteria'] = list(map(list, question['criteria'].items())) \
            if question['type'] == 'choice' else question['criteria']
    body = {'schema': value['schema'], 'state': value['state'], 'question': definition}
    return 'sha256:' + hashlib.sha256(_json(body).encode('utf-8')).hexdigest()


def options(value):
    question = next(iter(value['questions'].values()))
    if question['type'] == 'choice':
        return sorted(question['criteria'])
    if question['type'] == 'score':
        return [str(i) for i in range(len(question['criteria']))]
    return ['false', 'true']


def decode(value, logits, input_tokens):
    value = parse_input(value)
    if type(input_tokens) is not int or not 1 <= input_tokens <= CONTEXT_LIMIT:
        raise ValueError('decision_context_not_qualified')
    if not isinstance(logits, list) or len(logits) != 16 \
            or any(type(x) not in (int, float) or not math.isfinite(x) for x in logits):
        raise ValueError('decision_invalid_logits')
    name, question = next(iter(value['questions'].items()))
    labels = options(value)
    active = logits[:len(labels)]
    peak = max(active)
    # Temperature is already baked into the pinned graph. Applying it again
    # changes probabilities and breaks compatibility with the model recipe.
    weights = [math.exp(x-peak) for x in active]
    total = math.fsum(weights)
    probabilities = [x/total for x in weights]
    kind = question['type']
    answer = labels[max(range(len(labels)), key=probabilities.__getitem__)] if kind == 'choice' \
        else probabilities[1] if kind == 'noul' \
        else math.fsum(i*p for i, p in enumerate(probabilities))
    return {'schema': value['schema'], 'model': MODEL, 'underlying_model': 'mys/kev-4b-GGUF',
        'revision': REVISION, 'artifact_identity': DIGEST, 'request_digest': request_digest(value),
        'tokenizer_sha256': TOKENIZER_SHA256,
        'result': {'question_id': name, 'type': kind, 'value': answer,
                   'probabilities': [{'option': label, 'probability': p} for label, p in zip(labels, probabilities)]},
        'usage': {'prompt_tokens': input_tokens, 'completion_tokens': 0, 'total_tokens': input_tokens}}
