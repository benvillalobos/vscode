/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { constObservable, observableValue } from '../../../../../base/common/observable.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { ComponentFixtureContext, createEditorServices, defineComponentFixture, defineThemedFixtureGroup, registerWorkbenchServices } from '../../../../../workbench/test/browser/componentFixtures/fixtureUtils.js';
import { fixtureResourceUri } from '../../../../../workbench/test/browser/componentFixtures/fixtureResourceLoader.js';
import { ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { ChatInteractivity, SessionStatus } from '../../../../services/sessions/common/session.js';
import { IGameService } from '../../browser/gameService.js';
import { GameWidget } from '../../browser/gameWidget.js';
import { createGameHarness, gameTestChat, gameTestChatModel, gameTestSession } from './gameTestUtils.js';

export default defineThemedFixtureGroup({ path: 'sessions/game/' }, {
	Worklands: defineComponentFixture({ render: ctx => renderGame(ctx, 1120) }),
	Compact: defineComponentFixture({ render: ctx => renderGame(ctx, 640) }),
	MultiSelection: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, false, 'group', 0.5) }),
	CompactMultiSelection: defineComponentFixture({ render: ctx => renderGame(ctx, 640, false, 'group', 0.5) }),
	ZoomedOut: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, false, 'unit', 0.5) }),
	ZoomedIn: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, false, 'task', 2) }),
	Minimized: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, true) }),
	Resting: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, false, 'resting') }),
	PetStates: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, false, 'pets', 0.5) }),
	Frustrated: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, false, 'context') }),
	Task: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, false, 'task') }),
	AssignmentZone: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, false, 'assignment') }),
	CompactAssignmentZone: defineComponentFixture({ render: ctx => renderGame(ctx, 640, false, 'assignment') }),
	EditTitle: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, false, 'title') }),
	EditDescription: defineComponentFixture({ render: ctx => renderGame(ctx, 1120, false, 'prompt') }),
	CompactEditDescription: defineComponentFixture({ render: ctx => renderGame(ctx, 640, false, 'prompt') }),
});

function renderGame(ctx: ComponentFixtureContext, width: number, minimized = false, selection: 'unit' | 'task' | 'title' | 'prompt' | 'assignment' | 'resting' | 'pets' | 'context' | 'group' = 'unit', zoom = 1): void {
	const harness = createGameHarness(ctx.disposableStore);
	const build = harness.service.addTask('Build the login screen', 'Implement the login screen with accessible form validation.');
	const investigate = harness.service.addTask('Investigate slow startup', 'Profile startup and identify the slowest operation.');
	harness.service.addTask('Review the changes', 'Review correctness, accessibility, and test coverage.');
	const session = gameTestSession('Interface builder');
	const worker = gameTestChat('Test writer', ChatInteractivity.ReadOnly);
	const workingStatus = observableValue<SessionStatus>('fixtureWorking', SessionStatus.Completed);
	const working = { ...session.mainChat.get(), status: workingStatus };
	harness.sessions.push({ ...session, mainChat: constObservable(working), chats: constObservable([working, worker]) });
	const builder = harness.service.recruit(harness.sessions[0]);
	harness.service.assign(builder, build);
	workingStatus.set(SessionStatus.InProgress, undefined);
	const needsInput = gameTestSession('Startup investigator');
	const waitingStatus = observableValue<SessionStatus>('fixtureWaiting', SessionStatus.Completed);
	harness.sessions.push({ ...needsInput, mainChat: constObservable({ ...needsInput.mainChat.get(), status: waitingStatus }) });
	harness.service.assign(harness.service.recruit(harness.sessions[1]), investigate);
	waitingStatus.set(SessionStatus.NeedsInput, undefined);
	harness.service.spawn();
	if (selection === 'context') {
		harness.chatModels.set([
			gameTestChatModel(working.resource, 650).model,
			gameTestChatModel(worker.resource, 800).model,
			gameTestChatModel(needsInput.mainChat.get().resource, 500).model,
		], undefined);
	}
	if (selection === 'resting') {
		workingStatus.set(SessionStatus.Completed, undefined);
	}
	if (selection === 'pets') {
		const resting = gameTestSession('Resting and available');
		harness.sessions.push(resting);
		harness.service.recruit(resting);
		const ready = gameTestSession('Ready for review');
		harness.sessions.push(ready);
		harness.service.recruit(ready);
	}
	if (minimized) {
		harness.service.toggleMinimize(build);
	}

	const instantiation = createEditorServices(ctx.disposableStore, {
		colorTheme: ctx.theme,
		additionalServices: reg => {
			registerWorkbenchServices(reg);
			reg.defineInstance(IGameService, harness.service);
			reg.defineInstance(IProductService, new class extends mock<IProductService>() {
				override readonly quality = 'stable';
			}());
			reg.defineInstance(ISessionsManagementService, harness.management);
			reg.defineInstance(ISessionsService, new class extends mock<ISessionsService>() { }());
			reg.defineInstance(ISessionsProvidersService, new class extends mock<ISessionsProvidersService>() { }());
			reg.defineInstance(IFileDialogService, new class extends mock<IFileDialogService>() { }());
			reg.defineInstance(IQuickInputService, new class extends mock<IQuickInputService>() { }());
		},
	});
	const widget = ctx.disposableStore.add(instantiation.createInstance(GameWidget, {
		petAssetRoot: fixtureResourceUri('src/vs/workbench/contrib/chat/browser/widget/media/chatPet'),
	}));
	ctx.container.style.width = `${width}px`;
	ctx.container.style.height = '680px';
	ctx.container.appendChild(widget.element);
	widget.layout(width, 680);
	if (zoom !== 1) {
		widget.element.querySelector<HTMLElement>('.game-map')!.dispatchEvent(new WheelEvent('wheel', {
			shiftKey: true, deltaY: -Math.log(zoom) / 0.002, bubbles: true, cancelable: true,
		}));
	}
	if (selection === 'group') {
		for (const blob of widget.element.querySelectorAll<HTMLElement>('.game-map .game-unit')) {
			blob.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		}
	} else {
		widget.element.querySelector<HTMLElement>(selection === 'unit' || selection === 'resting' || selection === 'pets' || selection === 'context' ? '.game-unit' : '.game-task')?.click();
	}
	if (selection === 'title' || selection === 'prompt') {
		widget.element.querySelector<HTMLElement>(selection === 'title' ? '.game-selection-name' : '.game-selection-description')?.click();
	}
	if (selection === 'assignment') {
		widget.element.querySelectorAll<HTMLElement>('.game-task')[1].classList.add('game-drop-target');
	}
}
