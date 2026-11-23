# Stable coordinator address

The gateway keeps the Docker alias `mycellios-coordinator` for ingress and
direct consumers. Each coordinator generation gets its own alias
`coordinator-release-<full-git-sha>`. Bind the route state as a directory at
`/etc/mycellios-route` so Nginx sees atomic replacements of `active.conf`.
The initial file must select the serving generation with this format:

```nginx
set $coordinator_backend coordinator-release-<full-git-sha>:4174;
```

Run `bash deploy/coordinator-ingress/switch.sh GATEWAY STATE_DIR FROM_SHA TO_SHA`
on the Linux gateway host under the coordinator lifecycle controller. The
controller is responsible for Mycellios admission and worker capacity. The
script checks the target's serving health, serializes route writers, checks
Nginx configuration, reloads its workers and verifies the served revision
over a fresh connection. A failed reload rescues the previous route while
that revision is still healthy. A durable pending record lets the same
request resume after interruption. Rollback uses the same command with
the revisions reversed.

Nginx lets established connections finish during reload. POST requests keep
their original destination once sent. The lifecycle controller must keep
the previous coordinator running until application work drains. This
configuration does not transfer workers or database ownership.

Run `node deploy/coordinator-ingress/rehearse.mjs` on a disposable Linux
Docker host. The fixture exercises concurrent traffic, a rejected candidate,
a failed reload, replay, rollback, the stable alias and established HTTP
and WebSocket streams. It uses an isolated Docker network and loopback
port. Before admission in production, reconcile the current consumers,
endpoint behavior and actual Mycellios handoff in a separate rehearsal.
