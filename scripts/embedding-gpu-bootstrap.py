"""Owned service bootstrap. Tensor imports wait for the Windows Job barrier."""
import pathlib
import sys


def configure_child_priority(arguments, kernel=None):
    """Avoid CPU starvation inside the existing owner-controlled Windows Job."""
    if "--child" not in arguments:
        return
    if kernel is None:
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetCurrentProcess.restype = wintypes.HANDLE
        kernel.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.SetPriorityClass.restype = wintypes.BOOL
    if not kernel.SetPriorityClass(kernel.GetCurrentProcess(), 0x20):
        raise RuntimeError("embedding_gpu_normal_priority_unavailable")


if __name__ == "__main__":
    configure_child_priority(sys.argv)
    sys.path.insert(0, str(pathlib.Path(__file__).parent / "source"))
    from distributed_runtime.embedding_gpu_windows_job import main
    main()
