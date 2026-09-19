/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, size } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { autorun, disposableObservableValue } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { AbstractChatView } from '../../../browser/parts/chatView.js';
import { IChatViewFactory } from '../../../services/chatView/browser/chatViewFactory.js';
import { ISessionContext, SessionContext } from '../../../services/sessions/browser/sessionContext.js';
import { VisibleSession } from '../../../services/sessions/browser/visibleSessions.js';
import { IChat, ISession } from '../../../services/sessions/common/session.js';
import { setActiveSessionContextKeys } from '../../../services/sessions/common/sessionContextKeys.js';
import { GameCustomViewFocusContext } from '../common/game.js';

export class GameChatSideBar extends Disposable {
	readonly element = $('.game-chat-sidebar');
	private readonly header = append(this.element, $('.game-chat-header'));
	private readonly title = append(this.header, $('.game-chat-title'));
	private readonly chatView: AbstractChatView;
	private readonly titleObserver = this._register(new MutableDisposable());
	private readonly session = this._register(disposableObservableValue<VisibleSession | undefined>(this, undefined));

	constructor(
		onClose: () => void,
		@IChatViewFactory chatViewFactory: IChatViewFactory,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IHoverService hoverService: IHoverService,
	) {
		super();
		this.element.setAttribute('role', 'complementary');
		this.element.setAttribute('aria-label', localize('gameChatSideBar', "Session chat"));
		const closeButton = this._register(new Button(this.header, { ...defaultButtonStyles, secondary: true }));
		closeButton.label = localize('gameCloseChat', "Close Chat");
		this._register(closeButton.onDidClick(onClose));
		const context = this._register(contextKeyService.createScoped(this.element));
		GameCustomViewFocusContext.bindTo(context).set(false);
		const instantiation = this._register(instantiationService.createChild(new ServiceCollection(
			[IContextKeyService, context],
			[ISessionContext, new SessionContext(this.session)],
		)));
		this._register(autorun(reader => setActiveSessionContextKeys(this.session.read(reader), context, reader)));
		this.chatView = this._register(chatViewFactory.createChatView(instantiation));
		this.element.appendChild(this.chatView.element);
		this.chatView.setVisible(true);
		this._register(hoverService.setupDelayedHover(this.title, () => ({ content: this.title.textContent ?? '' })));
	}

	setChat(session: ISession, chat: IChat): void {
		this.session.set(new VisibleSession(session, chat), undefined);
		this.chatView.setChat(chat, session.sessionId, session);
		this.titleObserver.value = autorun(reader => {
			this.title.textContent = chat.title.read(reader);
		});
	}

	layout(width: number, height: number): void {
		size(this.element, width, height);
		this.chatView.layout(this.element.clientWidth, Math.max(0, height - this.header.offsetHeight), 0, 0);
	}

	focus(): void {
		this.chatView.focus();
	}

	override dispose(): void {
		this.chatView.setVisible(false);
		super.dispose();
		this.element.remove();
	}
}
