import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStoredBooks } from '../src/lib/storage.ts';

test('parseStoredBooks accepts legacy array storage', () => {
  const result = parseStoredBooks(JSON.stringify([
    {
      id: 'book-1',
      title: 'Legacy Book',
      author: 'Author',
      format: 'txt',
      addedAt: 1,
    },
  ]));

  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Legacy Book');
});

test('parseStoredBooks ignores invalid JSON', () => {
  const result = parseStoredBooks('{invalid');
  assert.deepEqual(result, []);
});

test('parseStoredBooks ignores malformed entries', () => {
  const result = parseStoredBooks(JSON.stringify({
    version: 1,
    books: [
      {
        id: 'good',
        title: 'Good',
        author: 'Author',
        format: 'pdf',
        addedAt: 2,
      },
      {
        id: 'bad',
        title: 'Bad',
      },
    ],
  }));

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'good');
});
