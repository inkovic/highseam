# Roadmap — enhanced fields

Written 2026-08-10 after the 1.5.x media rounds; revised same week against
the consumer ledger (PawScapes pressure-test). Inspiration screened from
WPBakery's 50-element catalogue (plus its 9 deprecated); the working method is
the opposite of a catalogue. WPBakery's deprecated list — Button 1.0, Button
2.0, Tabs 1.0, Accordion 1.0, Google+, Tweetmeme — is the argument: store
presentation as content and every redesign deprecates your content;
provider-specific elements rot with their platforms. Strip presentation away
and 50 elements collapse into about six primitives. highseam builds the
primitives; consumers own the skins.

(The consumer lived the miniature: `toomuc-hero_16x9_1.jpg` was presentation
stored as content, and it rotted the moment the hero frame changed shape. The
focal-point rounds fixed it by moving presentation out of the pixels.)

The collapse, for reference:

| WPBakery category (count) | Primitive |
| --- | --- |
| Tabs, Tours, Accordion, FAQ, Pageable, Toggle, Sections (13+) | labeled groups: `[{label, content}]` — tabs vs accordion is a renderer decision |
| Single Image, Gallery, Carousel, Media/Masonry Grids, Flickr (8+) | ordered upload refs + per-item overrides + layout hint |
| Video Player, Google Maps, social buttons (6+) | URL → typed provider (`embed`) |
| Post Grid, Masonry Post Grid, Post Slider, Woo (5+) | declarative collection query |
| Button, CTA, Copyright | `link` primitive + consumer blocks |
| Raw HTML / Raw JS | `html` field exists / refused forever |
| Separators, Empty Space, Icons, Charts, Custom Heading | not content — themes, consumer CSS, consumer blocks |

Standing rules for every wave: sanitizer whitelist + documented renderer
contract per new node; every control previews live (the 1.5.1 lesson: a
control whose effect isn't visible is the one editors trust least); identity
stays on the doc, presentation on the placement; stub changes named in the
CHANGELOG; `--check-stubs` catches drift; nothing ships without a consumer
that will use it the same week. **And a migration rule: any new node or field
type that replaces a shape consumers already store (gallery blocks holding
bare id arrays, embed blocks holding raw URLs) must accept-and-upgrade the
old shape on read/save — the sanitizer must never eat an existing body.**

## Wave 1 — next (field evidence already exists)

Order matters: the repeater is first because gallery's editor (drag reorder,
per-item override popover) is repeater machinery wearing a costume. Build the
repeater first and gallery rides it; build gallery first and the repeater
gets written twice. The repeater also has the freshest evidence of the three:
consumers are hand-typing JSON arrays into textareas today.

### 1. Repeater UI for `array` fields

The JSON textarea is the biggest editor-experience gap in the product.
Sortable add/remove/collapse cards rendering each sub-field with the existing
FieldInput. Zero schema change, and it unlocks the entire WPBakery container
category (FAQ, tabs, accordion, pricing, feature grids) as pleasant consumer
blocks. Biggest win per line of code in this document.

### 2. `gallery` — field type + richtext node

Ordered upload refs with per-item overrides, riding what's already built —
including the Wave 1 repeater.

- Value: `[{ id, alt?, caption? }]` — overrides use the existing
  `resolveMedia()` inherit-then-override precedence. Identity (focal point,
  metadata defaults) stays on the media doc.
- **Upgrade path: accepts a bare id array (the shape consumer gallery blocks
  store today) and lifts it to the item shape on save.**
- Per-placement layout hint from a registry —
  `media.galleryLayouts: [{ name: 'grid' }, { name: 'strip' }, ...]` — the
  `media.aspects` pattern again: site vocabulary in config, node stores the
  name, renderer owns the CSS. Optional per-placement `aspect` reusing the
  1.5.0 vocabulary.
- Editor assembled from existing parts: MediaPicker `hasMany`, focal-aware
  thumbs, ✎ Edit modal per item, repeater reorder, per-item override popover.
- RichTextRenderer renders a reference implementation (grid, focal-aware);
  layouts beyond that are consumer CSS.

### 3. `embed` — richtext node + field

Paste a URL; the server resolves it to structured data. Never store
third-party HTML.

- Stored: `{ provider, id, params?, title?, thumbUrl? }` — resolved
  server-side at save, sanitizable because the renderer builds iframes from
  an allowlist. Third-party markup never enters the database. The resolved
  `thumbUrl` gives click-to-load facades a real poster frame.
- Core resolvers: **YouTube, Vimeo, generic oEmbed — and that's all.** X and
  every other single-platform surface live in the config registry
  (`embeds.providers`): this roadmap's own opening argument is that
  provider-specific elements rot with their platforms, so core carries only
  the two that have outlived every page builder, plus the neutral protocol.
- **Upgrade path: accepts a raw URL string (the shape consumer videoEmbed
  blocks store today) and resolves it on save.**
- Renderer defaults privacy-sane: youtube-nocookie, click-to-load facade for
  heavy providers.
- QoL moment: pasting a bare provider URL into rich text auto-detects into an
  embed node.

### 4. Upload dedupe (content hash)

From media brief v2 §2b, evidence filed and outstanding: identical bytes
uploaded twice create two docs and two R2 keys without a murmur. Store a
content hash on upload; on collision, offer the existing doc instead of
creating a duplicate (importMedia gets the same check). Cheap, independent of
the other three, lands whenever there's a free slot — its absence was this
roadmap's only real hole.

## Wave 2 — probable

- **`link` field** — `{ doc: { collection, id } } | { url }`, one picker.
  The primitive under every button, CTA, and nav item. **Evidence already
  filed** — consumer configs carry raw text-URL fields (`quote_href`, CTA
  hrefs in landing blocks), and the name-cleanup round required an
  internal-link rewrite migration precisely because stored hrefs rot under a
  no-redirects policy. Store-by-id-resolve-at-render makes that migration
  unnecessary. Wave 2 for capacity only, not for want of evidence.
- **Richtext QoL** — slash-command insert menu; drag-reorder nodes.
- **Edit inside MediaPicker** — deferred from 1.5.0 (modal-in-modal);
  trigger: a field report showing metadata fixing during selection.

## Wave 3 — design debate before code

- **Collection query block** — the Post Grid killer; for a directory,
  "nearby X" as a body element. Design direction settled by consumer
  contribution: **named queries, not free-form ones.** The consumer registers
  queries in config (`queries: { nearby: (params) => ... }` — the registry
  pattern a third time after aspects and galleryLayouts); the node stores
  `{ query: 'nearby', params }`. Guardrails collapse into "the consumer only
  registers safe queries," and perf policing becomes code review of the
  registry. Editor-authored `where` clauses are off the table.
- **Crop rect** — media brief v2's remaining uncovered cases, evidence met:
  per-placement aspect solved the too-tall case, but dead-space removal and
  derivative-prevention (the 2-photos-4-rows library audit) still need a
  stored rect on the media doc (identity, not placement). On the roadmap on
  purpose even though it lands late — the "send evidence" bar was cleared.
- **`point` geo field** — legit primitive (Payload and Sanity both have it);
  the embed node covers "show a map" until coordinates need to be queryable.
- **`table` node** — structured rows/cols; no field evidence yet.

## Refusals

- **Raw JS** — never; security.
- **Icons, separators, empty space, per-element design options** —
  presentation stored in content is the exact WPBakery trap. Themes and
  consumer CSS.
- **Charts as elements** — the data is a `json` field; the chart is a
  consumer block.
- **Social buttons** — they're links, and half of WPBakery's are for dead
  platforms.
