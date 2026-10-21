/** Shown in place of a page the signed-in user is not allowed to open. */
import { html, ico, render } from '../../core/dom.js';
import { emptyState } from '../../components/states.js';

export default {
  title: 'غير مسموح',
  async render({ el }) {
    render(el, html`
      <section class="card">
        ${emptyState({
          icon: 'lock',
          title: 'ليست لديك صلاحية لفتح هذه الصفحة',
          hint: 'إذا كنت تحتاجها في عملك، اطلب من مدير النظام إضافة الصلاحية لحسابك.',
          actions: html`<a class="btn btn--primary" href="#/">${ico('house')} العودة للرئيسية</a>`,
        })}
      </section>`);
  },
};
