"""Fail-closed binding of a native speech replica to coordinator GPU leases."""
import json
import time
import datetime
import urllib.request
import urllib.parse
from pathlib import Path


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError('gpu_reservation_redirect_rejected')


class GpuReservationGuard:
    def __init__(self, config, fetch=None, clock=None):
        self.config = config
        url = urllib.parse.urlsplit(config['timelineUrl'])
        expected = '/public/v1/requested-models/' + urllib.parse.quote(config['modelId'], safe='') + '/timeline'
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.path != expected:
            raise ValueError('invalid_gpu_reservation_origin')
        if type(config['memoryMiB']) is not int or config['memoryMiB'] < 2048:
            raise ValueError('invalid_gpu_reservation_budget')
        self.fetch = fetch or self._fetch
        self.clock = clock or (lambda: int(time.time()*1000))
        self.cached = None
        self.checked_at = 0

    def _fetch(self):
        req = urllib.request.Request(self.config['timelineUrl'], headers={
            'User-Agent': 'Mycellios-Native-GPU-Reservation/1', 'Cache-Control': 'no-cache'})
        with urllib.request.build_opener(_NoRedirect()).open(req, timeout=3) as response:
            raw = response.read(1048577)
            if len(raw) > 1048576:
                raise ValueError('gpu_reservation_response_too_large')
            return json.loads(raw)

    def owner_check(self, now):
        cfg = self.config
        native = json.loads(Path(cfg['nativeConfigPath']).read_text(encoding='utf-8-sig'))
        state = json.loads(Path(cfg['nativeStatePath']).read_text(encoding='utf-8-sig'))
        if native.get('nodeId') != cfg['nodeId'] or state.get('contributionEnabled') is not True or state.get('draining') is not False:
            raise ValueError('native_owner_paused_or_unavailable')
        policy = native['policy']
        if not isinstance(policy.get('modelAllowlist'), list) or not isinstance(policy.get('schedule'), list):
            raise ValueError('native_owner_policy_invalid')
        if policy['modelAllowlist'] and cfg['modelId'] not in policy['modelAllowlist']:
            raise ValueError('native_owner_model_not_allowed')
        date = datetime.datetime.fromtimestamp(now/1000, tz=datetime.timezone.utc)
        day, minute = (date.weekday()+1) % 7, date.hour*60+date.minute
        if not any(day in w['days'] and w['startMinuteUtc'] <= minute < w['endMinuteUtc'] for w in policy['schedule']):
            raise ValueError('native_owner_schedule_closed')

    def check(self, force=False):
        now = self.clock()
        self.owner_check(now)
        if not force and self.cached and 0 <= now-self.checked_at < 2000 and self.cached['expiresAt'] > now+20000:
            return self.cached
        body = self.fetch()
        rows = body['data']['reservations']
        if not isinstance(rows, list) or len(rows) > 200:
            raise ValueError('invalid_gpu_reservation_timeline')
        valid = []
        cfg = self.config
        for row in rows:
            canary = row.get('canary') or {}
            if row.get('status') != 'committed' or canary.get('consumerId') != cfg['consumerId']:
                continue
            expiry = row.get('expiresAt')
            stages = row.get('stages')
            if (row.get('modelId') != cfg['modelId'] or type(expiry) is not int
                or not now+20000 < expiry <= now+185000 or not isinstance(stages, list) or len(stages) != 1
                or stages[0].get('nodeId') != cfg['nodeId'] or stages[0].get('memoryMiB') != cfg['memoryMiB']
                or canary.get('nodeId') != cfg['nodeId'] or canary.get('passed') is not True
                or canary.get('backend') != 'cuda' or canary.get('precision') != 'float32'
                or canary.get('modelDigest') != cfg['modelDigest']
                or canary.get('gpuCoreSourceSha256') != cfg['gpuCoreSourceSha256']):
                raise ValueError('gpu_reservation_identity_or_expiry_invalid')
            valid.append(row)
        if len(valid) != 1:
            raise ValueError('gpu_reservation_missing_or_ambiguous')
        self.cached, self.checked_at = valid[0], now
        return self.cached
