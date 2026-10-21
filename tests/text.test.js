import { describe, test, assert } from './runner.js';
import { normalizeDigits, toArabicDigits, normalizeArabic, initials } from '../js/core/text.js';

describe('text', () => {
  test('normalizeDigits converts Arabic-Indic and Persian digits and separators', () => {
    assert.equal(normalizeDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
    assert.equal(normalizeDigits('۰۱۲۳'), '0123');
    assert.equal(normalizeDigits('١٬٢٥٠٫٥'), '1,250.5');
    assert.equal(normalizeDigits(null), '');
  });
  test('toArabicDigits', () => assert.equal(toArabicDigits('2026-10'), '٢٠٢٦-١٠'));
  test('normalizeArabic unifies letter forms and strips diacritics', () => {
    assert.equal(normalizeArabic('أَحْمَد'), 'احمد');
    assert.equal(normalizeArabic('إسلام'), normalizeArabic('اسلام'));
    assert.equal(normalizeArabic('فاطمة'), 'فاطمه');
    assert.equal(normalizeArabic('مصطفى'), 'مصطفي');
    assert.equal(normalizeArabic('  محـمد   علي '), 'محمد علي');
    assert.equal(normalizeArabic('٠١٠'), '010');
  });
  test('initials', () => assert.equal(initials('مريم عبد الرحمن'), 'م ع'));
});
