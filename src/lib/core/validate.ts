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
		case 'upload':
			if (typeof value !== 'string') return 'Invalid upload reference';
			break;
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
		case 'upload':
			return value;
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
			return Array.isArray(v) ? sanitizeNodes(v) : v;
		}
		case 'select':
		case 'relationship':
			if (field.hasMany && typeof value === 'string') {
				return value
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
			}
			return value;
		case 'array':
		case 'blocks':
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
