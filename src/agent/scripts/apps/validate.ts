import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as z from "zod";
import { AppManifestSchema } from "../../packages/contracts/src/app-manifest.js";
import { checkAppUpdate, validateAppBundle } from "./bundle.js";

const usage = "npm run apps:validate -- <app.json> [--previous <old/app.json>] [--json]\n" +
  "npm run apps:validate -- --schema\nValidates a definition and its files, not runtime readiness or publication.";
const terminalText = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g,
  char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

export async function main(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") { console.log(usage); return 0; }
  if (args.length === 1 && args[0] === "--schema") {
    console.log(JSON.stringify(z.toJSONSchema(AppManifestSchema, { target: "draft-2020-12" }), null, 2));
    return 0;
  }
  let file: string | undefined, previous: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--json" && !json) json = true;
    else if (arg === "--previous" && !previous && args[i + 1] && !args[i + 1]!.startsWith("--")) previous = args[++i];
    else if (!arg.startsWith("--") && !file) file = arg;
    else { console.error(usage); return 2; }
  }
  if (!file) { console.error(usage); return 2; }
  const bundle = await validateAppBundle(file);
  const issues = bundle.ok ? (previous ? await checkAppUpdate(previous, bundle) : []) : bundle.issues;
  if (issues.length || !bundle.ok) {
    if (json) console.log(JSON.stringify({ ok: false, issues }));
    else for (const issue of issues) console.error(`${terminalText(issue.path)}: ${terminalText(issue.message)}`);
    return 1;
  }
  const result = {
    ok: true, appId: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest,
    checks: { definition: "passed", assets: "passed", previous: previous ? "passed" : "not-requested" },
    runtimeQualification: "not-run", authorization: "not-run", publication: "not-run",
  };
  console.log(json ? JSON.stringify(result) : `${result.appId}@${result.version}: definition valid (${result.digest}).\nRuntime qualification, authorization and publication: NOT RUN.`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
    console.error("App validation failed unexpectedly; no application was executed.");
    process.exitCode = 1;
  });
}
