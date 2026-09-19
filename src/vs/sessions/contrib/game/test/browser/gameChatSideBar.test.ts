/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { workbenchInstantiationService } from '../../../../../workbench/test/browser/workbenchTestServices.js';
import { AbstractChatView } from '../../../../browser/parts/chatView.js';
import { CustomViewNode } from '../../../../browser/parts/customViewNode.js';
import { IChatViewFactory } from '../../../../services/chatView/browser/chatViewFactory.js';
import { CustomViewService } from '../../../../services/customView/browser/customViewService.js';
import { ISessionContext } from '../../../../services/sessions/browser/sessionContext.js';
import { IChat, ISession, SessionStatus } from '../../../../services/sessions/common/session.js';
import { ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { IGameService } from '../../browser/gameService.js';
import { GameWidget } from '../../browser/gameWidget.js';
import { GameCustomViewContribution } from '../../browser/game.contribution.js';
import { GAME_CUSTOM_VIEW_ID, GameCustomViewFocusContext } from '../../common/game.js';
import { createGameHarness, gameTestChat, gameTestSession } from './gameTestUtils.js';

suite('Sessions - Game chat sidebar', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function sessionWithContext(id: string) {
		return {
			...gameTestSession(id),
			status: constObservable(SessionStatus.Completed),
			isRead: constObservable(true),
			changes: constObservable([]),
			changesets: constObservable([]),
		};
	}

	function createHarness(customView = false) {
		const game = createGameHarness(store);
		const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
		const opened: { session: string | undefined; chat: string }[] = [];
		const scopedTargets: { session: string | undefined; chat: string | undefined; gameHelp: boolean | undefined }[] = [];
		const errors: string[] = [];
		let created = 0;
		let disposed = 0;
		instantiation.stub(IGameService, game.service);
		instantiation.stub(ISessionsManagementService, game.management);
		instantiation.stub(INotificationService, new class extends mock<INotificationService>() {
			override error(message: string | Error): void { errors.push(String(message)); }
		});
		instantiation.stub(IQuickInputService, new class extends mock<IQuickInputService>() {
			override async input(): Promise<string> { return 'Renamed blob'; }
		});
		instantiation.stub(IChatViewFactory, new class extends mock<IChatViewFactory>() {
			override createChatView(instantiationService?: IInstantiationService): AbstractChatView {
				assert.ok(instantiationService);
				const sessionContext = instantiationService.invokeFunction(accessor => accessor.get(ISessionContext));
				const contextKeys = instantiationService.invokeFunction(accessor => accessor.get(IContextKeyService));
				created++;
				return new class extends AbstractChatView {
					override readonly kind = 'chat';
					override setChat(chat: IChat, _historyKey?: string, session?: ISession): void {
						opened.push({ session: session?.sessionId, chat: chat.resource.toString() });
						scopedTargets.push({
							session: sessionContext.session.get()?.sessionId,
							chat: sessionContext.session.get()?.activeChat.get().resource.toString(),
							gameHelp: contextKeys.getContextKeyValue(GameCustomViewFocusContext.key),
						});
						this.element.textContent = chat.title.get();
					}
					override focus(): void {
						this.element.tabIndex = 0;
						this.element.focus();
					}
					protected override doLayout(): void { }
					override toJSON(): object { return {}; }
					override dispose(): void {
						disposed++;
						super.dispose();
					}
				};
			}
		});
		let widget: GameWidget | CustomViewNode;
		if (customView) {
			const service = store.add(new CustomViewService(new NullLogService(), store.add(new InMemoryStorageService())));
			store.add(new GameCustomViewContribution(service, new TestConfigurationService()));
			service.showCustomView(GAME_CUSTOM_VIEW_ID);
			const descriptor = service.activeCustomView.get();
			assert.ok(descriptor);
			widget = store.add(instantiation.createInstance(CustomViewNode, descriptor));
		} else {
			widget = store.add(instantiation.createInstance(GameWidget, {}));
		}
		document.body.appendChild(widget.element);
		store.add(toDisposable(() => widget.element.remove()));
		widget.element.style.width = '1000px';
		widget.element.style.height = '620px';
		widget.layout(1000, 620);
		return { ...game, widget, opened, scopedTargets, errors, created: () => created, disposed: () => disposed };
	}

	test('chat stays inside the padded custom view when opening and resizing the window', async () => {
		const harness = createHarness(true);
		harness.widget.element.style.setProperty('--vscode-strokeThickness', '1px');
		harness.widget.element.style.setProperty('--vscode-panel-border', '#888');
		const gameFitsBeforeOpeningChat = harness.widget.element.querySelector('.game-world')!.getBoundingClientRect().right
			<= harness.widget.element.querySelector('.game-layout')!.getBoundingClientRect().right;
		const session = sessionWithContext('session');
		harness.sessions.push(session);
		harness.service.recruit(session);
		harness.widget.element.querySelector('.game-unit')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await timeout(0);
		const measurements = [1000, 800, 640, 600, 500, 1000].map(width => {
			harness.widget.element.style.width = `${width}px`;
			harness.widget.layout(width, 620);
			const container = harness.widget.element.querySelector('.game-layout')!.getBoundingClientRect();
			const sidebar = harness.widget.element.querySelector<HTMLElement>('.game-chat-sidebar')!;
			const chat = sidebar.querySelector('.chat-view')!.getBoundingClientRect();
			return {
				width,
				gameFits: harness.widget.element.querySelector('.game-world')!.getBoundingClientRect().right <= container.right,
				paneFits: sidebar.getBoundingClientRect().right <= container.right,
				chatFits: chat.right <= sidebar.getBoundingClientRect().right,
				chatVisible: chat.width > 0,
			};
		});
		assert.deepStrictEqual({ gameFitsBeforeOpeningChat, measurements }, {
			gameFitsBeforeOpeningChat: true,
			measurements: [1000, 800, 640, 600, 500, 1000].map(width => ({
				width, gameFits: true, paneFits: true, chatFits: true, chatVisible: true,
			})),
		});
	});

	test('double-click opens the targeted main or child chat beside the map and reuses the pane', async () => {
		const harness = createHarness();
		const first = sessionWithContext('first');
		const second = sessionWithContext('second');
		const child = gameTestChat('child');
		second.chats.set([...second.chats.get(), child], undefined);
		harness.sessions.push(first, second);
		harness.service.recruit(first);
		harness.service.recruit(second);
		const blobs = harness.widget.element.querySelectorAll<HTMLElement>('.game-unit');
		blobs[0].click();
		const openedOnSingleClick = harness.opened.length;
		for (const blob of [blobs[1], blobs[2], blobs[2]]) {
			blob.querySelector('.game-unit-art')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
			await timeout(0);
		}
		const world = harness.widget.element.querySelector<HTMLElement>('.game-world')!;
		const sidebar = harness.widget.element.querySelector<HTMLElement>('.game-chat-sidebar')!;
		const worldBounds = world.getBoundingClientRect();
		const sidebarBounds = sidebar.getBoundingClientRect();
		assert.deepStrictEqual({
			openedOnSingleClick, opened: harness.opened,
			scopedTargets: harness.scopedTargets,
			created: harness.created(), disposed: harness.disposed(),
			alongside: worldBounds.width > 0 && sidebarBounds.width > 0 && worldBounds.right <= sidebarBounds.left,
			chatFocused: document.activeElement === sidebar.querySelector('.chat-view'),
			title: sidebar.querySelector('.game-chat-title')!.textContent,
			requests: harness.requests, errors: harness.errors,
		}, {
			openedOnSingleClick: 0,
			opened: [
				{ session: 'second', chat: second.mainChat.get().resource.toString() },
				{ session: 'second', chat: child.resource.toString() },
				{ session: 'second', chat: child.resource.toString() },
			],
			scopedTargets: [
				{ session: 'second', chat: second.mainChat.get().resource.toString(), gameHelp: false },
				{ session: 'second', chat: child.resource.toString(), gameHelp: false },
				{ session: 'second', chat: child.resource.toString(), gameHelp: false },
			],
			created: 1, disposed: 0, alongside: true, chatFocused: true, title: 'child',
			requests: [], errors: [],
		});
	});

	test('keyboard Open Chat opens the pane and Close Chat disposes it and restores map focus and width', async () => {
		const harness = createHarness();
		const session = sessionWithContext('session');
		harness.sessions.push(session);
		harness.service.recruit(session);
		const blob = harness.widget.element.querySelector<HTMLElement>('.game-unit')!;
		blob.click();
		const open = [...harness.widget.element.querySelectorAll<HTMLElement>('.game-unit-actions .monaco-button')].find(button => button.textContent?.includes('Open Chat'))!;
		open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
		await timeout(0);
		harness.widget.element.querySelector<HTMLElement>('.game-chat-header .monaco-button')!.click();
		assert.deepStrictEqual({
			opened: harness.opened, disposed: harness.disposed(),
			sidebar: !!harness.widget.element.querySelector('.game-chat-sidebar'),
			focused: document.activeElement === blob,
			width: harness.widget.element.querySelector('.game-world')!.getBoundingClientRect().width,
			requests: harness.requests,
		}, {
			opened: [{ session: 'session', chat: session.mainChat.get().resource.toString() }],
			disposed: 1, sidebar: false, focused: true, width: 1000, requests: [],
		});
	});

	test('draft double-click does not open a chat and name double-click still renames', async () => {
		const harness = createHarness();
		const id = harness.service.spawn();
		const blob = harness.widget.element.querySelector<HTMLElement>('.game-unit')!;
		blob.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await timeout(0);
		blob.querySelector('.game-node-label')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await timeout(0);
		assert.deepStrictEqual({
			name: harness.service.board.get().units.find(unit => unit.id === id)?.name,
			created: harness.created(), opened: harness.opened, requests: harness.requests, errors: harness.errors,
		}, { name: 'Renamed blob', created: 0, opened: [], requests: [], errors: [] });
	});

	test('opening an unavailable session reports an error instead of creating a chat', async () => {
		const harness = createHarness();
		const session = gameTestSession('session');
		harness.sessions.push(session);
		harness.service.recruit(session);
		harness.sessions.splice(0);
		harness.widget.element.querySelector('.game-unit')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await timeout(0);
		assert.deepStrictEqual({
			created: harness.created(), opened: harness.opened, requests: harness.requests, errors: harness.errors,
		}, {
			created: 0, opened: [], requests: [],
			errors: ['This session is unavailable. Reconnect its provider first.'],
		});
	});
});
