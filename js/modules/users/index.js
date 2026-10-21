/** Users & permissions (Admin only): tabs for users, roles and security settings. */
import { html, ico, render } from '../../core/dom.js';
import { href } from '../../core/router.js';

const TABS = [
  { key: 'users', label: 'المستخدمون', icon: 'users', load: () => import('./users-tab.js') },
  { key: 'roles', label: 'الأدوار والصلاحيات', icon: 'shield-check', load: () => import('./roles-tab.js') },
  { key: 'security', label: 'الأمان', icon: 'lock', load: () => import('./security-tab.js') },
];

export default {
  title: 'المستخدمون والصلاحيات',
  async render(ctx) {
    const { el, query } = ctx;
    const tab = TABS.find((t) => t.key === query.tab) ?? TABS[0];
    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">المستخدمون والصلاحيات</h1>
          <p class="page-header__sub">من يدخل البرنامج، وماذا يرى، وماذا يستطيع أن يفعل</p>
        </div>
        <div class="page-header__actions" id="tab-actions"></div>
      </header>
      <nav class="tabs" aria-label="أقسام المستخدمين">
        ${TABS.map((t) => html`<a class="tab" href="${href('/users', {}, { tab: t.key })}" aria-selected="${String(t === tab)}" ${t === tab ? html`aria-current="page"` : ''}>${ico(t.icon, { size: 18 })} ${t.label}</a>`)}
      </nav>
      <div id="tab-body"></div>`);
    const mod = await tab.load();
    return mod.renderTab({ ...ctx, body: el.querySelector('#tab-body'), actions: el.querySelector('#tab-actions') });
  },
};
