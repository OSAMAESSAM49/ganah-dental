/** Settings: clinic info, schedule & chairs, appearance & digits, backup / restore / merge / demo data. */
import { html, ico, render } from '../../core/dom.js';
import { href } from '../../core/router.js';

const TABS = [
  { key: 'backup', label: 'النسخ الاحتياطي', icon: 'database', load: () => import('./tab-backup.js') },
  { key: 'clinic', label: 'بيانات العيادة', icon: 'house', load: () => import('./tab-clinic.js') },
  { key: 'schedule', label: 'المواعيد والكراسي', icon: 'calendar-days', load: () => import('./tab-schedule.js') },
  { key: 'appearance', label: 'المظهر والأرقام', icon: 'palette', load: () => import('./tab-appearance.js') },
];

export default {
  title: 'الإعدادات',
  async render(ctx) {
    const { el, query } = ctx;
    const tab = TABS.find((t) => t.key === query.tab) ?? TABS[0];
    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">الإعدادات</h1>
          <p class="page-header__sub">بيانات العيادة، والنسخ الاحتياطي، وشكل البرنامج</p>
        </div>
      </header>
      <nav class="tabs" aria-label="أقسام الإعدادات">
        ${TABS.map((t) => html`<a class="tab" href="${href('/settings', {}, { tab: t.key })}" aria-selected="${String(t === tab)}" ${t === tab ? html`aria-current="page"` : ''}>${ico(t.icon, { size: 18 })} ${t.label}</a>`)}
      </nav>
      <div id="tab-body"></div>`);
    const mod = await tab.load();
    return mod.renderTab({ ...ctx, body: el.querySelector('#tab-body') });
  },
};
