# In-run context compaction

Before main-call admission and credit reservation, measure the effective model
window, output reserve, instructions, tools and images. Near pressure, summarize
only historical conversation data through the same owned model connection.
Keep current user input, steering, system constraints and live tool protocol intact.

Summarization has no tools, a bounded input chunk/output/time budget and at most
eight calls per run. Active summary generation has a separate fifteen-minute
ceiling, with caller cancellation and the provider silence watchdog retained.
A single empty-summary recovery may halve that input chunk; keep its unprocessed
suffix and account for both attempts within the same call budget.
Attribute actual summary calls as compaction usage; never
report them as free or invent a receipt. Keep archived messages unchanged. Cache
the in-run summary only inside that run and retain it in ordinary turn checkpoints.

An explicit provider context-overflow rejection may request one further,
smaller-history rebuild. Retry only the model request before visible output,
not the agent loop or completed effects. Preserve cancellation and shared recovery
limits. Current input or mandatory instructions that alone exceed the window
remain an honest, non-retryable capacity limit; compaction cannot remove them.

Qualification is offline first: history length/large-message pressure, current
images and steering, summary failure/cancellation/bounds, owned credentials,
usage attribution, checkpoint suffixes and no repeated tools through real Pi HTTP/SSE.
These tests do not claim real-model summary quality or a production deployment.
