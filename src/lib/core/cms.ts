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
	FileStorage,
	FindArgs,
	GlobalConfig,
	UploadConfig,
	PaginatedDocs,
	ReqContext,
	VersionDoc,
	VersionsConfig,
	Where
} from './types';
import { APIError } from './types';
import { applyDefaults, sanitizeData, validateData } from './validate';

export interface OperationOptions {
	/** Skip access control (server-side trusted ops, seeding). */
	overrideAccess?: boolean;
	/** Relationship population depth. Default 1. */
	depth?: number;
	/**
	 * Drafts (versioned collections only):
	 * - on update: save changes as a draft version without touching the published doc
	 * - on create: create the doc in draft state
	 * - on findByID: return the latest draft instead of the published doc
	 */
	draft?: boolean;
}

const defaultAccess: AccessFn = ({ req }) => Boolean(req.user);

export class CMS {
	readonly config: CMSConfig;
	readonly db: DatabaseAdapter;
	readonly storage?: FileStorage;
	private initialized = false;

	constructor(config: CMSConfig, db: DatabaseAdapter, storage?: FileStorage) {
		this.config = config;
		this.db = db;
		this.storage = storage;
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
		const slugs = this.config.collections.map((c) => c.slug);
		const versionStores = this.config.collections
			.filter((c) => c.versions)
			.map((c) => versionsSlug(c.slug));
		const globalStores = (this.config.globals ?? []).map((g) => globalsSlug(g.slug));
		await this.db.init([...slugs, ...versionStores, ...globalStores]);
		this.initialized = true;
	}

	// -------------------------------------------------------------------------
	// Globals
	// -------------------------------------------------------------------------

	get globals(): GlobalConfig[] {
		return this.config.globals ?? [];
	}

	global(slug: string): GlobalConfig {
		const g = this.globals.find((g) => g.slug === slug);
		if (!g) throw new APIError(`Unknown global: ${slug}`, 404);
		return g;
	}

	hasGlobal(slug: string): boolean {
		return this.globals.some((g) => g.slug === slug);
	}

	/** Pseudo collection config so globals reuse field validation/sanitization. */
	private globalAsCollection(g: GlobalConfig): CollectionConfig {
		return { slug: g.slug, fields: g.fields };
	}

	async findGlobal(req: ReqContext, slug: string, opts: OperationOptions = {}): Promise<Doc> {
		await this.init();
		const g = this.global(slug);

		if (!opts.overrideAccess) {
			const allowed = await (g.access?.read ?? defaultAccess)({ req });
			if (allowed !== true && typeof allowed !== 'object') throw new APIError('Forbidden', 403);
		}

		const { docs } = await this.db.find(globalsSlug(slug), { limit: 1 });
		const doc = docs[0] ?? ({ id: slug } as Doc);
		return this.populate(req, this.globalAsCollection(g), doc, opts.depth ?? 1);
	}

	async updateGlobal(
		req: ReqContext,
		slug: string,
		input: Record<string, unknown>,
		opts: OperationOptions = {}
	): Promise<Doc> {
		await this.init();
		const g = this.global(slug);

		if (!opts.overrideAccess) {
			const allowed = await (g.access?.update ?? defaultAccess)({ req, data: input });
			if (allowed !== true && typeof allowed !== 'object') throw new APIError('Forbidden', 403);
		}

		const pseudo = this.globalAsCollection(g);
		const data = applyDefaults(pseudo, sanitizeData(pseudo, input));
		validateData(pseudo, data);

		const store = globalsSlug(slug);
		const { docs } = await this.db.find(store, { limit: 1 });
		const doc = docs[0]
			? await this.db.update(store, docs[0].id, data)
			: await this.db.create(store, data);
		return this.populate(req, pseudo, doc, opts.depth ?? 1);
	}

	// -------------------------------------------------------------------------
	// Versions / drafts helpers
	// -------------------------------------------------------------------------

	versionsConfig(col: CollectionConfig): Required<VersionsConfig> | null {
		if (!col.versions) return null;
		const v = typeof col.versions === 'object' ? col.versions : {};
		return { drafts: v.drafts ?? false, maxPerDoc: v.maxPerDoc ?? 20 };
	}

	private async snapshotVersion(col: CollectionConfig, doc: Doc): Promise<void> {
		const vcfg = this.versionsConfig(col);
		if (!vcfg) return;
		const store = versionsSlug(col.slug);
		await this.db.create(store, { parent: doc.id, snapshot: { ...doc } });
		// prune oldest beyond maxPerDoc
		const { docs } = await this.db.find(store, {
			where: { parent: { equals: doc.id } },
			sort: '-createdAt',
			limit: 0
		});
		for (const old of docs.slice(vcfg.maxPerDoc)) await this.db.delete(store, old.id);
	}

	private async latestVersion(slug: string, id: string): Promise<VersionDoc | null> {
		const { docs } = await this.db.find(versionsSlug(slug), {
			where: { parent: { equals: id } },
			sort: '-createdAt',
			limit: 1
		});
		return (docs[0] as VersionDoc) ?? null;
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
		let doc = await this.db.findById(slug, id);
		if (!doc) throw new APIError('Not found', 404);

		// Draft read: requires update access (drafts are unpublished content).
		if (opts.draft && this.versionsConfig(col)?.drafts) {
			if (!opts.overrideAccess) {
				const access = await this.evalAccess(col, 'update', { req, id, doc });
				if (!access.allowed) throw new APIError('Forbidden', 403);
			}
			const latest = await this.latestVersion(slug, id);
			if (latest && latest.snapshot) doc = { ...latest.snapshot, id };
			return this.afterRead(req, col, doc, opts.depth ?? 1);
		}

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

	// -------------------------------------------------------------------------
	// Uploads
	// -------------------------------------------------------------------------

	uploadConfig(col: CollectionConfig): UploadConfig | null {
		if (!col.upload) return null;
		return typeof col.upload === 'object' ? col.upload : {};
	}

	private isFile(v: unknown): v is File {
		return (
			typeof v === 'object' &&
			v !== null &&
			typeof (v as File).arrayBuffer === 'function' &&
			typeof (v as File).name === 'string'
		);
	}

	/** Store an uploaded file and return the managed file fields. */
	private async storeFile(col: CollectionConfig, file: File): Promise<Record<string, unknown>> {
		const cfg = this.uploadConfig(col)!;
		if (!this.storage) throw new APIError('No file storage configured', 500);

		const max = cfg.maxFileSize ?? 10 * 1024 * 1024;
		if (file.size > max) throw new APIError(`File too large (max ${max} bytes)`, 413);
		const type = file.type || 'application/octet-stream';
		if (cfg.mimeTypes && !cfg.mimeTypes.some((m) => type.startsWith(m)))
			throw new APIError(`Unsupported file type: ${type}`, 415);

		const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120) || 'file';
		const key = `${crypto.randomUUID()}/${safeName}`;
		await this.storage.put(key, new Uint8Array(await file.arrayBuffer()), type);

		return {
			filename: safeName,
			mimeType: type,
			filesize: file.size,
			storageKey: key,
			url: `/media/${key}`
		};
	}

	async create(
		req: ReqContext,
		slug: string,
		input: Record<string, unknown>,
		opts: OperationOptions = {}
	): Promise<Doc> {
		await this.init();
		const col = this.collection(slug);

		const file = this.uploadConfig(col) && this.isFile(input.file) ? input.file : null;
		let data = applyDefaults(col, sanitizeData(col, input));

		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'create', { req, data });
			if (!access.allowed) throw new APIError('Forbidden', 403);
		}

		if (this.uploadConfig(col)) {
			if (!file) throw new APIError('A file is required (multipart field "file")', 400);
			Object.assign(data, await this.storeFile(col, file));
		}

		data = await this.runDataHooks(col, 'beforeValidate', req, 'create', data);
		validateData(col, data);
		await this.checkUnique(col, data);

		if (col.auth) {
			const password = data.password as string;
			delete data.password;
			data._hash = await hashPassword(password);
			data.email = (data.email as string).toLowerCase();
			if (typeof col.auth === 'object' && col.auth.apiKeys) {
				data.apiKey = randomHex(32);
			}
		}

		if (this.versionsConfig(col)) {
			data._status = opts.draft ? 'draft' : 'published';
		}

		data = await this.runDataHooks(col, 'beforeChange', req, 'create', data);
		const doc = await this.db.create(slug, data);
		await this.snapshotVersion(col, doc);

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

		const file = this.uploadConfig(col) && this.isFile(input.file) ? input.file : null;
		let data = sanitizeData(col, input);

		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'update', { req, id, data, doc: originalDoc });
			if (!access.allowed) throw new APIError('Forbidden', 403);
			if (access.where && !matchesWhere(originalDoc, access.where))
				throw new APIError('Forbidden', 403);
		}

		// Replacement file: store new, remove old.
		if (file) {
			Object.assign(data, await this.storeFile(col, file));
			if (typeof originalDoc.storageKey === 'string' && this.storage) {
				await this.storage.delete(originalDoc.storageKey).catch(() => {});
			}
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

		// Draft save: snapshot a version, leave the live document untouched.
		if (opts.draft && this.versionsConfig(col)?.drafts) {
			const now = new Date().toISOString();
			const draftDoc: Doc = {
				...stripMeta(originalDoc),
				...(await this.draftBase(col, slug, id)),
				...data,
				_status: 'draft',
				id,
				createdAt: originalDoc.createdAt,
				updatedAt: now
			};
			await this.snapshotVersion(col, draftDoc);
			for (const hook of col.hooks?.afterChange ?? [])
				await hook({ req, operation: 'update', collection: slug, doc: draftDoc, data, originalDoc });
			return this.afterRead(req, col, draftDoc, opts.depth ?? 1);
		}

		const doc = await this.db.update(slug, id, data);
		await this.snapshotVersion(col, doc);

		for (const hook of col.hooks?.afterChange ?? [])
			await hook({ req, operation: 'update', collection: slug, doc, data, originalDoc });

		return this.afterRead(req, col, doc, opts.depth ?? 1);
	}

	/** Base data for a draft save: the latest draft if one exists, else nothing. */
	private async draftBase(
		col: CollectionConfig,
		slug: string,
		id: string
	): Promise<Record<string, unknown>> {
		const latest = await this.latestVersion(slug, id);
		if (latest?.snapshot && latest.snapshot._status === 'draft') {
			return stripMeta(latest.snapshot as Doc);
		}
		return {};
	}

	// -------------------------------------------------------------------------
	// Publish / unpublish / version history
	// -------------------------------------------------------------------------

	/** Promote the latest draft (or current doc) to published. */
	async publish(req: ReqContext, slug: string, id: string, opts: OperationOptions = {}): Promise<Doc> {
		await this.init();
		const col = this.collection(slug);
		if (!this.versionsConfig(col)) throw new APIError(`Collection ${slug} is not versioned`, 400);
		const doc = await this.db.findById(slug, id);
		if (!doc) throw new APIError('Not found', 404);

		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'update', { req, id, doc });
			if (!access.allowed) throw new APIError('Forbidden', 403);
		}

		const latest = await this.latestVersion(slug, id);
		const source = latest?.snapshot ? { ...stripMeta(latest.snapshot as Doc) } : stripMeta(doc);
		let data: Record<string, unknown> = { ...source, _status: 'published' };
		data = await this.runDataHooks(col, 'beforeValidate', req, 'update', data, doc);
		validateData(col, data);
		data = await this.runDataHooks(col, 'beforeChange', req, 'update', data, doc);

		const updated = await this.db.update(slug, id, data);
		await this.snapshotVersion(col, updated);
		for (const hook of col.hooks?.afterChange ?? [])
			await hook({ req, operation: 'update', collection: slug, doc: updated, data, originalDoc: doc });
		return this.afterRead(req, col, updated, opts.depth ?? 1);
	}

	/** Revert a published doc to draft state (hides it from published-only readers). */
	async unpublish(req: ReqContext, slug: string, id: string, opts: OperationOptions = {}): Promise<Doc> {
		await this.init();
		const col = this.collection(slug);
		if (!this.versionsConfig(col)) throw new APIError(`Collection ${slug} is not versioned`, 400);
		const doc = await this.db.findById(slug, id);
		if (!doc) throw new APIError('Not found', 404);

		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'update', { req, id, doc });
			if (!access.allowed) throw new APIError('Forbidden', 403);
		}
		const updated = await this.db.update(slug, id, { _status: 'draft' });
		await this.snapshotVersion(col, updated);
		return this.afterRead(req, col, updated, opts.depth ?? 1);
	}

	/** List version snapshots for a document, newest first. */
	async findVersions(
		req: ReqContext,
		slug: string,
		id: string,
		opts: OperationOptions = {}
	): Promise<VersionDoc[]> {
		await this.init();
		const col = this.collection(slug);
		if (!this.versionsConfig(col)) throw new APIError(`Collection ${slug} is not versioned`, 400);

		if (!opts.overrideAccess) {
			const doc = await this.db.findById(slug, id);
			if (!doc) throw new APIError('Not found', 404);
			const access = await this.evalAccess(col, 'update', { req, id, doc });
			if (!access.allowed) throw new APIError('Forbidden', 403);
		}
		const { docs } = await this.db.find(versionsSlug(slug), {
			where: { parent: { equals: id } },
			sort: '-createdAt',
			limit: 0
		});
		return docs as VersionDoc[];
	}

	/** Restore a version snapshot onto the live document. */
	async restoreVersion(
		req: ReqContext,
		slug: string,
		id: string,
		versionId: string,
		opts: OperationOptions = {}
	): Promise<Doc> {
		await this.init();
		const col = this.collection(slug);
		if (!this.versionsConfig(col)) throw new APIError(`Collection ${slug} is not versioned`, 400);
		const doc = await this.db.findById(slug, id);
		if (!doc) throw new APIError('Not found', 404);

		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'update', { req, id, doc });
			if (!access.allowed) throw new APIError('Forbidden', 403);
		}

		const version = (await this.db.findById(versionsSlug(slug), versionId)) as VersionDoc | null;
		if (!version || version.parent !== id) throw new APIError('Version not found', 404);

		const data = { ...stripMeta(version.snapshot as Doc) };
		const updated = await this.db.update(slug, id, data);
		await this.snapshotVersion(col, updated);
		return this.afterRead(req, col, updated, opts.depth ?? 1);
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

		// Upload collections: remove the stored file too.
		if (this.uploadConfig(col) && typeof doc.storageKey === 'string' && this.storage) {
			await this.storage.delete(doc.storageKey).catch(() => {});
		}

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

	/**
	 * Authenticate an `Authorization: <collection> API-Key <key>` header.
	 * Returns the user document, or null.
	 */
	async authenticateAPIKey(header: string | undefined | null): Promise<Doc | null> {
		if (!header) return null;
		const m = header.match(/^(\S+)\s+API-Key\s+(\S+)$/i);
		if (!m) return null;
		const [, slug, key] = m;
		if (!this.hasCollection(slug)) return null;
		const col = this.collection(slug);
		if (!col.auth || typeof col.auth !== 'object' || !col.auth.apiKeys) return null;

		await this.init();
		const { docs } = await this.db.find(slug, { where: { apiKey: { equals: key } }, limit: 1 });
		if (!docs[0]) return null;
		const clean = this.sanitizeOutput(col, docs[0]);
		clean._collection = slug;
		return clean;
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
		// API keys are secrets: only the user themself (or an admin) may see them.
		if ('apiKey' in out) {
			const isSelf = req.user?.id === out.id;
			const isAdmin = req.user?.role === 'admin';
			if (!isSelf && !isAdmin) delete out.apiKey;
		}
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
			if (field.type !== 'relationship' && field.type !== 'upload') continue;
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

			const hasMany = field.type === 'relationship' && Boolean(field.hasMany);
			out[field.name] = hasMany
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

function randomHex(bytes: number): string {
	const buf = crypto.getRandomValues(new Uint8Array(bytes));
	return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function versionsSlug(slug: string): string {
	return `_versions_${slug}`;
}

export function globalsSlug(slug: string): string {
	return `_global_${slug}`;
}

export { APIError };
