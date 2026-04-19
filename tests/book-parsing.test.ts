import test from 'node:test';
import assert from 'node:assert/strict';
import { clampProgress, groupSectionsIntoChapters, splitPdfPageTextIntoSections, splitTextIntoSections } from '../src/lib/book-parsing.ts';

test('splitTextIntoSections chunks newline-heavy text', () => {
  const longLine = 'a'.repeat(2000);
  const sections = splitTextIntoSections(`${longLine}\n${longLine}\nshort`);

  assert.equal(sections.length, 2);
  assert.match(sections[0], /^a+/);
});

test('splitPdfPageTextIntoSections preserves sentence grouping', () => {
  const sections = splitPdfPageTextIntoSections('One sentence. Two sentence. Three sentence.');

  assert.equal(sections.length, 1);
  assert.match(sections[0], /Two sentence/);
});

test('clampProgress keeps restored state inside chapter bounds', () => {
  const chapters = groupSectionsIntoChapters(['one', 'two', 'three', 'four', 'five', 'six'], 2);
  const clamped = clampProgress({
    bookId: 'book',
    chapterIndex: 99,
    sectionIndex: 99,
    currentTime: -10,
    lastPlayedAt: Date.now(),
  }, chapters);

  assert.equal(clamped.chapterIndex, chapters.length - 1);
  assert.equal(clamped.sectionIndex, chapters[chapters.length - 1].sections.length - 1);
  assert.equal(clamped.currentTime, 0);
});
