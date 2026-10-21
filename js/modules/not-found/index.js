/** 404 view for unknown hash routes. */
import { html, ico, render } from '../../core/dom.js';
import { emptyState } from '../../components/states.js';

export default {
  title: 'الصفحة غير موجودة',
  async render({ el }) {
    render(el, html`
      <section class="card">
        ${emptyState({
          icon: 'search',
          title: 'الصفحة غير موجودة',
          hint: 'ربما تغيّر الرابط أو كُتب بشكل خاطئ. استخدم القائمة للوصول إلى ما تريد.',
          actions: html`<a class="btn btn--primary" href="#/">${ico('house')} الذهاب للرئيسية</a>`,
        })}
      </section>`);
  },
};
