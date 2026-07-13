/** Tiny toast store (Svelte 5 runes). Shared across the admin. */
export interface Toast {
	id: number;
	message: string;
	kind: 'success' | 'error' | 'info';
}

let nextId = 1;
const state = $state<{ items: Toast[] }>({ items: [] });

export function toasts(): Toast[] {
	return state.items;
}

export function pushToast(message: string, kind: Toast['kind'] = 'info', ttl = 4000): number {
	const id = nextId++;
	state.items = [...state.items, { id, message, kind }];
	if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
	return id;
}

export function dismissToast(id: number): void {
	state.items = state.items.filter((t) => t.id !== id);
}
