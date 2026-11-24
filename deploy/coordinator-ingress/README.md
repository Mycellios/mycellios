# Stable coordinator address

The gateway keeps the Docker alias `mycellios-coordinator` for ingress and
direct consumers. Each coordinator generation gets its own alias
`coordinator-release-<full-git-sha>`. Bind the route state as a directory at
`/etc/mycellios-route` so Nginx sees atomic replacements of `active.conf`.
The initial file must select the serving generation with this format:

```nginx
set $coordinator_backend coordinator-release-<full-git-sha>:4174;
```

Initialize `gate.json` in the same directory with `revision` set to the
serving SHA and `hold` set to null. Run `node route-gate.mjs STATE_DIR` with
write access to the directory for the Unix socket. Mount the same directory
read-only in Nginx and let its workers traverse it. The gate sends only the
selected upstream on the Unix socket. It holds at most 256 concurrent requests
for up to 10 seconds. An unavailable gate fails closed.

The lifecycle controller runs the commands on the gateway host in this order:

```sh
bash hold.sh hold STATE_DIR OPERATION_ID FROM_SHA
bash switch.sh GATEWAY STATE_DIR OPERATION_ID FROM_SHA TO_SHA
bash hold.sh release STATE_DIR OPERATION_ID TO_SHA
```

The controller transfers Mycellios admission inside the hold and checks worker
capacity. The switch checks target health, serializes route writers, validates
Nginx configuration and verifies the new route on the private loopback probe.
The public route stays held until release. The durable hold and pending record
bind recovery to the same operation. A failed reload restores the previous
probe route and leaves the hold with its owner. Reverse the revisions to switch
back while held. A reverse handoff after public traffic has opened must also
preserve work already admitted by the candidate.

Use `bash switch.sh --observe GATEWAY STATE_DIR` to read the private probe's
revision and the configured ingress gate under a shared lock. During a hold,
the probe can point at the candidate while the gate retains the source revision.
An unfinished reload journal or disagreement between the running probe and
the route file prevents a verified observation.

Nginx lets established connections finish during reload. POST requests keep
their original destination once sent. The lifecycle controller must keep
the previous coordinator running until application work drains. This
configuration does not transfer workers or database ownership.

Run `node deploy/coordinator-ingress/rehearse.mjs` on a disposable Linux
Docker host. The fixture exercises concurrent traffic, a rejected candidate,
a failed reload, replay, rollback, the stable alias, an operation-bound hold
and established HTTP and WebSocket streams. It uses an isolated Docker network and loopback
port. Before admission in production, reconcile the current consumers,
endpoint behavior and actual Mycellios handoff in a separate rehearsal.
