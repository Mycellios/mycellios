/** Read-only evidence for the owned disposable loopback qualifier, never a customer database. */
import {readFile} from "node:fs/promises";
import {resolve,dirname,basename} from "node:path";
import {tmpdir} from "node:os";
import postgres from "postgres";
import {browserTextModel} from "../src/contracts/browser-text.js";
const preview=JSON.parse(await readFile(".cache/browser-inference-preview.json","utf8"));
const cluster=resolve(preview.cluster);
if(preview.testOnly!==true||resolve(dirname(cluster))!==resolve(tmpdir())||!basename(cluster).startsWith("mycellios-browser-inference-pg-"))
  throw new Error("Not the owned local test cluster");
const port=Number((await readFile(resolve(cluster,"postmaster.pid"),"utf8")).split(/\r?\n/)[3]);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("Invalid local test port");
const sql=postgres(`postgresql://postgres@127.0.0.1:${port}/postgres`,{max:1});
try{
  const grants=await sql.unsafe("SELECT reason FROM browser_qualification.economic_promotional_grants WHERE account_id='test-buyer'");
  if(grants.length!==1||grants[0]!.reason!=="fictional-no-cash")throw new Error("Expected fictional qualifier balance only");
  const requests=await sql.unsafe(`SELECT p.usage_id,p.model,p.state,p.upstream_microunits,p.fee_microunits,p.total_microunits,
    p.settled_at-p.created_at AS duration_ms,p.response_json,c.amount_microunits AS earned_microunits
    FROM browser_qualification.economic_managed_purchases p LEFT JOIN browser_qualification.economic_browser_inference_credits c ON c.usage_id=p.usage_id
    ORDER BY p.created_at`);
  const proof=await(await fetch("http://127.0.0.1:5197/__browser-inference-test/proof")).json();
  console.log(JSON.stringify({testOnly:true,model:{id:browserTextModel.id,revision:browserTextModel.revision,graphSha256:browserTextModel.files["model.onnx"].sha256,
    backend:"browser-cpu-wasm",verification:"independent-coordinator-cpu-wasm"},requests:requests.map(r=>({...r,response:r.response_json?JSON.parse(String(r.response_json)):null,response_json:undefined})),proof},null,2));
}finally{await sql.end();}
