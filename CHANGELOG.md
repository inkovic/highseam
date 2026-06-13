# Changelog

Engine (`dist/`, installed from the tarball) upgrades cleanly via `npm i`.
Scaffolded route stubs are ejected at init time and do NOT auto-update —
re-run templates by hand if a release notes a stub change.

## 0.3.0 — 2026-06-12

Live preview, theming, and directory-scale admin (8k-row feedback, round 2).

- **Live Preview** — `admin.preview.url(doc, token)` on a collection. The
  admin mints a short-lived HS256 token (your `CMS_SECRET`) and shows a
  resizable preview iframe beside the form: reloads on save (Mode A) and
  postMessages the in-progress doc as you type (Mode B). New front-end export
  **`svelte-payload/preview`** (`verifyPreviewToken`, `onPreviewData`,
  `isPreviewing`) + **`svelte-payload/PreviewBanner.svelte`** — wire the
  public site in ~10 lines. `src/routes/preview/venues/[id]` is a reference
  implementation.
- **Theming** — `admin.theme: 'light' | 'dark' | 'system'` (default system).
  All colors are overridable `--color-*` tokens; the editor canvas is its own
  `--sp-canvas` token so it can stay "paper" in a dark shell — or not.
- **Tabs + sidebar** — `admin.groupsAs: 'tabs' | 'sections'`; per-field
  `admin.position: 'sidebar'` for a meta column.
- **Faceted filters** — `admin.filters: ['suburb', 'dog_friendly', ...]`
  renders combinable controls (select / yes-no / has-content / contains) that
  build `where` queries (straight SQL in table mode), with URL-synced state.
- **Bulk actions** — row select → bulk publish / unpublish / delete, and bulk
  **run a document action** (e.g. enrich 50 rows).
- **Image-preview fields** (`admin.preview: 'image'`), per-doc "Open on site"
  link, `upload hasMany` galleries.
- Stub change: list + edit page stubs gained filters/bulk/preview — re-copy
  from `templates/` to pick them up in an existing app.

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
