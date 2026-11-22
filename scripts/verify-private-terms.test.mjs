import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, describeTerm, findTerms, normalize, pathKey } from './verify-private-terms.mjs';

// Synthetic terms only: the real list is stored as hashes in the script.
const terms = [describeTerm('quokka'), describeTerm('blue heron')];
const [quokka, heron] = terms.map(t => t.sha256);

test('normalization ignores case, accents and separators', () => {
  assert.equal(normalize('Ça_Va--Bien'), 'ca va bien');
  assert.equal(normalize('Pøst'), 'post');
});

test('finds a term inside identifiers, paths and accented text', () => {
  assert.deepEqual(findTerms('const onQuokkaOpen = 1;', terms), [quokka]);
  assert.deepEqual(findTerms('QUOKKA_HOST and @quokka/core', terms), [quokka, quokka]);
  assert.deepEqual(findTerms('modules/quokka-files/x.kt', terms), [quokka]);
  assert.deepEqual(findTerms('Quökka', terms), [quokka]);
});

test('multi-word terms match any separator but not across words that only touch', () => {
  assert.deepEqual(findTerms('the Blue-Heron flies', terms), [heron]);
  assert.deepEqual(findTerms('blue_heron', terms), [heron]);
  assert.deepEqual(findTerms('blueheron', terms), []);
  assert.deepEqual(findTerms('nothing private here', terms), []);
});

test('baseline only lets occurrences go down, per file', () => {
  const baseline = { [quokka]: { [pathKey('a.ts')]: 2 } };
  assert.equal(compare({ [quokka]: { 'a.ts': 2 } }, baseline, terms).increases.length, 0);
  const more = compare({ [quokka]: { 'a.ts': 3 } }, baseline, terms);
  assert.equal(more.increases[0].file, 'a.ts');
  const moved = compare({ [quokka]: { 'b.ts': 1 } }, baseline, terms);
  assert.equal(moved.increases[0].file, 'b.ts');
  const fewer = compare({ [quokka]: { 'a.ts': 1 } }, baseline, terms);
  assert.equal(fewer.increases.length, 0);
  assert.equal(fewer.decreases.length, 1);
  assert.deepEqual(fewer.next, { [quokka]: { [pathKey('a.ts')]: 1 } });
  assert.equal(compare({ [heron]: { 'c.md': 1 } }, {}, terms).increases.length, 1);
});
