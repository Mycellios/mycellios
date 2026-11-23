export type ReleaseProduct = "desktop" | "agent";
export type ReleaseFilter = "all" | ReleaseProduct;
export type ChangeKind = "New" | "Improved" | "Fixed" | "Removed" | "Security";

export interface ChangelogRelease {
  id: string;
  product: ReleaseProduct;
  date: string;
  version: string;
  platform: string;
  title: string;
  summary: string;
  channel: "Preview" | "Web update";
  groups: readonly { kind: ChangeKind; items: readonly string[] }[];
  updateNote: string;
  sourceUrl: string;
}

/** Hand-written notes for publications that predate src/agent/CHANGELOG.md. Dates refer to the linked publication. */
export const CURATED_RELEASES: readonly ChangelogRelease[] = [
  {
    id: "desktop-0-3-11-windows",
    product: "desktop",
    date: "2026-11-02",
    version: "0.3.11",
    platform: "Windows",
    title: "Your project, beside the conversation.",
    summary: "A project preview inside Desktop brings the work and the conversation into the same view.",
    channel: "Preview",
    groups: [
      { kind: "New", items: ["Start and stop project service profiles from the preview beside your chat.", "Select elements in the project preview and prepare annotation drafts."] },
      { kind: "Improved", items: ["First-time project preparation runs in the background, keeping setup instructions out of the main conversation.", "The Windows package includes runtime 0.2.124 and keeps your existing account, chat and project profile."] },
      { kind: "Fixed", items: ["The package retains the native image-generation repair from the existing application."] },
    ],
    updateNote: "Install the Windows preview manually. The installer is unsigned and automatic unsigned updates remain disabled. Compute contribution still requires a separate account grant and permission.",
    sourceUrl: "https://github.com/Mycellios/mycellios/releases/tag/desktop-v0.3.11-windows-preview",
  },
  {
    id: "desktop-0-3-9-apple-silicon",
    product: "desktop",
    date: "2026-11-02",
    version: "0.3.9",
    platform: "Apple Silicon",
    title: "Mycellios takes root on your Mac.",
    summary: "The Apple Silicon Desktop preview brings the workspace to Macs with an M1 chip or later.",
    channel: "Preview",
    groups: [
      { kind: "New", items: ["A macOS Desktop preview with the existing ARM64 contribution runtime 0.2.95 included.", "Sign in with your usual Mycellios account; the account provider does not require a separate API key."] },
      { kind: "Improved", items: ["Project access and joining the compute network keep their explicit permissions."] },
    ],
    updateNote: "Choose the matching Mac download and drag the app to Applications. This is a non-notarized preview with manual updates. Runtime installation checks do not establish physical Mac inference support.",
    sourceUrl: "https://github.com/Mycellios/mycellios/releases/tag/desktop-v0.3.9-apple-silicon-preview",
  },
  {
    id: "desktop-0-3-9-fedora",
    product: "desktop",
    date: "2026-10-31",
    version: "0.3.9",
    platform: "Fedora",
    title: "A native package for Fedora.",
    summary: "A Fedora x86_64 RPM joins the Desktop preview, with the dependencies and integration expected on your system.",
    channel: "Preview",
    groups: [
      { kind: "New", items: ["Install Mycellios Desktop with an RPM package for Fedora x86_64.", "Fedora dependencies and desktop integration are included in the package."] },
      { kind: "Improved", items: ["The bundled runtime can be extracted with hash verification without requiring Debian package tools.", "Existing node identities are preserved; installing Desktop does not enroll or start a contribution node."] },
    ],
    updateNote: "Use the Fedora RPM from Desktop downloads. Contribution enrollment remains a separate signed-in action with system approval; real enrollment was not established by the packaging checks.",
    sourceUrl: "https://github.com/Mycellios/mycellios/releases/tag/desktop-v0.3.9-fedora-preview",
  },
  {
    id: "agent-credits-micos",
    product: "agent",
    date: "2026-10-31",
    version: "Web update",
    platform: "Web & Agent",
    title: "Clearer names. A steadier balance.",
    summary: "Micos are your agents. Credits are your internal balance. Spore remains the separate token concept.",
    channel: "Web update",
    groups: [
      { kind: "Improved", items: ["The workspace uses Mico and Micos for agents, and Credits for the internal account balance.", "The central sign-in and Agent wordmark use the Mycellios name."] },
      { kind: "Fixed", items: ["Credit reads retry transient failures and retain the last verified amount only for the same account, with a stale indicator.", "An unavailable balance stays visibly unavailable instead of being replaced with an invented zero."] },
    ],
    updateNote: "These are interface and recovery changes. They do not change account balances, activate Spore or introduce contributor payouts.",
    sourceUrl: "https://github.com/Mycellios/mycellios/blob/main/docs/STATUS_AND_EVIDENCE.md#agent-balance-recovery-and-window-controls--2026-10-31",
  },
];

export const CHANGELOG_FILTERS = [
  { id: "all", label: "All updates" },
  { id: "desktop", label: "Desktop" },
  { id: "agent", label: "Web & Agent" },
] as const;

export function releaseFilterFor(search: string): ReleaseFilter {
  const value = new URLSearchParams(search).get("product");
  return value === "desktop" || value === "agent" ? value : "all";
}

export function releasesFor(releases: readonly ChangelogRelease[], filter: ReleaseFilter): readonly ChangelogRelease[] {
  return filter === "all" ? releases : releases.filter(release => release.product === filter);
}

const CHANGELOG_SOURCE = "https://github.com/Mycellios/mycellios/blob/main/src/agent/CHANGELOG.md";
// Upgrade notes for self-hosters stay in the source file; they are not product changes.
const KIND_ORDER: readonly ChangeKind[] = ["New", "Improved", "Fixed", "Removed", "Security"];
const SECTION_KINDS:Readonly<Record<string, ChangeKind>> = { Added: "New", Changed: "Improved", Fixed: "Fixed", Removed: "Removed", Security: "Security", "Breaking changes": "Improved" };

/** Plain text for a Keep a Changelog bullet: no Markdown links, code ticks or emphasis. */
function plainChangelogText(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\s+/g, " ").trim();
}

/**
 * Desktop releases from src/agent/CHANGELOG.md, the file the daily release
 * workflow writes when it cuts a version. Unreleased notes are left out.
 */
export function desktopReleasesFromChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: { version: string; date: string; groups: Map<ChangeKind, string[]> } | null = null;
  let kind: ChangeKind | null = null;
  let item: string[] | null = null;
  const closeItem = () => { if (release && kind && item) release.groups.get(kind)!.push(plainChangelogText(item.join(" "))); item = null; };
  const closeRelease = () => {
    closeItem();
    if (!release) return;
    const groups = KIND_ORDER.flatMap(groupKind => release!.groups.get(groupKind)?.length ? [{ kind: groupKind, items: release!.groups.get(groupKind)! }] : []);
    const count = groups.reduce((total, group) => total + group.items.length, 0);
    if (count) releases.push({
      id: `desktop-${release.version.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
      product: "desktop",
      date: release.date,
      version: release.version,
      platform: "Desktop & web",
      title: "",
      summary: `${count} ${count === 1 ? "change" : "changes"} to Mycellios Agent and the Desktop app.`,
      channel: "Preview",
      groups,
      updateNote: "Get the current preview from Desktop downloads; Agent on the web updates by itself. Desktop packages are unsigned or not notarized previews, so updates are installed manually.",
      sourceUrl: `${CHANGELOG_SOURCE}#${`${release.version} - ${release.date}`.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-")}`,
    });
    release = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (heading) {
      closeRelease();
      kind = null;
      if (heading[2] && heading[1] !== "Unreleased") release = { version: heading[1]!, date: heading[2], groups: new Map() };
      continue;
    }
    const section = /^### (.+?)\s*$/.exec(line);
    if (section) {
      closeItem();
      kind = SECTION_KINDS[section[1]!] ?? null;
      if (release && kind && !release.groups.has(kind)) release.groups.set(kind, []);
      continue;
    }
    if (!release || !kind) continue;
    const bullet = /^- (.*)$/.exec(line);
    if (bullet) { closeItem(); item = [bullet[1]!]; } else if (item && /^\s+\S/.test(line)) item.push(line.trim()); else if (!line.trim()) closeItem();
  }
  closeRelease();
  return releases;
}

const versionParts = (version: string) => version.split(/[.-]/).map(part => Number(part) || 0);
function compareVersionsDescending(a: string, b: string): number {
  const left = versionParts(a), right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** Newest first; releases on the same day are ordered by version. */
export function changelogReleases(changelogMarkdown: string): ChangelogRelease[] {
  return [...desktopReleasesFromChangelog(changelogMarkdown), ...CURATED_RELEASES]
    .sort((a, b) => b.date.localeCompare(a.date) || (a.product === b.product ? compareVersionsDescending(a.version, b.version) : 0));
}
