/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { autorun, constObservable, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatInteractivity, IChat, SessionStatus } from '../../../../services/sessions/common/session.js';
import { clampGamePoint, emptyGameBoard, isGameBoard, nearestGameTask } from '../../common/gameBoard.js';
import { createGameHarness, gameTestChat, gameTestSession } from './gameTestUtils.js';

suite('Sessions - Game service', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const folder = URI.file('C:\\work\\project');

	test('spawning and moving only changes the local map; proximity assigns and leaving clears', () => {
		const { service, requests } = createGameHarness(store);
		const taskId = service.addTask('Build', 'Build and test the feature');
		const unitId = service.spawn();
		const task = service.board.get().tasks[0];
		service.move(unitId, { x: task.x + 5, y: task.y });
		const assigned = service.board.get().units[0].taskId;
		service.move(unitId, { x: 95, y: 95 });
		assert.deepStrictEqual({
			assigned, released: service.board.get().units[0].taskId,
			position: { x: service.board.get().units[0].x, y: service.board.get().units[0].y },
			requests,
		}, { assigned: taskId, released: undefined, position: { x: 94, y: 88 }, requests: [] });
	});

	test('dispatch creates a real session once, preserves identity for follow-ups, and does not override permissions', async () => {
		const { service, requests } = createGameHarness(store);
		service.setTarget(folder, 'test', 'test');
		const taskId = service.addTask('Build', 'Build the feature');
		const id = service.spawn();
		service.assign(id, taskId);
		service.setDraft(id, 'Add tests');
		await service.dispatch(id);
		const session = service.board.get().units[0].session;
		service.setDraft(id, 'Review the result');
		await service.dispatch(id);
		assert.deepStrictEqual({
			count: requests.length,
			first: requests[0].options,
			target: requests[0].createOptions,
			second: requests[1].options,
			session: requests[1].session?.resource.toString(),
			draft: service.board.get().units[0].draft,
		}, {
			count: 2,
			first: { query: 'Build the feature\n\nAdd tests', title: 'Build' },
			target: { providerId: 'test', sessionTypeId: 'test' },
			second: { query: 'Build the feature\n\nReview the result' },
			session, draft: '',
		});
	});

	test('a failed send preserves orders and never creates a successful-looking unit', async () => {
		const harness = createGameHarness(store);
		harness.service.setTarget(folder, 'test', 'test');
		const id = harness.service.spawn();
		harness.service.setDraft(id, 'Do work');
		harness.setFail(true);
		await assert.rejects(harness.service.dispatch(id), /Provider unavailable/);
		assert.deepStrictEqual({
			session: harness.service.board.get().units[0].session,
			draft: harness.service.board.get().units[0].draft,
			status: harness.service.units.get()[0].status,
		}, { session: undefined, draft: 'Do work', status: 'ready' });
	});

	test('blocks duplicate dispatch while a send is in flight', async () => {
		const { service, requests } = createGameHarness(store);
		service.setTarget(folder, 'test', 'test');
		const id = service.spawn();
		service.setDraft(id, 'Do work');
		const first = service.dispatch(id);
		await assert.rejects(service.dispatch(id));
		await first;
		assert.strictEqual(requests.length, 1);
	});

	test('requires a workspace, AI enablement, and trust before any new request', async () => {
		const harness = createGameHarness(store);
		const id = harness.service.spawn();
		harness.service.setDraft(id, 'Do work');
		await assert.rejects(harness.service.dispatch(id), /Choose a workspace/);
		harness.service.setTarget(folder, 'test', 'test');
		harness.setTrusted(false);
		await assert.rejects(harness.service.dispatch(id), /trust/);
		harness.setTrusted(true);
		harness.setHidden(true);
		await assert.rejects(harness.service.dispatch(id), /Enable AI/);
		assert.deepStrictEqual(harness.requests, []);
	});

	test('restores coordinates, assignments, and unsent orders without dispatching', () => {
		const { service, storage } = createGameHarness(store);
		const task = service.addTask('Test', 'Run the tests');
		const unit = service.spawn();
		service.assign(unit, task);
		service.setDraft(unit, 'Focus on regression coverage');
		service.move(task, { x: 60, y: 40 });
		const restored = createGameHarness(store, storage);
		assert.deepStrictEqual({ board: JSON.stringify(restored.service.board.get()), requests: restored.requests }, { board: JSON.stringify(service.board.get()), requests: [] });
	});

	test('observes real child chats, filters hidden workers, and blocks read-only or running units', async () => {
		const harness = createGameHarness(store);
		const base = gameTestSession('lead');
		const status = observableValue<SessionStatus>('chatStatus', SessionStatus.Completed);
		const main = { ...gameTestChat('main'), status };
		const chats = observableValue<readonly IChat[]>('chats', [main]);
		const session = { ...base, mainChat: constObservable(main), chats };
		harness.sessions.push(session);
		const id = harness.service.recruit(session);
		store.add(autorun(reader => harness.service.units.read(reader)));
		chats.set([main, gameTestChat('worker', ChatInteractivity.ReadOnly), gameTestChat('hidden', ChatInteractivity.Hidden)], undefined);
		const units = harness.service.units.get();
		status.set(SessionStatus.InProgress, undefined);
		harness.service.setDraft(id, 'More work');
		await assert.rejects(harness.service.dispatch(id));
		assert.throws(() => harness.service.move(id, { x: 50, y: 50 }), /busy/);
		assert.deepStrictEqual(units.map(unit => ({ name: unit.name, parent: !!unit.parentId, readOnly: unit.readOnly })), [
			{ name: 'main', parent: false, readOnly: false },
			{ name: 'worker', parent: true, readOnly: true },
		]);
	});

	test('new child recruits keep their parent and share task assignment', () => {
		const harness = createGameHarness(store);
		const session = gameTestSession('parent');
		harness.sessions.push(session);
		const parent = harness.service.recruit(session);
		const task = harness.service.addTask('Work', 'Do work');
		harness.service.assign(parent, task);
		const child = harness.service.spawn(parent);
		const before = harness.service.board.get().units.find(unit => unit.id === child)!;
		harness.service.move(task, { x: 50, y: 50 });
		const after = harness.service.board.get().units.find(unit => unit.id === child)!;
		harness.service.remove(parent);
		assert.deepStrictEqual({
			parent: before.parentId, task: before.taskId,
			moved: before.x !== after.x,
			mapUnits: harness.service.board.get().units.length,
			realSessions: harness.sessions.length,
		}, { parent, task, moved: true, mapUnits: 0, realSessions: 1 });
	});

	test('child dispatch targets the created chat and preserves it on send failure for retry', async () => {
		const harness = createGameHarness(store);
		harness.sessions.push(gameTestSession('parent'));
		const parent = harness.service.recruit(harness.sessions[0]);
		const child = harness.service.spawn(parent);
		harness.service.setDraft(child, 'Write tests');
		harness.setFail(true);
		await assert.rejects(harness.service.dispatch(child), /Provider unavailable/);
		const childChat = harness.service.board.get().units.find(unit => unit.id === child)?.chat;
		harness.setFail(false);
		await harness.service.dispatch(child);
		assert.deepStrictEqual({
			chatCount: harness.sessions[0].chats.get().length,
			targets: harness.requests.map(request => request.chat?.resource.toString()),
			draft: harness.service.board.get().units.find(unit => unit.id === child)?.draft,
		}, { chatCount: 2, targets: [childChat, childChat], draft: '' });
	});

	test('real child sessions appear under their creator and removed sessions are not recreated', async () => {
		const harness = createGameHarness(store);
		const parentSession = gameTestSession('parent');
		const childSession = { ...gameTestSession('child'), createdBySession: constObservable({ session: parentSession.resource }) };
		harness.sessions.push(parentSession, childSession);
		const parent = harness.service.recruit(parentSession);
		const task = harness.service.addTask('Work', 'Work');
		harness.service.assign(parent, task);
		const child = harness.service.units.get().find(unit => unit.session === childSession.resource.toString());
		harness.sessions.splice(0);
		harness.service.setDraft(parent, 'More work');
		await assert.rejects(harness.service.dispatch(parent), /available unit/);
		assert.deepStrictEqual({ parent: child?.parentId, task: child?.taskId, automatic: child?.automatic, requests: harness.requests }, { parent, task, automatic: true, requests: [] });
	});

	test('validates storage shape and spatial boundaries', () => {
		const tasks = [{ id: 't', title: 'Task', prompt: 'Work', x: 50, y: 50 }];
		assert.deepStrictEqual({
			valid: isGameBoard(emptyGameBoard),
			invalid: isGameBoard({ version: 1, tasks: [null], units: [] }),
			nonFinite: isGameBoard({ version: 1, tasks: [{ ...tasks[0], x: Infinity }], units: [] }),
			within: nearestGameTask(tasks, { x: 65, y: 50 })?.id,
			beyond: nearestGameTask(tasks, { x: 66, y: 50 })?.id,
			clamped: clampGamePoint({ x: -12, y: 150 }),
		}, { valid: true, invalid: false, nonFinite: false, within: 't', beyond: undefined, clamped: { x: 6, y: 88 } });
	});
});
