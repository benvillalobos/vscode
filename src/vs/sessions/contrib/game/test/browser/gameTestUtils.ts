/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { constObservable, ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { IChatEntitlementService } from '../../../../../workbench/services/chat/common/chatEntitlementService.js';
import { ChatInteractivity, IChat, ISession, SessionStatus } from '../../../../services/sessions/common/session.js';
import { ICreateNewSessionOptions, ISendRequestOptions, ISessionsManagementService, NewSessionRequestOptions } from '../../../../services/sessions/common/sessionsManagement.js';
import { GameService } from '../../browser/gameService.js';

export function gameTestChat(id: string, interactivity = ChatInteractivity.Full): IChat {
	return new class extends mock<IChat>() {
		override readonly resource = URI.parse(`game-test:/chat/${id}`);
		override readonly title = constObservable(id);
		override readonly status = observableValue<SessionStatus>(this, SessionStatus.Completed);
		override readonly description = constObservable(undefined);
		override readonly changes = constObservable([]);
		override readonly isArchived = constObservable(false);
		override readonly interactivity = constObservable(interactivity);
	};
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
		override readonly capabilities = constObservable({ supportsMultipleChats: true });
		override readonly isArchived = constObservable(false);
		override readonly workspace = constObservable(undefined);
	};
}

export function createGameHarness(store: Pick<DisposableStore, 'add'>, storage = store.add(new InMemoryStorageService()), log: ILogService = new NullLogService()) {
	const sessions: ISession[] = [];
	const requests: { session?: ISession; chat?: IChat; folder?: URI; options: NewSessionRequestOptions; createOptions?: ICreateNewSessionOptions }[] = [];
	let fail = false;
	let trusted = true;
	let hidden = false;
	const management = new class extends mock<ISessionsManagementService>() {
		override readonly onDidChangeSessions = Event.None;
		override getSessions(): ISession[] { return sessions; }
		override getSession(resource: URI): ISession | undefined { return sessions.find(session => session.resource.toString() === resource.toString()); }
		override async createAndSendNewChatRequest(folder: URI, options: NewSessionRequestOptions, createOptions?: ICreateNewSessionOptions): Promise<ISession> {
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
		log));
	return {
		service, management, sessions, requests, storage,
		setFail: (value: boolean) => fail = value,
		setTrusted: (value: boolean) => trusted = value,
		setHidden: (value: boolean) => hidden = value,
	};
}
