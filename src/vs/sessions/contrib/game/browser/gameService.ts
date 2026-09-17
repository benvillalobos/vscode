/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { derived, IObservable, observableSignalFromEvent, observableValue } from '../../../../base/common/observable.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IChatEntitlementService } from '../../../../workbench/services/chat/common/chatEntitlementService.js';
import { ISessionsManagementService } from '../../../services/sessions/common/sessionsManagement.js';
import { ChatInteractivity, IChat, ISession, SessionStatus } from '../../../services/sessions/common/session.js';
import { clampGamePoint, emptyGameBoard, GameBoard, GamePoint, gameSatellitePoint, gameSpawnPoint, GameUnit, isGameBoard, nearestGameTask } from '../common/gameBoard.js';

const BOARD_STORAGE_KEY = 'sessions.game.board.v1';

export interface GameLiveUnit extends GameUnit {
	readonly status: SessionStatus | 'ready' | 'sending' | 'unavailable';
	readonly activity: string;
	readonly files: number;
	readonly readOnly: boolean;
	readonly canSpawnChild: boolean;
	readonly automatic?: boolean;
}

export const IGameService = createDecorator<IGameService>('sessionsGameService');

export interface IGameService {
	readonly _serviceBrand: undefined;
	readonly board: IObservable<GameBoard>;
	readonly units: IObservable<readonly GameLiveUnit[]>;
	spawn(parentId?: string): string;
	addTask(title: string, prompt: string): string;
	move(id: string, point: GamePoint): void;
	assign(unitId: string, taskId: string): void;
	setDraft(unitId: string, draft: string): void;
	setTarget(folder: URI, providerId: string, sessionTypeId: string): void;
	recruit(session: ISession): string;
	remove(id: string): void;
	dispatch(unitId: string): Promise<void>;
}

export class GameService extends Disposable implements IGameService {
	declare readonly _serviceBrand: undefined;
	private readonly state = observableValue<GameBoard>(this, emptyGameBoard);
	readonly board = this.state;
	private readonly sending = observableValue<ReadonlySet<string>>(this, new Set());
	private readonly sessionsChanged;
	readonly units: IObservable<readonly GameLiveUnit[]>;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@IWorkspaceTrustManagementService private readonly trustService: IWorkspaceTrustManagementService,
		@IChatEntitlementService private readonly entitlementService: IChatEntitlementService,
		@ILogService logService: ILogService,
	) {
		super();
		const saved = storageService.get(BOARD_STORAGE_KEY, StorageScope.WORKSPACE);
		if (saved) {
			try {
				const parsed: unknown = JSON.parse(saved);
				if (!isGameBoard(parsed)) {
					throw new Error('Invalid Game board');
				}
				this.state.set(parsed, undefined);
			} catch (error) {
				logService.error('[Game] Could not restore board', error);
			}
		}
		this.sessionsChanged = observableSignalFromEvent(this, sessionsManagementService.onDidChangeSessions);
		this.units = derived(this, reader => {
			this.sessionsChanged.read(reader);
			const board = this.state.read(reader);
			const sending = this.sending.read(reader);
			const result: GameLiveUnit[] = [];
			const sessions = sessionsManagementService.getSessions();
			const resolve = (unit: GameUnit) => unit.session ? sessionsManagementService.getSession(URI.parse(unit.session)) : undefined;
			const add = (unit: GameUnit, session: ISession | undefined, chat: IChat | undefined, automatic = false) => {
				if (chat?.interactivity.read(reader) === ChatInteractivity.Hidden) {
					return;
				}
				const disconnected = session?.remoteConnectionStatus?.read(reader);
				result.push({
					...unit,
					name: chat?.title.read(reader) || session?.title.read(reader) || unit.name,
					status: sending.has(unit.id) ? 'sending' : unit.session && (!session || !chat || (disconnected && disconnected.kind !== 'connected')) ? 'unavailable' : chat?.status.read(reader) ?? 'ready',
					activity: chat?.description.read(reader)?.value ?? '',
					files: chat?.changes.read(reader).length ?? 0,
					readOnly: !!session?.isArchived.read(reader) || !!chat?.isArchived.read(reader) || (!!chat && chat.interactivity.read(reader) !== ChatInteractivity.Full),
					canSpawnChild: !!session?.capabilities.read(reader).supportsMultipleChats,
					automatic,
				});
			};
			for (const unit of board.units) {
				const session = resolve(unit);
				const chat = unit.chat ? session?.chats.read(reader).find(chat => isEqual(chat.resource, URI.parse(unit.chat!))) : session?.mainChat.read(reader);
				add(unit, session, chat);
				if (session && !unit.chat) {
					let index = 0;
					for (const child of session.chats.read(reader)) {
						if (isEqual(child.resource, session.mainChat.read(reader).resource) || child.interactivity.read(reader) === ChatInteractivity.Hidden
							|| board.units.some(candidate => candidate.chat && isEqual(URI.parse(candidate.chat), child.resource))) {
							continue;
						}
						const parentUnit = child.origin?.parentChat ? result.find(candidate => candidate.chat && isEqual(URI.parse(candidate.chat), child.origin!.parentChat)) ?? unit : unit;
						add({
							id: child.resource.toString(), name: '', session: session.resource.toString(), chat: child.resource.toString(),
							parentId: parentUnit.id, taskId: parentUnit.taskId, draft: '', ...gameSatellitePoint(parentUnit, index++),
						}, session, child, true);
					}
					for (const childSession of sessions) {
						const parent = childSession.createdBySession?.read(reader);
						if (!parent || !isEqual(parent.session, session.resource) || board.units.some(candidate => candidate.session && isEqual(URI.parse(candidate.session), childSession.resource))) {
							continue;
						}
						add({
							id: childSession.resource.toString(), name: '', session: childSession.resource.toString(),
							parentId: unit.id, taskId: unit.taskId, draft: '', ...gameSatellitePoint(unit, index++),
						}, childSession, childSession.mainChat.read(reader), true);
					}
				}
			}
			return result;
		});
	}

	private save(board: GameBoard): void {
		this.storageService.store(BOARD_STORAGE_KEY, JSON.stringify(board), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		this.state.set(board, undefined);
	}

	private updateUnit(id: string, update: Partial<GameUnit>): void {
		const board = this.state.get();
		this.save({ ...board, units: board.units.map(unit => unit.id === id ? { ...unit, ...update } : unit) });
	}

	private ensureMovable(id: string): void {
		const unit = this.units.get().find(unit => unit.id === id);
		if (!unit || unit.automatic || unit.status === 'sending' || unit.status === SessionStatus.InProgress || unit.status === SessionStatus.NeedsInput) {
			throw new Error(localize('gameUnitBusy', "This unit is busy or managed by its parent. Wait for its turn to finish before changing its assignment."));
		}
	}

	spawn(parentId?: string): string {
		const board = this.state.get();
		if (board.units.length >= 500) {
			throw new Error(localize('gameUnitLimit', "The map is full. Remove a unit before spawning another."));
		}
		const parent = parentId ? board.units.find(unit => unit.id === parentId) : undefined;
		if (parentId && (!parent?.session || !this.units.get().find(unit => unit.id === parentId)?.canSpawnChild)) {
			throw new Error(localize('gameChildUnavailable', "This session does not support additional chats."));
		}
		const id = generateUuid();
		const point = parent ? gameSatellitePoint(parent, board.units.filter(unit => unit.parentId === parentId).length) : gameSpawnPoint(board.units.length);
		this.save({ ...board, units: [...board.units, {
			id, name: localize('gameUnitName', "Blob {0}", board.units.length + 1), draft: '',
			parentId, taskId: parent?.taskId, ...point,
		}] });
		return id;
	}

	addTask(title: string, prompt: string): string {
		const board = this.state.get();
		if (!title.trim() || !prompt.trim() || board.tasks.length >= 200) {
			throw new Error(localize('gameTaskInvalid', "Give the task a name and instructions. The map supports up to 200 tasks."));
		}
		const id = generateUuid();
		this.save({ ...board, tasks: [...board.tasks, {
			id, title: title.trim(), prompt: prompt.trim(), x: 22 + (board.tasks.length % 3) * 28, y: 22 + (board.tasks.length % 3 === 1 ? 20 : 0) + (Math.floor(board.tasks.length / 3) % 2) * 20,
		}] });
		return id;
	}

	move(id: string, point: GamePoint): void {
		const board = this.state.get();
		const position = clampGamePoint(point);
		const task = board.tasks.find(task => task.id === id);
		if (task) {
			this.save({ ...board,
				tasks: board.tasks.map(task => task.id === id ? { ...task, ...position } : task),
				units: board.units.map(unit => unit.taskId === id ? { ...unit, ...clampGamePoint({ x: unit.x + position.x - task.x, y: unit.y + position.y - task.y }) } : unit),
			});
		} else {
			this.ensureMovable(id);
			const unit = board.units.find(unit => unit.id === id)!;
			const descendants = new Set([id]);
			for (let size = 0; size !== descendants.size;) {
				size = descendants.size;
				for (const child of board.units) {
					if (child.parentId && descendants.has(child.parentId)) {
						descendants.add(child.id);
					}
				}
			}
			this.save({ ...board, units: board.units.map(candidate => candidate.id === id
				? { ...candidate, ...position, taskId: nearestGameTask(board.tasks, position)?.id }
				: descendants.has(candidate.id) ? { ...candidate, ...clampGamePoint({ x: candidate.x + position.x - unit.x, y: candidate.y + position.y - unit.y }) } : candidate) });
		}
	}

	assign(unitId: string, taskId: string): void {
		this.ensureMovable(unitId);
		const task = this.state.get().tasks.find(task => task.id === taskId);
		if (!task) {
			throw new Error(localize('gameMissingTask', "This task is no longer on the map."));
		}
		this.updateUnit(unitId, { taskId, ...gameSatellitePoint(task, this.state.get().units.filter(unit => unit.taskId === taskId).length) });
	}

	setDraft(unitId: string, draft: string): void { this.updateUnit(unitId, { draft }); }

	setTarget(folder: URI, providerId: string, sessionTypeId: string): void {
		this.save({ ...this.state.get(), folder: folder.toString(), providerId, sessionTypeId });
	}

	recruit(session: ISession): string {
		const board = this.state.get();
		const existing = board.units.find(unit => unit.session && !unit.chat && isEqual(URI.parse(unit.session), session.resource));
		if (existing) {
			return existing.id;
		}
		const id = this.spawn();
		this.updateUnit(id, { session: session.resource.toString(), name: session.title.get() });
		return id;
	}

	remove(id: string): void {
		if (this.sending.get().has(id)) {
			throw new Error(localize('gameSendingUnit', "Wait for dispatch to finish before removing this unit."));
		}
		const board = this.state.get();
		const removed = new Set([id]);
		for (let size = 0; size !== removed.size;) {
			size = removed.size;
			for (const unit of board.units) {
				if (unit.parentId && removed.has(unit.parentId)) {
					if (this.sending.get().has(unit.id)) {
						throw new Error(localize('gameSendingChild', "A child unit is dispatching. Wait before removing its parent."));
					}
					removed.add(unit.id);
				}
			}
		}
		this.save({ ...board, tasks: board.tasks.filter(task => task.id !== id),
			units: board.units.filter(unit => !removed.has(unit.id)).map(unit => unit.taskId === id ? { ...unit, taskId: undefined } : unit) });
	}

	async dispatch(unitId: string): Promise<void> {
		const board = this.state.get();
		const unit = board.units.find(unit => unit.id === unitId);
		const live = this.units.get().find(unit => unit.id === unitId);
		const task = board.tasks.find(task => task.id === unit?.taskId);
		const query = [task?.prompt, unit?.draft.trim()].filter(Boolean).join('\n\n');
		if (!unit || !live || !query || this.sending.get().has(unitId) || live.status === SessionStatus.InProgress || live.status === SessionStatus.NeedsInput || live.readOnly || live.status === 'unavailable') {
			throw new Error(localize('gameDispatchUnavailable', "Select an available unit and give it a task or instructions. Open its chat to handle approvals or an active turn."));
		}
		if (this.entitlementService.sentiment.hidden || this.entitlementService.sentiment.disabled || this.entitlementService.sentiment.disabledInWorkspace || !this.trustService.isWorkspaceTrusted()) {
			throw new Error(localize('gameDispatchDisabled', "Enable AI features and trust the workspace before dispatching a session."));
		}
		this.sending.set(new Set([...this.sending.get(), unitId]), undefined);
		try {
			if (unit.session) {
				const session = this.sessionsManagementService.getSession(URI.parse(unit.session));
				const chat = unit.chat ? session?.chats.get().find(chat => isEqual(chat.resource, URI.parse(unit.chat!))) : session?.mainChat.get();
				if (!session || !chat) {
					throw new Error(localize('gameSessionUnavailable', "The session is unavailable. Open it from the sidebar to reconnect."));
				}
				await this.ensureTrusted(session);
				await this.sessionsManagementService.sendBackgroundRequest(session, chat, { query });
			} else if (unit.parentId) {
				const parent = board.units.find(parent => parent.id === unit.parentId);
				const session = parent?.session ? this.sessionsManagementService.getSession(URI.parse(parent.session)) : undefined;
				if (!session || !session.capabilities.get().supportsMultipleChats || session.isArchived.get()) {
					throw new Error(localize('gameParentUnavailable', "The parent session cannot create a chat right now."));
				}
				await this.ensureTrusted(session);
				const chat = await this.sessionsManagementService.createNewChatInSession(session, { forceNew: true });
				if (!chat) {
					throw new Error(localize('gameChatUnavailable', "The provider could not create a child chat."));
				}
				this.updateUnit(unitId, { session: session.resource.toString(), chat: chat.resource.toString() });
				await this.sessionsManagementService.sendBackgroundRequest(session, chat, { query });
			} else {
				if (!board.folder) {
					throw new Error(localize('gameChooseWorkspace', "Choose a workspace in the command dock before dispatching."));
				}
				const session = await this.sessionsManagementService.createAndSendNewChatRequest(
					URI.parse(board.folder), { query, title: task?.title || unit.name },
					{ providerId: board.providerId, sessionTypeId: board.sessionTypeId },
				);
				if (!session) {
					throw new Error(localize('gameSendInterrupted', "Session creation was interrupted. Check the sessions list before retrying."));
				}
				this.updateUnit(unitId, { session: session.resource.toString() });
			}
			this.updateUnit(unitId, { draft: '' });
		} finally {
			const sending = new Set(this.sending.get());
			sending.delete(unitId);
			this.sending.set(sending, undefined);
		}
	}

	private async ensureTrusted(session: ISession): Promise<void> {
		const workspace = session.workspace.get();
		if (workspace?.requiresWorkspaceTrust) {
			for (const folder of workspace.folders) {
				if (!(await this.trustService.getUriTrustInfo(folder.workingDirectory)).trusted) {
					throw new Error(localize('gameUntrustedSession', "Open the session and trust its workspace before sending orders."));
				}
			}
		}
	}
}

registerSingleton(IGameService, GameService, InstantiationType.Delayed);
