/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/game.css';
import '../../../../workbench/contrib/chat/browser/widget/media/chatPet.css';
import * as DOM from '../../../../base/browser/dom.js';
import { asCSSUrl } from '../../../../base/browser/cssValue.js';
import { GlobalPointerMoveMonitor } from '../../../../base/browser/globalPointerMoveMonitor.js';
import { StandardMouseEvent } from '../../../../base/browser/mouseEvent.js';
import { toAction } from '../../../../base/common/actions.js';
import { status } from '../../../../base/browser/ui/aria/aria.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { LayoutPriority, Orientation, SplitView } from '../../../../base/browser/ui/splitview/splitview.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Event } from '../../../../base/common/event.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { FileAccess } from '../../../../base/common/network.js';
import { Disposable, DisposableMap, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { autorun, observableValue } from '../../../../base/common/observable.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { basename, isEqual } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { defaultButtonStyles, defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { ChatPermissionLevel } from '../../../../workbench/contrib/chat/common/constants.js';
import { ChatPetState, getChatPetSpriteName } from '../../../../workbench/contrib/chat/common/chatPet.js';
import { ISessionsProvidersService } from '../../../services/sessions/browser/sessionsProvidersService.js';
import { ISessionsManagementService } from '../../../services/sessions/common/sessionsManagement.js';
import { ISession, SessionStatus, SessionTypeAuthRequirement } from '../../../services/sessions/common/session.js';
import { ARCHIVE_SESSION_COMMAND_ID } from '../../../common/sessionCommands.js';
import { clampGamePoint, GamePoint, GameTask, gameTaskAssignmentRadius, nearestGameTask } from '../common/gameBoard.js';
import { GameLiveUnit, IGameService } from './gameService.js';
import { GameChatSideBar } from './gameChatSideBar.js';

const $ = DOM.$;

export function gameStatusLabel(value: GameLiveUnit['status']): string {
	switch (value) {
		case 'ready': return localize('gameReady', "Draft - No Session");
		case 'sending': return localize('gameSending', "Dispatching");
		case 'unavailable': return localize('gameOffline', "Unavailable");
		case SessionStatus.Untitled: return localize('gameUntitled', "Not started");
		case SessionStatus.InProgress: return localize('gameWorking', "Working");
		case SessionStatus.NeedsInput: return localize('gameNeedsInput', "Needs you");
		case SessionStatus.Completed: return localize('gameResting', "Resting");
		case SessionStatus.Error: return localize('gameFailed', "Failed");
	}
}

function gameResultCountLabel(count: number): string {
	return count === 1 ? localize('gameOneResting', "1 resting") : localize('gameRestingCount', "{0} resting", count);
}

export function gameContextLabel(unit: GameLiveUnit): string {
	const percentage = unit.contextUsagePercent;
	if (percentage === undefined) {
		return '';
	}
	return percentage > 50
		? localize('gameContextFrustrated', "Frustrated: context window {0}% full (above 50%).", Math.ceil(percentage))
		: localize('gameContextUsage', "Context window {0}% full.", Math.round(percentage));
}

interface GamePermissionOption {
	readonly level: ChatPermissionLevel;
	readonly label: string;
	readonly detail: string;
}

function gamePermissionOptions(): GamePermissionOption[] {
	return [
		{ level: ChatPermissionLevel.Default, label: localize('gamePermissionDefault', "Default"), detail: localize('gamePermissionDefaultDetail', "Uses the provider's existing approval defaults") },
		{ level: ChatPermissionLevel.Assisted, label: localize('gamePermissionAssisted', "Assisted"), detail: localize('gamePermissionAssistedDetail', "An AI judge evaluates each tool call before it runs") },
		{ level: ChatPermissionLevel.AutoApprove, label: localize('gamePermissionAutoApprove', "Allow All"), detail: localize('gamePermissionAutoApproveDetail', "Runs tool calls without asking") },
		{ level: ChatPermissionLevel.Autopilot, label: localize('gamePermissionAutopilot', "Autopilot"), detail: localize('gamePermissionAutopilotDetail', "Runs autonomously until the task is done") },
	];
}

function gamePermissionLabel(level: string | undefined): string {
	return gamePermissionOptions().find(option => option.level === level)?.label ?? localize('gamePermissionDefault', "Default");
}

class GameMapNode extends Disposable {
	readonly store = this._register(new DisposableStore());
	readonly button: Button;
	readonly art: HTMLElement;
	readonly label: HTMLElement;
	readonly detail: HTMLElement | undefined;
	private petState: ChatPetState | undefined;
	private frustrated = false;
	constructor(parent: HTMLElement, readonly kind: 'unit' | 'task', portrait = false) {
		super();
		this.button = this._register(new Button(parent, { ...defaultButtonStyles, secondary: true }));
		this.button.element.classList.add(...(portrait ? ['game-portrait'] : ['game-map-node', `game-${kind}`]));
		this.art = DOM.append(this.button.element, $(`span.game-${kind}-art`));
		this.art.setAttribute('aria-hidden', 'true');
		if (kind === 'task') {
			DOM.append(this.art, $('span' + ThemeIcon.asCSSSelector(Codicon.flag)));
		}
		this.label = DOM.append(this.button.element, $('span.game-node-label'));
		if (kind === 'task') {
			this.detail = DOM.append(this.button.element, $('span.game-node-detail'));
		}
	}

	setPosition(point: GamePoint): void {
		this.button.element.style.left = `${point.x}%`;
		this.button.element.style.top = `${point.y}%`;
	}

	setPet(status: GameLiveUnit['status'], frustrated: boolean, quality: string | undefined, assetRoot: URI): void {
		const state = status === SessionStatus.Completed ? 'sleep'
			: status === SessionStatus.InProgress ? 'rendering'
			: status === 'sending' ? 'typing'
			: status === SessionStatus.NeedsInput || status === SessionStatus.Error ? 'worry'
			: 'idle';
		if (this.petState === state && this.frustrated === frustrated) {
			return;
		}
		this.art.classList.toggle('game-pet-complete', status === SessionStatus.Completed && (this.petState === 'rendering' || this.petState === 'typing'));
		this.petState = state;
		this.frustrated = frustrated;
		this.button.element.classList.toggle('game-frustrated', frustrated);
		// Use the pet's fixed-eye body with its speech overlay, without cursor tracking.
		const asset = `${getChatPetSpriteName(frustrated ? 'worry' : state === 'rendering' ? 'idle' : state, quality)}-96`;
		this.art.dataset.petState = state;
		this.art.style.setProperty('--game-pet-image', asCSSUrl(URI.joinPath(assetRoot, `${asset}.png`)));
		if (state === 'typing' && !frustrated) {
			this.art.style.setProperty('--game-pet-working-image', asCSSUrl(URI.joinPath(assetRoot, `${asset}.spritesheet.png`)));
		} else if (state === 'rendering') {
			const speech = `buddy-speech-${quality === 'stable' ? 'stable' : 'insiders'}-96`;
			this.art.style.setProperty('--game-pet-speech-image', asCSSUrl(URI.joinPath(assetRoot, `${speech}.png`)));
			this.art.style.setProperty('--game-pet-speech-animation', asCSSUrl(URI.joinPath(assetRoot, `${speech}.spritesheet.png`)));
		}
	}

	override dispose(): void {
		this.button.element.remove();
		super.dispose();
	}
}

class GameSelectionPortrait extends Disposable {
	readonly element = $('.game-portrait-container');
	readonly store = this._register(new DisposableStore());
	readonly node: GameMapNode;
	readonly deselectButton: Button;

	constructor(parent: HTMLElement) {
		super();
		parent.appendChild(this.element);
		this._register(toDisposable(() => this.element.remove()));
		this.node = this._register(new GameMapNode(this.element, 'unit', true));
		this.deselectButton = this._register(new Button(this.element, { ...defaultButtonStyles, secondary: true, supportIcons: true }));
		this.deselectButton.element.classList.add('game-portrait-deselect');
		this.deselectButton.label = `$(${Codicon.closeCompact.id})`;
	}
}

export class GameWidget extends Disposable {
	readonly element = $('.game-layout');
	private readonly world = $('.game-world');
	private readonly splitView: SplitView;
	private readonly chatSideBar = this._register(new MutableDisposable<GameChatSideBar>());
	private readonly map = $('.game-map');
	private readonly mapViewport = $('.game-map-viewport');
	private readonly mapScrollable = this._register(new DomScrollableElement(this.mapViewport, {}));
	private zoom = 1;
	private readonly nodes = this._register(new DisposableMap<string, GameMapNode>());
	private readonly portraits = this._register(new DisposableMap<string, GameSelectionPortrait>());
	private readonly roster = $('.game-selection-roster');
	private readonly rosterScrollable = this._register(new DomScrollableElement(this.roster, {}));
	private readonly singleSelection = $('.game-single-selection');
	private readonly groupHint = $('.game-group-hint', undefined, localize('gameGroupHint', "Choose a blob below to focus its orders. Use Command to mark selected blobs as done or delete them."));
	private readonly lines = $('.game-map-lines');
	private readonly minimap = $('.game-minimap');
	private readonly census = $('.game-census');
	private readonly selectionTitle = $('.game-selection-title');
	private readonly selectionNameButton: Button;
	private readonly selectionStatus = $('.game-selection-status');
	private readonly selectionDetail = $('.game-selection-detail');
	private readonly selectionContext = $('.game-selection-context');
	private readonly selectionDescriptionButton: Button;
	private readonly taskEditStore = this._register(new DisposableStore());
	private editingTask: { id: string; field: 'title' | 'prompt' } | undefined;
	private readonly selectionTask = $('.game-selection-task');
	private readonly orderPreview = $('.game-order-preview');
	private readonly message = $('.game-message');
	private readonly prompt: InputBox;
	private readonly dispatchButton: Button;
	private readonly openButton: Button;
	private readonly childButton: Button;
	private readonly assignButton: Button;
	private readonly removeButton: Button;
	private readonly deleteButton: Button;
	private readonly markDoneButton: Button;
	private readonly workspaceButton: Button;
	private readonly modelButton: Button;
	private readonly permissionButton: Button;
	private readonly dragStore = this._register(new DisposableStore());
	private readonly panStore = this._register(new DisposableStore());
	private readonly marqueeStore = this._register(new DisposableStore());
	private updateMarquee: (() => void) | undefined;
	private readonly selection = observableValue<ReadonlySet<string>>(this, new Set());
	private readonly deleting = observableValue(this, false);
	private readonly markingDone = observableValue(this, false);
	private get selected(): string | undefined {
		const ids = this.selection.get();
		return ids.size === 1 ? ids.values().next().value : undefined;
	}
	private suppressClick = false;
	private changingPrompt = false;
	private width = 0;
	private height = 0;
	private lastResolvedModel: { id: string; label: string } | undefined;
	/** Skips rebuilding connection DOM when only unit status/activity changed, not layout. */
	private connectionsSignature: string | undefined;

	constructor(
		private readonly options: { readonly petAssetRoot?: URI } = {},
		@IGameService private readonly gameService: IGameService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ISessionsManagementService private readonly managementService: ISessionsManagementService,
		@ISessionsProvidersService private readonly providersService: ISessionsProvidersService,
		@INotificationService private readonly notificationService: INotificationService,
		@IHoverService private readonly hoverService: IHoverService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@ICommandService private readonly commandService: ICommandService,
		@IProductService private readonly productService: IProductService,
	) {
		super();
		this.splitView = this._register(new SplitView(this.element, { orientation: Orientation.HORIZONTAL, proportionalLayout: false }));
		const availableWidth = () => this.width;
		this.splitView.addView({
			element: this.world,
			get minimumSize() { return Math.min(320, availableWidth() / 2); },
			maximumSize: Number.POSITIVE_INFINITY,
			priority: LayoutPriority.High,
			onDidChange: Event.None,
			layout: width => {
				this.world.style.height = `${Math.max(480, this.height)}px`;
				this.world.classList.toggle('game-compact', width < 800);
				this.layoutMap();
			},
		}, 0);
		const topbar = DOM.append(this.world, $('.game-topbar'));
		const brand = DOM.append(topbar, $('.game-brand'));
		DOM.append(brand, $('span' + ThemeIcon.asCSSSelector(Codicon.game)));
		DOM.append(brand, $('strong', undefined, localize('gameWorldName', "WORKLANDS")));
		DOM.append(brand, $('span.game-prototype', undefined, localize('gamePlaytest', "PLAYTEST")));
		topbar.appendChild(this.census);

		const arena = DOM.append(this.world, $('.game-arena'));
		this.mapScrollable.getDomNode().classList.add('game-map-scrollable');
		this.mapScrollable.getDomNode().style.position = 'absolute';
		arena.appendChild(this.mapScrollable.getDomNode());
		this.mapViewport.appendChild(this.map);
		this.map.tabIndex = 0;
		this.map.setAttribute('role', 'group');
		this.map.setAttribute('aria-label', localize('gameMapAria', "Work map. Drag the background to select blobs. Shift-click or Shift+Enter or Shift+Space toggles a blob in the selection. Drag pieces to move, or use arrow keys on a focused piece. Assign Task is the keyboard alternative to dragging. Ctrl+scroll or Shift+scroll zooms. Middle mouse drag pans. On the map background, plus and minus zoom, zero resets zoom, and arrow keys pan. Press Shift+F10 on a blob to open its context menu."));
		this.lines.setAttribute('aria-hidden', 'true');
		this.map.appendChild(this.lines);
		const scenery = DOM.append(this.map, $('.game-scenery'));
		scenery.setAttribute('aria-hidden', 'true');
		for (let i = 0; i < 18; i++) {
			const tree = DOM.append(scenery, $('span.game-tree'));
			tree.style.left = `${4 + ((i * 31) % 93)}%`;
			tree.style.top = `${i % 2 ? 4 + (i % 3) * 3 : 90 + (i % 3) * 2}%`;
		}
		DOM.append(this.map, $('.game-home', undefined, localize('gameBase', "BASE CAMP")));
		const hint = DOM.append(arena, $('.game-map-hint', undefined, localize('gameHint', "Drag background to select  /  Middle drag to pan  /  Ctrl+scroll to zoom")));
		hint.setAttribute('aria-hidden', 'true');
		this._register(DOM.addDisposableListener(this.map, DOM.EventType.POINTER_DOWN, event => {
			this.suppressClick = false;
			if (event.target === this.map && event.button === 0) {
				this.startMarquee(event);
			}
		}));
		this._register(DOM.addDisposableListener(this.mapScrollable.getDomNode(), 'wheel', event => {
			if ((!event.ctrlKey && !event.shiftKey) || event.metaKey || event.altKey) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const delta = event.deltaY || event.deltaX;
			const pixels = delta * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? this.mapViewport.clientHeight : 1);
			const bounds = this.mapViewport.getBoundingClientRect();
			this.setZoom(this.zoom * Math.exp(-pixels * 0.002), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
		}, { capture: true, passive: false }));
		this._register(DOM.addDisposableListener(this.mapViewport, DOM.EventType.POINTER_DOWN, event => {
			if (event.button !== 1) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.marqueeStore.clear();
			this.panStore.clear();
			const start = { x: event.clientX, y: event.clientY };
			const { scrollLeft, scrollTop } = this.mapViewport;
			const monitor = this.panStore.add(new GlobalPointerMoveMonitor());
			const stop = () => this.panStore.clear();
			monitor.startMonitoring(this.mapViewport, event.pointerId, event.buttons, move => {
				this.mapScrollable.setScrollPosition({
					scrollLeft: scrollLeft + start.x - move.clientX,
					scrollTop: scrollTop + start.y - move.clientY,
				});
			}, stop);
			this.panStore.add(DOM.addDisposableListener(this.mapViewport, 'pointercancel', stop));
			this.panStore.add(DOM.addDisposableListener(this.mapViewport, 'lostpointercapture', stop));
			this.panStore.add(DOM.addDisposableListener(DOM.getWindow(this.mapViewport), DOM.EventType.BLUR, stop));
			this.panStore.add(DOM.addDisposableListener(DOM.getWindow(this.mapViewport).document, DOM.EventType.KEY_DOWN, key => {
				if (key.key === 'Escape') {
					key.preventDefault();
					stop();
				}
			}));
		}, { capture: true }));
		this._register(DOM.addDisposableListener(this.mapViewport, 'auxclick', event => {
			if (event.button === 1) {
				event.preventDefault();
				event.stopPropagation();
			}
		}, { capture: true }));
		this._register(DOM.addDisposableListener(this.mapViewport, DOM.EventType.SCROLL, () => this.mapScrollable.scanDomNode()));
		this._register(DOM.addDisposableListener(this.map, DOM.EventType.DBLCLICK, event => {
			if (event.target === this.map) {
				this.run(() => this.addTask(this.pointFromEvent(event)));
			}
		}));
		this._register(DOM.addDisposableListener(this.map, DOM.EventType.KEY_DOWN, event => {
			if (event.target !== this.map || event.ctrlKey || event.metaKey || event.altKey) {
				return;
			}
			if (['+', '=', '-', '0'].includes(event.key)) {
				event.preventDefault();
				event.stopPropagation();
				this.setZoom(event.key === '0' ? 1 : this.zoom * (event.key === '-' ? 1 / 1.2 : 1.2));
				status(localize('gameZoom', "Map zoom: {0} percent", Math.round(this.zoom * 100)));
			}
			const dx = event.key === 'ArrowLeft' ? -80 : event.key === 'ArrowRight' ? 80 : 0;
			const dy = event.key === 'ArrowUp' ? -80 : event.key === 'ArrowDown' ? 80 : 0;
			if (dx || dy) {
				event.preventDefault();
				event.stopPropagation();
				this.mapScrollable.setScrollPosition({ scrollLeft: this.mapViewport.scrollLeft + dx, scrollTop: this.mapViewport.scrollTop + dy });
			}
		}));

		const dock = DOM.append(this.world, $('.game-dock'));
		const radarPanel = DOM.append(dock, $('.game-radar-panel'));
		DOM.append(radarPanel, $('.game-panel-heading', undefined, localize('gameOverview', "TACTICAL MAP")));
		radarPanel.appendChild(this.minimap);
		this.minimap.setAttribute('aria-hidden', 'true');
		DOM.append(radarPanel, $('.game-legend', undefined, localize('gameLegend', "Solid line: task assignment\nDotted line: child chat / session")));

		const inspector = DOM.append(dock, $('.game-inspector'));
		const selectionHeader = DOM.append(inspector, $('.game-selection-header'));
		selectionHeader.append(this.selectionTitle, this.selectionStatus);
		const editableTextStyles = {
			...defaultButtonStyles,
			buttonBackground: 'transparent',
			buttonHoverBackground: 'var(--vscode-toolbar-hoverBackground)',
			buttonForeground: 'inherit',
			hoverDelegate: getDefaultHoverDelegate('element'),
		};
		this.selectionNameButton = this._register(new Button(selectionHeader, editableTextStyles));
		this.selectionNameButton.element.classList.add('game-selection-title', 'game-selection-name');
		selectionHeader.insertBefore(this.selectionNameButton.element, this.selectionStatus);
		this._register(this.selectionNameButton.onDidClick(() => {
			if (this.selected) {
				const id = this.selected;
				if (this.gameService.board.get().tasks.some(task => task.id === id)) {
					this.editTask('title');
				} else {
					this.run(() => this.renameUnit(id));
				}
			}
		}));
		inspector.append(this.groupHint, this.rosterScrollable.getDomNode(), this.singleSelection);
		this.roster.setAttribute('role', 'group');
		this.roster.setAttribute('aria-label', localize('gameSelectedBlobs', "Selected blobs"));
		this._register(DOM.addDisposableListener(this.roster, DOM.EventType.KEY_DOWN, event => {
			const portraits = [...this.portraits.values()];
			const buttons = portraits.map(portrait => portrait.node.button.element);
			const index = portraits.findIndex(portrait => portrait.element.contains(DOM.getActiveElement()));
			const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
				: event.key === 'ArrowRight' ? (index + 1) % buttons.length
				: event.key === 'ArrowLeft' ? (index + buttons.length - 1) % buttons.length : undefined;
			if (next !== undefined) {
				event.preventDefault();
				event.stopPropagation();
				buttons[next]?.focus();
			}
		}));
		this.singleSelection.append(this.selectionTask, this.selectionDetail, this.selectionContext);
		this.selectionDescriptionButton = this._register(new Button(this.singleSelection, {
			...editableTextStyles,
			buttonForeground: 'var(--vscode-descriptionForeground)',
		}));
		this.selectionDescriptionButton.element.classList.add('game-selection-detail', 'game-selection-description');
		this._register(this.selectionDescriptionButton.onDidClick(() => this.editTask('prompt')));
		const brief = DOM.append(this.singleSelection, $('details.game-brief'));
		DOM.append(brief, $('summary', undefined, localize('gameOrderPreview', "Task Brief Sent with Orders")));
		brief.appendChild(this.orderPreview);
		this.prompt = this._register(new InputBox(this.singleSelection, undefined, {
			inputBoxStyles: defaultInputBoxStyles, flexibleHeight: true, flexibleMaxHeight: 70,
			ariaLabel: localize('gameOrdersAria', "Orders for selected unit"),
			placeholder: localize('gameOrdersPlaceholder', "Give your blob an order. Nothing runs until you dispatch."),
		}));
		this._register(this.prompt.onDidChange(value => {
			if (!this.changingPrompt && this.selected) {
				this.gameService.setDraft(this.selected, value);
			}
		}));
		this._register(DOM.addStandardDisposableListener(this.prompt.inputElement, DOM.EventType.KEY_DOWN, e => {
			if (e.keyCode === KeyCode.Enter && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
				e.preventDefault();
				e.stopPropagation();
				if (this.dispatchButton.enabled) {
					this.run(() => this.dispatch());
				}
			}
		}));
		const actions = DOM.append(this.singleSelection, $('.game-unit-actions'));
		this.dispatchButton = this.button(actions, localize('gameDispatch', "Dispatch"), Codicon.send, () => this.dispatch(), false);
		this.openButton = this.button(actions, localize('gameOpenChat', "Open Chat"), Codicon.commentDiscussion, () => this.openChat());
		this.assignButton = this.button(actions, localize('gameAssign', "Assign Task"), Codicon.target, () => this.assignTask());
		this.childButton = this.button(actions, localize('gameChild', "Spawn Child"), Codicon.debugStepInto, () => {
			this.select(this.gameService.spawn(this.selected));
		});
		this.removeButton = this.button(actions, localize('gameRemove', "Remove from Map"), Codicon.close, () => {
			if (this.selected) {
				this.gameService.remove(this.selected);
				this.select(undefined);
			}
		});
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), this.removeButton.element,
			localize('gameRemoveHint', "Removes map pieces only. It never deletes or cancels a real session.")));
		this.message.setAttribute('role', 'status');
		inspector.appendChild(this.message);

		const barracks = DOM.append(dock, $('.game-barracks'));
		DOM.append(barracks, $('.game-panel-heading', undefined, localize('gameCommand', "COMMAND")));
		this.button(barracks, localize('gameSpawn', "Spawn Blob"), Codicon.add, () => {
			this.select(this.gameService.spawn());
			status(localize('gameSpawned', "Blob ready. Assign a task or enter orders, then dispatch to start a real session."));
		}, false).element.classList.add('game-spawn');
		const buildActions = DOM.append(barracks, $('.game-build-actions'));
		this.button(buildActions, localize('gameNewTask', "New Task"), Codicon.flag, () => this.addTask());
		this.button(buildActions, localize('gameRecruit', "Bring Session"), Codicon.signIn, () => this.recruit());
		this.markDoneButton = this.button(barracks, localize('gameMarkBlobsDone', "Mark Blobs as Done"), Codicon.check, () => this.markUnitsDone(
			this.gameService.units.get().filter(unit => this.selection.get().has(unit.id))
		));
		this.markDoneButton.element.classList.add('game-mark-done');
		this._register(this.hoverService.setupDelayedHover(this.markDoneButton.element, {
			content: localize('gameMarkBlobsDoneHint', "Marks the selected sessions as done, just like the session list, and removes their blobs from the map. Select a child chat's parent blob too. Drafts are removed locally."),
		}));
		this.deleteButton = this.button(barracks, localize('gameDeleteBlobs', "Delete Blobs"), Codicon.trash, () => this.deleteUnits(
			this.gameService.units.get().filter(unit => this.selection.get().has(unit.id))
		));
		this.deleteButton.element.classList.add('game-delete-blobs');
		this._register(this.hoverService.setupDelayedHover(this.deleteButton.element, {
			content: localize('gameDeleteBlobsHint', "Deletes selected blobs. Linked sessions and chats use their existing deletion confirmations; drafts are removed locally."),
		}));
		this.workspaceButton = this.button(barracks, localize('gameWorkspace', "Choose Workspace"), Codicon.folder, () => this.chooseWorkspace());
		this.modelButton = this.button(barracks, localize('gameDefaultModel', "Default Model"), Codicon.sparkle, () => this.chooseDefaultModel());
		this.permissionButton = this.button(barracks, localize('gameDefaultPermission', "Default Permission"), Codicon.shield, () => this.chooseDefaultPermission());
		DOM.append(barracks, $('.game-cost-hint', undefined, localize('gameCostHint', "Dispatch uses real AI requests.\nNew recruits use the model and permission defaults above.")));

		this._register(autorun(reader => {
			this.gameService.board.read(reader);
			this.gameService.units.read(reader);
			this.selection.read(reader);
			this.deleting.read(reader);
			this.markingDone.read(reader);
			this.refresh();
		}));
		this._register(DOM.addDisposableListener(this.map, DOM.EventType.CLICK, event => {
			if (event.target === this.map) {
				if (this.suppressClick) {
					this.suppressClick = false;
				} else if (!event.shiftKey) {
					this.select(undefined);
				}
			}
		}));
		const resizeObserver = new ResizeObserver(() => this.layoutMap());
		resizeObserver.observe(this.mapViewport);
		this._register(toDisposable(() => resizeObserver.disconnect()));
	}

	private button(parent: HTMLElement, label: string, icon: ThemeIcon, action: () => void | Promise<void>, secondary = true): Button {
		const button = this._register(new Button(parent, { ...defaultButtonStyles, secondary, supportIcons: true }));
		button.label = `$(${icon.id}) ${label}`;
		this._register(button.onDidClick(() => this.run(action)));
		return button;
	}

	private run(action: () => void | Promise<void>): void {
		void Promise.resolve().then(action).catch(error => {
			const message = getErrorMessage(error);
			this.message.textContent = message;
			this.message.classList.add('game-message-error');
			this.notificationService.error(message);
		});
	}

	private select(id: string | undefined): void {
		this.selectMany(id ? [id] : []);
		if (id) {
			this.nodes.get(id)?.button.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		}
	}

	private selectMany(ids: Iterable<string>): void {
		this.message.textContent = '';
		this.message.classList.remove('game-message-error');
		this.selection.set(new Set(ids), undefined);
	}

	private toggleSelection(id: string): void {
		const ids = new Set(this.gameService.units.get().filter(unit => this.selection.get().has(unit.id)).map(unit => unit.id));
		if (!ids.delete(id)) {
			ids.add(id);
		}
		this.selectMany(ids);
		status(localize('gameSelectionCount', "{0} blobs selected.", ids.size));
	}

	private deselectUnit(id: string): void {
		const restoreFocus = this.portraits.get(id)?.element.contains(DOM.getActiveElement());
		const portraits = [...this.portraits.keys()];
		const index = portraits.indexOf(id);
		const next = portraits[index + 1] ?? portraits[index - 1];
		const ids = new Set(this.selection.get());
		ids.delete(id);
		this.selectMany(ids);
		if (restoreFocus) {
			(this.portraits.get(next)?.node.button.element ?? this.map).focus();
		}
		status(localize('gameSelectionCount', "{0} blobs selected.", ids.size));
	}

	private startMarquee(event: PointerEvent): void {
		event.preventDefault();
		this.panStore.clear();
		this.dragStore.clear();
		this.marqueeStore.clear();
		this.map.focus({ preventScroll: true });
		const pointFromPointer = (pointer: PointerEvent): GamePoint => {
			const bounds = this.mapViewport.getBoundingClientRect();
			return {
				x: (pointer.clientX - bounds.left + this.mapViewport.scrollLeft) / (this.map.clientWidth * this.zoom) * 100,
				y: (pointer.clientY - bounds.top + this.mapViewport.scrollTop) / (this.map.clientHeight * this.zoom) * 100,
			};
		};
		const start = pointFromPointer(event);
		const initialSelection = this.gameService.units.get().filter(unit => this.selection.get().has(unit.id)).map(unit => unit.id);
		// Keep the overlay outside CSS zoom so pointer and rectangle bounds share viewport coordinates.
		const rectangle = DOM.append(this.mapScrollable.getDomNode(), $('.game-selection-rectangle'));
		rectangle.hidden = true;
		rectangle.setAttribute('aria-hidden', 'true');
		this.marqueeStore.add(toDisposable(() => {
			this.updateMarquee = undefined;
			rectangle.remove();
		}));
		let moved = false;
		let finished = false;
		let selectedIds: string[] = [];
		let pointer = event;
		this.updateMarquee = () => {
			if (!moved) {
				return;
			}
			const end = pointFromPointer(pointer);
			const left = Math.max(0, Math.min(start.x, end.x));
			const top = Math.max(0, Math.min(start.y, end.y));
			const right = Math.min(100, Math.max(start.x, end.x));
			const bottom = Math.min(100, Math.max(start.y, end.y));
			const width = this.map.clientWidth * this.zoom / 100;
			const height = this.map.clientHeight * this.zoom / 100;
			rectangle.hidden = false;
			rectangle.style.left = `${left * width - this.mapViewport.scrollLeft}px`;
			rectangle.style.top = `${top * height - this.mapViewport.scrollTop}px`;
			rectangle.style.width = `${(right - left) * width}px`;
			rectangle.style.height = `${(bottom - top) * height}px`;
			selectedIds = this.gameService.units.get().filter(unit => {
				const node = this.nodes.get(unit.id);
				return node && !node.button.element.classList.contains('game-hidden')
					&& unit.x >= left && unit.x <= right && unit.y >= top && unit.y <= bottom;
			}).map(unit => unit.id);
		};
		const update = (move: PointerEvent) => {
			if (move.pointerId !== event.pointerId) {
				return;
			}
			if (!moved && Math.hypot(move.clientX - event.clientX, move.clientY - event.clientY) < 4) {
				return;
			}
			moved = true;
			pointer = move;
			this.updateMarquee?.();
		};
		const finish = (cancelled: boolean) => {
			if (finished) {
				return;
			}
			finished = true;
			this.marqueeStore.clear();
			this.suppressClick = moved;
			if (moved && !cancelled) {
				this.selectMany(event.shiftKey ? new Set([...initialSelection, ...selectedIds]) : selectedIds);
				status(localize('gameSelectionCount', "{0} blobs selected.", this.selection.get().size));
			}
		};
		this.marqueeStore.add(DOM.addDisposableListener(DOM.getWindow(this.map), DOM.EventType.POINTER_UP, up => {
			if (up.pointerId === event.pointerId) {
				update(up);
				finish(false);
			}
		}, true));
		const monitor = this.marqueeStore.add(new GlobalPointerMoveMonitor());
		monitor.startMonitoring(this.map, event.pointerId, event.buttons, update, () => finish(true));
		this.marqueeStore.add(DOM.addDisposableListener(this.map, 'pointercancel', () => finish(true)));
		this.marqueeStore.add(DOM.addDisposableListener(this.map, 'lostpointercapture', () => finish(true)));
		this.marqueeStore.add(DOM.addDisposableListener(this.mapViewport, DOM.EventType.SCROLL, () => this.updateMarquee?.()));
		this.marqueeStore.add(DOM.addDisposableListener(DOM.getWindow(this.map), DOM.EventType.BLUR, () => finish(true)));
		this.marqueeStore.add(DOM.addDisposableListener(DOM.getWindow(this.map).document, DOM.EventType.KEY_DOWN, key => {
			if (key.key === 'Escape') {
				key.preventDefault();
				key.stopPropagation();
				finish(true);
			}
		}));
	}

	private refresh(): void {
		const board = this.gameService.board.get();
		const units = this.gameService.units.get();
		const ids = new Set([...board.tasks.map(task => task.id), ...units.map(unit => unit.id)]);
		const selection = this.selection.get();
		if ([...selection].some(id => !ids.has(id))) {
			this.selection.set(new Set([...selection].filter(id => ids.has(id))), undefined);
		}
		for (const id of this.nodes.keys()) {
			if (!ids.has(id)) {
				this.nodes.deleteAndDispose(id);
			}
		}
		// Precompute lookups once instead of re-scanning tasks/units per node (O(n*m) -> O(n+m)), which matters at the 500-unit/200-task board limits.
		const taskById = new Map(board.tasks.map(task => [task.id, task]));
		const assignedCounts = new Map<string, number>();
		let working = 0;
		let needsInput = 0;
		let resultsReady = 0;
		const taskResults = new Map<string, number>();
		for (const unit of units) {
			if (unit.taskId) {
				assignedCounts.set(unit.taskId, (assignedCounts.get(unit.taskId) ?? 0) + 1);
			}
			if (unit.status === SessionStatus.InProgress) {
				working++;
			} else if (unit.status === SessionStatus.NeedsInput) {
				needsInput++;
			} else if (unit.status === SessionStatus.Completed) {
				resultsReady++;
				if (unit.taskId) {
					taskResults.set(unit.taskId, (taskResults.get(unit.taskId) ?? 0) + 1);
				}
			}
		}
		const minimizedTasks = new Set(board.tasks.filter(task => task.minimized).map(task => task.id));
		const animatedUnits = new Set(units
			.filter(unit => (unit.status === SessionStatus.InProgress || unit.status === 'sending') && (!unit.taskId || !minimizedTasks.has(unit.taskId)))
			.sort((a, b) => Number(this.selection.get().has(b.id)) - Number(this.selection.get().has(a.id)))
			.slice(0, 3).map(unit => unit.id));
		for (const task of board.tasks) {
			const node = this.node(task.id, 'task');
			node.setPosition(task);
			node.label.textContent = task.title;
			const assigned = assignedCounts.get(task.id) ?? 0;
			const detail = node.detail!;
			detail.textContent = task.minimized
				? localize('gameMinimizedDetail', "{0} hidden - double-click to expand", assigned)
				: assigned ? localize('gameCrewCount', "{0} assigned", assigned) : localize('gameUnassigned', "Awaiting crew");
			const ready = taskResults.get(task.id);
			if (ready) {
				detail.textContent = localize('gameTaskResults', "{0}. {1}", detail.textContent, gameResultCountLabel(ready));
			}
			node.button.element.setAttribute('aria-label', task.minimized
				? localize('gameTaskAriaMinimized', "{0}. Minimized. {1}. Double-click to expand.", task.title, detail.textContent)
				: localize('gameTaskAria', "{0}. {1}. Double-click to minimize.", task.title, detail.textContent));
			node.button.element.classList.toggle('game-selected', this.selected === task.id);
			node.button.element.classList.toggle('game-minimized', !!task.minimized);
		}
		for (const unit of units) {
			const node = this.node(unit.id, 'unit');
			const hidden = !!unit.taskId && minimizedTasks.has(unit.taskId);
			node.setPosition(unit);
			node.setPet(unit.status, unit.contextUsagePercent !== undefined && unit.contextUsagePercent > 50, this.productService.quality, this.options.petAssetRoot ?? FileAccess.asBrowserUri('vs/workbench/contrib/chat/browser/widget/media/chatPet'));
			node.label.textContent = unit.name;
			node.button.element.setAttribute('aria-haspopup', 'menu');
			node.button.element.dataset.status = String(unit.status);
			node.button.element.classList.toggle('game-selected', this.selection.get().has(unit.id));
			node.button.element.setAttribute('aria-pressed', String(this.selection.get().has(unit.id)));
			node.button.element.classList.toggle('game-child', !!unit.parentId);
			node.button.element.classList.toggle('game-hidden', hidden);
			node.button.element.classList.toggle('game-pet-animated', animatedUnits.has(unit.id));
			const task = unit.taskId ? taskById.get(unit.taskId) : undefined;
			const label = localize('gameUnitAria', "{0}. {1}. {2}", unit.name, gameStatusLabel(unit.status), task?.title ?? localize('gameAtBase', "Unassigned"));
			const contextLabel = gameContextLabel(unit);
			node.button.element.setAttribute('aria-label', contextLabel ? localize('gameUnitContextAria', "{0}. {1}", label, contextLabel) : label);
		}
		this.census.textContent = localize('gameCensusResults', "{0} units   /   {1} working   /   {2} need you   /   {3}", units.length, working, needsInput, gameResultCountLabel(resultsReady));
		this.workspaceButton.label = `$(${Codicon.folder.id}) ${board.folder ? basename(URI.parse(board.folder)) : localize('gameWorkspace', "Choose Workspace")}`;
		this.workspaceButton.element.setAttribute('aria-label', board.folder ? localize('gameTarget', "Workspace: {0}. Provider: {1}. Change deployment target.", URI.parse(board.folder).fsPath, board.sessionTypeId ?? '') : localize('gameWorkspace', "Choose Workspace"));
		this.modelButton.label = `$(${Codicon.sparkle.id}) ${board.modelId ? this.gameDefaultModelLabel(board.modelId) : localize('gameDefaultModel', "Default Model")}`;
		this.modelButton.element.setAttribute('aria-label', board.modelId ? localize('gameModelSet', "Default model: {0}. Change the model new recruits are dispatched with.", this.gameDefaultModelLabel(board.modelId)) : localize('gameDefaultModelHint', "Set the model new recruits are dispatched with."));
		this.permissionButton.label = `$(${Codicon.shield.id}) ${gamePermissionLabel(board.permissionLevel)}`;
		this.permissionButton.element.setAttribute('aria-label', localize('gamePermissionAria', "Default permission level: {0}. Change the approval level new recruits are dispatched with.", gamePermissionLabel(board.permissionLevel)));
		this.refreshSelection(units, board.tasks);
		this.drawConnections();
	}

	private refreshSelection(units: readonly GameLiveUnit[], tasks: readonly GameTask[]): void {
		const selectedUnits = units.filter(unit => this.selection.get().has(unit.id));
		const multiple = selectedUnits.length > 1;
		this.singleSelection.hidden = multiple;
		this.groupHint.hidden = !multiple;
		this.refreshRoster(selectedUnits);
		const changingSessions = this.deleting.get() || this.markingDone.get();
		this.deleteButton.enabled = !changingSessions && selectedUnits.length > 0 && selectedUnits.every(unit => this.canDeleteUnit(unit));
		this.markDoneButton.element.style.display = multiple ? '' : 'none';
		this.markDoneButton.enabled = !changingSessions && multiple && this.canMarkUnitsDone(selectedUnits);
		const unit = units.find(unit => unit.id === this.selected);
		const task = tasks.find(task => task.id === (unit?.taskId ?? this.selected));
		if (this.editingTask && this.editingTask.id !== this.selected) {
			this.editingTask = undefined;
			this.taskEditStore.clear();
		}
		this.selectionTitle.textContent = multiple ? localize('gameGroupTitle', "{0} blobs selected", selectedUnits.length) : unit?.name ?? task?.title ?? localize('gameWelcome', "Your next quest starts here");
		const isTask = !!task && !unit;
		const canRename = isTask || (!!unit && !unit.automatic);
		this.selectionTitle.style.display = canRename ? 'none' : '';
		this.selectionNameButton.element.style.display = canRename && this.editingTask?.field !== 'title' ? '' : 'none';
		this.selectionNameButton.enabled = canRename;
		this.selectionNameButton.label = unit?.name ?? task?.title ?? '';
		const renameLabel = isTask ? localize('gameEditTaskTitle', "Edit Task Title: {0}", task.title) : localize('gameRenameSelection', "Rename Blob: {0}", unit?.name ?? '');
		this.selectionNameButton.setAriaLabel(renameLabel);
		this.selectionNameButton.setTitle(renameLabel);
		this.selectionDetail.style.display = isTask ? 'none' : '';
		this.selectionDescriptionButton.element.style.display = isTask && this.editingTask?.field !== 'prompt' ? '' : 'none';
		this.selectionDescriptionButton.enabled = isTask;
		this.selectionDescriptionButton.label = isTask ? task.prompt : '';
		const descriptionLabel = localize('gameEditTaskDescription', "Edit Task Description: {0}", isTask ? task.prompt : '');
		this.selectionDescriptionButton.setAriaLabel(descriptionLabel);
		this.selectionDescriptionButton.setTitle(descriptionLabel);
		this.selectionStatus.textContent = multiple ? '' : unit ? gameStatusLabel(unit.status) : task ? localize('gameTaskSite', "TASK SITE") : localize('gameCommander', "COMMANDER");
		this.selectionContext.textContent = unit ? gameContextLabel(unit) : '';
		this.selectionContext.hidden = !this.selectionContext.textContent;
		this.selectionContext.classList.toggle('game-context-warning', unit?.contextUsagePercent !== undefined && unit.contextUsagePercent > 50);
		this.selectionTask.textContent = unit ? task ? localize('gameAssignedTo', "Assigned to {0}", task.title) : localize('gameNoAssignment', "No task assigned. Drag near a flag or choose Assign Task.") : '';
		this.orderPreview.textContent = task?.prompt ?? localize('gameNoTaskBrief', "No task brief. Only your typed orders will be sent.");
		this.selectionDetail.textContent = unit ? unit.activity || (unit.session ? localize('gameFiles', "{0} files changed. {1}", unit.files, unit.readOnly ? localize('gameReadOnly', "Read-only worker. Open Chat to observe.") : localize('gameLiveStatus', "Status is live, not simulated progress.")) : localize('gameDraftUnit', "Local recruit. Dispatch creates a real session; spawning and movement are free.")) : task?.prompt ?? localize('gameIntro', "Create task sites, deploy blobs, and watch real work unfold. Nearby units belong to a task; smaller linked units are child chats.");
		this.changingPrompt = true;
		this.prompt.value = unit?.draft ?? '';
		this.changingPrompt = false;
		const busy = unit?.status === 'sending' || unit?.status === SessionStatus.InProgress || unit?.status === SessionStatus.NeedsInput;
		const available = !!unit && !unit.automatic && !unit.readOnly && !busy && unit.status !== 'unavailable';
		this.prompt.setEnabled(available);
		this.dispatchButton.enabled = available && !!(unit?.draft.trim() || task?.prompt);
		this.openButton.enabled = !!unit?.session;
		this.childButton.enabled = !!unit?.session && !unit.chat && !unit.automatic && unit.canSpawnChild && !unit.readOnly;
		this.assignButton.enabled = !!unit && !unit.automatic && tasks.length > 0 && !busy;
		this.removeButton.enabled = !!this.selected && (!unit || !unit.automatic) && unit?.status !== 'sending';
	}

	private refreshRoster(units: readonly GameLiveUnit[]): void {
		const ids = new Set(units.map(unit => unit.id));
		for (const id of this.portraits.keys()) {
			if (!ids.has(id)) {
				this.portraits.deleteAndDispose(id);
			}
		}
		for (const unit of units) {
			let portrait = this.portraits.get(unit.id);
			if (!portrait) {
				portrait = new GameSelectionPortrait(this.roster);
				this.portraits.set(unit.id, portrait);
				const button = portrait.node.button;
				portrait.store.add(button.onDidClick(() => this.select(unit.id)));
				portrait.store.add(this.hoverService.setupDelayedHover(button.element, () => ({
					content: this.gameService.units.get().find(candidate => candidate.id === unit.id)?.name ?? unit.name,
				})));
				const deselectButton = portrait.deselectButton;
				portrait.store.add(deselectButton.onDidClick(() => this.deselectUnit(unit.id)));
				portrait.store.add(this.hoverService.setupDelayedHover(deselectButton.element, () => ({
					content: deselectButton.element.getAttribute('aria-label') ?? '',
				})));
			}
			portrait.node.button.setAriaLabel(localize('gameSelectBlob', "Select {0}. {1}", unit.name, gameStatusLabel(unit.status)));
			portrait.node.setPet(unit.status, unit.contextUsagePercent !== undefined && unit.contextUsagePercent > 50, this.productService.quality, this.options.petAssetRoot ?? FileAccess.asBrowserUri('vs/workbench/contrib/chat/browser/widget/media/chatPet'));
			portrait.deselectButton.setAriaLabel(localize('gameDeselectBlob', "Remove {0} from Selection", unit.name));
			portrait.deselectButton.element.style.display = units.length > 1 ? '' : 'none';
			portrait.deselectButton.enabled = units.length > 1;
		}
		this.rosterScrollable.getDomNode().hidden = units.length === 0;
		this.rosterScrollable.scanDomNode();
	}

	private editTask(field: 'title' | 'prompt'): void {
		const task = this.gameService.board.get().tasks.find(task => task.id === this.selected);
		if (!task) {
			return;
		}
		this.taskEditStore.clear();
		this.editingTask = { id: task.id, field };
		const source = field === 'title' ? this.selectionNameButton : this.selectionDescriptionButton;
		const editor = $('.game-task-editor');
		source.element.insertAdjacentElement('afterend', editor);
		this.taskEditStore.add(toDisposable(() => editor.remove()));
		const input = this.taskEditStore.add(new InputBox(editor, undefined, {
			inputBoxStyles: defaultInputBoxStyles,
			flexibleHeight: field === 'prompt',
			flexibleMaxHeight: 120,
			ariaLabel: field === 'title' ? localize('gameTaskTitleInput', "Task title") : localize('gameTaskDescriptionInput', "Task description"),
		}));
		input.value = task[field];
		DOM.append(editor, $('.game-task-edit-hint', undefined, field === 'title'
			? localize('gameTaskTitleEditHint', "Enter to save, Escape to cancel.")
			: localize('gameTaskDescriptionEditHint', "Enter to save, Shift+Enter for a new line, Escape to cancel.")));
		const actions = DOM.append(editor, $('.game-task-edit-actions'));
		const save = this.taskEditStore.add(new Button(actions, defaultButtonStyles));
		save.label = localize('gameTaskSave', "Save");
		const cancel = this.taskEditStore.add(new Button(actions, { ...defaultButtonStyles, secondary: true }));
		cancel.label = localize('gameTaskCancel', "Cancel");
		const finish = () => {
			this.editingTask = undefined;
			this.taskEditStore.clear();
			this.refresh();
			source.focus();
		};
		const commit = () => {
			this.gameService.updateTask(task.id, { [field]: input.value });
			finish();
			status(localize('gameTaskUpdated', "Task updated. Changes will be included with the next dispatch."));
		};
		this.taskEditStore.add(save.onDidClick(() => this.run(commit)));
		this.taskEditStore.add(cancel.onDidClick(finish));
		this.taskEditStore.add(DOM.addStandardDisposableListener(editor, DOM.EventType.KEY_DOWN, event => {
			if (event.browserEvent.isComposing) {
				return;
			}
			if (event.keyCode === KeyCode.Escape) {
				event.preventDefault();
				event.stopPropagation();
				finish();
			} else if (event.target === input.inputElement && event.keyCode === KeyCode.Enter && !event.shiftKey && !event.altKey) {
				event.preventDefault();
				event.stopPropagation();
				this.run(commit);
			}
		}));
		this.refresh();
		input.focus();
		input.select();
	}

	private node(id: string, kind: 'unit' | 'task'): GameMapNode {
		let node = this.nodes.get(id);
		if (node) {
			return node;
		}
		node = new GameMapNode(this.map, kind);
		this.nodes.set(id, node);
		const element = node.button.element;
		if (kind === 'unit') {
			node.store.add(DOM.addDisposableListener(element, DOM.EventType.KEY_DOWN, event => {
				if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'Enter' || event.key === ' ')) {
					event.preventDefault();
					event.stopPropagation();
					this.toggleSelection(id);
				}
			}));
			node.store.add(this.hoverService.setupDelayedHover(element, () => ({
				content: element.getAttribute('aria-label') ?? '',
			})));
			node.store.add(DOM.addDisposableListener(element, DOM.EventType.CONTEXT_MENU, event => {
				event.preventDefault();
				event.stopPropagation();
				this.showUnitContextMenu(id, new StandardMouseEvent(DOM.getWindow(element), event));
			}));
			node.store.add(DOM.addDisposableListener(element, DOM.EventType.KEY_DOWN, event => {
				if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
					event.preventDefault();
					event.stopPropagation();
					this.showUnitContextMenu(id, element);
				}
			}));
			node.store.add(DOM.addDisposableListener(node.label, DOM.EventType.DBLCLICK, event => {
				event.stopPropagation();
				this.run(() => this.renameUnit(id));
			}));
			node.store.add(DOM.addDisposableListener(element, DOM.EventType.DBLCLICK, event => {
				event.preventDefault();
				event.stopPropagation();
				this.select(id);
				this.run(() => this.openChat(id));
			}));
		} else {
			node.store.add(DOM.addDisposableListener(element, DOM.EventType.DBLCLICK, event => {
				event.stopPropagation();
				this.run(() => this.toggleMinimizeTask(id));
			}));
		}
		node.store.add(node.button.onDidClick(event => {
			if (this.suppressClick && event?.type === DOM.EventType.CLICK) {
				this.suppressClick = false;
				return;
			}
			if (kind === 'unit' && event && DOM.isMouseEvent(event) && event.shiftKey) {
				this.toggleSelection(id);
				return;
			}
			const selectedUnit = this.gameService.units.get().find(unit => unit.id === this.selected);
			if (kind === 'task' && selectedUnit && !selectedUnit.automatic) {
				this.run(() => { this.gameService.assign(selectedUnit.id, id); });
			} else {
				this.select(id);
			}
		}));
		node.store.add(DOM.addDisposableListener(element, 'pointerdown', event => {
			const unit = this.gameService.units.get().find(unit => unit.id === id);
			if (event.button !== 0 || unit?.automatic || unit?.status === 'sending' || unit?.status === SessionStatus.InProgress || unit?.status === SessionStatus.NeedsInput) {
				return;
			}
			const start = { x: event.clientX, y: event.clientY };
			const bounds = element.getBoundingClientRect();
			const grabOffset = { x: start.x - bounds.left - bounds.width / 2, y: start.y - bounds.top - bounds.height / 2 };
			let moved = false;
			this.dragStore.clear();
			element.setPointerCapture(event.pointerId);
			this.dragStore.add(DOM.addDisposableListener(element, 'pointermove', move => {
				if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < 4 && !moved) {
					return;
				}
				moved = true;
				element.classList.add('game-dragging');
				const point = this.pointFromEvent(move, grabOffset);
				node!.setPosition(this.separateFromTasks(id, point));
				const nearby = kind === 'unit' ? nearestGameTask(this.gameService.board.get().tasks, point)?.id : undefined;
				for (const [taskId, candidate] of this.nodes) {
					candidate.button.element.classList.toggle('game-drop-target', taskId === nearby);
				}
			}));
			const finish = (up: PointerEvent, cancelled: boolean) => {
				element.classList.remove('game-dragging');
				this.dragStore.clear();
				if (element.hasPointerCapture(up.pointerId)) {
					element.releasePointerCapture(up.pointerId);
				}
				for (const candidate of this.nodes.values()) {
					candidate.button.element.classList.remove('game-drop-target');
				}
				this.suppressClick = moved;
				if (moved && !cancelled) {
					this.run(() => {
						this.gameService.move(id, this.separateFromTasks(id, this.pointFromEvent(up, grabOffset)));
						this.select(id);
						status(localize('gameMoved', "Map position updated. Movement does not dispatch work."));
					});
				} else {
					this.refresh();
				}
			};
			this.dragStore.add(DOM.addDisposableListener(element, 'pointerup', event => finish(event, false)));
			this.dragStore.add(DOM.addDisposableListener(element, 'pointercancel', event => finish(event, true)));
			this.dragStore.add(DOM.addDisposableListener(DOM.getWindow(element).document, DOM.EventType.KEY_DOWN, key => {
				if (key.key === 'Escape') {
					key.preventDefault();
					finish(event, true);
				}
			}));
		}));
		node.store.add(DOM.addDisposableListener(element, DOM.EventType.KEY_DOWN, event => {
			const dx = event.key === 'ArrowLeft' ? -3 : event.key === 'ArrowRight' ? 3 : 0;
			const dy = event.key === 'ArrowUp' ? -3 : event.key === 'ArrowDown' ? 3 : 0;
			const piece = this.gameService.board.get().units.find(unit => unit.id === id) ?? this.gameService.board.get().tasks.find(task => task.id === id);
			if (piece && (dx || dy)) {
				event.preventDefault();
				event.stopPropagation();
				this.run(() => {
					this.gameService.move(id, this.separateFromTasks(id, { x: piece.x + dx, y: piece.y + dy }));
					this.select(id);
				});
			}
		}));
		return node;
	}

	private showUnitContextMenu(id: string, anchor: HTMLElement | StandardMouseEvent): void {
		const unit = this.gameService.units.get().find(unit => unit.id === id);
		if (!unit) {
			return;
		}
		this.select(id);
		const session = unit.session ? this.managementService.getSession(URI.parse(unit.session)) : undefined;
		const sending = unit.status === 'sending';
		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => [
				toAction({
					id: 'game.markDone', label: localize('gameArchiveSession', "Archive Session"),
					enabled: !this.markingDone.get() && !this.deleting.get() && !!session && !unit.chat && !sending && !session.isArchived.get(),
					run: () => this.run(async () => {
						await this.commandService.executeCommand(ARCHIVE_SESSION_COMMAND_ID, session);
						if (!this.nodes.has(id)) {
							this.map.focus();
						}
					}),
				}),
				toAction({
					id: 'game.delete', label: localize('gameDelete', "Delete"),
					enabled: !this.deleting.get() && !this.markingDone.get() && this.canDeleteUnit(unit),
					run: () => this.run(() => this.deleteUnits([unit])),
				}),
			],
			onHide: () => (this.nodes.get(id)?.button.element ?? this.map).focus(),
		});
	}

	private canDeleteUnit(unit: GameLiveUnit): boolean {
		const session = unit.session ? this.managementService.getSession(URI.parse(unit.session)) : undefined;
		return unit.status !== 'sending' && (session ? !!session.capabilities.get().supportsDelete : !unit.session && !unit.automatic);
	}

	private canMarkUnitsDone(units: readonly GameLiveUnit[]): boolean {
		const parents = new ResourceMap<boolean>();
		for (const unit of units) {
			if (unit.session && !unit.chat) {
				parents.set(URI.parse(unit.session), true);
			}
		}
		return units.every(unit => {
			if (unit.status === 'sending') {
				return false;
			}
			if (!unit.session) {
				return !unit.automatic;
			}
			const session = this.managementService.getSession(URI.parse(unit.session));
			return !!session && !session.isArchived.get() && (!unit.chat || parents.has(session.resource));
		});
	}

	private async markUnitsDone(units: readonly GameLiveUnit[]): Promise<void> {
		if (this.markingDone.get() || this.deleting.get()) {
			return;
		}
		if (units.length < 2 || !this.canMarkUnitsDone(units)) {
			throw new Error(localize('gameCannotMarkBlobsDone', "Select available blobs to mark as done. Include the parent blob of each selected child chat, and wait for dispatch to finish."));
		}
		this.markingDone.set(true, undefined);
		try {
			const sessions = new ResourceMap<ISession>();
			for (const unit of units) {
				if (unit.session && !unit.chat) {
					const session = this.managementService.getSession(URI.parse(unit.session))!;
					sessions.set(session.resource, session);
				}
			}
			if (sessions.size) {
				await this.commandService.executeCommand(ARCHIVE_SESSION_COMMAND_ID, [...sessions.values()]);
			}
			for (const unit of units) {
				if (!unit.session) {
					this.gameService.remove(unit.id);
				}
			}
			if (!this.selection.get().size) {
				this.map.focus();
			}
			status(localize('gameBlobsMarkedDone', "Selected blobs marked as done."));
		} finally {
			this.markingDone.set(false, undefined);
		}
	}

	private async deleteUnits(units: readonly GameLiveUnit[]): Promise<void> {
		if (this.deleting.get() || this.markingDone.get()) {
			return;
		}
		if (!units.length || !units.every(unit => this.canDeleteUnit(unit))) {
			throw new Error(localize('gameCannotDeleteBlobs', "Some selected blobs cannot be deleted. Select available blobs and try again."));
		}
		this.deleting.set(true, undefined);
		try {
			const sessions = new ResourceMap<ISession>();
			for (const unit of units) {
				if (unit.session && !unit.chat) {
					const session = this.managementService.getSession(URI.parse(unit.session))!;
					sessions.set(session.resource, session);
				}
			}
			if (sessions.size) {
				const targets = [...sessions.values()];
				await this.commandService.executeCommand('sessionsViewPane.deleteSession', targets.length === 1 ? targets[0] : targets);
			}
			for (const unit of units) {
				if (unit.session && unit.chat && !sessions.has(URI.parse(unit.session))) {
					const session = this.managementService.getSession(URI.parse(unit.session));
					if (session) {
						await this.managementService.deleteChat(session, URI.parse(unit.chat));
					}
				} else if (!unit.session) {
					this.gameService.remove(unit.id);
				}
			}
			if (!this.selection.get().size) {
				this.map.focus();
			}
		} finally {
			this.deleting.set(false, undefined);
		}
	}

	private pointFromEvent(event: MouseEvent, offset: GamePoint = { x: 0, y: 0 }): GamePoint {
		const rect = this.map.getBoundingClientRect();
		return { x: (event.clientX - offset.x - rect.left) / Math.max(rect.width, 1) * 100, y: (event.clientY - offset.y - rect.top) / Math.max(rect.height, 1) * 100 };
	}

	private layoutMap(): void {
		this.map.style.width = `${this.mapViewport.clientWidth * 2}px`;
		this.map.style.height = `${this.mapViewport.clientHeight * 2}px`;
		this.mapScrollable.scanDomNode();
		this.rosterScrollable.scanDomNode();
		this.drawConnections();
		this.updateMarquee?.();
	}

	private setZoom(zoom: number, anchor: GamePoint = { x: this.mapViewport.clientWidth / 2, y: this.mapViewport.clientHeight / 2 }): void {
		const next = Math.max(0.5, Math.min(2, zoom));
		const ratio = next / this.zoom;
		const scrollLeft = (this.mapViewport.scrollLeft + anchor.x) * ratio - anchor.x;
		const scrollTop = (this.mapViewport.scrollTop + anchor.y) * ratio - anchor.y;
		this.zoom = next;
		this.map.style.zoom = String(next);
		this.mapScrollable.scanDomNode();
		this.mapScrollable.setScrollPosition({ scrollLeft, scrollTop });
		this.updateMarquee?.();
	}

	private separateFromTasks(id: string, point: GamePoint): GamePoint {
		const node = this.nodes.get(id);
		const position = clampGamePoint(point);
		if (!node || node.kind !== 'unit') {
			return position;
		}
		const bounds = this.map.getBoundingClientRect();
		const blob = node.button.element.getBoundingClientRect();
		const obstacles = this.gameService.board.get().tasks.map(task => {
			const site = this.nodes.get(task.id)!.button.element.getBoundingClientRect();
			return {
				...task,
				xRadius: (site.width + blob.width + 8 * this.zoom) / 2 / Math.max(1, bounds.width) * 100,
				yRadius: (site.height + blob.height + 8 * this.zoom) / 2 / Math.max(1, bounds.height) * 100,
			};
		});
		// Candidate boundaries can round inward; the radii already include a visible gap.
		const overlaps = (candidate: GamePoint, task: typeof obstacles[number]) =>
			Math.abs(candidate.x - task.x) < task.xRadius - 1e-6 && Math.abs(candidate.y - task.y) < task.yRadius - 1e-6;
		if (!obstacles.some(task => overlaps(position, task))) {
			return position;
		}
		const candidates = obstacles.flatMap(task => {
			const dx = position.x - task.x;
			const dy = position.y - task.y;
			const scale = Math.max(Math.abs(dx) / task.xRadius, Math.abs(dy) / task.yRadius);
			return [
				scale ? { x: task.x + dx / scale, y: task.y + dy / scale } : { x: task.x, y: task.y + task.yRadius },
				{ x: task.x - task.xRadius, y: position.y },
				{ x: task.x + task.xRadius, y: position.y },
				{ x: position.x, y: task.y - task.yRadius },
				{ x: position.x, y: task.y + task.yRadius },
			].map(clampGamePoint);
		});
		// Prefer the least occluded position if densely packed sites leave no entirely clear edge.
		const ranked = candidates.map(candidate => ({
			point: candidate,
			overlaps: obstacles.filter(task => overlaps(candidate, task)).length,
			distance: Math.hypot((candidate.x - position.x) * bounds.width, (candidate.y - position.y) * bounds.height),
		}));
		ranked.sort((a, b) => a.overlaps - b.overlaps || a.distance - b.distance);
		return ranked[0].point;
	}

	private drawConnections(): void {
		const board = this.gameService.board.get();
		const units = this.gameService.units.get();
		const width = this.map.clientWidth;
		const height = this.map.clientHeight;
		// Positions/assignments rarely change compared to status/activity text, which updates on every
		// streamed token from a busy unit. Skip rebuilding tether and minimap DOM when the topology is unchanged.
		const signature = `${width}x${height}|${board.tasks.map(task => `${task.id}:${task.x},${task.y},${task.minimized ? 1 : 0}`).join(';')}|${units.map(unit => `${unit.id}:${unit.x},${unit.y},${unit.taskId ?? ''},${unit.parentId ?? ''}`).join(';')}`;
		if (signature === this.connectionsSignature) {
			return;
		}
		this.connectionsSignature = signature;
		DOM.clearNode(this.lines);
		DOM.clearNode(this.minimap);
		this.map.style.setProperty('--game-assignment-width', `${width * gameTaskAssignmentRadius * 2 / 100}px`);
		this.map.style.setProperty('--game-assignment-height', `${height * gameTaskAssignmentRadius * 2 / 100}px`);
		const line = (from: GamePoint, to: GamePoint, child: boolean) => {
			const element = DOM.append(this.lines, $(`span.game-tether${child ? '.game-tether-child' : ''}`));
			const dx = (to.x - from.x) / 100 * width;
			const dy = (to.y - from.y) / 100 * height;
			element.style.left = `${from.x}%`;
			element.style.top = `${from.y}%`;
			element.style.width = `${Math.hypot(dx, dy)}px`;
			element.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
		};
		const taskById = new Map(board.tasks.map(task => [task.id, task]));
		const unitById = new Map(units.map(unit => [unit.id, unit]));
		const minimizedTasks = new Set(board.tasks.filter(task => task.minimized).map(task => task.id));
		for (const unit of units) {
			if (unit.taskId && minimizedTasks.has(unit.taskId)) {
				continue;
			}
			const task = unit.taskId ? taskById.get(unit.taskId) : undefined;
			const parent = unit.parentId ? unitById.get(unit.parentId) : undefined;
			if (task) {
				line(unit, task, false);
			}
			if (parent) {
				line(unit, parent, true);
			}
		}
		for (const piece of [...board.tasks, ...units]) {
			if (!('prompt' in piece) && piece.taskId && minimizedTasks.has(piece.taskId)) {
				continue;
			}
			const dot = DOM.append(this.minimap, $(`span.${'prompt' in piece ? 'game-radar-task' : 'game-radar-unit'}`));
			dot.style.left = `${piece.x}%`;
			dot.style.top = `${piece.y}%`;
		}
	}

	private async addTask(point?: GamePoint): Promise<void> {
		const title = await this.quickInputService.input({ title: localize('gameTaskTitle', "New Task Site"), prompt: localize('gameTaskNamePrompt', "Name the work item"), placeHolder: localize('gameTaskExample', "Build the login screen") });
		if (!title?.trim()) {
			return;
		}
		const prompt = await this.quickInputService.input({ title, prompt: localize('gameTaskBrief', "Instructions for agents assigned to this task"), placeHolder: localize('gameBriefExample', "Describe the outcome and how to verify it") });
		if (!prompt?.trim()) {
			return;
		}
		const id = this.gameService.addTask(title, prompt);
		if (point) {
			this.gameService.move(id, point);
		}
		this.select(id);
		status(localize('gameTaskCreated', "Task site created. Select a blob and click the task to assign it."));
	}

	private async renameUnit(id: string): Promise<void> {
		const unit = this.gameService.units.get().find(unit => unit.id === id);
		if (!unit || unit.automatic) {
			return;
		}
		const name = await this.quickInputService.input({ title: localize('gameRenameUnit', "Rename Blob"), prompt: localize('gameRenamePrompt', "Give this unit a new name"), value: unit.name });
		if (!name?.trim()) {
			return;
		}
		this.gameService.rename(id, name);
		this.select(id);
		status(localize('gameRenamed', "Renamed to {0}", name.trim()));
	}

	private toggleMinimizeTask(id: string): void {
		const task = this.gameService.board.get().tasks.find(task => task.id === id);
		if (!task) {
			return;
		}
		this.gameService.toggleMinimize(id);
		status(task.minimized ? localize('gameExpanded', "{0} expanded. Blobs are visible again.", task.title) : localize('gameMinimized', "{0} minimized. Its blobs are hidden.", task.title));
	}

	private async chooseWorkspace(): Promise<void> {
		const folders = await this.fileDialogService.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: localize('gameChooseFolder', "Choose Deployment Workspace") });
		if (!folders?.[0]) {
			return;
		}
		const folder = folders[0];
		const targets = this.managementService.getSessionTypesForFolder(folder).filter(target => target.sessionType.authRequirement !== SessionTypeAuthRequirement.Unusable);
		if (!targets.length) {
			throw new Error(localize('gameNoProvider', "No agent provider can work in this folder. Configure a provider in the Agents window first."));
		}
		const target = await this.quickInputService.pick(targets.map(target => ({ label: target.sessionType.label, description: target.providerId, target })), { title: localize('gameChooseProvider', "Choose Agent Provider"), placeHolder: localize('gameProviderHint', "Uses this provider's existing model and approval defaults") });
		if (target) {
			this.gameService.setTarget(folder, target.target.providerId, target.target.sessionType.id);
		}
	}

	/**
	 * Best-effort friendly name for a stored default model id. Falls back to the raw id when no
	 * live session for the current provider is available to resolve it against.
	 */
	private gameDefaultModelLabel(modelId: string): string {
		if (this.lastResolvedModel?.id === modelId) {
			return this.lastResolvedModel.label;
		}
		const board = this.gameService.board.get();
		const provider = board.providerId ? this.providersService.getProvider(board.providerId) : undefined;
		const sample = provider ? this.managementService.getSessions().find(session => session.providerId === board.providerId && !session.isArchived.get()) : undefined;
		const match = provider && sample ? provider.getModelsSnapshot(sample.sessionId).models.find(model => model.identifier === modelId) : undefined;
		const label = match?.metadata.name ?? modelId;
		this.lastResolvedModel = { id: modelId, label };
		return label;
	}

	private async chooseDefaultModel(): Promise<void> {
		const board = this.gameService.board.get();
		if (!board.providerId) {
			throw new Error(localize('gameNoTargetForModel', "Choose a workspace first so the game knows which provider's models to offer."));
		}
		const provider = this.providersService.getProvider(board.providerId);
		const sample = this.managementService.getSessions().find(session => session.providerId === board.providerId && !session.isArchived.get());
		if (!provider || !sample) {
			throw new Error(localize('gameNoSessionForModel', "Dispatch at least one unit with this provider first, then set a default model from the map."));
		}
		const models = provider.getModelsSnapshot(sample.sessionId).models;
		if (!models.length) {
			throw new Error(localize('gameNoModels', "This provider has no selectable models right now."));
		}
		const picked = await this.quickInputService.pick(models.map(model => ({ label: model.metadata.name, description: model.identifier, model })),
			{ title: localize('gameChooseDefaultModel', "Choose Default Model"), placeHolder: localize('gameChooseDefaultModelHint', "Applied to brand-new recruits dispatched from the map") });
		if (picked) {
			this.gameService.setDefaultModel(picked.model.identifier);
		}
	}

	private async chooseDefaultPermission(): Promise<void> {
		const options = gamePermissionOptions();
		const picked = await this.quickInputService.pick(options.map(option => ({ label: option.label, detail: option.detail, option })),
			{ title: localize('gameChooseDefaultPermission', "Choose Default Permission Level"), placeHolder: localize('gameChooseDefaultPermissionHint', "Applied to brand-new recruits dispatched from the map") });
		if (picked) {
			this.gameService.setDefaultPermissionLevel(picked.option.level === ChatPermissionLevel.Default ? undefined : picked.option.level);
		}
	}

	private async recruit(): Promise<void> {
		const sessions = this.managementService.getSessions().filter(session => !session.isArchived.get());
		const pick = await this.quickInputService.pick(sessions.map(session => ({ label: session.title.get(), description: session.workspace.get()?.label, session })), { title: localize('gameBringSession', "Bring an Existing Session to the Map") });
		if (pick) {
			this.select(this.gameService.recruit(pick.session));
		}
	}

	private async assignTask(): Promise<void> {
		const id = this.selected;
		const task = await this.quickInputService.pick(this.gameService.board.get().tasks.map(task => ({ label: task.title, description: task.prompt, task })), { title: localize('gameAssignTask', "Assign Unit to Task") });
		if (task && id) {
			this.gameService.assign(id, task.task.id);
		}
	}

	private async dispatch(): Promise<void> {
		const id = this.selected;
		if (!id) {
			return;
		}
		this.message.textContent = localize('gameDispatchingMessage', "Sending orders to the provider...");
		await this.gameService.dispatch(id);
		if (this.selected === id) {
			this.message.textContent = localize('gameOrdersAccepted', "Orders accepted. Watch the unit for live status.");
		}
		status(localize('gameDispatchedAnnouncement', "Orders accepted."));
	}

	private openChat(id = this.selected): void {
		const unit = this.gameService.units.get().find(unit => unit.id === id);
		if (unit?.session) {
			const session = this.managementService.getSession(URI.parse(unit.session));
			if (!session) {
				throw new Error(localize('gameMissingSession', "This session is unavailable. Reconnect its provider first."));
			}
			const chatResource = unit.chat ? URI.parse(unit.chat) : undefined;
			const chat = chatResource ? session.chats.get().find(chat => isEqual(chat.resource, chatResource)) : session.mainChat.get();
			if (!chat) {
				throw new Error(localize('gameMissingChat', "This chat is no longer available."));
			}
			if (!this.chatSideBar.value) {
				this.chatSideBar.value = this.instantiationService.createInstance(GameChatSideBar, () => {
					this.splitView.removeView(1);
					this.chatSideBar.clear();
					(this.selected ? this.nodes.get(this.selected)?.button.element ?? this.map : this.map).focus();
				});
				const sidebar = this.chatSideBar.value;
				const availableWidth = () => this.width;
				this.splitView.addView({
					element: sidebar.element,
					get minimumSize() { return Math.min(280, availableWidth() / 2); },
					maximumSize: Number.POSITIVE_INFINITY,
					onDidChange: Event.None,
					layout: width => sidebar.layout(width, Math.max(480, this.height)),
				}, Math.min(420, this.width / 2));
			}
			const sidebar = this.chatSideBar.value;
			sidebar.setChat(session, chat);
			sidebar.focus();
		}
	}

	layout(width: number, height: number): void {
		if (this.width === width && this.height === height) {
			return;
		}
		this.width = width;
		this.height = height;
		this.element.style.height = `${Math.max(480, height)}px`;
		this.splitView.layout(width);
	}

	focus(): void { this.map.focus(); }
}
