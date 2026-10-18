# Account-bound standalone speech replicas

The physical pilot exposed an admission boundary absent from a token-free local
coordinator: signed registration can succeed while the public WebSocket rejects a
replica whose key has not been explicitly bound to an account. Reuse the native
one-shot enrollment bootstrap in the standalone worker CLI, without weakening
ownership checks or distributing coordinator credentials. Preserve the native
node import as a compatibility re-export. Add a real CLI enrollment/ownership
regression and verify the existing native bootstrap suite.

The Windows supervisor must account for the actual CPU Python process and remove
its owned children when stopped. Use the installed interpreter directly with
isolated optional site-packages, avoiding a venv launcher that obscures the model
process from the memory watchdog. Final acceptance requires all physical speech
replicas, their account bindings, coordinator delivery and the AntSeed seller path.
