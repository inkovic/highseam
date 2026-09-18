import type { CollectionConfig, Field } from './types';
import { ValidationError } from './types';
import { sanitizeDocumentHtml, sanitizeNodes, validateRichTextNodes } from './richtext';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmpty(v: unknown): boolean {
	return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function validateField(field: Field, value: unknown, data: Record<string, unknown>): string | null {
	if (isEmpty(value)) {
		if (field.required) return `${field.label ?? field.name} is required`;
		return null;
	}

	switch (field.type) {
		case 'email':
			if (typeof value !== 'string' || !EMAIL_RE.test(value)) return 'Invalid email address';
			break;
		case 'text':
		case 'textarea': {
			if (typeof value !== 'string') return 'Must be a string';
			if (field.minLength && value.length < field.minLength)
				return `Must be at least ${field.minLength} characters`;
			if (field.maxLength && value.length > field.maxLength)
				return `Must be at most ${field.maxLength} characters`;
			break;
		}
		case 'html': {
			if (typeof value !== 'string') return 'Must be an HTML string';
			if (field.maxLength && value.length > field.maxLength)
				return `Must be at most ${field.maxLength} characters`;
			break;
		}
		case 'richText': {
			if (typeof value === 'string') break; // legacy markdown
			if (!Array.isArray(value)) return 'Must be a rich text node array or string';
			const err = validateRichTextNodes(value as never, field, (block, fields) => {
				for (const sub of block.fields) {
					const subErr = validateField(sub, fields[sub.name], data);
					if (subErr) return subErr;
				}
				return null;
			});
			if (err) return err;
			break;
		}
		case 'number': {
			if (typeof value !== 'number' || Number.isNaN(value)) return 'Must be a number';
			if (field.min !== undefined && value < field.min) return `Must be >= ${field.min}`;
			if (field.max !== undefined && value > field.max) return `Must be <= ${field.max}`;
			break;
		}
		case 'checkbox':
			if (typeof value !== 'boolean') return 'Must be a boolean';
			break;
		case 'date':
			if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return 'Invalid date';
			break;
		case 'select': {
			const values = field.hasMany ? (Array.isArray(value) ? value : [value]) : [value];
			const allowed = new Set(field.options.map((o) => o.value));
			for (const v of values) {
				if (typeof v !== 'string' || !allowed.has(v)) return `Invalid option: ${String(v)}`;
			}
			break;
		}
		case 'relationship': {
			const ids = field.hasMany ? (Array.isArray(value) ? value : [value]) : [value];
			for (const id of ids) if (typeof id !== 'string') return 'Invalid relationship id';
			break;
		}
		case 'upload': {
			const ids = field.hasMany ? (Array.isArray(value) ? value : [value]) : [value];
			for (const id of ids) if (typeof id !== 'string') return 'Invalid upload reference';
			break;
		}
		case 'link': {
			if (typeof value !== 'object' || value === null) return 'Must be a link object';
			const v = value as Record<string, unknown>;
			const hasUrl = typeof v.url === 'string' && v.url !== '';
			const d = v.doc as Record<string, unknown> | undefined;
			const hasDoc =
				d != null && typeof d === 'object' && typeof d.collection === 'string' && typeof d.id === 'string' && d.id !== '';
			if (hasUrl === hasDoc) return 'Link needs either a url or a doc reference (not both)';
			if (hasUrl && !/^(https?:\/\/|mailto:|tel:|\/(?!\/))/i.test(v.url as string))
				return 'Link url must be http(s), mailto:, tel:, or a site-relative path';
			if (hasDoc && field.relationTo && !field.relationTo.includes(d!.collection as string))
				return `Link may only target: ${field.relationTo.join(', ')}`;
			if (v.newTab !== undefined && typeof v.newTab !== 'boolean') return 'newTab must be a boolean';
			break;
		}
		case 'embed': {
			if (typeof value !== 'object' || value === null) return 'Must be an embed object';
			const u = (value as Record<string, unknown>).url;
			if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return 'Embed needs an http(s) url';
			break;
		}
		case 'gallery': {
			if (!Array.isArray(value)) return 'Must be an array of gallery items';
			if (field.maxItems && value.length > field.maxItems)
				return `Allows at most ${field.maxItems} item(s)`;
			for (const item of value) {
				if (typeof item !== 'object' || item === null) return 'Gallery items must be objects';
				const it = item as Record<string, unknown>;
				if (typeof it.id !== 'string' || !it.id) return 'Gallery item needs an id';
				if (it.alt !== undefined && typeof it.alt !== 'string') return 'Gallery alt must be a string';
				if (it.caption !== undefined && typeof it.caption !== 'string')
					return 'Gallery caption must be a string';
			}
			break;
		}
		case 'array': {
			if (!Array.isArray(value)) return 'Must be an array';
			for (const row of value) {
				if (typeof row !== 'object' || row === null) return 'Array rows must be objects';
				for (const sub of field.fields) {
					const err = validateField(sub, (row as Record<string, unknown>)[sub.name], data);
					if (err) return `${field.name}: ${err}`;
				}
			}
			break;
		}
		case 'blocks': {
			if (!Array.isArray(value)) return 'Must be an array of blocks';
			if (field.minRows && value.length < field.minRows)
				return `Requires at least ${field.minRows} block(s)`;
			if (field.maxRows && value.length > field.maxRows)
				return `Allows at most ${field.maxRows} block(s)`;
			for (const [i, row] of value.entries()) {
				if (typeof row !== 'object' || row === null) return `Block ${i + 1} must be an object`;
				const blockType = (row as Record<string, unknown>).blockType;
				const block = field.blocks.find((b) => b.slug === blockType);
				if (!block) return `Block ${i + 1}: unknown blockType "${String(blockType)}"`;
				for (const sub of block.fields) {
					const err = validateField(sub, (row as Record<string, unknown>)[sub.name], data);
					if (err) return `${block.slug} (block ${i + 1}): ${err}`;
				}
			}
			break;
		}
		case 'json':
			break;
	}

	if (field.validate) {
		const result = field.validate(value, { data });
		if (result !== true) return result;
	}
	return null;
}

/**
 * Validate incoming data against a collection's field config.
 * Throws ValidationError with a per-field error map.
 */
export function validateData(
	collection: CollectionConfig,
	data: Record<string, unknown>,
	{ partial = false }: { partial?: boolean } = {}
): void {
	const errors: Record<string, string> = {};

	for (const field of collection.fields) {
		// On partial update, skip required checks for fields not present.
		if (partial && !(field.name in data)) continue;
		const err = validateField(field, data[field.name], data);
		if (err) errors[field.name] = err;
	}

	if (collection.auth) {
		if (!partial || 'email' in data) {
			if (isEmpty(data.email)) errors.email = 'Email is required';
			else if (typeof data.email !== 'string' || !EMAIL_RE.test(data.email))
				errors.email = 'Invalid email address';
		}
		if ('password' in data && !isEmpty(data.password)) {
			if (typeof data.password !== 'string' || data.password.length < 8)
				errors.password = 'Password must be at least 8 characters';
		} else if (!partial) {
			errors.password = 'Password is required';
		}
	}

	if (Object.keys(errors).length > 0) throw new ValidationError(errors);
}

/**
 * Strip unknown keys and coerce known field values from loosely-typed input
 * (e.g. multipart form data where everything arrives as strings).
 */
export function sanitizeData(
	collection: CollectionConfig,
	input: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const field of collection.fields) {
		if (!(field.name in input)) continue;
		out[field.name] = coerce(field, input[field.name]);
	}
	if (collection.auth) {
		if ('email' in input) out.email = input.email;
		if ('password' in input && input.password !== '') out.password = input.password;
	}
	return out;
}

function coerce(field: Field, value: unknown): unknown {
	if (
		value === '' &&
		field.type !== 'text' &&
		field.type !== 'textarea' &&
		field.type !== 'richText' &&
		field.type !== 'html'
	)
		return null;
	switch (field.type) {
		case 'number':
			return typeof value === 'string' ? (value === '' ? null : Number(value)) : value;
		case 'checkbox':
			return value === 'on' || value === 'true' || value === true;
		case 'html':
			return typeof value === 'string' ? sanitizeDocumentHtml(value) : value;
		case 'richText': {
			let v = value;
			if (typeof v === 'string' && v.trim().startsWith('[')) {
				try {
					v = JSON.parse(v);
				} catch {
					return v;
				}
			}
			// Sanitize inline HTML server-side; legacy markdown strings pass through.
			if (!Array.isArray(v)) return v;
			// 1.7.2: recurse into block nodes' sub-fields (as array/blocks do) so a
			// nested richText is sanitized and nested arrays/links/embeds get their
			// upgrade paths — sanitizeNodes passes block fields through untouched.
			return sanitizeNodes(v).map((node) => {
				if (node.type !== 'block') return node;
				const block = (field.blocks ?? []).find((b) => b.slug === node.blockType);
				if (!block) return node;
				const fields = { ...node.fields };
				for (const sub of block.fields) {
					if (sub.name in fields) fields[sub.name] = coerce(sub, fields[sub.name]);
				}
				return { ...node, fields };
			});
		}
		case 'select':
		case 'relationship':
		case 'upload':
			if (field.hasMany && typeof value === 'string') {
				return value
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
			}
			return value;
		case 'link': {
			// Upgrade path: raw href strings (quote_href-style text fields) lift
			// to { url }. JSON strings (form posts) parse to the object.
			if (typeof value === 'string') {
				const u = value.trim();
				if (!u) return null;
				if (u.startsWith('{')) {
					try {
						return JSON.parse(u);
					} catch {
						return { url: u };
					}
				}
				return { url: u };
			}
			return value;
		}
		case 'embed': {
			// Upgrade path: raw URL strings (the shape consumer videoEmbed blocks
			// stored) lift to the object shape; resolution happens at save.
			if (typeof value === 'string') {
				const u = value.trim();
				if (!u) return null;
				if (u.startsWith('{')) {
					try {
						return JSON.parse(u);
					} catch {
						return { url: u };
					}
				}
				return { url: u };
			}
			return value;
		}
		case 'gallery': {
			let v = value;
			if (typeof v === 'string') {
				try {
					v = v.trim() === '' ? null : JSON.parse(v);
				} catch {
					return v; // let validation flag it
				}
			}
			// Upgrade path (the migration contract): a bare id array — the shape
			// consumer gallery blocks stored before this field existed — lifts to
			// the item shape instead of being eaten by validation.
			if (Array.isArray(v)) {
				return v.map((item) => (typeof item === 'string' ? { id: item } : item));
			}
			return v;
		}
		case 'array':
		case 'blocks': {
			let v = value;
			if (typeof v === 'string') {
				try {
					v = v.trim() === '' ? null : JSON.parse(v);
				} catch {
					return v; // let validation flag it
				}
			}
			// Recurse into rows so sub-field contracts hold INSIDE blocks and
			// arrays too — the upgrade paths (link/embed strings, gallery bare
			// ids) were written for values that live exactly here.
			if (Array.isArray(v)) {
				return v.map((row) => {
					if (typeof row !== 'object' || row === null) return row;
					const r = row as Record<string, unknown>;
					const subs =
						field.type === 'array'
							? field.fields
							: (field.blocks.find((b) => b.slug === r.blockType)?.fields ?? []);
					const outRow = { ...r };
					for (const sub of subs) {
						if (sub.name in outRow) outRow[sub.name] = coerce(sub, outRow[sub.name]);
					}
					return outRow;
				});
			}
			return v;
		}
		case 'json':
			if (typeof value === 'string') {
				try {
					return value.trim() === '' ? null : JSON.parse(value);
				} catch {
					return value; // let validation flag it
				}
			}
			return value;
		default:
			return value;
	}
}

/** Apply defaultValue for fields missing on create. */
export function applyDefaults(
	collection: CollectionConfig,
	data: Record<string, unknown>
): Record<string, unknown> {
	const out = { ...data };
	for (const field of collection.fields) {
		if (isEmpty(out[field.name]) && field.defaultValue !== undefined) {
			out[field.name] =
				typeof field.defaultValue === 'function'
					? (field.defaultValue as () => unknown)()
					: field.defaultValue;
		}
		if (field.type === 'checkbox' && out[field.name] === undefined) out[field.name] = false;
	}
	return out;
}
