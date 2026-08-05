/**
 * highseam — a config-driven CMS for SvelteKit that runs at the edge, on the
 * database you already have.
 * Root export = the framework-agnostic core (config helpers, types, CMS).
 * Subpath exports: ./server, ./admin/*, ./core/*, ./RichTextRenderer.svelte
 */
export * from './core/index.js';
