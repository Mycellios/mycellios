#!/usr/bin/env node
// Rejects private names (people, companies and retired or third-party product
// names) in tracked file contents and paths. Terms are stored only as hashes so
// this file does not itself repeat them; this keeps them out of searches and
// casual reading, it is not a secret. Matching ignores case, accents and
// separators ("A_b", "a-b" and "a b" are the same term) and also finds a term
// inside a longer identifier ("onTermValue").
//
// Occurrences that cannot be removed yet are frozen per term in
// scripts/private-terms-baseline.json. Counts may only go down: an increase
// fails, and a decrease fails until the baseline is lowered with --update.
//
//   node scripts/verify-private-terms.mjs                 check the tracked tree
//   node scripts/verify-private-terms.mjs --update        lower the baseline
//   node scripts/verify-private-terms.mjs --hash "<term>" print a TERMS entry
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts', 'private-terms-baseline.json');

// { length, sha256, rolling } of each normalized term (see --hash).
export const TERMS = [
  { length: 6, sha256: 'bd3dae5fb91f88a4f0978222dfd58f59a124257cb081486387cbae9df11fb879', rolling: 4114127107 },
  { length: 5, sha256: 'bad1727e4ac4d2ab97769d353cdf0414cd9204a21dc35d76bd54cb9708654f65', rolling: 3139290234 },
  { length: 7, sha256: 'b98f002e41f48c643d1fb3286f5d5f4990b810e834a34d2c14e3791af34b306e', rolling: 3381984102 },
  { length: 6, sha256: '42cc7c452d6be5edecf856597da432e13d2cf7186a5bbdbde94674bf771e6765', rolling: 3521496156 },
  { length: 7, sha256: 'b206105b76b9a20b21b2871aefdf2d1097d015fc1618722d1dbddbc786e2a546', rolling: 1569258603 },
  { length: 9, sha256: 'eb92ec6442f115e8b5ba1116d85e5f484e80fc6a57dc756a36c14f9728ddcf52', rolling: 877158473 },
  { length: 7, sha256: '55569917dab57c4e2784e97e3846c66d7e782be625d30911f218a227e3751a4d', rolling: 1595063977 },
  { length: 6, sha256: 'c8bb362a79ad5f10bc7b95f2761ffcd01c9f6bd536c98522d5aa0a010e7076d9', rolling: 3054224118 },
  { length: 12, sha256: '4c00bf3238c7fb90dde39e8074d2ed29be5254ca7f28fdfb2d26d180a64d2393', rolling: 1225155537 },
];

const FOLD = { 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ł': 'l', 'đ': 'd', 'ı': 'i' };
const BASE = 131;

/** Lowercase, strip accents and collapse every non-alphanumeric run to one space. */
export function normalize(text) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[øæœßłđı]/g, c => FOLD[c]).replace(/[^a-z0-9]+/g, ' ');
}

const sha256 = s => createHash('sha256').update(s).digest('hex');

function rolling(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, BASE) + s.charCodeAt(i)) >>> 0;
  return h;
}

export function describeTerm(term) {
  const s = normalize(term).trim();
  return { length: s.length, sha256: sha256(s), rolling: rolling(s) };
}

/** Returns the sha256 of the term behind every occurrence found in `text`. */
export function findTerms(text, terms = TERMS) {
  const s = normalize(text);
  const byLength = new Map();
  for (const t of terms) {
    if (!byLength.has(t.length)) byLength.set(t.length, new Map());
    byLength.get(t.length).set(t.rolling, (byLength.get(t.length).get(t.rolling) ?? new Set()).add(t.sha256));
  }
  const hits = [];
  for (const [len, targets] of byLength) {
    if (s.length < len) continue;
    let pow = 1;
    for (let i = 1; i < len; i++) pow = Math.imul(pow, BASE) >>> 0;
    let h = rolling(s.slice(0, len));
    for (let i = 0; ; i++) {
      const wanted = targets.get(h);
      if (wanted) {
        const digest = sha256(s.slice(i, i + len));
        if (wanted.has(digest)) hits.push(digest);
      }
      if (i + len >= s.length) break;
      h = (Math.imul((h - Math.imul(s.charCodeAt(i), pow)) >>> 0, BASE) + s.charCodeAt(i + len)) >>> 0;
    }
  }
  return hits;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

/** Baseline keys hash the file path so the baseline does not repeat names in paths. */
export const pathKey = file => sha256(file).slice(0, 24);

/** Returns { [termHash]: { [file]: count } } for the given files. */
export function scan(files = trackedFiles(), read = file => readFileSync(path.join(ROOT, file))) {
  const found = {};
  for (const file of files) {
    const hits = findTerms(file);
    let buf = null;
    try { buf = read(file); } catch { /* deleted in the working tree */ }
    if (buf && !buf.includes(0)) hits.push(...findTerms(buf.toString('utf8')));
    for (const hash of hits) (found[hash] ??= {})[file] = (found[hash][file] ?? 0) + 1;
  }
  return found;
}

/** Compares a scan with the per-file baseline. Increases and new files always fail. */
export function compare(found, baseline, terms = TERMS) {
  const increases = [];
  const decreases = [];
  const next = {};
  for (const { sha256: hash } of terms) {
    const files = found[hash] ?? {};
    const allowed = baseline[hash] ?? {};
    const seen = new Set();
    for (const [file, n] of Object.entries(files)) {
      const key = pathKey(file);
      seen.add(key);
      const limit = allowed[key] ?? 0;
      if (n > limit) increases.push({ hash, file, found: n, allowed: limit });
      else if (n < limit) decreases.push({ hash, file, found: n, allowed: limit });
      (next[hash] ??= {})[key] = n;
    }
    for (const [key, limit] of Object.entries(allowed)) if (!seen.has(key)) decreases.push({ hash, file: null, found: 0, allowed: limit });
  }
  for (const hash of Object.keys(next)) next[hash] = Object.fromEntries(Object.entries(next[hash]).sort());
  return { increases, decreases, next };
}

function main(argv) {
  if (argv[0] === '--hash') {
    const term = argv.slice(1).join(' ');
    if (!normalize(term).trim()) { console.error('usage: --hash "<term>"'); return 2; }
    console.log(JSON.stringify(describeTerm(term)));
    return 0;
  }
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  const { increases, decreases, next } = compare(scan(), baseline);
  for (const e of increases) {
    console.error(`${e.file}: ${e.found} occurrence(s) of private term ${e.hash.slice(0, 12)}, ${e.allowed} allowed. Remove the new ones.`);
  }
  if (argv.includes('--update')) {
    if (increases.length) { console.error('Baseline not updated: it can only go down.'); return 1; }
    writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
    console.log('private-terms baseline updated');
    return 0;
  }
  if (decreases.length) {
    console.error(`${decreases.length} file(s) have fewer private-term occurrences than the baseline. Run node scripts/verify-private-terms.mjs --update.`);
  }
  if (increases.length || decreases.length) return 1;
  const frozen = Object.values(next).flatMap(Object.values).reduce((a, b) => a + b, 0);
  console.log(`private terms: none added${frozen ? ` (${frozen} legacy occurrence(s) frozen in the baseline)` : ''}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
