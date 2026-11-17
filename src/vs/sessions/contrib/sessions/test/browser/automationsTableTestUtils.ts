/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { constObservable, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { IMissionControlEnvironmentService } from '../../../../../platform/agentHost/common/missionControlEnvironment.js';
import { IRemoteAgentHostService } from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { IAutomationDescriptor, IAutomationRun } from '../../../../../workbench/contrib/chat/common/automations/automation.js';
import { AutomationCatalogueState, IAutomationProviderDescriptor, IAutomationService } from '../../../../../workbench/contrib/chat/common/automations/automationService.js';

export function tableAutomation(id: string, name: string, overrides: Partial<IAutomationDescriptor> = {}): IAutomationDescriptor {
	return {
		id, name, prompt: `Review ${name}`,
		schedule: { interval: 'daily', scheduleHour: 9, scheduleMinute: 0, scheduleDay: 1 },
		target: { kind: 'workspace', folderUri: URI.file('C:\\workspaces\\sample'), providerId: 'local', isolation: { kind: 'default' } },
		createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', enabled: true,
		...overrides,
	};
}

export class TableAutomationService extends mock<IAutomationService>() {
	override readonly automations = observableValue<readonly IAutomationDescriptor[]>(this, [
		tableAutomation('bravo', 'Bravo daily'),
		tableAutomation('alpha', 'Alpha manual', { schedule: { interval: 'manual', scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 } }),
		tableAutomation('charlie', 'Charlie shared', { ownership: 'repository', enabled: false }),
	]);
	override readonly runs = observableValue<readonly IAutomationRun[]>(this, [{
		id: 'run-1', automationId: 'bravo', status: 'completed', trigger: 'manual', startedAt: '2026-01-02T09:00:00Z',
	}]);
	override readonly catalogueState = observableValue<AutomationCatalogueState>(this, 'ready');
	override readonly availableProviders = constObservable<readonly IAutomationProviderDescriptor[]>([{ id: 'local', label: 'This Computer' }]);
	override readonly unavailableProviders = observableValue<readonly IAutomationProviderDescriptor[]>(this, []);
	refreshCalls = 0;
	mutable = true;
	override async refresh(): Promise<void> { this.refreshCalls++; }
	override getAutomation(id: string): IAutomationDescriptor | undefined { return this.automations.get().find(automation => automation.id === id); }
	override canUpdateAutomation(): boolean { return this.mutable; }
	override getProviderConfiguration(): undefined { return undefined; }
}

export class TableRemoteService extends mock<IRemoteAgentHostService>() {
	override readonly onDidChangeConfiguredEntries = Event.None;
	override readonly onDidChangeConnections = Event.None;
	override readonly configuredEntries = [];
	override readonly connections = [];
}

export class TableEnvironmentService extends mock<IMissionControlEnvironmentService>() {
	override readonly hosts = constObservable([]);
}
