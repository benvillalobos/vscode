/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService, IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { NullTelemetryService } from '../../../../../platform/telemetry/common/telemetryUtils.js';
import { IAutomationConfiguration } from '../../../../../workbench/contrib/chat/common/automations/automation.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { ISessionAutomationConfigurationCapability, ISessionsProvider } from '../../../../services/sessions/common/sessionsProvider.js';
import { AutomationStore } from '../../browser/automationService.js';
import { ProviderAutomationService } from '../../browser/providerAutomationService.js';
import { AUTOMATION_STORAGE_KEY, IAutomationStorageService, providerAutomationStorageKey } from '../../common/automationStorageService.js';
import { TestAutomationStorageService } from './automationTestUtils.js';

const FOLDER = URI.parse('file:///workspace');
const PROVIDER_ID = 'agent-host';
const SESSION_TYPE_ID = 'copilotcli';

suite('ProviderAutomationService', () => {
	const teardown = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(legacyRaw?: string): {
		readonly service: ProviderAutomationService;
		readonly providerStore: AutomationStore;
		readonly storage: InMemoryStorageService;
	} {
		const storage = teardown.add(new InMemoryStorageService());
		if (legacyRaw) {
			storage.store(AUTOMATION_STORAGE_KEY, legacyRaw, StorageScope.APPLICATION, StorageTarget.MACHINE);
		}
		const automationStorage = new TestAutomationStorageService(storage);
		const providerStore = teardown.add(new AutomationStore(providerAutomationStorageKey(PROVIDER_ID), storage, new NullLogService(), NullTelemetryService, automationStorage));
		const automationConfiguration = upcastPartial<ISessionAutomationConfigurationCapability>({
			validateAutomationConfiguration: (_sessionTypeId, configuration) => configuration,
		});
		const provider = upcastPartial<ISessionsProvider>({
			id: PROVIDER_ID,
			order: 0,
			automations: providerStore,
			automationConfiguration,
		});
		const providers = upcastPartial<ISessionsProvidersService>({
			onDidChangeProviders: Event.None,
			getProviders: () => [provider],
			getProvider: <T extends ISessionsProvider>(providerId: string) => providerId === PROVIDER_ID ? provider as T : undefined,
		});
		const instantiationService = teardown.add(new TestInstantiationService());
		instantiationService.stub(IStorageService, storage);
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(ITelemetryService, NullTelemetryService);
		instantiationService.stub(IAutomationStorageService, automationStorage);
		instantiationService.stub(ISessionsProvidersService, providers);
		instantiationService.stub(IInstantiationService, instantiationService);
		const service = teardown.add(instantiationService.createInstance(ProviderAutomationService));
		return { service, providerStore, storage };
	}

	test('routes new Automations to their provider store', async () => {
		const { service, providerStore, storage } = createService();
		await service.createAutomation({
			name: 'Provider owned',
			prompt: 'prompt',
			schedule: { interval: 'manual', scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 },
			target: { kind: 'workspace', folderUri: FOLDER, providerId: PROVIDER_ID, sessionTypeId: SESSION_TYPE_ID, isolation: { kind: 'default' } },
			configuration: { version: 1, value: { modelId: 'model' } },
		});

		assert.deepStrictEqual({
			aggregate: service.automations.get().map(automation => automation.name),
			provider: providerStore.automations.get().map(automation => automation.name),
			legacy: storage.get(AUTOMATION_STORAGE_KEY, StorageScope.APPLICATION),
		}, {
			aggregate: ['Provider owned'],
			provider: ['Provider owned'],
			legacy: undefined,
		});
	});

	test('migrates legacy entries and run history into the provider store', async () => {
		const configuration: IAutomationConfiguration = { version: 1, value: { modelId: 'model', permissionLevel: 'default' } };
		const legacy = JSON.stringify({
			schemaVersion: 3,
			revision: 1,
			automations: [{
				id: 'automation-1',
				name: 'Legacy',
				prompt: 'prompt',
				schedule: { interval: 'manual', scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 },
				target: { kind: 'workspace', folderUri: FOLDER.toJSON(), providerId: PROVIDER_ID, sessionTypeId: SESSION_TYPE_ID, isolation: { kind: 'default' } },
				modelId: 'model',
				enabled: true,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			}],
			runs: [{
				id: 'run-1',
				automationId: 'automation-1',
				status: 'completed',
				trigger: 'manual',
				startedAt: '2026-01-01T00:00:00.000Z',
				leaderWindowId: 1,
			}],
		});
		const { service, providerStore, storage } = createService(legacy);

		await service.waitForMigrationForTesting();

		assert.deepStrictEqual({
			automation: providerStore.getAutomation('automation-1'),
			runs: providerStore.runs.get(),
			legacy: JSON.parse(storage.get(AUTOMATION_STORAGE_KEY, StorageScope.APPLICATION)!),
		}, {
			automation: {
				id: 'automation-1',
				name: 'Legacy',
				prompt: 'prompt',
				schedule: { interval: 'manual', scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 },
				target: { kind: 'workspace', folderUri: FOLDER, providerId: PROVIDER_ID, sessionTypeId: SESSION_TYPE_ID, isolation: { kind: 'default' } },
				configuration,
				modelId: undefined,
				mode: undefined,
				permissionLevel: undefined,
				enabled: true,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				lastRunAt: undefined,
				nextRunAt: undefined,
			},
			runs: [{
				id: 'run-1',
				automationId: 'automation-1',
				status: 'completed',
				trigger: 'manual',
				startedAt: '2026-01-01T00:00:00.000Z',
				leaderWindowId: 1,
			}],
			legacy: { schemaVersion: 4, revision: 2, automations: [], runs: [] },
		});
	});
});
