import { describe, test, assert } from './runner.js';
import { normalizeEgyptPhone, isEgyptMobile, isEgyptLandline, toWhatsAppNumber, phone, validate, required } from '../js/core/validate.js';

describe('validate', () => {
  test('normalizes Egyptian phone formats', () => {
    assert.equal(normalizeEgyptPhone('010 1234 5678'), '01012345678');
    assert.equal(normalizeEgyptPhone('+20 101 234 5678'), '01012345678');
    assert.equal(normalizeEgyptPhone('00201012345678'), '01012345678');
    assert.equal(normalizeEgyptPhone('٠١٠١٢٣٤٥٦٧٨'), '01012345678');
    assert.equal(normalizeEgyptPhone('1012345678'), '01012345678');
  });
  test('mobile prefixes 010/011/012/015 only', () => {
    assert.ok(isEgyptMobile('01012345678'));
    assert.ok(isEgyptMobile('01512345678'));
    assert.ok(!isEgyptMobile('01312345678'));
    assert.ok(!isEgyptMobile('0101234567'));
  });
  test('landlines', () => {
    assert.ok(isEgyptLandline('0223456789'), 'Cairo');
    assert.ok(isEgyptLandline('034567890'), 'Alexandria');
    assert.ok(isEgyptLandline('0502345678'), 'Dakahlia');
    assert.ok(!isEgyptLandline('01012345678'));
  });
  test('WhatsApp numbers', () => {
    assert.equal(toWhatsAppNumber('01008137502'), '201008137502');
    assert.equal(toWhatsAppNumber('0502345678'), null);
  });
  test('field validators return Arabic messages', () => {
    assert.equal(phone('', { required: false }), '');
    assert.ok(phone('', { required: true }).length > 0);
    assert.ok(phone('0502345678', { mobileOnly: true }).length > 0);
    assert.deepEqual(validate({ name: '', phone: '01012345678' }, {
      name: (v) => required(v, 'الاسم'),
      phone: (v) => phone(v, { mobileOnly: true }),
    }), { name: 'الاسم مطلوب' });
  });
});
