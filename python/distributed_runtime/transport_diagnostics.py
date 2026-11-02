"""Bounded receive-channel diagnostics without altering failure propagation."""
import json
import sys
import time


def queue_receive_failure(destination, sock, channel, error, *, closed, fatal_error=None):
    transport_error = isinstance(error, (EOFError, OSError))
    if transport_error and (closed or fatal_error is not None):
        return
    if transport_error:
        try:
            try:
                peer = sock.getpeername()
            except Exception:
                peer = None
            print(json.dumps(dict(event='pipeline_transport_failure', channel=channel,
                                  observedAt=time.time(), peer=peer,
                                  errorType=type(error).__name__, errno=getattr(error,'errno',None),
                                  winerror=getattr(error,'winerror',None), message=str(error)[:512])),
                  file=sys.stderr, flush=True)
        except Exception:
            pass
    destination.put(error)


def trace_startup_probe(sock, action, stage, step, pipeline_id):
    """Record the startup-only hop; never log request payloads or periodic probes."""
    if step != 0:
        return
    try:
        try:
            peer = sock.getpeername()
        except Exception:
            peer = None
        print(json.dumps(dict(event='startup_route_probe', action=action, stage=stage,
                              pipelineId=str(pipeline_id), peer=peer, observedAt=time.time())),
              file=sys.stderr, flush=True)
    except Exception:
        pass


def relay_route_probe(frame, *, pipeline_id, stage, upstream, downstream, return_socket, emulator):
    from .protocol import FrameType, send_frame
    if frame.request_id != pipeline_id:
        raise ValueError("route PING belongs to another pipeline session")
    target = downstream if downstream is not None else return_socket
    if target is None:
        raise RuntimeError("last stage has no route-probe return socket")
    trace_startup_probe(upstream, "received", stage, frame.step, frame.request_id)
    send_frame(target, FrameType.PING if downstream is not None else FrameType.PONG,
               frame.request_id, step=frame.step, emulator=emulator)
    trace_startup_probe(target, "forwarded" if downstream is not None else "returned",
                        stage, frame.step, frame.request_id)
