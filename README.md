# svelte-payload

[Payload CMS](https://github.com/payloadcms/payload), recreated in **SvelteKit**.

Payload's admin panel is deeply React/Next.js, so this is not a literal port — it's a
faithful recreation of Payload's *architecture*: one config file in, three things out
(database presence, REST API, admin panel). The engine is framework-agnostic where it
counts, so the same core runs on Node and Cloudflare Workers.

## Use it in your own SvelteKit app

svelte-payload is a package. From this repo:

```sh
npm run package && npm pack        # → svelte-payload-0.1.0.tgz
```

Then in any SvelteKit project (Tailwind v4 assumed):

```sh
npm i ../path/to/svelte-payload-0.1.0.tgz
npx svelte-payload-init            # scaffolds routes, hooks, cms.config.ts, theme
# import '../svelte-payload.css' once in your root layout, then:
npm run dev                        # → /admin, create the first user
```

The scaffolder copies thin route stubs (REST + GraphQL + admin + media) that
import from the package — delete what you don't need, customize what you do.
Everything is driven by your `src/cms.config.ts`.

**Gotchas:**

- **Don't nest the CMS app inside another pnpm project** (e.g. `app/cms/`):
  pnpm hoists resolution to the parent and the package's deps (`graphql`)
  won't resolve. Scaffold a sibling directory instead.
- **Table-backed collections + local dev:** your LOCAL D1 starts empty, so a
  collection mapped to an existing remote table will report "table does not
  exist" until you seed it:
  `npx wrangler d1 execute <db-name> --local --file schema.sql`.
- Engine updates arrive via `npm i <new tarball>`; scaffolded stubs are
  yours and don't auto-update (see CHANGELOG for stub-affecting releases).

## Quick start (this repo — the demo app)

```sh
npm install
npm run dev
```

Open http://localhost:5173/admin — you'll be prompted to create the first user
(they become an admin). Or load demo content first:

```sh
curl -X POST http://localhost:5173/api/seed \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"password123"}'
```

## How it works

Everything is driven by **`src/cms.config.ts`** — the equivalent of
`payload.config.ts`. Declare a collection there and it automatically gets:

- a database presence (no migrations needed)
- REST endpoints at `/api/<slug>` with auth, validation, and access control
- a full admin UI at `/admin/<slug>` (list, search, sort, paginate, create, edit, delete)

```ts
const posts = defineCollection({
  slug: 'posts',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'status', 'author'] },
  access: {
    // Access functions can return booleans OR query constraints:
    read: ({ req }) => (req.user ? true : { status: { equals: 'published' } }),
    create: ({ req }) => Boolean(req.user)
  },
  hooks: {
    beforeValidate: [({ data }) => { /* auto-slug, stamp publishedAt, ... */ }]
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', unique: true },
    { name: 'status', type: 'select', options: [/* … */], defaultValue: 'draft' },
    { name: 'author', type: 'relationship', relationTo: 'users' },
    { name: 'content', type: 'richText' }
  ]
});
```

Field types: `text`, `textarea`, `richText` (markdown-backed), `email`, `number`,
`checkbox`, `date`, `select` (+`hasMany`), `relationship` (+`hasMany`), `array`, `json`.

## REST API (Payload-style)

```
GET    /api/posts?where[status][equals]=published&limit=10&page=1&sort=-createdAt&depth=1
POST   /api/posts
GET    /api/posts/:id
PATCH  /api/posts/:id
DELETE /api/posts/:id
POST   /api/users/login        # sets httpOnly cookie, returns JWT
POST   /api/users/logout
GET    /api/users/me
```

Where operators: `equals`, `not_equals`, `contains`, `in`, `greater_than`,
`less_than`, `exists`. `depth` controls relationship population (related docs are
only populated if the requester has read access to them).

## Local API

Server-side, skip HTTP entirely (like Payload's Local API):

```ts
const posts = await locals.cms.find({ user: locals.user }, 'posts', {
  where: { featured: { equals: true } }
});
await locals.cms.create({ user: null }, 'posts', data, { overrideAccess: true });
```

## Architecture

```
src/cms.config.ts          ← your collections (the only file you usually touch)
src/lib/core/              ← framework-agnostic engine (zero SvelteKit imports)
  types.ts                 ← field/collection/access/hook types
  cms.ts                   ← Local API: CRUD + access + hooks + population
  validate.ts              ← config-driven validation & coercion
  crypto.ts                ← Web Crypto only: PBKDF2 passwords, HS256 JWTs
  adapters/memory.ts       ← in-memory/JSON-file adapter (dev)
  adapters/d1.ts           ← Cloudflare D1 adapter (prod, schema-less JSON docs)
src/lib/server/            ← SvelteKit wiring (adapter selection, cookies)
src/lib/admin/             ← admin UI components (rendered from config)
src/routes/api/...         ← generated REST endpoints
src/routes/admin/...       ← generated admin panel
```

The core uses **only Web Crypto** (no bcrypt, no jsonwebtoken, no Node built-ins),
so it runs identically in `vite dev`, Node, and Cloudflare Workers. Storage is an
adapter interface — JSON file in dev (`.data/db.json`), D1 in production; swapping
databases never touches collection code.

## Deploying to Cloudflare

```sh
wrangler d1 create svelte-payload-db   # then uncomment the binding in wrangler.toml
npm run deploy
```

Set a strong `CMS_SECRET` (Pages env var). The CMS auto-detects the D1 binding.

## Live preview (two separate apps, one database)

Add `admin.preview.url(doc, token)` to a collection — it returns the public
URL the admin shows in a preview pane (form left, resizable iframe right; the
function runs server-side so the CMS never learns your route shape). The admin
mints a short-lived token signed with `CMS_SECRET`; your public site (a
separate deploy sharing the DB) verifies it and renders unpublished content:

```ts
// public site — src/routes/[type]/[slug]/+page.server.ts
import { verifyPreviewToken } from 'svelte-payload/preview';
const claims = await verifyPreviewToken(env.CMS_SECRET, url.searchParams.get('token'));
const doc = claims ? await readDraft(claims.collection, claims.id) : await readPublished(slug);
```

Two modes: the iframe reloads on save (Mode A), and the form postMessages the
in-progress doc as you type for true live preview (Mode B) — subscribe with
`onPreviewData(cb)`. Drop `<PreviewBanner/>` (from
`svelte-payload/PreviewBanner.svelte`) into the previewed page. See
`src/routes/preview/venues/[id]` for a working reference.

## Admin: theming, tabs, filters, bulk

- **Theme** — `admin.theme: 'light' | 'dark' | 'system'`. Every color is a
  `--color-*` CSS variable a consumer can override; the editor surface is its
  own `--sp-canvas` token.
- **Form layout** — `admin.group` on fields + `admin.groupsAs: 'tabs'`
  turns a 60-field form into tabs; `admin.position: 'sidebar'` pulls meta
  fields into a side column.
- **Filters** — `admin.filters: [...]` renders faceted, combinable controls
  (select / boolean / has-content / contains) that build `where` queries,
  URL-synced. Straight SQL for table-backed collections.
- **Bulk** — select rows → publish / unpublish / delete / run a document
  action across the selection.

## Table-backed collections (sit on top of an existing database)

The D1 adapter has two modes. Default is schema-less JSON documents; add
`table` to a collection and it maps onto an **existing SQL table**, one
column per field (the Directus model) — your pipeline-owned relational data
gets the same admin, REST, and GraphQL as everything else:

```ts
const venues = defineCollection({
  slug: 'venues',
  table: { name: 'venues', autoId: true,
           timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
  fields: [/* names must match column names */]
});
```

Where/sort compile to plain SQL, checkbox fields marshal to 0/1, and
array/blocks/json/richText fields marshal to JSON text columns. Integer
autoincrement and uuid ids both supported; timestamps optional. (Drafts
require a `_status` column; localized fields and upload collections aren't
supported in table mode.) In dev the collection runs on the JSON store.

## HTML fields

`type: 'html'` stores a sanitized HTML string — built for content produced
as HTML by external pipelines (AI writers, migrations). Server-side
sanitizer strips scripts/styles/event handlers and unsafe URLs on every
write; the admin edits it with a WYSIWYG (visual + HTML source modes). Use
alongside structured `richText`, each where it fits.

## Drafts & versions

Add `versions: { drafts: true }` to a collection and it gets a managed
`_status` ('draft' | 'published'), full version history in a shadow store, and
a draft workflow in both APIs and the admin (Save draft / Publish / Unpublish /
Restore, with status badges and a versions sidebar):

```
PATCH /api/posts/:id?draft=true          # save a draft; published doc untouched
GET   /api/posts/:id?draft=true          # read the latest draft (update access)
POST  /api/posts/:id/publish             # promote latest draft
POST  /api/posts/:id/unpublish           # hide from published-only readers
GET   /api/posts/:id/versions            # history, newest first
POST  /api/posts/:id/versions/:vid/restore
```

Combined with query-constraint access control
(`read: ({ req }) => req.user ? true : { _status: { equals: 'published' } }`),
anonymous consumers never see unpublished content.

## Blocks

The `blocks` field is Payload's flexible layout builder: an ordered list of
typed sections. Declare block shapes in config; the admin renders an
interactive editor (add / remove / reorder, per-block fields). Values store as
`[{ blockType: 'hero', ... }, { blockType: 'quote', ... }]` — see the `pages`
collection's `layout` field for a working example with four block types.

## Media & uploads

Mark a collection `upload: true` (optionally with `mimeTypes` / `maxFileSize`)
and its documents carry a stored file with managed `filename`, `mimeType`,
`filesize`, and `url` fields. Files live on disk in dev (`.data/uploads`) and
in **R2** in production (uncomment the bucket in `wrangler.toml`), served from
`/media/<key>` with immutable cache headers. Reference uploads from other
collections with the `upload` field type — they populate like relationships:

```sh
curl -b cookies -X POST /api/media -F 'file=@photo.jpg' -F 'alt=A photo'
```

## Globals

Singletons (site settings, nav, footer) declared under `globals` in the
config. `GET/POST /api/globals/<slug>`, edited in the admin under their own
sidebar section, with the same field types and access control as collections.

## Generated TypeScript types

`npm run generate:types` (dev server running) writes `src/generated-types.ts`
from your config — select fields become literal unions, blocks become
discriminated unions on `blockType`, relationships/uploads become
`string | Related`. The Payload `generate:types` experience.

## GraphQL

`POST /api/graphql` with an auto-generated schema: per-collection queries
(`Posts(where, limit, page, sort)`, `Post(id, draft)`), mutations
(`createPost`, `updatePost`, `deletePost`, `publishPost`, `unpublishPost`),
globals, `login`, and `me`. Relationship fields resolve lazily, so query depth
follows your GraphQL selection set. Same access control as REST.

```graphql
{ Posts { docs { title category { title } author { email } } } }
```

## Plugins

Payload-style: a plugin is a config transform, applied in order by
`defineConfig`. See `src/lib/plugins/last-modified-by.ts` — it injects a
read-only field plus a `beforeChange` hook into chosen collections.

## API keys

`auth: { apiKeys: true }` issues each user a key at creation (visible only to
themselves and admins). Authenticate any REST or GraphQL call with:

```
Authorization: users API-Key <key>
```

## Autosave

Drafts-enabled collections autosave in the admin: edits debounce into
background draft saves (published doc untouched), with a status indicator.

## Rich text (structured, with embedded components)

`richText` fields store a JSON array of typed nodes — the Lexical-equivalent.
Text blocks carry sanitized inline HTML (server-enforced whitelist:
strong/em/code/a/s/u); everything else is a first-class node INSIDE the
document flow:

```ts
{
  name: 'content', type: 'richText',
  uploads: 'media',            // embeddable images
  relationships: ['posts'],    // embeddable document references
  blocks: [calloutBlock, ctaBlock]  // typed components, defined in config
}
```

The admin renders a block editor: contenteditable text blocks with a
formatting toolbar, plus add/reorder/delete for lists, quotes, code, dividers,
images, embeds, and your components — each component edits its own typed
fields inline. `$lib/RichTextRenderer.svelte` renders it on the frontend
(`/posts/<slug>` is a working example, with `extractRichTextRefs` resolving
embedded documents server-side). Legacy markdown strings still work.

## Localization

Set `localization: { locales: ['en', 'es'], defaultLocale: 'en' }` and mark
fields `localized: true`. Values are stored per-locale and flattened on read
with default-locale fallback. `?locale=es` on any REST endpoint (or the
`locale` arg in GraphQL) targets that locale for reads AND writes;
`locale=all` returns the raw per-locale objects. Filtering and unique checks
are locale-aware, and the admin gets a locale switcher on edit pages.

## Scheduled publishing

With `versions: { drafts: true, schedulePublish: true }`, drafts whose
`publishAt` date has passed are auto-promoted to published (swept lazily on
reads — no job runner needed).

## Document locking

Opening a document in the admin takes a 5-minute rolling edit lock. A second
editor sees a warning banner naming the current editor; locks release on
save/publish/delete or expire on their own.

## Scope: what's in, what's not

Recreated from Payload: config-driven collections, field types (including
`blocks` and `upload`), auth collections, access control (boolean +
query-constraint), hooks (`beforeValidate`, `beforeChange`, `afterChange`,
`afterRead`, `beforeDelete`, `afterDelete`), unique fields, defaults,
validation, pagination/filtering/sorting, relationship population with depth,
**drafts & version history** (save draft / publish / unpublish / restore /
prune), **media & uploads** (fs/R2 storage adapters, mime/size limits, file
serving), **globals**, **generated TS types**, **GraphQL**, **plugins**,
**API keys**, **autosave**, **localization** (per-field, locale fallback,
locale-aware queries), **scheduled publishing**, **document locking**,
**structured rich text with embedded components** (block editor, XSS-safe
sanitizer, frontend renderer), first-user onboarding, REST + Local APIs,
auto-generated admin.

Not recreated (yet): image resizing/focal point, jobs/queues, email flows
(verification / forgot-password), multi-tenancy, admin i18n, collaborative
cursors.
