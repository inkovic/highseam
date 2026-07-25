# Handoff to core chat: rich text paste support (shipped as 0.4.1, needs review)

*From the PawScapes site chat, 2026-07-25. Rule breach acknowledged: the site chat edited
core because paste-flattening blocked the CMS's main feature mid-launch. Forgiven once;
this doc is the proper handoff. Going forward site chats file an MD like this instead.*

## The bug (root cause, confirmed)
- `RichTextInput.svelte` had NO paste handling. Browser-default paste dumped an entire
  multi-block document into ONE node's contenteditable.
- On save, `sanitizeNodes` -> `sanitizeInlineHtml` allows inline tags only
  (strong/em/a/code/s/u/br) per text node, so every `<p>`, `<blockquote>`, heading was
  stripped keeping text. Result: one run-on paragraph. Formatting "lost".
- Repro (pre-fix): copy any multi-paragraph HTML, or raw markup as plain text, paste
  into a text block, save.

## What was changed — commit 3349bcf (src is canonical)
- `src/lib/core/richtext.ts`: new exported `htmlToNodes(html)`. DOMParser walk:
  p -> p, h1/h2 -> h2, h3-h6 -> h3, blockquote -> quote (multi-p joined with <br>),
  ul/ol -> items, pre -> code, hr -> divider; div/section/table wrappers recursed;
  loose inline runs coalesce into paragraphs; Google-Docs/Word `span[style]`
  bold/italic converted to strong/em BEFORE the span is sanitized away; img/figure/
  script/style skipped (uploads stay first-class author-placed nodes); every block
  passes through `sanitizeInlineHtml`. Browser-only (returns [] without DOMParser).
- `src/lib/admin/RichTextInput.svelte`: `onpaste` on text blocks + list items ->
  `clipboardToNodes`: text/html if blocky; plain text that starts with `<` and looks
  blocky (raw markup pasted as text - the exact user case) -> `htmlToNodes`; plain
  text with blank lines -> p nodes; otherwise null = native inline paste (still
  sanitized on save). Insert semantics: replaces the current node if it is an empty
  text node, else inserts after it. preventDefault only for structured pastes.
- `package.json` -> 0.4.1.

## The dist caveat (important)
`dist/` is gitignored and the PawScapes device VM could NOT run `npm run package`
(rolldown native binding is darwin in node_modules; VM is linux-arm64, offline).
So dist/core/richtext.js + dist/admin/RichTextInput.svelte were HAND-SYNCED to match
src and packed as `svelte-payload-0.4.1.tgz`, now committed in pawscapes-cms (ac44047,
dep bumped). The running CMS's node_modules copy was patched identically + vite cache
cleared.

## Core chat TODO
1. Review 3349bcf.
2. `npm run package && npm pack` on a real machine; diff against the hand-synced
   tarball (should be equivalent for touched files); replace tarball in pawscapes-cms
   and `pnpm install`.
3. Tests for `htmlToNodes`: clean p/strong/blockquote doc; raw-markup-as-plain-text;
   Google Docs span soup; Word MsoNormal; nested lists (currently flatten into the
   parent item's text); loose inline runs; script/style stripping.
4. Known v1 limits worth roadmapping: no caret-split (paste inserts at node
   granularity); images skipped (future: <img> -> upload node via media import);
   tables flatten to paragraphs; node-splice inserts aren't in the contenteditable
   undo stack.
