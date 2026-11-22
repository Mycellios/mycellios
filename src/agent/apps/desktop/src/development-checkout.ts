import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { agentWorkspace } from "./development-copy.js";

export const DEVELOPMENT_CHECKOUT_FILE = "development-checkout.json";

/**
 * Like `bun run dev` in the reference app's worktree: an owner-chosen git checkout runs
 * in place with the dependencies it already has, instead of a fresh copy of the
 * bundled source that must install everything again. The owner names it in
 * `development-checkout.json` ({"schema":"mycellios-development-checkout/1","path":"..."}).
 */
export async function developmentCheckout(userData: string) {
  let value: { schema?: unknown; path?: unknown };
  try {
    value = JSON.parse(await readFile(path.join(userData, DEVELOPMENT_CHECKOUT_FILE), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Invalid development checkout preference.");
  }
  if (
    value?.schema !== "mycellios-development-checkout/1" ||
    typeof value.path !== "string" ||
    !path.isAbsolute(value.path)
  )
    throw new Error("Invalid development checkout preference.");
  const chosen = value.path;
  const root = await realpath(chosen).catch(() => {
    throw new Error("The development checkout no longer exists.");
  });
  // A worktree has a .git file, a main checkout a .git directory.
  if (!(await stat(path.join(root, ".git")).then(() => true, () => false)))
    throw new Error("The development checkout is not a git repository.");
  const workspace = await agentWorkspace(root);
  if (!(await stat(path.join(workspace, "node_modules/vite/package.json")).then((s) => s.isFile(), () => false)))
    throw new Error("Install the checkout's dependencies first: npm ci in src/agent.");
  const validate = async () => {
    if ((await realpath(chosen)) !== root) throw new Error("The development checkout moved.");
    await agentWorkspace(root);
  };
  return { root, workspace, validate, checkout: true as const };
}
