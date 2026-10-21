/** Placeholder for screens scheduled in later build phases. */
import { html, ico, render } from '../../core/dom.js';
import { digits } from '../../core/format.js';
import { emptyState } from '../../components/states.js';

export default {
  async render({ el, route }) {
    const { phase, icon = 'sparkles' } = route.meta ?? {};
    render(el, html`
      <header class="page-header">
        <div class="page-header__text">
          <h1 class="page-header__title">${route.title}</h1>
          <p class="page-header__sub">هذه الشاشة ضمن خطة البناء</p>
        </div>
      </header>
      <section class="card">
        ${emptyState({
          icon,
          title: `قيد الإنشاء — المرحلة ${digits(phase)}`,
          hint: 'نبني النظام على مراحل؛ كل مرحلة تُختبر قبل الانتقال للتالية. ستظهر هذه الشاشة هنا عند اكتمال مرحلتها.',
          actions: html`<a class="btn btn--primary" href="#/">${ico('house')} العودة للرئيسية</a>`,
        })}
      </section>`);
  },
};
