"""Run one private qualification across fixed, distinct, outward-polling executors."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import ssl
import struct
import time
import urllib.request

if __package__:
    from . import decision_reverse as wire
else:
    # `-I` deliberately omits the script directory from sys.path.
    # Load this sibling explicitly, never a similarly named module from cwd.
    import importlib.util
    spec = importlib.util.spec_from_file_location('mycellios_decision_wire',
        Path(__file__).with_name('decision_reverse.py'))
    wire = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wire)


def qualify(config, input_frame, *, post=None, observer=None):
    wire.validate_config(config, executor_mode=False)
    header, tensors = wire.read_frame(input_frame)
    original_ids = set(tensors)
    symbols = header['symbols']
    if symbols.get('s20') != 1 or type(symbols.get('s53')) is not int:
        raise ValueError('qualification_batch_one_required')
    input_tokens = header.get('inputTokens', symbols['s53'])
    if type(input_tokens) is not int or not 1 <= input_tokens <= symbols['s53']:
        raise ValueError('qualification_token_count_boundary')
    nodes = list(config['nodes'].items())
    if len(nodes) != 3:
        raise ValueError('qualification_requires_three_distinct_nodes')
    context = ssl.create_default_context(cafile=config['certificate'])
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    url = f"https://{config['address']}:{config['port']}"

    def preflight():
        deadline = min(time.time() + 30, config['expiresAtMs']/1000)
        while time.time() < deadline:
            request = urllib.request.Request(url + '/status',
                headers={'Authorization': 'Bearer ' + config['operatorSecret']})
            with urllib.request.urlopen(request, context=context, timeout=10) as response:
                status = wire._json(response.read(16385))
            rows = status.get('nodes', {})
            if set(rows) == set(config['nodes']) and all(
                type(row.get('pollAgeSeconds')) in (int, float)
                and 0 <= row['pollAgeSeconds'] < 15 and row.get('busy') is False
                for row in rows.values()):
                return
            time.sleep(1)
        raise ValueError('qualification_executors_not_currently_available')

    def transport(node, body):
        request = urllib.request.Request(url + '/invoke/' + node,
            data=json.dumps(body, allow_nan=False, separators=(',', ':')).encode(),
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config['operatorSecret']})
        with urllib.request.urlopen(request, context=context, timeout=config.get('stageDeadlineMs', 180000)/1000 + 10) as response:
            result = response.read(wire.MAX_BODY + 1)
        if len(result) > wire.MAX_BODY:
            raise ValueError('qualification_result_boundary')
        return wire._json(result)

    if post is None:
        preflight()
    post = post or transport
    stages = []
    started = time.monotonic()
    for node, own in nodes:
        required = own['inputIds']
        if any(tid not in tensors for tid in required):
            raise ValueError('qualification_missing_dependency')
        frame = wire.make_frame(symbols, {tid: tensors[tid] for tid in required})
        deadline = min(time.time()*1000 + config.get('stageDeadlineMs', 180000) - 1000, config['expiresAtMs'])
        at = time.monotonic()
        result = post(node, {'frame': wire.pack(frame), 'deadlineMs': deadline})
        if result.get('exitCode') != 0 or result.get('qualificationOnly') is not True:
            raise ValueError('qualification_native_stage_failed')
        if result.get('nodeId') != node or result.get('shardSha256') != own['shardSha256']:
            raise ValueError('qualification_wrong_executor_or_artifact')
        output_header, output = wire.read_frame(wire.unpack(result['frame']))
        if set(output) != set(own['outputIds']) or set(output) & original_ids:
            raise ValueError('qualification_stage_output_mismatch')
        tensors.update(output)
        stages.append({'node': node, 'physicalIdentity': own['physicalIdentity'],
            'shardSha256': own['shardSha256'], 'inputIds': required, 'outputIds': list(output),
            'nativeNodeId': own.get('nativeNodeId'), 'ownerGuardSourceSha256': own.get('ownerSourceSha256'),
            'wallMs': (time.monotonic()-at)*1000, 'computeMs': output_header.get('computeMs'),
            'device': output_header.get('device'), 'loadMode': result.get('nativeMetrics', {}).get('loadMode', 'unrecorded')})
        if observer:
            observer(dict(stages[-1]))
    raw = tensors.get(3602)
    if raw is None or len(raw) != 16*4:
        raise ValueError('qualification_logits_shape')
    logits = list(struct.unpack('<16f', raw))
    if not all(math.isfinite(x) for x in logits):
        raise ValueError('qualification_nonfinite_logits')
    return {'qualificationOnly': True, 'model': 'mys/kev-4b-GGUF',
            'modelRevision': '9e37a4eb7def2f73a1bd1301218b063a48ad12c9',
            'sequenceTokens': symbols['s53'], 'stages': stages, 'logits': logits,
            'inputTokens': input_tokens, 'tokenizerSha256': header.get('tokenizerSha256'),
            'requestDigest': header.get('requestDigest'),
            'wallMs': (time.monotonic()-started)*1000, 'completeDecisionGraph': True,
            'publicMycelliosAdmissionValidated': False, 'antseedBuyerValidated': False}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--config', required=True)
    p.add_argument('--input', required=True)
    p.add_argument('--receipt', required=True)
    args = p.parse_args()
    config = wire._json(Path(args.config).read_bytes())
    result = qualify(config, Path(args.input).read_bytes(), observer=lambda stage:
        print(json.dumps({'event': 'qualified_stage_complete', **stage}), flush=True))
    Path(args.receipt).write_text(json.dumps(result, indent=2, allow_nan=False))
    print(json.dumps({'completeDecisionGraph': True, 'wallMs': result['wallMs'],
                      'stages': len(result['stages']), 'qualificationOnly': True}))


if __name__ == '__main__':
    main()
