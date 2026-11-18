// npm run dev:seed: fills this checkout's isolated Mycellios Dev account with realistic data.
// Entities go through the normal authenticated API; history is written with the app's own
// database client (content encryption included), so nothing is queued and no model runs.
import {randomUUID} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDb, createThreadMessage, runAsSystem} from '@rakazo/db';
import {developmentIdentity} from './desktop-dev-state.mjs';
import {
  ARCHIVED_BOT, SEED_APP, SEED_BOTS, SEED_CONVERSATIONS, SEED_FILES, SEED_GROUP, SEED_MARKER,
  SEED_ROUTINES, SEED_SCRATCHPAD, SEED_SECTIONS, SEED_SPACE, SEED_TICKETS, SEED_USAGE, SEED_VERSION,
  SeedUsageError, generatedBots, generatedHistory, parseSeedArguments, seedCounts,
} from './desktop-dev-seed-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_EMAIL = 'developer@mycellios.invalid';
const MINUTE_MS = 60_000;

type Json = Record<string, unknown>;
type Row = {at: number; role: 'user' | 'bot' | 'system'; bot?: string; blocks: Json[]; run?: string; runError?: string;
  replyTo?: number; replyQuote?: string; pin?: boolean; react?: string; unread?: boolean; routine?: boolean};
type Prisma = ReturnType<typeof createDb>['prisma'];

async function readJson<T>(file: string): Promise<T | undefined> {
  try {return JSON.parse(await readFile(file, 'utf8')) as T;}
  catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error;}
}

export async function developmentProfile() {
  const identity = await developmentIdentity(root);
  const base = process.env.MYCELLIOS_DEV_HOME || path.join(os.homedir(), '.mycellios', 'development');
  return {id: identity.id, path: path.join(base, identity.id)};
}

/** The running stack's web origin, confirmed through its authorized control port. */
async function runningStack(profile: string): Promise<string | undefined> {
  const record = await readJson<{id: string; control: number; token: string; web?: string}>(path.join(profile, 'stack.json'));
  if (!record?.web || !Number.isInteger(record.control)) return undefined;
  try {
    const response = await fetch(`http://127.0.0.1:${record.control}/status`, {method: 'POST',
      headers: {authorization: `Bearer ${record.token}`}, redirect: 'error', signal: AbortSignal.timeout(1500)});
    if (!response.ok || ((await response.json()) as {id?: string}).id !== record.id) return undefined;
  } catch {return undefined;}
  const web = new URL(record.web);
  if (web.protocol !== 'http:' || web.hostname !== '127.0.0.1') throw Error('El registro de Mycellios Dev no es local.');
  return web.origin;
}

class ApiError extends Error {
  constructor(route: string, readonly status: number, body: string) {
    super(`${route} falló (${status}): ${body.slice(0, 300)}`);
  }
}

class Api {
  constructor(readonly origin: string, readonly cookie: string) {}
  async call<T = Json>(route: string, input: unknown = {}): Promise<T> {
    const response = await fetch(`${this.origin}/rpc/${route}`, {method: 'POST', redirect: 'error',
      headers: {'content-type': 'application/json', origin: this.origin, cookie: this.cookie},
      body: JSON.stringify({json: input}), signal: AbortSignal.timeout(30_000)});
    const body = await response.text();
    if (!response.ok) throw new ApiError(route, response.status, body);
    return (JSON.parse(body) as {json: T}).json;
  }
}

async function signIn(origin: string, profile: string) {
  const account = await readJson<{email: string; password: string}>(path.join(profile, 'account.json'));
  if (account?.email !== DEV_EMAIL) throw Error('Este perfil no tiene la cuenta aislada de desarrollo. Arranca npm run dev:desktop primero.');
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {method: 'POST', redirect: 'error',
    headers: {'content-type': 'application/json', origin}, body: JSON.stringify(account), signal: AbortSignal.timeout(10_000)});
  if (!response.ok) throw Error(`No se pudo iniciar sesión con la cuenta de desarrollo (${response.status}).`);
  const user = ((await response.json()) as {user?: {id: string; email: string}}).user;
  if (user?.email !== DEV_EMAIL) throw Error('La sesión no es la de la cuenta de desarrollo.');
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  return {user, api: new Api(origin, cookie)};
}

/** The runtime role and content key the local server itself uses for this profile. */
async function profileDatabase(profile: string) {
  const data = path.join(profile, 'data');
  const identity = await readJson<{appPassword: string; encryptionKey: string}>(path.join(data, 'identity.json'));
  const pid = await readFile(path.join(data, 'postgres', 'postmaster.pid'), 'utf8').catch(() => '');
  const port = Number(pid.split(/\r?\n/)[3]);
  if (!identity || !Number.isInteger(port) || port < 1024) throw Error('La base de datos local de Mycellios Dev no está arrancada.');
  process.env.ENCRYPTION_KEY = identity.encryptionKey;
  process.env.CONTENT_ENCRYPTION = 'on';
  return createDb(`postgresql://rakazo_local:${identity.appPassword}@127.0.0.1:${port}/rakazo`, {applicationName: 'dev-seed'});
}

type BotRow = {id: string; name: string; threadId: string};

async function seedEntities(api: Api, userId: string, scale: {bots: number}) {
  const bots = new Map<string, BotRow>();
  const profile = (bot: typeof SEED_BOTS[number] | typeof ARCHIVED_BOT) => ({
    name: bot.name, title: bot.title, description: bot.description, instructions: bot.description,
    avatarFamily: bot.avatarFamily, notifyOnFinish: true, expectedUserId: userId, spawnKey: `dev-seed-v${SEED_VERSION}-${bot.key}`,
  });
  for (const bot of [...SEED_BOTS, ...generatedBots(scale.bots)])
    bots.set(bot.key, await api.call<BotRow>('bots/createProfile', profile(bot)));
  const archived = await api.call<BotRow>('bots/createProfile', profile(ARCHIVED_BOT));
  await api.call('bots/archive', {botId: archived.id});

  for (const section of SEED_SECTIONS) {
    const created = await api.call<{id: string}>('botSections/create', {name: section.name});
    for (const bot of SEED_BOTS.filter(item => 'section' in item && item.section === section.key))
      await api.call('bots/update', {botId: bots.get(bot.key)!.id, sectionId: created.id});
  }
  const group = await api.call<{id: string; threadId: string}>('groups/create',
    {name: SEED_GROUP.name, botIds: SEED_GROUP.bots.map(key => bots.get(key)!.id)});
  await api.call('spaces/create', {name: SEED_SPACE});

  for (const routine of SEED_ROUTINES)
    await api.call('routines/create', {botId: bots.get(routine.bot)!.id, name: routine.name, prompt: routine.prompt,
      crons: routine.crons, timezone: routine.timezone, active: false, notify: true});
  for (const item of SEED_SCRATCHPAD)
    await api.call('scratchpad/create', {botId: bots.get(item.bot)!.id, title: item.title, status: item.status, notes: item.notes});
  // The ticket board is off unless the server sets TICKET_BOARD_ENABLED=true; then it answers 404.
  let tickets = 'creadas';
  try {
    for (const ticket of SEED_TICKETS) {
      const created = await api.call<{id: string}>('tickets/create', {title: ticket.title, description: ticket.description,
        priority: ticket.priority, assigneeBotId: bots.get(ticket.bot)!.id});
      if (ticket.status !== 'todo') await api.call('tickets/update', {id: created.id, status: ticket.status});
    }
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404)) throw error;
    tickets = 'omitidas: el tablero está desactivado en este servidor';
  }

  const files = new Map<string, Json>();
  for (const file of SEED_FILES) {
    const content = typeof file.content === 'string' ? await readFile(path.join(root, file.content)) : file.content();
    const artifact = await api.call<{id: string; name: string; mimeType: string; size: number}>('artifacts/create', {
      botId: bots.get(file.bot)!.id, name: file.name, mimeType: file.mimeType,
      contentBase64: content.toString('base64'), clientNonce: `dev-seed-v${SEED_VERSION}-${file.key}`});
    files.set(file.key, {kind: 'file', artifactId: artifact.id, mimeType: file.mimeType, name: file.name, size: content.length});
  }

  let app = 'creada';
  try {
    await api.call('webs/save', {id: randomUUID(), version: 0, slug: SEED_APP.slug, title: SEED_APP.title,
      summary: SEED_APP.summary, bundle: {files: [{path: 'index.html', base64: Buffer.from(SEED_APP.html).toString('base64')}]}});
  } catch (error) {
    if (!(error instanceof ApiError && (error.status === 404 || error.status === 409))) throw error;
    app = error.status === 404 ? 'omitida: Hifa Store está desactivado en este servidor' : 'omitida: la dirección ya existe';
  }
  return {bots, group, files, app, tickets};
}

async function writeHistory(prisma: Prisma, input: {threadId: string; spaceId: string; userId: string;
  defaultBotId?: string; botId: (key: string) => string; files: Map<string, Json>; rows: Row[]; now: number}) {
  const ids: string[] = [];
  const marks: {messageId: string; pin?: boolean; react?: string}[] = [];
  let firstUnread: number | undefined;
  for (const [index, row] of input.rows.entries()) {
    const botId = row.role === 'bot' ? (row.bot ? input.botId(row.bot) : input.defaultBotId) : undefined;
    const createdAt = new Date(input.now - row.at * MINUTE_MS);
    const blocks = row.blocks.map(block => typeof block.file === 'string' ? input.files.get(block.file)! : block);
    const message = await createThreadMessage(prisma, {threadId: input.threadId, role: row.role, botId,
      blocks: blocks as never, replyToMessageId: row.replyTo === undefined ? undefined : ids[index + row.replyTo],
      replyQuote: row.replyQuote});
    await prisma.message.update({where: {id: message.id}, data: {createdAt}});
    ids.push(message.id);
    if (row.pin || row.react) marks.push({messageId: message.id, pin: row.pin, react: row.react});
    if (row.unread && firstUnread === undefined) firstUnread = message.seq;
    if (row.run && input.defaultBotId) {
      const finished = new Date(createdAt.getTime() + 90_000);
      const task = await prisma.task.create({data: {spaceId: input.spaceId, userId: input.userId, botId: input.defaultBotId,
        threadId: input.threadId, prompt: JSON.stringify(row.blocks).slice(0, 200), status: row.run, createdAt}});
      await prisma.run.create({data: {spaceId: input.spaceId, userId: input.userId, botId: input.defaultBotId,
        threadId: input.threadId, taskId: task.id, status: row.run, trigger: 'user', modelProvider: 'scripted', modelId: 'scripted',
        sourceMessageId: message.id, error: row.runError, createdAt, startedAt: createdAt, completedAt: finished}});
    }
  }
  const last = await prisma.thread.findUniqueOrThrow({where: {id: input.threadId}, select: {nextMessageSeq: true}});
  await prisma.thread.update({where: {id: input.threadId}, data: firstUnread === undefined
    ? {unread: false, lastReadSeq: last.nextMessageSeq - 1}
    : {unread: true, lastReadSeq: firstUnread - 1}});
  return marks;
}

export async function seedDevelopmentData(options: {scale: {bots: number; messages: number}}) {
  const profile = await developmentProfile();
  const origin = await runningStack(profile.path);
  if (!origin) throw Error('Mycellios Dev no está arrancado. Ejecuta npm run dev:desktop y vuelve a intentarlo.');
  const {user, api} = await signIn(origin, profile.path);
  const me = await api.call<{userId: string; spaceId: string; billingEnabled?: boolean}>('me');
  if (me.userId !== user.id) throw Error('La API respondió con otra cuenta.');
  const entities = await seedEntities(api, user.id, options.scale);
  const db = await profileDatabase(profile.path);
  const now = Date.now();
  const botId = (key: string) => entities.bots.get(key)!.id;
  try {
    const pending: {target: Json; marks: {messageId: string; pin?: boolean; react?: string}[]}[] = [];
    await runAsSystem('development seed', async () => {
      const oldest = Math.max(...Object.values(SEED_CONVERSATIONS).flat().map(row => row.at));
      for (const [key, rows] of Object.entries(SEED_CONVERSATIONS) as [string, Row[]][]) {
        const isGroup = key === 'group';
        const history = key === 'research' && options.scale.messages ? generatedHistory(options.scale.messages, oldest, undefined) as Row[] : [];
        const threadId = isGroup ? entities.group.threadId : entities.bots.get(key)!.threadId;
        const marks = await writeHistory(db.prisma, {threadId, spaceId: me.spaceId, userId: user.id,
          defaultBotId: isGroup ? undefined : botId(key), botId, files: entities.files, rows: [...history, ...rows], now});
        pending.push({target: isGroup ? {groupId: entities.group.id} : {botId: botId(key)}, marks});
      }
      for (const bot of generatedBots(options.scale.bots))
        await writeHistory(db.prisma, {threadId: entities.bots.get(bot.key)!.threadId, spaceId: me.spaceId, userId: user.id,
          defaultBotId: botId(bot.key), botId, files: entities.files, now,
          rows: generatedHistory(options.scale.messages, 0, undefined) as Row[]});
    });
    // Pins and reactions use the same API as the app, after the messages exist.
    for (const {target, marks} of pending) for (const mark of marks) {
      if (mark.pin) await api.call('threads/setPin', {...target, messageId: mark.messageId, pinned: true});
      if (mark.react) await api.call('threads/react', {...target, messageId: mark.messageId, reaction: mark.react,
        clientNonce: `dev-seed-${mark.messageId}`});
    }
  } finally {
    await db.prisma.$disconnect();
    await db.pool.end();
  }
  const counts = seedCounts(options.scale);
  const manifest = {version: SEED_VERSION, userId: user.id, seededAt: new Date(now).toISOString(), scale: options.scale, counts,
    app: entities.app, tickets: entities.tickets};
  await writeFile(path.join(profile.path, SEED_MARKER), JSON.stringify(manifest, null, 2), {flag: 'wx', mode: 0o600});
  return manifest;
}

async function main() {
  let options;
  try {options = parseSeedArguments(process.argv.slice(2));}
  catch (error) {
    if (error instanceof SeedUsageError) {console.error(`${error.message}\n\n${SEED_USAGE}`); process.exit(2);}
    throw error;
  }
  if (options.help) {console.log(SEED_USAGE); return;}
  const profile = await developmentProfile();
  const marker = await readJson<Json>(path.join(profile.path, SEED_MARKER));
  if (options.dryRun) {
    console.log(`Perfil: ${profile.path}`);
    console.log(`Estado: ${marker ? 'ya sembrado' : 'sin sembrar'}; pila ${await runningStack(profile.path) ? 'arrancada' : 'parada'}`);
    console.log(JSON.stringify(seedCounts(options.scale), null, 2));
    return;
  }
  if (marker) {
    if (options.ifMissing) {console.log('El perfil ya está sembrado; no se cambia nada.'); return;}
    throw Error('Este perfil ya está sembrado. Para empezar de cero: npm run dev:stop, npm run dev:reset y npm run dev:desktop.');
  }
  const manifest = await seedDevelopmentData(options);
  console.log(`Siembra completada en ${profile.path}`);
  console.log(JSON.stringify({...manifest.counts, app: manifest.app, tickets: manifest.tickets}, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(error instanceof Error ? error.message : error); process.exit(1);});
}
