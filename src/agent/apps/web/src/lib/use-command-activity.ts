import { useEffect, useRef, useState } from "react";
import type { ComputerCommand } from "@rakazo/contracts";
import { observeToolEvent, observedTools, type ToolObservation } from "@rakazo/core";
import { useSpaceRpc } from "./space-rpc";
const computerTools = new Set(["shell", "write_file", "attach_file", "open_path", "launch_app"]);

/** Older APIs expose command history separately. Join only exact current-run tool IDs. */
export function useCommandActivity(runId: string, botId: string, tools: ToolObservation[]) {
  const client = useSpaceRpc();
  const current = useRef(tools); current.current = tools;
  const [history, setHistory] = useState<{ runId: string; commands: (ComputerCommand & {createdAt: string})[] }>();
  useEffect(() => {
    let disposed = false, pending = false;
    const finished = new Set<string>();

    const update = async () => {
      if (disposed || pending || document.hidden || !current.current.some(tool => (computerTools.has(tool.name) || tool.commandStatus) && !finished.has(tool.id))) return;
      pending = true;
      try {
        const commands = await client.computer.commands({botId});
        if (!disposed) {
          const ids = new Set(current.current.map(tool => tool.id));
          for (const command of commands) if (ids.has(command.executionId) && command.status === "done") finished.add(command.executionId);
          setHistory({runId, commands: commands.filter(command => ids.has(command.executionId))});
        }
      } catch { /* Keep event-sourced activity; never retry execution or invent a result. */ }
      finally { pending = false; }
    };
    void update();
    const timer = window.setInterval(() => void update(), 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [runId, botId, client]);
  let blocks = [{kind: "steps" as const, steps: [], tools}];
  const ids = new Set(tools.map(tool => tool.id));
  for (const command of history?.runId === runId ? history.commands : []) {
    if (!ids.has(command.executionId)) continue;
    blocks = observeToolEvent(blocks, {type:"computer.command", payload:command, createdAt:command.createdAt}) as typeof blocks;
  }
  return observedTools(blocks);
}
