<script lang="ts">
	/**
	 * Hotspot picker: click or drag a point on the image; it becomes the
	 * media doc's focalPoint {v:1, x:0–1, y:0–1}. Below, one live preview per
	 * registered aspect (cms.config → media.aspects) shows how that aspect
	 * will crop around the point — one original, zero variant uploads.
	 *
	 * Submits through a hidden input named `focalPoint` (the field itself
	 * stays admin.hidden — this IS its UI) and dispatches a bubbling input
	 * event so DocForm's dirty-tracking and autosave see the change.
	 */
	import { focalObjectPosition, normalizeFocalPoint, parseRatio, type FocalPoint } from '$lib/core/media';

	let {
		url,
		alt = '',
		value = undefined,
		aspects = []
	}: {
		url: string;
		alt?: string;
		value?: unknown;
		aspects?: { name: string; ratio: string }[];
	} = $props();

	// svelte-ignore state_referenced_locally — seed once from the prop
	let focal = $state<FocalPoint | undefined>(normalizeFocalPoint(value));
	let dragging = $state(false);
	let imgWrap: HTMLDivElement | undefined = $state();
	let hiddenInput: HTMLInputElement | undefined = $state();

	const serialized = $derived(focal ? JSON.stringify(focal) : '');
	const objPos = $derived(focalObjectPosition(focal));

	function setFromEvent(e: PointerEvent) {
		if (!imgWrap) return;
		const rect = imgWrap.getBoundingClientRect();
		const x = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
		const y = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
		focal = { v: 1, x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) };
		// Programmatic value changes don't bubble on their own — tell the form.
		queueMicrotask(() =>
			hiddenInput?.dispatchEvent(new Event('input', { bubbles: true }))
		);
	}

	function onDown(e: PointerEvent) {
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		setFromEvent(e);
	}
	function onMove(e: PointerEvent) {
		if (dragging) setFromEvent(e);
	}
	function onUp() {
		dragging = false;
	}
	function clear() {
		focal = undefined;
		queueMicrotask(() =>
			hiddenInput?.dispatchEvent(new Event('input', { bubbles: true }))
		);
	}

	function aspectPadding(ratio: string): string {
		const r = parseRatio(ratio);
		return r ? `${(r.h / r.w) * 100}%` : '56.25%';
	}
</script>

<div class="space-y-2">
	<input type="hidden" name="focalPoint" value={serialized} bind:this={hiddenInput} />

	<div class="flex items-center justify-between">
		<span class="text-xs font-medium tracking-wide text-(--color-muted) uppercase">
			Focal point
		</span>
		{#if focal}
			<button type="button" onclick={clear} class="text-[11px] text-(--color-muted) hover:text-(--color-danger)">
				Clear ({Math.round(focal.x * 100)}%, {Math.round(focal.y * 100)}%)
			</button>
		{:else}
			<span class="text-[11px] text-(--color-muted)">Click the subject that must survive every crop</span>
		{/if}
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={imgWrap}
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		class="relative max-w-md cursor-crosshair touch-none overflow-hidden rounded-(--radius) border border-(--color-border) select-none"
		data-hs-focal-picker
	>
		<img src={url} {alt} draggable="false" class="block w-full" />
		{#if focal}
			<div
				class="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.6)]"
				style="left: {focal.x * 100}%; top: {focal.y * 100}%;"
			>
				<div class="absolute inset-1 rounded-full bg-(--color-primary)"></div>
			</div>
		{/if}
	</div>

	{#if aspects.length > 0}
		<div class="flex flex-wrap gap-3 pt-1">
			{#each aspects as a (a.name)}
				<figure class="w-36">
					<div class="relative w-full overflow-hidden rounded-(--radius) border border-(--color-border)" style="padding-top: {aspectPadding(a.ratio)};">
						<img
							src={url}
							{alt}
							class="absolute inset-0 h-full w-full object-cover"
							style="object-position: {objPos};"
							draggable="false"
						/>
					</div>
					<figcaption class="mt-1 text-[10px] text-(--color-muted)">{a.name} · {a.ratio}</figcaption>
				</figure>
			{/each}
		</div>
		<p class="text-[11px] text-(--color-muted)">
			Live previews of your registered aspects, steered by the focal point.
		</p>
	{/if}
</div>
