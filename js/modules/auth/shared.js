/** Pieces shared by the login, recovery and setup screens. */
import { html, ico } from '../../core/dom.js';
import { brandMark } from '../../components/brand.js';
import { getSettings } from '../../data/settings.js';
import { printHTML } from '../../components/print.js';

/** Two-panel full-screen layout: violet brand panel + form panel. */
export function authLayout(content, { headline } = {}) {
  const clinic = getSettings('clinic');
  return html`
    <div class="auth">
      <section class="auth__brand" aria-hidden="true">
        <div class="auth__logo">
          ${clinic.logo ? html`<img class="brand-mark" src="${clinic.logo}" alt="" style="object-fit:contain;background:#fff">` : brandMark({ size: 64, variant: 'white' })}
          <div><div class="auth__logo-name">${clinic.shortName}</div><div class="auth__logo-sub">${clinic.tagline}</div></div>
        </div>
        <p class="auth__headline">${headline ?? html`ابتسامة مرضاك <em>تبدأ</em> من تنظيم عيادتك`}</p>
        <div class="auth__facts">
          <span class="auth__fact">${ico('calendar-check', { size: 18 })} المواعيد</span>
          <span class="auth__fact">${ico('tooth', { size: 18 })} ملف وخريطة أسنان</span>
          <span class="auth__fact">${ico('receipt', { size: 18 })} الحسابات</span>
          <span class="auth__fact">${ico('download', { size: 18 })} يعمل بدون إنترنت</span>
        </div>
      </section>
      <section class="auth__panel">
        <div class="auth__card">${content}</div>
      </section>
    </div>`;
}

/** "K7QM-2XPA-…" shown in big monospace chunks. */
export const recoveryCodeBox = (code) => html`
  <div class="code-box" aria-label="رمز الاسترداد ${code}">${code.split('-').map((g) => html`<span>${g}</span>`)}</div>`;

/** Prints the recovery code on its own sheet. */
export function printRecoveryCode(code) {
  printHTML(html`
    <p>هذا هو رمز استرداد حساب مدير النظام. استخدمه فقط إذا نسي المدير كلمة المرور.</p>
    <p style="font: 700 22pt monospace; letter-spacing: 3px; direction: ltr; text-align: center; padding: 8mm; border: 2px dashed #4A0CD3; border-radius: 4mm; margin: 8mm 0">${code}</p>
    <ul>
      <li>احتفظ بهذه الورقة في مكان آمن خارج العيادة أو في خزنة.</li>
      <li>كل استخدام للرمز يُلغيه ويُصدر رمزًا جديدًا.</li>
      <li>لا تصوّر الرمز ولا ترسله في رسائل.</li>
    </ul>`, { title: 'رمز استرداد حساب المدير' });
}
