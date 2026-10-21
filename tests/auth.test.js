import { describe, test, assert } from './runner.js';
import { hashSecret, verifySecret, generateRecoveryCode, normalizeRecoveryCode } from '../js/core/crypto.js';
import { MODULES, DEFAULT_ROLES, effectivePermissions, diffOverrides, countOverrides, fullMatrix } from '../js/core/permissions.js';
import { validatePassword, validateUsername, validatePin, passwordStrength } from '../js/services/auth.js';
import { diffRecords } from '../js/services/audit.js';
import { maskDate, isoToInput, dateRule } from '../js/components/date-field.js';

const role = (id) => DEFAULT_ROLES.find((r) => r.id === id);

describe('crypto', () => {
  test('hash + verify round-trip; wrong secret fails; salts differ', async () => {
    const a = await hashSecret('كلمة-سر-123', { iterations: 1000 });
    const b = await hashSecret('كلمة-سر-123', { iterations: 1000 });
    assert.ok(a.salt !== b.salt && a.hash !== b.hash);
    assert.ok(await verifySecret('كلمة-سر-123', a));
    assert.ok(!(await verifySecret('كلمة-سر-124', a)));
    assert.ok(!(await verifySecret('x', null)));
    assert.equal(a.algo, 'PBKDF2-SHA256');
  });
  test('recovery codes', () => {
    const c = generateRecoveryCode();
    assert.ok(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(c), c);
    assert.ok(!/[01OIL]/.test(c));
    assert.equal(normalizeRecoveryCode(' k7qm 2xpa-9rtd hw4e '), 'K7QM-2XPA-9RTD-HW4E');
  });
});

describe('permissions', () => {
  test('admin always has everything, including admin-only modules', () => {
    const p = effectivePermissions(role('admin'), { permOverrides: { users: { view: false } } });
    assert.ok(p.users.view && p.audit.view && p.billing.delete);
  });
  test('reception defaults match the brief', () => {
    const p = effectivePermissions(role('reception'));
    assert.ok(p.appointments.view && p.billing.view && p.billing.create);
    assert.ok(!p.expenses.view && !p.reports.view && !p.users.view && !p.audit.view);
  });
  test('nurse sees inventory and treatment, not finances', () => {
    const p = effectivePermissions(role('nurse'));
    assert.ok(p.inventory.view && p.treatment.view);
    assert.ok(!p.billing.view && !p.expenses.view && !p.reports.view);
  });
  test('user overrides apply but never grant admin-only modules', () => {
    const p = effectivePermissions(role('reception'), { permOverrides: { expenses: { view: true }, appointments: { delete: false }, audit: { view: true } } });
    assert.ok(p.expenses.view);
    assert.ok(!p.appointments.delete);
    assert.ok(!p.audit.view);
  });
  test('diffOverrides keeps only cells that differ from the role', () => {
    const r = role('nurse');
    const desired = structuredClone(r.permissions);
    desired.expenses.view = true;
    desired.inventory.view = false;
    const o = diffOverrides(r, desired);
    assert.deepEqual(o, { inventory: { view: false }, expenses: { view: true } });
    assert.equal(countOverrides(o), 2);
    assert.deepEqual(diffOverrides(r, r.permissions), {});
  });
  test('matrices only contain actions valid for each module', () => {
    const m = fullMatrix();
    for (const mod of MODULES) assert.deepEqual(Object.keys(m[mod.key]), mod.actions);
  });
});

describe('auth validation', () => {
  test('usernames', () => {
    assert.equal(validateUsername('dr.ahmed'), '');
    assert.ok(validateUsername('أحمد'));
    assert.ok(validateUsername('ab'));
    assert.ok(validateUsername('has space'));
  });
  test('passwords', () => {
    assert.equal(validatePassword('Smile2026', 'reem'), '');
    assert.ok(validatePassword('short'));
    assert.ok(validatePassword('reception', 'reception'));
    assert.ok(validatePassword('12345678'));
    assert.ok(validatePassword('aaaaaaaaaa'));
    assert.ok(passwordStrength('Smile2026!xyz') > passwordStrength('smile2026'));
  });
  test('PINs', () => {
    assert.equal(validatePin('4826'), '');
    assert.equal(validatePin('٤٨٢٦'), '');
    assert.ok(validatePin('1234'));
    assert.ok(validatePin('1111'));
    assert.ok(validatePin('12a4'));
    assert.ok(validatePin('1234567'));
  });
});

describe('audit diff', () => {
  test('ignores bookkeeping and secrets, records real changes', () => {
    const before = { id: '1', displayName: 'منى', roleId: 'nurse', updatedAt: 'a', password: { hash: 'x' }, active: true };
    const after = { id: '1', displayName: 'منى علي', roleId: 'nurse', updatedAt: 'b', password: { hash: 'y' }, active: false };
    assert.deepEqual(diffRecords(before, after), [
      { field: 'displayName', from: 'منى', to: 'منى علي' },
      { field: 'active', from: true, to: false },
    ]);
  });
  test('replaces images with a placeholder', () => {
    const d = diffRecords({ logo: null }, { logo: 'data:image/png;base64,AAAA' });
    assert.deepEqual(d, [{ field: 'logo', from: null, to: '[صورة]' }]);
  });
});

describe('date field', () => {
  test('mask inserts slashes and accepts Arabic digits', () => {
    assert.equal(maskDate('05032026'), '05/03/2026');
    assert.equal(maskDate('٠٥٠٣'), '05/03');
    assert.equal(maskDate('05/0'), '05/0');
    assert.equal(maskDate('123456789'), '12/34/5678');
  });
  test('iso ↔ input and validation', () => {
    assert.equal(isoToInput('2026-03-05'), '05/03/2026');
    assert.equal(isoToInput(''), '');
    assert.equal(dateRule(''), '');
    assert.ok(dateRule('', { required: true }));
    assert.ok(dateRule('31/02/2026'));
    assert.equal(dateRule('28/02/2026'), '');
  });
});
