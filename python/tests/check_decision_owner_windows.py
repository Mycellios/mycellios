"""Opt-in native lifetime regression probe on Windows; never loads a model."""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--binary',required=True);p.add_argument('--expected-sha256',required=True)
    p.add_argument('--output',required=True);p.add_argument('--watcher-parent',action='store_true')
    args=p.parse_args();binary=Path(args.binary).resolve(strict=True);output=Path(args.output)
    if sys.platform!='win32':raise ValueError('native_owner_probe_requires_windows')
    if binary.is_symlink() or hashlib.sha256(binary.read_bytes()).hexdigest()!=args.expected_sha256:
        raise ValueError('native_owner_probe_binary_pin')
    if args.watcher_parent:
        child=subprocess.Popen([str(binary),'--lifetime-probe',str(os.getpid()),'15000'],
            stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW)
        line=child.stdout.readline()
        if json.loads(line).get('modelExecuted') is not False:raise ValueError('native_owner_probe_not_ready')
        output.write_text(json.dumps({'pid':child.pid,'ready':True}))
        time.sleep(30) # The controller kills this parent to simulate an actor crash.
        return
    if output.exists():raise ValueError('native_owner_probe_output_exists')
    output.parent.mkdir(parents=True,exist_ok=True)
    pidfile=output.with_suffix('.child-pid.json')
    if pidfile.exists():raise ValueError('native_owner_probe_pid_file_exists')
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD];kernel.WaitForSingleObject.restype=wintypes.DWORD
    kernel.GetExitCodeProcess.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)]
    kernel.TerminateProcess.argtypes=[wintypes.HANDLE,wintypes.UINT]
    kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    parent=subprocess.Popen([sys.executable,'-I','-B',__file__,'--binary',str(binary),
        '--expected-sha256',args.expected_sha256,'--output',str(pidfile),'--watcher-parent'],
        stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW)
    handle=None
    try:
        until=time.monotonic()+8
        while not pidfile.exists():
            if parent.poll() is not None or time.monotonic()>until:raise ValueError('native_owner_probe_parent_start_failed')
            time.sleep(.05)
        info=json.loads(pidfile.read_text());handle=kernel.OpenProcess(0x101001,False,info['pid'])
        if not handle:raise ValueError('native_owner_probe_child_handle')
        started=time.monotonic();parent.kill();parent.wait(timeout=3)
        waited=kernel.WaitForSingleObject(handle,3000);code=wintypes.DWORD()
        if waited!=0 or not kernel.GetExitCodeProcess(handle,ctypes.byref(code)) or code.value!=125:
            raise ValueError('native_owner_probe_orphan_survived')
        parent_ms=(time.monotonic()-started)*1000
    finally:
        if parent.poll() is None:parent.kill();parent.wait(timeout=3)
        if handle:
            if kernel.WaitForSingleObject(handle,0)==258:kernel.TerminateProcess(handle,126)
            kernel.CloseHandle(handle)
    started=time.monotonic()
    deadline=subprocess.run([str(binary),'--lifetime-probe',str(os.getpid()),'1000'],
        stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5,
        creationflags=subprocess.CREATE_NO_WINDOW)
    elapsed=(time.monotonic()-started)*1000
    if deadline.returncode!=124 or elapsed>4000:raise ValueError('native_owner_probe_deadline_failed')
    for command in ([str(binary),'--lifetime-probe',str(os.getpid()),'240001'],
                    [str(binary),'never-open-this-shard','cpu','2','mmap']):
        bad=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                           timeout=5,creationflags=subprocess.CREATE_NO_WINDOW)
        if bad.returncode!=1:raise ValueError('native_owner_probe_unguarded_arguments_accepted')
    receipt={'schema':'mycellios-native-owner-lifetime-probe/1','modelExecuted':False,
        'binarySha256':args.expected_sha256,'parentCrashExitCode':int(code.value),
        'parentCrashCleanupMs':parent_ms,'independentDeadlineExitCode':deadline.returncode,
        'independentDeadlineMs':elapsed,'unguardedExecutionRejected':True,'passed':True}
    output.write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))


if __name__=='__main__':main()
