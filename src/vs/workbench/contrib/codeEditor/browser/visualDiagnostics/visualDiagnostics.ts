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

interface DiagnosticInfo {
	mouseViewportX: number;
	mouseViewportY: number;
	mouseDocX: number;
	mouseDocY: number;
	cursorViewportX: number;
	cursorViewportY: number;
	cursorDocX: number;
	cursorDocY: number;
	editorWidth: number;
	editorHeight: number;
}

class ConsolidatedDiagnosticsWidget implements IOverlayWidget {
	private readonly _domNode: HTMLElement;
	private _currentInfo: DiagnosticInfo | null = null;

	constructor(editor: ICodeEditor) {
		this._domNode = document.createElement('div');
		this._domNode.style.position = 'absolute';
		this._domNode.style.pointerEvents = 'none';
		this._domNode.style.zIndex = '1000';
		this._domNode.style.display = 'none';
	}

	getId(): string {
		return 'editor.contrib.visualDiagnostics.consolidated';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getPosition(): IOverlayWidgetPosition | null {
		return null;
	}

	updateInfo(info: DiagnosticInfo): void {
		this._currentInfo = info;
		this._render();
	}

	private _render(): void {
		if (!this._currentInfo) {
			this._domNode.style.display = 'none';
			return;
		}

		const info = this._currentInfo;
		this._domNode.style.display = 'block';
		dom.clearNode(this._domNode);

		// Create single consolidated label container
		const container = document.createElement('div');
		container.style.background = 'rgba(0, 0, 0, 0.85)';
		container.style.color = '#fff';
		container.style.padding = '6px 8px';
		container.style.borderRadius = '4px';
		container.style.fontSize = '11px';
		container.style.fontFamily = 'monospace';
		container.style.lineHeight = '1.4';
		container.style.whiteSpace = 'nowrap';
		container.style.border = '1px solid rgba(255, 255, 255, 0.2)';

		// Add section headers and information
		const addSection = (title: string, items: string[]) => {
			const sectionTitle = document.createElement('div');
			sectionTitle.textContent = title;
			sectionTitle.style.fontWeight = 'bold';
			sectionTitle.style.marginBottom = '2px';
			sectionTitle.style.color = '#88c0d0';
			container.appendChild(sectionTitle);

			items.forEach((item, index) => {
				const itemDiv = document.createElement('div');
				itemDiv.textContent = item;
				itemDiv.style.paddingLeft = '8px';
				if (index < items.length - 1) {
					itemDiv.style.marginBottom = '2px';
				}
				container.appendChild(itemDiv);
			});
		};

		addSection('Document Coordinates', [
			`Mouse: (x: ${info.mouseDocX}, y: ${info.mouseDocY})`,
			`Cursor: (x: ${info.cursorDocX}, y: ${info.cursorDocY})`
		]);

		const spacer1 = document.createElement('div');
		spacer1.style.height = '6px';
		container.appendChild(spacer1);

		addSection('Viewport Coordinates', [
			`Mouse: (x: ${info.mouseViewportX}, y: ${info.mouseViewportY})`,
			`Cursor: (x: ${info.cursorViewportX}, y: ${info.cursorViewportY})`
		]);

		const spacer2 = document.createElement('div');
		spacer2.style.height = '6px';
		container.appendChild(spacer2);

		addSection('Editor Size', [
			`(w: ${info.editorWidth}, h: ${info.editorHeight})`
		]);

		this._domNode.appendChild(container);

		// Position at bottom-right corner
		// Measure the actual width of the container after it's been populated
		const containerWidth = container.offsetWidth;
		const containerHeight = container.offsetHeight;
		const left = info.editorWidth - containerWidth;
		const top = info.editorHeight - containerHeight;

		this._domNode.style.left = `${left}px`;
		this._domNode.style.top = `${top}px`;
	}

	hide(): void {
		this._domNode.style.display = 'none';
		this._currentInfo = null;
	}
}

class VisualDiagnosticsOverlay extends Disposable {
	private readonly _editor: ICodeEditor;
	private readonly _widget: ConsolidatedDiagnosticsWidget;
	private readonly _disposables = new DisposableStore();
	private _lastMouseClientX: number = 0;
	private _lastMouseClientY: number = 0;

	constructor(editor: ICodeEditor) {
		super();
		this._editor = editor;

		this._widget = new ConsolidatedDiagnosticsWidget(editor);
		this._editor.addOverlayWidget(this._widget);

		// Set cursor to solid (no blink)
		this._editor.updateOptions({
			cursorBlinking: 'solid'
		});

		// Track mouse movement
		this._disposables.add(this._editor.onMouseMove((e: IEditorMouseEvent) => {
			if (e.event.browserEvent.type === 'mousemove') {
				this._lastMouseClientX = e.event.browserEvent.clientX;
				this._lastMouseClientY = e.event.browserEvent.clientY;
				this._updateWidget();
			}
		}));

		this._disposables.add(this._editor.onMouseLeave(() => {
			// Don't hide the widget anymore, just keep showing last position
		}));

		// Track cursor position changes
		this._disposables.add(this._editor.onDidChangeCursorPosition(() => {
			this._updateWidget();
		}));

		// Track layout changes
		this._disposables.add(this._editor.onDidLayoutChange(() => {
			this._updateWidget();
		}));

		// Track scroll changes
		this._disposables.add(this._editor.onDidScrollChange(() => {
			this._updateWidget();
		}));

		// Initial render
		this._updateWidget();
	}

	private _updateWidget(): void {
		const editorRect = this._editor.getDomNode()?.getBoundingClientRect();
		if (!editorRect) {
			return;
		}

		const layoutInfo = this._editor.getLayoutInfo();
		const scrollTop = this._editor.getScrollTop();
		const scrollLeft = this._editor.getScrollLeft();

		// Mouse coordinates
		const mouseViewportX = Math.round(this._lastMouseClientX - editorRect.left);
		const mouseViewportY = Math.round(this._lastMouseClientY - editorRect.top);
		const mouseDocX = Math.round(mouseViewportX - layoutInfo.contentLeft + scrollLeft);
		const mouseDocY = Math.round(mouseViewportY + scrollTop);

		// Cursor coordinates
		const position = this._editor.getPosition();
		let cursorViewportX = 0;
		let cursorViewportY = 0;
		let cursorDocX = 0;
		let cursorDocY = 0;

		if (position) {
			const coords = this._editor.getScrolledVisiblePosition(position);
			if (coords) {
				cursorViewportX = Math.round(coords.left);
				cursorViewportY = Math.round(coords.top);
			} else {
				const lineTop = this._editor.getTopForLineNumber(position.lineNumber);
				cursorViewportX = 0;
				cursorViewportY = Math.round(lineTop - scrollTop);
			}
			cursorDocX = Math.round(cursorViewportX - layoutInfo.contentLeft + scrollLeft);
			cursorDocY = Math.round(cursorViewportY + scrollTop);
		}

		this._widget.updateInfo({
			mouseViewportX,
			mouseViewportY,
			mouseDocX,
			mouseDocY,
			cursorViewportX,
			cursorViewportY,
			cursorDocX,
			cursorDocY,
			editorWidth: Math.round(editorRect.width),
			editorHeight: Math.round(editorRect.height)
		});
	}

	override dispose(): void {
		// Restore default cursor blinking
		this._editor.updateOptions({
			cursorBlinking: 'blink'
		});

		this._editor.removeOverlayWidget(this._widget);
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
