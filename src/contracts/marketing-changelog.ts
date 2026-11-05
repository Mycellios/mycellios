export type ReleaseProduct = "desktop" | "agent";
export type ReleaseFilter = "all" | ReleaseProduct;

export interface ChangelogRelease {
  id: string;
  product: ReleaseProduct;
  date: string;
  version: string;
  platform: string;
  title: string;
  summary: string;
  channel: "Preview" | "Web update";
  groups: readonly { kind: "New" | "Improved" | "Fixed"; items: readonly string[] }[];
  updateNote: string;
  sourceUrl: string;
}

/** Curated published updates. Dates refer to the linked publication, not local build time. */
export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = [
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

export function releasesFor(filter: ReleaseFilter): readonly ChangelogRelease[] {
  return filter === "all" ? CHANGELOG_RELEASES : CHANGELOG_RELEASES.filter(release => release.product === filter);
}
