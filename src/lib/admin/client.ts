/**
 * Collection config contains functions (access, hooks, validate) that can't
 * cross the server/client boundary. These helpers produce a JSON-safe view of
 * the config for the admin UI.
 */
import type { CollectionConfig, Field, SelectOption } from '$lib/core/types';

export interface ClientField {
	name: string;
	type: Field['type'];
	label: string;
	required: boolean;
	unique: boolean;
	defaultValue?: unknown;
	admin: { description?: string; placeholder?: string; readOnly?: boolean; hidden?: boolean };
	// type-specific
	options?: SelectOption[];
	hasMany?: boolean;
	relationTo?: string;
	fields?: ClientField[];
	blocks?: ClientBlock[];
	minRows?: number;
	maxRows?: number;
	/** richText: embeddable upload collection + relationship targets */
	uploads?: string;
	relationships?: string[];
	minLength?: number;
	maxLength?: number;
	min?: number;
	max?: number;
}

export interface ClientBlock {
	slug: string;
	label: string;
	fields: ClientField[];
}

export interface ClientCollection {
	slug: string;
	labels: { singular: string; plural: string };
	auth: boolean;
	useAsTitle: string;
	defaultColumns: string[];
	description?: string;
	hidden: boolean;
	versioned: boolean;
	drafts: boolean;
	upload: boolean;
	uploadAccept?: string;
	fields: ClientField[];
}

export function labelize(name: string): string {
	return name
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]/g, ' ')
		.replace(/^./, (c) => c.toUpperCase());
}

function toClientField(f: Field): ClientField {
	const base: ClientField = {
		name: f.name,
		type: f.type,
		label: f.label ?? labelize(f.name),
		required: Boolean(f.required),
		unique: Boolean(f.unique),
		defaultValue: typeof f.defaultValue === 'function' ? undefined : f.defaultValue,
		admin: {
			description: f.admin?.description,
			placeholder: f.admin?.placeholder,
			readOnly: f.admin?.readOnly,
			hidden: f.admin?.hidden
		}
	};
	if (f.type === 'select') {
		base.options = f.options;
		base.hasMany = f.hasMany;
	}
	if (f.type === 'relationship') {
		base.relationTo = f.relationTo;
		base.hasMany = f.hasMany;
	}
	if (f.type === 'upload') base.relationTo = f.relationTo;
	if (f.type === 'array') base.fields = f.fields.map(toClientField);
	if (f.type === 'blocks') {
		base.blocks = f.blocks.map((b) => ({
			slug: b.slug,
			label: b.labels?.singular ?? labelize(b.slug),
			fields: b.fields.map(toClientField)
		}));
		base.minRows = f.minRows;
		base.maxRows = f.maxRows;
	}
	if (f.type === 'text' || f.type === 'textarea' || f.type === 'email') {
		base.minLength = f.minLength;
		base.maxLength = f.maxLength;
	}
	if (f.type === 'richText') {
		base.blocks = (f.blocks ?? []).map((b) => ({
			slug: b.slug,
			label: b.labels?.singular ?? labelize(b.slug),
			fields: b.fields.map(toClientField)
		}));
		base.uploads = f.uploads;
		base.relationships = f.relationships;
	}
	if (f.type === 'number') {
		base.min = f.min;
		base.max = f.max;
	}
	return base;
}

export function toClientCollection(col: CollectionConfig): ClientCollection {
	const useAsTitle = col.admin?.useAsTitle ?? (col.auth ? 'email' : 'id');
	const versionsCfg = typeof col.versions === 'object' ? col.versions : {};
	return {
		slug: col.slug,
		labels: col.labels ?? { singular: labelize(col.slug), plural: labelize(col.slug) },
		auth: Boolean(col.auth),
		versioned: Boolean(col.versions),
		drafts: Boolean(col.versions && (versionsCfg.drafts ?? false)),
		upload: Boolean(col.upload),
		uploadAccept:
			typeof col.upload === 'object' && col.upload.mimeTypes
				? col.upload.mimeTypes.map((m) => (m.endsWith('/') ? `${m}*` : m)).join(',')
				: undefined,
		useAsTitle,
		defaultColumns:
			col.admin?.defaultColumns ??
			[useAsTitle, ...col.fields.slice(0, 3).map((f) => f.name)].filter(
				(v, i, a) => a.indexOf(v) === i
			),
		description: col.admin?.description,
		hidden: Boolean(col.admin?.hidden),
		fields: col.fields.map(toClientField)
	};
}

/**
 * Globals reuse the collection form machinery: synthesize a ClientCollection
 * whose slug routes back to /admin/globals/<slug>.
 */
export function toClientGlobal(g: import('$lib/core/types').GlobalConfig): ClientCollection {
	const label = g.label ?? labelize(g.slug);
	return {
		slug: `globals/${g.slug}`,
		labels: { singular: label, plural: label },
		auth: false,
		useAsTitle: 'id',
		defaultColumns: [],
		description: g.admin?.description,
		hidden: Boolean(g.admin?.hidden),
		versioned: false,
		drafts: false,
		upload: false,
		fields: g.fields.map(toClientField)
	};
}

/** Best-effort display string for a cell value in the list view. */
export function displayValue(value: unknown, useAsTitleOfRelated = 'id'): string {
	if (value === null || value === undefined || value === '') return '—';
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (Array.isArray(value)) return value.map((v) => displayValue(v, useAsTitleOfRelated)).join(', ');
	if (typeof value === 'object') {
		const o = value as Record<string, unknown>;
		return String(o[useAsTitleOfRelated] ?? o.title ?? o.name ?? o.email ?? o.id ?? '[object]');
	}
	const s = String(value);
	if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s).toLocaleString();
	return s.length > 60 ? s.slice(0, 57) + '…' : s;
}
