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
</script>

<div
	style="position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:center;gap:1rem;background:#c5f74f;color:#101203;font:600 13px/1 system-ui,sans-serif;padding:8px 16px;"
>
	<span>{label}</span>
	<a href={exitHref} style="color:#101203;text-decoration:underline;">Exit preview</a>
</div>
