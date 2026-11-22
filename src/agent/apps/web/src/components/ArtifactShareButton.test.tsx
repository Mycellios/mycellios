// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getShare: vi.fn(), share: vi.fn(), unshare: vi.fn() }));
vi.mock("../lib/space-rpc", () => ({ useSpaceRpc: () => ({ artifacts: { share: mocks.share, unshare: mocks.unshare } }) }));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    artifacts: {
      getShare: {
        queryOptions: ({ input }: { input: { artifactId: string } }) => ({
          queryKey: ["artifacts", "getShare", input.artifactId],
          queryFn: () => mocks.getShare(input),
        }),
      },
    },
  }),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((s, part, i) => `${s}${i ? values[i - 1] : ""}${part}`, "") }),
}));
vi.mock("@mycellios/ui-web", () => ({
  Button: ({ variant: _, size: __, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props} />,
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
import { ArtifactShareButton, shareLinkUrl } from "./ArtifactShareButton";

const TOKEN = "A".repeat(43);
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of Object.values(mocks)) mock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render(versionId = "v2", version = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><ArtifactShareButton familyId="v1" versionId={versionId} version={version} /></QueryClientProvider>));
}
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const click = async (label: string) => { await act(async () => button(label).click()); await settle(); };

it("never reads or creates a link until the owner opens the dialog and asks", async () => {
  mocks.getShare.mockResolvedValue(null);
  await render();
  expect(mocks.getShare).not.toHaveBeenCalled();
  await click("Share");
  expect(mocks.share).not.toHaveBeenCalled();
  mocks.share.mockResolvedValue({ token: TOKEN, artifactId: "v2", version: 2, updatedAt: "" });
  await click("Create link");
  expect(mocks.share).toHaveBeenCalledWith({ artifactId: "v2" });
  expect(container.querySelector("input")!.value).toBe(shareLinkUrl(TOKEN));
});

it("shows which version the link carries and moves it only when asked", async () => {
  mocks.getShare.mockResolvedValue({ token: TOKEN, artifactId: "v1", version: 1, updatedAt: "" });
  await render();
  await click("Share");
  expect(container.textContent).toContain("The link shows version 1.");
  mocks.share.mockResolvedValue({ token: TOKEN, artifactId: "v2", version: 2, updatedAt: "" });
  await click("Share version 2 instead");
  expect(mocks.share).toHaveBeenCalledWith({ artifactId: "v2" });
  expect(container.textContent).not.toContain("The link shows version");
});

it("stops sharing the whole family", async () => {
  mocks.getShare.mockResolvedValue({ token: TOKEN, artifactId: "v2", version: 2, updatedAt: "" });
  mocks.unshare.mockResolvedValue({ ok: true });
  await render();
  await click("Share");
  await click("Stop sharing");
  expect(mocks.unshare).toHaveBeenCalledWith({ artifactId: "v1" });
  expect(button("Create link")).toBeTruthy();
});
