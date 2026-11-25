import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MIGRATION_HISTORY_COMMAND,
  MIGRATION_HISTORY_UNKNOWN_EXIT,
  SELF_HOST_APP_IMAGE,
  SELF_HOST_COMPUTER_IMAGE,
  UPSTREAM_IMAGE_OWNER,
} from "@mycellios/contracts";
import { legacyEnvName } from "@mycellios/core/legacy-env";
import { afterEach, describe, expect, it } from "vitest";

// install-images.sh against a fake Docker CLI and curl: no daemon, registry or network. The fakes
// log every call, serve this checkout's Compose files and play the migration check's exit status.
const composeDir = path.resolve(import.meta.dirname, "../../compose");
const installer = path.join(composeDir, "install-images.sh");
const IMAGE = legacyEnvName("IMAGE");
const IMAGE_TAG = legacyEnvName("IMAGE_TAG");
const COMPUTER_IMAGE = legacyEnvName("COMPUTER_IMAGE");
const COMPUTER_IMAGE_TAG = legacyEnvName("COMPUTER_IMAGE_TAG");
const UPSTREAM_APP = `${UPSTREAM_IMAGE_OWNER}legacy/app`;
const UPSTREAM_COMPUTER = `${UPSTREAM_IMAGE_OWNER}legacy/computer`;
const FILES = "https://raw.githubusercontent.com/Mycellios/mycellios";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SECRETS = [
  "POSTGRES_PASSWORD=p",
  "POSTGRES_APP_PASSWORD=a",
  "BETTER_AUTH_SECRET=b",
  "ENCRYPTION_KEY=e",
  "SCREEN_PROXY_SECRET=s",
  "SANDBOX_SUPERVISOR_TOKEN=t",
  "SANDBOX_COMPUTER_EGRESS=open",
];

const FAKE_DOCKER = `#!/usr/bin/env bash
images="$(env | grep -E '^[A-Z_]*IMAGE(_TAG)?=' | sort | tr '\\n' ' ')"
printf 'docker %s | %s\\n' "$*" "$images" >>"$STUB_LOG"
[[ "$1" == compose ]] || exit 0
shift
args=" $* "
case "$args" in
  *" version "*) echo "Docker Compose version v2.29.0"; exit 0 ;;
  *" up --help "*) printf '%s\\n' "  --pull string" "  --wait" "  --wait-timeout int"; exit 0 ;;
esac
if [[ "$args" == *" config "* ]]; then
  if [[ "$args" == *" --environment "* ]]; then
    cat >/dev/null
    printf '%s\\n' POSTGRES_PASSWORD=p POSTGRES_APP_PASSWORD=a BETTER_AUTH_SECRET=b \\
      ENCRYPTION_KEY=e SCREEN_PROXY_SECRET=s SANDBOX_SUPERVISOR_TOKEN=t
  elif [[ "$args" == *".next."* ]]; then
    echo "name: \${STUB_NEXT_PROJECT:-selfhost}"
  else
    echo "name: selfhost"
  fi
  exit 0
fi
if [[ "$args" == *" run "* ]]; then
  if [[ "\${STUB_CHECK_EXIT:-0}" == ${MIGRATION_HISTORY_UNKNOWN_EXIT} ]]; then
    echo "The database records 1 migration(s) this release does not ship:"
    echo "  29990101000000_from_another_release"
  fi
  exit "\${STUB_CHECK_EXIT:-0}"
fi
exit 0
`;

const FAKE_CURL = `#!/usr/bin/env bash
printf 'curl %s\\n' "$*" >>"$STUB_CURL_LOG"
if [[ " $* " == *" --help "* ]]; then echo "--retry-all-errors"; exit 0; fi
out="" url="" prev=""
for arg in "$@"; do
  [[ "$prev" == "-o" ]] && out="$arg"
  [[ "$arg" == https://* ]] && url="$arg"
  prev="$arg"
done
[[ -n "$out" ]] || exit 1
name="\${url##*/}"
if [[ -f "$STUB_FILES/$name" ]]; then cat "$STUB_FILES/$name" >"$out"; else : >"$out"; fi
printf '\\n# downloaded from %s\\n' "$url" >>"$out"
`;

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

interface Install {
  dir: string;
  status: number | null;
  output: string;
  docker: string[];
  curl: string[];
  env: () => string;
}

function workspace(files: Record<string, string> = {}) {
  root = mkdtempSync(path.join(tmpdir(), "mycellios-install-images-"));
  const bin = path.join(root, "bin");
  const dir = path.join(root, "install");
  const served = path.join(root, "served");
  mkdirSync(bin);
  mkdirSync(dir);
  mkdirSync(served);
  writeFileSync(path.join(bin, "docker"), FAKE_DOCKER);
  writeFileSync(path.join(bin, "curl"), FAKE_CURL);
  chmodSync(path.join(bin, "docker"), 0o755);
  chmodSync(path.join(bin, "curl"), 0o755);
  for (const name of ["docker-compose.images.yml", ".env.images.example"]) {
    copyFileSync(path.join(composeDir, name), path.join(served, name));
  }
  for (const [name, contents] of Object.entries(files))
    writeFileSync(path.join(dir, name), contents);
  return { bin, dir, served };
}

function install(
  setup: ReturnType<typeof workspace>,
  args: string[] = [],
  env: Record<string, string> = {},
): Install {
  const log = path.join(root, "docker.log");
  const curlLog = path.join(root, "curl.log");
  const inherited = { ...process.env };
  for (const name of ["MYCELLIOS_DOWNLOAD_BASE", legacyEnvName("DOWNLOAD_BASE")]) {
    delete inherited[name];
  }
  const result = spawnSync("bash", [installer, ...args], {
    cwd: setup.dir,
    input: "",
    encoding: "utf8",
    env: {
      ...inherited,
      PATH: `${setup.bin}${path.delimiter}${process.env.PATH ?? ""}`,
      STUB_LOG: log,
      STUB_CURL_LOG: curlLog,
      STUB_FILES: setup.served,
      SANDBOX_COMPUTER_EGRESS: "open",
      ...env,
    },
  });
  const lines = (file: string) =>
    existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  return {
    dir: setup.dir,
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    docker: lines(log),
    curl: lines(curlLog),
    env: () => readFileSync(path.join(setup.dir, ".env"), "utf8"),
  };
}

const downloads = (run: Install) =>
  run.curl
    .filter((line) => !line.includes("--help"))
    .map((line) => line.split(" ").find((arg) => arg.startsWith("https://")));
const composeCalls = (run: Install, verb: string) =>
  run.docker.filter((line) => line.split(" | ")[0]?.split(" ").includes(verb));
const upstreamEnv = (...extra: string[]) =>
  [
    ...SECRETS,
    `${IMAGE}=${UPSTREAM_APP}`,
    `${IMAGE_TAG}=edge`,
    `${COMPUTER_IMAGE}=${UPSTREAM_COMPUTER}`,
    `${COMPUTER_IMAGE_TAG}=edge`,
    ...extra,
    "",
  ].join("\n");
const UPSTREAM_COMPOSE = `name: selfhost\nservices:\n  api:\n    image: \${${IMAGE}:-${UPSTREAM_APP}}:edge\n`;

// Each case runs the real script and its helpers as processes, which is slow on Windows.
const SLOW = { timeout: 180_000 };

describe("install-images.sh defaults", SLOW, () => {
  it("installs edge from this repository's main branch and images", () => {
    const run = install(workspace());
    expect(run.status, run.output).toBe(0);
    expect(downloads(run)).toEqual([
      `${FILES}/main/src/agent/infra/compose/docker-compose.images.yml`,
      `${FILES}/main/src/agent/infra/compose/.env.images.example`,
    ]);
    expect(run.env()).toContain(`\n${IMAGE}=${SELF_HOST_APP_IMAGE}\n${IMAGE_TAG}=edge\n`);
    expect(run.env()).toContain(`\n${COMPUTER_IMAGE}=${SELF_HOST_COMPUTER_IMAGE}\n`);
    expect(composeCalls(run, "pull")).toHaveLength(1);
    expect(run.output).not.toContain("upstream");
  });

  it("installs a release from that release's files and pins its images", () => {
    const run = install(workspace(), ["--release", "v1.2.3"]);
    expect(run.status, run.output).toBe(0);
    expect(downloads(run)).toEqual([
      `${FILES}/v1.2.3/src/agent/infra/compose/docker-compose.images.yml`,
      `${FILES}/v1.2.3/src/agent/infra/compose/.env.images.example`,
    ]);
    expect(run.env()).toContain(`\n${IMAGE_TAG}=v1.2.3\n`);
    expect(run.env()).toContain(`\n${COMPUTER_IMAGE_TAG}=v1.2.3\n`);
    expect(run.env()).not.toContain(`${IMAGE_TAG}=edge`);
  });

  it("refuses a release name that is not a version tag", () => {
    for (const release of ["latest", "1.2.3", "desktop-v1.2.3-windows-preview"]) {
      const run = install(workspace(), ["--release", release]);
      expect(run.status, release).toBe(2);
      expect(run.curl).toEqual([]);
    }
  });

  it("upgrades an existing install from the files of the tag its .env pins", () => {
    const pinned = install(
      workspace({
        ".env": [
          ...SECRETS,
          `${IMAGE}=${SELF_HOST_APP_IMAGE}`,
          `${IMAGE_TAG}=sha-${COMMIT}`,
          "",
        ].join("\n"),
      }),
    );
    expect(pinned.status, pinned.output).toBe(0);
    expect(downloads(pinned)[0]).toBe(
      `${FILES}/${COMMIT}/src/agent/infra/compose/docker-compose.images.yml`,
    );
    expect(pinned.env()).toContain(`${IMAGE_TAG}=sha-${COMMIT}`);
  });

  it("refuses a tag this repository does not publish unless a download base is named", () => {
    const env = [...SECRETS, `${IMAGE_TAG}=latest`, ""].join("\n");
    const refused = install(workspace({ ".env": env }));
    expect(refused.status).toBe(1);
    expect(refused.output).toContain(`${IMAGE_TAG}=latest is not a tag this repository publishes`);
    expect(refused.curl).toEqual([]);

    const mirrored = install(workspace({ ".env": env }), [], {
      MYCELLIOS_DOWNLOAD_BASE: "https://mirror.example/compose/",
    });
    expect(mirrored.status, mirrored.output).toBe(0);
    expect(downloads(mirrored)).toEqual([
      "https://mirror.example/compose/docker-compose.images.yml",
      "https://mirror.example/compose/.env.images.example",
    ]);
  });
});

describe("install-images.sh on an install that runs the upstream images", SLOW, () => {
  const upstreamFiles = (...extra: string[]) => ({
    ".env": upstreamEnv(...extra),
    "docker-compose.images.yml": UPSTREAM_COMPOSE,
    ".env.images.example": "# upstream example\n",
  });

  it("keeps them and the matching Compose files, and says how to move", () => {
    const setup = workspace(upstreamFiles());
    const run = install(setup);
    expect(run.status, run.output).toBe(0);
    expect(run.curl).toEqual([]);
    expect(run.output).toContain("--move-images");
    expect(run.env()).toBe(upstreamEnv());
    expect(readFileSync(path.join(run.dir, "docker-compose.images.yml"), "utf8")).toBe(
      UPSTREAM_COMPOSE,
    );
    expect(composeCalls(run, "run")).toEqual([]);
    // Pulling the images the owner's .env names is their own configuration, not a default.
    expect(composeCalls(run, "pull")).toHaveLength(1);
  });

  it("detects them through the Compose file's default when .env names no image", () => {
    const setup = workspace({ ...upstreamFiles(), ".env": [...SECRETS, ""].join("\n") });
    const run = install(setup);
    expect(run.status, run.output).toBe(0);
    expect(run.curl).toEqual([]);
    expect(run.output).toContain("--move-images");
  });

  it("records --keep-images once, so the offer is not repeated", () => {
    const setup = workspace(upstreamFiles());
    const kept = install(setup, ["--keep-images"]);
    expect(kept.status, kept.output).toBe(0);
    expect(kept.env()).toBe(`${upstreamEnv()}MYCELLIOS_IMAGE_MOVE=declined\n`);
    // The answer is for the installer and the updater, never a setting a container misses.
    expect(kept.output).not.toMatch(/no container receives[^\n]*MYCELLIOS_IMAGE_MOVE/);

    const again = install(setup);
    expect(again.status, again.output).toBe(0);
    expect(again.output).toContain("as recorded in .env");
    expect(again.output).not.toContain("--move-images");
    expect(again.env()).toBe(`${upstreamEnv()}MYCELLIOS_IMAGE_MOVE=declined\n`);
  });

  it("refuses --release without moving", () => {
    const run = install(workspace(upstreamFiles()), ["--release", "v1.2.3"]);
    expect(run.status).toBe(1);
    expect(run.output).toContain("--move-images");
    expect(run.env()).toBe(upstreamEnv());
  });

  it("moves to this repository's images once the migration check passes", () => {
    const setup = workspace(upstreamFiles("MYCELLIOS_IMAGE_MOVE=declined"));
    const run = install(setup, ["--move-images"]);
    expect(run.status, run.output).toBe(0);
    expect(downloads(run)).toEqual([
      `${FILES}/main/src/agent/infra/compose/docker-compose.images.yml`,
      `${FILES}/main/src/agent/infra/compose/.env.images.example`,
    ]);
    const target = `${IMAGE}=${SELF_HOST_APP_IMAGE} ${IMAGE_TAG}=edge`;
    const [pullApi, ...laterPulls] = composeCalls(run, "pull");
    expect(pullApi).toMatch(/ pull api \| /);
    expect(pullApi).toContain(target);
    const [database, stack] = composeCalls(run, "up").filter((line) => !line.includes("--help"));
    expect(database).toContain("up -d --wait --wait-timeout 120 postgres");
    expect(database).toContain(target);
    const [check] = composeCalls(run, "run");
    expect(check).toContain(`run --rm --no-deps -T api ${MIGRATION_HISTORY_COMMAND.join(" ")} |`);
    expect(check).toContain(target);
    // The check runs before anything is replaced, then the whole stack starts on the new images.
    expect(run.docker.indexOf(check!)).toBeLessThan(run.docker.indexOf(stack!));
    expect(laterPulls).toHaveLength(1);
    expect(stack).not.toContain("postgres |");

    const env = run.env();
    expect(env).toContain(`${IMAGE}=${SELF_HOST_APP_IMAGE}\n`);
    expect(env).toContain(`${COMPUTER_IMAGE}=${SELF_HOST_COMPUTER_IMAGE}\n`);
    expect(env).not.toContain(UPSTREAM_IMAGE_OWNER);
    for (const secret of SECRETS) expect(env).toContain(`${secret}\n`);
    expect(readFileSync(path.join(run.dir, "docker-compose.images.yml"), "utf8")).toContain(
      `# downloaded from ${FILES}/main/`,
    );
    expect(
      readdirSync(run.dir).filter((name) => name.includes(".next.") || name.includes(".tmp.")),
    ).toEqual([]);
  });

  it("moves to a named release", () => {
    const run = install(workspace(upstreamFiles()), ["--move-images", "--release", "v2.0.0"]);
    expect(run.status, run.output).toBe(0);
    expect(downloads(run)[0]).toBe(
      `${FILES}/v2.0.0/src/agent/infra/compose/docker-compose.images.yml`,
    );
    expect(composeCalls(run, "run")[0]).toContain(`${IMAGE_TAG}=v2.0.0`);
    expect(run.env()).toContain(`${IMAGE_TAG}=v2.0.0\n`);
    expect(run.env()).toContain(`${COMPUTER_IMAGE_TAG}=v2.0.0\n`);
  });

  it("refuses the move when the database records a migration the release lacks", () => {
    const setup = workspace(upstreamFiles());
    const run = install(setup, ["--move-images"], {
      STUB_CHECK_EXIT: String(MIGRATION_HISTORY_UNKNOWN_EXIT),
    });
    expect(run.status).toBe(1);
    expect(run.output).toContain("29990101000000_from_another_release");
    expect(run.output).toContain("the move was refused: the database records migrations");
    expect(run.env()).toBe(upstreamEnv());
    expect(readFileSync(path.join(run.dir, "docker-compose.images.yml"), "utf8")).toBe(
      UPSTREAM_COMPOSE,
    );
    expect(readFileSync(path.join(run.dir, ".env.images.example"), "utf8")).toBe(
      "# upstream example\n",
    );
    expect(
      readdirSync(run.dir).filter((name) => name.includes(".next.") || name.includes(".tmp.")),
    ).toEqual([]);
    // Only the database was started for the check; the stack was never brought up on new images.
    expect(composeCalls(run, "up").filter((line) => !line.includes("--help"))).toHaveLength(1);
  });

  it("refuses the move when the migrations cannot be checked", () => {
    const run = install(workspace(upstreamFiles()), ["--move-images"], { STUB_CHECK_EXIT: "1" });
    expect(run.status).toBe(1);
    expect(run.output).toContain("could not be checked");
    expect(run.env()).toBe(upstreamEnv());
  });

  it("refuses a move that would change the Compose project and start an empty database", () => {
    const run = install(workspace(upstreamFiles()), ["--move-images"], {
      STUB_NEXT_PROJECT: "other",
    });
    expect(run.status).toBe(1);
    expect(run.output).toContain("Compose project is selfhost");
    expect(composeCalls(run, "pull")).toEqual([]);
    expect(run.env()).toBe(upstreamEnv());
  });
});
