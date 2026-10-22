"""Local CPU owner gate. This does not enroll a worker or grant public admission."""
from __future__ import annotations

import ctypes
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time


def machine_identity():
    if sys.platform != 'win32':
        raise ValueError('decision_owner_windows_required')
    import winreg
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\Microsoft\Cryptography',
                        0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
        guid, _ = winreg.QueryValueEx(key, 'MachineGuid')
    return hashlib.sha256(guid.strip().lower().encode('utf-8')).hexdigest()


def available_memory_mib():
    if sys.platform != 'win32':
        raise ValueError('decision_owner_windows_required')

    class Memory(ctypes.Structure):
        _fields_ = [('length', ctypes.c_uint32), ('load', ctypes.c_uint32)] + [
            (key, ctypes.c_uint64) for key in ('totalPhysical', 'availablePhysical', 'totalPage',
                'availablePage', 'totalVirtual', 'availableVirtual', 'availableExtended')]
    value = Memory()
    value.length = ctypes.sizeof(value)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
        raise ValueError('decision_owner_memory_unavailable')
    return value.availablePhysical // (1024*1024)


class DecisionOwnerGuard:
    """Respect the existing node identity, pause, schedule and CPU/RAM ceilings.

    The executable separately installs the Windows Job private-commit/CPU limits.
    This guard is not a global reservation system for unrelated processes.
    """
    def __init__(self, config, *, read=None, identity=None, free_memory=None, clock=None):
        if not re.fullmatch(r'node-[a-z0-9]{32}', str(config.get('nodeId', ''))) \
                or not re.fullmatch(r'[a-f0-9]{64}', str(config.get('machineIdentitySha256', ''))):
            raise ValueError('decision_owner_identity_binding')
        self.node_id = config['nodeId']
        self.expected_identity = config['machineIdentitySha256']
        self.clock = clock or (lambda: time.time()*1000)
        self.identity = identity or machine_identity
        self.free_memory = free_memory or available_memory_mib
        self.read = read or self._read
        if self.identity() != self.expected_identity:
            raise ValueError('decision_owner_physical_identity_mismatch')

    @staticmethod
    def _read(name):
        root = Path(os.environ.get('PROGRAMDATA', 'C:/ProgramData')) / 'Mycellios' / 'Configuration'
        path = root / ('node.json' if name == 'configuration' else 'state/control.json')
        raw = path.read_bytes()
        if len(raw) > (32768 if name == 'configuration' else 4096):
            raise ValueError('decision_owner_file_boundary')
        return json.loads(raw.decode('utf-8-sig'))

    def check(self, *, starting=False):
        native, control = self.read('configuration'), self.read('control')
        if native.get('schema') != 'mycellios-node-configuration/1' or native.get('nodeId') != self.node_id \
                or control.get('schema') != 'mycellios-node-control-state/2' \
                or control.get('contributionEnabled') is not True or control.get('draining') is not False:
            raise ValueError('decision_owner_paused_or_changed')
        limits, policy = native['limits'], native['policy']
        for key, minimum in (('maxCpuPercent', 20), ('maxRamMiB', 2048), ('maxConcurrency', 1)):
            if type(limits.get(key)) is not int or limits[key] < minimum:
                raise ValueError('decision_owner_resource_limit')
        allowed = policy['modelAllowlist']
        if not isinstance(allowed, list) or allowed and 'jev' not in allowed:
            raise ValueError('decision_owner_model_not_allowed')
        date = datetime.datetime.fromtimestamp(self.clock()/1000, tz=datetime.timezone.utc)
        day, minute = (date.weekday()+1) % 7, date.hour*60+date.minute
        windows = policy['schedule']
        if not isinstance(windows, list) or not any(isinstance(w, dict) and day in w.get('days', [])
                and type(w.get('startMinuteUtc')) is int and type(w.get('endMinuteUtc')) is int
                and 0 <= w['startMinuteUtc'] <= minute < w['endMinuteUtc'] <= 1440 for w in windows):
            raise ValueError('decision_owner_schedule_closed')
        free = self.free_memory()
        if type(free) is not int or free < (2048 if starting else 768):
            raise ValueError('decision_owner_memory_headroom')
        return {'nodeId': self.node_id, 'physicalIdentity': self.expected_identity,
                'controlRevision': control.get('revision'), 'cpuPercentCeiling': 20,
                'privateCommitMiBCeiling': 2048, 'availableMemoryMiB': free}


def run_guarded(arguments, frame, timeout, guard):
    """Stop only this child when its owner revokes contribution or headroom.

    Authentication, model/shard verification and the absolute job lease are
    caller responsibilities. A successful local guard is never a public grant.
    """
    guard.check(starting=True)
    if not 0 < timeout <= 240:
        raise ValueError('decision_owner_deadline_boundary')
    finished, rejected = threading.Event(), []
    with subprocess.Popen(arguments, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE) as process:
        def watch():
            while not finished.wait(0.5):
                try:
                    guard.check()
                except (ValueError, OSError, KeyError, TypeError):
                    rejected.append(True)
                    if process.poll() is None:
                        process.kill()
                    return
        watcher = threading.Thread(target=watch, daemon=True)
        watcher.start()
        try:
            try:
                out, err = process.communicate(input=frame, timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate()
                raise
        finally:
            finished.set()
            watcher.join(timeout=1)
        if rejected:
            return subprocess.CompletedProcess(arguments, 125, b'', b'owner_policy_closed')
        return subprocess.CompletedProcess(arguments, process.returncode, out, err)
