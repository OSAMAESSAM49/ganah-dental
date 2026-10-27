/**
 * «دليل الاستخدام»: the role guides (docs/guides/*.md) inside the app, opening on the guide
 * for the signed-in user's role. They are cached with the app, so they work offline too.
 */
import { html, ico, render, raw } from '../../core/dom.js';
import { href } from '../../core/router.js';
import { currentUser } from '../../core/session.js';
import { markdownToHTML } from '../../core/markdown.js';
import { errorState } from '../../components/states.js';

const GUIDES = [
  { key: 'reception', label: 'الاستقبال', icon: 'users' },
  { key: 'doctor', label: 'الطبيب', icon: 'stethoscope' },
  { key: 'assistant', label: 'الممرض / المساعد', icon: 'heart-pulse' },
  { key: 'admin', label: 'مدير النظام', icon: 'shield-check' },
];
const FOR_ROLE = { reception: 'reception', doctor: 'doctor', nurse: 'assistant', admin: 'admin' };

export default {
  title: 'دليل الاستخدام',
  async render({ el, query }) {
    const mine = FOR_ROLE[currentUser()?.roleId] ?? 'reception';
    const guide = GUIDES.find((g) => g.key === query.role) ?? GUIDES.find((g) => g.key === mine);
    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">دليل الاستخدام</h1>
          <p class="page-header__sub">خطوات العمل اليومية لكل دور في العيادة</p>
        </div>
      </header>
      <nav class="tabs" aria-label="الأدوار">
        ${GUIDES.map((g) => html`<a class="tab" href="${href('/help', {}, { role: g.key })}" aria-selected="${String(g === guide)}" ${g === guide ? html`aria-current="page"` : ''}>${ico(g.icon, { size: 18 })} ${g.label}</a>`)}
      </nav>
      <article class="card guide" id="guide"><div class="card__body"><p class="muted">جارٍ التحميل…</p></div></article>`);
    const box = el.querySelector('#guide');
    try {
      const res = await fetch(`./docs/guides/${guide.key}.md`);
      if (!res.ok) throw new Error(String(res.status));
      render(box, html`<div class="card__body">${raw(markdownToHTML(await res.text()))}</div>`);
    } catch {
      render(box, errorState({ title: 'تعذّر فتح الدليل', message: 'تأكد من الاتصال بالإنترنت ثم أعد المحاولة.' }));
      box.querySelector('[data-retry]')?.addEventListener('click', () => location.reload());
    }
  },
};
