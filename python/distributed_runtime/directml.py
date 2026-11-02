"""DirectML device support, including actual DXGI budget observations."""
from __future__ import annotations

import ctypes
import os
import sys
import uuid
from functools import wraps
from dataclasses import replace


def selected_device_index(device_count: int) -> int:
    """Honor the provider ordinal selected by the verified native GPU probe."""
    value = os.environ.get("MYCELLIOS_DIRECTML_DEVICE_INDEX", "0").strip()
    if not value.isdecimal() or int(value) >= device_count:
        raise RuntimeError("Verified DirectML device index is unavailable or invalid")
    return int(value)


def directml_stage_spec(spec, backend: str):
    # Padded arena views did not preserve cached decode equivalence on DML.
    # Materialize the dynamic cache and advertise that actual execution mode.
    return replace(spec, kv_cache="dynamic", decode_attention="stock") if backend == "directml" else spec


def stage_inference_mode():
    """Keep existing inference mode except for DirectML's versioned tensors."""
    def decorate(function):
        @wraps(function)
        def call(self, *args, **kwargs):
            import torch
            target = getattr(self, "execution_device", None)
            directml = getattr(target, "backend", None) == "directml"
            with torch.inference_mode(not directml), torch.no_grad():
                return function(self, *args, **kwargs)
        return call
    return decorate


def enable_legacy_torch_imports() -> None:
    # Torch 2.4 exported these real implementations under _tensor. Transformers
    # 5.14 imports their newer namespace even for single-device model loading.
    import torch
    version = tuple(int(value) for value in torch.__version__.split("+")[0].split(".")[:2])
    if version < (2, 5):
        import torch.distributed._tensor as implementation
        sys.modules.setdefault("torch.distributed.tensor", implementation)


def video_memory_budget(device_name: str) -> tuple[int, int]:
    observation = video_memory_observation(device_name)
    return observation["budgetBytes"], observation["usageBytes"]


def video_memory_observation(device_name: str) -> dict:
    """Return local budget and current usage from the matching DXGI adapter.

    Shared GPUs are measured through their Windows budget; WMI AdapterRAM is
    never used as free VRAM. Failure is closed, including ambiguous names.
    """
    if os.name != "nt":
        raise RuntimeError("DirectML memory observation requires Windows DXGI")
    from ctypes import wintypes

    class GUID(ctypes.Structure):
        _fields_ = [("bytes", ctypes.c_ubyte * 16)]
        def __init__(self, value):
            super().__init__((ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID(value).bytes_le))

    class DESC(ctypes.Structure):
        _fields_ = [("Description", wintypes.WCHAR * 128), ("VendorId", wintypes.UINT),
                    ("DeviceId", wintypes.UINT), ("SubSysId", wintypes.UINT),
                    ("Revision", wintypes.UINT), ("DedicatedVideoMemory", ctypes.c_size_t),
                    ("DedicatedSystemMemory", ctypes.c_size_t), ("SharedSystemMemory", ctypes.c_size_t),
                    ("AdapterLuid", ctypes.c_byte * 8), ("Flags", wintypes.UINT)]

    class MEMORY(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in
                    ("Budget", "CurrentUsage", "AvailableForReservation", "CurrentReservation")]

    def method(pointer, index, result, *arguments):
        table = ctypes.cast(pointer, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        return ctypes.WINFUNCTYPE(result, ctypes.c_void_p, *arguments)(table[index])

    def check(hr):
        if hr < 0:
            raise RuntimeError(f"DXGI query failed: {hr & 0xffffffff:08x}")

    factory = ctypes.c_void_p()
    iid = GUID("770aae78-f26f-4dba-a829-253c83d1b387")
    create = ctypes.WinDLL("dxgi").CreateDXGIFactory1
    create.argtypes = [ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
    create.restype = ctypes.c_long
    check(create(ctypes.byref(iid), ctypes.byref(factory)))
    matches = []
    try:
        for index in range(64):
            adapter = ctypes.c_void_p()
            hr = method(factory, 12, ctypes.c_long, wintypes.UINT, ctypes.POINTER(ctypes.c_void_p))(
                factory, index, ctypes.byref(adapter))
            if hr & 0xffffffff == 0x887a0002:
                break
            check(hr)
            try:
                desc = DESC()
                check(method(adapter, 10, ctypes.c_long, ctypes.POINTER(DESC))(adapter, ctypes.byref(desc)))
                if desc.Description.strip("\0") != device_name.strip("\0"):
                    continue
                newer = ctypes.c_void_p()
                iid3 = GUID("645967a4-1392-4310-a798-8053ce3e93fd")
                check(method(adapter, 0, ctypes.c_long, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p))(
                    adapter, ctypes.byref(iid3), ctypes.byref(newer)))
                try:
                    info = MEMORY()
                    check(method(newer, 14, ctypes.c_long, wintypes.UINT, wintypes.UINT, ctypes.POINTER(MEMORY))(
                        newer, 0, 0, ctypes.byref(info)))
                    matches.append(dict(budgetBytes=int(info.Budget), usageBytes=int(info.CurrentUsage),
                        dedicatedVideoMemoryBytes=int(desc.DedicatedVideoMemory),
                        sharedSystemMemoryBytes=int(desc.SharedSystemMemory),
                        deviceMemorySharesHost=int(info.Budget) > int(desc.DedicatedVideoMemory)))
                finally:
                    method(newer, 2, ctypes.c_ulong)(newer)
            finally:
                method(adapter, 2, ctypes.c_ulong)(adapter)
    finally:
        method(factory, 2, ctypes.c_ulong)(factory)
    if len(matches) != 1 or matches[0]["budgetBytes"] <= 0:
        raise RuntimeError("DirectML requires one unambiguous positive DXGI adapter budget")
    return matches[0]


def configure_decode_attention(base, mode: str, backend: str) -> bool:
    if backend == "directml":
        # DirectML SDPA cached decode differed from the CPU expression despite
        # reporting finite outputs. Eager attention retains explicit masks.
        base.config._attn_implementation = "eager"
        return False
    from .decode_attention import apply_to
    return mode == "grouped-prefix" and apply_to(base)
