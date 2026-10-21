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
4. Dental chart (FDI, SVG) and treatment plans (Kanban, plan options, quote).
5. Appointments: calendar views, chairs and doctors, conflict checks, arrival flow, WhatsApp reminders.
6. Billing: invoices, discounts, installments, ledger, receipts on A4 and 80mm paper, daily cash closing.
7. Inventory and material recipes with automatic deduction, expenses, lab cases.
8. Follow-ups, WhatsApp templates, prescriptions.
9. Dashboard KPIs, charts and alerts; reports; Excel and PDF export.
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
