# Roadmap — enhanced fields

Written 2026-08-10, after the 1.5.x media rounds. Inspiration screened from
WPBakery's 50-element catalogue (plus its 9 deprecated); the working method is
the opposite of a catalogue. WPBakery's deprecated list — Button 1.0, Button
2.0, Tabs 1.0, Accordion 1.0, Google+, Tweetmeme — is the argument: store
presentation as content and every redesign deprecates your content;
provider-specific elements rot with their platforms. Strip presentation away
and 50 elements collapse into about six primitives. highseam builds the
primitives; consumers own the skins.

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
that will use it the same week.

## Wave 1 — next (field evidence already exists)

### 1. `gallery` — field type + richtext node

Ordered upload refs with per-item overrides, riding what's already built.

- Value: `[{ id, alt?, caption? }]` — overrides use the existing
  `resolveMedia()` inherit-then-override precedence. Identity (focal point,
  metadata defaults) stays on the media doc.
- Per-placement layout hint from a registry —
  `media.galleryLayouts: [{ name: 'grid' }, { name: 'strip' }, ...]` — the
  `media.aspects` pattern again: site vocabulary in config, node stores the
  name, renderer owns the CSS. Optional per-placement `aspect` reusing the
  1.5.0 vocabulary.
- Editor assembled from existing parts: MediaPicker `hasMany`, focal-aware
  thumbs, ✎ Edit modal per item, drag reorder, per-item override popover.
- RichTextRenderer renders a reference implementation (grid, focal-aware);
  layouts beyond that are consumer CSS.

### 2. `embed` — richtext node + field

Paste a URL; the server resolves it to structured data. Never store
third-party HTML.

- Stored: `{ provider, id, params?, title?, thumbUrl? }` — resolved
  server-side at save, sanitizable because the renderer builds iframes from
  an allowlist. Third-party markup never enters the database.
- Core resolvers: YouTube, Vimeo, X, generic oEmbed. Config registry
  (`embeds.providers`) to add or restrict. Unknown URL → link fallback, loud
  in the editor.
- Renderer defaults privacy-sane: youtube-nocookie, click-to-load facade for
  heavy providers.
- QoL moment: pasting a bare provider URL into rich text auto-detects into an
  embed node.

### 3. Repeater UI for `array` fields

The JSON textarea is the biggest editor-experience gap in the product.
Sortable add/remove/collapse cards rendering each sub-field with the existing
FieldInput. Zero schema change, and it unlocks the entire WPBakery container
category (FAQ, tabs, accordion, pricing, feature grids) as pleasant consumer
blocks. Biggest win per line of code in this document.

## Wave 2 — probable (wait for the field report)

- **`link` field** — `{ doc: { collection, id } } | { url }`, one picker.
  The primitive under every button, CTA, and nav item. Internal links stored
  by id and resolved at render survive slug renames — the no-redirects
  policy expressed as a field type.
- **Richtext QoL** — slash-command insert menu; drag-reorder nodes.
- **Edit inside MediaPicker** — deferred from 1.5.0 (modal-in-modal);
  trigger: a field report showing metadata fixing during selection.

## Wave 3 — design debate before code

- **Collection query block** — `{ collection, where, sort, limit }` + layout
  hint. The Post Grid killer; for a directory, "nearby X" as a body element.
  Editor-authored queries need guardrails (access control applies; perf
  doesn't police itself) — design round first, code second.
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
