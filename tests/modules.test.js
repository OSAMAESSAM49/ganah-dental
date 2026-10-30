import { describe, test, assert } from './runner.js';

describe('modules', () => {
  // A typo in any file only shows when its page opens; load them all here instead.
  test('every app file loads', async () => {
    const src = await (await fetch('../asset-list.js', { cache: 'no-store' })).text();
    const files = [...src.matchAll(/"\.\/(js\/[^"]+\.js)"/g)].map((m) => m[1]).filter((f) => f !== 'js/app.js');
    assert.ok(files.length > 50, 'asset list has the app files');
    const failed = [];
    for (const f of files) {
      try { await import(`../${f}`); } catch (err) { failed.push(`${f}: ${err.message}`); }
    }
    assert.equal(failed.join('\n'), '');
  });
});
