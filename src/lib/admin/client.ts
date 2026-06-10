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
	minLength?: number;
	maxLength?: number;
	min?: number;
	max?: number;
}

export interface ClientCollection {
	slug: string;
	labels: { singular: string; plural: string };
	auth: boolean;
	useAsTitle: string;
	defaultColumns: string[];
	description?: string;
	hidden: boolean;
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
	if (f.type === 'array') base.fields = f.fields.map(toClientField);
	if (f.type === 'text' || f.type === 'textarea' || f.type === 'richText' || f.type === 'email') {
		base.minLength = f.minLength;
		base.maxLength = f.maxLength;
	}
	if (f.type === 'number') {
		base.min = f.min;
		base.max = f.max;
	}
	return base;
}

export function toClientCollection(col: CollectionConfig): ClientCollection {
	const useAsTitle = col.admin?.useAsTitle ?? (col.auth ? 'email' : 'id');
	return {
		slug: col.slug,
		labels: col.labels ?? { singular: labelize(col.slug), plural: labelize(col.slug) },
		auth: Boolean(col.auth),
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
