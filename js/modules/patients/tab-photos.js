/**
 * Patient file → photos & X-rays: upload (button or drag & drop), filter, view, edit details,
 * delete, and compare two images (before/after) with a slider. Images live in IndexedDB.
 */
import { html, ico, render, on, formData } from '../../core/dom.js';
import { formatDate, formatBytes, digits, parseDateInput, todayISO } from '../../core/format.js';
import { can } from '../../core/permissions.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toast, toastSuccess, toastError } from '../../components/toast.js';
import { emptyState } from '../../components/states.js';
import { dateField, enhanceDateFields } from '../../components/date-field.js';
import { textField, selectField } from '../../components/form.js';
import { downloadBlob } from '../../services/backup.js';
import { listPatientMedia, addPatientImages, updateMedia, deleteMedia, urlPool, MEDIA_KINDS, MEDIA_TAGS } from '../../services/media.js';
import { tr } from '../../core/i18n.js';

const FILTERS = [['all', 'الكل'], ['photo', 'صور'], ['xray', 'أشعة'], ['before', 'قبل'], ['after', 'بعد']];

export async function renderTab({ body, patient, query, signal }) {
  const p = patient();
  const pool = urlPool();
  const canEdit = can('patients', 'edit');
  const canDelete = can('patients', 'delete');
  let items = [], filter = 'all', compareMode = false;
  const selected = new Set();

  render(body, html`
    <div class="stack">
      ${canEdit ? html`
        <section class="card">
          <div class="card__body">
            <div class="dropzone" id="drop">
              ${ico('upload', { size: 30 })}
              <strong>اسحب الصور هنا أو اخترها من الجهاز</strong>
              <span class="text-sm">يمكن اختيار عدة صور مرة واحدة. على الموبايل يمكن التصوير مباشرة.</span>
              <div class="row" style="justify-content:center; margin-block-start: var(--sp-2)">
                <div class="segmented" role="radiogroup" aria-label="نوع الملف">
                  <label><input type="radio" name="up-kind" value="photo" checked><span>${ico('image', { size: 18 })} صورة</span></label>
                  <label><input type="radio" name="up-kind" value="xray"><span>${ico('scroll-text', { size: 18 })} أشعة</span></label>
                </div>
                <select class="select" id="up-tag" aria-label="قبل أو بعد" style="inline-size:auto">
                  <option value="">بدون تصنيف</option><option value="before">قبل العلاج</option><option value="after">بعد العلاج</option>
                </select>
                <label class="btn btn--primary">${ico('plus')} اختيار صور
                  <input type="file" accept="image/*" multiple id="up-input" class="visually-hidden">
                </label>
              </div>
            </div>
          </div>
        </section>` : ''}
      <div class="row row--between">
        <div class="chips" role="group" aria-label="تصفية الصور">
          ${FILTERS.map(([k, v]) => html`<button type="button" class="chip" data-filter="${k}" aria-pressed="${String(k === 'all')}">${v} <span class="chip__count" data-count="${k}"></span></button>`)}
        </div>
        <div class="row">
          <button type="button" class="btn btn--sm" id="cmp-toggle" aria-pressed="false">${ico('arrow-up-down', { size: 18 })} مقارنة قبل/بعد</button>
          <button type="button" class="btn btn--sm btn--accent" id="cmp-go" hidden disabled>قارن الصورتين</button>
        </div>
      </div>
      <p class="muted text-sm" id="cmp-hint" hidden>اختر صورتين للمقارنة (مثلًا: قبل وبعد).</p>
      <div id="grid"></div>
    </div>`);

  const visible = () => items.filter((m) => filter === 'all' || m.kind === filter || m.tag === filter);

  const drawGrid = () => {
    for (const [k] of FILTERS) {
      const n = items.filter((m) => k === 'all' || m.kind === k || m.tag === k).length;
      const el = body.querySelector(`[data-count="${k}"]`);
      if (el) el.textContent = digits(n);
    }
    const rows = visible();
    if (!rows.length) {
      render(body.querySelector('#grid'), html`<div class="card">${emptyState({ icon: 'image', title: items.length ? 'لا توجد صور بهذا التصنيف' : 'لا توجد صور أو أشعة بعد', hint: canEdit ? 'ارفع صور الفم قبل العلاج وبعده، وصور الأشعة، لتبقى كلها في ملف المريض.' : '' })}</div>`);
      return;
    }
    render(body.querySelector('#grid'), html`<div class="gallery">${rows.map((m) => html`
      <article class="gallery__item" data-kind="${m.kind}" ${selected.has(m.id) ? html`data-selected` : ''}>
        ${compareMode ? html`<input type="checkbox" class="gallery__select" data-pick="${m.id}" ${selected.has(m.id) ? 'checked' : ''} aria-label="اختيار للمقارنة">` : ''}
        <button type="button" class="gallery__open" data-open="${m.id}" aria-label="عرض ${m.caption || 'الصورة'}"><img src="${pool.url(m.thumb)}" alt="" loading="lazy"></button>
        <div class="gallery__meta">
          <span class="gallery__caption">${m.caption || 'بدون وصف'}</span>
          <span class="gallery__badges">
            <span class="badge ${m.kind === 'xray' ? 'badge--dark' : 'badge--primary'}">${MEDIA_KINDS[m.kind]}</span>
            ${m.tag ? html`<span class="badge badge--accent">${MEDIA_TAGS[m.tag]}</span>` : ''}
            ${formatDate(m.takenAt)}
          </span>
        </div>
      </article>`)}</div>`);
  };

  const reload = async () => { items = await listPatientMedia(p.id); drawGrid(); };

  const upload = async (files) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!list.length) { toastError('اختر ملفات صور (JPG أو PNG)'); return; }
    const kind = /** @type {HTMLInputElement} */ (body.querySelector('[name="up-kind"]:checked'))?.value ?? 'photo';
    const tag = /** @type {HTMLSelectElement} */ (body.querySelector('#up-tag'))?.value ?? '';
    const dismiss = toast(tr`جارٍ حفظ ${digits(list.length)} صورة…`, { duration: 0 });
    try {
      await addPatientImages(p.id, list, { kind, tag });
      dismiss();
      toastSuccess(list.length === 1 ? 'تم حفظ الصورة' : tr`تم حفظ ${digits(list.length)} صور`);
      await reload();
    } catch (err) {
      dismiss();
      console.error(err);
      toastError(err.name === 'QuotaExceededError' ? 'مساحة التخزين على الجهاز ممتلئة. خذ نسخة احتياطية واحذف صورًا قديمة.' : 'تعذّر حفظ الصور');
    }
  };

  if (canEdit) {
    body.querySelector('#up-input').addEventListener('change', (e) => { const i = /** @type {HTMLInputElement} */ (e.target); upload(i.files); i.value = ''; }, { signal });
    const drop = body.querySelector('#drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.setAttribute('data-over', ''); }, { signal });
    drop.addEventListener('dragleave', () => drop.removeAttribute('data-over'), { signal });
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.removeAttribute('data-over'); upload(/** @type {DragEvent} */ (e).dataTransfer?.files); }, { signal });
  }

  on(body, 'click', '[data-filter]', (_, chip) => {
    filter = chip.dataset.filter;
    body.querySelectorAll('[data-filter]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    drawGrid();
  }, { signal });

  const syncCompare = () => {
    const go = /** @type {HTMLButtonElement} */ (body.querySelector('#cmp-go'));
    go.hidden = !compareMode;
    go.disabled = selected.size !== 2;
    body.querySelector('#cmp-hint').hidden = !compareMode;
    body.querySelector('#cmp-toggle').setAttribute('aria-pressed', String(compareMode));
  };
  body.querySelector('#cmp-toggle').addEventListener('click', () => { compareMode = !compareMode; selected.clear(); syncCompare(); drawGrid(); }, { signal });
  on(body, 'change', '[data-pick]', (_, box) => {
    const id = box.dataset.pick;
    if (/** @type {HTMLInputElement} */ (box).checked) {
      if (selected.size >= 2) selected.delete([...selected][0]);
      selected.add(id);
    } else selected.delete(id);
    syncCompare();
    drawGrid();
  }, { signal });
  body.querySelector('#cmp-go').addEventListener('click', () => {
    const [a, b] = [...selected].map((id) => items.find((m) => m.id === id));
    // put "before" (or the older one) first
    const pair = a.tag === 'after' || (b.tag === 'before') || (!a.tag && !b.tag && a.takenAt > b.takenAt) ? [b, a] : [a, b];
    openCompare(pair[0], pair[1], pool);
  }, { signal });

  on(body, 'click', '[data-open]', (_, b) => openViewer(b.dataset.open), { signal });

  /** Full-size viewer with details form, prev/next, download and delete. */
  async function openViewer(id) {
    let index = visible().findIndex((m) => m.id === id);
    if (index < 0) { filter = 'all'; index = items.findIndex((m) => m.id === id); }
    if (index < 0) return;
    const list = visible().length ? visible() : items;
    const viewerPool = urlPool();
    const drawBody = (m) => html`
      <div class="viewer">
        <div class="viewer__stage">
          <img src="${viewerPool.url(m.blob)}" alt="${m.caption}">
          ${list.length > 1 ? html`
            <button type="button" class="round-btn round-btn--dark viewer__nav viewer__nav--prev" data-nav="-1" aria-label="السابقة">${ico('chevron-right')}</button>
            <button type="button" class="round-btn round-btn--dark viewer__nav viewer__nav--next" data-nav="1" aria-label="التالية">${ico('chevron-left')}</button>` : ''}
        </div>
        <form class="form" id="media-form" novalidate>
          ${textField({ name: 'caption', label: 'الوصف', value: m.caption })}
          ${selectField({ name: 'kind', label: 'النوع', value: m.kind, options: Object.entries(MEDIA_KINDS).map(([value, label]) => ({ value, label })) })}
          ${selectField({ name: 'tag', label: 'قبل / بعد', value: m.tag, placeholder: 'بدون', options: Object.entries(MEDIA_TAGS).map(([value, label]) => ({ value, label })) })}
          ${dateField({ name: 'takenAt', label: 'تاريخ التصوير', value: m.takenAt, max: todayISO() })}
          <p class="subtle text-sm">${digits(m.width)}×${digits(m.height)} · ${formatBytes(m.size)} · ${digits(index + 1)} من ${digits(list.length)}</p>
          <div class="row">
            ${canEdit ? html`<button type="submit" class="btn btn--primary btn--sm">${ico('save', { size: 18 })} حفظ</button>` : ''}
            <button type="button" class="btn btn--sm" data-download>${ico('download', { size: 18 })} تنزيل</button>
            ${canDelete ? html`<button type="button" class="btn btn--sm btn--ghost" data-delete style="color: var(--c-danger)">${ico('trash-2', { size: 18 })} حذف</button>` : ''}
          </div>
        </form>
      </div>`;

    await openModal({
      title: `${MEDIA_KINDS[list[index].kind]} — ${p.name}`,
      icon: 'image',
      size: 'lg',
      body: drawBody(list[index]),
      actions: [],
      onOpen(dialog, close) {
        dialog.style.inlineSize = 'min(1180px, calc(100vw - 32px))';
        const bodyEl = dialog.querySelector('.modal__body');
        const redraw = () => { viewerPool.revokeAll(); render(bodyEl, drawBody(list[index])); enhanceDateFields(bodyEl); };
        enhanceDateFields(bodyEl);
        bodyEl.addEventListener('click', async (e) => {
          const t = /** @type {HTMLElement} */ (e.target);
          const nav = t.closest('[data-nav]');
          if (nav) { index = (index + Number(nav.dataset.nav) + list.length) % list.length; redraw(); return; }
          const m = list[index];
          if (t.closest('[data-download]')) {
            downloadBlob(m.blob, `${p.fileNo}-${m.takenAt}-${(m.caption || m.kind).replace(/[\\/:*?"<>|]/g, '')}.jpg`);
          }
          if (t.closest('[data-delete]')) {
            if (!(await confirmDialog({ title: 'حذف هذه الصورة؟', message: 'سيتم حذفها نهائيًا من ملف المريض. لا يمكن التراجع إلا من نسخة احتياطية.', confirmLabel: 'حذف نهائي', danger: true }))) return;
            await deleteMedia(m.id);
            toastSuccess('تم حذف الصورة');
            close(null);
            await reload();
          }
        });
        bodyEl.addEventListener('keydown', (e) => {
          if (/** @type {HTMLElement} */ (e.target).matches('input, select, textarea')) return;
          if (e.key === 'ArrowLeft') { index = (index + 1) % list.length; redraw(); }
          if (e.key === 'ArrowRight') { index = (index - 1 + list.length) % list.length; redraw(); }
        });
        bodyEl.addEventListener('submit', async (e) => {
          e.preventDefault();
          const data = formData(/** @type {HTMLFormElement} */ (e.target));
          const takenAt = data.takenAt ? parseDateInput(data.takenAt) : list[index].takenAt;
          if (data.takenAt && !takenAt) { toastError('تاريخ غير صحيح'); return; }
          try {
            const updated = await updateMedia(list[index].id, { caption: data.caption.trim(), kind: data.kind, tag: data.tag, takenAt });
            list[index] = updated;
            const i = items.findIndex((x) => x.id === updated.id);
            if (i >= 0) items[i] = updated;
            toastSuccess('تم حفظ البيانات');
            drawGrid();
          } catch (err) { toastError(err.message); }
        });
      },
    });
    viewerPool.revokeAll();
  }

  await reload();
  if (query.open) openViewer(query.open);
  return () => pool.revokeAll();
}

/** Side-by-side slider comparison of two images. */
function openCompare(before, after, pool) {
  openModal({
    title: 'مقارنة قبل وبعد',
    icon: 'arrow-up-down',
    size: 'lg',
    body: html`
      <div>
        <div class="compare" id="cmp">
          <img src="${pool.url(before.blob)}" alt="قبل">
          <div class="compare__after"><img src="${pool.url(after.blob)}" alt="بعد"></div>
          <span class="compare__line"></span>
          <span class="compare__knob">${ico('arrow-up-down', { size: 20, className: 'icon--rot' })}</span>
          <span class="compare__label compare__label--before">${MEDIA_TAGS[before.tag] ?? 'الأولى'} · ${formatDate(before.takenAt)}</span>
          <span class="compare__label compare__label--after">${MEDIA_TAGS[after.tag] ?? 'الثانية'} · ${formatDate(after.takenAt)}</span>
        </div>
        <input type="range" min="0" max="100" value="50" class="compare__range" aria-label="تحريك فاصل المقارنة">
      </div>`,
    actions: [{ label: 'إغلاق', value: true }],
    onOpen(dialog) {
      dialog.style.inlineSize = 'min(1100px, calc(100vw - 32px))';
      const box = /** @type {HTMLElement} */ (dialog.querySelector('#cmp'));
      const range = /** @type {HTMLInputElement} */ (dialog.querySelector('.compare__range'));
      const set = (pct) => { box.style.setProperty('--pos', `${pct}%`); range.value = String(Math.round(pct)); };
      range.addEventListener('input', () => set(Number(range.value)));
      let dragging = false;
      const fromEvent = (e) => {
        const r = box.getBoundingClientRect();
        set(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
      };
      box.addEventListener('pointerdown', (e) => { dragging = true; box.setPointerCapture(e.pointerId); fromEvent(e); });
      box.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
      box.addEventListener('pointerup', () => { dragging = false; });
    },
  });
}

