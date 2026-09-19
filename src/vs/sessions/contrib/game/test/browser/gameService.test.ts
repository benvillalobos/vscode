/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { autorun, constObservable, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ILanguageModelChatMetadata } from '../../../../../workbench/contrib/chat/common/languageModels.js';
import { IChatModelInputState } from '../../../../../workbench/contrib/chat/common/model/chatModel.js';
import { ChatInteractivity, IChat, SessionStatus } from '../../../../services/sessions/common/session.js';
import { clampGamePoint, emptyGameBoard, isGameBoard, nearestGameTask } from '../../common/gameBoard.js';
import { createGameHarness, gameTestChat, gameTestChatModel, gameTestSession } from './gameTestUtils.js';

suite('Sessions - Game service', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const folder = URI.file('C:\\work\\project');

	test('context usage is live, per chat, and never saved or dispatched', () => {
		const harness = createGameHarness(store);
		const session = gameTestSession('parent');
		const child = gameTestChat('child', ChatInteractivity.ReadOnly);
		session.chats.set([...session.chats.get(), child], undefined);
		harness.sessions.push(session);
		harness.service.recruit(session);
		harness.service.spawn();
		const parentContext = gameTestChatModel(session.mainChat.get().resource, 500);
		const childContext = gameTestChatModel(child.resource, 600, 100);
		const observations: (number | undefined)[][] = [];
		store.add(autorun(reader => observations.push(harness.service.units.read(reader).map(unit => unit.contextUsagePercent))));
		const saved = harness.service.board.get();
		harness.chatModels.set([parentContext.model, childContext.model], undefined);
		parentContext.usage.set({ kind: 'usage', promptTokens: 501, completionTokens: 0 }, undefined);
		parentContext.usage.set({ kind: 'usage', promptTokens: 200, completionTokens: 0 }, undefined);
		harness.chatModels.set([childContext.model], undefined);
		assert.deepStrictEqual({
			observations, saved: harness.service.board.get(), requests: harness.requests,
		}, {
			observations: [[undefined, undefined, undefined], [50, 70, undefined], [50.1, 70, undefined], [20, 70, undefined], [undefined, 70, undefined]],
			saved, requests: [],
		});
	});

	test('context usage honors model configuration, output capacity, auto routing, and late model registration', () => {
		const harness = createGameHarness(store);
		const session = gameTestSession('builder');
		harness.sessions.push(session);
		harness.service.recruit(session);
		const { model, usage, inputState } = gameTestChatModel(session.mainChat.get().resource, 450, 50);
		harness.chatModels.set([model], undefined);
		const usagePercent = () => harness.service.units.get()[0].contextUsagePercent;
		const native = usagePercent();
		harness.models.set('test-model', new class extends mock<ILanguageModelChatMetadata>() {
			override readonly maxInputTokens = 1800;
			override readonly maxOutputTokens = 200;
			override readonly configurationSchema: ILanguageModelChatMetadata['configurationSchema'] = { properties: { contextSize: { type: 'number', default: 800 } } };
		});
		harness.modelChanges.fire('test-model');
		const schemaDefault = usagePercent();
		inputState.set({
			...new class extends mock<IChatModelInputState>() { },
			selectedModel: { identifier: 'test-model', metadata: harness.models.get('test-model')! },
			modelConfiguration: { contextSize: 1800 },
		}, undefined);
		const configured = usagePercent();
		inputState.set({
			...new class extends mock<IChatModelInputState>() { },
			selectedModel: { identifier: 'auto', metadata: new class extends mock<ILanguageModelChatMetadata>() { } },
		}, undefined);
		usage.set({ kind: 'usage', promptTokens: 450, completionTokens: 50, actualModelId: 'routed' }, undefined);
		const missingMetadata = usagePercent();
		harness.models.set('routed', new class extends mock<ILanguageModelChatMetadata>() {
			override readonly maxInputTokens = 400;
			override readonly maxOutputTokens = 100;
		});
		harness.modelChanges.fire('routed');
		const routed = usagePercent();
		harness.models.set('routed', new class extends mock<ILanguageModelChatMetadata>() {
			override readonly maxInputTokens = 0;
			override readonly maxOutputTokens = 0;
		});
		harness.modelChanges.fire('routed');
		assert.deepStrictEqual({
			native, schemaDefault, configured, missingMetadata, routed, zeroCapacity: usagePercent(), requests: harness.requests,
		}, { native: 50, schemaDefault: 50, configured: 25, missingMetadata: undefined, routed: 100, zeroCapacity: undefined, requests: [] });
	});

	test('a pending request keeps the latest usage until a new report, and clearing chat removes it', () => {
		const harness = createGameHarness(store);
		const session = gameTestSession('builder');
		harness.sessions.push(session);
		harness.service.recruit(session);
		const previous = gameTestChatModel(session.mainChat.get().resource, 600);
		const current = gameTestChatModel(session.mainChat.get().resource);
		current.usage.set(undefined, undefined);
		harness.chatModels.set([current.model], undefined);
		current.model.requests.unshift(previous.model.requests[0]);
		const pending = harness.service.units.get()[0].contextUsagePercent;
		current.usage.set({ kind: 'usage', promptTokens: 300, completionTokens: 0 }, undefined);
		const compacted = harness.service.units.get()[0].contextUsagePercent;
		current.model.requests.splice(0);
		current.model.lastRequestObs.set(undefined, undefined);
		assert.deepStrictEqual({
			pending, compacted, cleared: harness.service.units.get()[0].contextUsagePercent,
			requests: harness.requests,
		}, { pending: 60, compacted: 30, cleared: undefined, requests: [] });
	});

	test('completed turns retain provider status across restoration and subsequent turns without dispatching', () => {
		const harness = createGameHarness(store);
		const chat = gameTestChat('builder');
		const session = { ...gameTestSession('builder'), mainChat: constObservable(chat), chats: constObservable([chat]) };
		harness.sessions.push(session);
		const id = harness.service.recruit(session);
		const task = harness.service.addTask('Build', 'Build the feature');
		harness.service.assign(id, task);
		const before = harness.service.board.get().units;
		const resting = harness.service.units.get()[0].status;
		const restored = createGameHarness(store, harness.storage);
		restored.sessions.push(session);
		const restoredStatus = restored.service.units.get()[0].status;
		chat.updatedAt.set(new Date('2026-09-01T12:01:00Z'), undefined);
		const afterMetadataUpdate = harness.service.units.get()[0].status;
		chat.status.set(SessionStatus.InProgress, undefined);
		const working = harness.service.units.get()[0].status;
		chat.lastTurnEnd.set(new Date('2026-09-01T12:02:00Z'), undefined);
		chat.status.set(SessionStatus.Completed, undefined);
		assert.deepStrictEqual({
			resting, restoredStatus, afterMetadataUpdate, working, nextResult: harness.service.units.get()[0].status,
			units: harness.service.board.get().units, requests: harness.requests,
		}, {
			resting: SessionStatus.Completed, restoredStatus: SessionStatus.Completed, afterMetadataUpdate: SessionStatus.Completed, working: SessionStatus.InProgress,
			nextResult: SessionStatus.Completed, units: before, requests: [],
		});
	});

	test('providers without a turn timestamp retain completed status across metadata updates', () => {
		const harness = createGameHarness(store);
		const chat = gameTestChat('builder');
		chat.lastTurnEnd.set(undefined, undefined);
		const session = { ...gameTestSession('builder'), mainChat: constObservable(chat), chats: constObservable([chat]) };
		harness.sessions.push(session);
		harness.service.recruit(session);
		const resting = harness.service.units.get()[0].status;
		chat.updatedAt.set(new Date('2026-09-01T12:02:00Z'), undefined);
		assert.deepStrictEqual([resting, harness.service.units.get()[0].status], [SessionStatus.Completed, SessionStatus.Completed]);
	});

	test('automatic child results retain completed status without changing parent or task', () => {
		const harness = createGameHarness(store);
		const session = gameTestSession('parent');
		const child = gameTestChat('child', ChatInteractivity.ReadOnly);
		session.chats.set([...session.chats.get(), child], undefined);
		harness.sessions.push(session);
		const parent = harness.service.recruit(session);
		const task = harness.service.addTask('Build', 'Build the feature');
		harness.service.assign(parent, task);
		assert.deepStrictEqual(harness.service.units.get().map(unit => ({
			status: unit.status, task: unit.taskId, automatic: unit.automatic,
		})), [
			{ status: SessionStatus.Completed, task, automatic: false },
			{ status: SessionStatus.Completed, task, automatic: true },
		]);
	});

	test('draft, busy, approval, error, and missing sessions retain distinct statuses', () => {
		const harness = createGameHarness(store);
		const draft = harness.service.spawn();
		const chat = gameTestChat('builder');
		const session = { ...gameTestSession('builder'), mainChat: constObservable(chat), chats: constObservable([chat]) };
		harness.sessions.push(session);
		const id = harness.service.recruit(session);
		const statuses = [SessionStatus.Untitled, SessionStatus.InProgress, SessionStatus.NeedsInput, SessionStatus.Error];
		const observed = statuses.map(status => {
			chat.status.set(status, undefined);
			return harness.service.units.get().find(unit => unit.id === id)?.status;
		});
		harness.sessions.splice(0);
		harness.service.setDraft(id, 'Reconnect');
		assert.deepStrictEqual({
			draft: harness.service.units.get().find(unit => unit.id === draft)?.status,
			observed, missing: harness.service.units.get().find(unit => unit.id === id)?.status, requests: harness.requests,
		}, { draft: 'ready', observed: statuses, missing: 'unavailable', requests: [] });
	});

	test('dispatch wakes a completed pet; failed dispatch preserves provider status and unsent orders', async () => {
		const harness = createGameHarness(store);
		const session = gameTestSession('builder');
		harness.sessions.push(session);
		const id = harness.service.recruit(session);
		harness.service.setDraft(id, 'Follow up');
		harness.setFail(true);
		await assert.rejects(harness.service.dispatch(id), /Provider unavailable/);
		const afterFailure = { status: harness.service.units.get()[0].status, draft: harness.service.board.get().units[0].draft };
		harness.setFail(false);
		const dispatch = harness.service.dispatch(id);
		const sending = harness.service.units.get()[0].status;
		await dispatch;
		assert.deepStrictEqual({
			afterFailure, sending, afterSend: harness.service.units.get()[0].status,
		}, {
			afterFailure: { status: SessionStatus.Completed, draft: 'Follow up' }, sending: 'sending', afterSend: SessionStatus.Completed,
		});
	});

	test('spawning and moving only changes the local map; proximity assigns and leaving clears', () => {
		const { service, requests } = createGameHarness(store);
		const taskId = service.addTask('Build', 'Build and test the feature');
		const unitId = service.spawn();
		const task = service.board.get().tasks[0];
		service.move(unitId, { x: task.x + 40, y: task.y });
		const assigned = service.board.get().units[0].taskId;
		service.move(unitId, { x: 95, y: 95 });
		assert.deepStrictEqual({
			assigned, released: service.board.get().units[0].taskId,
			position: { x: service.board.get().units[0].x, y: service.board.get().units[0].y },
			requests,
		}, { assigned: taskId, released: undefined, position: { x: 94, y: 88 }, requests: [] });
	});

	test('dispatch creates a workspace session once, preserves identity for follow-ups, and does not override permissions', async () => {
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
			folder: requests[0].folder?.toString(),
			second: requests[1].options,
			followUpTarget: requests[1].createOptions,
			session: requests[1].session?.resource.toString(),
			draft: service.board.get().units[0].draft,
		}, {
			count: 2,
			first: { query: 'You are working on the following task for the user.\n\nHere is the task: Build\nBuild the feature\n\nHere is the user\'s request:\nAdd tests', title: 'Build' },
			target: { providerId: 'test', sessionTypeId: 'test', isolationMode: 'workspace' },
			folder: folder.toString(),
			second: { query: 'Continuing the task "Build" for the user.\n\nHere is the user\'s request:\nReview the result' },
			followUpTarget: undefined,
			session, draft: '',
		});
	});

	test('reassigning a dispatched unit to a different task re-briefs it on the next dispatch', async () => {
		const { service, requests } = createGameHarness(store);
		service.setTarget(folder, 'test', 'test');
		const firstTask = service.addTask('Build', 'Build the feature');
		const secondTask = service.addTask('Polish', 'Polish the UI');
		const id = service.spawn();
		service.assign(id, firstTask);
		service.setDraft(id, 'Add tests');
		await service.dispatch(id);
		service.assign(id, secondTask);
		service.setDraft(id, 'Fix the spacing');
		await service.dispatch(id);
		assert.strictEqual(requests[1].options.query, 'You are working on the following task for the user.\n\nHere is the task: Polish\nPolish the UI\n\nHere is the user\'s request:\nFix the spacing');
	});

	test('editing task fields preserves map state and persists without dispatch', () => {
		const { service, storage, requests } = createGameHarness(store);
		const taskId = service.addTask('Build', 'Build the feature');
		const unitId = service.spawn();
		service.assign(unitId, taskId);
		service.toggleMinimize(taskId);
		service.setDraft(unitId, 'Keep these orders');
		const task = service.board.get().tasks[0];
		const units = service.board.get().units;
		service.updateTask(taskId, { title: '  Polish  ' });
		service.updateTask(taskId, { prompt: '  Polish the UI\nAdd tests  ' });
		const restored = createGameHarness(store, storage);
		assert.deepStrictEqual({
			task: restored.service.board.get().tasks[0],
			units: service.board.get().units,
			persistedUnits: JSON.stringify(restored.service.board.get().units),
			requests,
		}, {
			task: { ...task, title: 'Polish', prompt: 'Polish the UI\nAdd tests' },
			units, persistedUnits: JSON.stringify(units), requests: [],
		});
	});

	test('invalid task edits fail without changing the board', () => {
		const { service } = createGameHarness(store);
		const taskId = service.addTask('Build', 'Build the feature');
		const board = service.board.get();
		assert.throws(() => service.updateTask(taskId, { title: ' ' }), /title and description/);
		assert.throws(() => service.updateTask(taskId, { prompt: '\n' }), /title and description/);
		assert.throws(() => service.updateTask('missing', { title: 'New title' }), /no longer on the map/);
		assert.strictEqual(service.board.get(), board);
	});

	for (const inFlight of [false, true]) {
		test(`editing a task re-briefs assigned units on the next dispatch${inFlight ? ' even during a send' : ''}`, async () => {
			const { service, requests } = createGameHarness(store);
			service.setTarget(folder, 'test', 'test');
			const taskId = service.addTask('Build', 'Build the feature');
			const unitId = service.spawn();
			service.assign(unitId, taskId);
			const dispatch = service.dispatch(unitId);
			if (!inFlight) {
				await dispatch;
			}
			service.updateTask(taskId, { title: 'Polish', prompt: 'Polish the UI' });
			await dispatch;
			const requestsAfterEdit = requests.length;
			await service.dispatch(unitId);
			const briefed = service.board.get().units[0].briefedTaskId;
			service.updateTask(taskId, { title: ' Polish ' });
			const briefedAfterNoOp = service.board.get().units[0].briefedTaskId;
			service.setDraft(unitId, 'Review');
			await service.dispatch(unitId);
			assert.deepStrictEqual({
				requestsAfterEdit, briefed, briefedAfterNoOp,
				updatedQuery: requests[1].options.query,
				followUp: requests[2].options.query,
			}, {
				requestsAfterEdit: 1, briefed: taskId, briefedAfterNoOp: taskId,
				updatedQuery: 'You are working on the following task for the user.\n\nHere is the task: Polish\nPolish the UI',
				followUp: 'Continuing the task "Polish" for the user.\n\nHere is the user\'s request:\nReview',
			});
		});
	}

	test('a brand-new dispatch applies the command dock default model and permission level', async () => {
		const { service, requests } = createGameHarness(store);
		service.setTarget(folder, 'test', 'test');
		service.setDefaultModel('copilot/gpt-test');
		service.setDefaultPermissionLevel('autoApprove');
		const id = service.spawn();
		service.setDraft(id, 'Do work');
		await service.dispatch(id);
		assert.deepStrictEqual(requests[0].createOptions, {
			providerId: 'test', sessionTypeId: 'test', isolationMode: 'workspace', modelId: 'copilot/gpt-test', permissionLevel: 'autoApprove',
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

	test('toggling minimize flips and persists the task flag without touching assignments', () => {
		const { service, storage } = createGameHarness(store);
		const task = service.addTask('Test', 'Run the tests');
		const unit = service.spawn();
		service.assign(unit, task);
		service.toggleMinimize(task);
		const minimized = service.board.get().tasks[0].minimized;
		const restored = createGameHarness(store, storage);
		service.toggleMinimize(task);
		assert.deepStrictEqual({
			minimized, restoredMinimized: restored.service.board.get().tasks[0].minimized,
			expanded: service.board.get().tasks[0].minimized,
			taskId: service.board.get().units[0].taskId,
		}, { minimized: true, restoredMinimized: true, expanded: false, taskId: task });
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
			legacyBoard: isGameBoard({ ...emptyGameBoard, minimizedUnitIds: ['blob'], acknowledgedResults: [{ unitId: 'blob', resultId: 'turn' }] }),
			within: nearestGameTask(tasks, { x: 94, y: 50 })?.id,
			beyond: nearestGameTask(tasks, { x: 95, y: 50 })?.id,
			clamped: clampGamePoint({ x: -12, y: 150 }),
		}, { valid: true, invalid: false, nonFinite: false, legacyBoard: true, within: 't', beyond: undefined, clamped: { x: 6, y: 88 } });
	});

	test('overlapping assignment zones choose the nearest task and retain circular boundaries', () => {
		const tasks = [
			{ id: 'first', title: 'First', prompt: 'Work', x: 25, y: 25 },
			{ id: 'second', title: 'Second', prompt: 'Work', x: 75, y: 25 },
		];
		assert.deepStrictEqual({
			nearest: nearestGameTask(tasks, { x: 60, y: 25 })?.id,
			verticalBoundary: nearestGameTask(tasks, { x: 25, y: 69 })?.id,
			outsideVertical: nearestGameTask(tasks, { x: 25, y: 70 })?.id,
			outsideDiagonal: nearestGameTask(tasks, { x: 50, y: 65 })?.id,
		}, { nearest: 'second', verticalBoundary: 'first', outsideVertical: undefined, outsideDiagonal: undefined });
	});

	for (const event of ['archived', 'deleted'] as const) {
		test(`${event} session removes its map pieces, but not unrelated blobs`, () => {
			const harness = createGameHarness(store);
			const session = gameTestSession('target');
			harness.sessions.push(session);
			const id = harness.service.recruit(session);
			harness.service.spawn(id);
			const other = harness.service.spawn();
			harness[event].fire(session);
			assert.deepStrictEqual({
				ids: harness.service.board.get().units.map(unit => unit.id),
				requests: harness.requests,
			}, { ids: [other], requests: [] });
		});
	}

	test('confirmed child chat deletion removes only its blob', () => {
		const harness = createGameHarness(store);
		const session = gameTestSession('parent');
		harness.sessions.push(session);
		const parent = harness.service.recruit(session);
		const child = gameTestChat('child');
		session.chats.set([...session.chats.get(), child], undefined);
		harness.chatDeleted.fire(session);
		assert.strictEqual(harness.service.units.get().length, 2);
		session.chats.set([session.mainChat.get()], undefined);
		harness.chatDeleted.fire(session);
		assert.deepStrictEqual(harness.service.units.get().map(unit => unit.id), [parent]);
	});
});
