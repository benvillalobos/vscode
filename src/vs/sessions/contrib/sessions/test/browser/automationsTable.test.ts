/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as dom from '../../../../../base/browser/dom.js';
import { Event as BaseEvent } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IMissionControlEnvironmentService } from '../../../../../platform/agentHost/common/missionControlEnvironment.js';
import { IRemoteAgentHostService } from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IAutomationDescriptor } from '../../../../../workbench/contrib/chat/common/automations/automation.js';
import { IAutomationService } from '../../../../../workbench/contrib/chat/common/automations/automationService.js';
import { workbenchInstantiationService } from '../../../../../workbench/test/browser/workbenchTestServices.js';
import { AutomationsTableWidget } from '../../browser/views/automationsTableWidget.js';
import { TableAutomationService, TableEnvironmentService, TableRemoteService, tableAutomation } from './automationsTableTestUtils.js';

suite('Automations modal table', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup(applyCommand = false) {
		const container = dom.append(dom.getActiveDocument().body, dom.$('div'));
		container.style.width = '1100px';
		container.style.height = '560px';
		store.add(toDisposable(() => container.remove()));
		const services = workbenchInstantiationService(undefined, store);
		const automations = new TableAutomationService();
		const commands: { id: string; args: readonly unknown[] }[] = [];
		services.stub(IAutomationService, automations);
		services.stub(IRemoteAgentHostService, new TableRemoteService());
		services.stub(IMissionControlEnvironmentService, new TableEnvironmentService());
		services.stub(IConfigurationService, new TestConfigurationService());
		services.stub(ICommandService, new class extends mock<ICommandService>() {
			override readonly onWillExecuteCommand = BaseEvent.None;
			override readonly onDidExecuteCommand = BaseEvent.None;
			override async executeCommand<T>(id: string, ...args: readonly unknown[]): Promise<T> {
				commands.push({ id, args });
				if (applyCommand && (id === 'sessions.automations.disable' || id === 'sessions.automations.enable')) {
					const automation = args[0] as IAutomationDescriptor;
					automations.automations.set(automations.automations.get().map(item => item.id === automation.id ? { ...item, enabled: id === 'sessions.automations.enable' } : item), undefined);
				}
				return undefined as T;
			}
		}());
		const widget = store.add(services.createInstance(AutomationsTableWidget, container, async () => { }));
		widget.layout();
		const click = (label: string) => {
			const button = [...container.querySelectorAll<HTMLElement>('.monaco-button')].find(button => button.textContent === label);
			assert.ok(button, label);
			button.click();
		};
		const names = () => [...container.querySelectorAll('.monaco-list-row')].map(row => row.querySelector('.automations-modal-cell')?.textContent);
		return { container, widget, automations, commands, click, names };
	}

	test('three definitions share real metadata, stable sorting and text/category filters', () => {
		const { container, widget, click, names } = setup();
		const initial = names();
		click('Name');
		const reversed = names();
		click('Repository (1)');
		const repository = names();
		click('All automations (3)');
		const input = container.querySelector<HTMLInputElement>('input');
		assert.ok(input);
		input.value = 'manual';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		assert.deepStrictEqual({ initial, reversed, repository, filtered: names(), summary: widget.getAccessibilityContent().includes('Manual'), host: widget.getAccessibilityContent().includes('Runs on This Computer') }, {
			initial: ['Alpha manual', 'Bravo daily', 'Charlie shared'],
			reversed: ['Charlie shared', 'Bravo daily', 'Alpha manual'],
			repository: ['Charlie shared'],
			filtered: ['Alpha manual'],
			summary: true,
			host: true,
		});
	});

	test('enable checkbox delegates to the existing guarded command without optimistic state', async () => {
		const { container, automations, commands } = setup();
		const checkbox = container.querySelector<HTMLElement>('[role="checkbox"]');
		assert.ok(checkbox);
		checkbox.click();
		await Promise.resolve();
		assert.deepStrictEqual({
			command: commands[0]?.id,
			id: (commands[0]?.args[0] as IAutomationDescriptor).id,
			enabled: automations.getAutomation('alpha')?.enabled,
			checked: checkbox.getAttribute('aria-checked'),
		}, { command: 'sessions.automations.disable', id: 'alpha', enabled: true, checked: 'true' });
	});

	test('provider loss disables mutations but retains readable catalogue and reasons', () => {
		const { container, automations, widget } = setup();
		automations.mutable = false;
		automations.unavailableProviders.set([{ id: 'local', label: 'This Computer', unavailableReasonCode: 'disconnected' }], undefined);
		automations.catalogueState.set('unavailable', undefined);
		assert.deepStrictEqual({
			disabled: [...container.querySelectorAll('[role="checkbox"]')].every(element => element.getAttribute('aria-disabled') === 'true'),
			rows: container.querySelectorAll('.monaco-list-row').length,
			reason: widget.getAccessibilityContent().includes('disconnected'),
		}, { disabled: true, rows: 3, reason: true });
	});

	test('provider acknowledgement during a pending toggle keeps the row editable', async () => {
		const { container, commands } = setup(true);
		const initial = container.querySelector<HTMLElement>('[role="checkbox"]');
		assert.ok(initial);
		initial.focus();
		initial.click();
		await Promise.resolve();
		await Promise.resolve();
		const checkbox = container.querySelector<HTMLElement>('[role="checkbox"]');
		assert.ok(checkbox);
		assert.deepStrictEqual({
			command: commands[0]?.id,
			checked: checkbox.getAttribute('aria-checked'),
			label: checkbox.getAttribute('aria-label'),
			disabled: checkbox.getAttribute('aria-disabled') === 'true',
			focused: checkbox === dom.getActiveElement(),
		}, { command: 'sessions.automations.disable', checked: 'false', label: 'Enable automation Alpha manual', disabled: false, focused: true });
	});

	test('authoritative updates preserve filtered state and disposal removes the presentation', () => {
		const { container, automations, widget, click, names } = setup();
		click('Personal (2)');
		automations.automations.set([tableAutomation('new', 'New definition', { enabled: false })], undefined);
		const updated = names();
		widget.dispose();
		automations.automations.set([], undefined);
		assert.deepStrictEqual({ updated, children: container.childElementCount, refreshes: automations.refreshCalls }, {
			updated: ['New definition'], children: 0, refreshes: 1,
		});
	});

	test('narrow table scrolls headers and cells together and returns to a wide layout', () => {
		const { container, widget } = setup();
		container.style.width = '700px';
		widget.layout();
		const viewport = container.querySelector<HTMLElement>('.automations-modal-table-viewport');
		const header = [...container.querySelectorAll<HTMLElement>('.monaco-table-th')].at(-1);
		const cell = container.querySelector<HTMLElement>('.monaco-list-row .monaco-table-td:last-child');
		assert.ok(viewport && header && cell);
		viewport.scrollLeft = viewport.scrollWidth;
		const narrow = {
			scrolled: viewport.scrollLeft > 0,
			aligned: Math.abs(header.getBoundingClientRect().left - cell.getBoundingClientRect().left) < 1,
		};
		container.style.width = '1100px';
		widget.layout();
		assert.deepStrictEqual({ narrow, wideScroll: viewport.scrollLeft }, { narrow: { scrolled: true, aligned: true }, wideScroll: 0 });
	});
});
