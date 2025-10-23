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

	updatePosition(x: number, y: number, rawX: number, rawY: number, docX: number, docY: number): void {
		this._domNode.style.display = 'block';

		// Create container for both labels
		dom.clearNode(this._domNode);

		// Raw coordinates (above mouse)
		const rawLabel = document.createElement('div');
		rawLabel.textContent = `(${rawX}, ${rawY})`;
		rawLabel.style.position = 'absolute';
		rawLabel.style.left = `${x + 10}px`;
		rawLabel.style.top = `${y - 25}px`;
		rawLabel.style.background = 'rgba(0, 0, 0, 0.8)';
		rawLabel.style.color = '#fff';
		rawLabel.style.padding = '2px 6px';
		rawLabel.style.borderRadius = '3px';
		rawLabel.style.fontSize = '11px';
		rawLabel.style.fontFamily = 'monospace';
		rawLabel.style.whiteSpace = 'nowrap';

		// Document-relative coordinates (below mouse)
		const docLabel = document.createElement('div');
		docLabel.textContent = `Doc: (${docX}, ${docY})`;
		docLabel.style.position = 'absolute';
		docLabel.style.left = `${x + 10}px`;
		docLabel.style.top = `${y + 10}px`;
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
		const contentLeft = layoutInfo.contentLeft;
		const contentWidth = layoutInfo.contentWidth;
		const contentHeight = layoutInfo.height;

		dom.clearNode(this._domNode);

		// Top-left (0, 0)
		const topLeft = this._createCornerLabel('(0, 0)');
		topLeft.style.top = '2px';
		topLeft.style.left = `${contentLeft + 2}px`;
		this._domNode.appendChild(topLeft);

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
		const visibleRanges = this._editor.getVisibleRanges();

		// Check if cursor is in a visible range
		if (visibleRanges.length === 0) {
			this._domNode.style.display = 'none';
			return;
		}

		const coords = this._editor.getScrolledVisiblePosition(position);
		if (!coords) {
			this._domNode.style.display = 'none';
			return;
		}

		this._domNode.style.display = 'block';
		this._domNode.textContent = `(${position.column}, ${position.lineNumber})`;
		this._domNode.style.left = `${layoutInfo.contentLeft + coords.left + 5}px`;
		this._domNode.style.top = `${coords.top - 20}px`;
		this._domNode.style.background = 'rgba(0, 180, 0, 0.8)';
		this._domNode.style.color = '#fff';
		this._domNode.style.padding = '2px 6px';
		this._domNode.style.borderRadius = '3px';
		this._domNode.style.fontSize = '11px';
		this._domNode.style.fontFamily = 'monospace';
		this._domNode.style.whiteSpace = 'nowrap';
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
					Math.round(docY)
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

		// Replace line numbers with Y coordinates
		this._replaceLineNumbersWithYCoordinates();
	}

	private _replaceLineNumbersWithYCoordinates(): void {
		// Set custom line number renderer
		this._editor.updateOptions({
			lineNumbers: (lineNumber: number): string => {
				const topPosition = this._editor.getTopForLineNumber(lineNumber);
				const yCoordinate = Math.round(topPosition);
				return String(yCoordinate);
			}
		});
	}

	private _restoreLineNumbers(): void {
		// Restore original line numbers
		this._editor.updateOptions({
			lineNumbers: 'on'
		});
	}

	override dispose(): void {
		this._restoreLineNumbers();
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
