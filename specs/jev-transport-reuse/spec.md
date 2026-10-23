# Reuse authenticated native decision control connections

The 256-token buyer attempt failed with unavailable executors and a subsequent
physical-worker heartbeat timeout. Native processes remained alive, memory
preflight passed and the installed HP client already has nonblocking hardware
sampling. Do not replace those unrelated native overlays or assume WMI is the
proven cause. The current decision actor creates a fresh TLS connection for every
poll and remote permit; test connection reuse as a bounded transport improvement.

Reuse one HTTPS connection for poll/result and a separate, explicitly closed
channel for the active stage's permit checks. Authenticate every request with the
existing distinct credentials and pinned CA. Preserve the 3-second permit and
30-second data socket limits, five-second remote grants, actor parent/deadline
watchers, resource guards, frame/digest bounds and eight server connection slots.
Do not automatically replay a model execution or relax ownership/freshness.
Keep completed-ticket result redelivery; a failed connection is discarded.

HTTP/1.1 must close on rejected authentication, invalid framing and unknown
paths, so unread bodies cannot be interpreted as another request. Add bounded
executor freshness diagnostics to authenticated loopback health and failure
receipts. Neither a transport probe nor a schema-rejected free response counts
as successful model inference.
The worker adapter must accept the bounded optional observations field while
retaining strict health validation. When present, require all three stage indices
in route order, available owners and observations younger than 15 seconds.
Continue accepting earlier qualified gateways without the optional field.
Optional actor diagnostics rotate at 1 MiB with one backup, contain only fixed
event/phase codes and HTTP status, and never log payloads or credentials.
Preserve the bounded owner/permit cancellation code when the policy watcher
kills a child; a generic exit 125 must not obscure which guard revoked it.

Verify real keep-alive reuse and failure/boundary behavior with stdlib tests,
existing decision/owner tests and public repository gates. Preserve exact source
and model lineage; qualify changed native sources physically before serving.
Require a complete real buyer result with the explicit provider selector,
actual input/zero output usage and served_free=1. Keep all failed attempts;
leave GPU/voice/embedding services, reservations and account limits unchanged.

Full-context decisions can exceed the default HTTP/P2P initial-response timeout.
Use the existing SSE buyer route with admission/heartbeat events; require the
complete decision, successful finish, usage and terminal event. The local native
adapter uses bounded node:http with the existing absolute lease, cancellation,
no redirects and strict response-byte limit, avoiding fetch's separate header
deadline. Do not increase other providers' or the buyer's global timeouts.
