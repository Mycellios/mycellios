# Bounded task continuity

All normal interactive agents receive an internal current-request work-plan tool.
Pi uses its completed-turn hook; native Codex, Claude and ACP continue in their
existing provider session. Pending plan steps, a promised next action or a final
failed tool can trigger another model turn, without creating a user message,
rerunning completed tools, extending grants or bypassing spending observers.

Allow at most eight continuations per execution and two planless next-step or
failure-recovery turns. An unchanged pending plan gets one change-of-approach
turn, then an explicit incomplete failure. Three identical results trigger a
non-executing change-of-strategy response to the next identical call. The outer
six-call loop guard must fail the run, never record a completed task.

Actual background-shell completion wakes the same native session with its result;
Pi retains its existing shell wait. Cancellation and human pause prevent further
turns. Silent/routine/delegated runs retain their prior lifecycle. Plan state is
request-local, as in-memory session state; a process restart does not silently
recreate an autonomous continuation chain.

Verify work-continuation, native-agent-runtime, Pi dispatch, shell-command-stream,
executor-loop regression and existing approval/effect/cancellation checks. Native
protocol fixtures do not substitute for authenticated provider acceptance. Local
source qualification does not update the production worker used by cloud chats.
