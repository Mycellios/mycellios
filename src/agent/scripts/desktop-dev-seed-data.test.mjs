import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARCHIVED_BOT, NO_SCALE, SEED_BOTS, SEED_CONVERSATIONS, SEED_FILES, SEED_GROUP, SEED_ROUTINES, SEED_SCRATCHPAD,
  SEED_TICKETS, SeedUsageError, generatedBots, generatedHistory, parseSeedArguments, parseSeedScale, seedCounts, seedPdf,
} from './desktop-dev-seed-data.mjs';

const botKeys = new Set(SEED_BOTS.map(bot => bot.key));
const fileKeys = new Set(SEED_FILES.map(file => file.key));

test('arguments: options, scale and usage errors', () => {
  assert.deepEqual(parseSeedArguments([]), {dryRun: false, ifMissing: false, help: false, scale: NO_SCALE});
  assert.deepEqual(parseSeedArguments(['--dry-run', '--if-missing', '--scale=bots:3,messages:40']),
    {dryRun: true, ifMissing: true, help: false, scale: {bots: 3, messages: 40}});
  assert.deepEqual(parseSeedScale('messages:10'), {bots: 0, messages: 10});
  for (const bad of [['--force'], ['--scale=agents:2'], ['--scale=bots:201'], ['--scale=bots:1,bots:2'], ['--scale=']])
    assert.throws(() => parseSeedArguments(bad), SeedUsageError);
});

// packages/testkit/src/dev-seed-blocks.test.ts validates the blocks against the real contract.
test('file blocks reference uploaded seed files', () => {
  for (const [thread, rows] of Object.entries(SEED_CONVERSATIONS)) for (const row of rows)
    for (const block of row.blocks)
      if (typeof block.file === 'string') assert.ok(fileKeys.has(block.file), `${thread}: ${block.file}`);
      else assert.equal(typeof block.kind, 'string');
});

test('conversations reference existing bots, earlier replies and real run states', () => {
  for (const [thread, rows] of Object.entries(SEED_CONVERSATIONS)) {
    assert.ok(thread === 'group' || botKeys.has(thread), thread);
    rows.forEach((row, index) => {
      assert.ok(['user', 'bot', 'system'].includes(row.role));
      if (row.bot) assert.ok(SEED_GROUP.bots.includes(row.bot), `${thread} ${row.bot}`);
      if (thread === 'group' && row.role === 'bot') assert.ok(row.bot, 'group replies name their bot');
      if (row.replyTo !== undefined) assert.ok(row.replyTo < 0 && index + row.replyTo >= 0);
      if (row.run) assert.ok(['completed', 'failed', 'cancelled'].includes(row.run) && row.role === 'user');
      if (index) assert.ok(row.at <= rows[index - 1].at, `${thread} is chronological at ${index}`);
    });
  }
  for (const item of [...SEED_ROUTINES, ...SEED_SCRATCHPAD, ...SEED_TICKETS, ...SEED_FILES]) assert.ok(botKeys.has(item.bot));
  assert.ok(!botKeys.has(ARCHIVED_BOT.key));
});

test('generated data stays ordered and bounded', () => {
  const history = generatedHistory(5, 100, undefined);
  assert.equal(history.length, 5);
  assert.ok(history.every((row, index) => row.at > 100 && (!index || row.at < history[index - 1].at)));
  assert.equal(new Set(generatedBots(30).map(bot => bot.key)).size, 30);
  const base = seedCounts();
  const scaled = seedCounts({bots: 2, messages: 10});
  assert.equal(scaled.bots, base.bots + 2);
  assert.equal(scaled.messages, base.messages + 30);
});

test('the PDF has a valid cross-reference table', () => {
  const pdf = seedPdf().toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
  const xref = Number(/startxref\n(\d+)/.exec(pdf)[1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref');
  const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map(match => Number(match[1]));
  offsets.forEach((offset, index) => assert.ok(pdf.startsWith(`${index + 1} 0 obj`, offset)));
});
