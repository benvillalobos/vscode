/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../../workbench/test/browser/workbenchTestServices.js';
import { ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { IGameService } from '../../browser/gameService.js';
import { GameWidget } from '../../browser/gameWidget.js';
import { createGameHarness } from './gameTestUtils.js';

suite('Sessions - Game widget', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('spawn, keyboard movement, task assignment, draft editing, and compact layout never send until dispatch', async () => {
		const harness = createGameHarness(store);
		const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
		instantiation.stub(IGameService, harness.service);
		instantiation.stub(ISessionsManagementService, harness.management);
		instantiation.stub(ISessionsService, new class extends mock<ISessionsService>() { });
		const widget = store.add(instantiation.createInstance(GameWidget));
		document.body.appendChild(widget.element);
		store.add(toDisposable(() => widget.element.remove()));
		widget.element.style.width = '1000px';
		widget.layout(1000, 620);
		const taskId = harness.service.addTask('Fix search', 'Fix the search bug');
		const spawn = widget.element.querySelector<HTMLElement>('.game-spawn');
		assert.ok(spawn);
		spawn.click();
		await timeout(0);
		const blob = widget.element.querySelector<HTMLElement>('.game-unit');
		assert.ok(blob);
		const before = harness.service.board.get().units[0].x;
		blob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		await timeout(0);
		const moved = harness.service.board.get().units[0].x;
		widget.element.querySelector<HTMLElement>('.game-task')!.click();
		await timeout(0);
		const input = widget.element.querySelector<HTMLTextAreaElement>('textarea');
		assert.ok(input);
		input.value = 'Include a regression test';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		const unit = harness.service.board.get().units[0];
		widget.element.style.width = '600px';
		widget.layout(600, 620);
		assert.deepStrictEqual({
			units: harness.service.board.get().units.length,
			movement: moved - before,
			task: unit.taskId, draft: unit.draft,
			tethers: widget.element.querySelectorAll('.game-tether').length,
			compact: widget.element.classList.contains('game-compact'),
			requests: harness.requests,
		}, {
			units: 1, movement: 3, task: taskId, draft: 'Include a regression test',
			tethers: 1, compact: true, requests: [],
		});
	});
});
