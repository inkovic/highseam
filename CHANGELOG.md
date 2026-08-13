# Changelog

## 1.6.0 — 2026-08-13 · Wave 1

The enhanced-fields wave, in the consumer-pressure-tested order: repeater
first (gallery rides it), then gallery, embed, and dedupe. Primitives, not
elements — see ROADMAP.md for what was deliberately not built.

- **The repeater.** `array` sub-fields inside blocks render as real
  add/remove/reorder rows — recursively — instead of a JSON textarea. Rows
  everywhere (blocks and arrays) now collapse to a one-line summary. Row
  add/remove/move correctly mark the form dirty (they're button clicks; no
  native input event fired before).
- **Tags chips editor.** `json` fields that are really string lists opt in
  with `admin: { editor: 'tags' }` — type, Enter adds, ✕ removes, Backspace
  eats the last chip. The hand-typed-JSON-array era ends. (Old JSON-string
  values parse on first edit.)
- **`gallery`** — field type and rich-text node. Ordered upload refs with
  per-item alt/caption overrides riding the `resolveMedia()` precedence;
  identity stays on the media doc. Editor: MediaPicker multi-add, focal-aware
  thumbs, ✎ Edit modal per item, reorder. Per-placement `layout` (from the
  new `media.galleryLayouts` registry — the node stores the NAME, your CSS
  owns the look; the reference renderer emits `data-layout`) and optional
  per-placement `aspect`. Populates like relationships: items gain a `doc`
  at depth ≥ 1. **Migration contract: bare id arrays are accepted and lifted
  to the item shape** — existing stored galleries survive their first save.
- **`embed`** — field type and rich-text node. Paste a URL; the server
  resolves it at save to `{ provider, embedId, title?, thumbUrl? }` via a
  provider registry. Core resolves **YouTube, Vimeo, and any provider you
  register with a fixed oEmbed endpoint — nothing else**; there is no oEmbed
  discovery on purpose (fetching arbitrary editor URLs server-side is an
  SSRF vector; a registry of fixed hosts isn't). Third-party HTML is never
  stored — renderers build iframes from the allowlist. Reference renderer:
  youtube-nocookie, click-to-load facade off the resolved poster frame,
  plain-link fallback for unresolved URLs (flagged loudly in the editor).
  Pasting a bare provider URL into an empty rich-text paragraph becomes an
  embed node. **Migration contract: raw URL strings lift to `{ url }`.**
  Resolution is best-effort: no network → provider + id still fill from URL
  parsing alone.
- **Upload dedupe (content hash).** Uploads carry a managed `contentHash`
  (SHA-256); identical bytes return the existing document (transient
  `_deduped: true` flag) instead of a second doc + storage key. Applies to
  `importMedia` too (new per-item action `'deduped'`) — but only when
  externalKey identity found nothing, and never overwriting provenance.
  Read access applies to the dedupe lookup, so an invisible doc can't leak
  through a hash hit. Opt out per collection: `upload: { dedupe: false }`.
  Table-backed upload collections need a `contentHash` column.

**Stub changes** (run `npx highseam-init --check-stubs` after upgrading):

- `src/routes/admin/[collection]/[id]/+page.server.ts` — load() also returns
  `galleryLayouts: cms.config.media?.galleryLayouts ?? []`.
- `src/routes/admin/[collection]/[id]/+page.svelte` — passes
  `galleryLayouts={data.galleryLayouts}` to `<DocForm>`.
- `src/routes/api/[collection]/import/+server.ts` — result type includes the
  `'deduped'` action.

## 1.5.2 — 2026-08-10

- **Upload sub-fields inside blocks get ✎ Edit… too.** 1.5.0 wired in-context
  media editing on upload fields and rich-text upload nodes but skipped
  upload sub-fields inside `blocks`/`array` rows (and inside rich-text block
  nodes). Now all picker surfaces offer the same edit modal. Patch-sized fix,
  shipped ahead of the roadmap queue on purpose.
- ROADMAP revised against the consumer pressure-test: Wave 1 resequenced
  (repeater first — gallery's editor is repeater machinery), migration
  standing rule (new node types accept-and-upgrade previously stored shapes),
  X dropped from core embed resolvers into the registry (our own argument,
  applied to our own list), upload dedupe (content hash) added to Wave 1,
  crop rect added to Wave 3 with its evidence acknowledged, link field's
  evidence status corrected, collection queries redesigned around a named
  registry.

Stub changes: none.

## 1.5.1 — 2026-08-10

QoL, from the first production day of 1.5.0: the aspect select was the one
control on an upload node whose effect an editor couldn't see until the page
rendered.

- **The node preview shows the crop the reader will get.** When
  `fields.aspect` is set, the upload node's thumbnail renders with the exact
  three properties the renderer emits — `aspect-ratio`, `object-fit: cover`,
  focal `object-position` — and re-renders the moment you change the select.
  Absent aspect = natural thumbnail, unchanged.
- **`RichTextRenderer` no longer falls back to filename for `alt`.** Missing
  alt now renders `alt=""` (decorative) instead of a screen reader announcing
  "IMG_2041.jpg". Filename remains a fine lightbox label and a poor caption;
  captions were already alt-only. (Adopted from the consumer's own renderer
  fix — if yours copies the old template, take the same rule.)

Stub changes: none.

## 1.5.0 — 2026-08-10

Media round 3, from a real editing session: in-context editing, honest
previews, per-placement presentation. The organizing principle stays clean —
the media doc is identity (bytes, focal point, metadata defaults); a
placement is presentation (how this one use renders).

- **In-context media editing.** Every image chip — upload fields and
  rich-text upload nodes — gets ✎ Edit…, opening the media doc's edit
  surface (focal point, aspect previews, alt/caption/credit/tags) in a modal
  over the doc you're editing. Fields come from the collection's own schema
  rendered with the same FieldInput as the full page — one editing surface,
  not a second, lesser form. Saves PATCH through the public API (access,
  hooks, validation all apply). The host form is untouched: modal inputs are
  namespaced so a host save can never pick them up (both venue and media
  declaring `tags` was live ammunition), input events stop at the modal
  boundary so host dirty-tracking never fires, and Cmd-S inside the modal
  saves the modal, not the doc under it. `→ media` full-page deep link stays.
- **Honest previews.** A selected image on an upload field now renders as an
  actual thumbnail (focal-aware, like every thumb since 1.3.0), not a
  filename pill — an editor placing photography sees the photograph. Full
  size is one click away (lightbox in the edit modal).
- **Per-placement aspect on rich-text upload nodes.** `fields.aspect` (ratio
  string; absent = natural — fully non-breaking) with a small select on the
  node card. The sanitizer whitelists it: parseable ratios only, everything
  else on `fields` is dropped. `RichTextRenderer` renders aspected uses with
  `aspect-ratio` + `object-fit: cover` steered by the doc's focal point;
  custom renderers should do the same.
- **One registry, scoped.** Placement vocabulary comes from the same
  `media.aspects` registry, via optional
  `contexts: ('preview' | 'placement')[]` per entry (absent = both). Crop
  strips and placement selects filter accordingly; the node stores the ratio
  string, so config choices stay reversible.

Deferred, on purpose: editing from inside the MediaPicker grid (modal-in-modal;
the chip covers the flow that had evidence) and placement aspect on upload
*fields* (their rendering is consumer layout; no field report yet).

**Stub changes** (run `npx highseam-init --check-stubs` after upgrading):

- `src/routes/api/[collection]/options/+server.ts` — `?schema=1` mode
  returning the collection's client field definitions (auth-gated). Without
  it, the edit modal opens with the image and focal picker but no metadata
  fields.

## 1.4.0 — 2026-08-08

Stub drift made detectable. 1.3.0 half-landed on its only production consumer:
the focal picker worked, but the aspect previews never appeared, because the
consumer's admin route stub predated the release and never passed
`mediaAspects` through. No error anywhere — config valid, install correct,
deploy green. Stubs are consumer-owned on purpose (that's what makes them
customisable); the gap was that drift was invisible.

- **`npx highseam-init --check-stubs`** diffs every consumer stub against the
  installed templates and reports, per file, the template lines your copy is
  missing. Your own customisations are never flagged — only absences. Exits
  non-zero on drift, so it can gate a deploy or run in CI after every
  `npm i highseam@latest`.
- **Dev-mode drift warning in the editor.** When a collection declares a
  `focalPoint` field but the admin route never passed `mediaAspects` (the
  prop is `undefined`, not `[]`), DocForm now `console.warn`s in dev with the
  exact stub, the exact line to add, and the `--check-stubs` pointer. Silent
  half-features are the worst kind of broken.
- **Changelog convention, starting retroactively with 1.3.0:** any release
  that touches a template stub names the file(s) under a "Stub changes"
  heading. If you scaffolded before that release, run `--check-stubs`.

Stub changes: none. (Both fixes live in the packaged library and CLI.)

## 1.3.0 — 2026-08-08

The media editor round, driven by a production field report: one original in
storage, art direction by focal point, zero variant uploads.

- **Focal-point picker.** Upload docs that declare a `focalPoint` field (json)
  now get a hotspot editor in place of the plain image preview — click or drag
  to place the point, Clear to remove. Writes through the normal form
  pipeline, so dirty tracking, autosave-draft, and Cmd-S all behave.
- **Aspect registry + live previews.** Declare the ratios your frontend
  actually renders in `media.aspects` (config), e.g.
  `{ name: 'card', ratio: '3:2' }`. The editor shows a live crop preview per
  aspect, steered by the focal point, so editors see every crop the moment
  they place the point. No registry → picker still works, no strips.
- **`mediaSrc(doc, { width, aspect | height, quality })`** builds Cloudflare
  Image Resizing URLs (`/cdn-cgi/image/…`) with `gravity` from the stored
  focal point. No dimensions → returns the original URL unchanged, so it's
  safe to adopt everywhere before enabling resizing on your zone. Plus
  `parseRatio()`, both exported from `highseam`.
- **Thumbnails honor the focal point everywhere** — admin gallery grid, the
  media picker modal, and relation-picker chips all crop toward the hotspot
  (`focalPoint` now surfaces on the options endpoint / `RelOption`).
- **Fixed: `highseam/themes/*.css` and `highseam/assets/*` imports.** The
  exports map rewrote every subpath to `dist/*.js`, breaking
  `highseam/themes/lodestone.css` and `highseam/assets/favicon.svg` for
  consumers. Non-JS assets now pass through untouched.
- README gotcha for harmless `UNRESOLVED_IMPORT` dep-scan noise on `$app/*`
  imports (silence with `optimizeDeps: { exclude: ['highseam'] }`).
- Starter config now ships a two-aspect registry as a worked example.

Deliberately not shipped: manual per-aspect crop rectangles. The hotspot
covers the aspect-cropping cases we have field evidence for; rects add a
storage schema and a four-handle UI we'd be guessing at. Send evidence.

**Stub changes** (added retroactively — run `npx highseam-init --check-stubs`
if you scaffolded before 1.3.0):

- `src/routes/admin/[collection]/[id]/+page.server.ts` — load() now returns
  `mediaAspects: cms.config.media?.aspects ?? []`.
- `src/routes/admin/[collection]/[id]/+page.svelte` — passes
  `mediaAspects={data.mediaAspects}` to `<DocForm>`.
- Starter `cms.config.ts` gained a `media.aspects` example (starter, not a
  stub — existing configs are unaffected).

## 1.2.1 — 2026-08-07 · security-adjacent fix, upgrade recommended

- **init now protects `.gitignore`.** The SvelteKit skeleton ignores `.env*`
  but not wrangler/highseam conventions, so a consumer could commit
  `.dev.vars` (your `CMS_SECRET`) and — worse, by default — `.data/`, the
  local dev store, which contains **user password hashes** and all content
  after the first dev session. `highseam-init` now appends `.data`,
  `.dev.vars*` and `!.dev.vars.example` to `.gitignore` (idempotent), and
  ships a `.dev.vars.example`.
- **If you scaffolded before 1.2.1:** add those three lines to `.gitignore`
  yourself. If a `.dev.vars` was ever committed, rotate `CMS_SECRET`
  (invalidates sessions + preview tokens; users just log in again). If
  `.data/` was ever pushed to a public repo, treat those user passwords as
  compromised and scrub the history.

Reported from the field by the highseam.com build. (The system works.)



## 1.2.0 — 2026-08-06

Out-of-the-box experience, audited cold and fixed. (First release informed by
walking the public-registry path as a stranger rather than by a field report.)

- **The quickstart no longer 500s.** Following the old init steps literally on
  a fresh SvelteKit app crashed the entire site on first `npm run dev` —
  Tailwind was a prerequisite hidden in a comment. `highseam-init` now wires
  the `@tailwindcss/vite` plugin into `vite.config` and imports the theme in
  your root layout automatically (when those files are recognizable; exact
  manual steps otherwise), detects your package manager, and prints the one
  REQUIRED install command as step 1 — not a footnote. Init leaves a running
  app or says precisely why not.
- **The starter config now shows the flagship.** It previously scaffolded
  users + a bare pages collection — no uploads, no blocks, no embeds, so the
  media system and block editor were invisible until you hand-wrote config.
  The starter is still three collections, but now: a `media` upload collection
  (with the metadata conventions pre-declared), and pages with a sidebar
  cover image, tabbed layout, and rich text carrying image embeds, page
  embeds, and a typed Callout block.
- **Empty states guide instead of shrug.** A pristine dashboard shows a
  three-step "First steps" card; unfiltered empty lists say "No pages yet —
  create the first one" instead of the filter-implying "No documents match".
- **The original theme has a name: `lodestone`.** A lode is a seam of ore; a
  lodestone is the miners' compass. A highseam theme is just a CSS token
  file — `highseam/themes/lodestone.css` ships as the canonical documented
  reference: copy, change values, import after `highseam.css`.



## 1.1.0 — 2026-08-05

Media provenance + import — designed against a real 8.4k-image mirror
pipeline rather than guessed.

- **`cms.importMedia()` + `POST /api/<collection>/import`.** Create-or-update
  keyed on importer-declared identity (`source.externalKey` by default —
  never URL equality, because signed origin URLs rot and re-mint differently
  for the same photo). JSON batches (≤50/call, per-item outcomes
  created/updated/unchanged/error + summary) for paced, resumable, idempotent
  runs; multipart mode for bytes+provenance in one call.
- **Adopt-in-place.** `storageKey` can reference an object that already
  exists in storage: a corpus backfill creates documents without moving a
  byte. Adopted keys are importer-owned — highseam never auto-deletes them
  (`_adopted` marker; replacing bytes through the CMS clears it).
- **Re-mint semantics.** Same `externalKey` with a new originUrl / new
  storage key (e.g. `.jpg` → `.webp`) updates the existing doc: identity and
  usage backlinks survive; no versions on media (replace is the point).
- **`firstUsedIn` is history.** Importer-settable at create, never silently
  overwritten afterwards; live usage stays computed (`findUsage`).
- **Provenance search + panel.** `source.externalKey`, `firstUsedIn.slug`
  and `firstUsedIn.title` join the picker's search fields when declared —
  find an image by the venue slug you remember. Media edit pages gain a
  "Used in N places" panel with backlinks, plus source / origin / first-used
  provenance and an importer-owned indicator.
- Importer timestamps: state them inside `source` (e.g. `mirroredAt`) —
  system `createdAt` remains the import-run date by design.



## 1.0.0 — 2026-08-04 · renamed to **highseam**

The project was previously published as `svelte-payload`. That name described
where it came from rather than what it is, and leaned on someone else's
trademark. It is now **highseam** — a config-driven CMS that runs at the edge
and can sit on top of the database you already have.

**Nothing in your data moves.** The `documents` table, collection slugs,
`_status`, version stores, globals, `_locks`, and every R2 key are keyed by
*your* collection slugs, never by the package name. Your `cms.config.ts` API
is unchanged. Your `/api/...` and `/admin/...` URLs are unchanged.

Migrating an existing app:

```sh
npm uninstall svelte-payload && npm i highseam
npx highseam-init --migrate      # add --dry-run to preview
```

The codemod rewrites imports, `svelte-payload.css` → `highseam.css`, the
Tailwind `@source` path, and `--sp-canvas` → `--hs-canvas` across `src/`.
Two things it can't do for you: the session cookie is now `hs_token`, so
everyone is logged out once; and if you re-copy stubs from `templates/` on
upgrade (recommended), do that as usual.

Renamed identifiers: `--sp-canvas` → `--hs-canvas`, `data-sp-theme` →
`data-hs-theme`, cookie `sp_token` → `hs_token`, bin `svelte-payload-init` →
`highseam-init`.

### Also in 1.0.0 — admin quality pass

- **The save bar is sticky and acknowledges the click.** It no longer scrolls
  out of reach on long forms, the pressed button shows a spinner and "Saving…"
  immediately instead of leaving you waiting for a toast, and both buttons
  disable during the request. An "Unsaved changes" hint sits alongside.
- **Validation errors can no longer hide.** With `groupsAs: 'tabs'`, an error
  on a field in an inactive tab was completely invisible — the save just
  appeared to do nothing. Tabs now show an error-count badge, the form jumps
  to the first tab containing an error, and the field is scrolled into view.



Engine (`dist/`, installed from the tarball) upgrades cleanly via `npm i`.
Scaffolded route stubs are ejected at init time and do NOT auto-update —
re-run templates by hand if a release notes a stub change.

## 0.6.0 — 2026-08-04

Media system v2, part one: finding images, and describing them once.

- **Modal media browser.** Upload fields now open a real library: thumbnail
  grid, search-as-you-type, mime/unused filters, sort, paging, keyboard
  traversal (arrows + enter), and upload-from-inside-the-modal. Nothing is
  loaded until you open it, so it doesn't care how large the library is.
  Ordinary relationships keep the lightweight inline typeahead — the right
  tool for a short list.
- **One endpoint grew rather than a new one appearing.**
  `/api/<collection>/options` now supports `page`/`limit` (returning
  `totalDocs`/`totalPages`), `mime`, `unused`, `sort`, and — for upload
  collections — OR-matching across `filename`, `alt`, `caption`, `credit`,
  `tags` and `source.originUrl`. `Where` is AND-only, so the OR runs as
  parallel access-checked queries merged by id.
- **Media metadata by convention, not injection.** If your upload collection
  declares `alt` / `caption` / `credit` / `tags` / `focalPoint`, they become
  the inherited defaults; if it doesn't, nothing changes. The framework never
  forces a schema on your media collection.
- **`resolveMedia(doc, overrides)`** in core so every renderer resolves
  inheritance identically: image metadata as the default, per-use overrides on
  top, `undefined` meaning inherit and `''` meaning "deliberately empty".
  Ships with `focalObjectPosition()` — honours a hotspot through plain CSS
  `object-fit: cover`, no transform layer required.
- **Usage scanning:** `cms.referencedIds(slug)` and `cms.findUsage(slug, id)`,
  covering direct relationship/upload fields *and* rich-text embeds. Computed
  on demand (O(collections), not O(documents)) rather than as a maintained
  index — always correct, no write-path complexity. Powers the `unused` filter
  and, later, safe-delete warnings.
- Tests: `npm test` (richtext split + media inheritance, 46 assertions).

## 0.5.1 — 2026-08-04

Media UX, and one consistency pull-back.

- **Inline upload from the field.** Upload fields now take a file directly —
  choose or drag-drop — creating the document and selecting it, instead of
  making you leave for the media collection and come back. It POSTs multipart
  to the collection's own create endpoint, so access control, mime/size limits
  and hooks apply exactly as they do for a normal create. No bespoke upload
  route. Works in plain fields, rich-text embeds, and block sub-fields.
- **Media collections render as a gallery.** Collections with `upload: true`
  get a thumbnail grid in the admin list instead of a table of filenames,
  with select-to-bulk still available. Non-upload collections are unchanged.
- **Pull-back: one picker everywhere.** `BlocksInput` was the last editor
  still using a plain `<select>` for relationships (and had grown a bespoke
  upload preview on top of it). It now uses `RelationPicker` like the other
  two — deleting the special case and gaining search, async lookup, chips and
  thumbnails for free.
- **Actionable storage error.** "No file storage configured" now names the
  missing R2 binding and the command to create the bucket, instead of being a
  bare 500. The demo `wrangler.toml` ships the R2 binding uncommented —
  `wrangler dev` simulates it locally with no remote bucket.

## 0.5.0 — 2026-07-25

Post-paste reformatting in the rich text editor. 0.4.1 made paste produce
correct nodes; this makes the resulting block structure editable, which is the
other half of the paste-then-reformat loop.

- **Split on Enter.** Enter in a text node splits it at the caret; the tail
  becomes a new paragraph and the caret follows it. Shift+Enter still inserts
  a `<br>`. Implemented with `Range.extractContents()`, so inline markup is
  closed and reopened correctly rather than sliced mid-tag.
- **Merge on Backspace at node start.** Joins into the previous text node with
  the caret at the join point. Embeds (upload / relationship / block /
  divider) are never concatenated into — backspace on an empty node removes
  that node, and a non-empty one is left alone.
- **Selection-aware block type.** New Text / H2 / H3 / ❝ toolbar buttons. With
  a collapsed caret they retype the whole node (as before); with a sub-range
  selected they split the node into before / selected / after and apply the
  type to the middle. "Select `The rules.` → H2" now does the obvious thing
  instead of promoting the entire paragraph.
- **Empty-inline pruning.** `extractContents()` leaves an empty `<strong></strong>`
  shell on the far side of a cut; new `pruneEmptyInline()` (exported from
  core) strips those so they don't accumulate across splits.
- **Markdown input rules** on an otherwise-empty paragraph: `## `, `### `,
  `> `, `- `/`* `, `1. `, `---`. They only fire when the marker is all that's
  been typed, so they can't eat existing content.
- **Keyboard:** ⌘/Ctrl+⌥+1/2/3 → Text/H2/H3 on the focused node;
  ⌘/Ctrl+Shift+V pastes as plain text, discarding source markup.
- **Add buttons insert after the focused node** instead of always appending.
- Tests: `npm run test:richtext` (jsdom) covers split inside `<strong>`,
  across an `<a>` with attributes, at node start/end, the three-way selection
  split, merge join points, and empty detection.
- No config or stub API changes; pure engine upgrade.

## 0.4.0 — 2026-06-13

Consumer-migration hardening (from a real 8.4k-row adoption).

- **Fix: consumer Tailwind now scans the shipped admin.** The `svelte-payload.css`
  stub carries `@source "../node_modules/svelte-payload/dist"` — without it,
  utilities used only inside packaged components (tab strips, grids, the
  relation picker) never generate and the admin layout collapses. Add this
  line if you're upgrading an app scaffolded before 0.4.0.
- **Fix: SEO attributes survive an `html`-field save.** The sanitizer now
  keeps a `rel` whitelist (nofollow / noopener / noreferrer / sponsored / ugc)
  and `target="_blank"` (force-adding noopener), instead of collapsing every
  link to `rel="noopener"`. Applies to both `html` fields and rich-text inline
  links. `javascript:`/`data:` hrefs are still dropped.
- **Async relationship search** — new `/api/<collection>/options?q=&ids=`
  endpoint (access-checked); the picker debounce-fetches matches instead of
  requiring every row preloaded, so relationships/uploads to large
  (table-backed, 8k-row) collections scale. The searchable picker now also
  drives rich-text upload/relationship embeds and block sub-fields (previously
  plain `<select>`s over preloaded options).
- **Toast store renamed** `toasts.svelte.ts` → `toast-store.svelte.ts` to
  remove the case-insensitive twin of `Toasts.svelte` entirely (belt-and-
  suspenders over the 0.3.2 `.js` fix).
- Stub changes: `svelte-payload.css` (the `@source`), plus the picker/embeds
  ride the packaged `dist` (no stub edit needed). Re-copy `svelte-payload.css`
  from `templates/` on upgrade.

## 0.3.2 — 2026-06-13

Packaging bugfix (thanks to a consumer report).

- **Fix: case-insensitive self-import in the packaged `dist`.** The toast
  runes module `toasts.svelte.ts` compiles to `toasts.svelte.js` and sits
  beside the `Toasts.svelte` component. Importing it extensionless
  (`./toasts.svelte`) case-insensitively resolves to `Toasts.svelte` itself on
  macOS/Windows, breaking every consumer — it only surfaced in the built
  package, since dev-mode resolution probes `.ts` before the ambiguous exact
  match. Now imported as `./toasts.svelte.js` (and the edit-stub template
  emits `svelte-payload/admin/toasts.svelte.js`). The template builder no
  longer double-appends `.js` to specifiers that already carry it.

## 0.3.1 — 2026-06-13

Editing-loop polish (no new systems — tightening the daily experience).

- **Searchable reference picker** — relationship/upload fields now use a
  type-to-filter picker with removable chips (single + hasMany), replacing the
  raw `<select multiple>`. Filters the loaded option list client-side, so it's
  fine against large targets. Image options show thumbnails.
- **Toasts + action UX** — a toast system replaces inline save banners;
  document actions show an inline spinner while running, honor the `confirm`
  flag, disable during the request, and surface the returned message as a
  toast (then refresh the doc + preview).
- **Unsaved-changes guard + ⌘/Ctrl-S** — the edit form tracks dirty state and
  warns before in-app navigation or tab close; Cmd/Ctrl-S saves. The guard
  re-arms after each save.
- No config or stub API changes; pure engine (`dist/`) upgrade. Re-copy the
  edit stub only if you want the toast-based save feedback.

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
