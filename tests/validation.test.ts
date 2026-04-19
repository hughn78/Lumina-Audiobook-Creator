import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAppendSectionsPayload, validateCreateExportJobPayload, validateSpeakPayload } from '../server/validation.ts';

test('validateSpeakPayload normalizes adaptive mode', () => {
  const payload = validateSpeakPayload({
    text: 'Hello world',
    voice: 'af_heart',
  });

  assert.equal(payload.isAdaptive, true);
  assert.equal(payload.voice, 'af_heart');
});

test('validateCreateExportJobPayload rejects invalid totals', () => {
  assert.throws(() => validateCreateExportJobPayload({
    voice: 'af_heart',
    totalSections: 0,
  }));
});

test('validateAppendSectionsPayload filters blank sections and marks final batch', () => {
  const payload = validateAppendSectionsPayload({
    sections: ['first', '   ', 'second'],
    isFinalBatch: true,
  });

  assert.deepEqual(payload.sections, ['first', 'second']);
  assert.equal(payload.isFinalBatch, true);
});
