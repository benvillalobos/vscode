/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { stub } from 'sinon';
import { addDisposableListener, getWindow } from '../../../../../base/browser/dom.js';
import { IAction } from '../../../../../base/common/actions.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IInputOptions, IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { workbenchInstantiationService } from '../../../../../workbench/test/browser/workbenchTestServices.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { ARCHIVE_SESSION_COMMAND_ID } from '../../../../common/sessionCommands.js';
import { ISessionsManagementService } from '../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { SessionStatus } from '../../../../services/sessions/common/session.js';
import { constObservable } from '../../../../../base/common/observable.js';
import { IGameService } from '../../browser/gameService.js';
import { GameWidget } from '../../browser/gameWidget.js';
import { createGameHarness, gameTestChat, gameTestChatModel, gameTestSession } from './gameTestUtils.js';
import { ArchiveSessionAction } from '../../../sessions/browser/views/sessionsViewActions.js';

suite('Sessions - Game widget', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function mapHarness(hoverService?: IHoverService) {
		const harness = createGameHarness(store);
		const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
		instantiation.stub(IGameService, harness.service);
		instantiation.stub(ISessionsManagementService, harness.management);
		instantiation.stub(ISessionsService, new class extends mock<ISessionsService>() { });
		if (hoverService) {
			instantiation.stub(IHoverService, hoverService);
		}
		const widget = store.add(instantiation.createInstance(GameWidget, {}));
		document.body.appendChild(widget.element);
		store.add(toDisposable(() => widget.element.remove()));
		widget.element.style.width = '1000px';
		widget.layout(1000, 680);
		return {
			...harness, widget,
			map: widget.element.querySelector<HTMLElement>('.game-map')!,
			viewport: widget.element.querySelector<HTMLElement>('.game-map-viewport')!,
		};
	}

	function capturePointer(element: HTMLElement): void {
		const capture = stub(element, 'setPointerCapture');
		const release = stub(element, 'releasePointerCapture');
		store.add(toDisposable(() => { capture.restore(); release.restore(); }));
	}

	function selectedNames(map: HTMLElement): string[] {
		return [...map.querySelectorAll('.game-unit.game-selected .game-node-label')].map(label => label.textContent!);
	}

	for (const zoom of [0.5, 0.75, 1, 1.25, 2]) {
		for (const reverse of [false, true]) {
			test(`background rectangle selects blob centers at ${zoom} zoom${reverse ? ' in reverse' : ''} without moving or dispatching`, () => {
				const { service, map, viewport, widget, requests } = mapHarness();
				const first = service.spawn();
				const second = service.spawn();
				const outside = service.spawn();
				service.move(first, { x: 25, y: 25 });
				service.move(second, { x: 35, y: 35 });
				service.move(outside, { x: 70, y: 70 });
				service.rename(first, 'First');
				service.rename(second, 'Second');
				service.rename(outside, 'Outside');
				service.addTask('Not a blob', 'Do not select task sites');
				const board = service.board.get();
				map.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -Math.log(zoom) / 0.002, bubbles: true, cancelable: true }));
				viewport.scrollLeft = zoom > 0.5 ? 100 : 0;
				viewport.scrollTop = zoom > 0.5 ? 60 : 0;
				viewport.dispatchEvent(new Event('scroll'));
				capturePointer(map);
				const bounds = viewport.getBoundingClientRect();
				const point = (fraction: number) => ({
					clientX: bounds.left - viewport.scrollLeft + map.clientWidth * zoom * fraction,
					clientY: bounds.top - viewport.scrollTop + map.clientHeight * zoom * fraction,
				});
				map.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, buttons: 1, ...point(reverse ? 0.4 : 0.2), bubbles: true }));
				map.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 1, ...point(reverse ? 0.2 : 0.4), bubbles: true }));
				const rectangle = widget.element.querySelector<HTMLElement>('.game-selection-rectangle')!;
				const rendered = rectangle.getBoundingClientRect();
				const preview = {
					visible: !rectangle.hidden,
					edgesFollowPointer: Math.max(
						Math.abs(rendered.left - point(0.2).clientX),
						Math.abs(rendered.top - point(0.2).clientY),
						Math.abs(rendered.right - point(0.4).clientX),
						Math.abs(rendered.bottom - point(0.4).clientY),
					) < 1,
				};
				map.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 0, ...point(reverse ? 0.2 : 0.4), bubbles: true }));
				map.click();
				assert.deepStrictEqual({
					preview, selected: selectedNames(map), tasks: map.querySelectorAll('.game-task.game-selected').length,
					portraits: [...widget.element.querySelectorAll('.game-portrait')].map(portrait => portrait.getAttribute('aria-label')),
					group: widget.element.querySelector('.game-selection-title')!.textContent,
					rectangleRemoved: !rectangle.isConnected, boardUnchanged: service.board.get() === board, requests,
				}, {
					preview: { visible: true, edgesFollowPointer: true },
					selected: ['First', 'Second'], tasks: 0,
					portraits: ['Select First. Draft - No Session', 'Select Second. Draft - No Session'],
					group: '2 blobs selected', rectangleRemoved: true, boardUnchanged: true, requests: [],
				});
			});
		}
	}

	for (const ending of ['pointercancel', 'lostpointercapture', 'Escape', 'blur', 'buttons', 'dispose']) {
		test(`canceling rectangle selection on ${ending} preserves selection and releases the overlay`, () => {
			const { service, map, widget } = mapHarness();
			service.spawn();
			map.querySelector<HTMLElement>('.game-unit')!.click();
			const before = selectedNames(map);
			capturePointer(map);
			map.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, buttons: 1, clientX: 10, clientY: 10, bubbles: true }));
			map.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 1, clientX: 100, clientY: 100, bubbles: true }));
			const rectangle = widget.element.querySelector('.game-selection-rectangle')!;
			switch (ending) {
				case 'Escape': map.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); break;
				case 'blur': getWindow(map).dispatchEvent(new Event('blur')); break;
				case 'buttons': map.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 0, bubbles: true })); break;
				case 'dispose': widget.dispose(); break;
				default: map.dispatchEvent(new PointerEvent(ending, { pointerId: 1, bubbles: true })); break;
			}
			map.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
			assert.deepStrictEqual({ overlay: rectangle.isConnected, selection: ending === 'dispose' ? before : selectedNames(map) }, { overlay: false, selection: before });
		});
	}

	test('background rectangle follows the pointer while zooming and scrolling during a drag', () => {
		const { map, viewport, widget } = mapHarness();
		capturePointer(map);
		const bounds = viewport.getBoundingClientRect();
		const start = { clientX: bounds.left + 100, clientY: bounds.top + 80 };
		const end = { clientX: bounds.left + 250, clientY: bounds.top + 190 };
		map.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, buttons: 1, ...start, bubbles: true }));
		map.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 1, ...end, bubbles: true }));
		const rectangle = widget.element.querySelector<HTMLElement>('.game-selection-rectangle')!;
		const follows = (zoom: number) => {
			const rendered = rectangle.getBoundingClientRect();
			const anchor = {
				x: bounds.left + 100 * zoom - viewport.scrollLeft,
				y: bounds.top + 80 * zoom - viewport.scrollTop,
			};
			return Math.max(
				Math.abs(rendered.left - Math.min(anchor.x, end.clientX)),
				Math.abs(rendered.top - Math.min(anchor.y, end.clientY)),
				Math.abs(rendered.right - Math.max(anchor.x, end.clientX)),
				Math.abs(rendered.bottom - Math.max(anchor.y, end.clientY)),
			) < 1;
		};
		const results = [0.5, 0.75, 1, 1.25, 2].map(zoom => {
			map.dispatchEvent(new WheelEvent('wheel', {
				ctrlKey: true, deltaY: -Math.log(zoom / Number(map.style.zoom || 1)) / 0.002, ...end, bubbles: true, cancelable: true,
			}));
			const zoomed = follows(zoom);
			viewport.scrollLeft = 20;
			viewport.scrollTop = 10;
			viewport.dispatchEvent(new Event('scroll'));
			return { zoomed, scrolled: follows(zoom) };
		});
		map.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, ...end, bubbles: true }));
		assert.deepStrictEqual(results, Array.from({ length: 5 }, () => ({ zoomed: true, scrolled: true })));
	});

	test('rectangle excludes minimized crews, adds with Shift, and clears on an empty rectangle or background click', () => {
		const { service, map, viewport } = mapHarness();
		const task = service.addTask('Hidden crew', 'Work');
		const hidden = service.spawn();
		service.assign(hidden, task);
		service.toggleMinimize(task);
		const visible = service.spawn();
		service.rename(visible, 'Visible');
		capturePointer(map);
		const drag = (from: number, to: number, shiftKey = false) => {
			const bounds = viewport.getBoundingClientRect();
			const point = (fraction: number) => ({
				clientX: bounds.left - viewport.scrollLeft + map.clientWidth * fraction,
				clientY: bounds.top - viewport.scrollTop + map.clientHeight * fraction,
			});
			map.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, buttons: 1, ...point(from), shiftKey, bubbles: true }));
			map.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 1, ...point(to), bubbles: true }));
			map.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, ...point(to), bubbles: true }));
			map.click();
		};
		drag(0, 1);
		const wholeMap = selectedNames(map);
		drag(0, 0.01, true);
		const additiveEmpty = selectedNames(map);
		drag(0, 0.01);
		const empty = selectedNames(map);
		drag(0, 1);
		map.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, buttons: 1, bubbles: true }));
		map.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
		map.click();
		assert.deepStrictEqual({ wholeMap, additiveEmpty, empty, clickedBackground: selectedNames(map) }, {
			wholeMap: ['Visible'], additiveEmpty: ['Visible'], empty: [], clickedBackground: [],
		});
	});

	test('keyboard multi-selection and portrait navigation focus just one blob while preserving its draft', () => {
		const { service, map, widget, requests } = mapHarness();
		const first = service.spawn();
		const second = service.spawn();
		service.rename(first, 'First');
		service.rename(second, 'Second');
		service.setDraft(second, 'Keep these orders');
		const blobs = map.querySelectorAll<HTMLElement>('.game-unit');
		blobs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, shiftKey: true, bubbles: true }));
		blobs[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', keyCode: 32, shiftKey: true, bubbles: true }));
		const group = selectedNames(map);
		const portraits = widget.element.querySelectorAll<HTMLElement>('.game-portrait');
		portraits[0].focus();
		portraits[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		const arrowFocus = document.activeElement === portraits[1];
		portraits[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
		assert.deepStrictEqual({
			group, arrowFocus, selected: selectedNames(map), pressed: [...blobs].map(blob => blob.getAttribute('aria-pressed')),
			portraits: widget.element.querySelectorAll('.game-portrait').length,
			orders: widget.element.querySelector<HTMLTextAreaElement>('.game-inspector textarea')!.value,
			focused: document.activeElement === portraits[1], requests,
		}, { group: ['First', 'Second'], arrowFocus: true, selected: ['Second'], pressed: ['false', 'true'], portraits: 1, orders: 'Keep these orders', focused: true, requests: [] });
	});

	test('Shift-click toggles blobs, portrait click isolates one, and removal prunes the roster', () => {
		const { service, map, widget } = mapHarness();
		const ids = [service.spawn(), service.spawn(), service.spawn()];
		const blobs = [...map.querySelectorAll<HTMLElement>('.game-unit')];
		const toggle = (index: number) => blobs[index].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		toggle(0);
		toggle(1);
		toggle(2);
		toggle(1);
		const toggled = selectedNames(map);
		service.remove(ids[0]);
		const pruned = widget.element.querySelectorAll('.game-portrait').length;
		toggle(1);
		widget.element.querySelector<HTMLElement>('.game-portrait')!.click();
		assert.deepStrictEqual({ toggled, pruned, isolated: selectedNames(map) }, { toggled: ['Blob 1', 'Blob 3'], pruned: 1, isolated: ['Blob 3'] });
	});

	test('portrait close deselects only that blob without changing the board or its sessions', () => {
		const { service, map, widget, sessions, requests } = mapHarness();
		const session = gameTestSession('Live session');
		sessions.push(session);
		service.recruit(session);
		service.spawn();
		service.spawn();
		for (const blob of map.querySelectorAll<HTMLElement>('.game-unit')) {
			blob.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		}
		const before = service.board.get();
		const portrait = widget.element.querySelector<HTMLElement>('.game-portrait')!;
		const close = widget.element.querySelector<HTMLElement>('.game-portrait-deselect')!;
		const label = close.getAttribute('aria-label');
		close.click();
		assert.deepStrictEqual({
			label, selected: selectedNames(map),
			portraits: widget.element.querySelectorAll('.game-portrait').length,
			removedPortrait: !portrait.isConnected, units: map.querySelectorAll('.game-unit').length,
			boardUnchanged: before === service.board.get(), archived: session.isArchived.get(), requests,
		}, {
			label: 'Remove Live session from Selection', selected: ['Blob 2', 'Blob 3'], portraits: 2,
			removedPortrait: true, units: 3, boardUnchanged: true, archived: false, requests: [],
		});
	});

	for (const activation of ['Enter', 'Space']) {
		test(`portrait close is revealed on keyboard focus and supports ${activation} without losing focus`, () => {
			const { service, map, widget } = mapHarness();
			service.spawn();
			service.spawn();
			service.spawn();
			for (const blob of map.querySelectorAll<HTMLElement>('.game-unit')) {
				blob.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
			}
			const portraits = widget.element.querySelectorAll<HTMLElement>('.game-portrait');
			const buttons = widget.element.querySelectorAll<HTMLElement>('.game-portrait-deselect');
			portraits[1].focus();
			const revealed = getWindow(buttons[1]).getComputedStyle(buttons[1]).opacity;
			buttons[1].focus();
			buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
			const arrowFocus = document.activeElement === portraits[2];
			buttons[1].focus();
			buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: activation === 'Enter' ? 'Enter' : ' ', keyCode: activation === 'Enter' ? 13 : 32, bubbles: true }));
			const afterFirst = { selected: selectedNames(map), focus: document.activeElement === portraits[2] };
			buttons[2].focus();
			buttons[2].click();
			assert.deepStrictEqual({
				revealed, arrowFocus, afterFirst, selected: selectedNames(map),
				focus: document.activeElement === portraits[0], singleClose: getWindow(buttons[0]).getComputedStyle(buttons[0]).display,
				singleDisabled: buttons[0].getAttribute('aria-disabled'),
			}, {
				revealed: '1', arrowFocus: true, afterFirst: { selected: ['Blob 1', 'Blob 3'], focus: true },
				selected: ['Blob 1'], focus: true, singleClose: 'none', singleDisabled: 'true',
			});
		});
	}

	test('portrait close names stay current and controls return when multi-selection resumes', () => {
		const { service, map, widget } = mapHarness();
		const first = service.spawn();
		service.spawn();
		const blobs = map.querySelectorAll<HTMLElement>('.game-unit');
		blobs[0].click();
		const close = widget.element.querySelector<HTMLElement>('.game-portrait-deselect')!;
		const single = close.style.display;
		blobs[1].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		service.rename(first, 'Renamed blob');
		const multiple = { display: close.style.display, label: close.getAttribute('aria-label'), disabled: close.getAttribute('aria-disabled') };
		widget.element.querySelector<HTMLElement>('.game-portrait')!.click();
		assert.deepStrictEqual({ single, multiple, selected: selectedNames(map), hiddenAgain: close.style.display }, {
			single: 'none', multiple: { display: '', label: 'Remove Renamed blob from Selection', disabled: 'false' },
			selected: ['Renamed blob'], hiddenAgain: 'none',
		});
	});

	test('portraits render visible art and expose current blob names through disposable hovers', () => {
		const hovers = new Map<HTMLElement, Parameters<IHoverService['setupDelayedHover']>[1]>();
		const { service, map, widget } = mapHarness({
			...NullHoverService,
			setupDelayedHover: (target, options) => {
				hovers.set(target, options);
				return toDisposable(() => hovers.delete(target));
			},
		});
		const id = service.spawn();
		map.querySelector<HTMLElement>('.game-unit')!.click();
		const portrait = widget.element.querySelector<HTMLElement>('.game-portrait')!;
		const art = portrait.querySelector<HTMLElement>('.game-unit-art')!.getBoundingClientRect();
		const visibleArt = art.width > 0 && art.height > 0 && art.width <= portrait.clientWidth;
		const options = hovers.get(portrait)!;
		const content = () => (typeof options === 'function' ? options() : options).content;
		const before = content();
		service.rename(id, 'A named blob');
		const renamed = content();
		service.remove(id);
		assert.deepStrictEqual({
			visibleArt,
			before, renamed, disposed: !hovers.has(portrait),
		}, { visibleArt: true, before: 'Blob 1', renamed: 'A named blob', disposed: true });
	});

	test('completed pets sleep automatically with only their name while other poses reflect live status', () => {
		const { service, sessions, widget, map, requests } = mapHarness();
		const chat = gameTestChat('Builder');
		const session = { ...gameTestSession('Builder'), mainChat: constObservable(chat), chats: constObservable([chat]) };
		sessions.push(session);
		const id = service.recruit(session);
		const task = service.addTask('Build', 'Build and test');
		service.assign(id, task);
		const before = service.board.get().units;
		const blob = map.querySelector<HTMLElement>('.game-unit')!;
		const art = blob.querySelector<HTMLElement>('.game-unit-art')!;
		blob.click();
		const asleep = {
			pose: art.dataset.petState,
			aria: blob.getAttribute('aria-label')?.includes('Resting'),
			asset: art.style.getPropertyValue('--game-pet-image').includes('buddy-sleep-'),
			labels: [...blob.querySelectorAll('.game-node-label')].map(label => label.textContent),
			detail: blob.querySelector('.game-node-detail'),
			marker: blob.querySelector('.game-result-marker'),
			acknowledge: widget.element.querySelector('.game-acknowledge'),
		};
		chat.status.set(SessionStatus.InProgress, undefined);
		const working = art.dataset.petState;
		chat.status.set(SessionStatus.NeedsInput, undefined);
		const waiting = art.dataset.petState;
		chat.status.set(SessionStatus.Error, undefined);
		const failed = art.dataset.petState;
		chat.lastTurnEnd.set(new Date('2026-09-01T12:03:00Z'), undefined);
		chat.status.set(SessionStatus.Completed, undefined);
		assert.deepStrictEqual({
			asleep, working, waiting, failed,
			nextResult: art.dataset.petState,
			units: service.board.get().units, requests,
		}, {
			asleep: { pose: 'sleep', aria: true, asset: true, labels: ['Builder'], detail: null, marker: null, acknowledge: null },
			working: 'rendering', waiting: 'worry', failed: 'worry',
			nextResult: 'sleep', units: before, requests: [],
		});
	});

	test('frustration starts strictly above 50 percent and clears when usage drops or becomes unavailable', () => {
		const { service, sessions, widget, map, requests, chatModels } = mapHarness();
		const chat = gameTestChat('Builder');
		chat.status.set(SessionStatus.InProgress, undefined);
		const session = { ...gameTestSession('Builder'), mainChat: constObservable(chat), chats: constObservable([chat]) };
		sessions.push(session);
		service.recruit(session);
		const { model, usage } = gameTestChatModel(chat.resource);
		chatModels.set([model], undefined);
		const blob = map.querySelector<HTMLElement>('.game-unit')!;
		const art = blob.querySelector<HTMLElement>('.game-unit-art')!;
		blob.click();
		const before = service.board.get();
		const observed = [undefined, 499, 500, 501, 700, 500, undefined].map(tokens => {
			usage.set(tokens === undefined ? undefined : { kind: 'usage', promptTokens: tokens, completionTokens: 0 }, undefined);
			return {
				frustrated: blob.classList.contains('game-frustrated'),
				worriedFace: art.style.getPropertyValue('--game-pet-image').includes('buddy-worry-'),
				accessible: blob.getAttribute('aria-label')?.includes('Frustrated'),
				inspector: widget.element.querySelector('.game-selection-context')!.textContent,
				pose: art.dataset.petState,
				status: blob.dataset.status,
			};
		});
		assert.deepStrictEqual({ observed, board: service.board.get(), requests }, {
			observed: [
				{ frustrated: false, worriedFace: false, accessible: false, inspector: '', pose: 'rendering', status: '1' },
				{ frustrated: false, worriedFace: false, accessible: false, inspector: 'Context window 50% full.', pose: 'rendering', status: '1' },
				{ frustrated: false, worriedFace: false, accessible: false, inspector: 'Context window 50% full.', pose: 'rendering', status: '1' },
				{ frustrated: true, worriedFace: true, accessible: true, inspector: 'Frustrated: context window 51% full (above 50%).', pose: 'rendering', status: '1' },
				{ frustrated: true, worriedFace: true, accessible: true, inspector: 'Frustrated: context window 70% full (above 50%).', pose: 'rendering', status: '1' },
				{ frustrated: false, worriedFace: false, accessible: false, inspector: 'Context window 50% full.', pose: 'rendering', status: '1' },
				{ frustrated: false, worriedFace: false, accessible: false, inspector: '', pose: 'rendering', status: '1' },
			], board: before, requests: [],
		});
	});

	test('frustrated pets retain work and approval states, with a static cue under reduced motion', async () => {
		const { service, sessions, widget, map, chatModels } = mapHarness();
		const chat = gameTestChat('Builder');
		const session = { ...gameTestSession('Builder'), mainChat: constObservable(chat), chats: constObservable([chat]) };
		sessions.push(session);
		const id = service.recruit(session);
		const { model, usage } = gameTestChatModel(chat.resource, 600);
		chatModels.set([model], undefined);
		const blob = map.querySelector<HTMLElement>('.game-unit')!;
		const art = blob.querySelector<HTMLElement>('.game-unit-art')!;
		const restingStatus = blob.getAttribute('aria-label')?.includes('Resting');
		service.setDraft(id, 'Keep going');
		const dispatch = service.dispatch(id);
		const sendingImage = getWindow(art).getComputedStyle(art).backgroundImage;
		await dispatch;
		chat.status.set(SessionStatus.InProgress, undefined);
		widget.element.classList.add('monaco-reduce-motion');
		const working = {
			workingWorry: getWindow(art).getComputedStyle(art).backgroundImage.includes('buddy-worry-'),
			speech: getWindow(art).getComputedStyle(art, '::after').backgroundImage.includes('buddy-speech-'),
			animations: [getWindow(art).getComputedStyle(art).animationName, getWindow(art).getComputedStyle(art, '::after').animationName],
			cue: getWindow(art).getComputedStyle(art, '::before').content,
		};
		chat.status.set(SessionStatus.NeedsInput, undefined);
		const needsInput = blob.getAttribute('aria-label')?.includes('Needs you');
		chat.status.set(SessionStatus.Completed, undefined);
		usage.set({ kind: 'usage', promptTokens: 500, completionTokens: 0 }, undefined);
		assert.deepStrictEqual({
			restingStatus, sendingWorry: sendingImage.includes('buddy-worry-'),
			...working, needsInput,
			restoredSleep: art.style.getPropertyValue('--game-pet-image').includes('buddy-sleep-'),
			frustrated: blob.classList.contains('game-frustrated'),
		}, {
			restingStatus: true, sendingWorry: true, workingWorry: true, speech: true,
			animations: ['none', 'none'], cue: '"!"', needsInput: true,
			restoredSleep: true, frustrated: false,
		});
	});

	test('reduced motion retains the pet working pose without animation', () => {
		const { service, sessions, widget, map } = mapHarness();
		const chat = gameTestChat('Builder');
		chat.status.set(SessionStatus.InProgress, undefined);
		const session = { ...gameTestSession('Builder'), mainChat: constObservable(chat), chats: constObservable([chat]) };
		sessions.push(session);
		service.recruit(session);
		widget.element.classList.add('monaco-reduce-motion');
		const art = map.querySelector<HTMLElement>('.game-unit-art')!;
		const style = getWindow(art).getComputedStyle(art);
		assert.deepStrictEqual({
			animation: style.animationName, staticAsset: style.backgroundImage.includes('-96.png'),
			speechAnimation: getWindow(art).getComputedStyle(art, '::after').animationName,
			pose: art.dataset.petState,
		}, { animation: 'none', staticAsset: true, speechAnimation: 'none', pose: 'rendering' });
	});

	test('at most three working pets animate, prioritizing the selected pet', () => {
		const { service, sessions, map } = mapHarness();
		for (let index = 0; index < 5; index++) {
			const chat = gameTestChat(`Worker ${index}`);
			chat.status.set(SessionStatus.InProgress, undefined);
			const session = { ...gameTestSession(`Worker ${index}`), mainChat: constObservable(chat), chats: constObservable([chat]) };
			sessions.push(session);
			service.recruit(session);
		}
		const pets = [...map.querySelectorAll<HTMLElement>('.game-unit')];
		pets[4].click();
		assert.deepStrictEqual({
			animated: pets.filter(pet => pet.classList.contains('game-pet-animated')).length,
			selectedAnimated: pets[4].classList.contains('game-pet-animated'),
			poses: pets.map(pet => pet.querySelector<HTMLElement>('.game-unit-art')!.dataset.petState),
		}, { animated: 3, selectedAnimated: true, poses: Array(5).fill('rendering') });
	});

	test('completion flourishes only on a live handoff, not on restoration or selection', () => {
		const { service, sessions, map } = mapHarness();
		const chat = gameTestChat('Builder');
		const session = { ...gameTestSession('Builder'), mainChat: constObservable(chat), chats: constObservable([chat]) };
		sessions.push(session);
		service.recruit(session);
		const pet = map.querySelector<HTMLElement>('.game-unit')!;
		const art = pet.querySelector<HTMLElement>('.game-unit-art')!;
		const restored = art.classList.contains('game-pet-complete');
		pet.click();
		const selected = art.classList.contains('game-pet-complete');
		chat.status.set(SessionStatus.InProgress, undefined);
		chat.status.set(SessionStatus.Completed, undefined);
		assert.deepStrictEqual({
			restored, selected, completed: art.classList.contains('game-pet-complete'),
			pose: art.dataset.petState,
		}, { restored: false, selected: false, completed: true, pose: 'sleep' });
	});

	test('sleeping pets wake on dispatch and drafts and unavailable sessions stay awake', async () => {
		const { service, sessions, widget, map, setFail } = mapHarness();
		const session = gameTestSession('Builder');
		sessions.push(session);
		const id = service.recruit(session);
		const draft = service.spawn();
		widget.element.classList.add('monaco-reduce-motion');
		const pets = [...map.querySelectorAll<HTMLElement>('.game-unit-art')];
		const sleeping = {
			pose: pets[0].dataset.petState,
			animation: getWindow(pets[0]).getComputedStyle(pets[0]).animationName,
			draft: pets[1].dataset.petState,
		};
		service.setDraft(id, 'Follow up');
		setFail(true);
		const dispatch = service.dispatch(id);
		const sending = pets[0].dataset.petState;
		await assert.rejects(dispatch, /Provider unavailable/);
		const afterFailure = pets[0].dataset.petState;
		sessions.splice(0);
		service.setDraft(draft, 'Not dispatched');
		assert.deepStrictEqual({
			sleeping, sending, afterFailure, unavailable: pets[0].dataset.petState,
			status: map.querySelector('.game-unit')?.getAttribute('aria-label'),
			messages: map.querySelectorAll('.game-unit .game-node-detail').length,
		}, {
			sleeping: { pose: 'sleep', animation: 'none', draft: 'idle' },
			sending: 'typing', afterFailure: 'sleep', unavailable: 'idle',
			status: 'Builder. Unavailable. Unassigned', messages: 0,
		});
	});

	test('map has quadruple area and Shift+scroll zooms around the pointer without changing the board or dock', () => {
		const { widget, map, viewport, service, requests } = mapHarness();
		service.addTask('Build', 'Build the feature');
		const board = service.board.get();
		const dock = widget.element.querySelector<HTMLElement>('.game-dock')!;
		const dockBounds = dock.getBoundingClientRect().toJSON();
		const bounds = viewport.getBoundingClientRect();
		const anchor = { x: bounds.left + 160, y: bounds.top + 100 };
		const pointAtAnchor = () => {
			const rect = map.getBoundingClientRect();
			return [(anchor.x - rect.left) / rect.width, (anchor.y - rect.top) / rect.height];
		};
		const before = pointAtAnchor();
		const wheel = (deltaY: number, shiftKey: boolean, deltaX = 0) => {
			const event = new WheelEvent('wheel', { deltaY, deltaX, shiftKey, clientX: anchor.x, clientY: anchor.y, bubbles: true, cancelable: true });
			map.dispatchEvent(event);
			return event.defaultPrevented;
		};
		wheel(-100, false);
		const ordinaryZoom = map.style.zoom;
		viewport.scrollTop = 0;
		viewport.scrollLeft = 0;
		viewport.dispatchEvent(new Event('scroll'));
		const prevented = wheel(-100, true);
		const after = pointAtAnchor();
		const zoomedIn = Number(map.style.zoom) > 1;
		const anchorStable = before.every((value, index) => Math.abs(value - after[index]) < 0.002);
		wheel(100000, true);
		const minimum = Number(map.style.zoom);
		const fits = map.getBoundingClientRect().width === viewport.clientWidth && map.getBoundingClientRect().height === viewport.clientHeight;
		wheel(0, true, -100000);
		const maximum = Number(map.style.zoom);
		map.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
		assert.deepStrictEqual({
			size: [map.clientWidth / viewport.clientWidth, map.clientHeight / viewport.clientHeight],
			ordinaryZoom, prevented, zoomedIn, anchorStable, minimum, fits, maximum,
			reset: Number(map.style.zoom), dockUnchanged: JSON.stringify(dockBounds) === JSON.stringify(dock.getBoundingClientRect().toJSON()),
			boardUnchanged: service.board.get() === board, requests,
		}, {
			size: [2, 2], ordinaryZoom: '', prevented: true, zoomedIn: true, anchorStable: true,
			minimum: 0.5, fits: true, maximum: 2, reset: 1, dockUnchanged: true, boardUnchanged: true, requests: [],
		});
	});

	test('keyboard zoom and panning stay scoped to the map background', () => {
		const { map, viewport, service } = mapHarness();
		service.spawn();
		map.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
		const zoomedIn = Number(map.style.zoom);
		map.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
		const zoomedOut = Number(map.style.zoom);
		viewport.scrollLeft = 0;
		viewport.dispatchEvent(new Event('scroll'));
		map.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		const panned = viewport.scrollLeft;
		map.querySelector<HTMLElement>('.game-unit')!.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
		assert.deepStrictEqual({ zoomedIn, zoomedOut, panned, afterBlobKey: Number(map.style.zoom) }, {
			zoomedIn: 1.2, zoomedOut: 1, panned: 80, afterBlobKey: 1,
		});
	});

	for (const deltaMode of [WheelEvent.DOM_DELTA_PIXEL, WheelEvent.DOM_DELTA_LINE, WheelEvent.DOM_DELTA_PAGE]) {
		test(`Ctrl+scroll zooms around the pointer and consumes the gesture in delta mode ${deltaMode}`, () => {
			const { widget, map, viewport, service, requests } = mapHarness();
			service.spawn();
			const board = service.board.get();
			const bounds = viewport.getBoundingClientRect();
			const anchor = { clientX: bounds.left + 160, clientY: bounds.top + 100 };
			const pointAtAnchor = () => {
				const rect = map.getBoundingClientRect();
				return [(anchor.clientX - rect.left) / rect.width, (anchor.clientY - rect.top) / rect.height];
			};
			const before = pointAtAnchor();
			const wheel = (target: HTMLElement, deltaY: number) => {
				const event = new WheelEvent('wheel', { ...anchor, ctrlKey: true, deltaY, deltaMode, bubbles: true, cancelable: true });
				target.dispatchEvent(event);
				return event.defaultPrevented;
			};
			const delta = 100 / (deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : 1);
			let bubbled = false;
			store.add(addDisposableListener(widget.element, 'wheel', () => { bubbled = true; }));
			const prevented = wheel(map.querySelector<HTMLElement>('.game-unit')!, -delta);
			const after = pointAtAnchor();
			const zoomedIn = Number(map.style.zoom);
			const escapedMap = bubbled;
			wheel(map, delta);
			const zoomedOut = Number(map.style.zoom);
			wheel(map, -100000);
			const maximum = Number(map.style.zoom);
			wheel(map, 100000);
			const minimum = Number(map.style.zoom);
			wheel(widget.element.querySelector<HTMLElement>('.game-dock')!, -1);
			assert.deepStrictEqual({
				prevented, escapedMap, zoomedIn: zoomedIn > 1, zoomedOut: Math.abs(zoomedOut - 1) < 0.00001,
				anchorStable: before.every((value, index) => Math.abs(value - after[index]) < 0.002),
				minimum, maximum, afterDockWheel: Number(map.style.zoom),
				boardUnchanged: service.board.get() === board, requests,
			}, {
				prevented: true, escapedMap: false, zoomedIn: true, zoomedOut: true, anchorStable: true,
				minimum: 0.5, maximum: 2, afterDockWheel: 0.5, boardUnchanged: true, requests: [],
			});
		});
	}

	for (const targetSelector of ['.game-map', '.game-unit', '.game-task']) {
		test(`middle mouse drag on ${targetSelector} pans the camera without moving pieces at any zoom`, () => {
			const { widget, map, viewport, service, requests } = mapHarness();
			service.addTask('Build', 'Build the feature');
			service.spawn();
			const board = service.board.get();
			const dock = widget.element.querySelector<HTMLElement>('.game-dock')!;
			const dockBounds = dock.getBoundingClientRect().toJSON();
			const capture = stub(viewport, 'setPointerCapture');
			const release = stub(viewport, 'releasePointerCapture');
			store.add(toDisposable(() => { capture.restore(); release.restore(); }));
			const target = widget.element.querySelector<HTMLElement>(targetSelector)!;
			const results = [0.5, 1, 2].map(zoom => {
				map.dispatchEvent(new KeyboardEvent('keydown', { key: '0', bubbles: true }));
				map.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -Math.log(zoom) / 0.002, bubbles: true, cancelable: true }));
				viewport.scrollLeft = 0;
				viewport.scrollTop = 0;
				viewport.dispatchEvent(new Event('scroll'));
				const down = new PointerEvent('pointerdown', { pointerId: 1, button: 1, buttons: 4, clientX: 200, clientY: 150, bubbles: true, cancelable: true });
				target.dispatchEvent(down);
				viewport.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 4, clientX: 80, clientY: 80, bubbles: true }));
				const panned = [viewport.scrollLeft, viewport.scrollTop];
				viewport.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 1, bubbles: true }));
				viewport.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 4, clientX: 0, clientY: 0, bubbles: true }));
				const auxclick = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
				target.dispatchEvent(auxclick);
				return { panned, stopped: [viewport.scrollLeft, viewport.scrollTop], prevented: down.defaultPrevented && auxclick.defaultPrevented };
			});
			assert.deepStrictEqual({
				results, captured: capture.callCount, released: release.callCount,
				dockUnchanged: JSON.stringify(dockBounds) === JSON.stringify(dock.getBoundingClientRect().toJSON()),
				boardUnchanged: service.board.get() === board, requests,
			}, {
				results: [
					{ panned: [0, 0], stopped: [0, 0], prevented: true },
					{ panned: [120, 70], stopped: [120, 70], prevented: true },
					{ panned: [120, 70], stopped: [120, 70], prevented: true },
				],
				captured: 3, released: 3, dockUnchanged: true, boardUnchanged: true, requests: [],
			});
		});
	}

	for (const ending of ['pointercancel', 'lostpointercapture', 'Escape', 'blur', 'buttons', 'dispose']) {
		test(`camera panning stops on ${ending}`, () => {
			const { widget, map, viewport } = mapHarness();
			const capture = stub(viewport, 'setPointerCapture');
			const release = stub(viewport, 'releasePointerCapture');
			store.add(toDisposable(() => { capture.restore(); release.restore(); }));
			map.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 1, buttons: 4, clientX: 200, clientY: 150, bubbles: true }));
			viewport.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 4, clientX: 80, clientY: 80, bubbles: true }));
			const panned = [viewport.scrollLeft, viewport.scrollTop];
			switch (ending) {
				case 'Escape': map.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); break;
				case 'blur': getWindow(viewport).dispatchEvent(new Event('blur')); break;
				case 'buttons': viewport.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 0, bubbles: true })); break;
				case 'dispose': widget.dispose(); break;
				default: viewport.dispatchEvent(new PointerEvent(ending, { pointerId: 1, bubbles: true })); break;
			}
			const stopped = [viewport.scrollLeft, viewport.scrollTop];
			viewport.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 4, clientX: 0, clientY: 0, bubbles: true }));
			assert.deepStrictEqual({
				panned, unchanged: JSON.stringify(stopped) === JSON.stringify([viewport.scrollLeft, viewport.scrollTop]), released: release.callCount,
			}, { panned: [120, 70], unchanged: true, released: 1 });
		});
	}

	test('camera panning is bounded by the map and starts only with the middle button', () => {
		const { map, viewport } = mapHarness();
		const capture = stub(viewport, 'setPointerCapture');
		const release = stub(viewport, 'releasePointerCapture');
		store.add(toDisposable(() => { capture.restore(); release.restore(); }));
		for (const button of [0, 2]) {
			map.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button, bubbles: true }));
		}
		const capturedOtherButtons = capture.called;
		map.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 1, buttons: 4, clientX: 200, clientY: 150, bubbles: true }));
		viewport.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 4, clientX: -10000, clientY: -10000, bubbles: true }));
		const atEnd = [viewport.scrollLeft, viewport.scrollTop];
		viewport.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 4, clientX: 10000, clientY: 10000, bubbles: true }));
		viewport.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, button: 1, bubbles: true }));
		assert.deepStrictEqual({
			capturedOtherButtons, atEnd, atStart: [viewport.scrollLeft, viewport.scrollTop],
		}, {
			capturedOtherButtons: false,
			atEnd: [viewport.scrollWidth - viewport.clientWidth, viewport.scrollHeight - viewport.clientHeight],
			atStart: [0, 0],
		});
	});

	test('task artwork keeps its enlarged area and pets use the chat pet display size', () => {
		const { map, service } = mapHarness();
		service.addTask('Build', 'Build the feature');
		service.spawn();
		const task = map.querySelector<HTMLElement>('.game-task-art')!;
		const blob = map.querySelector<HTMLElement>('.game-unit-art')!;
		assert.deepStrictEqual({
			task: [task.offsetWidth, task.offsetHeight],
			areaRatio: task.offsetWidth * task.offsetHeight / (50 * 38),
			blob: [blob.offsetWidth, blob.offsetHeight],
		}, { task: [100, 76], areaRatio: 4, blob: [48, 48] });
	});

	for (const position of [{ x: 6, y: 10 }, { x: 94, y: 88 }]) {
		test(`keyboard movement separates blobs from tasks at the map edge ${position.x},${position.y}`, async () => {
			const { map, service, requests } = mapHarness();
			const taskId = service.addTask('Build', 'Build the feature');
			service.move(taskId, position);
			const unitId = service.spawn();
			service.move(unitId, position);
			const blob = map.querySelector<HTMLElement>('.game-unit')!;
			blob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
			await timeout(0);
			const a = blob.getBoundingClientRect();
			const b = map.querySelector<HTMLElement>('.game-task')!.getBoundingClientRect();
			const unit = service.board.get().units[0];
			assert.deepStrictEqual({
				separated: a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom,
				inBounds: unit.x >= 6 && unit.x <= 94 && unit.y >= 10 && unit.y <= 88,
				assigned: unit.taskId, requests,
			}, { separated: true, inBounds: true, assigned: taskId, requests: [] });
		});
	}

	for (const zoom of [0.5, 1, 2]) {
		for (const kind of ['unit', 'task']) {
			test(`dragging a ${kind} preserves its grab offset at ${zoom} zoom`, async () => {
				const { map, viewport, service, storage, requests } = mapHarness();
				const id = kind === 'unit' ? service.spawn() : service.addTask('Build', 'Build the feature');
				service.move(id, { x: 30, y: 35 });
				map.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -Math.log(zoom) / 0.002, bubbles: true, cancelable: true }));
				viewport.scrollLeft = 100;
				viewport.scrollTop = 40;
				const node = map.querySelector<HTMLElement>(`.game-${kind}`)!;
				node.scrollIntoView({ block: 'center', inline: 'center' });
				const capture = stub(node, 'setPointerCapture');
				store.add(toDisposable(() => capture.restore()));
				const results = [];
				for (const side of [-1, 1]) {
					const before = node.getBoundingClientRect();
					const start = { clientX: before.left + before.width * (side < 0 ? 0.2 : 0.8), clientY: before.top + before.height * 0.25 };
					const end = { clientX: start.clientX + 30, clientY: start.clientY + 15 };
					node.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, ...start, bubbles: true }));
					node.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, ...end, bubbles: true }));
					const preview = node.getBoundingClientRect();
					node.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, ...end, bubbles: true }));
					await timeout(0);
					const saved = node.getBoundingClientRect();
					results.push({
						preview: [Math.round(preview.left - before.left), Math.round(preview.top - before.top)],
						saved: [Math.round(saved.left - before.left), Math.round(saved.top - before.top)],
					});
				}
				const restored = createGameHarness(store, storage);
				const positions = (board: typeof restored.service.board) => [...board.get().tasks, ...board.get().units].map(({ id, x, y }) => ({ id, x, y }));
				assert.deepStrictEqual({
					results, persisted: positions(restored.service.board), requests,
				}, {
					results: [
						{ preview: [30, 15], saved: [30, 15] },
						{ preview: [30, 15], saved: [30, 15] },
					],
					persisted: positions(service.board), requests: [],
				});
			});
		}
	}

	test('canceling a repelled drag restores the original position and assignment', () => {
		const { map, service, requests } = mapHarness();
		service.addTask('Build', 'Build the feature');
		service.spawn();
		const board = service.board.get();
		const blob = map.querySelector<HTMLElement>('.game-unit')!;
		const task = map.querySelector<HTMLElement>('.game-task')!.getBoundingClientRect();
		const original = { left: blob.style.left, top: blob.style.top };
		const capture = stub(blob, 'setPointerCapture');
		store.add(toDisposable(() => capture.restore()));
		const bounds = blob.getBoundingClientRect();
		blob.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2, bubbles: true }));
		blob.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: task.left + task.width / 2, clientY: task.top + task.height / 2, bubbles: true }));
		blob.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert.deepStrictEqual({
			position: { left: blob.style.left, top: blob.style.top },
			boardUnchanged: service.board.get() === board, requests,
		}, { position: original, boardUnchanged: true, requests: [] });
	});

	for (const zoom of [0.5, 1, 2]) {
		test(`dragging over a task pushes the blob out in preview and saves its separated position at ${zoom} zoom`, async () => {
			const { map, viewport, service, storage, requests } = mapHarness();
			const taskId = service.addTask('Build', 'Build the feature');
			service.move(taskId, { x: 25, y: 30 });
			const unitId = service.spawn();
			map.dispatchEvent(new WheelEvent('wheel', { shiftKey: true, deltaY: -Math.log(zoom) / 0.002, bubbles: true, cancelable: true }));
			const blob = map.querySelector<HTMLElement>('.game-unit')!;
			const task = map.querySelector<HTMLElement>('.game-task')!;
			const capture = stub(blob, 'setPointerCapture');
			store.add(toDisposable(() => capture.restore()));
			viewport.scrollLeft = 100;
			viewport.scrollTop = 40;
			const rect = map.getBoundingClientRect();
			const target = { clientX: rect.left + rect.width * 0.25, clientY: rect.top + rect.height * 0.3 };
			const separated = () => {
				const a = blob.getBoundingClientRect();
				const b = task.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0 && (a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
			};
			const bounds = blob.getBoundingClientRect();
			blob.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2, bubbles: true }));
			blob.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, ...target, bubbles: true }));
			const previewSeparated = separated();
			const highlighted = task.classList.contains('game-drop-target');
			blob.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, ...target, bubbles: true }));
			await timeout(0);
			const unit = service.board.get().units.find(unit => unit.id === unitId)!;
			const restored = createGameHarness(store, storage).service.board.get().units.find(unit => unit.id === unitId)!;
			assert.deepStrictEqual({
				previewSeparated, highlighted, savedSeparated: separated(),
				assigned: unit.taskId, persisted: [restored.x, restored.y], position: [unit.x, unit.y], requests,
			}, {
				previewSeparated: true, highlighted: true, savedSeparated: true,
				assigned: taskId, persisted: [unit.x, unit.y], position: [unit.x, unit.y], requests: [],
			});
		});
	}

	test('task assignment rings render the enlarged assignment diameter after resizing', () => {
		const harness = createGameHarness(store);
		const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
		instantiation.stub(IGameService, harness.service);
		instantiation.stub(ISessionsManagementService, harness.management);
		instantiation.stub(ISessionsService, new class extends mock<ISessionsService>() { });
		const widget = store.add(instantiation.createInstance(GameWidget, {}));
		document.body.appendChild(widget.element);
		store.add(toDisposable(() => widget.element.remove()));
		const taskId = harness.service.addTask('Build', 'Build the feature');
		const map = widget.element.querySelector<HTMLElement>('.game-map')!;
		const task = widget.element.querySelector<HTMLElement>('.game-task')!;
		task.classList.add('game-drop-target');
		const sizes = [1000, 640].map(width => {
			widget.element.style.width = `${width}px`;
			widget.layout(width, 620);
			harness.service.move(taskId, { x: 50, y: 50 });
			const ring = getComputedStyle(task, '::before');
			return {
				width: Math.round(parseFloat(ring.width) / map.clientWidth * 100),
				height: Math.round(parseFloat(ring.height) / map.clientHeight * 100),
				pointerEvents: ring.pointerEvents,
			};
		});
		assert.deepStrictEqual(sizes, [
			{ width: 88, height: 88, pointerEvents: 'none' },
			{ width: 88, height: 88, pointerEvents: 'none' },
		]);
	});

	for (const taskFirst of [true, false]) {
		test(`task sites render above all blobs when created ${taskFirst ? 'before' : 'after'} them`, () => {
			const harness = createGameHarness(store);
			const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
			instantiation.stub(IGameService, harness.service);
			instantiation.stub(ISessionsManagementService, harness.management);
			instantiation.stub(ISessionsService, new class extends mock<ISessionsService>() { });
			const widget = store.add(instantiation.createInstance(GameWidget, {}));
			document.body.appendChild(widget.element);
			store.add(toDisposable(() => widget.element.remove()));
			widget.element.style.width = '1000px';
			widget.layout(1000, 620);
			if (taskFirst) {
				harness.service.addTask('Fix search', 'Fix the search bug');
			}
			const session = gameTestSession('parent');
			session.chats.set([...session.chats.get(), gameTestChat('child')], undefined);
			harness.sessions.push(session);
			harness.service.recruit(session);
			harness.service.spawn();
			if (!taskFirst) {
				harness.service.addTask('Fix search', 'Fix the search bug');
			}
			const task = widget.element.querySelector<HTMLElement>('.game-task')!;
			const blobs = [...widget.element.querySelectorAll<HTMLElement>('.game-unit')];
			for (const node of [task, ...blobs]) {
				node.style.left = '25%';
				node.style.top = '25%';
			}
			const taskIsOnTop = () => [...task.children].every(child => {
				const bounds = child.getBoundingClientRect();
				return document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)?.closest('.game-map-node') === task;
			});
			const resting = taskIsOnTop();
			for (const blob of blobs) {
				blob.classList.add('game-selected', 'game-dragging');
				blob.focus();
			}
			const draggingBlobs = taskIsOnTop();
			task.classList.add('game-dragging');
			const draggingTask = taskIsOnTop();
			task.classList.remove('game-dragging');
			task.classList.add('game-minimized');
			assert.deepStrictEqual({
				blobs: blobs.length,
				children: blobs.filter(blob => blob.classList.contains('game-child')).length,
				resting, draggingBlobs, draggingTask, minimized: taskIsOnTop(),
			}, {
				blobs: 3, children: 1,
				resting: true, draggingBlobs: true, draggingTask: true, minimized: true,
			});
		});
	}

	for (const activation of ['click', 'Enter', 'Space']) {
		test(`detail pane name supports renaming via ${activation} and persists without dispatch`, async () => {
			const harness = createGameHarness(store);
			const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
			instantiation.stub(IGameService, harness.service);
			instantiation.stub(ISessionsManagementService, harness.management);
			instantiation.stub(ISessionsService, new class extends mock<ISessionsService>() { });
			const initialNames: (string | undefined)[] = [];
			instantiation.stub(IQuickInputService, new class extends mock<IQuickInputService>() {
				override async input(options?: IInputOptions): Promise<string | undefined> {
					initialNames.push(options?.value);
					return '  Pathfinder  ';
				}
			});
			const widget = store.add(instantiation.createInstance(GameWidget, {}));
			document.body.appendChild(widget.element);
			store.add(toDisposable(() => widget.element.remove()));
			harness.service.spawn();
			widget.element.querySelector<HTMLElement>('.game-unit')!.click();
			const initialName = harness.service.board.get().units[0].name;
			const name = widget.element.querySelector<HTMLElement>('.game-selection-name')!;
			name.focus();
			if (activation === 'click') {
				name.click();
			} else {
				name.dispatchEvent(new KeyboardEvent('keydown', {
					key: activation === 'Enter' ? 'Enter' : ' ',
					keyCode: activation === 'Enter' ? 13 : 32,
					bubbles: true,
				}));
			}
			await timeout(0);
			const restored = createGameHarness(store, harness.storage);
			assert.deepStrictEqual({
				initialNames,
				name: name.textContent,
				ariaLabel: name.getAttribute('aria-label'),
				mapName: widget.element.querySelector('.game-unit .game-node-label')!.textContent,
				restoredName: restored.service.board.get().units[0].name,
				requests: harness.requests,
			}, {
				initialNames: [initialName],
				name: 'Pathfinder',
				ariaLabel: 'Rename Blob: Pathfinder',
				mapName: 'Pathfinder',
				restoredName: 'Pathfinder',
				requests: [],
			});
		});
	}

	test('canceling a detail pane blob rename preserves the name', async () => {
		const harness = createGameHarness(store);
		const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
		instantiation.stub(IGameService, harness.service);
		instantiation.stub(ISessionsManagementService, harness.management);
		instantiation.stub(ISessionsService, new class extends mock<ISessionsService>() { });
		instantiation.stub(IQuickInputService, new class extends mock<IQuickInputService>() {
			override async input(): Promise<string | undefined> { return undefined; }
		});
		const widget = store.add(instantiation.createInstance(GameWidget, {}));
		document.body.appendChild(widget.element);
		store.add(toDisposable(() => widget.element.remove()));
		const name = widget.element.querySelector<HTMLElement>('.game-selection-name')!;
		const welcomeDisplay = name.style.display;
		harness.service.addTask('Fix search', 'Fix the search bug');
		widget.element.querySelector<HTMLElement>('.game-task')!.click();
		const taskDisplay = name.style.display;
		harness.service.spawn();
		widget.element.querySelector<HTMLElement>('.game-unit')!.click();
		const initialName = harness.service.board.get().units[0].name;
		name.click();
		await timeout(0);
		assert.deepStrictEqual({
			welcomeDisplay, taskDisplay, unitDisplay: name.style.display,
			name: harness.service.board.get().units[0].name,
			requests: harness.requests,
		}, {
			welcomeDisplay: 'none', taskDisplay: '', unitDisplay: '',
			name: initialName, requests: [],
		});
	});

	function taskEditorHarness() {
		const harness = createGameHarness(store);
		const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
		instantiation.stub(IGameService, harness.service);
		instantiation.stub(ISessionsManagementService, harness.management);
		instantiation.stub(ISessionsService, new class extends mock<ISessionsService>() { });
		const errors: string[] = [];
		instantiation.stub(INotificationService, new class extends mock<INotificationService>() {
			override error(message: string): void { errors.push(message); }
		});
		const widget = store.add(instantiation.createInstance(GameWidget, {}));
		document.body.appendChild(widget.element);
		store.add(toDisposable(() => widget.element.remove()));
		const taskId = harness.service.addTask('Fix search', 'Fix the search bug\nAdd regression tests');
		widget.element.querySelector<HTMLElement>('.game-task')!.click();
		return { ...harness, widget, taskId, errors };
	}

	for (const field of ['title', 'prompt'] as const) {
		for (const activation of ['click', 'Enter', 'Space']) {
			test(`task ${field} supports editing via ${activation} and persists without dispatch`, async () => {
				const { widget, service, storage, requests } = taskEditorHarness();
				const source = widget.element.querySelector<HTMLElement>(field === 'title' ? '.game-selection-name' : '.game-selection-description')!;
				source.focus();
				if (activation === 'click') {
					source.click();
				} else {
					source.dispatchEvent(new KeyboardEvent('keydown', {
						key: activation === 'Enter' ? 'Enter' : ' ',
						keyCode: activation === 'Enter' ? 13 : 32,
						bubbles: true,
					}));
				}
				const input = widget.element.querySelector<HTMLInputElement | HTMLTextAreaElement>('.game-task-editor .input')!;
				const initialValue = input.value;
				const initiallyFocused = document.activeElement === input;
				const value = field === 'title' ? 'Search improvements' : 'Fix search and filtering\nVerify keyboard navigation';
				input.value = `  ${value}  `;
				input.dispatchEvent(new Event('input', { bubbles: true }));
				service.spawn();
				const draftAfterRefresh = input.value;
				if (activation === 'click') {
					widget.element.querySelector<HTMLElement>('.game-task-edit-actions .monaco-button')!.click();
				} else {
					input.dispatchEvent(new KeyboardEvent('keydown', {
						key: 'Enter', keyCode: 13, bubbles: true,
						ctrlKey: field === 'prompt' && activation === 'Enter',
						metaKey: field === 'prompt' && activation === 'Space',
					}));
				}
				await timeout(0);
				const restored = createGameHarness(store, storage);
				assert.deepStrictEqual({
					initialValue, initiallyFocused, draftAfterRefresh,
					value: service.board.get().tasks[0][field],
					restored: restored.service.board.get().tasks[0][field],
					label: source.textContent,
					mapTitle: widget.element.querySelector('.game-task .game-node-label')!.textContent,
					brief: widget.element.querySelector('.game-order-preview')!.textContent,
					editorClosed: !widget.element.querySelector('.game-task-editor'),
					focusRestored: document.activeElement === source,
					requests,
				}, {
					initialValue: field === 'title' ? 'Fix search' : 'Fix the search bug\nAdd regression tests',
					initiallyFocused: true, draftAfterRefresh: `  ${value}  `,
					value, restored: value, label: value,
					mapTitle: field === 'title' ? value : 'Fix search',
					brief: field === 'prompt' ? value : 'Fix the search bug\nAdd regression tests',
					editorClosed: true, focusRestored: true, requests: [],
				});
			});
		}
	}

	for (const cancel of ['Escape', 'Cancel', 'selection', 'removal']) {
		test(`task editing discards unsaved changes on ${cancel}`, () => {
			const { widget, service, taskId, requests } = taskEditorHarness();
			const source = widget.element.querySelector<HTMLElement>('.game-selection-description')!;
			source.click();
			const input = widget.element.querySelector<HTMLTextAreaElement>('.game-task-editor textarea')!;
			input.value = 'Unsaved description';
			if (cancel === 'Escape') {
				input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
			} else if (cancel === 'Cancel') {
				widget.element.querySelectorAll<HTMLElement>('.game-task-edit-actions .monaco-button')[1].click();
			} else if (cancel === 'selection') {
				service.spawn();
				widget.element.querySelector<HTMLElement>('.game-unit')!.click();
			} else {
				service.remove(taskId);
			}
			assert.deepStrictEqual({
				prompt: service.board.get().tasks[0]?.prompt,
				editorClosed: !widget.element.querySelector('.game-task-editor'),
				focusRestored: cancel === 'Escape' || cancel === 'Cancel' ? document.activeElement === source : undefined,
				requests,
			}, {
				prompt: cancel === 'removal' ? undefined : 'Fix the search bug\nAdd regression tests',
				editorClosed: true,
				focusRestored: cancel === 'Escape' || cancel === 'Cancel' ? true : undefined,
				requests: [],
			});
		});
	}

	test('an empty task title reports an error and keeps the editor open', async () => {
		const { widget, service, errors, requests } = taskEditorHarness();
		widget.element.querySelector<HTMLElement>('.game-selection-name')!.click();
		widget.element.querySelector<HTMLInputElement>('.game-task-editor input')!.value = '  ';
		widget.element.querySelector<HTMLElement>('.game-task-edit-actions .monaco-button')!.click();
		await timeout(0);
		assert.deepStrictEqual({
			title: service.board.get().tasks[0].title,
			editorOpen: !!widget.element.querySelector('.game-task-editor'),
			errors, requests,
		}, {
			title: 'Fix search', editorOpen: true,
			errors: ['Give the task a title and description.'], requests: [],
		});
	});

	test('Enter saves a task description and restores focus without dispatch', async () => {
		const { widget, service, storage, requests } = taskEditorHarness();
		const source = widget.element.querySelector<HTMLElement>('.game-selection-description')!;
		source.click();
		const input = widget.element.querySelector<HTMLTextAreaElement>('.game-task-editor textarea')!;
		input.value = 'Fix search and filtering\nVerify keyboard navigation';
		const enter = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
		input.dispatchEvent(enter);
		await timeout(0);
		const restored = createGameHarness(store, storage);
		assert.deepStrictEqual({
			prompt: service.board.get().tasks[0].prompt,
			restored: restored.service.board.get().tasks[0].prompt,
			editorClosed: !widget.element.querySelector('.game-task-editor'),
			focusRestored: document.activeElement === source,
			prevented: enter.defaultPrevented,
			requests,
		}, {
			prompt: 'Fix search and filtering\nVerify keyboard navigation',
			restored: 'Fix search and filtering\nVerify keyboard navigation',
			editorClosed: true, focusRestored: true, prevented: true, requests: [],
		});
	});

	test('Shift+Enter description newlines and IME confirmation do not save or dispatch', async () => {
		const { widget, service, requests } = taskEditorHarness();
		widget.element.querySelector<HTMLElement>('.game-selection-description')!.click();
		const input = widget.element.querySelector<HTMLTextAreaElement>('.game-task-editor textarea')!;
		input.value = 'Unfinished edit';
		const newline = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, shiftKey: true, bubbles: true, cancelable: true });
		input.dispatchEvent(newline);
		const composition = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, isComposing: true, bubbles: true, cancelable: true });
		input.dispatchEvent(composition);
		await timeout(0);
		assert.deepStrictEqual({
			prompt: service.board.get().tasks[0].prompt,
			editorOpen: !!widget.element.querySelector('.game-task-editor'),
			prevented: [newline.defaultPrevented, composition.defaultPrevented],
			requests,
		}, {
			prompt: 'Fix the search bug\nAdd regression tests',
			editorOpen: true, prevented: [false, false], requests: [],
		});
	});

	function contextMenuHarness() {
		const harness = createGameHarness(store);
		const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
		let actions: readonly IAction[] = [];
		const commands: { id: string; args: readonly unknown[] }[] = [];
		instantiation.stub(IGameService, harness.service);
		instantiation.stub(ISessionsManagementService, harness.management);
		instantiation.stub(ISessionsService, new class extends mock<ISessionsService>() { });
		instantiation.stub(IContextMenuService, new class extends mock<IContextMenuService>() {
			override showContextMenu(delegate: Parameters<IContextMenuService['showContextMenu']>[0]): void {
				actions = delegate.getActions?.() ?? [];
			}
		});
		instantiation.stub(ICommandService, new class extends mock<ICommandService>() {
			override async executeCommand<T>(id: string, ...args: unknown[]): Promise<T | undefined> {
				commands.push({ id, args });
				return undefined;
			}
		});
		const widget = store.add(instantiation.createInstance(GameWidget, {}));
		document.body.appendChild(widget.element);
		store.add(toDisposable(() => widget.element.remove()));
		return { ...harness, widget, commands, instantiation, actions: () => actions };
	}

	test('Mark Blobs as Done uses the session list action once per session and removes drafts and archived blobs', async () => {
		const harness = contextMenuHarness();
		const first = gameTestSession('first');
		first.chats.set([...first.chats.get(), gameTestChat('child')], undefined);
		const second = gameTestSession('second');
		harness.sessions.push(first, second);
		harness.service.recruit(first);
		harness.service.recruit(second);
		harness.service.spawn();
		const unrelated = harness.service.spawn();
		const marked: string[] = [];
		harness.instantiation.stub(ISessionsManagementService, {
			archiveSession: async session => {
				marked.push(session.sessionId);
				harness.archived.fire(session);
			},
		});
		const commandService = harness.instantiation.get(ICommandService);
		const command = stub(commandService, 'executeCommand').callsFake(async (_id, context) => {
			assert.ok(Array.isArray(context));
			await harness.instantiation.invokeFunction(accessor => new ArchiveSessionAction().run(accessor, context));
			return undefined;
		});
		store.add(toDisposable(() => command.restore()));
		const blobs = [...harness.widget.element.querySelectorAll<HTMLElement>('.game-map .game-unit')];
		for (const blob of blobs.slice(0, -1)) {
			blob.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		}
		const button = harness.widget.element.querySelector<HTMLElement>('.game-mark-done')!;
		const enabled = button.getAttribute('aria-disabled');
		button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
		await timeout(0);
		assert.deepStrictEqual({
			enabled, marked, command: command.args,
			remaining: harness.service.board.get().units.map(unit => unit.id),
			portraits: harness.widget.element.querySelectorAll('.game-portrait').length,
			hidden: button.style.display, requests: harness.requests,
		}, {
			enabled: 'false', marked: ['first', 'second'], command: [[ARCHIVE_SESSION_COMMAND_ID, [first, second]]],
			remaining: [unrelated], portraits: 0, hidden: 'none', requests: [],
		});
	});

	test('Mark Blobs as Done requires the parent session blob when selecting child chats', async () => {
		const harness = contextMenuHarness();
		const session = gameTestSession('parent');
		session.chats.set([...session.chats.get(), gameTestChat('child-1'), gameTestChat('child-2')], undefined);
		harness.sessions.push(session);
		harness.service.recruit(session);
		const button = harness.widget.element.querySelector<HTMLElement>('.game-mark-done')!;
		const empty = button.style.display;
		const blobs = harness.widget.element.querySelectorAll<HTMLElement>('.game-map .game-unit');
		blobs[1].click();
		const single = button.style.display;
		blobs[2].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		const children = { display: button.style.display, disabled: button.getAttribute('aria-disabled') };
		button.click();
		await timeout(0);
		const blockedCommands = harness.commands.length;
		blobs[0].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		const withParent = button.getAttribute('aria-disabled');
		button.click();
		await timeout(0);
		assert.deepStrictEqual({ empty, single, children, blockedCommands, withParent, commands: harness.commands }, {
			empty: 'none', single: 'none', children: { display: '', disabled: 'true' }, blockedCommands: 0,
			withParent: 'false', commands: [{ id: ARCHIVE_SESSION_COMMAND_ID, args: [[session]] }],
		});
	});

	test('Mark Blobs as Done removes draft-only selections locally and rejects missing sessions', async () => {
		const harness = contextMenuHarness();
		const session = gameTestSession('missing');
		harness.sessions.push(session);
		const linked = harness.service.recruit(session);
		harness.service.spawn();
		harness.service.spawn();
		harness.sessions.splice(0);
		harness.service.setDraft(linked, 'Unsent work');
		const blobs = [...harness.widget.element.querySelectorAll<HTMLElement>('.game-map .game-unit')];
		for (const blob of blobs) {
			blob.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		}
		const button = harness.widget.element.querySelector<HTMLElement>('.game-mark-done')!;
		const missingDisabled = button.getAttribute('aria-disabled');
		blobs[0].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		button.click();
		await timeout(0);
		assert.deepStrictEqual({
			missingDisabled, remaining: harness.service.board.get().units.map(unit => unit.id),
			commands: harness.commands, requests: harness.requests,
		}, { missingDisabled: 'true', remaining: [linked], commands: [], requests: [] });
	});

	test('Mark Blobs as Done blocks duplicate and conflicting actions and preserves selection on failure', async () => {
		const harness = contextMenuHarness();
		const session = gameTestSession('target');
		harness.sessions.push(session);
		harness.service.recruit(session);
		harness.service.spawn();
		const pending = new DeferredPromise<void>();
		const command = stub(harness.instantiation.get(ICommandService), 'executeCommand').returns(pending.p);
		store.add(toDisposable(() => command.restore()));
		const errors: string[] = [];
		const notification = stub(harness.instantiation.get(INotificationService), 'error').callsFake(message => { errors.push(String(message)); });
		store.add(toDisposable(() => notification.restore()));
		for (const blob of harness.widget.element.querySelectorAll<HTMLElement>('.game-map .game-unit')) {
			blob.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		}
		const button = harness.widget.element.querySelector<HTMLElement>('.game-mark-done')!;
		const deleteButton = harness.widget.element.querySelector<HTMLElement>('.game-delete-blobs')!;
		button.click();
		await timeout(0);
		const busy = [button.getAttribute('aria-disabled'), deleteButton.getAttribute('aria-disabled')];
		button.click();
		deleteButton.click();
		await pending.error(new Error('Could not mark session as done'));
		await timeout(0);
		assert.deepStrictEqual({
			busy, calls: command.callCount, errors,
			selected: harness.widget.element.querySelectorAll('.game-unit.game-selected').length,
			remaining: harness.service.board.get().units.length, enabled: button.getAttribute('aria-disabled'), requests: harness.requests,
		}, {
			busy: ['true', 'true'], calls: 1, errors: ['Could not mark session as done'],
			selected: 2, remaining: 2, enabled: 'false', requests: [],
		});
	});

	test('Mark Blobs as Done waits for selected blobs to finish dispatching', async () => {
		const harness = contextMenuHarness();
		const session = gameTestSession('dispatching');
		harness.sessions.push(session);
		const id = harness.service.recruit(session);
		harness.service.spawn();
		harness.service.setDraft(id, 'Continue the work');
		for (const blob of harness.widget.element.querySelectorAll<HTMLElement>('.game-map .game-unit')) {
			blob.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		}
		const pending = new DeferredPromise<void>();
		const send = stub(harness.management, 'sendBackgroundRequest').returns(pending.p);
		store.add(toDisposable(() => send.restore()));
		const button = harness.widget.element.querySelector<HTMLElement>('.game-mark-done')!;
		const request = harness.service.dispatch(id);
		const dispatching = button.getAttribute('aria-disabled');
		button.click();
		await pending.complete();
		await request;
		assert.deepStrictEqual({ dispatching, finished: button.getAttribute('aria-disabled'), commands: harness.commands }, {
			dispatching: 'true', finished: 'false', commands: [],
		});
	});

	test('blob mouse and keyboard menus offer session actions without acknowledgment or message toggles', () => {
		const harness = contextMenuHarness();
		harness.service.spawn();
		const blob = harness.widget.element.querySelector<HTMLElement>('.game-unit')!;
		blob.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		const labels = harness.actions().map(action => ({ label: action.label, enabled: action.enabled }));
		blob.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
		assert.deepStrictEqual({
			labels, keyboardLabels: harness.actions().map(action => action.label),
			detail: blob.querySelector('.game-node-detail'), blobHidden: blob.classList.contains('game-hidden'),
			requests: harness.requests,
		}, {
			labels: [{ label: 'Archive Session', enabled: false }, { label: 'Delete', enabled: true }],
			keyboardLabels: ['Archive Session', 'Delete'], detail: null, blobHidden: false, requests: [],
		});
	});

	test('Delete Blobs removes selected drafts only and clears their portraits without dispatching', async () => {
		const { widget, service, requests, commands } = contextMenuHarness();
		const first = service.spawn();
		const second = service.spawn();
		const remaining = service.spawn();
		const blobs = widget.element.querySelectorAll<HTMLElement>('.game-map .game-unit');
		blobs[0].click();
		blobs[1].dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		const button = widget.element.querySelector<HTMLElement>('.game-delete-blobs')!;
		const enabled = button.getAttribute('aria-disabled');
		button.click();
		await timeout(0);
		assert.deepStrictEqual({
			enabled, ids: service.board.get().units.map(unit => unit.id), removed: !service.units.get().some(unit => unit.id === first || unit.id === second),
			portraits: widget.element.querySelectorAll('.game-portrait').length,
			disabled: button.getAttribute('aria-disabled'), commands, requests,
		}, { enabled: 'false', ids: [remaining], removed: true, portraits: 0, disabled: 'true', commands: [], requests: [] });
	});

	test('Delete Blobs batches sessions, deduplicates selected child chats, and retains selection when canceled', async () => {
		const harness = contextMenuHarness();
		const first = gameTestSession('first');
		first.chats.set([...first.chats.get(), gameTestChat('child')], undefined);
		const second = gameTestSession('second');
		harness.sessions.push(first, second);
		harness.service.recruit(first);
		harness.service.recruit(second);
		for (const blob of harness.widget.element.querySelectorAll<HTMLElement>('.game-map .game-unit')) {
			blob.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		}
		const before = harness.service.board.get();
		harness.widget.element.querySelector<HTMLElement>('.game-delete-blobs')!.click();
		await timeout(0);
		const canceled = {
			boardUnchanged: harness.service.board.get() === before,
			selected: harness.widget.element.querySelectorAll('.game-map .game-selected').length,
		};
		harness.deleted.fire(first);
		harness.deleted.fire(second);
		assert.deepStrictEqual({
			commands: harness.commands, chatCalls: harness.chatDeletions.length, canceled,
			portraits: harness.widget.element.querySelectorAll('.game-portrait').length, requests: harness.requests,
		}, {
			commands: [{ id: 'sessionsViewPane.deleteSession', args: [[first, second]] }], chatCalls: 0,
			canceled: { boardUnchanged: true, selected: 3 }, portraits: 0, requests: [],
		});
	});

	test('Delete Blobs targets selected child chats without deleting the parent session', async () => {
		const harness = contextMenuHarness();
		const session = gameTestSession('parent');
		const child = gameTestChat('child');
		session.chats.set([...session.chats.get(), child], undefined);
		harness.sessions.push(session);
		harness.service.recruit(session);
		harness.widget.element.querySelector<HTMLElement>('.game-map .game-child')!.click();
		harness.widget.element.querySelector<HTMLElement>('.game-delete-blobs')!.click();
		await timeout(0);
		assert.deepStrictEqual({
			chats: harness.chatDeletions.map(deletion => ({ correctSession: deletion.session === session, chat: deletion.chat.toString() })),
			commands: harness.commands, requests: harness.requests,
		}, {
			chats: [{ correctSession: true, chat: child.resource.toString() }], commands: [], requests: [],
		});
	});

	test('Delete Blobs is disabled for unsupported selections rather than partially deleting them', () => {
		const harness = contextMenuHarness();
		const session = { ...gameTestSession('unsupported'), capabilities: constObservable({ supportsMultipleChats: false, supportsDelete: false }) };
		harness.sessions.push(session);
		harness.service.recruit(session);
		harness.service.spawn();
		const button = harness.widget.element.querySelector<HTMLElement>('.game-delete-blobs')!;
		const empty = button.getAttribute('aria-disabled');
		for (const blob of harness.widget.element.querySelectorAll<HTMLElement>('.game-map .game-unit')) {
			blob.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		}
		assert.deepStrictEqual({ empty, mixed: button.getAttribute('aria-disabled'), commands: harness.commands, units: harness.service.units.get().length }, {
			empty: 'true', mixed: 'true', commands: [], units: 2,
		});
	});

	test('all blobs including automatic children have no second text row or background minimize action', () => {
		const harness = contextMenuHarness();
		const session = gameTestSession('parent');
		session.chats.set([...session.chats.get(), gameTestChat('child')], undefined);
		harness.sessions.push(session);
		harness.service.recruit(session);
		harness.service.spawn();
		const map = harness.widget.element.querySelector<HTMLElement>('.game-map')!;
		map.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		map.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }));
		assert.deepStrictEqual({
			actions: harness.actions(),
			blobs: map.querySelectorAll('.game-unit').length,
			messages: map.querySelectorAll('.game-unit .game-node-detail, .game-result-marker').length,
			requests: harness.requests,
		}, { actions: [], blobs: 3, messages: 0, requests: [] });
	});

	test('session context actions target the right-clicked session, not the previously selected blob', async () => {
		const harness = contextMenuHarness();
		const first = gameTestSession('first');
		const second = gameTestSession('second');
		harness.sessions.push(first, second);
		harness.service.recruit(first);
		harness.service.recruit(second);
		const blobs = harness.widget.element.querySelectorAll<HTMLElement>('.game-unit');
		blobs[0].click();
		blobs[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
		await harness.actions().find(action => action.id === 'game.markDone')!.run();
		await harness.actions().find(action => action.id === 'game.delete')!.run();
		await timeout(0);
		assert.deepStrictEqual(harness.commands, [
			{ id: ARCHIVE_SESSION_COMMAND_ID, args: [second] },
			{ id: 'sessionsViewPane.deleteSession', args: [second] },
		]);
	});

	test('opening a completed blob keyboard menu does not change status, archive, or dispatch', () => {
		const harness = contextMenuHarness();
		const first = gameTestSession('first');
		const second = gameTestSession('second');
		harness.sessions.push(first, second);
		harness.service.recruit(first);
		harness.service.recruit(second);
		const blobs = harness.widget.element.querySelectorAll<HTMLElement>('.game-unit');
		blobs[0].click();
		blobs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
		assert.deepStrictEqual({
			states: harness.service.units.get().map(unit => unit.status),
			actions: harness.actions().map(action => action.id),
			requests: harness.requests, commands: harness.commands,
		}, { states: [SessionStatus.Completed, SessionStatus.Completed], actions: ['game.markDone', 'game.delete'], requests: [], commands: [] });
	});

	test('spawn, keyboard movement, task assignment, draft editing, and compact layout never send until dispatch', async () => {
		const harness = createGameHarness(store);
		const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
		instantiation.stub(IGameService, harness.service);
		instantiation.stub(ISessionsManagementService, harness.management);
		instantiation.stub(ISessionsService, new class extends mock<ISessionsService>() { });
		const widget = store.add(instantiation.createInstance(GameWidget, {}));
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
			compact: widget.element.querySelector('.game-world')!.classList.contains('game-compact'),
			requests: harness.requests,
		}, {
			units: 1, movement: 3, task: taskId, draft: 'Include a regression test',
			tethers: 1, compact: true, requests: [],
		});
	});

	test('double-clicking a task minimizes it, hiding its assigned blobs and tethers, until double-clicked again', async () => {
		const harness = createGameHarness(store);
		const instantiation = workbenchInstantiationService(undefined, store.add(new DisposableStore()));
		instantiation.stub(IGameService, harness.service);
		instantiation.stub(ISessionsManagementService, harness.management);
		instantiation.stub(ISessionsService, new class extends mock<ISessionsService>() { });
		const widget = store.add(instantiation.createInstance(GameWidget, {}));
		document.body.appendChild(widget.element);
		store.add(toDisposable(() => widget.element.remove()));
		widget.element.style.width = '1000px';
		widget.layout(1000, 620);
		const taskId = harness.service.addTask('Fix search', 'Fix the search bug');
		const unitId = harness.service.spawn();
		harness.service.assign(unitId, taskId);
		await timeout(0);
		const task = widget.element.querySelector<HTMLElement>('.game-task')!;
		task.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await timeout(0);
		const afterMinimize = {
			minimized: harness.service.board.get().tasks[0].minimized,
			blobHidden: widget.element.querySelector('.game-unit')!.classList.contains('game-hidden'),
			tethers: widget.element.querySelectorAll('.game-tether').length,
		};
		task.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await timeout(0);
		const afterExpand = {
			minimized: harness.service.board.get().tasks[0].minimized,
			blobHidden: widget.element.querySelector('.game-unit')!.classList.contains('game-hidden'),
			tethers: widget.element.querySelectorAll('.game-tether').length,
		};
		assert.deepStrictEqual({ afterMinimize, afterExpand }, {
			afterMinimize: { minimized: true, blobHidden: true, tethers: 0 },
			afterExpand: { minimized: false, blobHidden: false, tethers: 1 },
		});
	});
});
