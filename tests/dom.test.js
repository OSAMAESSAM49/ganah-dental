import { describe, test, assert } from './runner.js';
import { html, raw, escapeHTML, toElement, formData } from '../js/core/dom.js';
import { sortRows, searchRows } from '../js/components/table.js';

describe('dom & table helpers', () => {
  test('html escapes interpolated values', () => {
    const evil = '<img src=x onerror=alert(1)>';
    assert.equal(String(html`<p>${evil}</p>`), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    assert.equal(String(html`<a title="${'"x"'}">`), '<a title="&quot;x&quot;">');
  });
  test('html keeps nested templates, arrays and raw; drops null/booleans', () => {
    const items = ['أ', 'ب'];
    assert.equal(String(html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`), '<ul><li>أ</li><li>ب</li></ul>');
    assert.equal(String(html`${raw('<b>x</b>')}${null}${false}${undefined}`), '<b>x</b>');
    assert.equal(escapeHTML("'&"), '&#39;&amp;');
  });
  test('formData reads checkboxes, radios and text', () => {
    const form = toElement(`<form>
      <input name="name" value="منى">
      <input type="checkbox" name="vip" checked>
      <input type="checkbox" name="tags" value="a" checked><input type="checkbox" name="tags" value="b">
      <input type="radio" name="g" value="m"><input type="radio" name="g" value="f" checked>
    </form>`);
    assert.deepEqual(formData(form), { name: 'منى', vip: true, tags: ['a'], g: 'f' });
  });
  test('sortRows is stable, nulls last, Arabic-aware', () => {
    const rows = [{ n: 'سارة', v: 2 }, { n: 'أحمد', v: null }, { n: 'بسمة', v: 1 }];
    assert.deepEqual(sortRows(rows, { key: 'v' }).map((r) => r.n), ['بسمة', 'سارة', 'أحمد']);
    assert.deepEqual(sortRows(rows, { key: 'v' }, 'desc').map((r) => r.n), ['سارة', 'بسمة', 'أحمد']);
    assert.deepEqual(sortRows(rows, { key: 'n' }).map((r) => r.n), ['أحمد', 'بسمة', 'سارة']);
  });
  test('searchRows ignores hamza/taa marbuta differences', () => {
    const rows = [{ name: 'أحمد علي' }, { name: 'فاطمة حسن' }];
    assert.equal(searchRows(rows, 'احمد', ['name']).length, 1);
    assert.equal(searchRows(rows, 'فاطمه', ['name']).length, 1);
    assert.equal(searchRows(rows, '', ['name']).length, 2);
  });
});
