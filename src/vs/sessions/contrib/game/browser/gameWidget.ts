/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/game.css';
import * as DOM from '../../../../base/browser/dom.js';
import { status } from '../../../../base/browser/ui/aria/aria.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Disposable, DisposableMap, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { basename } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { defaultButtonStyles, defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { ISessionsService } from '../../../services/sessions/browser/sessionsService.js';
import { ISessionsManagementService } from '../../../services/sessions/common/sessionsManagement.js';
import { SessionStatus, SessionTypeAuthRequirement } from '../../../services/sessions/common/session.js';
import { GamePoint, GameTask, nearestGameTask } from '../common/gameBoard.js';
import { GameLiveUnit, IGameService } from './gameService.js';

const $ = DOM.$;

export function gameStatusLabel(value: GameLiveUnit['status']): string {
	switch (value) {
		case 'ready': return localize('gameReady', "Draft - No Session");
		case 'sending': return localize('gameSending', "Dispatching");
		case 'unavailable': return localize('gameOffline', "Unavailable");
		case SessionStatus.Untitled: return localize('gameUntitled', "Not started");
		case SessionStatus.InProgress: return localize('gameWorking', "Working");
		case SessionStatus.NeedsInput: return localize('gameNeedsInput', "Needs you");
		case SessionStatus.Completed: return localize('gameTurnComplete', "Turn complete");
		case SessionStatus.Error: return localize('gameFailed', "Failed");
	}
}

class GameMapNode extends Disposable {
	readonly store = this._register(new DisposableStore());
	readonly button: Button;
	readonly art: HTMLElement;
	readonly label: HTMLElement;
	readonly detail: HTMLElement;
	constructor(parent: HTMLElement, readonly kind: 'unit' | 'task') {
		super();
		this.button = this._register(new Button(parent, { ...defaultButtonStyles, secondary: true }));
		this.button.element.classList.add('game-map-node', `game-${kind}`);
		this.art = DOM.append(this.button.element, $(`span.game-${kind}-art`));
		this.art.setAttribute('aria-hidden', 'true');
		if (kind === 'unit') {
			DOM.append(this.art, $('span.game-blob-logo' + ThemeIcon.asCSSSelector(Codicon.vscode)));
			DOM.append(this.art, $('span.game-blob-eyes'));
		} else {
			DOM.append(this.art, $('span' + ThemeIcon.asCSSSelector(Codicon.flag)));
		}
		this.label = DOM.append(this.button.element, $('span.game-node-label'));
		this.detail = DOM.append(this.button.element, $('span.game-node-detail'));
	}

	setPosition(point: GamePoint): void {
		this.button.element.style.left = `${point.x}%`;
		this.button.element.style.top = `${point.y}%`;
	}

	override dispose(): void {
		this.button.element.remove();
		super.dispose();
	}
}

export class GameWidget extends Disposable {
	readonly element = $('.game-world');
	private readonly map = $('.game-map');
	private readonly nodes = this._register(new DisposableMap<string, GameMapNode>());
	private readonly lines = $('.game-map-lines');
	private readonly minimap = $('.game-minimap');
	private readonly census = $('.game-census');
	private readonly selectionTitle = $('.game-selection-title');
	private readonly selectionStatus = $('.game-selection-status');
	private readonly selectionDetail = $('.game-selection-detail');
	private readonly selectionTask = $('.game-selection-task');
	private readonly orderPreview = $('.game-order-preview');
	private readonly message = $('.game-message');
	private readonly prompt: InputBox;
	private readonly dispatchButton: Button;
	private readonly openButton: Button;
	private readonly childButton: Button;
	private readonly assignButton: Button;
	private readonly removeButton: Button;
	private readonly workspaceButton: Button;
	private readonly dragStore = this._register(new DisposableStore());
	private selected: string | undefined;
	private suppressClick = false;
	private changingPrompt = false;
	private width = 0;
	private height = 0;

	constructor(
		@IGameService private readonly gameService: IGameService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@ISessionsService private readonly sessionsService: ISessionsService,
		@ISessionsManagementService private readonly managementService: ISessionsManagementService,
		@INotificationService private readonly notificationService: INotificationService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();
		const topbar = DOM.append(this.element, $('.game-topbar'));
		const brand = DOM.append(topbar, $('.game-brand'));
		DOM.append(brand, $('span' + ThemeIcon.asCSSSelector(Codicon.game)));
		DOM.append(brand, $('strong', undefined, localize('gameWorldName', "WORKLANDS")));
		DOM.append(brand, $('span.game-prototype', undefined, localize('gamePlaytest', "PLAYTEST")));
		topbar.appendChild(this.census);

		const arena = DOM.append(this.element, $('.game-arena'));
		arena.appendChild(this.map);
		this.map.tabIndex = 0;
		this.map.setAttribute('role', 'group');
		this.map.setAttribute('aria-label', localize('gameMapAria', "Work map. Select units or tasks. Drag to move, or use arrow keys on a focused piece. Assign Task is the keyboard alternative to dragging."));
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
		const hint = DOM.append(arena, $('.game-map-hint', undefined, localize('gameHint', "Spawn a blob  /  Add a task  /  Drag to assign  /  Dispatch")));
		hint.setAttribute('aria-hidden', 'true');
		this._register(DOM.addDisposableListener(this.map, DOM.EventType.DBLCLICK, event => {
			if (event.target === this.map) {
				this.run(() => this.addTask(this.pointFromEvent(event)));
			}
		}));

		const dock = DOM.append(this.element, $('.game-dock'));
		const radarPanel = DOM.append(dock, $('.game-radar-panel'));
		DOM.append(radarPanel, $('.game-panel-heading', undefined, localize('gameOverview', "TACTICAL MAP")));
		radarPanel.appendChild(this.minimap);
		this.minimap.setAttribute('aria-hidden', 'true');
		DOM.append(radarPanel, $('.game-legend', undefined, localize('gameLegend', "Solid line: task assignment\nDotted line: child chat / session")));

		const inspector = DOM.append(dock, $('.game-inspector'));
		const selectionHeader = DOM.append(inspector, $('.game-selection-header'));
		selectionHeader.append(this.selectionTitle, this.selectionStatus);
		inspector.append(this.selectionTask, this.selectionDetail);
		const brief = DOM.append(inspector, $('details.game-brief'));
		DOM.append(brief, $('summary', undefined, localize('gameOrderPreview', "Task Brief Sent with Orders")));
		brief.appendChild(this.orderPreview);
		this.prompt = this._register(new InputBox(inspector, undefined, {
			inputBoxStyles: defaultInputBoxStyles, flexibleHeight: true, flexibleMaxHeight: 70,
			ariaLabel: localize('gameOrdersAria', "Orders for selected unit"),
			placeholder: localize('gameOrdersPlaceholder', "Give your blob an order. Nothing runs until you dispatch."),
		}));
		this._register(this.prompt.onDidChange(value => {
			if (!this.changingPrompt && this.selected) {
				this.gameService.setDraft(this.selected, value);
			}
		}));
		const actions = DOM.append(inspector, $('.game-unit-actions'));
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
		this.workspaceButton = this.button(barracks, localize('gameWorkspace', "Choose Workspace"), Codicon.folder, () => this.chooseWorkspace());
		DOM.append(barracks, $('.game-cost-hint', undefined, localize('gameCostHint', "Dispatch uses real AI requests.\nYour existing approval settings apply.")));

		this._register(autorun(reader => {
			this.gameService.board.read(reader);
			this.gameService.units.read(reader);
			this.refresh();
		}));
		this._register(DOM.addDisposableListener(this.map, DOM.EventType.CLICK, event => {
			if (event.target === this.map) {
				this.select(undefined);
			}
		}));
		const resizeObserver = new ResizeObserver(() => this.drawConnections());
		resizeObserver.observe(this.map);
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
		this.selected = id;
		this.message.textContent = '';
		this.message.classList.remove('game-message-error');
		this.refresh();
	}

	private refresh(): void {
		const board = this.gameService.board.get();
		const units = this.gameService.units.get();
		const ids = new Set([...board.tasks.map(task => task.id), ...units.map(unit => unit.id)]);
		for (const id of this.nodes.keys()) {
			if (!ids.has(id)) {
				this.nodes.deleteAndDispose(id);
			}
		}
		for (const task of board.tasks) {
			const node = this.node(task.id, 'task');
			node.setPosition(task);
			node.label.textContent = task.title;
			const assigned = units.filter(unit => unit.taskId === task.id);
			node.detail.textContent = assigned.length ? localize('gameCrewCount', "{0} assigned", assigned.length) : localize('gameUnassigned', "Awaiting crew");
			node.button.element.setAttribute('aria-label', `${task.title}. ${node.detail.textContent}`);
			node.button.element.classList.toggle('game-selected', this.selected === task.id);
		}
		for (const unit of units) {
			const node = this.node(unit.id, 'unit');
			node.setPosition(unit);
			node.label.textContent = unit.name;
			node.detail.textContent = gameStatusLabel(unit.status);
			node.button.element.dataset.status = String(unit.status);
			node.button.element.classList.toggle('game-selected', this.selected === unit.id);
			node.button.element.classList.toggle('game-child', !!unit.parentId);
			const task = board.tasks.find(task => task.id === unit.taskId);
			node.button.element.setAttribute('aria-label', localize('gameUnitAria', "{0}. {1}. {2}", unit.name, node.detail.textContent, task?.title ?? localize('gameAtBase', "Unassigned")));
		}
		this.census.textContent = localize('gameCensus', "{0} units   /   {1} working   /   {2} need you", units.length, units.filter(unit => unit.status === SessionStatus.InProgress).length, units.filter(unit => unit.status === SessionStatus.NeedsInput).length);
		this.workspaceButton.label = `$(${Codicon.folder.id}) ${board.folder ? basename(URI.parse(board.folder)) : localize('gameWorkspace', "Choose Workspace")}`;
		this.workspaceButton.element.setAttribute('aria-label', board.folder ? localize('gameTarget', "Workspace: {0}. Provider: {1}. Change deployment target.", URI.parse(board.folder).fsPath, board.sessionTypeId ?? '') : localize('gameWorkspace', "Choose Workspace"));
		this.refreshSelection(units, board.tasks);
		this.drawConnections();
	}

	private refreshSelection(units: readonly GameLiveUnit[], tasks: readonly GameTask[]): void {
		const unit = units.find(unit => unit.id === this.selected);
		const task = tasks.find(task => task.id === (unit?.taskId ?? this.selected));
		this.selectionTitle.textContent = unit?.name ?? task?.title ?? localize('gameWelcome', "Your next quest starts here");
		this.selectionStatus.textContent = unit ? gameStatusLabel(unit.status) : task ? localize('gameTaskSite', "TASK SITE") : localize('gameCommander', "COMMANDER");
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

	private node(id: string, kind: 'unit' | 'task'): GameMapNode {
		let node = this.nodes.get(id);
		if (node) {
			return node;
		}
		node = new GameMapNode(this.map, kind);
		this.nodes.set(id, node);
		const element = node.button.element;
		node.store.add(node.button.onDidClick(() => {
			if (this.suppressClick) {
				this.suppressClick = false;
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
			let moved = false;
			this.dragStore.clear();
			element.setPointerCapture(event.pointerId);
			this.dragStore.add(DOM.addDisposableListener(element, 'pointermove', move => {
				if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < 4 && !moved) {
					return;
				}
				moved = true;
				element.classList.add('game-dragging');
				const point = this.pointFromEvent(move);
				node!.setPosition(point);
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
						this.gameService.move(id, this.pointFromEvent(up));
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
					this.gameService.move(id, { x: piece.x + dx, y: piece.y + dy });
					this.select(id);
				});
			}
		}));
		return node;
	}

	private pointFromEvent(event: MouseEvent): GamePoint {
		const rect = this.map.getBoundingClientRect();
		return { x: (event.clientX - rect.left) / Math.max(rect.width, 1) * 100, y: (event.clientY - rect.top) / Math.max(rect.height, 1) * 100 };
	}

	private drawConnections(): void {
		DOM.clearNode(this.lines);
		DOM.clearNode(this.minimap);
		const board = this.gameService.board.get();
		const units = this.gameService.units.get();
		const width = this.map.clientWidth;
		const height = this.map.clientHeight;
		this.map.style.setProperty('--game-assignment-width', `${width * 0.3}px`);
		this.map.style.setProperty('--game-assignment-height', `${height * 0.3}px`);
		const line = (from: GamePoint, to: GamePoint, child: boolean) => {
			const element = DOM.append(this.lines, $(`span.game-tether${child ? '.game-tether-child' : ''}`));
			const dx = (to.x - from.x) / 100 * width;
			const dy = (to.y - from.y) / 100 * height;
			element.style.left = `${from.x}%`;
			element.style.top = `${from.y}%`;
			element.style.width = `${Math.hypot(dx, dy)}px`;
			element.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
		};
		for (const unit of units) {
			const task = board.tasks.find(task => task.id === unit.taskId);
			const parent = units.find(parent => parent.id === unit.parentId);
			if (task) {
				line(unit, task, false);
			}
			if (parent) {
				line(unit, parent, true);
			}
		}
		for (const piece of [...board.tasks, ...units]) {
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

	private async openChat(): Promise<void> {
		const unit = this.gameService.units.get().find(unit => unit.id === this.selected);
		if (unit?.session) {
			if (unit.chat) {
				const session = this.managementService.getSession(URI.parse(unit.session));
				if (!session) {
					throw new Error(localize('gameMissingSession', "This session is unavailable. Reconnect its provider first."));
				}
				await this.sessionsService.openChat(session, URI.parse(unit.chat));
			} else {
				await this.sessionsService.openSession(URI.parse(unit.session));
			}
		}
	}

	layout(width: number, height: number): void {
		if (this.width === width && this.height === height) {
			return;
		}
		this.width = width;
		this.height = height;
		this.element.style.height = `${Math.max(480, height)}px`;
		this.element.classList.toggle('game-compact', width < 800);
		this.drawConnections();
	}

	focus(): void { this.map.focus(); }
}
