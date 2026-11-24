import { z } from "zod";

// The web CSP forbids eval. Without this, the first object schema built at import time
// probes `new Function("")`, which the browser reports as a CSP violation even though
// Zod catches the error. The setting lives on globalThis, so every bundled copy sees it.
z.config({ jitless: true });
