// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { useChatHistory } from "./use-chat-history";

it("preserves independent task and project targets when navigating back and forward", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let history!: ReturnType<typeof useChatHistory>, navigate!: ReturnType<typeof useNavigate>, location = "";
  function Probe() { history = useChatHistory(); navigate = useNavigate(); const current = useLocation(); location = current.pathname + current.search; return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={["/app/mico?task=first&taskSpace=space"]}><Probe /></MemoryRouter>));
    await act(async () => navigate("/app/mico?task=second&taskSpace=space"));
    expect(history.canBack).toBe(true);
    await act(async () => history.back());
    expect(location).toBe("/app/mico?task=first&taskSpace=space");
    await act(async () => history.forward());
    expect(location).toBe("/app/mico?task=second&taskSpace=space");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
