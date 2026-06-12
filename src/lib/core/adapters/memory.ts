/**
 * In-memory adapter with optional JSON-file persistence (Node only, used in
 * dev). The persistence hooks are injected, keeping this module itself
 * platform-agnostic — pass `load`/`save` backed by fs on Node, or nothing
 * for ephemeral in-memory use (tests).
 */
import type {
	AdapterStoreInfo,
	DatabaseAdapter,
	Doc,
	FindArgs,
	Where,
	WhereOperators
} from '../types';

type Store = Record<string, Doc[]>;

export interface MemoryAdapterOptions {
	load?: () => Promise<Store | null>;
	save?: (store: Store) => Promise<void>;
}

function matchesOps(value: unknown, ops: WhereOperators): boolean {
	if ('equals' in ops && !looseEq(value, ops.equals)) return false;
	if ('not_equals' in ops && looseEq(value, ops.not_equals)) return false;
	if (ops.contains !== undefined) {
		if (Array.isArray(value)) {
			if (!value.some((v) => String(v).toLowerCase().includes(ops.contains!.toLowerCase())))
				return false;
		} else if (
			typeof value !== 'string' ||
			!value.toLowerCase().includes(ops.contains.toLowerCase())
		) {
			return false;
		}
	}
	if (ops.in !== undefined && !ops.in.some((v) => looseEq(value, v))) return false;
	if (
		ops.greater_than !== undefined &&
		!(value != null && (value as string | number) > ops.greater_than)
	)
		return false;
	if (
		ops.less_than !== undefined &&
		!(value != null && (value as string | number) < ops.less_than)
	)
		return false;
	if (ops.exists !== undefined) {
		const exists = value !== undefined && value !== null;
		if (exists !== ops.exists) return false;
	}
	return true;
}

function looseEq(a: unknown, b: unknown): boolean {
	if (Array.isArray(a)) return a.some((v) => looseEq(v, b));
	// form-data friendliness: "true"/true, "1"/1
	// eslint-disable-next-line eqeqeq
	return a == b;
}

export function matchesWhere(doc: Doc, where?: Where): boolean {
	if (!where) return true;
	return Object.entries(where).every(([path, ops]) => matchesOps(getPath(doc, path), ops));
}

function getPath(doc: Doc, path: string): unknown {
	return path.split('.').reduce<unknown>((acc, key) => {
		if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
		return undefined;
	}, doc);
}

export function sortDocs(docs: Doc[], sort?: string): Doc[] {
	if (!sort) return docs;
	const desc = sort.startsWith('-');
	const key = desc ? sort.slice(1) : sort;
	return [...docs].sort((a, b) => {
		const av = getPath(a, key);
		const bv = getPath(b, key);
		if (av == null && bv == null) return 0;
		if (av == null) return 1;
		if (bv == null) return -1;
		const cmp = av < bv ? -1 : av > bv ? 1 : 0;
		return desc ? -cmp : cmp;
	});
}

export class MemoryAdapter implements DatabaseAdapter {
	readonly name = 'memory';
	private store: Store = {};
	private loaded = false;

	constructor(private opts: MemoryAdapterOptions = {}) {}

	async init(collections: AdapterStoreInfo[]): Promise<void> {
		if (!this.loaded && this.opts.load) {
			const persisted = await this.opts.load();
			if (persisted) this.store = persisted;
			this.loaded = true;
		}
		// Table configs are ignored in dev: table-backed collections behave
		// like normal JSON collections against the memory store.
		for (const { slug } of collections) this.store[slug] ??= [];
	}

	private async persist(): Promise<void> {
		if (this.opts.save) await this.opts.save(this.store);
	}

	async find(collection: string, args: FindArgs) {
		const all = (this.store[collection] ?? []).filter((d) => matchesWhere(d, args.where));
		const sorted = sortDocs(all, args.sort ?? '-createdAt');
		const limit = args.limit ?? 10;
		const page = args.page ?? 1;
		const docs = limit === 0 ? sorted : sorted.slice((page - 1) * limit, page * limit);
		return { docs: docs.map((d) => ({ ...d })), totalDocs: all.length };
	}

	async findById(collection: string, id: string) {
		const doc = (this.store[collection] ?? []).find((d) => d.id === id);
		return doc ? { ...doc } : null;
	}

	async create(collection: string, data: Record<string, unknown>) {
		const now = new Date().toISOString();
		const doc: Doc = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
		this.store[collection] ??= [];
		this.store[collection].push(doc);
		await this.persist();
		return { ...doc };
	}

	async update(collection: string, id: string, data: Record<string, unknown>) {
		const list = this.store[collection] ?? [];
		const idx = list.findIndex((d) => d.id === id);
		if (idx === -1) throw new Error(`Not found: ${collection}/${id}`);
		const updated: Doc = { ...list[idx], ...data, id, updatedAt: new Date().toISOString() };
		list[idx] = updated;
		await this.persist();
		return { ...updated };
	}

	async delete(collection: string, id: string) {
		const list = this.store[collection] ?? [];
		this.store[collection] = list.filter((d) => d.id !== id);
		await this.persist();
	}
}
