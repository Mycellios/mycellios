// @vitest-environment jsdom

import type { Space } from "@mycellios/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
}));
vi.mock("../../components/ServerConnections", () => ({ ServerConnections: () => null }));
vi.mock("../../components/IconTooltip", () => ({
  IconTooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./bot-picker", () => ({ BotCreatePicker: () => null }));
vi.mock("@mycellios/ui-web", async () => {
  const { createContext: context, useContext: use } = await import("react");
  const Opener = context<(open: boolean) => void>(() => undefined);
  return {
    Button: ({
      variant: _variant,
      size: _size,
      ...props
    }: ComponentProps<"button"> & {
      variant?: string;
      size?: string;
    }) => <button type="button" {...props} />,
    Popover: ({
      children,
      onOpenChange,
    }: {
      children?: ReactNode;
      onOpenChange: (open: boolean) => void;
    }) => <Opener.Provider value={onOpenChange}>{children}</Opener.Provider>,
    PopoverTrigger: ({
      children,
      onContextMenu: _menu,
      onKeyDown: _key,
      ...props
    }: ComponentProps<"button">) => {
      const open = use(Opener);
      return (
        <button type="button" {...props} onClick={() => open(true)}>
          {children}
        </button>
      );
    },
    PopoverContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  };
});

import { SidebarHeader } from "./sidebar-header";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const personal = {
  id: "space-personal",
  name: "Personal",
  isDefault: true,
  hasContent: true,
  bots: [],
  groups: [],
  externalConversations: [],
  botSections: [],
} as Space;

async function show(props: Partial<ComponentProps<typeof SidebarHeader>>) {
  const noop = () => undefined;
  await act(async () =>
    root.render(
      <SidebarHeader
        createMenuOpen={false}
        setCreateMenuOpen={noop}
        activityMode={false}
        toggleActivityMode={noop}
        setBotsSidebarCollapsedPref={noop}
        bots={[]}
        setMobileSidebarOpen={noop}
        setPanel={noop}
        navigate={noop}
        setNewSpaceOpen={noop}
        setCreateBotOpen={noop}
        spaces={[personal]}
        spaceId={personal.id}
        onSpace={noop}
        onSpaceSettings={noop}
        history={{ canBack: false, canForward: false, back: noop, forward: noop }}
        {...props}
      />,
    ),
  );
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Switch workspace"]')!.click(),
  );
}

it("lists Spaces shared with the account by name and owner, opening their people", async () => {
  const onSpace = vi.fn();
  const onSharedSpace = vi.fn();
  await show({
    onSpace,
    onSharedSpace,
    sharedSpaces: [{ id: "space-launch", name: "Launch", role: "member", ownerName: "Ana" }],
  });
  const shared = container.querySelector<HTMLButtonElement>('[data-testid="shared-space"]');
  expect(shared?.textContent).toBe("LaunchAna");
  await act(async () => shared!.click());
  expect(onSharedSpace).toHaveBeenCalledWith("space-launch");
  expect(onSpace).not.toHaveBeenCalled();
});

it("shows no shared Spaces while the deployment keeps Space members off", async () => {
  await show({ onSharedSpace: vi.fn() });
  expect(container.querySelector('[data-testid="shared-space"]')).toBeNull();
  expect(container.textContent).toContain("Personal");
});
