<script lang="ts">
	/**
	 * Drop into your public site's layout while in preview mode. Shows a
	 * banner and an exit link. Pairs with verifyPreviewToken / onPreviewData
	 * from 'highseam/preview'.
	 */
	let {
		exitHref = '?',
		label = 'Preview mode — showing unpublished content'
	}: { exitHref?: string; label?: string } = $props();

	// 1.7.4: the admin reloads this frame after every save and draft autosave;
	// keep the reader's place instead of jumping back to the top. Per path, per
	// tab (sessionStorage). The key matches sites that do this themselves.
	$effect(() => {
		const key = `highseam:preview-scroll:${location.pathname}`;
		try {
			const y = Number(sessionStorage.getItem(key));
			if (y > 0) requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' }));
		} catch {
			/* storage blocked: start at the top */
		}
		const save = () => {
			try {
				sessionStorage.setItem(key, String(Math.round(window.scrollY)));
			} catch {
				/* storage blocked */
			}
		};
		window.addEventListener('pagehide', save);
		return () => window.removeEventListener('pagehide', save);
	});
</script>

<div
	style="position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:center;gap:1rem;background:#c5f74f;color:#101203;font:600 13px/1 system-ui,sans-serif;padding:8px 16px;"
>
	<span>{label}</span>
	<a href={exitHref} style="color:#101203;text-decoration:underline;">Exit preview</a>
</div>
