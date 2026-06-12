/** Convert posted FormData into a data object, respecting hasMany fields. */
import type { CollectionConfig } from '$lib/core/types';

export function formToData(form: FormData, col: CollectionConfig): Record<string, unknown> {
	const data: Record<string, unknown> = {};
	for (const field of col.fields) {
		const hasMany =
			(field.type === 'select' || field.type === 'relationship' || field.type === 'upload') &&
			Boolean(field.hasMany);
		if (hasMany) {
			if (form.has(field.name)) {
				data[field.name] = form.getAll(field.name).map(String).filter(Boolean);
			}
			continue;
		}
		// Use the LAST entry: checkboxes submit a hidden "false" followed by
		// "true" when checked.
		if (form.has(field.name)) {
			const all = form.getAll(field.name);
			data[field.name] = all[all.length - 1];
		}
	}
	if (col.auth) {
		if (form.has('email')) data.email = form.get('email');
		const pw = form.get('password');
		if (typeof pw === 'string' && pw.length > 0) data.password = pw;
	}
	if (col.upload) {
		const file = form.get('file');
		if (file && typeof file === 'object' && 'size' in file && (file as File).size > 0) {
			data.file = file;
		}
	}
	return data;
}
