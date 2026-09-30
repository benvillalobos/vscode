/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../../platform/registry/common/platform.js';
import { CLOUD_AUTOMATIONS_ENABLED_SETTING } from '../../browser/cloudAutomationStore.js';
import '../../browser/copilotChatSessions.contribution.js';

const property = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties()[CLOUD_AUTOMATIONS_ENABLED_SETTING];

suite('Cloud Automation Configuration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('registers default-off experimental advanced management with an automatic treatment', () => {
		assert.deepStrictEqual({
			id: CLOUD_AUTOMATIONS_ENABLED_SETTING,
			type: property.type, default: property.default, scope: property.scope,
			experiment: property.experiment,
			experimental: property.tags?.includes('experimental'),
			advanced: property.tags?.includes('advanced'),
		}, {
			id: 'chat.automations.cloud.enabled', type: 'boolean', default: false,
			scope: ConfigurationScope.MACHINE, experiment: { mode: 'auto' },
			experimental: true, advanced: true,
		});
	});
});
