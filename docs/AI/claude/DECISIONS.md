# Decisions

- 2026-06-10 — No literal port: Payload's admin is React/Next. Recreated the
  architecture instead: config → engine → generated REST + admin.
- 2026-06-10 — Web Crypto only (PBKDF2 + HS256 JWT) so core runs on Node AND
  Workers without bcrypt/jsonwebtoken.
- 2026-06-10 — Schema-less D1 adapter (one `documents` table, json_extract
  queries) = zero migrations when config changes; mirrors Payload+Mongo trade.
- 2026-06-10 — Access functions may return a Where query (Payload parity),
  e.g. anonymous readers constrained to status=published.
- 2026-06-10 — Edit forms load docs at depth 0 (raw relationship ids);
  list/REST default depth 1 (populated).
- 2026-06-10 — Scoped out: drafts/versions, GraphQL, uploads, Lexical
  richtext (markdown textarea instead), localization. Listed in README.
- 2026-06-10 — Sandbox quirk: outputs mount forbids unlink; build/verify in
  ~/work/svelte-payload, rsync source back.
