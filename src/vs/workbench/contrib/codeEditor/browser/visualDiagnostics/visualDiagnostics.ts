/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../../platform/action/common/actionCommonCategories.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition, IEditorMouseEvent } from '../../../../../editor/browser/editorBrowser.js';
import * as dom from '../../../../../base/browser/dom.js';

let globalVisualDiagnosticsEnabled = false;
const activeEditorDiagnostics = new Map<ICodeEditor, VisualDiagnosticsOverlay>();

class MouseCoordinateWidget implements IOverlayWidget {
	private readonly _domNode: HTMLElement;

	constructor(editor: ICodeEditor) {
		this._domNode = document.createElement('div');
		this._domNode.style.position = 'absolute';
		this._domNode.style.pointerEvents = 'none';
		this._domNode.style.zIndex = '1000';
		this._domNode.style.display = 'none';
	}

	getId(): string {
		return 'editor.contrib.visualDiagnostics.mouseCoordinate';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		return null;
	}

	updatePosition(x: number, y: number, rawX: number, rawY: number, docX: number, docY: number, editorWidth: number, editorHeight: number): void {
		this._domNode.style.display = 'block';

		// Create container for both labels
		dom.clearNode(this._domNode);

		// Approximate label dimensions (be generous to avoid clipping)
		const labelHeight = 20;
		const labelWidth = 350; // Approximate width for longer labels
		const offset = 10;
		const spacing = 5; // Space between labels

		// Calculate positions for viewport label (try above first)
		let viewportTop = y - labelHeight - offset;
		let viewportLeft = x + offset;

		// If too close to top, position below instead
		if (viewportTop < 0) {
			viewportTop = y + offset;
		}

		// If too close to right edge, clamp to stay within bounds
		if (viewportLeft + labelWidth > editorWidth) {
			viewportLeft = editorWidth - labelWidth - offset;
		}

		// If too close to left edge, clamp
		if (viewportLeft < 0) {
			viewportLeft = offset;
		}

		// Calculate positions for document label
		let docTop = y + offset;
		let docLeft = x + offset;

		// If viewport label is below cursor, document label needs to go further below
		if (viewportTop >= y) {
			docTop = viewportTop + labelHeight + spacing;
		}

		// If too close to bottom, position above the mouse
		if (docTop + labelHeight > editorHeight) {
			docTop = y - labelHeight - offset;
			// If viewport label is also above, stack them
			if (viewportTop < y) {
				docTop = viewportTop - labelHeight - spacing;
			}
		}

		// If too close to right edge, clamp to stay within bounds
		if (docLeft + labelWidth > editorWidth) {
			docLeft = editorWidth - labelWidth - offset;
		}

		// If too close to left edge, clamp
		if (docLeft < 0) {
			docLeft = offset;
		}

		// Raw coordinates (viewport label)
		const rawLabel = document.createElement('div');
		rawLabel.textContent = `Mouse Coordinates (Viewport): (x: ${rawX}, y: ${rawY})`;
		rawLabel.style.position = 'absolute';
		rawLabel.style.left = `${viewportLeft}px`;
		rawLabel.style.top = `${viewportTop}px`;
		rawLabel.style.background = 'rgba(0, 0, 0, 0.8)';
		rawLabel.style.color = '#fff';
		rawLabel.style.padding = '2px 6px';
		rawLabel.style.borderRadius = '3px';
		rawLabel.style.fontSize = '11px';
		rawLabel.style.fontFamily = 'monospace';
		rawLabel.style.whiteSpace = 'nowrap';

		// Document-relative coordinates (document label)
		const docLabel = document.createElement('div');
		docLabel.textContent = `Mouse Coordinates (Document): (x: ${docX}, y: ${docY})`;
		docLabel.style.position = 'absolute';
		docLabel.style.left = `${docLeft}px`;
		docLabel.style.top = `${docTop}px`;
		docLabel.style.background = 'rgba(0, 120, 212, 0.8)';
		docLabel.style.color = '#fff';
		docLabel.style.padding = '2px 6px';
		docLabel.style.borderRadius = '3px';
		docLabel.style.fontSize = '11px';
		docLabel.style.fontFamily = 'monospace';
		docLabel.style.whiteSpace = 'nowrap';

		this._domNode.appendChild(rawLabel);
		this._domNode.appendChild(docLabel);
	}

	hide(): void {
		this._domNode.style.display = 'none';
	}
}

class CornerCoordinatesWidget implements IOverlayWidget {
	private readonly _domNode: HTMLElement;
	private readonly _editor: ICodeEditor;

	constructor(editor: ICodeEditor) {
		this._editor = editor;
		this._domNode = document.createElement('div');
		this._domNode.style.position = 'absolute';
		this._domNode.style.pointerEvents = 'none';
		this._domNode.style.zIndex = '999';
		this._domNode.style.width = '100%';
		this._domNode.style.height = '100%';
		this._domNode.style.top = '0';
		this._domNode.style.left = '0';
		this._updateCorners();
	}

	getId(): string {
		return 'editor.contrib.visualDiagnostics.cornerCoordinates';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		return null;
	}

	private _updateCorners(): void {
		const layoutInfo = this._editor.getLayoutInfo();
		const contentWidth = layoutInfo.contentWidth;
		const contentHeight = layoutInfo.height;

		dom.clearNode(this._domNode);

		// Bottom-right (width, height)
		const bottomRight = this._createCornerLabel(`(${contentWidth}, ${contentHeight})`);
		bottomRight.style.bottom = '2px';
		bottomRight.style.right = '2px';
		this._domNode.appendChild(bottomRight);
	}

	private _createCornerLabel(text: string): HTMLElement {
		const label = document.createElement('div');
		label.textContent = text;
		label.style.position = 'absolute';
		label.style.background = 'rgba(255, 165, 0, 0.8)';
		label.style.color = '#fff';
		label.style.padding = '2px 6px';
		label.style.borderRadius = '3px';
		label.style.fontSize = '11px';
		label.style.fontFamily = 'monospace';
		label.style.whiteSpace = 'nowrap';
		return label;
	}

	updateLayout(): void {
		this._updateCorners();
	}
}

class CursorCoordinateWidget implements IOverlayWidget {
	private readonly _domNode: HTMLElement;
	private readonly _editor: ICodeEditor;

	constructor(editor: ICodeEditor) {
		this._editor = editor;
		this._domNode = document.createElement('div');
		this._domNode.style.position = 'absolute';
		this._domNode.style.pointerEvents = 'none';
		this._domNode.style.zIndex = '998';
		this._domNode.style.display = 'none';
	}

	getId(): string {
		return 'editor.contrib.visualDiagnostics.cursorCoordinate';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		return null;
	}

	updatePosition(): void {
		const position = this._editor.getPosition();
		if (!position) {
			this._domNode.style.display = 'none';
			return;
		}

		const layoutInfo = this._editor.getLayoutInfo();

		const coords = this._editor.getScrolledVisiblePosition(position);

		// Calculate viewport coordinates (relative to visible editor content area, not including gutter)
		const scrollTop = this._editor.getScrollTop();
		const scrollLeft = this._editor.getScrollLeft();

		let viewportX: number;
		let viewportY: number;

		if (coords) {
			// Cursor is visible on screen - use its exact viewport position
			viewportX = Math.round(coords.left);
			viewportY = Math.round(coords.top);
		} else {
			// Cursor is off-screen, calculate where it would be
			const lineTop = this._editor.getTopForLineNumber(position.lineNumber);
			viewportX = 0; // Approximate, we don't have exact column position
			viewportY = Math.round(lineTop - scrollTop);
		}

		// Calculate document coordinates (accounting for scroll, and excluding gutter)
		const docX = Math.round(viewportX - layoutInfo.contentLeft + scrollLeft);
		const docY = Math.round(viewportY + scrollTop);

		dom.clearNode(this._domNode);
		this._domNode.style.display = 'block';

		// Viewport coordinates label
		const viewportLabel = document.createElement('div');
		viewportLabel.textContent = `Cursor Coordinates (Viewport): (x: ${viewportX}, y: ${viewportY})`;
		viewportLabel.style.background = 'rgba(0, 180, 0, 0.8)';
		viewportLabel.style.color = '#fff';
		viewportLabel.style.padding = '2px 6px';
		viewportLabel.style.borderRadius = '3px';
		viewportLabel.style.fontSize = '11px';
		viewportLabel.style.fontFamily = 'monospace';
		viewportLabel.style.whiteSpace = 'nowrap';
		viewportLabel.style.marginBottom = '2px';

		// Document coordinates label
		const docLabel = document.createElement('div');
		docLabel.textContent = `Cursor Coordinates (Document): (x: ${docX}, y: ${docY})`;
		docLabel.style.background = 'rgba(0, 140, 0, 0.8)';
		docLabel.style.color = '#fff';
		docLabel.style.padding = '2px 6px';
		docLabel.style.borderRadius = '3px';
		docLabel.style.fontSize = '11px';
		docLabel.style.fontFamily = 'monospace';
		docLabel.style.whiteSpace = 'nowrap';

		this._domNode.appendChild(viewportLabel);
		this._domNode.appendChild(docLabel);

		// Position labels based on viewport coordinates, clamped to viewport bounds
		const labelWidth = 350;
		const labelHeight = 50; // Two labels stacked
		const offset = 5;

		// Calculate display position from viewport coordinates
		const displayX = layoutInfo.contentLeft + viewportX;
		const displayY = viewportY;

		// Start with preferred position (right and above cursor)
		let left = displayX + offset;
		let top = displayY - labelHeight - offset;

		// Clamp horizontally within viewport bounds
		const minX = layoutInfo.contentLeft;
		const maxX = layoutInfo.width;

		if (left + labelWidth > maxX) {
			// Would go off right edge, clamp to right edge
			left = maxX - labelWidth - offset;
		}
		if (left < minX) {
			// Would go off left edge, clamp to left edge
			left = minX + offset;
		}

		// Clamp vertically within viewport bounds
		const minY = 0;
		const maxY = layoutInfo.height;

		if (top < minY) {
			// Would go off top edge, position below cursor instead
			top = displayY + offset;
		}
		if (top + labelHeight > maxY) {
			// Would go off bottom edge, clamp to bottom edge
			top = maxY - labelHeight - offset;
		}

		this._domNode.style.left = `${left}px`;
		this._domNode.style.top = `${top}px`;
	}
}

class VisualDiagnosticsOverlay extends Disposable {
	private readonly _editor: ICodeEditor;
	private readonly _mouseWidget: MouseCoordinateWidget;
	private readonly _cornerWidget: CornerCoordinatesWidget;
	private readonly _cursorWidget: CursorCoordinateWidget;
	private readonly _disposables = new DisposableStore();

	constructor(editor: ICodeEditor) {
		super();
		this._editor = editor;

		this._mouseWidget = new MouseCoordinateWidget(editor);
		this._cornerWidget = new CornerCoordinatesWidget(editor);
		this._cursorWidget = new CursorCoordinateWidget(editor);

		this._editor.addOverlayWidget(this._mouseWidget);
		this._editor.addOverlayWidget(this._cornerWidget);
		this._editor.addOverlayWidget(this._cursorWidget);

		// Set cursor to solid (no blink) - we don't store original as it's a complex enum
		this._editor.updateOptions({
			cursorBlinking: 'solid'
		});

		// Track mouse movement
		this._disposables.add(this._editor.onMouseMove((e: IEditorMouseEvent) => {
			if (e.event.browserEvent.type === 'mousemove') {
				const editorRect = this._editor.getDomNode()?.getBoundingClientRect();
				if (!editorRect) {
					return;
				}

				const layoutInfo = this._editor.getLayoutInfo();
				const scrollTop = this._editor.getScrollTop();
				const scrollLeft = this._editor.getScrollLeft();

				// Raw X and Y relative to editor viewport
				const rawX = e.event.browserEvent.clientX - editorRect.left;
				const rawY = e.event.browserEvent.clientY - editorRect.top;

				// Document-relative coordinates (accounting for scroll)
				const docX = rawX - layoutInfo.contentLeft + scrollLeft;
				const docY = rawY + scrollTop;

				this._mouseWidget.updatePosition(
					rawX,
					rawY,
					Math.round(rawX),
					Math.round(rawY),
					Math.round(docX),
					Math.round(docY),
					layoutInfo.width,
					layoutInfo.height
				);
			}
		}));

		this._disposables.add(this._editor.onMouseLeave(() => {
			this._mouseWidget.hide();
		}));

		// Track cursor position changes
		this._disposables.add(this._editor.onDidChangeCursorPosition(() => {
			this._cursorWidget.updatePosition();
		}));

		// Track layout changes
		this._disposables.add(this._editor.onDidLayoutChange(() => {
			this._cornerWidget.updateLayout();
			this._cursorWidget.updatePosition();
		}));

		// Track scroll changes
		this._disposables.add(this._editor.onDidScrollChange(() => {
			this._cursorWidget.updatePosition();
		}));

		// Initial cursor update
		this._cursorWidget.updatePosition();
	}

	override dispose(): void {
		// Restore default cursor blinking
		this._editor.updateOptions({
			cursorBlinking: 'blink'
		});

		this._editor.removeOverlayWidget(this._mouseWidget);
		this._editor.removeOverlayWidget(this._cornerWidget);
		this._editor.removeOverlayWidget(this._cursorWidget);
		this._disposables.dispose();
		super.dispose();
	}
}

class ToggleVisualDiagnosticsAction extends Action2 {
	static readonly ID = 'editor.action.toggleVisualDiagnostics';

	constructor() {
		super({
			id: ToggleVisualDiagnosticsAction.ID,
			title: localize2('toggleVisualDiagnostics', "Toggle Visual Diagnostics"),
			category: Categories.View,
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);

		globalVisualDiagnosticsEnabled = !globalVisualDiagnosticsEnabled;

		if (globalVisualDiagnosticsEnabled) {
			// Enable on all active editors
			for (const editor of codeEditorService.listCodeEditors()) {
				if (!activeEditorDiagnostics.has(editor)) {
					const overlay = new VisualDiagnosticsOverlay(editor);
					activeEditorDiagnostics.set(editor, overlay);
				}
			}
		} else {
			// Disable on all editors
			for (const overlay of activeEditorDiagnostics.values()) {
				overlay.dispose();
			}
			activeEditorDiagnostics.clear();
		}
	}
}

registerAction2(ToggleVisualDiagnosticsAction);

// Listen for new editors being created
export function registerVisualDiagnosticsListeners(codeEditorService: ICodeEditorService): IDisposable {
	const disposables = new DisposableStore();

	disposables.add(codeEditorService.onCodeEditorAdd((editor) => {
		if (globalVisualDiagnosticsEnabled && !activeEditorDiagnostics.has(editor)) {
			const overlay = new VisualDiagnosticsOverlay(editor);
			activeEditorDiagnostics.set(editor, overlay);
		}
	}));

	disposables.add(codeEditorService.onCodeEditorRemove((editor) => {
		const overlay = activeEditorDiagnostics.get(editor);
		if (overlay) {
			overlay.dispose();
			activeEditorDiagnostics.delete(editor);
		}
	}));

	return disposables;
}
