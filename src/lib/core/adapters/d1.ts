/**
 * Cloudflare D1 adapter. Schema-less by design: one `documents` table, with
 * the document body stored as JSON and queried via SQLite's json_extract().
 * This keeps collections config-driven with no migrations — exactly the
 * trade Payload's Mongo adapter makes.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { DatabaseAdapter, Doc, FindArgs, Where } from '../types';

export class D1Adapter implements DatabaseAdapter {
	readonly name = 'd1';
	private ready = false;

	constructor(private db: D1Database) {}

	async init(_collections: string[]): Promise<void> {
		if (this.ready) return;
		await this.db.exec(
			`CREATE TABLE IF NOT EXISTS documents (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (collection, id))`
		);
		this.ready = true;
	}

	private rowToDoc(row: Record<string, unknown>): Doc {
		const doc = JSON.parse(row.data as string) as Doc;
		doc.id = row.id as string;
		doc.createdAt = row.created_at as string;
		doc.updatedAt = row.updated_at as string;
		return doc;
	}

	/** Build a WHERE clause from a Where object using json_extract. */
	private buildWhere(where?: Where): { sql: string; params: unknown[] } {
		const clauses: string[] = [];
		const params: unknown[] = [];
		if (!where) return { sql: '', params };
		for (const [path, ops] of Object.entries(where)) {
			const col =
				path === 'id'
					? 'id'
					: path === 'createdAt'
						? 'created_at'
						: path === 'updatedAt'
							? 'updated_at'
							: `json_extract(data, '$.${path.replace(/'/g, '')}')`;
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

	async find(collection: string, args: FindArgs) {
		const { sql: whereSql, params } = this.buildWhere(args.where);
		const limit = args.limit ?? 10;
		const page = args.page ?? 1;

		const sort = args.sort ?? '-createdAt';
		const desc = sort.startsWith('-');
		const sortKey = desc ? sort.slice(1) : sort;
		const sortCol =
			sortKey === 'id'
				? 'id'
				: sortKey === 'createdAt'
					? 'created_at'
					: sortKey === 'updatedAt'
						? 'updated_at'
						: `json_extract(data, '$.${sortKey.replace(/'/g, '')}')`;

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
		const row = await this.db
			.prepare('SELECT * FROM documents WHERE collection = ? AND id = ?')
			.bind(collection, id)
			.first<Record<string, unknown>>();
		return row ? this.rowToDoc(row) : null;
	}

	async create(collection: string, data: Record<string, unknown>) {
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
