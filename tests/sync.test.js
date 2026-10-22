import { describe, test, assert } from './runner.js';
import { incomingWins, keepsNumber, revOf } from '../js/services/sync.js';

describe('sync rules (pure)', () => {
  test('newest version wins; tombstones only delete older copies', () => {
    assert.equal(incomingWins(null, { client_updated_at: 'b' }), true);
    assert.equal(incomingWins(null, { deleted: true, client_updated_at: 'b' }), false);
    assert.equal(incomingWins({ _rev: 'a' }, { client_updated_at: 'b' }), true);
    assert.equal(incomingWins({ _rev: 'c' }, { client_updated_at: 'b' }), false);
    assert.equal(incomingWins({ _rev: 'b' }, { client_updated_at: 'b' }), false, 'same version is skipped');
    assert.equal(revOf({ updatedAt: 'x' }), 'x');
  });
  test('the record created first keeps a clashing number', () => {
    assert.equal(keepsNumber({ createdAt: '1', id: 'z' }, { createdAt: '2', id: 'a' }), true);
    assert.equal(keepsNumber({ createdAt: '2', id: 'a' }, { createdAt: '1', id: 'z' }), false);
    assert.equal(keepsNumber({ createdAt: '1', id: 'a' }, { createdAt: '1', id: 'b' }), true);
  });
});

/** In-memory stand-in for Supabase with the same rules as supabase/schema.sql. */
function fakeServer() {
  const rows = new Map(); const files = new Map();
  let clock = Date.parse('2026-01-01T00:00:00Z');
  return {
    rows, files,
    api: {
      clinicId: () => 'clinic-1',
      async push(batch) {
        for (const r of batch) {
          const k = `${r.store}|${r.id}`;
          const cur = rows.get(k);
          if (cur && (cur.client_updated_at ?? '') > (r.client_updated_at ?? '')) continue;
          rows.set(k, structuredClone({ ...r, server_updated_at: new Date(++clock).toISOString() }));
        }
      },
      async pull(since, limit) {
        return [...rows.values()].filter((r) => r.server_updated_at >= since).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at)).slice(0, limit).map((r) => structuredClone(r));
      },
      async isEmpty() { return rows.size === 0; },
      async upload(path, blob) { files.set(path, new Uint8Array(await blob.arrayBuffer())); },
      async download(path) { return new Blob([files.get(path)]); },
    },
  };
}

describe('sync between two devices (temporary databases, fake server)', () => {
  test('changes, deletions, images and clashing numbers converge', async () => {
    const { createIndexedDBAdapter } = await import('../js/data/adapter-indexeddb.js');
    const { MIGRATIONS } = await import('../js/data/migrations.js');
    const { trackAdapter } = await import('../js/data/tracking.js');
    const { Repository, KeyValueRepository } = await import('../js/data/repository.js');
    const { deleteDatabase } = await import('../js/data/idb.js');
    const { createSyncEngine } = await import('../js/services/sync.js');
    const server = fakeServer();
    const mem = () => { let v = {}; return { load: () => structuredClone(v), save: (x) => { v = structuredClone(x); } }; };
    const names = [`ganah-test-${crypto.randomUUID()}`, `ganah-test-${crypto.randomUUID()}`];
    const devices = [];
    try {
      for (const name of names) {
        const adapter = trackAdapter(await createIndexedDBAdapter(name, MIGRATIONS));
        const engine = createSyncEngine({ adapter, api: server.api, state: mem() });
        devices.push({ adapter, engine, patients: new Repository(adapter, 'patients', { softDelete: true }), media: new Repository(adapter, 'media'), invoices: new Repository(adapter, 'invoices'), meta: new KeyValueRepository(adapter, 'meta') });
      }
      const [A, B] = devices;
      // Device B is a fresh "extra device": start from the cloud copy only.
      for (const s of B.adapter.storeNames().filter((x) => x !== 'meta')) await B.adapter.raw.clear(s);

      // A is the main device: upload everything (seeded catalog included).
      A.engine.queueAll();
      const p1 = await A.patients.create({ name: 'سارة', fileNo: 'G-00001', searchText: '' });
      const img = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/jpeg' });
      const m1 = await A.media.create({ patientId: p1.id, kind: 'photo', blob: img });
      await A.engine.syncNow();
      assert.equal(A.engine.pending(), 0, 'everything uploaded');
      assert.equal(server.files.size, 1, 'image stored as a file');
      assert.ok([...server.rows.values()].some((r) => r.store === 'procedures'), 'catalog uploaded');

      await B.engine.syncNow();
      assert.equal((await B.patients.get(p1.id)).name, 'سارة');
      const bImg = (await B.media.get(m1.id)).blob;
      assert.deepEqual([...new Uint8Array(await bImg.arrayBuffer())], [9, 8, 7]);
      assert.equal(bImg.type, 'image/jpeg');
      assert.equal(B.engine.pending(), 0, 'pulled records are not pushed back');
      assert.equal((await B.adapter.list('procedures')).length, (await A.adapter.list('procedures')).length, 'no duplicated catalog');

      // Edit on B, delete on A (different records); both converge.
      await B.patients.update(p1.id, { phone: '01011111111' });
      const inv = await A.invoices.create({ number: 1, patientId: p1.id, lines: [] });
      await B.engine.syncNow();
      await A.engine.syncNow();
      assert.equal((await A.patients.get(p1.id)).phone, '01011111111');
      await A.invoices.remove(inv.id);
      await A.engine.syncNow();
      await B.engine.syncNow();
      assert.equal(await B.invoices.get(inv.id), null, 'hard delete synced as tombstone');

      // Both devices create file G-00002 while offline: the first created keeps it.
      const pa = await A.patients.create({ name: 'من الجهاز الأول', fileNo: 'G-00002', searchText: '' });
      await new Promise((r) => setTimeout(r, 5));
      const pb = await B.patients.create({ name: 'من الجهاز الثاني', fileNo: 'G-00002', searchText: '' });
      await A.meta.set('counter.patientFileNo', 2);
      await B.meta.set('counter.patientFileNo', 2);
      await A.engine.syncNow();
      await B.engine.syncNow(); // B sees the clash: its own (later) patient is renumbered
      await A.engine.syncNow();
      await B.engine.syncNow();
      for (const d of devices) {
        assert.equal((await d.patients.get(pa.id)).fileNo, 'G-00002', 'first created keeps the number');
        assert.equal((await d.patients.get(pb.id)).fileNo, 'G-00003', 'later one renumbered everywhere');
      }
      assert.equal(await B.meta.get('counter.patientFileNo'), 3, 'counter moved past the new number');

      // Same record edited on both: the later edit wins on both devices.
      await A.patients.update(p1.id, { notes: 'من A' });
      await new Promise((r) => setTimeout(r, 5));
      await B.patients.update(p1.id, { notes: 'من B' });
      await A.engine.syncNow(); await B.engine.syncNow(); await A.engine.syncNow();
      assert.equal((await A.patients.get(p1.id)).notes, 'من B');
      assert.equal((await B.patients.get(p1.id)).notes, 'من B');
    } finally {
      for (const d of devices) { d.engine.stop(); d.adapter.close(); }
      for (const n of names) await deleteDatabase(n);
    }
  });
});
