import { describe, test, assert } from './runner.js';
import { findRuns, inDataAttribute, translateText, inArabic, lang } from '../js/core/i18n.js';

const keys = (text) => findRuns(text).map((r) => r.key);

describe('i18n', () => {
  test('runs are the Arabic text between markup, with values as {n}', () => {
    assert.deepEqual(keys('<h1>المرضى</h1><p>عدد {0} مريض</p>'), ['المرضى', 'عدد {0} مريض']);
    assert.deepEqual(keys('<button title="حفظ التعديلات">{0}</button>'), ['حفظ التعديلات']);
  });
  test('values and punctuation at the edges are left out of the key', () => {
    assert.deepEqual(keys('{0} موعد، {1}'), ['موعد']);
    assert.deepEqual(keys('«تم السداد»'), ['تم السداد']);
    assert.deepEqual(keys('سن {0}، {1}'), ['سن {0}']);
  });
  test('text without Arabic letters is not a run', () => assert.deepEqual(keys('<b>EGP 500</b> — OK'), []));
  test('data attributes are never translated', () => {
    assert.deepEqual(keys('<option value="نقدي">كاش</option>'), ['كاش']);
    assert.ok(inDataAttribute('<div data-name="'));
    assert.ok(!inDataAttribute('<div title="'));
  });
  test('Arabic stays as it is in Arabic, and inside inArabic', () => {
    assert.equal(inArabic(() => lang()), 'ar');
    assert.equal(inArabic(() => translateText('حفظ')), 'حفظ');
  });
});
