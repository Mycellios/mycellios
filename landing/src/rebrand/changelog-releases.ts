import agentChangelog from "virtual:agent-changelog";
import { changelogReleases } from "../../../src/contracts/marketing-changelog";

/** The latest releases from the same CHANGELOG.md that the Desktop release workflow writes. */
export const CHANGELOG_RELEASES = changelogReleases(agentChangelog);
export const FULL_CHANGELOG_URL = "https://github.com/Mycellios/mycellios/blob/main/src/agent/CHANGELOG.md";
