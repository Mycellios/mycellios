const fs = require("node:fs");
const path = require("node:path");
const { buildSync } = require("esbuild");
const manifestPath = process.env.FIRST_PARTY_CLIENTS_PATH;
if (!/^\/oauth\/consent-assets\/clients-[a-f0-9]{16}\.json$/.test(manifestPath || ""))
  throw new Error("A deployment-owned first-party client manifest is required");
const outdir = process.env.LOGIN_OUT_DIR;
if (!outdir || !path.isAbsolute(outdir))
  throw new Error("An absolute output directory is required");
const result = buildSync({
  entryPoints: [path.join(__dirname, "entry.tsx")],
  outdir,
  entryNames: "login-[hash]",
  bundle: true,
  minify: true,
  format: "esm",
  jsx: "automatic",
  loader: { ".woff2": "file", ".png": "dataurl" },
  assetNames: "[name]-[hash]",
  metafile: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    __FIRST_PARTY_CLIENTS_PATH__: JSON.stringify(manifestPath),
  },
});
const files = Object.keys(result.metafile.outputs).map((p) => path.basename(p));
fs.writeFileSync(path.join(outdir, "build.json"), JSON.stringify({ files, manifestPath }, null, 2));
