import { describe, test, assert } from './runner.js';
import { formatFileNo, buildSearchText, searchPatients, dobFromAge } from '../js/services/patients.js';
import { medicalAlerts, MEDICAL_ITEMS } from '../js/core/medical.js';
import { sameMedical, readMedical } from '../js/modules/patients/medical.js';
import { encodeValue, decodeValue, parseBackup, BACKUP_APP, BACKUP_FORMAT } from '../js/services/backup.js';
import { SCHEMA_VERSION } from '../js/data/migrations.js';
import { SEED_CATEGORIES } from '../js/data/seed-catalog.js';

const mk = (p) => ({ ...p, searchText: buildSearchText(p) });
const LIST = [
  mk({ id: '1', name: 'أحمد سيد علي', phone: '01012345678', fileNo: 'G-00012' }),
  mk({ id: '2', name: 'فاطمة أحمد', phone: '01122223333', fileNo: 'G-00003' }),
  mk({ id: '3', name: 'محمود حسن', phone: '01555555555', fileNo: 'G-00120' }),
];

describe('patients', () => {
  test('file numbers', () => {
    assert.equal(formatFileNo(7), 'G-00007');
    assert.equal(formatFileNo(123456), 'G-123456');
  });
  test('search by name ranks prefix matches first and ignores hamza', async () => {
    const r = await searchPatients('احمد', { list: LIST });
    assert.deepEqual(r.map((p) => p.id), ['1', '2']);
  });
  test('search by phone (any format) and by file number', async () => {
    assert.deepEqual((await searchPatients('٠١١٢٢٢٢', { list: LIST })).map((p) => p.id), ['2']);
    assert.deepEqual((await searchPatients('12', { list: LIST })).map((p) => p.id)[0], '1');
    assert.deepEqual((await searchPatients('G-00120', { list: LIST })).map((p) => p.id), ['3']);
  });
  test('dobFromAge', () => {
    assert.equal(dobFromAge('30', new Date(2026, 9, 21)), '1996-01-01');
    assert.equal(dobFromAge('٥', new Date(2026, 9, 21)), '2021-01-01');
    assert.equal(dobFromAge('200'), null);
  });
});

describe('medical history', () => {
  test('critical vs caution, female-only items hidden for males', () => {
    const p = { gender: 'male', medical: { items: { allergyPenicillin: true, diabetes: true, pregnancy: true }, allergyOther: 'سلفا' } };
    const a = medicalAlerts(p);
    assert.equal(a.critical.length, 2);
    assert.ok(a.critical.some((x) => x.includes('سلفا')));
    assert.equal(a.caution.length, 1);
    assert.equal(medicalAlerts({ ...p, gender: 'female' }).critical.length, 3);
  });
  test('item keys are unique', () => {
    const keys = MEDICAL_ITEMS.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length);
  });
  test('readMedical / sameMedical', () => {
    const m = readMedical({ 'med.diabetes': true, 'med.asthma': false, 'med.allergyOther': ' ', 'med.medications': 'x', 'med.notes': '', name: 'n' });
    assert.deepEqual(m.items, { diabetes: true });
    assert.ok(sameMedical({ items: { diabetes: true }, medications: 'x' }, m));
    assert.ok(!sameMedical({ items: { diabetes: true, asthma: true }, medications: 'x' }, m));
  });
});

describe('backup format', () => {
  test('blobs survive encode → JSON → decode', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' });
    const enc = await encodeValue({ id: 'm1', blob, nested: [{ thumb: blob }], n: 5 });
    const round = decodeValue(JSON.parse(JSON.stringify(enc)));
    assert.ok(round.blob instanceof Blob && round.nested[0].thumb instanceof Blob);
    assert.equal(round.blob.type, 'image/jpeg');
    assert.deepEqual([...new Uint8Array(await round.blob.arrayBuffer())], [1, 2, 3, 250]);
    assert.equal(round.n, 5);
  });
  const valid = () => ({ app: BACKUP_APP, format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: '2026-10-21T10:00:00Z', stores: { users: [{ id: 'u' }], meta: [{ key: 'k', value: 1 }], patients: [{ id: 'p' }] } });
  test('parseBackup accepts a valid file and builds a preview', () => {
    const { preview } = parseBackup(JSON.stringify(valid()));
    assert.equal(preview.counts.patients, 1);
    assert.equal(preview.older, false);
  });
  test('parseBackup rejects bad files with Arabic messages', () => {
    const bad = (mutate) => { const v = valid(); mutate(v); try { parseBackup(JSON.stringify(v)); return null; } catch (e) { return e.message; } };
    assert.ok(bad((v) => { v.app = 'other'; }));
    assert.ok(bad((v) => { v.schemaVersion = SCHEMA_VERSION + 1; }).includes('أحدث'));
    assert.ok(bad((v) => { v.stores.patients = [{ name: 'no id' }]; }));
    assert.ok(bad((v) => { v.stores.users = []; }));
    let msg = '';
    try { parseBackup('{not json'); } catch (e) { msg = e.message; }
    assert.ok(msg);
  });
});

describe('catalog seed', () => {
  test('matches the brief: 7 categories, unique names, sensible values', () => {
    assert.equal(SEED_CATEGORIES.length, 7);
    const names = SEED_CATEGORIES.flatMap((c) => c.items.map((i) => i.name));
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes('كراون زيركون') && names.includes('بلبوتومي') && names.includes('كشف'));
    for (const c of SEED_CATEGORIES) for (const i of c.items) assert.ok(i.minutes >= 5 && i.sessions >= 1, i.name);
  });
});
