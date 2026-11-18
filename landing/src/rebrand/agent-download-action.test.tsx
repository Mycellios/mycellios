import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentDownloadAction, downloadPlatforms, suggestedDownload } from "./AgentDownloadAction";
import { AgentProductHero } from "./AgentProductHero";

describe("landing download action", () => {
  it.each([
    ["Windows NT 10.0; Win64; x64", "windows-x64"],
    ["X11; Linux x86_64", "linux-x64"],
    ["Macintosh; Intel Mac OS X", undefined],
    ["Linux; Android 15", undefined],
    ["iPhone; CPU iPhone OS", undefined],
    ["unknown", undefined],
  ])("suggests a safe installer for %s without guessing Mac CPU", (platform, expected) => {
    expect(suggestedDownload(platform).id).toBe(expected);
  });
  it("keeps a usable fallback before the catalog loads and a labelled platform control", () => {
    const html = renderToStaticMarkup(<AgentDownloadAction />);
    expect(html).toContain('href="/downloads/desktop"');
    expect(html).toContain('aria-label="Choose a download platform"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("/releases/");
  });
  it("lists both Mac installers by name, desktop systems first and phone apps after", () => {
    expect(downloadPlatforms.map(p => p.label)).toEqual(["macOS · Apple silicon", "macOS · Intel", "Windows", "Linux · DEB", "Linux · RPM"]);
    const html = renderToStaticMarkup(<AgentDownloadAction />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("agent-download-alternative");
  });
  it("replaces the three feature columns while preserving browser and network entry", () => {
    const html = renderToStaticMarkup(<AgentProductHero header={null} />);
    expect(html).not.toContain("agent-product-benefits");
    expect(html).toContain("agent-download-split");
    expect(html).toContain('href="https://www.mycellios.com/agent"');
    expect(html).toContain('href="#join-network"');
  });
});
