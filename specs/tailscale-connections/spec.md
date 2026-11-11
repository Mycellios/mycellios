# Tailscale connections

Status: implementation candidate. Current qualification is recorded only in
`docs/STATUS_AND_EVIDENCE.md`; deployment needs a revision-bound release receipt.

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
page. This uses the public device login flow. Tailscale OAuth Apps is a public,
separate provisioning flow used by Grok Bot; this release has no registered
Mycellios OAuth App and does not implement that consent flow. Existing MCP OAuth
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
incremental typing. The gateway workflow adds real userspace transport through an
ephemeral Headscale-controlled network and an actual Mico connector/PostgreSQL
admission test. This does not certify the separate Tailscale SaaS consent flow or
a full LLM run. Deployment and real account enrollment are separately reported.
