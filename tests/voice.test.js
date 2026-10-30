import { describe, test, assert } from './runner.js';
import { digits } from '../js/core/format.js';
import { formatDuration } from '../js/modules/patients/voice-notes.js';

describe('voice notes', () => {
  test('duration as minutes:seconds', () => {
    assert.equal(formatDuration(75), digits('1:15'));
    assert.equal(formatDuration(9.6), digits('0:09'), 'rounded down like the audio player');
    assert.equal(formatDuration(undefined), digits('0:00'));
  });
  test('kept apart from photos in the patient file (temporary database)', async () => {
    const { initData, repos } = await import('../js/data/index.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const media = await import('../js/services/media.js');
    const name = `ganah-test-${crypto.randomUUID()}`;
    const adapter = await initData({ name });
    try {
      const img = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
      await repos.media.create({ patientId: 'p1', kind: 'photo', blob: img, thumb: img, takenAt: '2026-10-01' });
      const clip = new Blob([new Uint8Array([2, 3])], { type: 'audio/mp4' });
      const note = await media.addVoiceNote('p1', clip, { durationSec: 12.4, caption: '  خطة العلاج ' });
      assert.equal(note.kind, 'voice');
      assert.equal(note.durationSec, 12.4);
      assert.equal(note.caption, 'خطة العلاج');
      assert.deepEqual((await media.listPatientMedia('p1')).map((m) => m.kind), ['photo'], 'photos tab has no voice notes');
      assert.equal(await media.countPatientMedia('p1'), 1);
      const voices = await media.listVoiceNotes('p1');
      assert.deepEqual(voices.map((m) => m.id), [note.id]);
      assert.equal(voices[0].blob.type, 'audio/mp4');
    } finally {
      adapter.close();
      await deleteDatabase(name);
    }
  });
});
