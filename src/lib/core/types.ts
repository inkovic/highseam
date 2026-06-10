/**
 * svelte-payload core types.
 *
 * This module is framework-agnostic: no SvelteKit, no Svelte, no Node-only
 * APIs. The same core runs in Node (vite dev) and on Cloudflare Workers.
 * Modeled closely on Payload CMS's config surface.
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
	| 'richText' // markdown-backed in this implementation
	| 'email'
	| 'number'
	| 'checkbox'
	| 'date'
	| 'select'
	| 'relationship'
	| 'array'
	| 'blocks'
	| 'json';

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
}

export interface BaseField {
	name: string;
	type: FieldType;
	label?: string;
	required?: boolean;
	unique?: boolean;
	defaultValue?: unknown;
	admin?: FieldAdminConfig;
	/** Return true if valid, or an error message string. */
	validate?: (value: unknown, args: { data: Record<string, unknown> }) => true | string;
}

export interface TextField extends BaseField {
	type: 'text' | 'textarea' | 'richText' | 'email';
	minLength?: number;
	maxLength?: number;
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

export interface ArrayField extends BaseField {
	type: 'array';
	/** Sub-fields for each row. */
	fields: Field[];
}

/** One block shape available inside a blocks field (like Payload's blocks). */
export interface BlockConfig {
	slug: string;
	labels?: { singular: string; plural: string };
	fields: Field[];
}

/**
 * Payload-style flexible layout builder. Value is an array of
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

export type Field =
	| TextField
	| NumberField
	| CheckboxField
	| DateField
	| SelectField
	| RelationshipField
	| ArrayField
	| BlocksField
	| JsonField;

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
 * Like Payload: an access function may return a boolean, OR a Where query
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
}

export interface AuthConfig {
	/** Seconds until tokens expire. Default 7200 (2h). */
	tokenExpiration?: number;
}

export interface VersionsConfig {
	/** Enable draft state: saves can target a draft without touching the published doc. */
	drafts?: boolean;
	/** Versions kept per document (oldest pruned). Default 20. */
	maxPerDoc?: number;
}

export interface CollectionConfig {
	slug: string;
	labels?: { singular: string; plural: string };
	fields: Field[];
	/** Enable email+password auth for this collection (like Payload). */
	auth?: boolean | AuthConfig;
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
// Database adapter — the agnostic seam
// ---------------------------------------------------------------------------

export interface DatabaseAdapter {
	readonly name: string;
	/** Called once with all collection slugs before first use. */
	init(collections: string[]): Promise<void>;
	find(collection: string, args: FindArgs): Promise<{ docs: Doc[]; totalDocs: number }>;
	findById(collection: string, id: string): Promise<Doc | null>;
	create(collection: string, data: Record<string, unknown>): Promise<Doc>;
	update(collection: string, id: string, data: Record<string, unknown>): Promise<Doc>;
	delete(collection: string, id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Top-level config
// ---------------------------------------------------------------------------

export interface CMSConfig {
	collections: CollectionConfig[];
	/** Secret for signing auth tokens. Override via env in production. */
	secret?: string;
	admin?: {
		/** Title shown in the admin UI. */
		title?: string;
	};
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
