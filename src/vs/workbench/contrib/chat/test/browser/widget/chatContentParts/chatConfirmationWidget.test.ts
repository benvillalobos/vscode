/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as sinon from 'sinon';
import { mainWindow } from '../../../../../../../base/browser/window.js';
import { Action, Separator } from '../../../../../../../base/common/actions.js';
import { constObservable, observableValue } from '../../../../../../../base/common/observable.js';
import { upcastPartial } from '../../../../../../../base/test/common/mock.js';
import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { DeferredPromise } from '../../../../../../../base/common/async.js';
import { URI } from '../../../../../../../base/common/uri.js';
import { MarkdownString } from '../../../../../../../base/common/htmlContent.js';
import { toDisposable } from '../../../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { IMarkdownRendererService } from '../../../../../../../platform/markdown/browser/markdownRenderer.js';
import { INotificationService } from '../../../../../../../platform/notification/common/notification.js';
import { workbenchInstantiationService } from '../../../../../../test/browser/workbenchTestServices.js';
import { ChatConfirmationWidget, ChatCustomConfirmationWidget, ChatQueryTitlePart, type IChatConfirmationButton } from '../../../../browser/widget/chatContentParts/chatConfirmationWidget.js';
import type { IChatContentPartRenderContext } from '../../../../browser/widget/chatContentParts/chatContentParts.js';
import { ChatTerminalToolExplanation } from '../../../../browser/widget/chatContentParts/toolInvocationParts/chatTerminalToolExplanation.js';
import { IChatSideChatService } from '../../../../common/chatSideChatService.js';
import { ChatElicitationRequestPart } from '../../../../common/model/chatProgressTypes/chatElicitationRequestPart.js';
import { ElicitationState } from '../../../../common/chatService/chatService.js';
import { ChatElicitationContentPart } from '../../../../browser/widget/chatContentParts/chatElicitationContentPart.js';
import { IChatAccessibilityService, IChatWidget, IChatWidgetService } from '../../../../browser/chat.js';
import { IChatResponseViewModel } from '../../../../common/model/chatViewModel.js';
import { EditorPool } from '../../../../browser/widget/chatContentParts/chatContentCodePools.js';
import { IChatOutputRendererService } from '../../../../browser/chatOutputItemRenderer.js';
import { ChatMarkdownContentPart } from '../../../../browser/widget/chatContentParts/chatMarkdownContentPart.js';
import { ChatEditorOptions } from '../../../../browser/widget/chatOptions.js';
import { IChatRendererDelegate } from '../../../../browser/widget/chatListRenderer.js';
import { EditorOption } from '../../../../../../../editor/common/config/editorOptions.js';
import { IUserInteractionService, MockUserInteractionService } from '../../../../../../../platform/userInteraction/browser/userInteractionService.js';
import { ITextModelService } from '../../../../../../../editor/common/services/resolverService.js';
import { IModelService } from '../../../../../../../editor/common/services/model.js';
import { Schemas } from '../../../../../../../base/common/network.js';

suite('ChatTerminalToolExplanation', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('explains only the current command in a fresh side chat, disabling repeated requests while pending', async () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const pending = new DeferredPromise<void>();
		const ask = sinon.spy(() => pending.p);
		instantiationService.stub(IChatSideChatService, { canAskInSideChat: () => true, askInSideChat: ask });
		let command = 'original';
		const resource = URI.parse('test:///secondary');
		const explanation = store.add(instantiationService.createInstance(ChatTerminalToolExplanation, resource, 'turn', () => command));
		const disabled: boolean[] = [];
		store.add(explanation.button!.onDidChangeDisablement!(value => disabled.push(value)));
		command = '  edited command  ';
		const first = explanation.explain();
		await explanation.explain();
		const disabledWhilePending = explanation.button!.disabled;
		await pending.complete();
		await first;
		assert.deepStrictEqual({
			calls: ask.getCalls().map(call => call.args),
			disabled, disabledWhilePending, disabledAfter: explanation.button!.disabled,
		}, {
			calls: [[resource, 'Explain what this terminal command will do. Do not run it.\n\n`edited command`', undefined, { sourceTurnId: 'turn', includeSourceContext: false }]],
			disabled: [true, false], disabledWhilePending: true, disabledAfter: false,
		});
	});

	test('formats shell backticks as part of the command rather than markdown delimiters', async () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const ask = sinon.spy(async (_resource: URI, _query: string) => { });
		instantiationService.stub(IChatSideChatService, { canAskInSideChat: () => true, askInSideChat: ask });
		const explanation = store.add(instantiationService.createInstance(ChatTerminalToolExplanation, URI.parse('test:///chat'), 'turn', () => 'echo `pwd`'));

		await explanation.explain();

		assert.strictEqual(ask.firstCall.args[1], 'Explain what this terminal command will do. Do not run it.\n\n`` echo `pwd` ``');
	});

	for (const [name, eol] of [['LF', '\n'], ['CRLF', '\r\n']]) {
		test(`preserves multiline commands with ${name} line endings and embedded backtick fences`, async () => {
			const instantiationService = workbenchInstantiationService(undefined, store);
			const ask = sinon.spy(async (_resource: URI, _query: string) => { });
			instantiationService.stub(IChatSideChatService, { canAskInSideChat: () => true, askInSideChat: ask });
			const command = ['cat <<\'EOF\'', 'first line', '', '```', 'last line', 'EOF'].join(eol);
			const explanation = store.add(instantiationService.createInstance(ChatTerminalToolExplanation, URI.parse('test:///chat'), 'turn', () => command));

			await explanation.explain();

			assert.strictEqual(ask.firstCall.args[1], `Explain what this terminal command will do. Do not run it.\n\n\`\`\`\`\n${command}\n\`\`\`\``);
		});
	}

	test('omits unsupported explanations and reports failures without leaving the action disabled', async () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		let supported = false;
		instantiationService.stub(IChatSideChatService, { canAskInSideChat: () => supported, askInSideChat: async () => { throw new Error('Unavailable'); } });
		const error = sinon.spy();
		instantiationService.stub(INotificationService, 'error', error);
		const explanation = store.add(instantiationService.createInstance(ChatTerminalToolExplanation, URI.parse('test:///chat'), undefined, () => 'command'));
		const unsupported = explanation.button;
		supported = true;
		await explanation.explain();
		assert.deepStrictEqual({ unsupported, disabled: explanation.button!.disabled, errors: error.getCalls().map(call => call.args[0]) }, {
			unsupported: undefined, disabled: false, errors: ['The side chat could not be started: Unavailable'],
		});
	});
});

suite('ChatQueryTitlePart', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	teardown(() => sinon.restore());

	test('renders plain tool titles without the markdown pipeline', () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const render = sinon.spy(instantiationService.get(IMarkdownRendererService), 'render');
		const titles: string[] = [];
		for (let i = 0; i < 200; i++) {
			const container = document.createElement('div');
			const title = `<tool-${i}> **literal** [details] $(check)`;
			store.add(instantiationService.createInstance(ChatQueryTitlePart, container, title, undefined, undefined));
			titles.push(container.textContent?.replace(/\u00a0/g, ' ') ?? '');
			assert.strictEqual(container.querySelector('a, img, strong, .codicon'), null);
		}
		assert.deepStrictEqual({ markdownRenders: render.callCount, first: titles[0], last: titles[199] }, {
			markdownRenders: 0,
			first: '<tool-0> **literal** [details] $(check)',
			last: '<tool-199> **literal** [details] $(check)',
		});
	});

	test('keeps markdown titles on the sanitized rendering path', () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const render = sinon.spy(instantiationService.get(IMarkdownRendererService), 'render');
		const container = document.createElement('div');
		const title = new MarkdownString('Read **file** [details](https://example.com)<script>alert(1)</script>');
		const part = store.add(instantiationService.createInstance(ChatQueryTitlePart, container, title, undefined, undefined));
		const formatted = !!container.querySelector('strong');
		const unsafe = !!container.querySelector('script');
		part.title = 'Done';
		assert.deepStrictEqual({ formatted, unsafe, text: container.textContent, markdownRenders: render.callCount }, {
			formatted: true, unsafe: false, text: 'Done', markdownRenders: 1,
		});
	});

	test('preserves the markup of escaped plain text, links, and multiline titles', () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const renderer = instantiationService.get(IMarkdownRendererService);
		for (const text of ['', 'Read file.ts', '  spaced\ttext  ', '<img src=x onerror=alert(1)> **literal** $(check)', '&copy; &amp;', 'Visit https://example.com', 'Contact test@example.com', 'First line\nSecond line', 'x'.repeat(100_001)]) {
			const expected = store.add(renderer.render(new MarkdownString('', { supportThemeIcons: true }).appendText(text)));
			const container = document.createElement('div');
			store.add(instantiationService.createInstance(ChatQueryTitlePart, container, text, undefined, undefined));
			assert.strictEqual(container.firstElementChild?.outerHTML, expected.element.outerHTML, text.slice(0, 100));
		}
	});

	test('applies initial markdown options without rendering the title twice', () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const render = sinon.spy(instantiationService.get(IMarkdownRendererService), 'render');
		const container = document.createElement('div');
		store.add(instantiationService.createInstance(ChatQueryTitlePart, container, new MarkdownString('Visit https://example.com'), undefined, {
			markdownRenderOptions: { markedOptions: { gfm: false } },
		}));
		assert.deepStrictEqual({ markdownRenders: render.callCount, hasLink: !!container.querySelector('a') }, {
			markdownRenders: 1, hasLink: false,
		});
	});
});

suite('Chat elicitation inline actions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	for (const restored of [false, true]) {
		test(`long literal input follows the card width without changing its text (${restored ? 'restored' : 'live'})`, async () => {
			const instantiationService = workbenchInstantiationService(undefined, store);
			instantiationService.stub(IChatAccessibilityService, upcastPartial<IChatAccessibilityService>({ acceptElicitation: () => { } }));
			instantiationService.stub(IChatOutputRendererService, upcastPartial<IChatOutputRendererService>({ hasCodeBlockRenderer: () => false }));
			instantiationService.stub(IUserInteractionService, new MockUserInteractionService());
			store.add(instantiationService.get(ITextModelService).registerTextModelContentProvider(Schemas.vscodeChatCodeBlock, {
				provideTextContent: async uri => instantiationService.get(IModelService).getModel(uri),
			}));
			const prompt = 'Keep <tags>, `backticks`, and [links](command:example) literal.\n\n' + 'Long paragraph with words to wrap. '.repeat(80);
			const review = new ChatElicitationRequestPart('Review', new MarkdownString().appendCodeblock('text', prompt), '', 'Approve', 'Cancel', async () => ElicitationState.Accepted);
			review.wrapCodeBlocks = true;
			const layout = sinon.spy(ChatMarkdownContentPart.prototype, 'layout');
			store.add(toDisposable(() => layout.restore()));
			const editorOptions = upcastPartial<ChatEditorOptions>({
				onDidChange: Event.None,
				configuration: {
					foreground: undefined, inputEditor: { backgroundColor: undefined, accessibilitySupport: 'off' },
					resultEditor: { fontSize: 14, lineHeight: 20, fontFamily: 'monospace', fontWeight: 'normal', backgroundColor: undefined, wordWrap: 'off', fontLigatures: false, bracketPairColorization: { enabled: false, independentColorPoolPerBracketType: false } },
				},
			});
			const editorPool = store.add(instantiationService.createInstance(EditorPool, editorOptions, upcastPartial<IChatRendererDelegate>({}), undefined, true));
			const data = restored ? review.toJSON() : review;
			const context = upcastPartial<IChatContentPartRenderContext>({
				element: upcastPartial<IChatResponseViewModel>({ id: 'response', sessionResource: URI.parse('test:///chat'), isComplete: restored }),
				content: [data], contentIndex: 0, currentWidth: constObservable(1000), editorPool, codeBlockStartIndex: 0,
			});
			const resizes: (() => void)[] = [];
			class TestResizeObserver implements ResizeObserver {
				constructor(callback: ResizeObserverCallback) {
					resizes.push(() => callback([], this));
				}
				observe(): void { }
				unobserve(): void { }
				disconnect(): void { }
			}
			const part = store.add(instantiationService.createInstance(ChatConfirmationWidget, context, {
				title: data.title, message: data.message, buttons: [],
				codeBlockRenderOptions: data.wrapCodeBlocks ? { editorOptions: { wordWrap: 'on', readOnly: true, scrollbar: { vertical: 'auto' } }, maxHeightInLines: 12, hideToolbar: true } : undefined,
				resizeObserverCtor: TestResizeObserver,
			}));
			const container = mainWindow.document.createElement('div');
			container.style.width = '320px';
			container.appendChild(part.domNode);
			mainWindow.document.body.append(container);
			store.add(toDisposable(() => container.remove()));
			const sizes: number[] = [];
			const block = [...editorPool.inUse()][0];
			const editorSizes: { width: number; height: number; scrollWidth: number }[] = [];
			for (const width of [320, 500, 280]) {
				container.style.width = `${width}px`;
				resizes.forEach(resize => resize());
				block.editor.render();
				sizes.push(layout.lastCall.args[0]);
				editorSizes.push({ width: block.editor.getLayoutInfo().width, height: block.editor.getLayoutInfo().height, scrollWidth: block.editor.getScrollWidth() });
			}
			assert.deepStrictEqual({
				text: block.editor.getModel()?.getLinesContent().join('\n').trimEnd(),
				wrap: block.editor.getOption(EditorOption.wordWrap),
				boundedHeight: editorSizes.every(size => size.height <= 240),
				noHorizontalScroll: editorSizes.every(size => size.scrollWidth <= size.width),
				fits: sizes.every((width, index) => width > 0 && width < [320, 500, 280][index]),
				resized: sizes[0] < sizes[1] && sizes[2] < sizes[0],
			}, { text: prompt.trimEnd(), wrap: 'on', boundedHeight: true, noHorizontalScroll: true, fits: true, resized: true });
		});
	}

	test('shows Edit beside Approve, disables pending decisions, and restores focus after settling', async () => {
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IChatAccessibilityService, upcastPartial<IChatAccessibilityService>({ acceptElicitation: () => { } }));
		const focusInput = sinon.spy();
		instantiationService.stub(IChatWidgetService, upcastPartial<IChatWidgetService>({
			getWidgetBySessionResource: () => upcastPartial<IChatWidget>({ focusInput }),
		}));
		const settled = new DeferredPromise<void>();
		const busy = observableValue('busy', false);
		const choices: string[] = [];
		const edit = store.add(new Action('edit', 'Edit'));
		const review = new ChatElicitationRequestPart('Review', 'Draft', '', 'Approve', 'Cancel', async choice => {
			choices.push(choice === edit ? 'edit' : 'approve');
			busy.set(true, undefined);
			await settled.p;
			busy.set(false, undefined);
			return ElicitationState.Rejected;
		}, async () => ElicitationState.Rejected);
		review.inlineActions = [edit];
		review.isBusy = busy;
		review.keepActionsWhilePending = true;
		const context = upcastPartial<IChatContentPartRenderContext>({
			element: upcastPartial<IChatResponseViewModel>({ id: 'response', sessionResource: URI.parse('test:///chat'), isComplete: false }),
			content: [review],
			contentIndex: 0,
			currentWidth: constObservable(600),
		});
		const part = store.add(instantiationService.createInstance(ChatElicitationContentPart, review, context));
		mainWindow.document.body.append(part.domNode);
		store.add(toDisposable(() => part.domNode.remove()));
		const buttons = [...part.domNode.querySelectorAll<HTMLElement>('.chat-buttons > .monaco-button')];
		const labels = buttons.map(button => button.textContent);
		buttons[1].focus();
		buttons[1].click();
		const disabled = buttons.map(button => button.getAttribute('aria-disabled'));
		await settled.complete();
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		assert.deepStrictEqual({ labels, disabled, choices, hidden: part.domNode.classList.contains('hideButtons'), focused: focusInput.calledOnce }, {
			labels: ['Approve', 'Edit', 'Cancel'], disabled: ['true', 'true', 'true'], choices: ['edit'], hidden: true, focused: true,
		});
	});
});

suite('ChatCustomConfirmationWidget', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createWidget(buttons: IChatConfirmationButton<boolean>[]): ChatCustomConfirmationWidget<boolean> {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const message = mainWindow.document.createElement('div');
		const widget = store.add(instantiationService.createInstance(
			ChatCustomConfirmationWidget<boolean>,
			{} as IChatContentPartRenderContext,
			{ title: 'Confirm', message, buttons }
		));
		mainWindow.document.body.appendChild(widget.domNode);
		store.add(toDisposable(() => widget.domNode.remove()));
		return widget;
	}

	function button(label: string, moreActions?: IChatConfirmationButton<boolean>[]): IChatConfirmationButton<boolean> {
		return { label, data: true, moreActions };
	}

	test('runs the current primary action with its original button data', () => {
		const widget = createWidget([button('Allow Once', [button('Always Allow')]), button('Skip')]);
		const clicks: { label: string; data: boolean; isTouchClick: boolean }[] = [];
		store.add(widget.onDidClick(({ button, isTouchClick }) => clicks.push({ label: button.label, data: button.data, isTouchClick })));

		widget.runPrimaryAction();
		widget.updateButtons([{ label: 'Deny Once', data: false, moreActions: [button('Always Deny')] }]);
		widget.runPrimaryAction();
		widget.updateButtons([]);
		widget.runPrimaryAction();

		assert.deepStrictEqual(clicks, [
			{ label: 'Allow Once', data: true, isTouchClick: false },
			{ label: 'Deny Once', data: false, isTouchClick: false },
		]);
	});

	test('does not run a disabled primary action or fall through to a secondary action', () => {
		const disablement = store.add(new Emitter<boolean>());
		const widget = createWidget([
			{ ...button('Reveal Selected'), disabled: true, onDidChangeDisablement: disablement.event },
			{ label: 'Cancel', data: false, isSecondary: true },
		]);
		const clicks: string[] = [];
		store.add(widget.onDidClick(({ button }) => clicks.push(button.label)));

		widget.runPrimaryAction();
		const initiallyDisabled = [...clicks];
		disablement.fire(false);
		widget.runPrimaryAction();
		disablement.fire(true);
		widget.runPrimaryAction();

		assert.deepStrictEqual({ initiallyDisabled, clicks }, { initiallyDisabled: [], clicks: ['Reveal Selected'] });
	});

	test('renders a dropdown only when a button has an additional action', () => {
		const widget = createWidget([
			button('Allow'),
			button('Allow Empty', []),
			{ ...button('Allow Separator'), moreActions: [new Separator()] },
			button('Allow More', [button('Always Allow')]),
		]);

		assert.deepStrictEqual(
			[...widget.domNode.querySelectorAll('.monaco-button-dropdown')].map(element => element.textContent),
			['Allow More']
		);
	});

	test('preserves focused button when buttons reorder', () => {
		const widget = createWidget([button('Allow'), button('Skip')]);
		const initialButtons = widget.domNode.querySelectorAll<HTMLElement>('.monaco-button');
		initialButtons[1].focus();

		const updatedButtons = [button('Skip'), button('Allow', [button('Always Allow')])];
		widget.updateButtons(updatedButtons);
		const renderedButtons = widget.domNode.querySelectorAll<HTMLElement>('.monaco-button');
		assert.strictEqual(mainWindow.document.activeElement, renderedButtons[0]);
	});

	test('preserves focus on dropdown control', () => {
		const widget = createWidget([button('Allow', [button('Always Allow')]), button('Skip')]);
		let renderedButtons = widget.domNode.querySelectorAll<HTMLElement>('.monaco-button');
		renderedButtons[1].focus();

		widget.updateButtons([button('Skip'), button('Allow', [button('Always Allow')])]);
		renderedButtons = widget.domNode.querySelectorAll<HTMLElement>('.monaco-button');
		assert.strictEqual(mainWindow.document.activeElement, renderedButtons[2]);
	});

	test('does not move focus when focused button is removed', () => {
		const widget = createWidget([button('Allow'), button('Skip')]);
		const initialButtons = widget.domNode.querySelectorAll<HTMLElement>('.monaco-button');
		initialButtons[1].focus();

		widget.updateButtons([button('Allow')]);
		const renderedButton = widget.domNode.querySelector<HTMLElement>('.monaco-button');
		assert.notStrictEqual(mainWindow.document.activeElement, renderedButton);
	});

	test('does not move focus from outside the widget', () => {
		const widget = createWidget([button('Allow'), button('Skip')]);
		const externalButton = mainWindow.document.createElement('button');
		mainWindow.document.body.appendChild(externalButton);
		store.add(toDisposable(() => externalButton.remove()));
		externalButton.focus();

		widget.updateButtons([button('Skip'), button('Allow')]);
		assert.strictEqual(mainWindow.document.activeElement, externalButton);
	});
});
