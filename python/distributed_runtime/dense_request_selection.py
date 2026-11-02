"""Select measured complete decoder requests within current physical budgets."""
import math
import statistics


def select_dense_request_route(candidates, devices, *, context, layer_count,
                               generated_tokens, reference_output_sha256, now,
                               max_age=3600, minimum_samples=3):
    if (not isinstance(context,str) or not context or type(layer_count) is not int or layer_count < 1 or
            type(generated_tokens) is not int or generated_tokens < 1 or
            type(minimum_samples) is not int or minimum_samples < 3 or
            not isinstance(reference_output_sha256,str) or len(reference_output_sha256) != 64 or
            any(c not in '0123456789abcdef' for c in reference_output_sha256) or
            not math.isfinite(now) or not math.isfinite(max_age) or max_age < 0):
        raise ValueError('Exact workload, output reference and freshness required')
    live = {device['id']: device for device in devices}
    if len(live) != len(devices):
        raise ValueError('Distinct physical devices required')
    qualified, rejected, seen = [], [], set()
    for candidate in candidates:
        identity = candidate['id']
        if identity in seen:
            raise ValueError('Distinct candidate identities required')
        seen.add(identity)
        stages = candidate.get('stages', [])
        execution_key = candidate.get('executionKey')
        reason = None
        cursor, used = 0, set()
        if (not stages or not isinstance(execution_key,str) or len(execution_key)!=64 or
                any(c not in '0123456789abcdef' for c in execution_key) or candidate.get('context') != context):
            reason = 'unqualified workload or execution identity'
        for stage in stages if reason is None else []:
            device = live.get(stage.get('deviceId'), {})
            age = now-device.get('observedAt', float('-inf'))
            host, gpu = stage.get('hostBytes', -1), stage.get('vramBytes', -1)
            if (stage.get('deviceId') in used or device.get('connected') is not True or
                    not math.isfinite(age) or not 0 <= age <= 120 or
                    type(stage.get('layerStart')) is not int or stage['layerStart'] != cursor or
                    type(stage.get('layerEnd')) is not int or not cursor < stage['layerEnd'] <= layer_count or
                    stage.get('backend') != device.get('backend') or
                    type(host) is not int or host <= 0 or type(gpu) is not int or gpu < 0 or
                    type(device.get('hostBudgetBytes')) is not int or device['hostBudgetBytes'] <= 0 or
                    type(device.get('vramBudgetBytes')) is not int or device['vramBudgetBytes'] < 0 or
                    host > device.get('hostBudgetBytes', 0) or
                    gpu > device.get('vramBudgetBytes', 0)):
                reason = 'incomplete, offline or over-budget physical placement'
                break
            used.add(stage['deviceId']);cursor = stage['layerEnd']
        if reason is None and cursor != layer_count:
            reason = 'incomplete layer coverage'
        samples = []
        sample_ids = set()
        latest_failure = float('-inf')
        for row in candidate.get('measurements', []):
            stamp = row.get('measuredAt')
            if (row.get('context') == context and row.get('executionKey') == execution_key and
                    row.get('stages') == stages and row.get('complete') is False and
                    type(stamp) in (int,float) and math.isfinite(stamp) and 0 <= now-stamp <= max_age):
                latest_failure = max(latest_failure, stamp)
        for row in candidate.get('measurements', []) if reason is None else []:
            age = now-row.get('measuredAt', float('-inf'))
            duration = row.get('totalRequestMs')
            sample_id = row.get('sampleId')
            if (row.get('complete') is True and row.get('context') == context and
                    row.get('executionKey') == execution_key and row.get('stages') == stages and
                    type(row.get('generatedTokens')) is int and row['generatedTokens'] == generated_tokens and
                    row.get('outputSha256') == reference_output_sha256 and
                    isinstance(sample_id,str) and bool(sample_id) and sample_id not in sample_ids and
                    row.get('measuredAt',float('-inf')) > latest_failure and
                    math.isfinite(age) and 0 <= age <= max_age and
                    type(duration) in (float, int) and math.isfinite(duration) and duration > 0):
                samples.append(duration);sample_ids.add(sample_id)
        if reason is None and len(samples) < minimum_samples:
            reason = 'insufficient fresh complete-request parity samples'
        if reason:
            rejected.append(dict(candidateId=identity, reason=reason))
        else:
            qualified.append(dict(candidateId=identity, stages=stages,
                executionKey=execution_key, medianRequestMs=statistics.median(samples), sampleCount=len(samples)))
    qualified.sort(key=lambda row:(row['medianRequestMs'], row['candidateId']))
    return dict(feasible=bool(qualified),selected=qualified[0] if qualified else None,
                qualified=qualified,rejected=rejected)
