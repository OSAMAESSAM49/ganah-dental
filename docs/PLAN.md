# Ganah Dental: build plan and decisions

Approved on 2026-10-21. This file records decisions so later phases stay consistent.

## Hard constraints
- The app is 100% static and hosted on GitHub Pages. Anything that needs a backend or a paid service is flagged before it is built.
- Plain HTML, CSS and ES modules. No build step and no npm needed to run. Every library is stored locally in `/vendor`.
- Hash routing and relative paths, so the app works under a `/repo-name/` sub-path.

## Decisions
| Topic | Decision |
|---|---|
| Font | Thmanyah is loaded only via CSS `local()`, because its license forbids hosting the files. IBM Plex Sans Arabic (OFL) is the stored fallback. |
| Devices | One main device for now. A "merge import" from other devices' backups comes in phase 10, matching records by UUID and keeping the newest `updatedAt`. |
| Primary color | `#4A0CD3` (from the logo). `#7D39EB` is secondary. Lime `#C6FF33` is an accent and always sits behind black text. |
| Visual style | Follows the dashboards in `references/`: lavender-gray background, borderless cards with large radii, pill buttons and filters, round icon buttons, a violet hero KPI card with lime delta pills. Dark mode uses charcoal, lime and violet. |
| Money | Stored as integer piasters. Shown as `1,250 ج.م`. |
| Dates | Stored as `YYYY-MM-DD` (local day) or ISO timestamps. Shown as DD/MM/YYYY, with a 12-hour clock and ص/م. |
| Digits | A clinic setting: Western (default) or Arabic-Indic. Applied only when displaying; inputs accept both. |
| IDs | `crypto.randomUUID()`. Every record has createdAt, updatedAt, createdBy and updatedBy. |
| Deleting | Patients and inventory are soft-deleted and can be restored. Payments and invoices are voided with a reason, never deleted. |
| Billing | One invoice per visit; installments belong to an invoice. |
| Stock | Tracked per batch with expiry, using the earliest expiry first. Each recipe line is deducted either "per session" or "at completion". |
| Excel / PDF | Excel files are made with ExcelJS (styled headers, right-to-left sheets). PDFs come from the print stylesheet and the browser's "Save as PDF". |
| File number | `G-00001` |
| Admin lockout | A recovery code is printed at setup. |

## Architecture
- `js/data/adapter-indexeddb.js` is the only code that knows about IndexedDB. Repositories (`repository.js`) use a backend-neutral adapter interface, so a Supabase or Firebase adapter can replace it.
- Schema changes are added to `js/data/migrations.js` as new entries. A migration that has shipped is never edited.
- Business rules that span several stores live in `js/services/` and run in one atomic `adapter.transaction()`.
- Marking a treatment item Done runs a list of handlers (stock, follow-ups, chart, billing) that later phases plug into.
- Views export `{ title, render(ctx) }`. `ctx.signal` aborts when the user leaves the view.
- All markup goes through the escaping `html` template tag in `js/core/dom.js`.

## Phases
1. ✅ Skeleton: design system, right-to-left shell, router, storage and migrations, PWA, dev server, tests.
2. ✅ Accounts: setup wizard, login (PBKDF2, 310k iterations) with password or PIN, recovery code, roles, the permission matrix with per-user overrides, idle auto-lock, user switching, audit log.
3. ✅ Patients and medical history, photos & X-rays (stored as Blobs, before/after compare), the procedures catalog (seeded, prices start at 0), global search, and basic backup and restore.
4. ✅ Dental chart (FDI, SVG, surfaces, history) and treatment plans (Kanban with pointer drag & drop, list, options, quote, done-hooks).
5. ✅ Appointments: day/week/month/list views, chairs and doctors, conflict checks with nearest free slot, arrival flow, WhatsApp reminders, visits tab, live dashboard list.
6. ✅ Billing: invoices from done items + extra lines, discounts, credit, pay-now / installments / later, payments (4 methods), void with reason, ledger, A4 and 80mm prints, outstanding balances, overdue installments, daily cash closing.
7. ✅ Inventory (batches with expiry and cost, FEFO, movements, adjustments, alerts, shopping list), material recipes with editable deduction on done and return on undo, material cost and margin per procedure, expenses (categories, receipts, recurring monthly), lab cases with cost → expense sync.
8. ✅ Follow-ups, WhatsApp templates, prescriptions.
9. ✅ Dashboard KPIs, charts and alerts; reports; Excel and PDF export.
10. Full backup with images, merge import, demo data, polish, Arabic README and role guides.

## Phase 2 notes
- The session lives in `sessionStorage`. A reload keeps you signed in; closing the tab signs you out; an idle tab asks for login again.
- Admin-only modules (`users`, `audit`) cannot be granted to any other role or user. The Admin role always has everything.
- Safety rules: at least one active Admin must remain, and you cannot disable, delete or demote yourself.
- Audit entries are written by `repoHooks.afterWrite` for the stores listed in `AUDITED_STORES` (`js/services/audit.js`). Add new stores there in later phases. Secrets and images are never copied into the log.
- `dateField` (`js/components/date-field.js`) is the standard date input from now on: always DD/MM/YYYY, with a calendar that starts on Saturday.

## Phase 3 notes
- Schema v3 adds patients (unique fileNo index), media, procedureCategories and procedures. It also seeds the catalog from `js/data/seed-catalog.js`.
- Counters (`nextCounter`) live in meta as `counter.<name>` and are incremented in a transaction. Invoices and receipts will reuse them.
- `patient.searchText` is a normalized string used for search. It is rebuilt on every save and excluded from audit diffs.
- `patient.medical = { items: {key: true}, allergyOther, medications, notes, updatedAt, updatedBy }`. Severity levels are defined in `js/core/medical.js`; `medicalAlerts(p)` drives every banner.
- Each media record holds two Blobs: `blob` (≤2000px JPEG) and `thumb` (≤360px). Views must release object URLs with `urlPool().revokeAll()`.
- The backup format is `{ app, format: 1, schemaVersion, stores }`, with Blobs written as `{ __blob: mime, data: base64 }`. Data transforms for old backups go in `BACKUP_UPGRADES`.
- `isProcedureUsed` checks `treatmentItems` once phase 4 creates that store. It needs a `procedureId` index.

## Phase 4 notes
- The chart is event-sourced: `toothEvents { tooth, type add|remove|clear, condition, surfaces, at, voided, source, treatmentItemId }`. `foldChart(events, until)` in `js/core/chart-conditions.js` builds the chart for any date. Events are voided, never deleted, so they are not copied into the audit log.
- Rules applied while building the chart: a filling or temporary filling replaces caries on the same surfaces; "missing" clears the tooth (a bridge stays); "implant" removes missing, extract, caries, fillings and root canal.
- Each procedure has a `chartEffect` (a condition key or `''`). Migration v4 inferred it for existing procedures by name, and the procedure dialog lets the clinic change it.
- Plan statuses are active, proposal, rejected and completed. Only items in an active or completed plan can be started or finished. `choosePlan` rejects the other plans that have not started.
- Items: per-tooth procedures become one item per tooth. Money is `itemMath` (piasters, discount by amount or percent, capped at the price). `total` is stored but always recomputed.
- **Extension point:** `registerDoneHandler({ key, describe, onDone, onUndone })` in `js/services/treatment.js`. The chart handler is built in. Phase 7 adds stock deduction (showing materials in `describe`), and phase 8 adds follow-ups.
- Drag and drop uses pointer events (mouse, touch and pen), with buttons as the keyboard and accessibility path.

## Phase 5 notes
- Each appointment stores a local `date` ('YYYY-MM-DD') plus `startMin` and `duration` in minutes, so there are no time-zone issues. The week starts on Saturday (`js/core/time.js`).
- `findConflicts` counts an overlap when it shares a chair, a doctor or a patient. Only these statuses block a slot: booked, arrived, in chair and done. The booking dialog warns about a conflict and allows an override after confirmation.
- Schedule settings (chairs, hours per weekday, slot step, default duration, reminder template) live in settings key `schedule` (`js/services/schedule.js`).
- Reminders are wa.me links that staff send by hand, and `reminderSentAt` records the send. Automatic sending needs a backend (out of scope).
- Views refresh on `data:changed` for appointments, because dialogs (edit, follow-up) can finish after the details dialog closes.
- The calendar root class is `.sched`. `.cal` belongs to the date-picker popover.

## Phase 6 notes
- Invoices are immutable after creation; to fix one, void it with a reason. Voiding releases its treatment items (`invoiceId` → null) and leaves its payments as account credit.
- A payment with no invoice is an advance. Patient credit = unlinked payments − Σ invoice.appliedCredit. Balance = Σ live invoice totals − Σ live payments.
- Installments live on the invoice (`installments[]`). Coverage = paid − `installmentsBase`, which excludes the deposit and credit applied at creation (or amounts paid before a re-plan), applied in due-date order. Use `invoiceInstallments(inv, paid)`, not `installmentsState` directly.
- Numbers come from meta counters (`counter.invoiceNo`, `counter.receiptNo`) and are displayed as INV-00001 and RC-00001.
- An invoiced treatment item can no longer change status or price (enforced in `treatment.js`).

## Phase 7 notes
- Stock: `stockBatches` hold the remaining qty per delivery (cost, expiry). `stockMovements` are the history (purchase, adjust_in, adjust_out, consume, return). `item.qty` (Σ movements) and `item.costPerUnit` (weighted average of remaining batches) are caches rebuilt by `recomputeItem`.
- Shortfalls are recorded without a batch, so the item goes negative instead of blocking treatment. A stocktake then fixes it.
- Recipe line `{ itemId, qty, per: 'completion'|'session' }`. `stockPreview(item)` gives the defaults, and the done dialog passes the edited lines as `setItemStatus(id, 'done', { consumption })`. Undo creates "return" movements into the same batches.
- Done-handlers now receive `(item, opts)`. The stock handler is registered by importing `services/inventory.js` (done in `app.js`).
- Recurring expenses are generated by `generateRecurringExpenses()` at boot and when the expenses page opens. It is idempotent, keyed by `refId = <templateId>:<YYYY-MM>`.
- Lab cases keep one linked expense (`refId = labCase.id`) in sync with their cost. Cancelling or deleting a case removes the expense.
- Audit: stock movements and batches are not audited (they are the history themselves). Cached fields (`qty` and `costPerUnit` on items, `status` on invoices) are ignored in diffs.

## Phase 8 notes
- Stores (v8): `instructionTemplates`, `followUps` (indexes dueDate, patientId, treatmentItemId), `medicines`, `rxTemplates`, `prescriptions` (patientId, date). Seeds live in `js/data/seed-rx.js`.
- Procedures gain `instructionTemplateId` and `followUpSchedule: [{ offsetDays, type: call|check|recall, note }]`, edited in the procedure dialog and cleaned by `cleanProcedure`.
- The follow-ups done-handler (`services/followups.js`, imported in `app.js`) creates follow-ups dated from the day the item is done, and removes the still-pending ones on undo. `describe()` may now be async; `describeDone` returns a promise.
- After "done", `offerInstructions(item)` (`modules/followups/shared.js`) offers the WhatsApp/copy/print instructions message. It does nothing when the procedure has no template.
- Message texts live in settings key `messages` (`{ instructions, call, check, recall }`), with placeholders {الاسم} {الاسم_الكامل} {الإجراء} {العيادة} {هاتف_العيادة} {التعليمات}. Defaults are in `DEFAULT_MESSAGES`.
- Prescriptions are numbered from `counter.rxNo` (Rx-0001). Lines are snapshots `{ medicineId, name, form, dose, duration, notes }`, so editing a medicine never changes old prescriptions. `rxWarnings(patient, lines, medicinesById)` maps medicine `groups` (penicillin, nsaid, pregnancy) against the medical-history keys. Printing uses `printHTML(…, { size: 'a5' })`.
- Migration caveat: several migrations iterate the same store with cursors inside one upgrade transaction. A later cursor can read a value before an earlier cursor's update lands, so v8 re-reads each procedure (`get` then `put`) and repairs `chartEffect`. Follow the same pattern for future backfills.

## Phase 9 notes
- `js/services/reports.js` is read-only aggregation for a period [from, to]: collections (non-void payments, cash basis), production (items whose `doneAt` local day is in the period, valued with `itemMath`), billed (non-void invoices). Periods of up to 62 days are bucketed by day, longer ones by month. `presetRange` names the period chips; weeks start on Saturday.
- Material cost per treatment = consume − return movements linked by `treatmentItemId`. The doctor of an item is `doctorId` if set, otherwise whoever marked it done (`statusHistory`).
- Charts: `js/components/chart.js` draws SVG columns (no library) at the container's measured width (`mountChart`, redrawn by a ResizeObserver) so text never scales. RTL: the first period is on the right. One y-axis only. Series colours `--chart-1/--chart-2` (css/reports.css) were checked with the dataviz palette validator for light and dark surfaces. Hover tooltips come from `wireCharts`.
- Export: `js/components/export.js` takes one column spec (`{ header, key, type: money|date|number|percent|text, value? }`) for the on-screen table, Excel (`exportExcel`, ExcelJS loaded on demand from /vendor, RTL sheets, frozen header, totals row) and PDF (`printReport` → print stylesheet → "Save as PDF").
- The dashboard compares this month with the same days of last month (`dashboardKpis`) and lists alerts gathered from each module the user can view.
