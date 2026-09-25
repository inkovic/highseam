/**
 * Admin UI state shared by the document page and its editors (1.7.4).
 *
 * The doc page route (a consumer-owned template) owns the live preview; the
 * rich-text and HTML editors (package components, deep inside DocForm) own
 * full-screen editing. They meet here so a full-screen editor can sit beside
 * the preview and open or close it, without prop-drilling through DocForm.
 * Mutate the fields; never reassign the object.
 */
export const editorUi = $state({
	/** Name of the field being edited full screen, or null. */
	fullscreen: null as string | null,
	/** The doc page has a preview URL for this document. */
	previewAvailable: false,
	/** The live preview pane is open. */
	previewOpen: false,
	/** Preview pane width, % of the row (and of the window in full screen). */
	previewPct: 45
});
