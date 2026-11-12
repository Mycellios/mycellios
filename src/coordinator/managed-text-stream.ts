/** Bounded OpenAI-compatible SSE. A terminal marker alone is not a billing receipt. */
export async function readManagedTextStream(response: Response, signal: AbortSignal,
  parse: (text: string) => unknown, publicModel: string, onChunk?: (value: Record<string, unknown>) => void) {
  if (!response.ok) { await response.body?.cancel(); throw new Error("managed_upstream_unavailable"); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("managed_response_missing");
  const decoder = new TextDecoder(); let buffer = "", bytes = 0, terminal = false;
  let id: string | null = null, usage: unknown = null, created: unknown = undefined, finish: unknown = null;
  let content = "";
  const tools = new Map<number, { id: string; type: "function"; function: { name: string; arguments: string } }>();
  function frame(text: string) {
    const data = text.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    if (data === "[DONE]") { terminal = true; return; }
    if (terminal) throw new Error("managed_stream_after_terminal");
    const value = parse(data) as Record<string, unknown>;
    if (!value || typeof value !== "object" || value.error) throw new Error("managed_stream_error");
    if (typeof value.id === "string") {
      if (id && id !== value.id) throw new Error("managed_stream_identity_changed");
      id = value.id;
    }
    created ??= typeof value.created === "number" ? value.created : Math.floor(Date.now() / 1000);
    if (value.usage) usage = value.usage;
    if (!Array.isArray(value.choices)) throw new Error("managed_stream_choices_invalid");
    for (const item of value.choices) {
      const choice = item as Record<string, unknown>;
      if (choice.index !== 0 || !choice.delta || typeof choice.delta !== "object") throw new Error("managed_stream_choice_invalid");
      const delta = choice.delta as Record<string, unknown>;
      if (typeof delta.content === "string") content += delta.content;
      if (Array.isArray(delta.tool_calls)) for (const raw of delta.tool_calls) {
        const call = raw as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } };
        if (!Number.isSafeInteger(call.index) || Number(call.index) < 0 || Number(call.index) >= 128) throw new Error("managed_stream_tool_invalid");
        const index = Number(call.index);
        const tool = tools.get(index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
        if (typeof call.id === "string") tool.id = call.id;
        if (typeof call.function?.name === "string") tool.function.name += call.function.name;
        if (typeof call.function?.arguments === "string") tool.function.arguments += call.function.arguments;
        tools.set(index, tool);
      }
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) finish = choice.finish_reason;
    }
    // Never forward routing metadata or upstream USD costs to the public stream.
    onChunk?.({ id, object: "chat.completion.chunk", created, model: publicModel,
      choices: value.choices.map((raw: Record<string, unknown>) => ({ index: raw.index, delta: raw.delta, finish_reason: null })) });
  }
  try {
    while (true) {
      signal.throwIfAborted(); const item = await reader.read();
      if (item.done) { buffer += decoder.decode(); break; }
      bytes += item.value.length;
      if (bytes > 4_194_304) throw new Error("managed_response_too_large");
      buffer += decoder.decode(item.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        frame(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2);
      }
    }
    if (buffer.trim()) frame(buffer);
    if (!terminal || !id || !usage || !["stop", "length", "tool_calls", "function_call", "content_filter"].includes(String(finish)))
      throw new Error("managed_stream_incomplete");
    if ([...tools.values()].some(tool => !tool.id || !tool.function.name)) throw new Error("managed_stream_tool_incomplete");
    return { id, object: "chat.completion", created, model: publicModel, usage,
      choices: [{ index: 0, message: { role: "assistant", content: content || null,
        ...(tools.size ? { tool_calls: [...tools.entries()].sort(([a], [b]) => a - b).map(([, value]) => value) } : {}) }, finish_reason: finish }] };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
