// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act, createContext, Suspense, useContext, useEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@mycellios/ui-web", () => {
  const OpenChange = createContext<(open: boolean) => void>(() => {});
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
      children?: ReactNode;
    }) =>
      open ? (
        <OpenChange.Provider value={onOpenChange ?? (() => {})}>{children}</OpenChange.Provider>
      ) : null,
    AlertDialogCancel: ({ children }: { children?: ReactNode }) => {
      const onOpenChange = useContext(OpenChange);
      return (
        <button type="button" onClick={() => onOpenChange(false)}>
          {children}
        </button>
      );
    },
    AlertDialogContent: Pass,
    AlertDialogFooter: Pass,
    AlertDialogHeader: Pass,
    AlertDialogTitle: Pass,
    Button: ({ children, onClick }: ComponentProps<"button">) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
  };
});

import { lazyOverlay } from "./ErrorBoundary";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // React reports every caught render error to the console.
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Integrations({ onClose: _onClose }: { onClose: () => void }) {
  return <h2>Integrations</h2>;
}

function button(name: string) {
  const match = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === name,
  );
  if (!match) throw new Error(`missing button ${name}`);
  return match;
}

async function renderInShell(overlay: ReactNode) {
  await act(async () => {
    root.render(
      <>
        <p>Composer draft</p>
        <Suspense fallback={null}>{overlay}</Suspense>
      </>,
    );
  });
}

it("renders the overlay once its chunk loads", async () => {
  const PluginsOverlay = lazyOverlay(async () => Integrations);

  await renderInShell(<PluginsOverlay onClose={vi.fn()} />);

  expect(container.textContent).toContain("Integrations");
  expect(container.textContent).not.toContain("Could not load");
});

it("renders a preloaded overlay without showing Suspense and shares the pending import", async () => {
  const load = vi.fn(async () => Integrations);
  const Settings = lazyOverlay(load);
  const coldFallback = vi.fn();
  function Fallback() {
    coldFallback();
    return null;
  }

  await Promise.all([Settings.preload(), Settings.preload()]);
  await act(async () => {
    root.render(<Suspense fallback={<Fallback />}><Settings onClose={vi.fn()} /></Suspense>);
  });

  expect(load).toHaveBeenCalledOnce();
  expect(coldFallback).not.toHaveBeenCalled();
  expect(container.textContent).toBe("Integrations");
});

it("preserves the cold overlay instance on later renders", async () => {
  const mounted = vi.fn();
  function SettingsContent({ onClose }: { onClose: () => void }) {
    useEffect(() => { mounted(); }, []);
    return <button onClick={onClose}>Settings</button>;
  }
  const Settings = lazyOverlay(async () => SettingsContent);

  await renderInShell(<Settings onClose={vi.fn()} />);
  const first = button("Settings");
  await renderInShell(<Settings onClose={vi.fn()} />);

  expect(button("Settings")).toBe(first);
  expect(mounted).toHaveBeenCalledOnce();
});

it("keeps the shell when an overlay chunk fails to load", async () => {
  const PluginsOverlay = lazyOverlay(() =>
    Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
  );

  await renderInShell(<PluginsOverlay onClose={vi.fn()} />);

  expect(container.textContent).toContain("Composer draft");
  expect(container.textContent).toContain("Could not load");
  expect(button("Refresh")).toBeTruthy();
});

it("closes an overlay that failed to load", async () => {
  const onClose = vi.fn();
  const PluginsOverlay = lazyOverlay(() => Promise.reject(new TypeError("Load failed")));

  await renderInShell(<PluginsOverlay onClose={onClose} />);
  await act(async () => button("Close").click());

  expect(onClose).toHaveBeenCalledOnce();
  expect(container.textContent).toContain("Composer draft");
});

it("contains a render error thrown by a loaded overlay", async () => {
  function Broken(_props: { onClose: () => void }): ReactNode {
    throw new Error("render failed");
  }
  const SettingsOverlay = lazyOverlay(async () => Broken);

  await renderInShell(<SettingsOverlay onClose={vi.fn()} />);

  expect(container.textContent).toContain("Composer draft");
  expect(container.textContent).toContain("Could not load");
});
