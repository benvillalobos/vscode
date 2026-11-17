/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMissionControlEnvironmentService } from '../../../../../platform/agentHost/common/missionControlEnvironment.js';
import { IRemoteAgentHostService } from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { IListService, ListService } from '../../../../../platform/list/browser/listService.js';
import { IAutomationService } from '../../../../../workbench/contrib/chat/common/automations/automationService.js';
import { ComponentFixtureContext, createEditorServices, defineComponentFixture, defineThemedFixtureGroup, registerWorkbenchServices } from '../../../../../workbench/test/browser/componentFixtures/fixtureUtils.js';
import { AutomationsTableWidget } from '../../browser/views/automationsTableWidget.js';
import { TableAutomationService, TableEnvironmentService, TableRemoteService } from './automationsTableTestUtils.js';

function render(ctx: ComponentFixtureContext, unavailable = false): void {
	ctx.container.style.width = '1100px';
	ctx.container.style.height = '560px';
	const automations = new TableAutomationService();
	if (unavailable) {
		automations.mutable = false;
		automations.catalogueState.set('unavailable', undefined);
		automations.unavailableProviders.set([{ id: 'local', label: 'This Computer', unavailableReasonCode: 'disconnected' }], undefined);
	}
	const instantiationService = createEditorServices(ctx.disposableStore, {
		colorTheme: ctx.theme,
		additionalServices: reg => {
			registerWorkbenchServices(reg);
			reg.define(IListService, ListService);
			reg.defineInstance(IAutomationService, automations);
			reg.defineInstance(IRemoteAgentHostService, new TableRemoteService());
			reg.defineInstance(IMissionControlEnvironmentService, new TableEnvironmentService());
		},
	});
	const widget = ctx.disposableStore.add(instantiationService.createInstance(AutomationsTableWidget, ctx.container, async () => { }));
	widget.layout();
}

export default defineThemedFixtureGroup({ path: 'sessions/automations/modal/' }, {
	ThreeAutomations: defineComponentFixture({ render: ctx => render(ctx) }),
	UnavailableProvider: defineComponentFixture({ render: ctx => render(ctx, true) }),
});
