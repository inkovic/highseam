/**
 * Auto-generated GraphQL API — the equivalent of Payload's GraphQL layer.
 * Builds a schema from the CMS config: per-collection queries and mutations,
 * globals, and auth. Relationship fields resolve lazily, so query depth is
 * driven by the GraphQL selection set instead of a `depth` param.
 *
 * Pragmatic scope: mutation `data` arguments are JSON (no per-collection
 * input types), and select fields are Strings rather than enums.
 */
import {
	GraphQLBoolean,
	GraphQLFloat,
	GraphQLID,
	GraphQLInt,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType,
	GraphQLScalarType,
	GraphQLSchema,
	GraphQLString,
	Kind,
	type GraphQLFieldConfigMap,
	type GraphQLOutputType,
	type ValueNode
} from 'graphql';
import type { CMS } from './cms';
import type { CollectionConfig, Doc, Field, ReqContext } from './types';

export interface GQLContext {
	req: ReqContext;
	cms: CMS;
}

function astToValue(ast: ValueNode): unknown {
	switch (ast.kind) {
		case Kind.STRING:
		case Kind.BOOLEAN:
			return ast.value;
		case Kind.INT:
			return parseInt(ast.value, 10);
		case Kind.FLOAT:
			return parseFloat(ast.value);
		case Kind.NULL:
			return null;
		case Kind.LIST:
			return ast.values.map(astToValue);
		case Kind.OBJECT: {
			const out: Record<string, unknown> = {};
			for (const f of ast.fields) out[f.name.value] = astToValue(f.value);
			return out;
		}
		default:
			return null;
	}
}

const JSONScalar = new GraphQLScalarType({
	name: 'JSON',
	description: 'Arbitrary JSON value',
	serialize: (v) => v,
	parseValue: (v) => v,
	parseLiteral: astToValue
});

function pascal(slug: string): string {
	return slug
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase())
		.replace(/ /g, '');
}

function singularName(slug: string): string {
	const p = pascal(slug);
	if (/ies$/i.test(p)) return p.replace(/ies$/i, 'y');
	if (/Media$/i.test(p)) return p;
	return p.replace(/s$/i, '');
}

const schemaCache = new WeakMap<object, GraphQLSchema>();

export function getSchema(cms: CMS): GraphQLSchema {
	const cached = schemaCache.get(cms.config);
	if (cached) return cached;
	const schema = buildSchema(cms);
	schemaCache.set(cms.config, schema);
	return schema;
}

function buildSchema(cms: CMS): GraphQLSchema {
	const docTypes = new Map<string, GraphQLObjectType>();

	// Pass 1: create object types (fields thunked so relationships can refer
	// to each other circularly).
	for (const col of cms.collections) {
		const typeName = singularName(col.slug);
		docTypes.set(
			col.slug,
			new GraphQLObjectType({
				name: typeName,
				fields: () => docFields(cms, col, docTypes)
			})
		);
	}

	const query: GraphQLFieldConfigMap<unknown, GQLContext> = {};
	const mutation: GraphQLFieldConfigMap<unknown, GQLContext> = {};

	for (const col of cms.collections) {
		const slug = col.slug;
		const type = docTypes.get(slug)!;
		const listName = pascal(slug);
		const singleName = singularName(slug) === listName ? `${listName}ByID` : singularName(slug);

		const pageType = new GraphQLObjectType({
			name: `${listName}Page`,
			fields: {
				docs: { type: new GraphQLList(type) },
				totalDocs: { type: GraphQLInt },
				limit: { type: GraphQLInt },
				page: { type: GraphQLInt },
				totalPages: { type: GraphQLInt },
				hasNextPage: { type: GraphQLBoolean },
				hasPrevPage: { type: GraphQLBoolean }
			}
		});

		query[listName] = {
			type: pageType,
			args: {
				where: { type: JSONScalar },
				limit: { type: GraphQLInt },
				page: { type: GraphQLInt },
				sort: { type: GraphQLString },
				locale: { type: GraphQLString }
			},
			resolve: (_s, args, ctx) =>
				ctx.cms.find(
					ctx.req,
					slug,
					{
						where: (args.where as never) ?? undefined,
						limit: args.limit as number | undefined,
						page: args.page as number | undefined,
						sort: args.sort as string | undefined
					},
					{ depth: 0, locale: args.locale as string | undefined }
				)
		};

		query[singleName] = {
			type,
			args: {
				id: { type: new GraphQLNonNull(GraphQLID) },
				draft: { type: GraphQLBoolean },
				locale: { type: GraphQLString }
			},
			resolve: (_s, args, ctx) =>
				ctx.cms.findByID(ctx.req, slug, args.id as string, {
					depth: 0,
					draft: Boolean(args.draft),
					locale: args.locale as string | undefined
				})
		};

		mutation[`create${singleName}`] = {
			type,
			args: {
				data: { type: new GraphQLNonNull(JSONScalar) },
				draft: { type: GraphQLBoolean },
				locale: { type: GraphQLString }
			},
			resolve: (_s, args, ctx) =>
				ctx.cms.create(ctx.req, slug, args.data as Record<string, unknown>, {
					depth: 0,
					draft: Boolean(args.draft),
					locale: args.locale as string | undefined
				})
		};
		mutation[`update${singleName}`] = {
			type,
			args: {
				id: { type: new GraphQLNonNull(GraphQLID) },
				data: { type: new GraphQLNonNull(JSONScalar) },
				draft: { type: GraphQLBoolean },
				locale: { type: GraphQLString }
			},
			resolve: (_s, args, ctx) =>
				ctx.cms.update(ctx.req, slug, args.id as string, args.data as Record<string, unknown>, {
					depth: 0,
					draft: Boolean(args.draft),
					locale: args.locale as string | undefined
				})
		};
		mutation[`delete${singleName}`] = {
			type: GraphQLBoolean,
			args: { id: { type: new GraphQLNonNull(GraphQLID) } },
			resolve: async (_s, args, ctx) => {
				await ctx.cms.delete(ctx.req, slug, args.id as string);
				return true;
			}
		};
		if (cms.versionsConfig(col)) {
			mutation[`publish${singleName}`] = {
				type,
				args: { id: { type: new GraphQLNonNull(GraphQLID) } },
				resolve: (_s, args, ctx) => ctx.cms.publish(ctx.req, slug, args.id as string, { depth: 0 })
			};
			mutation[`unpublish${singleName}`] = {
				type,
				args: { id: { type: new GraphQLNonNull(GraphQLID) } },
				resolve: (_s, args, ctx) => ctx.cms.unpublish(ctx.req, slug, args.id as string, { depth: 0 })
			};
		}
	}

	// Globals
	for (const g of cms.globals) {
		const name = `${pascal(g.slug)}Global`;
		const gType = new GraphQLObjectType({
			name,
			fields: () =>
				docFields(cms, { slug: g.slug, fields: g.fields }, docTypes)
		});
		query[name] = {
			type: gType,
			args: { locale: { type: GraphQLString } },
			resolve: (_s, args, ctx) =>
				ctx.cms.findGlobal(ctx.req, g.slug, { depth: 0, locale: args.locale as string | undefined })
		};
		mutation[`update${name}`] = {
			type: gType,
			args: {
				data: { type: new GraphQLNonNull(JSONScalar) },
				locale: { type: GraphQLString }
			},
			resolve: (_s, args, ctx) =>
				ctx.cms.updateGlobal(ctx.req, g.slug, args.data as Record<string, unknown>, {
					depth: 0,
					locale: args.locale as string | undefined
				})
		};
	}

	// Auth
	mutation.login = {
		type: JSONScalar,
		args: {
			collection: { type: new GraphQLNonNull(GraphQLString) },
			email: { type: new GraphQLNonNull(GraphQLString) },
			password: { type: new GraphQLNonNull(GraphQLString) }
		},
		resolve: (_s, args, ctx) =>
			ctx.cms.login(args.collection as string, args.email as string, args.password as string)
	};
	query.me = {
		type: JSONScalar,
		resolve: (_s, _a, ctx) => ctx.req.user
	};

	return new GraphQLSchema({
		query: new GraphQLObjectType({ name: 'Query', fields: query }),
		mutation: new GraphQLObjectType({ name: 'Mutation', fields: mutation })
	});
}

function docFields(
	cms: CMS,
	col: Pick<CollectionConfig, 'slug' | 'fields'> & Partial<CollectionConfig>,
	docTypes: Map<string, GraphQLObjectType>
): GraphQLFieldConfigMap<Doc, GQLContext> {
	const out: GraphQLFieldConfigMap<Doc, GQLContext> = {
		id: { type: GraphQLID },
		createdAt: { type: GraphQLString },
		updatedAt: { type: GraphQLString }
	};
	if (col.auth) out.email = { type: GraphQLString };
	if (col.versions) out._status = { type: GraphQLString };
	if (col.upload) {
		out.filename = { type: GraphQLString };
		out.mimeType = { type: GraphQLString };
		out.filesize = { type: GraphQLFloat };
		out.url = { type: GraphQLString };
	}

	for (const f of col.fields) {
		out[f.name] = fieldConfig(cms, f, docTypes);
	}
	return out;
}

function fieldConfig(
	cms: CMS,
	f: Field,
	docTypes: Map<string, GraphQLObjectType>
): { type: GraphQLOutputType; resolve?: (src: Doc, args: unknown, ctx: GQLContext) => unknown } {
	switch (f.type) {
		case 'text':
		case 'textarea':
		case 'email':
		case 'date':
		case 'select':
			return f.type === 'select' && f.hasMany
				? { type: new GraphQLList(GraphQLString) }
				: { type: GraphQLString };
		case 'number':
			return { type: GraphQLFloat };
		case 'checkbox':
			return { type: GraphQLBoolean };
		case 'richText': // structured node array (or legacy markdown string)
		case 'array':
		case 'blocks':
		case 'json':
			return { type: JSONScalar };
		case 'relationship':
		case 'upload': {
			const related = docTypes.get(f.relationTo);
			if (!related) return { type: JSONScalar };

			const resolveOne = async (v: unknown, ctx: GQLContext): Promise<Doc | null> => {
				if (v == null) return null;
				if (typeof v === 'object') return v as Doc; // already populated
				try {
					return await ctx.cms.findByID(ctx.req, f.relationTo, String(v), { depth: 0 });
				} catch {
					return null;
				}
			};

			if (f.type === 'relationship' && f.hasMany) {
				return {
					type: new GraphQLList(related),
					resolve: (src, _a, ctx) => {
						const v = src[f.name];
						const arr = Array.isArray(v) ? v : v == null ? [] : [v];
						return Promise.all(arr.map((x) => resolveOne(x, ctx)));
					}
				};
			}
			return {
				type: related,
				resolve: (src, _a, ctx) => resolveOne(src[f.name], ctx)
			};
		}
	}
}
