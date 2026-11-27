import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContributionEntry, contributionInstallers } from "./ContributionEntry";
import { EarnStudio } from "./EarnStudio";

describe("the public contribution entry", () => {
  it("opens the existing account-bound contribution flow without installing or starting a worker", () => {
    const html = renderToStaticMarkup(<ContributionEntry />);
    expect(html).toContain('href="https://www.mycellios.com/agent"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Press Play next to Earn credits.");
    expect(html).toContain("completed, verified inference");
    expect(html).not.toContain("autostart=1");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<script");
  });
  it("renders a usable link and credit conditions before browser interaction", () => {
    const html = renderToStaticMarkup(<ContributionEntry />);
    expect(html).toContain("Connect in browser");
    expect(html).toContain('href="/earn"');
    expect(html).toContain("Mycellios wallet");
    expect(html).toContain("device compatibility and network demand");
    expect(html).not.toContain("USDC");
  });
  it("keeps the Earn page on the same wallet-backed entry and current Desktop downloads", () => {
    const html = renderToStaticMarkup(<EarnStudio />);
    expect(html).toContain('href="https://www.mycellios.com/agent"');
    expect(html).toContain('href="/downloads/desktop"');
    expect(html).toContain("Credits are separate from $SPORE");
    expect(html).not.toContain('href="/browser/?autostart=1"');
  });
  it.each([
    ["windows", "https://www.mycellios.com/downloads/windows", "mycellios-node.msi"],
    ["mac", "https://www.mycellios.com/downloads/macos-arm64", "mycellios-node.pkg"],
  ] as const)("offers a download-only command for %s through a stable official route", (platform, url, file) => {
    const { command } = contributionInstallers[platform];
    expect(command).toBe(`${platform === "windows" ? "curl.exe" : "curl"} -fL ${url} -o ${file}`);
    expect(command).not.toMatch(/\||sudo|install\.sh|autostart|0\.2\.95/);
  });
  it("makes commands selectable, explains account pairing, and avoids unavailable installers", () => {
    const html = renderToStaticMarkup(<ContributionEntry />);
    expect(html).toContain('aria-label="Copy download command"');
    expect(html).toContain('aria-label="PowerShell download command"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("pair the node with your account");
    expect(html).toContain("Installing alone doesn&#x27;t start earning.");
    expect(html).not.toContain("/downloads/linux");
  });
});
