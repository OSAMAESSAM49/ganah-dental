/** Patient file → overview: personal data, medical summary, latest photos. */
import { html, ico, render } from '../../core/dom.js';
import { formatDate, formatDateTime, digits } from '../../core/format.js';
import { GENDER_LABELS, REFERRAL_SOURCES } from '../../core/labels.js';
import { href } from '../../core/router.js';
import { can } from '../../core/permissions.js';
import { repos } from '../../data/index.js';
import { listPatientMedia, urlPool } from '../../services/media.js';
import { medicalSummary } from './medical.js';
import { canChangePatient } from '../../services/patients.js';

export async function renderTab({ body, patient }) {
  const p = patient();
  const changeable = await canChangePatient(p);
  const pool = urlPool();
  const [media, creator] = await Promise.all([
    listPatientMedia(p.id),
    p.createdBy ? repos.users.get(p.createdBy, { includeDeleted: true }) : null,
  ]);
  const dash = html`<span class="subtle">—</span>`;

  render(body, html`
    <div class="bento">
      <section class="card span-7">
        <div class="card__header"><div class="card__heading"><h2 class="card__title">البيانات الشخصية</h2></div>
          ${can('patients', 'edit') && changeable ? html`<a class="round-btn" href="${href('/patients/:id/edit', { id: p.id })}" aria-label="تعديل البيانات">${ico('pencil', { size: 18 })}</a>` : ''}</div>
        <div class="card__body">
          <dl class="dl">
            <dt>رقم الملف</dt><dd class="ltr">${digits(p.fileNo)}</dd>
            <dt>النوع</dt><dd>${GENDER_LABELS[p.gender] ?? dash}</dd>
            <dt>تاريخ الميلاد</dt><dd>${p.dob ? html`${formatDate(p.dob)}${p.dobEstimated ? html` <span class="subtle">(تقريبي)</span>` : ''}` : dash}</dd>
            <dt>الموبايل</dt><dd>${p.phone ? html`<span class="ltr">${digits(p.phone)}</span>` : dash}</dd>
            ${p.phone2 ? html`<dt>هاتف آخر</dt><dd><span class="ltr">${digits(p.phone2)}</span></dd>` : ''}
            <dt>العنوان</dt><dd>${p.address || dash}</dd>
            <dt>المهنة</dt><dd>${p.occupation || dash}</dd>
            <dt>عرفنا عن طريق</dt><dd>${REFERRAL_SOURCES[p.referralSource] ?? dash}${p.referralNote ? html` <span class="muted">— ${p.referralNote}</span>` : ''}</dd>
            <dt>تاريخ التسجيل</dt><dd>${formatDateTime(p.createdAt)}${creator ? html` <span class="muted">· ${creator.displayName}</span>` : ''}</dd>
          </dl>
          ${p.notes ? html`<hr><p class="muted text-sm" style="margin-block-end: var(--sp-1)">ملاحظات</p><p style="white-space: pre-line">${p.notes}</p>` : ''}
        </div>
      </section>
      <section class="card span-5">
        <div class="card__header"><div class="card__heading"><h2 class="card__title">التاريخ الطبي</h2></div>
          <a class="round-btn" href="${href('/patients/:id', { id: p.id }, { tab: 'medical' })}" aria-label="فتح التاريخ الطبي">${ico('arrow-up-left', { size: 18 })}</a></div>
        <div class="card__body">${medicalSummary(p)}</div>
      </section>
      <section class="card span-12">
        <div class="card__header"><div class="card__heading"><h2 class="card__title">أحدث الصور والأشعة</h2><p class="card__subtitle">${media.length ? `${digits(media.length)} ملف` : 'لا توجد صور بعد'}</p></div>
          <a class="round-btn" href="${href('/patients/:id', { id: p.id }, { tab: 'photos' })}" aria-label="كل الصور">${ico('arrow-up-left', { size: 18 })}</a></div>
        <div class="card__body">
          ${media.length ? html`<div class="gallery">${media.slice(0, 6).map((m) => html`
            <a class="gallery__item" data-kind="${m.kind}" href="${href('/patients/:id', { id: p.id }, { tab: 'photos', open: m.id })}">
              <span class="gallery__open"><img src="${pool.url(m.thumb)}" alt="${m.caption}"></span>
              <span class="gallery__meta"><span class="gallery__caption">${m.caption || '—'}</span><span class="gallery__badges">${formatDate(m.takenAt)}</span></span>
            </a>`)}</div>` : html`<p class="muted">أضف صور قبل/بعد العلاج والأشعة من تبويب «الصور والأشعة».</p>`}
        </div>
      </section>
    </div>`);
  return () => pool.revokeAll();
}
