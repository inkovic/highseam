/**
 * The CMS engine — the Local API: call it directly server-side, no HTTP.
 * Framework-agnostic: constructed with a config + database adapter, exposes
 * find/findByID/create/update/delete/login/me with access control, hooks,
 * validation, and relationship population.
 */
import { matchesWhere } from './adapters/memory';
import { extractRichTextRefs } from './richtext';
import { hashPassword, signJWT, verifyJWT, verifyPassword } from './crypto';
import type {
	AccessArgs,
	AccessFn,
	AdapterStoreInfo,
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
	/**
	 * Locale for localized fields. Defaults to the config's defaultLocale.
	 * Pass 'all' to read the raw per-locale objects.
	 */
	locale?: string;
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
		const stores: AdapterStoreInfo[] = this.config.collections.map((c) => ({
			slug: c.slug,
			table: this.tableInfo(c)
		}));
		for (const c of this.config.collections)
			if (c.versions) stores.push({ slug: versionsSlug(c.slug) });
		for (const g of this.config.globals ?? []) stores.push({ slug: globalsSlug(g.slug) });
		stores.push({ slug: '_locks' });
		await this.db.init(stores);
		this.initialized = true;
	}

	/** Build adapter metadata for table-backed collections. */
	private tableInfo(col: CollectionConfig): AdapterStoreInfo['table'] | undefined {
		if (!col.table) return undefined;
		const t = typeof col.table === 'string' ? { name: col.table } : col.table;
		const jsonColumns: string[] = [];
		const boolColumns: string[] = [];
		for (const f of col.fields) {
			if (
				f.type === 'array' ||
				f.type === 'blocks' ||
				f.type === 'json' ||
				f.type === 'richText' ||
				f.localized
			)
				jsonColumns.push(f.name);
			else if (f.type === 'checkbox') boolColumns.push(f.name);
		}
		const columns = col.fields.map((f) => f.name);
		if (col.versions) columns.push('_status');
		return {
			name: t.name,
			autoId: t.autoId ?? false,
			timestamps: t.timestamps ?? false,
			jsonColumns,
			boolColumns,
			columns
		};
	}

	// -------------------------------------------------------------------------
	// Document locking (admin editing)
	// -------------------------------------------------------------------------

	private static LOCK_TTL_MS = 5 * 60 * 1000;

	/**
	 * Try to take the edit lock on a document. Returns the competing holder
	 * if someone else has a fresh lock, otherwise takes/refreshes the lock.
	 */
	async takeLock(
		slug: string,
		id: string,
		user: Doc | null
	): Promise<{ lockedBy: { email: string; at: string } | null }> {
		await this.init();
		if (!user) return { lockedBy: null };

		const { docs } = await this.db.find('_locks', {
			where: { collection: { equals: slug }, parent: { equals: id } },
			limit: 1
		});
		const lock = docs[0];
		const fresh = lock && Date.now() - Date.parse(String(lock.at)) < CMS.LOCK_TTL_MS;

		if (lock && fresh && lock.user !== user.id) {
			return { lockedBy: { email: String(lock.email ?? 'another user'), at: String(lock.at) } };
		}
		if (lock) await this.db.delete('_locks', lock.id);
		await this.db.create('_locks', {
			collection: slug,
			parent: id,
			user: user.id,
			email: user.email ?? user.id,
			at: new Date().toISOString()
		});
		return { lockedBy: null };
	}

	/** Release the lock if held by this user (called after a successful save). */
	async releaseLock(slug: string, id: string, user: Doc | null): Promise<void> {
		await this.init();
		if (!user) return;
		const { docs } = await this.db.find('_locks', {
			where: { collection: { equals: slug }, parent: { equals: id } },
			limit: 1
		});
		if (docs[0] && docs[0].user === user.id) await this.db.delete('_locks', docs[0].id);
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
		const pseudo = this.globalAsCollection(g);
		const doc = this.flattenLocalized(pseudo, docs[0] ?? ({ id: slug } as Doc), this.resolveLocale(opts));
		return this.populate(req, pseudo, doc, opts.depth ?? 1);
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
		const locale = this.resolveLocale(opts);
		const data = applyDefaults(pseudo, sanitizeData(pseudo, input));
		validateData(pseudo, data);

		const store = globalsSlug(slug);
		const { docs } = await this.db.find(store, { limit: 1 });
		const wrapped = this.wrapLocalized(pseudo, data, locale, docs[0]);
		const doc = docs[0]
			? await this.db.update(store, docs[0].id, wrapped)
			: await this.db.create(store, wrapped);
		return this.populate(req, pseudo, this.flattenLocalized(pseudo, doc, locale), opts.depth ?? 1);
	}

	// -------------------------------------------------------------------------
	// Localization helpers
	// -------------------------------------------------------------------------

	/** Resolve the effective locale for an operation ('all', a locale, or null if localization is off). */
	resolveLocale(opts: OperationOptions): string | null {
		const cfg = this.config.localization;
		if (!cfg) return null;
		const l = opts.locale ?? cfg.defaultLocale;
		if (l === 'all') return 'all';
		return cfg.locales.includes(l) ? l : cfg.defaultLocale;
	}

	/** Read-side: collapse per-locale objects to the requested locale (with default-locale fallback). */
	private flattenLocalized(col: Pick<CollectionConfig, 'fields'>, doc: Doc, locale: string | null): Doc {
		const cfg = this.config.localization;
		if (!cfg || locale === null || locale === 'all') return doc;
		const out = { ...doc };
		for (const f of col.fields) {
			if (!f.localized) continue;
			const v = out[f.name];
			if (v && typeof v === 'object' && !Array.isArray(v)) {
				const o = v as Record<string, unknown>;
				out[f.name] = o[locale] ?? o[cfg.defaultLocale] ?? null;
			}
		}
		return out;
	}

	/** Write-side: merge flat localized values into the stored per-locale objects. */
	private wrapLocalized(
		col: Pick<CollectionConfig, 'fields'>,
		data: Record<string, unknown>,
		locale: string | null,
		base?: Doc | Record<string, unknown>
	): Record<string, unknown> {
		const cfg = this.config.localization;
		if (!cfg || locale === null || locale === 'all') return data;
		const out = { ...data };
		for (const f of col.fields) {
			if (!f.localized || !(f.name in out)) continue;
			const existing = base?.[f.name];
			const existingObj =
				existing && typeof existing === 'object' && !Array.isArray(existing)
					? (existing as Record<string, unknown>)
					: existing != null
						? { [cfg.defaultLocale]: existing }
						: {};
			out[f.name] = { ...existingObj, [locale]: out[f.name] };
		}
		return out;
	}

	/** Rewrite where/sort keys on localized fields to `<name>.<locale>`. */
	private localizeKey(col: CollectionConfig, key: string, locale: string | null): string {
		const cfg = this.config.localization;
		if (!cfg || locale === null || locale === 'all') return key;
		const [head, ...rest] = key.split('.');
		const field = col.fields.find((f) => f.name === head);
		if (!field?.localized) return key;
		return [head, locale, ...rest].join('.');
	}

	private localizeWhere(col: CollectionConfig, where: Where | undefined, locale: string | null): Where | undefined {
		if (!where) return where;
		const out: Where = {};
		for (const [k, v] of Object.entries(where)) out[this.localizeKey(col, k, locale)] = v;
		return out;
	}

	// -------------------------------------------------------------------------
	// Versions / drafts helpers
	// -------------------------------------------------------------------------

	versionsConfig(col: CollectionConfig): Required<VersionsConfig> | null {
		if (!col.versions) return null;
		const v = typeof col.versions === 'object' ? col.versions : {};
		return {
			drafts: v.drafts ?? false,
			maxPerDoc: v.maxPerDoc ?? 20,
			schedulePublish: v.schedulePublish ?? false
		};
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
		const locale = this.resolveLocale(opts);

		await this.sweepScheduledPublishes(col);

		let where = this.localizeWhere(col, args.where, locale);
		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'read', { req });
			if (!access.allowed) throw new APIError('Forbidden', 403);
			if (access.where) where = { ...where, ...access.where };
		}

		const sort = args.sort ? this.localizeKey(col, args.sort.replace(/^-/, ''), locale) : undefined;
		const sortArg = sort && args.sort?.startsWith('-') ? `-${sort}` : sort;

		const limit = clamp(args.limit ?? 10, 0, 100);
		const page = Math.max(args.page ?? 1, 1);
		const { docs, totalDocs } = await this.db.find(slug, {
			...args,
			where,
			sort: sortArg ?? args.sort,
			limit,
			page
		});

		const out: Doc[] = [];
		for (const doc of docs) out.push(await this.afterRead(req, col, doc, opts.depth ?? 1, locale));

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
		const locale = this.resolveLocale(opts);
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
			return this.afterRead(req, col, doc, opts.depth ?? 1, locale);
		}

		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'read', { req, id, doc });
			if (!access.allowed) throw new APIError('Forbidden', 403);
			if (access.where && !matchesWhere(doc, access.where)) throw new APIError('Forbidden', 403);
		}
		return this.afterRead(req, col, doc, opts.depth ?? 1, locale);
	}

	// -------------------------------------------------------------------------
	// Write
	// -------------------------------------------------------------------------

	// -------------------------------------------------------------------------
	// Media import — provenance-aware create-or-update for pipelines
	// -------------------------------------------------------------------------

	/**
	 * Import one media item. Designed for external pipelines (mirror scripts,
	 * backfills) whose facts differ from human uploads in three ways:
	 *
	 * 1. **Identity is importer-declared.** Origin URLs can be signed and rot
	 *    (re-fetching mints a different URL for the same photo), so dedupe
	 *    keys on `source.externalKey` — e.g. `venue:8545` — never on URL
	 *    equality. A matching key means UPDATE the existing doc: identity and
	 *    usage backlinks survive a re-mint that changes url and bytes.
	 * 2. **Adopt-in-place.** `storageKey` references an object that already
	 *    exists in storage — no byte movement. A backfill of thousands of
	 *    existing files creates documents only. Adopted keys are
	 *    importer-owned: highseam never deletes them on update/delete.
	 * 3. **Provenance is importer-settable.** `source` / `firstUsedIn` /
	 *    metadata are stated, not inferred; imports know their own story.
	 *    `firstUsedIn` is a historical fact — once set it is never silently
	 *    changed (live usage is computed separately via findUsage).
	 *
	 * Never silent: returns `{ doc, action }` where action is
	 * 'created' | 'updated' | 'unchanged'.
	 */
	async importMedia(
		req: ReqContext,
		slug: string,
		item: {
			/** Raw file bytes (multipart path). Mutually exclusive with storageKey. */
			file?: File;
			/** Adopt an EXISTING storage object (no upload, importer-owned key). */
			storageKey?: string;
			filename?: string;
			mimeType?: string;
			filesize?: number;
			/** Field path used for dedupe. Default 'source.externalKey'. */
			dedupeKey?: string;
			/** Declared collection fields (source, firstUsedIn, alt, tags, …). */
			data?: Record<string, unknown>;
		},
		opts: OperationOptions = {}
	): Promise<{ doc: Doc; action: 'created' | 'updated' | 'unchanged' }> {
		await this.init();
		const col = this.collection(slug);
		if (!this.uploadConfig(col)) throw new APIError(`Collection ${slug} is not an upload collection`, 400);

		const data = item.data ?? {};

		// Guardrail: the create/update paths run sanitizeData, which strips
		// keys the collection doesn't declare. Silently importing thousands of
		// docs WITHOUT their provenance would be the worst possible outcome,
		// so fail loudly on the first item instead.
		const declared = new Set<string>(col.fields.map((f) => f.name));
		const undeclared = Object.keys(data).filter((k) => !declared.has(k));
		if (undeclared.length > 0) {
			throw new APIError(
				`Import data contains fields not declared on "${slug}": ${undeclared.join(', ')}. ` +
					`Declare them on the collection (e.g. { name: '${undeclared[0]}', type: 'json' }) ` +
					`or remove them — undeclared fields would be silently dropped by sanitization.`,
				400
			);
		}

		const dedupeKey = item.dedupeKey ?? 'source.externalKey';
		const dedupeValue = dedupeKey
			.split('.')
			.reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Doc)[k] : undefined), data);

		// --- find existing by identity ---------------------------------------
		let existing: Doc | null = null;
		if (typeof dedupeValue === 'string' && dedupeValue) {
			const { docs } = await this.db.find(slug, {
				where: { [dedupeKey]: { equals: dedupeValue } },
				limit: 1
			});
			existing = docs[0] ?? null;
		}

		// --- managed file fields ----------------------------------------------
		let fileFields: Record<string, unknown> = {};
		if (item.file) {
			// Normal storage path: mime/size limits apply, we own the key.
			if (!opts.overrideAccess) {
				const access = await this.evalAccess(col, existing ? 'update' : 'create', { req, data });
				if (!access.allowed) throw new APIError('Forbidden', 403);
			}
			fileFields = await this.storeFile(col, item.file);
		} else if (item.storageKey) {
			if (item.storageKey.includes('..')) throw new APIError('Invalid storageKey', 400);
			fileFields = {
				storageKey: item.storageKey,
				url: `/media/${item.storageKey}`,
				// Importer-stated facts; the file is not read to verify them.
				filename: item.filename ?? item.storageKey.split('/').pop() ?? 'file',
				mimeType: item.mimeType ?? 'application/octet-stream',
				...(item.filesize !== undefined ? { filesize: item.filesize } : {}),
				/** Marks the stored object as importer-owned: never auto-deleted. */
				_adopted: true
			};
		} else if (!existing) {
			throw new APIError('Import item needs either `file` or `storageKey`', 400);
		}

		// --- update under the same identity -----------------------------------
		if (existing) {
			// firstUsedIn is history: never silently overwritten.
			const merged = { ...data };
			if (existing.firstUsedIn && merged.firstUsedIn) delete merged.firstUsedIn;

			const before = JSON.stringify(
				Object.fromEntries(Object.keys({ ...merged, ...fileFields }).map((k) => [k, existing![k]]))
			);
			const after = JSON.stringify({ ...merged, ...fileFields });
			if (before === after) return { doc: existing, action: 'unchanged' };

			const updated = await this.update(req, slug, existing.id, merged, {
				...opts,
				overrideAccess: opts.overrideAccess
			});
			// Managed fields bypass sanitizeData (they're not declared fields).
			const withFile =
				Object.keys(fileFields).length > 0
					? await this.db.update(slug, existing.id, fileFields)
					: updated;
			return { doc: this.sanitizeOutput(col, withFile), action: 'updated' };
		}

		// --- create -----------------------------------------------------------
		if (!opts.overrideAccess) {
			const access = await this.evalAccess(col, 'create', { req, data });
			if (!access.allowed) throw new APIError('Forbidden', 403);
		}
		const clean = applyDefaults(col, sanitizeData(col, data));
		validateData(col, clean);
		const doc = await this.db.create(slug, { ...clean, ...fileFields });
		return { doc: this.sanitizeOutput(col, doc), action: 'created' };
	}

	// -------------------------------------------------------------------------
	// Usage / references
	// -------------------------------------------------------------------------

	/**
	 * Every id of `targetSlug` referenced by any other collection.
	 *
	 * Computed on demand rather than maintained as an index: a maintained
	 * table would need every write in the system to diff old/new values and
	 * update backlinks — write-path complexity plus a permanent risk of drift.
	 * This scan is O(collections with references), not O(documents), and is
	 * always correct by construction. Add a cache when it's measurably slow,
	 * not before.
	 */
	async referencedIds(targetSlug: string): Promise<Set<string>> {
		await this.init();
		const referenced = new Set<string>();

		for (const col of this.config.collections) {
			const fields = col.fields.filter(
				(f) => (f.type === 'relationship' || f.type === 'upload') && f.relationTo === targetSlug
			);
			// richText fields can embed uploads/relationships inside their nodes.
			const richTextFields = col.fields.filter(
				(f) =>
					f.type === 'richText' &&
					(f.uploads === targetSlug || (f.relationships ?? []).includes(targetSlug))
			);
			if (fields.length === 0 && richTextFields.length === 0) continue;

			const { docs } = await this.db.find(col.slug, { limit: 0 });
			for (const doc of docs) {
				for (const f of fields) {
					const v = doc[f.name];
					for (const id of Array.isArray(v) ? v : [v]) {
						if (typeof id === 'string' && id) referenced.add(id);
					}
				}
				for (const f of richTextFields) {
					for (const ref of extractRichTextRefs(doc[f.name])) {
						if (ref.relationTo === targetSlug) referenced.add(ref.id);
					}
				}
			}
		}
		return referenced;
	}

	/** Where a specific document is used: [{collection, id, field, title}]. */
	async findUsage(
		targetSlug: string,
		id: string
	): Promise<{ collection: string; id: string; field: string; title: string }[]> {
		await this.init();
		const uses: { collection: string; id: string; field: string; title: string }[] = [];

		for (const col of this.config.collections) {
			const titleKey = col.admin?.useAsTitle ?? 'id';
			const direct = col.fields.filter(
				(f) => (f.type === 'relationship' || f.type === 'upload') && f.relationTo === targetSlug
			);
			const rich = col.fields.filter(
				(f) =>
					f.type === 'richText' &&
					(f.uploads === targetSlug || (f.relationships ?? []).includes(targetSlug))
			);
			if (direct.length === 0 && rich.length === 0) continue;

			const { docs } = await this.db.find(col.slug, { limit: 0 });
			for (const doc of docs) {
				const title = String(doc[titleKey] ?? doc.id);
				for (const f of direct) {
					const v = doc[f.name];
					const hit = (Array.isArray(v) ? v : [v]).some((x) => x === id);
					if (hit) uses.push({ collection: col.slug, id: doc.id, field: f.name, title });
				}
				for (const f of rich) {
					if (extractRichTextRefs(doc[f.name]).some((r) => r.id === id))
						uses.push({ collection: col.slug, id: doc.id, field: f.name, title });
				}
			}
		}
		return uses;
	}

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
		if (!this.storage)
			throw new APIError(
				`Collection "${col.slug}" accepts uploads but no file storage is configured. ` +
					`On Cloudflare, bind an R2 bucket as BUCKET in wrangler.toml ` +
					`(create it with: npx wrangler r2 bucket create <name>). Local dev stores ` +
					`files under .data/uploads automatically.`,
				500
			);

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

		const locale = this.resolveLocale(opts);

		data = await this.runDataHooks(col, 'beforeValidate', req, 'create', data);
		validateData(col, data);
		await this.checkUnique(col, data, undefined, locale);

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
		data = this.wrapLocalized(col, data, locale);
		const doc = await this.db.create(slug, data);
		await this.snapshotVersion(col, doc);

		for (const hook of col.hooks?.afterChange ?? [])
			await hook({ req, operation: 'create', collection: slug, doc, data });

		return this.afterRead(req, col, doc, opts.depth ?? 1, locale);
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

		// Replacement file: store new, remove old (adopted keys are
		// importer-owned and never auto-deleted).
		if (file) {
			Object.assign(data, await this.storeFile(col, file));
			if (typeof originalDoc.storageKey === 'string' && this.storage && !originalDoc._adopted) {
				await this.storage.delete(originalDoc.storageKey).catch(() => {});
			}
			if (originalDoc._adopted) data._adopted = false; // we own the new bytes
		}

		const locale = this.resolveLocale(opts);

		data = await this.runDataHooks(col, 'beforeValidate', req, 'update', data, originalDoc);
		validateData(
			col,
			this.flattenLocalized(col, { ...stripMeta(originalDoc), ...data } as Doc, locale ?? null),
			{ partial: false }
		);
		await this.checkUnique(col, data, id, locale);

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
			const base = { ...stripMeta(originalDoc), ...(await this.draftBase(col, slug, id)) };
			const draftDoc: Doc = {
				...base,
				...this.wrapLocalized(col, data, locale, base),
				_status: 'draft',
				id,
				createdAt: originalDoc.createdAt,
				updatedAt: now
			};
			await this.snapshotVersion(col, draftDoc);
			for (const hook of col.hooks?.afterChange ?? [])
				await hook({ req, operation: 'update', collection: slug, doc: draftDoc, data, originalDoc });
			return this.afterRead(req, col, draftDoc, opts.depth ?? 1, locale);
		}

		const doc = await this.db.update(slug, id, this.wrapLocalized(col, data, locale, originalDoc));
		await this.snapshotVersion(col, doc);

		for (const hook of col.hooks?.afterChange ?? [])
			await hook({ req, operation: 'update', collection: slug, doc, data, originalDoc });

		return this.afterRead(req, col, doc, opts.depth ?? 1, locale);
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

	/**
	 * Scheduled publishing: promote drafts whose `publishAt` date has passed.
	 * Swept lazily at the top of find() — no background jobs required.
	 */
	private async sweepScheduledPublishes(col: CollectionConfig): Promise<void> {
		const vcfg = this.versionsConfig(col);
		if (!vcfg?.drafts || !vcfg.schedulePublish) return;
		const now = new Date().toISOString();
		const { docs } = await this.db.find(col.slug, {
			where: { _status: { equals: 'draft' }, publishAt: { less_than: now, exists: true } },
			limit: 10
		});
		for (const doc of docs) {
			try {
				await this.publish({ user: null }, col.slug, doc.id, { overrideAccess: true });
			} catch (err) {
				console.error(`[highseam] scheduled publish failed for ${col.slug}/${doc.id}`, err);
			}
		}
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
		// Stored localized values are per-locale objects; validate a flattened view.
		validateData(col, this.flattenLocalized(col, data as Doc, this.resolveLocale({})));
		data = await this.runDataHooks(col, 'beforeChange', req, 'update', data, doc);

		const updated = await this.db.update(slug, id, data);
		await this.snapshotVersion(col, updated);
		for (const hook of col.hooks?.afterChange ?? [])
			await hook({ req, operation: 'update', collection: slug, doc: updated, data, originalDoc: doc });
		return this.afterRead(req, col, updated, opts.depth ?? 1, this.resolveLocale(opts));
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

		// Upload collections: remove the stored file too — unless the object
		// was adopted from an importer-owned key (we didn't create it, we
		// don't destroy it).
		if (
			this.uploadConfig(col) &&
			typeof doc.storageKey === 'string' &&
			this.storage &&
			!doc._adopted
		) {
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

	/**
	 * Mint a short-lived preview token for a document (signed with CMS_SECRET).
	 * The public site verifies it with `verifyPreviewToken` from
	 * 'highseam/preview' and serves draft/unpublished content.
	 */
	async signPreviewToken(collection: string, id: string, ttlSeconds = 600): Promise<string> {
		return signJWT({ sub: id, col: collection, preview: true }, this.secret, ttlSeconds);
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
		excludeId?: string,
		locale?: string | null
	): Promise<void> {
		const uniqueFields = col.fields.filter((f) => f.unique).map((f) => f.name);
		if (col.auth) uniqueFields.push('email');
		for (const name of uniqueFields) {
			const value = data[name];
			if (value === undefined || value === null || value === '') continue;
			const key = this.localizeKey(col, name, locale ?? null);
			const { docs } = await this.db.find(col.slug, {
				where: { [key]: { equals: value } },
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

	private async afterRead(
		req: ReqContext,
		col: CollectionConfig,
		doc: Doc,
		depth: number,
		locale: string | null = null
	): Promise<Doc> {
		let out = this.flattenLocalized(col, this.sanitizeOutput(col, doc), locale ?? this.resolveLocale({}));
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

			const hasMany = Boolean(field.hasMany);
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
