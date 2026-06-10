/**
 * The CMS engine — equivalent of Payload's "Local API".
 * Framework-agnostic: constructed with a config + database adapter, exposes
 * find/findByID/create/update/delete/login/me with access control, hooks,
 * validation, and relationship population.
 */
import { matchesWhere } from './adapters/memory';
import { hashPassword, signJWT, verifyJWT, verifyPassword } from './crypto';
import type {
	AccessArgs,
	AccessFn,
	CMSConfig,
	CollectionConfig,
	DatabaseAdapter,
	Doc,
	FindArgs,
	PaginatedDocs,
	ReqContext,
	Where
} from './types';
import { APIError } from './types';
import { applyDefaults, sanitizeData, validateData } from './validate';

export interface OperationOptions {
	/** Skip access control (server-side trusted ops, seeding). */
	overrideAccess?: boolean;
	/** Relationship population depth. Default 1. */
	depth?: number;
}

const defaultAccess: AccessFn = ({ req }) => Boolean(req.user);

export class CMS {
	readonly config: CMSConfig;
	readonly db: DatabaseAdapter;
	private initialized = false;

	constructor(config: CMSConfig, db: DatabaseAdapter) {
		this.config = config;
		this.db = db;
	}

	get secret(): string {
		return this.config.secret ?? 'dev-secret-change-me';
	}

	get collections(): CollectionConfig[] {
		return this.config.collections;
	}

	collection(slug: string): CollectionConfig {
		const col = this.config.collections.find((c) => c.slug === slug);
		if (!col) throw new APIError(`Unknown collection: ${slug}`, 404);
		return col;
	}

	hasCollection(slug: string): boolean {
		return this.config.collections.some((c) => c.slug === slug);
	}

	async init(): Promise<void> {
		if (this.initialized) return;
		await this.db.init(this.config.collections.map((c) => c.slug));
		this.initialized = true;
	}

	// -------------------------------------------------------------------------
	// Access control
	// -------------------------------------------------------------------------

	private async evalAccess(
		col: CollectionConfig,
		op: keyof NonNullable<CollectionConfig['access']>,
		args: AccessArgs
	): Promise<{ allowed: boolean; where?: Where }> {
		const fn = col.access?.[op] ?? defaultAccess;
		const result = await fn(args);
		if (typeof result === 'boolean') return { allowed: result };
		return { allowed: true, where: result };
	}

	// -------------------------------------------------------------------------
	// Read
	// -------------------------------------------------------------------------

	async find(
		req: ReqContext,
		slug: string,
		args: FindArgs = {},
		opts: OperationOptions = {}
	): Promise<PaginatedDocs> {
		await this.init();
		const col = this.collection(slug);

		let where = args.where;
		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'read', { req });
			if (!access.allowed) throw new APIError('Forbidden', 403);
			if (access.where) where = { ...where, ...access.where };
		}

		const limit = clamp(args.limit ?? 10, 0, 100);
		const page = Math.max(args.page ?? 1, 1);
		const { docs, totalDocs } = await this.db.find(slug, { ...args, where, limit, page });

		const out: Doc[] = [];
		for (const doc of docs) out.push(await this.afterRead(req, col, doc, opts.depth ?? 1));

		const totalPages = limit === 0 ? 1 : Math.max(Math.ceil(totalDocs / limit), 1);
		return {
			docs: out,
			totalDocs,
			limit,
			page,
			totalPages,
			hasNextPage: page < totalPages,
			hasPrevPage: page > 1
		};
	}

	async findByID(
		req: ReqContext,
		slug: string,
		id: string,
		opts: OperationOptions = {}
	): Promise<Doc> {
		await this.init();
		const col = this.collection(slug);
		const doc = await this.db.findById(slug, id);
		if (!doc) throw new APIError('Not found', 404);

		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'read', { req, id, doc });
			if (!access.allowed) throw new APIError('Forbidden', 403);
			if (access.where && !matchesWhere(doc, access.where)) throw new APIError('Forbidden', 403);
		}
		return this.afterRead(req, col, doc, opts.depth ?? 1);
	}

	// -------------------------------------------------------------------------
	// Write
	// -------------------------------------------------------------------------

	async create(
		req: ReqContext,
		slug: string,
		input: Record<string, unknown>,
		opts: OperationOptions = {}
	): Promise<Doc> {
		await this.init();
		const col = this.collection(slug);

		let data = applyDefaults(col, sanitizeData(col, input));

		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'create', { req, data });
			if (!access.allowed) throw new APIError('Forbidden', 403);
		}

		data = await this.runDataHooks(col, 'beforeValidate', req, 'create', data);
		validateData(col, data);
		await this.checkUnique(col, data);

		if (col.auth) {
			const password = data.password as string;
			delete data.password;
			data._hash = await hashPassword(password);
			data.email = (data.email as string).toLowerCase();
		}

		data = await this.runDataHooks(col, 'beforeChange', req, 'create', data);
		const doc = await this.db.create(slug, data);

		for (const hook of col.hooks?.afterChange ?? [])
			await hook({ req, operation: 'create', collection: slug, doc, data });

		return this.afterRead(req, col, doc, opts.depth ?? 1);
	}

	async update(
		req: ReqContext,
		slug: string,
		id: string,
		input: Record<string, unknown>,
		opts: OperationOptions = {}
	): Promise<Doc> {
		await this.init();
		const col = this.collection(slug);
		const originalDoc = await this.db.findById(slug, id);
		if (!originalDoc) throw new APIError('Not found', 404);

		let data = sanitizeData(col, input);

		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'update', { req, id, data, doc: originalDoc });
			if (!access.allowed) throw new APIError('Forbidden', 403);
			if (access.where && !matchesWhere(originalDoc, access.where))
				throw new APIError('Forbidden', 403);
		}

		data = await this.runDataHooks(col, 'beforeValidate', req, 'update', data, originalDoc);
		validateData(col, { ...stripMeta(originalDoc), ...data }, { partial: false });
		await this.checkUnique(col, data, id);

		if (col.auth) {
			if (typeof data.password === 'string' && data.password.length > 0) {
				data._hash = await hashPassword(data.password);
			}
			delete data.password;
			if (typeof data.email === 'string') data.email = data.email.toLowerCase();
		}

		data = await this.runDataHooks(col, 'beforeChange', req, 'update', data, originalDoc);
		const doc = await this.db.update(slug, id, data);

		for (const hook of col.hooks?.afterChange ?? [])
			await hook({ req, operation: 'update', collection: slug, doc, data, originalDoc });

		return this.afterRead(req, col, doc, opts.depth ?? 1);
	}

	async delete(
		req: ReqContext,
		slug: string,
		id: string,
		opts: OperationOptions = {}
	): Promise<void> {
		await this.init();
		const col = this.collection(slug);
		const doc = await this.db.findById(slug, id);
		if (!doc) throw new APIError('Not found', 404);

		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'delete', { req, id, doc });
			if (!access.allowed) throw new APIError('Forbidden', 403);
			if (access.where && !matchesWhere(doc, access.where)) throw new APIError('Forbidden', 403);
		}

		for (const hook of col.hooks?.beforeDelete ?? [])
			await hook({ req, operation: 'delete', collection: slug, doc });

		await this.db.delete(slug, id);

		for (const hook of col.hooks?.afterDelete ?? [])
			await hook({ req, operation: 'delete', collection: slug, doc });
	}

	// -------------------------------------------------------------------------
	// Auth
	// -------------------------------------------------------------------------

	async login(
		slug: string,
		email: string,
		password: string
	): Promise<{ token: string; user: Doc; exp: number }> {
		await this.init();
		const col = this.collection(slug);
		if (!col.auth) throw new APIError(`Collection ${slug} does not support auth`, 400);

		const { docs } = await this.db.find(slug, {
			where: { email: { equals: email.toLowerCase() } },
			limit: 1
		});
		const user = docs[0];
		if (!user || typeof user._hash !== 'string')
			throw new APIError('Invalid email or password', 401);

		const ok = await verifyPassword(password, user._hash);
		if (!ok) throw new APIError('Invalid email or password', 401);

		const expiration =
			typeof col.auth === 'object' && col.auth.tokenExpiration ? col.auth.tokenExpiration : 7200;
		const token = await signJWT({ sub: user.id, col: slug }, this.secret, expiration);
		const exp = Math.floor(Date.now() / 1000) + expiration;
		return { token, user: this.sanitizeOutput(col, user), exp };
	}

	/** Resolve a token to its user document, or null. */
	async authenticate(token: string | undefined | null): Promise<Doc | null> {
		if (!token) return null;
		await this.init();
		const payload = await verifyJWT(token, this.secret);
		if (!payload) return null;
		if (!this.hasCollection(payload.col)) return null;
		const col = this.collection(payload.col);
		const user = await this.db.findById(payload.col, payload.sub);
		if (!user) return null;
		const clean = this.sanitizeOutput(col, user);
		clean._collection = payload.col;
		return clean;
	}

	/** True if any auth-enabled collection has zero documents (first-run). */
	async needsFirstUser(): Promise<{ collection: string } | null> {
		await this.init();
		for (const col of this.config.collections) {
			if (!col.auth) continue;
			const { totalDocs } = await this.db.find(col.slug, { limit: 1 });
			if (totalDocs === 0) return { collection: col.slug };
			return null;
		}
		return null;
	}

	// -------------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------------

	private async runDataHooks(
		col: CollectionConfig,
		phase: 'beforeValidate' | 'beforeChange',
		req: ReqContext,
		operation: 'create' | 'update',
		data: Record<string, unknown>,
		originalDoc?: Doc
	): Promise<Record<string, unknown>> {
		let out = data;
		for (const hook of col.hooks?.[phase] ?? []) {
			const result = await hook({ req, operation, collection: col.slug, data: out, originalDoc });
			if (result) out = result;
		}
		return out;
	}

	private async checkUnique(
		col: CollectionConfig,
		data: Record<string, unknown>,
		excludeId?: string
	): Promise<void> {
		const uniqueFields = col.fields.filter((f) => f.unique).map((f) => f.name);
		if (col.auth) uniqueFields.push('email');
		for (const name of uniqueFields) {
			const value = data[name];
			if (value === undefined || value === null || value === '') continue;
			const { docs } = await this.db.find(col.slug, {
				where: { [name]: { equals: value } },
				limit: 1
			});
			if (docs[0] && docs[0].id !== excludeId)
				throw new APIError(`A document with ${name} "${String(value)}" already exists`, 409);
		}
	}

	private sanitizeOutput(col: CollectionConfig, doc: Doc): Doc {
		const out = { ...doc };
		if (col.auth) delete out._hash;
		return out;
	}

	private async afterRead(req: ReqContext, col: CollectionConfig, doc: Doc, depth: number): Promise<Doc> {
		let out = this.sanitizeOutput(col, doc);
		if (depth > 0) out = await this.populate(req, col, out, depth);
		for (const hook of col.hooks?.afterRead ?? []) {
			const result = await hook({ req, operation: 'read', collection: col.slug, doc: out });
			if (result) out = result;
		}
		return out;
	}

	/** Replace relationship ids with the related documents, down to `depth`. */
	private async populate(req: ReqContext, col: CollectionConfig, doc: Doc, depth: number): Promise<Doc> {
		const out = { ...doc };
		for (const field of col.fields) {
			if (field.type !== 'relationship') continue;
			const value = out[field.name];
			if (value == null) continue;
			if (!this.hasCollection(field.relationTo)) continue;

			const resolve = async (id: unknown): Promise<unknown> => {
				if (typeof id !== 'string') return id;
				try {
					const related = await this.findByID(req, field.relationTo, id, { depth: depth - 1 });
					return related;
				} catch {
					return id; // dangling or forbidden: leave the raw id
				}
			};

			out[field.name] = field.hasMany
				? await Promise.all((Array.isArray(value) ? value : [value]).map(resolve))
				: await resolve(value);
		}
		return out;
	}
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(Math.max(n, min), max);
}

function stripMeta(doc: Doc): Record<string, unknown> {
	const { id: _i, createdAt: _c, updatedAt: _u, _hash: _h, ...rest } = doc;
	return rest;
}

export { APIError };
