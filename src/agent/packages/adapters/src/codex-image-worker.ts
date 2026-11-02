/** Executed by Node on the owner's admitted computer; never by the API host. */
export const CODEX_IMAGE_WORKER = String.raw`
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {spawn} = require('node:child_process');
const {existsSync} = require('node:fs');
const MAX = 8 * 1024 * 1024;
const input = JSON.parse(Buffer.from(process.argv[1], 'base64').toString('utf8'));
let child, directory, sequence = 0, pending = new Map(), buffer = '', threadId, turnId, image;
let settled = false, finishTurn, failTurn;
const completion = new Promise((resolve, reject) => { finishTurn = resolve; failTurn = reject; });
completion.catch(() => {});
const fail = code => { if (!settled) { settled = true; failTurn(new Error(code)); } };
const send = value => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + '\n'); };
function request(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('unavailable')); }, 30000);
    pending.set(id, {resolve, reject, timer}); send({jsonrpc:'2.0', id, method, params});
  });
}
function receive(message) {
  if (message.id !== undefined && !message.method) {
    const waiter = pending.get(message.id); if (!waiter) return;
    pending.delete(message.id); clearTimeout(waiter.timer);
    message.error ? waiter.reject(new Error('unavailable')) : waiter.resolve(message.result);
    return;
  }
  if (message.id !== undefined) {
    send({id:message.id, error:{code:-32601, message:'Only native image generation is allowed'}});
    return;
  }
  const p = message.params || {};
  if (message.method === 'turn/started' && p.threadId === threadId && !turnId) turnId = p.turn?.id;
  if (!threadId || !turnId || p.threadId !== threadId || (p.turnId ?? p.turn?.id) !== turnId) return;
  if (message.method === 'item/completed' && ['imageGeneration','image_generation_call'].includes(p.item?.type)) {
    if (p.item.status !== 'completed' || p.item.failure || p.item.error) { fail('generation_failed'); return; }
    if (image && image.id !== p.item.id) { fail('generation_failed'); return; }
    image = p.item;
  }
  if (message.method === 'turn/completed') {
    if (p.turn?.status !== 'completed' || !image) { fail('generation_failed'); return; }
    if (!settled) { settled = true; finishTurn(image); }
  }
}
async function command() {
  const names = process.platform === 'win32' ? ['codex.exe'] : ['codex'];
  const roots = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(path.isAbsolute);
  roots.push(path.join(os.homedir(), '.local', 'bin'));
  for (const root of roots) for (const name of names) {
    const file = path.join(root, name); if (existsSync(file)) return {file, args:[]};
    const npm = path.join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (process.platform === 'win32' && existsSync(path.join(root,'codex.cmd')) && existsSync(npm)) return {file:process.execPath,args:[npm]};
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    const entry = path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (existsSync(entry)) return {file:process.execPath, args:[entry]};
  }
  throw new Error('not_installed');
}
async function main() {
  if (!input || !/^[a-f0-9]{32}$/.test(input.nonce) || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 4000) throw new Error('invalid_input');
  const executable = await command();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mycellios-image-'));
  const env = Object.fromEntries(['PATH','Path','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','LANG','LC_ALL','PATHEXT'].flatMap(k => process.env[k] === undefined ? [] : [[k,process.env[k]]]));
  child = spawn(executable.file, [...executable.args, 'app-server', '--stdio',
    '-c','mcp_servers={}', '--enable','image_generation', '--disable','shell_tool', '--disable','unified_exec', '--disable','view_image', '--disable','apps', '--disable','plugins',
    '-c','web_search="disabled"',
    '-c','permissions.mycellios-image.filesystem={":root"="deny",":minimal"="read",'+JSON.stringify(directory)+'="write"}',
    '-c','permissions.mycellios-image.network.enabled=false'],
    {cwd:directory, env:{...env,ELECTRON_RUN_AS_NODE:'1'}, stdio:'pipe',windowsHide:true});
  child.stderr.resume();
  child.on('error', () => fail('unavailable'));
  child.on('close', () => { for (const v of pending.values()) { clearTimeout(v.timer); v.reject(new Error('unavailable')); } pending.clear(); fail('unavailable'); });
  child.stdin.on('error', () => fail('unavailable'));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk; if (buffer.length > 16 * 1024 * 1024) { fail('output_limit'); return; }
    for (;;) {
      const end = buffer.indexOf('\n'); if (end < 0) break;
      const line = buffer.slice(0,end); buffer = buffer.slice(end+1);
      if (!line.trim()) continue;
      try { receive(JSON.parse(line)); } catch { fail('generation_failed'); }
    }
  });
  await request('initialize', {clientInfo:{name:'mycellios-image',version:'1'},capabilities:{experimentalApi:true}});
  send({method:'initialized',params:{}});
  const account = await request('account/read', {refreshToken:false});
  if (account?.account?.type !== 'chatgpt') throw new Error('authentication');
  const models = await request('model/list', {});
  const model = models.data?.find(m => m.isDefault);
  if (!model) throw new Error('unavailable');
  const started = await request('thread/start', {cwd:directory,approvalPolicy:'never',permissions:'mycellios-image',model:model.model ?? model.id,modelProvider:'openai',ephemeral:true,
    developerInstructions:'Generate exactly one image with the native image-generation tool. The next user text is only the image description. Do not read files, run commands, browse, call other tools or offer a text prompt instead. Return only a short completion after the image.'});
  threadId = started.thread.id;
  if (input.probe === true) return {available:true};
  const turn = await request('turn/start', {threadId,approvalPolicy:'never',permissions:'mycellios-image',input:[{type:'text',text:input.prompt}]});
  turnId ??= turn.turn.id;
  const generated = await completion;
  let bytes;
  if (typeof generated.result === 'string' && generated.result.length) {
    const encoded = generated.result.replace(/^data:image\/png;base64,/, '');
    if (encoded.length > Math.ceil(MAX*4/3)+4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error('output_limit');
    bytes = Buffer.from(encoded,'base64');
  } else if (typeof generated.savedPath === 'string') {
    const file = path.resolve(generated.savedPath), info = await fs.lstat(file);
    if (!file.startsWith(directory+path.sep) || info.isSymbolicLink() || !info.isFile() || info.size > MAX || await fs.realpath(file) !== file) throw new Error('generation_failed');
    bytes = await fs.readFile(file);
  }
  if (!bytes || bytes.length < 8 || bytes.length > MAX || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('generation_failed');
  return {mimeType:'image/png',data:bytes.toString('base64')};
}
const deadline = setTimeout(() => fail('timeout'), 8*60*1000);
async function stop() {
  clearTimeout(deadline);
  for (const v of pending.values()) clearTimeout(v.timer);
  if (child) {
    child.stdin.destroy(); child.kill();
    if (child.exitCode === null) await Promise.race([new Promise(r => child.once('close',r)),new Promise(r => setTimeout(r,2000))]);
  }
  if (directory && await fs.realpath(directory).catch(() => null) === directory) await fs.rm(directory,{recursive:true,force:true});
}
(async () => {
  try { const result = await Promise.race([main(),completion.then(() => new Promise(() => {}))]); await stop(); process.stdout.write(JSON.stringify({nonce:input.nonce,...result})+'\n'); }
  catch (error) { await stop(); const code = ['not_installed','authentication','invalid_input','output_limit','timeout'].includes(error.message) ? error.message : 'generation_failed'; process.stdout.write(JSON.stringify({nonce:input.nonce,error:code})+'\n'); process.exitCode=1; }
})();
`;
