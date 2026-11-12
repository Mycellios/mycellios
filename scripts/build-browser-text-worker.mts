import {build} from "vite";
import {resolve} from "node:path";
// Focused local packaging check; no release artifact or live service is published.
await build({configFile:false,worker:{format:"es"},resolve:{conditions:["onnxruntime-web-use-extern-wasm","module","browser","development|production"]},build:{outDir:resolve(".cache/browser-text-worker-build"),emptyOutDir:true,
  lib:{entry:resolve("src/mobile/browser-text-work.ts"),formats:["es"],fileName:"browser-text"},target:"es2022",minify:false}});
