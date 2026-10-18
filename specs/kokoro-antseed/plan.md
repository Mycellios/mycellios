# Kokoro replicas through Mycellios and AntSeed

Base: 87af5cc6df21c5b4d0d61fdad663140b2e38fee0.
Implement an opt-in native Kokoro CPU replica adapter using the existing authenticated worker,
lease, cancellation, scheduler and chat API. No changes to existing LLM placement or credentials.
Each replica uses a loopback-only Python runtime with pinned model/voice files and bounded WAV output.
Chat content contains a versioned JSON speech envelope; binary bytes are never billed as text tokens.
AntSeed uses its existing openai provider, the same chat protocol, and real input token usage.
Acceptance: fail-closed identity/size validation, cancellation/deadlines, real synthesis,
worker-to-coordinator delivery, scheduling among replicas, unchanged LLM regressions.
A fixture is not physical-network or paid-settlement evidence. Public promotion follows repository gates.

PR 55 is integrated at 54506128fc3bac6137ed17a8add164f8ba56f359.
The verified coordinator overlay is deployed as 0.2.120, preserving the production repairs.
Three owned Windows speech services produced real WAV audio. Account-confirmed
enrollment and the AntSeed seller route to those PC replicas remain outstanding.
The standalone CLI now reuses the protected native enrollment bootstrap; its
account binding and completion path have an executable local regression.
