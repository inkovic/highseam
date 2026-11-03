/**
 * Cloudflare D1 adapter with TWO storage modes:
 *
 * 1. Document mode (default): one `documents` table, body stored as JSON,
 *    queried via json_extract() — schema-less, zero migrations.
 * 2. Table mode (`collection.table`): the collection maps onto an EXISTING
 *    SQL table, one column per field, plain SQL where/sort — the Directus
 *    model, for relational data owned by other pipelines.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { AdapterStoreInfo, DatabaseAdapter, Doc, FindArgs, Where } from '../types';
import { APIError } from '../types';

type TableInfo = NonNullable<AdapterStoreInfo['table']>;

/** Translate raw SQLite errors on table-backed collections into actionable ones. */
async function tableOp<T>(t: TableInfo, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/no such table/i.test(msg)) {
			throw new APIError(
				`Table "${t.name}" does not exist in this D1 database. Table-backed collections ` +
					`require the table to already exist — your LOCAL D1 starts empty, so either seed it ` +
					`(npx wrangler d1 execute <db-name> --local --file schema.sql) or run against the ` +
					`remote database. Original error: ${msg}`,
				500
			);
		}
		if (/no such column: (\w+)/i.test(msg)) {
			const col = msg.match(/no such column: (\w+)/i)?.[1];
			throw new APIError(
				`Column "${col}" not found in table "${t.name}" — field names on table-backed ` +
					`collections must match column names exactly. Original error: ${msg}`,
				500
			);
		}
		throw err;
	}
}

export class D1Adapter implements DatabaseAdapter {
	readonly name = 'd1';
	private ready = false;
	private tables = new Map<string, TableInfo>();

	constructor(private db: D1Database) {}

	async init(collections: AdapterStoreInfo[]): Promise<void> {
		for (const c of collections) if (c.table) this.tables.set(c.slug, c.table);
		if (this.ready) return;
		await this.db.exec(
			`CREATE TABLE IF NOT EXISTS documents (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, id))`
		);
		// 1.8.0: version lookups (latest version, history, prune) filter on the
		// snapshot's parent; without this every lookup scans all snapshots of
		// the collection. Build it yourself first on a large live database.
		await this.db.exec(
			`CREATE INDEX IF NOT EXISTS documents_parent ON documents (collection, json_extract(data, '$.parent'), created_at)`
		);
		this.ready = true;
	}

	// ===========================================================================
	// Shared helpers
	// ===========================================================================

	private quote(ident: string): string {
		return `"${ident.replace(/"/g, '')}"`;
	}

	/** Build WHERE clauses; colFor maps a where-key to a SQL expression. */
	private whereSQL(
		where: Where | undefined,
		colFor: (path: string) => string
	): { sql: string; params: unknown[] } {
		const clauses: string[] = [];
		const params: unknown[] = [];
		if (!where) return { sql: '', params };
		for (const [path, ops] of Object.entries(where)) {
			const col = colFor(path);
			if ('equals' in ops) {
				clauses.push(`${col} = ?`);
				params.push(normalize(ops.equals));
			}
			if ('not_equals' in ops) {
				clauses.push(`(${col} IS NULL OR ${col} != ?)`);
				params.push(normalize(ops.not_equals));
			}
			if (ops.contains !== undefined) {
				clauses.push(`${col} LIKE ?`);
				params.push(`%${ops.contains}%`);
			}
			if (ops.in !== undefined && ops.in.length > 0) {
				clauses.push(`${col} IN (${ops.in.map(() => '?').join(',')})`);
				params.push(...ops.in.map(normalize));
			}
			if (ops.greater_than !== undefined) {
				clauses.push(`${col} > ?`);
				params.push(normalize(ops.greater_than));
			}
			if (ops.less_than !== undefined) {
				clauses.push(`${col} < ?`);
				params.push(normalize(ops.less_than));
			}
			if (ops.exists !== undefined) {
				clauses.push(ops.exists ? `${col} IS NOT NULL` : `${col} IS NULL`);
			}
		}
		return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
	}

	// ===========================================================================
	// Table mode
	// ===========================================================================

	private tColFor(t: TableInfo, path: string): string {
		const head = path.split('.')[0];
		if (head === 'createdAt' && t.timestamps) return this.quote(t.timestamps.createdAt);
		if (head === 'updatedAt' && t.timestamps) return this.quote(t.timestamps.updatedAt);
		return this.quote(head);
	}

	private tRowToDoc(t: TableInfo, row: Record<string, unknown>): Doc {
		const doc: Doc = { ...(row as Doc) };
		doc.id = String(row.id);
		for (const col of t.jsonColumns) {
			if (typeof doc[col] === 'string') {
				try {
					doc[col] = JSON.parse(doc[col] as string);
				} catch {
					/* leave raw */
				}
			}
		}
		for (const col of t.boolColumns) {
			if (doc[col] !== null && doc[col] !== undefined) doc[col] = Boolean(doc[col]);
		}
		if (t.timestamps) {
			doc.createdAt = row[t.timestamps.createdAt] as string;
			doc.updatedAt = row[t.timestamps.updatedAt] as string;
		}
		return doc;
	}

	private tMarshal(t: TableInfo, data: Record<string, unknown>): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(data)) {
			if (!t.columns.includes(k)) continue; // whitelist: only known field columns
			if (v === undefined) continue;
			if (t.jsonColumns.includes(k)) out[k] = v === null ? null : JSON.stringify(v);
			else if (t.boolColumns.includes(k)) out[k] = v === null ? null : v ? 1 : 0;
			else out[k] = normalize(v);
		}
		return out;
	}

	private tSortCol(t: TableInfo, sort: string | undefined): { col: string; desc: boolean } {
		const s = sort ?? '-createdAt';
		const desc = s.startsWith('-');
		let key = desc ? s.slice(1) : s;
		if ((key === 'createdAt' || key === 'updatedAt') && !t.timestamps) key = 'id';
		return { col: this.tColFor(t, key), desc };
	}

	private async tFind(t: TableInfo, args: FindArgs) {
		const { sql: whereSql, params } = this.whereSQL(args.where, (p) => this.tColFor(t, p));
		const limit = args.limit ?? 10;
		const page = args.page ?? 1;
		const { col: sortCol, desc } = this.tSortCol(t, args.sort);
		const table = this.quote(t.name);

		const countRow = await this.db
			.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE 1=1${whereSql}`)
			.bind(...params)
			.first<{ n: number }>();

		let query = `SELECT * FROM ${table} WHERE 1=1${whereSql} ORDER BY ${sortCol} ${desc ? 'DESC' : 'ASC'}`;
		const bindings: unknown[] = [...params];
		if (limit !== 0) {
			query += ' LIMIT ? OFFSET ?';
			bindings.push(limit, (page - 1) * limit);
		}
		const { results } = await this.db
			.prepare(query)
			.bind(...bindings)
			.all();
		return {
			docs: (results as Record<string, unknown>[]).map((r) => this.tRowToDoc(t, r)),
			totalDocs: countRow?.n ?? 0
		};
	}

	private async tFindById(t: TableInfo, id: string) {
		const row = await this.db
			.prepare(`SELECT * FROM ${this.quote(t.name)} WHERE id = ?`)
			.bind(id)
			.first<Record<string, unknown>>();
		return row ? this.tRowToDoc(t, row) : null;
	}

	private async tCreate(t: TableInfo, data: Record<string, unknown>) {
		const row = this.tMarshal(t, data);
		const now = new Date().toISOString();
		if (!t.autoId) row.id = crypto.randomUUID();
		if (t.timestamps) {
			row[t.timestamps.createdAt] = now;
			row[t.timestamps.updatedAt] = now;
		}
		const cols = Object.keys(row);
		const inserted = await this.db
			.prepare(
				`INSERT INTO ${this.quote(t.name)} (${cols.map((c) => this.quote(c)).join(',')}) VALUES (${cols.map(() => '?').join(',')}) RETURNING *`
			)
			.bind(...cols.map((c) => row[c]))
			.first<Record<string, unknown>>();
		return this.tRowToDoc(t, inserted!);
	}

	private async tUpdate(t: TableInfo, id: string, data: Record<string, unknown>) {
		const row = this.tMarshal(t, data);
		if (t.timestamps) row[t.timestamps.updatedAt] = new Date().toISOString();
		const cols = Object.keys(row);
		if (cols.length > 0) {
			await this.db
				.prepare(
					`UPDATE ${this.quote(t.name)} SET ${cols.map((c) => `${this.quote(c)} = ?`).join(', ')} WHERE id = ?`
				)
				.bind(...cols.map((c) => row[c]), id)
				.run();
		}
		const doc = await this.tFindById(t, id);
		if (!doc) throw new Error(`Not found after update: ${t.name}/${id}`);
		return doc;
	}

	private async tDelete(t: TableInfo, id: string) {
		await this.db.prepare(`DELETE FROM ${this.quote(t.name)} WHERE id = ?`).bind(id).run();
	}

	// ===========================================================================
	// Document mode
	// ===========================================================================

	private rowToDoc(row: Record<string, unknown>): Doc {
		const doc = JSON.parse(row.data as string) as Doc;
		doc.id = row.id as string;
		doc.createdAt = row.created_at as string;
		doc.updatedAt = row.updated_at as string;
		return doc;
	}

	private dColFor(path: string): string {
		return path === 'id'
			? 'id'
			: path === 'createdAt'
				? 'created_at'
				: path === 'updatedAt'
					? 'updated_at'
					: `json_extract(data, '$.${path.replace(/'/g, '')}')`;
	}

	// ===========================================================================
	// Public API — dispatch by mode
	// ===========================================================================

	async find(collection: string, args: FindArgs) {
		const t = this.tables.get(collection);
		if (t) return tableOp(t, () => this.tFind(t, args));

		const { sql: whereSql, params } = this.whereSQL(args.where, (p) => this.dColFor(p));
		const limit = args.limit ?? 10;
		const page = args.page ?? 1;

		const sort = args.sort ?? '-createdAt';
		const desc = sort.startsWith('-');
		const sortCol = this.dColFor(desc ? sort.slice(1) : sort);

		const countRow = await this.db
			.prepare(`SELECT COUNT(*) AS n FROM documents WHERE collection = ?${whereSql}`)
			.bind(collection, ...params)
			.first<{ n: number }>();

		let query = `SELECT * FROM documents WHERE collection = ?${whereSql} ORDER BY ${sortCol} ${desc ? 'DESC' : 'ASC'}`;
		const bindings: unknown[] = [collection, ...params];
		if (limit !== 0) {
			query += ' LIMIT ? OFFSET ?';
			bindings.push(limit, (page - 1) * limit);
		}
		const { results } = await this.db
			.prepare(query)
			.bind(...bindings)
			.all();

		return {
			docs: (results as Record<string, unknown>[]).map((r) => this.rowToDoc(r)),
			totalDocs: countRow?.n ?? 0
		};
	}

	async findById(collection: string, id: string) {
		const t = this.tables.get(collection);
		if (t) return tableOp(t, () => this.tFindById(t, id));
		const row = await this.db
			.prepare('SELECT * FROM documents WHERE collection = ? AND id = ?')
			.bind(collection, id)
			.first<Record<string, unknown>>();
		return row ? this.rowToDoc(row) : null;
	}

	async create(collection: string, data: Record<string, unknown>) {
		const t = this.tables.get(collection);
		if (t) return tableOp(t, () => this.tCreate(t, data));
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		await this.db
			.prepare(
				'INSERT INTO documents (collection, id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
			)
			.bind(collection, id, JSON.stringify(data), now, now)
			.run();
		return { ...data, id, createdAt: now, updatedAt: now } as Doc;
	}

	async update(collection: string, id: string, data: Record<string, unknown>) {
		const t = this.tables.get(collection);
		if (t) return tableOp(t, () => this.tUpdate(t, id, data));
		const existing = await this.findById(collection, id);
		if (!existing) throw new Error(`Not found: ${collection}/${id}`);
		const { id: _i, createdAt: _c, updatedAt: _u, ...body } = existing;
		const merged = { ...body, ...data };
		const now = new Date().toISOString();
		await this.db
			.prepare('UPDATE documents SET data = ?, updated_at = ? WHERE collection = ? AND id = ?')
			.bind(JSON.stringify(merged), now, collection, id)
			.run();
		return { ...merged, id, createdAt: existing.createdAt, updatedAt: now } as Doc;
	}

	async delete(collection: string, id: string) {
		const t = this.tables.get(collection);
		if (t) return tableOp(t, () => this.tDelete(t, id));
		await this.db
			.prepare('DELETE FROM documents WHERE collection = ? AND id = ?')
			.bind(collection, id)
			.run();
	}
}

function normalize(v: unknown): unknown {
	if (typeof v === 'boolean') return v ? 1 : 0;
	return v;
}
