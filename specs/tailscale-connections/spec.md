# Tailscale connections

Status: implementation candidate; no live tailnet or production qualification yet.

Conexiones owns personal and company tailnets. Each consenting member gets an
independent userspace Tailscale device per Space/network. Existing MCP servers
select a network and retain existing per-Mico and per-tool assignments. A network
also has an explicit Mico allowlist. Both grants must hold at execution, not only
at discovery. Probes require the owning user but no Mico grant. Every outbound
HTTP request revalidates the current membership, network, company policy, server
binding and assignments. Disconnected or revoked routes never use public egress.

The managed Linux gateway runs isolated tailscaled processes, private state and
local HTTP proxies. It never attaches customer routes to the shared host kernel.
An authenticated control channel carries bounded requests to the selected device.
Targets must be full MagicDNS names under the connected tailnet's observed DNS
suffix; raw IPs, arbitrary DNS, subnet routes, redirects and metadata are refused.
The authenticated user's consent opens the official Tailscale device enrollment
page. This deliberately uses the public device login flow, not an undocumented
cross-tailnet OAuth registration used by another vendor. Existing MCP OAuth
remains independent; private OAuth issuers use the same authorized network.

Company networks require a Space administrator's enabled policy for the exact
MagicDNS suffix; each member still enrolls their own device. Disabling policy or
removing membership refuses traffic immediately and active streams are aborted
by bounded revalidation. Tailnet ACLs remain necessary and may narrow access.
Personal grants are never shared implicitly. Network allowlists never replace
MCP tool allowlists. Disconnect disables admission before stopping the gateway
device and leaves MCP bindings intact; failed cleanup is retryable.

The optional gateway is disabled unless explicitly configured. Its key remains
server-side, state storage must be private and durable, and the service has no
public listener or Docker socket. No global private-endpoint flag is enabled.

Validation: focused contract, authorization, gateway and connector regression
tests; isolated PostgreSQL migration/RLS checks; web interaction checks and
incremental typing. Real enrollment and two-account/private-MCP acceptance need
real Tailscale consent and are separately reported, never inferred from fixtures.
