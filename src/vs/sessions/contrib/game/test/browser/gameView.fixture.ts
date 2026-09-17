/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { constObservable, observableValue } from '../../../../../base/common/observable.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { ComponentFixtureContext, createEditorServices, defineComponentFixture, defineThemedFixtureGroup, registerWorkbenchServices } from '../../../../../workbench/test/browser/componentFixtures/fixtureUtils.js';
import { ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { ChatInteractivity, SessionStatus } from '../../../../services/sessions/common/session.js';
import { IGameService } from '../../browser/gameService.js';
import { GameWidget } from '../../browser/gameWidget.js';
import { createGameHarness, gameTestChat, gameTestSession } from './gameTestUtils.js';

export default defineThemedFixtureGroup({ path: 'sessions/game/' }, {
	Worklands: defineComponentFixture({ render: ctx => renderGame(ctx, 1120) }),
	Compact: defineComponentFixture({ render: ctx => renderGame(ctx, 640) }),
});

function renderGame(ctx: ComponentFixtureContext, width: number): void {
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

	const instantiation = createEditorServices(ctx.disposableStore, {
		colorTheme: ctx.theme,
		additionalServices: reg => {
			registerWorkbenchServices(reg);
			reg.defineInstance(IGameService, harness.service);
			reg.defineInstance(ISessionsManagementService, harness.management);
			reg.defineInstance(ISessionsService, new class extends mock<ISessionsService>() { }());
			reg.defineInstance(IFileDialogService, new class extends mock<IFileDialogService>() { }());
			reg.defineInstance(IQuickInputService, new class extends mock<IQuickInputService>() { }());
		},
	});
	const widget = ctx.disposableStore.add(instantiation.createInstance(GameWidget));
	ctx.container.style.width = `${width}px`;
	ctx.container.style.height = '680px';
	ctx.container.appendChild(widget.element);
	widget.layout(width, 680);
	widget.element.querySelectorAll<HTMLElement>('.game-unit')[0]?.click();
}
