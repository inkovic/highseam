/**
 * highseam core types.
 *
 * This module is framework-agnostic: no SvelteKit, no Svelte, no Node-only
 * APIs. The same core runs in Node (vite dev) and on Cloudflare Workers.
 * Config surface will feel familiar if you've used a config-driven CMS before.
 */

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface Doc {
	id: string;
	createdAt?: string;
	updatedAt?: string;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type FieldType =
	| 'text'
	| 'textarea'
	| 'richText' // structured JSON nodes (Lexical-equivalent)
	| 'html' // sanitized HTML string (WYSIWYG-edited)
	| 'email'
	| 'number'
	| 'checkbox'
	| 'date'
	| 'select'
	| 'relationship'
	| 'upload'
	| 'array'
	| 'blocks'
	| 'json'
	| 'gallery'
	| 'embed'
	| 'link';

export interface SelectOption {
	label: string;
	value: string;
}

export interface FieldAdminConfig {
	description?: string;
	placeholder?: string;
	readOnly?: boolean;
	/** Hide from the auto-generated admin UI (still present in the API). */
	hidden?: boolean;
	/**
	 * Group name: fields sharing a group render together (collapsible section
	 * or tab, per the collection's groupsAs).
	 */
	group?: string;
	/** Place this field in the right-hand meta sidebar instead of the main column. */
	position?: 'sidebar';
	/** Render hint: 'image' shows a thumbnail preview for a URL/text field. */
	preview?: 'image';
	/**
	 * Editor hint for `json` fields whose value is really a string list
	 * (tags, slugs): 'tags' renders a chips input instead of a JSON textarea.
	 */
	editor?: 'tags';
}

export interface BaseField {
	name: string;
	type: FieldType;
	label?: string;
	required?: boolean;
	unique?: boolean;
	/**
	 * Store a value per locale (requires `localization` in the top-level
	 * config). Reads flatten to the requested locale with fallback to the
	 * default locale; `locale=all` returns the raw per-locale object.
	 */
	localized?: boolean;
	defaultValue?: unknown;
	admin?: FieldAdminConfig;
	/** Return true if valid, or an error message string. */
	validate?: (value: unknown, args: { data: Record<string, unknown> }) => true | string;
}

export interface TextField extends BaseField {
	type: 'text' | 'textarea' | 'email';
	minLength?: number;
	maxLength?: number;
}

/**
 * Structured rich text (the Lexical-equivalent). Value is a JSON array of
 * nodes — paragraphs/headings/lists with sanitized inline HTML, plus
 * embeddable typed components, uploads, and relationships INSIDE the
 * document flow. Legacy markdown strings are still accepted.
 */
/**
 * Sanitized HTML stored as a string — for content produced as HTML by
 * external pipelines (AI writers, migrations) or edited via WYSIWYG.
 * Coexists with `richText` (structured JSON): use each where it fits.
 */
export interface HtmlField extends BaseField {
	type: 'html';
	maxLength?: number;
}

export interface RichTextField extends BaseField {
	type: 'richText';
	/** Typed components editors can embed inside the document. */
	blocks?: BlockConfig[];
	/** Upload collection slug for embeddable media nodes. */
	uploads?: string;
	/** Collection slugs embeddable as relationship nodes. */
	relationships?: string[];
	/** Allow embed nodes (paste a URL; resolved via the embeds registry). */
	embeds?: boolean;
}

export interface NumberField extends BaseField {
	type: 'number';
	min?: number;
	max?: number;
}

export interface CheckboxField extends BaseField {
	type: 'checkbox';
}

export interface DateField extends BaseField {
	type: 'date';
}

export interface SelectField extends BaseField {
	type: 'select';
	options: SelectOption[];
	hasMany?: boolean;
}

export interface RelationshipField extends BaseField {
	type: 'relationship';
	/** Slug of the related collection. */
	relationTo: string;
	hasMany?: boolean;
}

/** Reference to a document in an upload-enabled collection. */
export interface UploadField extends BaseField {
	type: 'upload';
	relationTo: string;
	/** Multiple uploads on one field (image galleries). */
	hasMany?: boolean;
}

/**
 * An ordered list of upload references with per-item presentation overrides.
 * Value: `[{ id, alt?, caption? }]` — overrides ride the resolveMedia()
 * inherit-then-override precedence; identity (focal point, metadata
 * defaults) stays on the media doc. Accepts a bare id array on write and
 * lifts it to the item shape (the migration contract).
 */
export interface GalleryField extends BaseField {
	type: 'gallery';
	/** Upload collection the items reference. */
	relationTo: string;
	maxItems?: number;
}

export interface ArrayField extends BaseField {
	type: 'array';
	/** Sub-fields for each row. */
	fields: Field[];
}

/** One block shape available inside a blocks field. */
export interface BlockConfig {
	slug: string;
	labels?: { singular: string; plural: string };
	fields: Field[];
}

/**
 * Flexible layout builder. Value is an array of
 * `{ blockType: '<slug>', ...fieldValues }` rows; editors can add, remove,
 * and reorder blocks of different shapes.
 */
export interface BlocksField extends BaseField {
	type: 'blocks';
	blocks: BlockConfig[];
	minRows?: number;
	maxRows?: number;
}

export interface JsonField extends BaseField {
	type: 'json';
}

/**
 * A URL resolved to structured embed data at save:
 * `{ url, provider?, embedId?, title?, thumbUrl? }`. Accepts a raw URL
 * string on write and lifts it to the object shape (the migration
 * contract). Unresolvable URLs keep `{ url }` — renderers fall back to a
 * link. Never stores third-party HTML.
 */
export interface EmbedField extends BaseField {
	type: 'embed';
}

/**
 * Internal document reference OR external URL, one value:
 * `{ doc: { collection, id } } | { url }`, optional `newTab`. Internal links
 * are stored by id and resolved at render, so slug renames never break
 * stored links. Accepts a raw URL string on write and lifts it to `{ url }`
 * (the migration contract for text-field hrefs).
 */
export interface LinkField extends BaseField {
	type: 'link';
	/**
	 * Collections internal links may target. Omit for an external-URL-only
	 * link field (the internal picker doesn't render).
	 */
	relationTo?: string[];
}

export type Field =
	| TextField
	| RichTextField
	| HtmlField
	| NumberField
	| CheckboxField
	| DateField
	| SelectField
	| RelationshipField
	| UploadField
	| GalleryField
	| ArrayField
	| BlocksField
	| JsonField
	| EmbedField
	| LinkField;

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

export interface ReqContext {
	/** The authenticated user (from any auth-enabled collection), or null. */
	user: Doc | null;
}

export interface AccessArgs {
	req: ReqContext;
	id?: string;
	data?: Record<string, unknown>;
	/** The existing document, for update/delete. */
	doc?: Doc;
}

/**
 * An access function may return a boolean, OR a Where query
 * that constrains which documents the request may touch (e.g. only published
 * posts for anonymous readers).
 */
export type AccessResult = boolean | Where;
export type AccessFn = (args: AccessArgs) => AccessResult | Promise<AccessResult>;

export interface CollectionAccess {
	create?: AccessFn;
	read?: AccessFn;
	update?: AccessFn;
	delete?: AccessFn;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export type HookOperation = 'create' | 'update' | 'delete' | 'read';

export interface HookArgs {
	req: ReqContext;
	operation: HookOperation;
	collection: string;
	data?: Record<string, unknown>;
	doc?: Doc;
	originalDoc?: Doc;
}

export type BeforeValidateHook = (
	args: HookArgs
) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
export type BeforeChangeHook = BeforeValidateHook;
export type AfterChangeHook = (args: HookArgs) => void | Promise<void>;
export type AfterReadHook = (args: HookArgs) => Doc | void | Promise<Doc | void>;
export type BeforeDeleteHook = (args: HookArgs) => void | Promise<void>;
export type AfterDeleteHook = (args: HookArgs) => void | Promise<void>;

export interface CollectionHooks {
	beforeValidate?: BeforeValidateHook[];
	beforeChange?: BeforeChangeHook[];
	afterChange?: AfterChangeHook[];
	afterRead?: AfterReadHook[];
	beforeDelete?: BeforeDeleteHook[];
	afterDelete?: AfterDeleteHook[];
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export interface CollectionAdminConfig {
	/** Field used as the document title in lists and edit views. */
	useAsTitle?: string;
	/** Columns shown in the admin list view. */
	defaultColumns?: string[];
	description?: string;
	/** Hide the collection from the admin nav. */
	hidden?: boolean;
	/** Lucide-ish icon name hint (decorative only). */
	group?: string;
	/** Render field groups as top tabs or stacked collapsible sections. Default 'sections'. */
	groupsAs?: 'tabs' | 'sections';
	/**
	 * Field names that render faceted filter controls in the list view
	 * (combinable; mapped to `where` queries — SQL in table mode).
	 */
	filters?: string[];
	/**
	 * Live preview: returns the public URL to show in the admin's preview
	 * pane for a document. Receives a short-lived preview token to append
	 * (your front end verifies it with highseam/preview). Runs
	 * server-side — the CMS never learns your route shape.
	 */
	preview?: { url: (doc: Doc, token: string) => string };
	/**
	 * Custom document actions: buttons on the edit page that POST
	 * `{ collection, id }` (JSON) to your endpoint — the hook bus surfaced
	 * in the UI (e.g. a "Generate with AI" button).
	 */
	actions?: { label: string; url: string; confirm?: string }[];
}

export interface AuthConfig {
	/** Seconds until tokens expire. Default 7200 (2h). */
	tokenExpiration?: number;
	/**
	 * Issue each user an API key (generated at create). Authenticate with:
	 * `Authorization: <collection-slug> API-Key <key>`
	 */
	apiKeys?: boolean;
}

/**
 * Map a collection onto an EXISTING SQL table (D1), one column per field —
 * the Directus model. Lets the admin/API sit on top of relational data
 * (e.g. a pipeline-fed venues table) without migrating it to JSON docs.
 * Field names must match column names. In dev (memory adapter) the
 * collection behaves like a normal JSON collection.
 *
 * Notes: versions/drafts require a `_status` column if enabled; localized
 * fields and upload collections are not supported in table mode.
 */
export interface TableConfig {
	/** SQL table name. */
	name: string;
	/** id column is INTEGER AUTOINCREMENT (omit on insert, read back). Default: uuid TEXT ids. */
	autoId?: boolean;
	/** Timestamp column names, or false if the table has none. Default false. */
	timestamps?: { createdAt: string; updatedAt: string } | false;
}

/** One embed provider: which hosts it claims and how to resolve them. */
export interface EmbedProviderConfig {
	name: string;
	/** Host suffixes this provider claims, e.g. ['youtube.com', 'youtu.be']. */
	hosts: string[];
	/** Extract the provider's own id from a URL; return null to reject. */
	extractId?: (url: URL) => string | null;
	/** FIXED oEmbed endpoint (JSON) for title/thumbnail. Never discovered. */
	oembed?: string;
}

export interface UploadConfig {
	/** Allowed mime type prefixes, e.g. ['image/'] or ['image/png', 'application/pdf']. */
	mimeTypes?: string[];
	/** Max file size in bytes. Default 10 MiB. */
	maxFileSize?: number;
	/**
	 * Content-hash dedupe (default true): uploading bytes identical to an
	 * existing document returns that document (flagged `_deduped`) instead of
	 * creating a duplicate doc + storage key. Applies to docs created since
	 * this feature (they carry a managed `contentHash`); table-backed upload
	 * collections need a `contentHash` column for the lookup.
	 */
	dedupe?: boolean;
}

export interface VersionsConfig {
	/** Enable draft state: saves can target a draft without touching the published doc. */
	drafts?: boolean;
	/** Versions kept per document (oldest pruned). Default 20. */
	maxPerDoc?: number;
	/**
	 * Scheduled publishing: drafts with a `publishAt` date in the past are
	 * auto-promoted to published (swept lazily on reads). Add a
	 * `publishAt` date field to the collection to drive it.
	 */
	schedulePublish?: boolean;
	/**
	 * Offer "Unpublish" (editor + list bulk). Default true. Turn it off when
	 * the collection's visibility is its own field, not `_status` (table
	 * mode over an existing table usually is), so Unpublish would do nothing
	 * a reader can see. 1.8.1.
	 */
	unpublish?: boolean;
}

export interface CollectionConfig {
	slug: string;
	labels?: { singular: string; plural: string };
	fields: Field[];
	/** Enable email+password auth for this collection. */
	auth?: boolean | AuthConfig;
	/**
	 * Make this an upload collection: documents carry a stored file and get
	 * managed `filename`, `mimeType`, `filesize`, and `url` fields.
	 */
	upload?: boolean | UploadConfig;
	/** Back this collection with an existing SQL table (string = table name). */
	table?: string | TableConfig;
	timestamps?: boolean; // default true
	/**
	 * Enable version history (and optionally drafts). Versioned docs get a
	 * managed `_status` of 'draft' | 'published'; every save snapshots into a
	 * shadow versions store.
	 */
	versions?: boolean | VersionsConfig;
	access?: CollectionAccess;
	hooks?: CollectionHooks;
	admin?: CollectionAdminConfig;
}

/** A stored version snapshot. */
export interface VersionDoc extends Doc {
	parent: string;
	snapshot: Doc;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface WhereOperators {
	equals?: unknown;
	not_equals?: unknown;
	contains?: string;
	in?: unknown[];
	greater_than?: number | string;
	less_than?: number | string;
	exists?: boolean;
}

export type Where = Record<string, WhereOperators>;

export interface FindArgs {
	where?: Where;
	limit?: number;
	page?: number;
	/** Field name, prefix with '-' for descending. e.g. '-createdAt' */
	sort?: string;
	/** Only docs with an open (unpublished) draft. Versioned collections with drafts. 1.8.1. */
	openDrafts?: boolean;
	/** Adapter-level: the versions store holding those drafts (set by the CMS from `openDrafts`). */
	openDraftsIn?: string;
}

export interface PaginatedDocs {
	docs: Doc[];
	totalDocs: number;
	limit: number;
	page: number;
	totalPages: number;
	hasNextPage: boolean;
	hasPrevPage: boolean;
}

// ---------------------------------------------------------------------------
// File storage — the agnostic seam for uploads
// ---------------------------------------------------------------------------

export interface StoredFile {
	bytes: Uint8Array;
	contentType: string;
}

export interface FileStorage {
	readonly name: string;
	put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
	get(key: string): Promise<StoredFile | null>;
	delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Database adapter — the agnostic seam
// ---------------------------------------------------------------------------

/** Per-store metadata handed to adapters at init. */
export interface AdapterStoreInfo {
	slug: string;
	/** Present for table-backed collections (D1 column-per-field mode). */
	table?: {
		name: string;
		autoId: boolean;
		timestamps: { createdAt: string; updatedAt: string } | false;
		/** Columns holding JSON (array/blocks/json/richText fields). */
		jsonColumns: string[];
		/** Columns holding booleans (checkbox fields). */
		boolColumns: string[];
		/** All known field columns (insert/update whitelist). */
		columns: string[];
	};
}

export interface DatabaseAdapter {
	readonly name: string;
	/** Called once with all stores before first use. */
	init(collections: AdapterStoreInfo[]): Promise<void>;
	find(collection: string, args: FindArgs): Promise<{ docs: Doc[]; totalDocs: number }>;
	findById(collection: string, id: string): Promise<Doc | null>;
	create(collection: string, data: Record<string, unknown>): Promise<Doc>;
	update(collection: string, id: string, data: Record<string, unknown>): Promise<Doc>;
	delete(collection: string, id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Top-level config
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Globals — singleton documents (site settings, nav, footer)
// ---------------------------------------------------------------------------

export interface GlobalConfig {
	slug: string;
	label?: string;
	fields: Field[];
	access?: {
		read?: AccessFn;
		update?: AccessFn;
	};
	admin?: {
		description?: string;
		hidden?: boolean;
	};
}

/**
 * A plugin is a config transform: it receives the
 * config and returns a (possibly) modified one. Applied in order by
 * defineConfig.
 */
export type Plugin = (config: CMSConfig) => CMSConfig;

export interface LocalizationConfig {
	locales: string[];
	defaultLocale: string;
}

export interface CMSConfig {
	collections: CollectionConfig[];
	globals?: GlobalConfig[];
	plugins?: Plugin[];
	localization?: LocalizationConfig;
	/** Secret for signing auth tokens. Override via env in production. */
	secret?: string;
	admin?: {
		/** Title shown in the admin UI. */
		title?: string;
		/** Admin color scheme. Default 'system'. */
		theme?: 'light' | 'dark' | 'system';
	};
	media?: {
		/**
		 * The aspect ratios your frontend actually renders (e.g. detail hero
		 * 16:7, card 3:2, OG 1200:630). The media editor shows a live crop
		 * preview per aspect, driven by the image's focal point — one
		 * original in storage, zero variant uploads.
		 *
		 * `contexts` scopes where an entry appears (default: everywhere):
		 *  - 'preview'    the crop-preview strips in the media editor
		 *  - 'placement'  the per-use aspect select on rich-text upload nodes
		 */
		aspects?: { name: string; ratio: string; contexts?: ('preview' | 'placement')[] }[];
		/**
		 * The gallery layouts your frontend renders (e.g. grid, strip,
		 * mosaic). Site vocabulary, not framework CSS: a gallery placement
		 * stores the layout NAME; your renderer owns what it looks like.
		 */
		galleryLayouts?: { name: string }[];
	};
	/**
	 * Embed provider registry. Core resolves YouTube and Vimeo; add providers
	 * here with fixed hosts (and a fixed oEmbed endpoint if they have one).
	 * There is intentionally no oEmbed discovery — fetching arbitrary
	 * editor-supplied URLs server-side is an SSRF vector; a registry of fixed
	 * endpoints is not.
	 */
	embeds?: { providers?: EmbedProviderConfig[] };
}

export class APIError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.status = status;
	}
}

export class ValidationError extends APIError {
	errors: Record<string, string>;
	constructor(errors: Record<string, string>) {
		super('Validation failed', 400);
		this.errors = errors;
	}
}
