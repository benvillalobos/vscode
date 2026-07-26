/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkdownString } from '../../../../base/common/htmlContent.js';
import { observableValue, constObservable, IObservable } from '../../../../base/common/observable.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ChatInteractivity, IChat, IChatCheckpoints, ISessionCapabilities, ISessionChangeset, ISessionFileChange, ISessionWorkspace, SessionStatus } from '../../../services/sessions/common/session.js';
import { IActiveSession } from '../../../services/sessions/common/sessionsManagement.js';

/**
 * A lightweight session shim for the automation dialog.
 * Does not create a real session or touch global session state.
 */
export class AutomationInputSession implements IActiveSession {
	readonly sessionId: string;
	readonly resource: URI;
	readonly icon = Codicon.sparkle;
	readonly createdAt = new Date();

	private readonly _providerId = observableValue<string>('automationInputSession.providerId', '');
	private readonly _sessionType = observableValue<string>('automationInputSession.sessionType', '');
	private readonly _modelId = observableValue<string | undefined>('automationInputSession.modelId', undefined);
	private readonly _workspace = observableValue<ISessionWorkspace | undefined>('automationInputSession.workspace', undefined);
	private readonly _mode = observableValue<{ readonly id: string; readonly kind: string } | undefined>('automationInputSession.mode', undefined);
	private readonly _isQuickChat = observableValue('automationInputSession.isQuickChat', false);

	get providerId(): string { return this._providerId.get(); }
	get sessionType(): string { return this._sessionType.get(); }

	readonly modelId: IObservable<string | undefined> = this._modelId;
	readonly workspace: IObservable<ISessionWorkspace | undefined> = this._workspace;
	readonly mode: IObservable<{ readonly id: string; readonly kind: string } | undefined> = this._mode;
	readonly isQuickChat: IObservable<boolean> = this._isQuickChat;

	readonly status = constObservable(SessionStatus.Untitled);
	readonly loading = constObservable(false);
	readonly title = constObservable(localize('automationInputSession.title', "Automation"));
	readonly updatedAt = constObservable(new Date());
	readonly isArchived = constObservable(false);
	readonly isRead = constObservable(true);
	readonly description: IObservable<IMarkdownString | undefined> = constObservable(undefined);
	readonly lastTurnEnd = constObservable<Date | undefined>(undefined);
	readonly changes: IObservable<readonly ISessionFileChange[]> = constObservable([]);
	readonly changesets: IObservable<readonly ISessionChangeset[] | undefined> = constObservable(undefined);
	readonly capabilities: IObservable<ISessionCapabilities> = constObservable({
		supportsMultipleChats: false,
		supportsFork: false,
		supportsSideChat: false,
		supportsRename: false,
		supportsDelete: false,
	});

	readonly activeChat: IObservable<IChat>;
	readonly isCreated = constObservable(false);
	readonly sticky = constObservable(false);
	readonly openChats: IObservable<readonly IChat[]>;
	readonly closedChats: IObservable<readonly IChat[]> = constObservable([]);
	readonly lastClosedChat: IChat | undefined = undefined;
	readonly visibleChatTabs: IObservable<readonly IChat[]>;
	readonly shouldShowChatTabs = constObservable(false);
	readonly chats: IObservable<readonly IChat[]>;
	readonly mainChat: IObservable<IChat>;

	constructor() {
		this.sessionId = `automation-input-${Date.now()}`;
		this.resource = URI.from({ scheme: 'automation-input', path: this.sessionId });

		const stubChat: IChat = {
			resource: URI.from({ scheme: 'automation-input', path: `${this.sessionId}/chat` }),
			createdAt: this.createdAt,
			title: constObservable(''),
			updatedAt: constObservable(this.createdAt),
			status: constObservable(SessionStatus.Untitled),
			changes: constObservable([]),
			checkpoints: constObservable<IChatCheckpoints | undefined>(undefined),
			modelId: this.modelId,
			mode: this.mode,
			isArchived: this.isArchived,
			isRead: this.isRead,
			interactivity: constObservable(ChatInteractivity.Full),
			description: this.description,
			lastTurnEnd: this.lastTurnEnd,
		};

		this.mainChat = constObservable(stubChat);
		this.activeChat = this.mainChat;
		this.chats = constObservable([stubChat]);
		this.openChats = this.chats;
		this.visibleChatTabs = this.chats;
	}

	setProviderId(id: string): void {
		this._providerId.set(id, undefined);
	}

	setSessionType(type: string): void {
		this._sessionType.set(type, undefined);
	}

	setModelId(id: string | undefined): void {
		this._modelId.set(id, undefined);
	}

	setMode(mode: { readonly id: string; readonly kind: string } | undefined): void {
		this._mode.set(mode, undefined);
	}

	setWorkspace(workspace: ISessionWorkspace | undefined): void {
		this._workspace.set(workspace, undefined);
	}

	setQuickChat(isQuickChat: boolean): void {
		this._isQuickChat.set(isQuickChat, undefined);
	}
}
