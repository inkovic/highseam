# Changelog

Engine (`dist/`, installed from the tarball) upgrades cleanly via `npm i`.
Scaffolded route stubs are ejected at init time and do NOT auto-update —
re-run templates by hand if a release notes a stub change.

## 0.2.0 — 2026-06-12

Adoption feedback release (driven by a real 8,400-row deployment).

- **Field grouping** — `admin.group: 'Details'` on any field renders it in a
  collapsible section; ungrouped fields stay on top. Tames wide table-backed
  edit forms.
- **Custom document actions** — `admin.actions: [{ label, url, confirm? }]`
  on a collection renders buttons on the edit page that POST
  `{ collection, id }` to your endpoint (e.g. "Generate with AI").
- **Friendly D1 table errors** — `no such table` / `no such column` on
  table-backed collections now explain the local-vs-remote D1 situation and
  the wrangler seed command instead of dumping a SQLite stack.
- **`defineGlobal()`** helper for config symmetry with `defineCollection()`.
- **`upload` fields support `hasMany`** — image galleries on one field
  (multi-select in admin, array population in APIs).
- **Breaking (custom adapters only):** `DatabaseAdapter.init` receives
  `AdapterStoreInfo[]` instead of `string[]` (carried over from 0.1.x
  table-mode work; no change needed unless you wrote your own adapter).
- Stub change: `admin/[collection]/[id]/+page.svelte` gained action buttons —
  re-copy from templates if you want them in an existing app.

## 0.1.0 — 2026-06-10/11

Initial release: config-driven collections; generated REST + GraphQL + admin;
auth (sessions + API keys); access control (boolean or query constraints);
hooks; drafts & versions (publish/unpublish/restore/prune, autosave,
scheduled publishing); blocks; structured rich text with embedded components
(+ XSS-safe sanitizer + renderer); HTML fields; media/uploads (fs + R2);
globals; localization; document locking; plugins (config transforms);
generated TS types; table-backed collections (D1 column-per-field);
packaging + `svelte-payload-init` scaffolder.
