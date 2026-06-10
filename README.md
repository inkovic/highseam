# svelte-payload

[Payload CMS](https://github.com/payloadcms/payload), recreated in **SvelteKit**.

Payload's admin panel is deeply React/Next.js, so this is not a literal port — it's a
faithful recreation of Payload's *architecture*: one config file in, three things out
(database presence, REST API, admin panel). The engine is framework-agnostic where it
counts, so the same core runs on Node and Cloudflare Workers.

## Quick start

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

## Scope: what's in, what's not

Recreated from Payload: config-driven collections, field types, auth collections,
access control (boolean + query-constraint), hooks (`beforeValidate`, `beforeChange`,
`afterChange`, `afterRead`, `beforeDelete`, `afterDelete`), unique fields, defaults,
validation, pagination/filtering/sorting, relationship population with depth,
first-user onboarding, REST + Local APIs, auto-generated admin.

Not recreated (yet): drafts & versions, GraphQL, file uploads/media, the Lexical
rich-text editor (richText is a markdown textarea), localization, jobs/queues,
plugins, globals.
