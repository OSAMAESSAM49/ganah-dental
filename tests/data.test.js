import { describe, test, assert } from './runner.js';
import { createIndexedDBAdapter } from '../js/data/adapter-indexeddb.js';
import { deleteDatabase } from '../js/data/idb.js';
import { MIGRATIONS } from '../js/data/migrations.js';
import { Repository, KeyValueRepository, repoHooks } from '../js/data/repository.js';

const tmpName = () => `ganah-test-${crypto.randomUUID()}`;

/** Synthetic schema history used to exercise the migration engine. */
const TEST_MIGRATIONS = [
  { version: 1, description: 'items', up(db) { db.createObjectStore('items', { keyPath: 'id' }).createIndex('group', 'group'); } },
  { version: 2, description: 'add name index + backfill', up(db, tx) {
    const store = tx.objectStore('items');
    store.createIndex('name', 'name');
    store.openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      c.update({ ...c.value, name: c.value.name ?? 'بدون اسم' });
      c.continue();
    };
  } },
];

describe('data layer', () => {
  test('app migrations open a fresh database', async () => {
    const name = tmpName();
    const a = await createIndexedDBAdapter(name, MIGRATIONS);
    assert.equal(a.version, MIGRATIONS.length);
    assert.ok(a.storeNames().includes('meta') && a.storeNames().includes('settings'));
    assert.ok((await a.get('meta', 'createdAt'))?.value);
    a.close(); await deleteDatabase(name);
  });

  test('upgrading v1 → v2 keeps data and runs backfill', async () => {
    const name = tmpName();
    const v1 = await createIndexedDBAdapter(name, TEST_MIGRATIONS.slice(0, 1));
    await v1.put('items', { id: '1', group: 'a' });
    v1.close();
    const v2 = await createIndexedDBAdapter(name, TEST_MIGRATIONS);
    assert.equal(v2.version, 2);
    assert.equal((await v2.get('items', '1')).name, 'بدون اسم');
    assert.equal((await v2.list('items', { index: 'name', range: { eq: 'بدون اسم' } })).length, 1);
    v2.close(); await deleteDatabase(name);
  });

  test('migration versions must be consecutive', async () => {
    await assert.rejects(() => createIndexedDBAdapter(tmpName(), [{ version: 2, up() {} }]));
  });

  test('repository CRUD, soft delete, restore, audit hook', async () => {
    const name = tmpName();
    const a = await createIndexedDBAdapter(name, TEST_MIGRATIONS);
    const events = [];
    const prev = { ...repoHooks };
    repoHooks.actor = () => 'user-1';
    repoHooks.afterWrite = (e) => events.push(e.action);
    try {
      const repo = new Repository(a, 'items', { softDelete: true });
      const r = await repo.create({ name: 'كمبوزيت', group: 'حشو' });
      assert.ok(r.id && r.createdAt && r.createdBy === 'user-1');
      const u = await repo.update(r.id, { name: 'كمبوزيت A2' });
      assert.equal(u.name, 'كمبوزيت A2');
      assert.equal(u.createdAt, r.createdAt);
      assert.equal((await repo.findBy('group', 'حشو')).length, 1);
      await repo.remove(r.id);
      assert.equal(await repo.get(r.id), null);
      assert.ok((await repo.get(r.id, { includeDeleted: true })).deletedAt);
      assert.equal(await repo.count(), 0);
      await repo.restore(r.id);
      assert.equal((await repo.get(r.id)).deletedAt, undefined);
      assert.deepEqual(events, ['create', 'update', 'delete', 'restore']);
      await assert.rejects(() => repo.update('missing', {}));
    } finally {
      Object.assign(repoHooks, prev);
      a.close(); await deleteDatabase(name);
    }
  });

  test('list supports ranges, direction, offset and limit', async () => {
    const name = tmpName();
    const a = await createIndexedDBAdapter(name, TEST_MIGRATIONS);
    await a.putMany('items', ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, name: `n${i}`, group: i % 2 ? 'odd' : 'even' })));
    assert.deepEqual((await a.list('items', { range: { gte: 'b', lt: 'e' } })).map((r) => r.id), ['b', 'c', 'd']);
    assert.deepEqual((await a.list('items', { direction: 'prev', limit: 2 })).map((r) => r.id), ['e', 'd']);
    assert.deepEqual((await a.list('items', { offset: 3 })).map((r) => r.id), ['d', 'e']);
    assert.equal(await a.count('items', { index: 'group', range: { eq: 'even' } }), 3);
    assert.deepEqual((await a.list('items', { index: 'name', range: { prefix: 'n' }, limit: 1 })).map((r) => r.id), ['a']);
    a.close(); await deleteDatabase(name);
  });

  test('transactions are atomic', async () => {
    const name = tmpName();
    const a = await createIndexedDBAdapter(name, TEST_MIGRATIONS);
    await assert.rejects(() => a.transaction(['items'], 'readwrite', async (t) => {
      await t.put('items', { id: 'x', group: 'g' });
      throw new Error('boom');
    }));
    assert.equal(await a.get('items', 'x'), null, 'write rolled back');
    await a.transaction(['items'], 'readwrite', async (t) => {
      await t.put('items', { id: 'y', group: 'g' });
      await t.put('items', { id: 'z', group: 'g' });
    });
    assert.equal(await a.count('items'), 2);
    a.close(); await deleteDatabase(name);
  });

  test('key-value repository', async () => {
    const name = tmpName();
    const a = await createIndexedDBAdapter(name, MIGRATIONS);
    const kv = new KeyValueRepository(a, 'settings');
    assert.equal(await kv.get('app', 'none'), 'none');
    await kv.set('app', { digitStyle: 'arabic' });
    await kv.merge('app', { idle: 10 });
    assert.deepEqual(await kv.get('app'), { digitStyle: 'arabic', idle: 10 });
    a.close(); await deleteDatabase(name);
  });
});
