/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { constObservable, ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { hasKey } from '../../../../../base/common/types.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { IChatEntitlementService } from '../../../../../workbench/services/chat/common/chatEntitlementService.js';
import { IChatService, IChatUsage } from '../../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { ILanguageModelChatMetadata, ILanguageModelsService } from '../../../../../workbench/contrib/chat/common/languageModels.js';
import { IChatModel, IChatModelInputState, IChatRequestModel, IChatResponseModel, IInputModel } from '../../../../../workbench/contrib/chat/common/model/chatModel.js';
import { ChatInteractivity, IChat, ISession, SessionStatus } from '../../../../services/sessions/common/session.js';
import { ICreateNewSessionOptions, ISendRequestOptions, ISessionsManagementService, NewSessionRequestOptions } from '../../../../services/sessions/common/sessionsManagement.js';
import { GameService } from '../../browser/gameService.js';

export function gameTestChat(id: string, interactivity = ChatInteractivity.Full) {
	return new class extends mock<IChat>() {
		override readonly resource = URI.parse(`game-test:/chat/${id}`);
		override readonly title = constObservable(id);
		override readonly status = observableValue<SessionStatus>(this, SessionStatus.Completed);
		override readonly updatedAt = observableValue(this, new Date('2026-09-01T12:00:00Z'));
		override readonly lastTurnEnd = observableValue<Date | undefined>(this, new Date('2026-09-01T12:00:00Z'));
		override readonly description = constObservable(undefined);
		override readonly modelId = observableValue<string | undefined>(this, undefined);
		override readonly changes = constObservable([]);
		override readonly isArchived = constObservable(false);
		override readonly interactivity = constObservable(interactivity);
	};
}

export function gameTestChatModel(resource: URI, promptTokens = 0, completionTokens = 0) {
	const usage = observableValue<IChatUsage | undefined>('gameTestUsage', { kind: 'usage', promptTokens, completionTokens });
	const inputState = observableValue<IChatModelInputState | undefined>('gameTestInput', undefined);
	const request = new class extends mock<IChatRequestModel>() {
		override readonly modelId = 'test-model';
		override readonly response = new class extends mock<IChatResponseModel>() {
			override readonly usageObs = usage;
		};
	};
	const model = new class extends mock<IChatModel>() {
		override readonly sessionResource = resource;
		override readonly lastRequestObs = observableValue<IChatRequestModel | undefined>(this, request);
		override readonly inputModel = new class extends mock<IInputModel>() {
			override readonly state = inputState;
		};
		readonly requests = [request];
		override getRequests(): IChatRequestModel[] { return this.requests; }
	};
	return { model, usage, inputState };
}

export function gameTestSession(id: string): ISession & { readonly chats: ISettableObservable<readonly IChat[]> } {
	const chat = gameTestChat(id);
	return new class extends mock<ISession>() {
		override readonly resource = URI.parse(`game-test:/session/${id}`);
		override readonly title = constObservable(id);
		override readonly sessionId = id;
		override readonly providerId = 'test';
		override readonly sessionType = 'test';
		override readonly mainChat = constObservable(chat);
		override readonly chats = observableValue<readonly IChat[]>(this, [chat]);
		override readonly capabilities = constObservable({ supportsMultipleChats: true, supportsDelete: true });
		override readonly isArchived = constObservable(false);
		override readonly workspace = constObservable(undefined);
	};
}

export function createGameHarness(store: Pick<DisposableStore, 'add'>, storage = store.add(new InMemoryStorageService()), log: ILogService = new NullLogService()) {
	const sessions: ISession[] = [];
	const archived = store.add(new Emitter<ISession>());
	const deleted = store.add(new Emitter<ISession>());
	const chatDeleted = store.add(new Emitter<ISession>());
	const chatModels = observableValue<readonly IChatModel[]>('gameTestModels', []);
	const modelChanges = store.add(new Emitter<string>());
	const models = new Map<string, ILanguageModelChatMetadata>([['test-model', new class extends mock<ILanguageModelChatMetadata>() {
		override readonly maxInputTokens = 800;
		override readonly maxOutputTokens = 200;
	}]]);
	const chatService = new class extends mock<IChatService>() {
		override readonly chatModels = chatModels;
	};
	const languageModels = new class extends mock<ILanguageModelsService>() {
		override readonly onDidChangeLanguageModels = modelChanges.event;
		override lookupLanguageModel(id: string): ILanguageModelChatMetadata | undefined { return models.get(id); }
		override getModelConfiguration() { return undefined; }
	};
	const requests: { session?: ISession; chat?: IChat; folder?: URI; options: ISendRequestOptions; createOptions?: ICreateNewSessionOptions }[] = [];
	const chatDeletions: { session: ISession; chat: URI }[] = [];
	let fail = false;
	let trusted = true;
	let hidden = false;
	const management = new class extends mock<ISessionsManagementService>() {
		override readonly onDidChangeSessions = Event.None;
		override readonly onDidArchiveSession = archived.event;
		override readonly onDidDeleteSession = deleted.event;
		override readonly onDidDeleteChat = chatDeleted.event;
		override getSessions(): ISession[] { return sessions; }
		override getSession(resource: URI): ISession | undefined { return sessions.find(session => session.resource.toString() === resource.toString()); }
		override async deleteChat(session: ISession, chat: URI): Promise<void> {
			chatDeletions.push({ session, chat });
		}
		override async createAndSendNewChatRequest(folder: URI, options: NewSessionRequestOptions, createOptions?: ICreateNewSessionOptions): Promise<ISession> {
			if (!hasKey(options, { query: true })) {
				throw new Error('Game requests must include their orders immediately');
			}
			requests.push({ folder, options, createOptions });
			if (fail) {
				throw new Error('Provider unavailable');
			}
			const session = gameTestSession(`session-${sessions.length}`);
			sessions.push(session);
			return session;
		}
		override async sendBackgroundRequest(session: ISession, chat: IChat, options: ISendRequestOptions): Promise<void> {
			requests.push({ session, chat, options });
			if (fail) {
				throw new Error('Provider unavailable');
			}
		}
		override async createNewChatInSession(session: ISession): Promise<IChat> {
			const chat = gameTestChat(`child-${session.chats.get().length}`);
			const found = sessions.find(candidate => candidate === session);
			if (found && 'set' in found.chats && typeof found.chats.set === 'function') {
				found.chats.set([...session.chats.get(), chat], undefined);
			}
			return chat;
		}
	};
	const service = store.add(new GameService(storage, management,
		new class extends mock<IWorkspaceTrustManagementService>() { override isWorkspaceTrusted(): boolean { return trusted; } },
		new class extends mock<IChatEntitlementService>() { override get sentiment() { return { hidden }; } },
		log, chatService, languageModels));
	return {
		service, management, sessions, requests, chatDeletions, storage, archived, deleted, chatDeleted, chatModels, models, modelChanges,
		setFail: (value: boolean) => fail = value,
		setTrusted: (value: boolean) => trusted = value,
		setHidden: (value: boolean) => hidden = value,
	};
}
