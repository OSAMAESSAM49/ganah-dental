/**
 * Voice notes in the patient file: a quick recorder (opens recording straight away; «حفظ»
 * stops and saves in one tap) and the list with a player on the overview tab.
 * Audio is recorded on the device (no internet needed) and stored like photos.
 */
import { html, ico, render, on } from '../../core/dom.js';
import { digits, formatDateTime } from '../../core/format.js';
import { can } from '../../core/permissions.js';
import { currentUser } from '../../core/session.js';
import { repos } from '../../data/index.js';
import { openModal, confirmDialog } from '../../components/modal.js';
import { toastSuccess } from '../../components/toast.js';
import { listVoiceNotes, addVoiceNote, deleteMedia, urlPool } from '../../services/media.js';
import { tr } from '../../core/i18n.js';

const MAX_SEC = 5 * 60;
// AAC in MP4 plays on every device (Chrome, Safari, iPhone); WebM is the fallback.
const TYPES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

export const canRecord = () => Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

/** 75 → «1:15» */
export const formatDuration = (sec) => digits(`${Math.floor((sec || 0) / 60)}:${String(Math.floor(sec || 0) % 60).padStart(2, '0')}`);

function micError(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'لم يُسمح باستخدام الميكروفون. اسمح به من إعدادات المتصفح (رمز القفل بجانب العنوان) ثم حاول مرة أخرى.';
  if (err?.name === 'NotFoundError') return 'لا يوجد ميكروفون متصل بهذا الجهاز.';
  return 'تعذّر تشغيل الميكروفون.';
}

/** Records a voice note for the patient. Resolves true when one was saved. */
export async function openVoiceRecorder({ patientId }) {
  let stream = null, rec = null, stopped = null, blob = null, startedAt = 0, seconds = 0, tick = 0;
  let dialog = null;
  const pool = urlPool();

  const stage = () => dialog?.querySelector('#vn-stage');
  const draw = (state, message = '') => {
    if (!stage()) return;
    render(stage(), {
      starting: html`<p class="muted">جارٍ تشغيل الميكروفون…</p>`,
      recording: html`
        <div class="voice-rec__live"><span class="voice-rec__dot" aria-hidden="true"></span><span class="voice-rec__time num" aria-live="off">${formatDuration(seconds)}</span><span class="muted text-sm">/ ${formatDuration(MAX_SEC)}</span></div>
        <p class="muted text-sm">جارٍ التسجيل… اضغط «حفظ» عند الانتهاء.</p>
        <button type="button" class="btn btn--soft btn--sm" data-vn-stop>${ico('square', { size: 16 })} إنهاء التسجيل</button>`,
      done: html`
        <audio controls src="${blob ? pool.url(blob) : ''}"></audio>
        <div class="row" style="gap: var(--sp-2); justify-content: center"><span class="muted text-sm">المدة ${formatDuration(seconds)}</span>
          <button type="button" class="btn btn--ghost btn--sm" data-vn-again>${ico('refresh-cw', { size: 16 })} إعادة التسجيل</button></div>`,
      error: html`<p class="voice-rec__error" role="alert">${message}</p>
        <button type="button" class="btn btn--soft btn--sm" data-vn-again>${ico('refresh-cw', { size: 16 })} حاول مرة أخرى</button>`,
    }[state]);
  };

  const release = () => { clearInterval(tick); stream?.getTracks().forEach((track) => track.stop()); stream = null; };

  const start = async () => {
    blob = null; seconds = 0;
    draw('starting');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      draw('error', micError(err));
      return;
    }
    if (!dialog?.open) { release(); return; } // closed while the permission prompt was up
    const type = TYPES.find((x) => MediaRecorder.isTypeSupported?.(x)) ?? '';
    rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
    const chunks = [];
    rec.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
    stopped = new Promise((resolve) => rec.addEventListener('stop', () => {
      seconds = (Date.now() - startedAt) / 1000;
      blob = new Blob(chunks, { type: (rec.mimeType || type || 'audio/webm').split(';')[0] });
      release();
      draw('done');
      resolve();
    }, { once: true }));
    rec.start(1000);
    startedAt = Date.now();
    draw('recording');
    tick = setInterval(() => {
      seconds = (Date.now() - startedAt) / 1000;
      const time = stage()?.querySelector('.voice-rec__time');
      if (time) time.textContent = formatDuration(seconds);
      if (seconds >= MAX_SEC) stop();
    }, 500);
  };

  const stop = async () => {
    if (rec?.state === 'recording') rec.stop();
    if (stopped) await stopped;
  };

  const result = await openModal({
    title: 'ملاحظة صوتية', icon: 'mic',
    body: html`
      <div class="voice-rec" id="vn-stage"></div>
      <label class="field"><span class="field__label">عنوان (اختياري)</span>
        <input class="input" id="vn-caption" maxlength="80" placeholder="مثال: خطة علاج الضرس"></label>
      <span class="field__error" id="vn-err" role="alert"></span>`,
    actions: [{ label: 'حفظ', value: 'save', variant: 'primary' }, { label: 'إلغاء', value: null }],
    dirty: () => Boolean(blob) || rec?.state === 'recording',
    onOpen(d) {
      dialog = d;
      d.addEventListener('click', (e) => {
        const target = /** @type {HTMLElement} */ (e.target);
        if (target.closest('[data-vn-stop]')) stop();
        if (target.closest('[data-vn-again]')) start();
      });
      start();
    },
    async beforeClose(value, d) {
      if (value !== 'save') return true;
      await stop();
      if (!blob?.size) { d.querySelector('#vn-err').textContent = 'سجّل الملاحظة أولًا.'; return false; }
      const caption = /** @type {HTMLInputElement} */ (d.querySelector('#vn-caption')).value;
      await addVoiceNote(patientId, blob, { durationSec: seconds, caption });
      return true;
    },
  });
  if (rec?.state === 'recording') rec.stop();
  release();
  pool.revokeAll();
  if (result === 'save') toastSuccess('تم حفظ الملاحظة الصوتية');
  return result === 'save';
}

/**
 * The voice-notes card on the overview tab. Draws into `box` and redraws itself after a
 * recording or a delete. @returns {() => void} cleanup
 */
export function mountVoiceNotes(box, { patient }) {
  const pool = urlPool();
  const ac = new AbortController();
  const canAdd = can('patients', 'edit') && !patient.deletedAt && canRecord();

  const draw = async () => {
    const notes = await listVoiceNotes(patient.id);
    const users = new Map((await repos.users.list({ includeDeleted: true })).map((u) => [u.id, u.displayName]));
    const me = currentUser()?.id;
    pool.revokeAll();
    render(box, html`
      <div class="card__header"><div class="card__heading"><h2 class="card__title">ملاحظات صوتية</h2>
        <p class="card__subtitle">${notes.length ? tr`عدد الملاحظات: ${digits(notes.length)}` : 'لا توجد ملاحظات صوتية بعد'}</p></div>
        ${canAdd ? html`<button type="button" class="round-btn" data-vn-record aria-label="تسجيل ملاحظة صوتية" title="تسجيل ملاحظة صوتية">${ico('mic', { size: 18 })}</button>` : ''}</div>
      <div class="card__body">
        ${notes.length ? html`<ul class="voice-list">${notes.map((n) => html`
          <li class="voice-item">
            <div class="voice-item__head">
              <span class="voice-item__icon" aria-hidden="true">${ico('mic', { size: 16 })}</span>
              <div class="voice-item__text"><strong>${n.caption || 'ملاحظة صوتية'}</strong>
                <span class="muted text-sm">${formatDateTime(n.createdAt)} · ${formatDuration(n.durationSec)}${users.get(n.createdBy) ? html` · ${users.get(n.createdBy)}` : ''}</span></div>
              ${can('patients', 'delete') || n.createdBy === me ? html`<button type="button" class="btn btn--ghost btn--icon btn--sm" data-vn-delete="${n.id}" aria-label="حذف الملاحظة">${ico('trash-2', { size: 16 })}</button>` : ''}
            </div>
            ${n.blob instanceof Blob ? html`<audio controls preload="metadata" src="${pool.url(n.blob)}"></audio>` : html`<p class="muted text-sm">الملف لم يصل لهذا الجهاز بعد.</p>`}
          </li>`)}</ul>`
        : html`<p class="muted">${canAdd ? 'سجّل ملاحظة سريعة بصوتك من زر الميكروفون، بدل الكتابة.' : 'لا توجد ملاحظات.'}</p>`}
      </div>`);
  };

  on(box, 'click', '[data-vn-record]', async () => { if (await openVoiceRecorder({ patientId: patient.id })) await draw(); }, { signal: ac.signal });
  on(box, 'click', '[data-vn-delete]', async (_, b) => {
    if (!(await confirmDialog({ title: 'حذف الملاحظة الصوتية؟', message: 'سيتم حذفها نهائيًا من ملف المريض. لا يمكن التراجع إلا من نسخة احتياطية.', confirmLabel: 'حذف نهائي', danger: true }))) return;
    await deleteMedia(b.dataset.vnDelete);
    toastSuccess('تم حذف الملاحظة');
    await draw();
  }, { signal: ac.signal });
  draw();
  return () => { ac.abort(); pool.revokeAll(); };
}
