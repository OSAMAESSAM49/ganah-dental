/** Theme (per device) and digit style (clinic-wide). */
import { html, ico, render } from '../../core/dom.js';
import { formatMoney, formatDate, formatTime, getDigitStyle, setDigitStyle } from '../../core/format.js';
import { getTheme, setTheme, THEME_LABELS } from '../../core/theme.js';
import { can } from '../../core/permissions.js';
import { updateSettings } from '../../data/settings.js';
import { segmentedField } from '../../components/form.js';
import { toastSuccess } from '../../components/toast.js';

export async function renderTab({ body, signal }) {
  const draw = () => render(body, html`
    <section class="card">
      <div class="card__body">
        <div class="setting-row">
          <div class="setting-row__text"><span class="setting-row__title">المظهر</span><span class="setting-row__hint">خاص بهذا الجهاز فقط</span></div>
          ${segmentedField({ name: 'theme', label: '', value: getTheme(), options: [
            { value: 'auto', label: THEME_LABELS.auto, icon: ico('monitor', { size: 18 }) },
            { value: 'light', label: THEME_LABELS.light, icon: ico('sun', { size: 18 }) },
            { value: 'dark', label: THEME_LABELS.dark, icon: ico('moon', { size: 18 }) },
          ] })}
        </div>
        <div class="setting-row">
          <div class="setting-row__text"><span class="setting-row__title">شكل الأرقام</span>
            <span class="setting-row__hint">لكل أجهزة العيادة · مثال: ${formatMoney(125050)} · ${formatDate(new Date())} · ${formatTime(new Date())}</span></div>
          ${can('settings', 'edit') ? segmentedField({ name: 'digits', label: '', value: getDigitStyle(), options: [
            { value: 'western', label: 'غربية 123' }, { value: 'arabic', label: 'عربية ١٢٣' },
          ] }) : html`<span class="muted">${getDigitStyle() === 'arabic' ? 'عربية' : 'غربية'}</span>`}
        </div>
      </div>
    </section>`);

  body.addEventListener('change', async (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.name === 'theme') setTheme(/** @type {any} */ (t.value));
    if (t.name === 'digits') {
      setDigitStyle(/** @type {any} */ (t.value));
      await updateSettings('app', { digitStyle: t.value });
      toastSuccess('تم تغيير شكل الأرقام');
      draw();
    }
  }, { signal });
  draw();
}
