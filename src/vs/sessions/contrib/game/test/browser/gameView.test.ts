/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AccessibleViewRegistry } from '../../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { workbenchInstantiationService } from '../../../../../workbench/test/browser/workbenchTestServices.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { AbstractCustomView } from '../../../../services/customView/browser/customView.js';
import { CustomViewService } from '../../../../services/customView/browser/customViewService.js';
import { GameCustomViewContribution } from '../../browser/game.contribution.js';
import { GAME_CUSTOM_VIEW_ID } from '../../common/game.js';
import { IGameService } from '../../browser/gameService.js';
import { ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { createGameHarness, gameTestChatModel, gameTestSession } from './gameTestUtils.js';

suite('Sessions - Game custom view', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('accessible view describes context frustration and clears it after compaction', () => {
		const game = createGameHarness(disposables);
		const session = gameTestSession('Builder');
		game.sessions.push(session);
		game.service.recruit(session);
		const { model, usage } = gameTestChatModel(session.mainChat.get().resource, 650);
		game.chatModels.set([model], undefined);
		const instantiation = workbenchInstantiationService(undefined, disposables.add(new DisposableStore()));
		instantiation.stub(IGameService, game.service);
		const implementation = AccessibleViewRegistry.getImplementations().find(implementation => implementation.name === 'sessions-game-view')!;
		const provider = disposables.add(instantiation.invokeFunction(accessor => implementation.getProvider(accessor))!);
		const frustrated = provider.provideContent().includes('Frustrated: context window 65% full (above 50%).');
		usage.set({ kind: 'usage', promptTokens: 300, completionTokens: 0 }, undefined);
		assert.deepStrictEqual({
			frustrated, cleared: !provider.provideContent().includes('Frustrated'),
			compacted: provider.provideContent().includes('Context window 30% full.'), requests: game.requests,
		}, { frustrated: true, cleared: true, compacted: true, requests: [] });
	});

	test('registers the playable view with scoped accessibility help and restores it after reload', () => {
		const configuration = new TestConfigurationService();
		const storageService = disposables.add(new InMemoryStorageService());
		const service = disposables.add(new CustomViewService(new NullLogService(), storageService));
		disposables.add(new GameCustomViewContribution(service, configuration));
		service.showCustomView(GAME_CUSTOM_VIEW_ID);
		const descriptor = service.activeCustomView.get();
		assert.ok(descriptor);

		const instantiationService = workbenchInstantiationService(undefined, disposables.add(new DisposableStore()));
		const game = createGameHarness(disposables);
		instantiationService.stub(IGameService, game.service);
		instantiationService.stub(ISessionsManagementService, game.management);
		instantiationService.stub(ISessionsService, new class extends mock<ISessionsService>() { });
		const contextKeyService = disposables.add(new ContextKeyService(new TestConfigurationService()));
		instantiationService.stub(IContextKeyService, contextKeyService);
		const view = disposables.add(instantiationService.createInstance<AbstractCustomView>(descriptor.ctor));
		const container = $('.game-test-content');
		container.tabIndex = -1;
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		view.render(container);
		view.layout(800, 600);
		container.focus();

		const help = AccessibleViewRegistry.getImplementations().find(implementation => implementation.name === 'sessions-game-help');
		assert.ok(help?.when);
		const provider = instantiationService.invokeFunction(accessor => help.getProvider(accessor));
		assert.ok(provider);
		disposables.add(provider);
		container.blur();
		provider.onClose();

		const restoredService = disposables.add(new CustomViewService(new NullLogService(), storageService));
		const registration = disposables.add(new GameCustomViewContribution(restoredService, configuration));
		const restoredId = restoredService.activeCustomView.get()?.id;
		registration.dispose();

		assert.deepStrictEqual({
			title: view.title.get(),
			description: view.description.get(),
			hasWorld: !!container.querySelector('.game-world'),
			actions: descriptor.actions,
			helpInView: help.when.evaluate(contextKeyService.getContext(container)),
			helpOutsideView: help.when.evaluate(contextKeyService.getContext(mainWindow.document.body)),
			helpContent: provider.provideContent().includes('Movement never sends a request.'),
			focusRestored: mainWindow.document.activeElement === container,
			restoredId,
			afterUnregister: restoredService.activeCustomView.get(),
		}, {
			title: 'Game',
			description: undefined,
			hasWorld: true,
			actions: undefined,
			helpInView: true,
			helpOutsideView: false,
			helpContent: true,
			focusRestored: true,
			restoredId: GAME_CUSTOM_VIEW_ID,
			afterUnregister: undefined,
		});
	});
});
