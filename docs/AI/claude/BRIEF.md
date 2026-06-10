# Brief — svelte-payload

Recreate Payload CMS's core in SvelteKit. Not a literal port (Payload's admin is
React/Next); a faithful architectural recreation, framework-agnostic where it counts.

What ships:
- Config-driven collections (`cms.config.ts`) with Payload-style field defs
- Framework-agnostic core in `src/lib/core` (zero SvelteKit imports): validation,
  access control, hooks pipeline, Local API, Web Crypto auth (PBKDF2 + HMAC JWT —
  runs on Node AND Cloudflare Workers)
- Database adapter pattern: in-memory/JSON-file adapter (dev) + D1 adapter (prod)
- Auto-generated REST API: /api/[collection] CRUD + login/logout/me
- Auto-generated admin panel at /admin rendered entirely from the config
- Demo collections: users (auth), posts, categories, pages

Out of scope (documented in README): drafts/versions, GraphQL, media uploads,
Lexical rich text (richText = markdown textarea), localization, plugins.
