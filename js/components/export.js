/**
 * Table exports shared by every report: Excel (ExcelJS, loaded on demand from /vendor)
 * and PDF (the print stylesheet + the browser's "Save as PDF").
 *
 * A column: { header, key, type?: 'text'|'money'|'number'|'date'|'percent', width?, value?: (row) => any }
 *   money values are piasters (shown as pounds); dates are 'YYYY-MM-DD'; percent is 0..1.
 */
import { html } from '../core/dom.js';
import { formatMoney, formatDate, formatNumber, formatPercent, todayISO } from '../core/format.js';
import { getSettings } from '../data/settings.js';
import { printHTML } from './print.js';

let excelJsPromise = null;
/** Loads vendor/exceljs/exceljs.min.js once (≈1 MB, only when exporting). */
export function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  excelJsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/exceljs/exceljs.min.js', import.meta.url).href;
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => { excelJsPromise = null; reject(new Error('تعذّر تحميل مكتبة Excel')); };
    document.head.append(s);
  });
  return excelJsPromise;
}

const cellValue = (col, row) => (col.value ? col.value(row) : row[col.key]);

/** Display text of a cell (for print and on-screen tables). */
export function cellText(col, row) {
  const v = cellValue(col, row);
  if (v === null || v === undefined || v === '') return '—';
  switch (col.type) {
    case 'money': return formatMoney(v);
    case 'date': return formatDate(v);
    case 'number': return formatNumber(v);
    case 'percent': return formatPercent(v * 100, { decimals: 1 });
    default: return String(v);
  }
}

/** Triggers a browser download for a Blob. */
export function downloadBlob(blob, fileName) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const VIOLET = 'FF4A0CD3', LAVENDER = 'FFEDE6FD';

/**
 * Builds and downloads an .xlsx file with one sheet per section (right-to-left sheets,
 * styled header, number formats, frozen header row, autofilter, totals row).
 * @param {{ fileName: string, title: string, subtitle?: string,
 *   sheets: Array<{ name: string, columns: object[], rows: object[], totals?: object }> }} o
 */
export async function exportExcel({ fileName, title, subtitle = '', sheets }) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const clinic = getSettings('clinic');
  wb.creator = clinic.name;
  wb.created = new Date();
  const used = new Set();
  for (const sh of sheets) {
    // Sheet names: max 31 chars, no []:*?/\ and unique.
    let name = sh.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'ورقة';
    while (used.has(name)) name = `${name.slice(0, 28)} ${used.size}`;
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }] });
    const n = sh.columns.length;
    ws.columns = sh.columns.map((c) => ({ key: c.key, width: c.width ?? (c.type === 'money' ? 16 : c.type === 'date' ? 13 : 22) }));
    ws.mergeCells(1, 1, 1, Math.max(1, n));
    ws.getCell(1, 1).value = `${clinic.name} — ${title}`;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: VIOLET } };
    ws.mergeCells(2, 1, 2, Math.max(1, n));
    ws.getCell(2, 1).value = [subtitle, `تاريخ الاستخراج: ${formatDate(todayISO())}`].filter(Boolean).join(' · ');
    ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF555555' } };
    const header = ws.getRow(4);
    sh.columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VIOLET } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    header.height = 22;
    const put = (r, bold = false) => {
      const xr = ws.addRow([]);
      sh.columns.forEach((c, i) => {
        const cell = xr.getCell(i + 1);
        const v = cellValue(c, r);
        if (v === null || v === undefined || v === '') return;
        if (c.type === 'money') { cell.value = v / 100; cell.numFmt = '#,##0.00'; }
        else if (c.type === 'number') { cell.value = Number(v); cell.numFmt = '#,##0.###'; }
        else if (c.type === 'percent') { cell.value = Number(v); cell.numFmt = '0.0%'; }
        else if (c.type === 'date') { const [y, m, d] = String(v).slice(0, 10).split('-').map(Number); cell.value = new Date(Date.UTC(y, m - 1, d)); cell.numFmt = 'dd/mm/yyyy'; }
        else cell.value = String(v);
        if (bold) { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LAVENDER } }; }
      });
      return xr;
    };
    for (const r of sh.rows) put(r);
    if (sh.totals) put(sh.totals, true);
    if (sh.rows.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + sh.rows.length, column: n } };
  }
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

/** Printable table markup (also used by printReport). */
export const printTable = ({ columns, rows, totals }) => html`
  <table class="print-table">
    <thead><tr>${columns.map((c) => html`<th class="${c.type === 'money' || c.type === 'number' || c.type === 'percent' ? 'num' : ''}">${c.header}</th>`)}</tr></thead>
    <tbody>
      ${rows.map((r) => html`<tr>${columns.map((c) => html`<td class="${c.type === 'money' || c.type === 'number' || c.type === 'percent' ? 'num' : ''}">${cellText(c, r)}</td>`)}</tr>`)}
      ${totals ? html`<tr class="print-total">${columns.map((c) => html`<td class="${c.type === 'money' || c.type === 'number' || c.type === 'percent' ? 'num' : ''}"><strong>${cellValue(c, totals) === undefined ? '' : cellText(c, totals)}</strong></td>`)}</tr>` : ''}
    </tbody>
  </table>`;

/**
 * Prints a report (A4) — choose "Save as PDF" in the print dialog for a PDF.
 * @param {{ title: string, subtitle?: string, summary?: Array<[string, string]>, sections: Array<{ heading: string, columns: object[], rows: object[], totals?: object }> }} o
 */
export function printReport({ title, subtitle = '', summary = [], sections }) {
  printHTML(html`
    ${subtitle ? html`<p class="print-subtitle">${subtitle}</p>` : ''}
    ${summary.length ? html`<div class="inv-meta">${summary.map(([k, v]) => html`<span>${k}: <strong>${v}</strong></span>`)}</div>` : ''}
    ${sections.filter((s) => s.rows.length).map((s) => html`<h2 class="print-sub">${s.heading}</h2>${printTable(s)}`)}`, { size: 'a4', title });
}
