/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AccessibleViewRegistry } from '../../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { AbstractCustomView } from '../../../../services/customView/browser/customView.js';
import { CustomViewService } from '../../../../services/customView/browser/customViewService.js';
import { GameCustomViewContribution } from '../../browser/game.contribution.js';
import { GAME_CUSTOM_VIEW_ID } from '../../common/game.js';

suite('Sessions - Game custom view', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('registers an empty view with scoped accessibility help and restores it after reload', () => {
		const storageService = disposables.add(new InMemoryStorageService());
		const service = disposables.add(new CustomViewService(new NullLogService(), storageService));
		disposables.add(new GameCustomViewContribution(service));
		service.showCustomView(GAME_CUSTOM_VIEW_ID);
		const descriptor = service.activeCustomView.get();
		assert.ok(descriptor);

		const instantiationService = disposables.add(new TestInstantiationService());
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
		const registration = disposables.add(new GameCustomViewContribution(restoredService));
		const restoredId = restoredService.activeCustomView.get()?.id;
		registration.dispose();

		assert.deepStrictEqual({
			title: view.title.get(),
			description: view.description.get(),
			content: container.innerHTML,
			actions: descriptor.actions,
			helpInView: help.when.evaluate(contextKeyService.getContext(container)),
			helpOutsideView: help.when.evaluate(contextKeyService.getContext(mainWindow.document.body)),
			helpContent: provider.provideContent(),
			focusRestored: mainWindow.document.activeElement === container,
			restoredId,
			afterUnregister: restoredService.activeCustomView.get(),
		}, {
			title: 'Game',
			description: undefined,
			content: '',
			actions: undefined,
			helpInView: true,
			helpOutsideView: false,
			helpContent: 'You are in the Game view. This view is currently empty. Open a session from the primary sidebar to return to your chats.',
			focusRestored: true,
			restoredId: GAME_CUSTOM_VIEW_ID,
			afterUnregister: undefined,
		});
	});
});
