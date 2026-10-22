"""Produce a local activation gate from a real canary and pinned reference.

This never enrolls a worker or claims public/AntSeed delivery. An operator runs
it after inspecting a qualification receipt; every model result is compared to
the independent full-model reference, not a synthetic health response.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct

if __package__:
    from . import decision_gateway as gateway
else:
    spec = importlib.util.spec_from_file_location('decision_gateway', Path(__file__).with_name('decision_gateway.py'))
    gateway = importlib.util.module_from_spec(spec); spec.loader.exec_module(gateway)


def activation(config, canary, reference_frame, reference_input, reference_receipt):
    if hashlib.sha256(reference_input).hexdigest() != '5ee44c08da34ea196d4ee198d403b77eae1816dc5aa840ea4daf52ad469140ef' \
            or hashlib.sha256(reference_frame).hexdigest() != '6601beb18415537f8f53c47c54f8e63770160493cf7aeb0b14ad14adee9b1dea':
        raise ValueError('decision_activation_pinned_reference_artifact')
    source_id = gateway.verify_sources(config)
    _, tensors = gateway.wire.read_frame(reference_frame)
    input_header, _ = gateway.wire.read_frame(reference_input)
    expected = list(struct.unpack('<16f', tensors[3602]))
    actual = canary.get('logits')
    if reference_receipt.get('scope') != 'isolated_server_numerical_reference_only' \
            or reference_receipt.get('exitCode') != 0 \
            or reference_receipt.get('modelSha256') != gateway.contract.DIGEST.removeprefix('sha256:') \
            or input_header.get('tokenizerSha256') != gateway.contract.TOKENIZER_SHA256 \
            or not isinstance(actual, list) or len(actual) != 16 \
            or not all(type(v) in (int, float) and math.isfinite(v) for v in actual+expected) \
            or max(abs(a-b) for a, b in zip(actual, expected)) > 0.00001:
        raise ValueError('decision_activation_numerical_reference')
    if canary.get('schema') != 'mycellios-native-decision-receipt/1' or canary.get('qualificationOnly') is not True \
            or canary.get('sourceId') != source_id or canary.get('activationId') != config['activationId'] \
            or canary.get('modelDigest') != gateway.contract.DIGEST \
            or canary.get('tokenizerSha256') != gateway.contract.TOKENIZER_SHA256 \
            or canary.get('inputFrameSha256') != hashlib.sha256(reference_input).hexdigest() \
            or canary.get('requestDigest') != input_header.get('requestDigest'):
        raise ValueError('decision_activation_canary_binding')
    stages = canary.get('stages')
    if not isinstance(stages, list) or len(stages) != 3: raise ValueError('decision_activation_three_stages')
    physical = set()
    for i, (row, stage) in enumerate(zip(config['nodes'].values(), stages)):
        if stage.get('stageIndex') != i or stage.get('nodeId') != row['nativeNodeId'] \
                or stage.get('physicalIdentity') != row['physicalIdentity'] \
                or stage.get('shardSha256') != row['shardSha256']:
            raise ValueError('decision_activation_stage_binding')
        physical.add(stage['physicalIdentity'])
    if len(physical) != 3: raise ValueError('decision_activation_duplicate_physical_host')
    return {'schema': 'mycellios-decision-activation/1', 'activationId': config['activationId'],
        'sourceId': source_id, 'modelDigest': gateway.contract.DIGEST,
        'tokenizerSha256': gateway.contract.TOKENIZER_SHA256, 'threeDistinctPhysicalStages': True,
        'canarySha256': hashlib.sha256(json.dumps(canary, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
        'referenceFrameSha256': hashlib.sha256(reference_frame).hexdigest(),
        'inputFrameSha256': canary['inputFrameSha256'], 'maxLogitDifference': max(abs(a-b) for a,b in zip(actual, expected)),
        'passed': True, 'publicAdmissionValidated': False, 'antseedBuyerValidated': False}


def main():
    parser = argparse.ArgumentParser()
    for flag in ('config', 'canary', 'reference', 'reference-input', 'reference-receipt', 'output'):
        parser.add_argument('--'+flag, required=True)
    args = parser.parse_args()
    read = lambda path: gateway.wire._json(Path(path).read_bytes())
    result = activation(read(args.config), read(args.canary), Path(args.reference).read_bytes(),
                        Path(args.reference_input).read_bytes(), read(args.reference_receipt))
    Path(args.output).write_text(json.dumps(result, indent=2))
    print(json.dumps({'activationPrepared': True, 'publicAdmissionValidated': False, 'antseedBuyerValidated': False}))


if __name__ == '__main__': main()
