/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { useFakeTimers } from 'sinon';
import { DeferredPromise } from '../../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { IDefaultAccount } from '../../../../../../base/common/defaultAccount.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { autorun, constObservable } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { mock, upcastPartial } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ChatAIDisabledSettingId } from '../../../../../../platform/chat/common/chatSettings.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IDefaultAccountService } from '../../../../../../platform/defaultAccount/common/defaultAccount.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { InMemoryStorageService, IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { NullTelemetryService } from '../../../../../../platform/telemetry/common/telemetryUtils.js';
import { IAutomationSchedule } from '../../../../../../workbench/contrib/chat/common/automations/automation.js';
import { CHAT_AUTOMATIONS_ENABLED_SETTING, CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING } from '../../../../../../workbench/contrib/chat/common/automations/automationsEnabled.js';
import { IToolImpl, IToolResult } from '../../../../../../workbench/contrib/chat/common/tools/languageModelToolsService.js';
import { IChatEntitlementService, IChatSentiment } from '../../../../../../workbench/services/chat/common/chatEntitlementService.js';
import { ISessionsRecentWorkspacesService } from '../../../../../services/sessions/browser/sessionsRecentWorkspacesService.js';
import { ISessionsProvidersService } from '../../../../../services/sessions/browser/sessionsProvidersService.js';
import { ISessionsManagementService } from '../../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsProvider } from '../../../../../services/sessions/common/sessionsProvider.js';
import { GITHUB_REMOTE_FILE_SCHEME, ISessionType } from '../../../../../services/sessions/common/session.js';
import { AutomationRunner } from '../../../../automations/browser/automationRunner.js';
import { ConfigureAutomationTool, ListAutomationsTool, RunAutomationTool } from '../../../../automations/browser/automationTools.js';
import { ProviderAutomationService } from '../../../../automations/browser/providerAutomationService.js';
import { CloudAutomationApiClient, CloudAutomationMutationUncertainError, ICloudAutomationDefinition, ICloudAutomationMutation, ICloudAutomationRepository, ICloudAutomationTask } from '../../browser/cloudAutomationApiClient.js';
import { CloudAutomationProvider, cloudAutomationSchedule, cloudAutomationTriggers } from '../../browser/cloudAutomationProvider.js';

const definition: ICloudAutomationDefinition = { id: 'one', name: 'Review', prompt: 'Review issues', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', triggers: {} };
const workspace = URI.from({ scheme: GITHUB_REMOTE_FILE_SCHEME, authority: 'github', path: '/owner/private/HEAD' });
const account: IDefaultAccount = { accountName: 'user', sessionId: 'one', enterprise: false, authenticationProvider: { id: 'github', name: 'GitHub', enterprise: false } };
const manual: IAutomationSchedule = { interval: 'manual', scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 };

class TestApi extends mock<CloudAutomationApiClient>() {
	readonly calls: string[] = [];
	definitions: readonly ICloudAutomationDefinition[] = [definition];
	tasks: readonly ICloudAutomationTask[] = [];
	historyError: Error | undefined;
	pendingVisibility: Promise<boolean> | undefined;
	lastToken: CancellationToken | undefined;
	patch: ICloudAutomationMutation | undefined;
	runError: Error | undefined;
	override dispose(): void { }
	override async isPrivateRepository(): Promise<boolean> { this.calls.push('visibility'); return true; }
	override async requirePrivateRepository(_account: string, _repository: ICloudAutomationRepository, token: CancellationToken): Promise<void> {
		this.lastToken = token;
		if (this.pendingVisibility) {
			await this.pendingVisibility;
		}
	}
	override async list(): Promise<readonly ICloudAutomationDefinition[]> { this.calls.push('list'); return this.definitions; }
	override async listRuns(): Promise<readonly ICloudAutomationTask[]> {
		this.calls.push('history');
		if (this.historyError) {
			throw this.historyError;
		}
		return this.tasks;
	}
	override async getTask(): Promise<ICloudAutomationTask> { return this.tasks[0]; }
	override async get(): Promise<ICloudAutomationDefinition> { return this.definitions[0]; }
	override async create(_account: string, _repository: ICloudAutomationRepository, value: ICloudAutomationMutation): Promise<ICloudAutomationDefinition> {
		this.calls.push('create');
		this.patch = value;
		this.definitions = [{ ...definition, ...value }];
		return this.definitions[0];
	}
	override async update(_account: string, _repository: ICloudAutomationRepository, _id: string, value: ICloudAutomationMutation): Promise<ICloudAutomationDefinition> {
		this.patch = value;
		this.calls.push('update');
		return { ...this.definitions[0], ...value };
	}
	override async run(): Promise<void> {
		this.calls.push('run');
		if (this.runError) {
			throw this.runError;
		}
	}
	override async stopTask(): Promise<void> { this.calls.push('stop'); }
}

suite('CloudAutomationProvider', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	function setup() {
		const instantiation = disposables.add(new TestInstantiationService());
		const configuration = new TestConfigurationService({ chat: { automations: { enabled: true, cloud: { enabled: false } } } });
		const changed = disposables.add(new Emitter<IDefaultAccount | null>());
		const accounts = new class extends mock<IDefaultAccountService>() {
			override currentDefaultAccount: IDefaultAccount | null = account;
			override onDidChangeDefaultAccount = changed.event;
		}();
		const sentimentChanged = disposables.add(new Emitter<void>());
		const entitlement = new class extends mock<IChatEntitlementService>() {
			override sentiment: IChatSentiment = {};
			override onDidChangeSentiment = sentimentChanged.event;
		}();
		const api = new TestApi();
		instantiation.stubInstance(CloudAutomationApiClient, api);
		instantiation.stub(IInstantiationService, instantiation);
		instantiation.stub(IConfigurationService, configuration);
		instantiation.stub(IDefaultAccountService, accounts);
		instantiation.stub(IChatEntitlementService, entitlement);
		instantiation.stub(IStorageService, disposables.add(new InMemoryStorageService()));
		instantiation.stub(ILogService, new NullLogService());
		instantiation.stub(ISessionsRecentWorkspacesService, upcastPartial<ISessionsRecentWorkspacesService>({
			getRecentWorkspaces: () => [{ workspace: { uri: workspace, label: 'private', icon: Codicon.repo, requiresWorkspaceTrust: false, folders: [{ root: workspace, workingDirectory: workspace, name: 'private', description: undefined }], isVirtualWorkspace: true }, providerId: 'cloud', checked: true, source: 'agents' }],
		}));
		const provider = disposables.add(instantiation.createInstance(CloudAutomationProvider, 'cloud', 'cloud-agent', () => undefined));
		const set = async (key: string, value: boolean) => {
			await configuration.setUserConfiguration(key, value);
			configuration.onDidChangeConfigurationEmitter.fire({ affectsConfiguration: () => true, affectedKeys: new Set([key]), change: { keys: [key], overrides: [] }, source: ConfigurationTarget.USER });
		};
		return { provider, api, accounts, changed, entitlement, sentimentChanged, configuration, set };
	}

	test('tools route through the gated cloud provider and preserve cloud mutation semantics', async () => {
		const { provider, api, configuration, set } = setup();
		const sessionsProvider = upcastPartial<ISessionsProvider>({
			id: 'cloud', label: 'Cloud', automations: provider, supportsAutomationSessionConfiguration: true,
		});
		const providers = upcastPartial<ISessionsProvidersService>({
			onDidChangeProviders: Event.None,
			getProviders: () => [sessionsProvider],
			getProvider: <T extends ISessionsProvider>() => sessionsProvider as T,
		});
		const service = disposables.add(new ProviderAutomationService(constObservable(true), providers));
		const sessions = upcastPartial<ISessionsManagementService>({
			getSessionTypesForFolder: () => [{ providerId: 'cloud', sessionType: upcastPartial<ISessionType>({ id: 'cloud-agent' }) }],
		});
		const list = new ListAutomationsTool(service, configuration, providers);
		const configure = new ConfigureAutomationTool(service, sessions, configuration, NullTelemetryService);
		const warnings: string[] = [];
		const runner = new AutomationRunner(service, providers, new NullLogService(), upcastPartial<INotificationService>({
			warn: message => warnings.push(String(message)), error: message => assert.fail(String(message)),
		}));
		const run = new RunAutomationTool(service, runner, configuration);
		const invokeTool = (tool: IToolImpl, parameters: object) => tool.invoke({ callId: 'call', toolId: 'tool', parameters, context: undefined }, async () => 0, { report: () => { } }, CancellationToken.None);
		const text = (result: IToolResult) => {
			const part = result.content[0];
			assert.ok(part.kind === 'text');
			return JSON.parse(part.value);
		};
		assert.deepStrictEqual({ providers: text(await invokeTool(list, {})), calls: api.calls }, { providers: [], calls: [] });
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await invokeTool(list, {});
		const input = {
			name: 'Cloud review', prompt: 'Review', schedule: { interval: 'daily', timeZone: 'UTC', scheduleHour: 10, scheduleMinute: 15 },
			target: { kind: 'workspace', folderUri: workspace.toString(), providerId: 'cloud', sessionTypeId: 'cloud-agent' },
			sessionTemplate: { modelId: 'provider-model', config: { tools: ['read', 'github/*'], reasoningEffort: 'high' } },
		};
		const created = text(await invokeTool(configure, input));
		const automation = service.getAutomation(created.automation.id)!;
		assert.deepStrictEqual({ status: created.status, patch: api.patch, canRun: service.canRunAutomation(automation.id), canUpdate: service.canUpdateAutomation(automation.id) }, {
			status: 'created',
			patch: { name: 'Cloud review', prompt: 'Review', disabled: true, triggers: { interval: { types: ['daily'], hour_utc: 10, minute_utc: 15 } }, model: 'provider-model', tools: ['read', 'github/*'], reasoning_effort: 'high' },
			canRun: false, canUpdate: true,
		});
		api.definitions = [{ ...api.definitions[0], disabled: false }];
		await invokeTool(list, {});
		assert.deepStrictEqual(text(await invokeTool(run, { automationId: automation.id })), { status: 'accepted', automation: { id: automation.id, name: automation.name } });
		api.tasks = [{ id: 'active', state: 'running', created_at: definition.created_at }];
		await provider.refresh();
		const preparation = await run.prepareToolInvocation({ toolCallId: 'active', parameters: { automationId: automation.id }, chatSessionResource: undefined }, CancellationToken.None);
		const requests = api.calls.filter(call => call === 'run').length;
		const alreadyRunning = text(await invokeTool(run, { automationId: automation.id }));
		assert.deepStrictEqual({ confirmation: preparation.confirmationMessages, status: alreadyRunning.status, runId: alreadyRunning.run.id, extraRequests: api.calls.filter(call => call === 'run').length - requests }, {
			confirmation: undefined, status: 'already_running', runId: provider.runs.get()[0].id, extraRequests: 0,
		});
		api.tasks = [];
		await provider.refresh();
		api.runError = new CloudAutomationMutationUncertainError(undefined);
		const uncertain = text(await invokeTool(run, { automationId: automation.id }));
		assert.deepStrictEqual({ result: uncertain, warnings, canRun: service.canRunAutomation(automation.id) }, {
			result: { status: 'unknown', automation: { id: automation.id, name: automation.name }, message: api.runError.message },
			warnings: [api.runError.message], canRun: false,
		});
		warnings.length = 0;
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, false);
		const before = api.calls.length;
		const blocked = await invokeTool(configure, input);
		assert.deepStrictEqual({ providers: text(await invokeTool(list, {})), blocked: !!blocked.toolResultError, requests: api.calls.length - before, warnings }, {
			providers: [], blocked: true, requests: 0, warnings: [],
		});
	});

	test('disabled and unsupported cloud definitions remain editable or deletable without becoming runnable', async () => {
		const { provider, api, set } = setup();
		api.definitions = [{ ...definition, disabled: true }];
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await provider.refresh();
		const automation = provider.automations.get()[0];
		await assert.rejects(provider.runAutomation(automation.id), /Enable the cloud automation/);
		assert.deepStrictEqual({ run: provider.canRunAutomation(automation.id), update: provider.canUpdateAutomation(automation.id), delete: provider.canDeleteAutomation(automation.id), dispatched: api.calls.includes('run') },
			{ run: false, update: true, delete: true, dispatched: false });
	});

	test('run preflight rejects a newly unsupported remote trigger before dispatch', async () => {
		const { provider, api, set } = setup();
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await provider.refresh();
		const automation = provider.automations.get()[0];
		api.definitions = [{ ...definition, triggers: { webhook: { types: ['issue'] } } }];
		await assert.rejects(provider.runAutomation(automation.id), /Only supported schedules/);
		assert.deepStrictEqual({ dispatched: api.calls.includes('run'), canRun: provider.canRunAutomation(automation.id), interval: provider.getAutomation(automation.id)?.schedule.interval },
			{ dispatched: false, canRun: false, interval: 'custom' });
	});

	test('default-off and parent gates create no API requests or visible catalogue', async () => {
		const { provider, api, set } = setup();
		disposables.add(autorun(reader => provider.automations.read(reader)));
		assert.deepStrictEqual({ enabled: provider.enabled.get(), calls: api.calls, automations: provider.automations.get() }, { enabled: false, calls: [], automations: [] });
		await set(CHAT_AUTOMATIONS_ENABLED_SETTING, false);
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await set(ChatAIDisabledSettingId, true);
		await set(CHAT_AUTOMATIONS_ENABLED_SETTING, true);
		assert.deepStrictEqual({ enabled: provider.enabled.get(), calls: api.calls }, { enabled: false, calls: [] });
	});

	test('enablement discovers and projects definitions; hiding AI clears catalogue and cancels work', async () => {
		const { provider, api, set, entitlement, sentimentChanged } = setup();
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await provider.refresh();
		const automation = provider.automations.get()[0];
		assert.deepStrictEqual({ name: automation.name, target: automation.target.providerId, zone: automation.schedule.timeZone, writable: provider.canCreateAutomation.get() },
			{ name: 'Review', target: 'cloud', zone: 'UTC', writable: true });
		const pending = new DeferredPromise<boolean>();
		api.pendingVisibility = pending.p;
		const run = provider.runAutomation(automation.id);
		await Promise.resolve();
		entitlement.sentiment = { hidden: true };
		sentimentChanged.fire();
		const rejected = assert.rejects(run);
		await pending.complete(true);
		await rejected;
		assert.deepStrictEqual({ calls: api.calls.includes('run'), automations: provider.automations.get(), enabled: provider.enabled.get(), cancelled: api.lastToken?.isCancellationRequested },
			{ calls: false, automations: [], enabled: false, cancelled: true });
	});

	test('account reset removes ownership and pending requests; sandbox and enterprise are not authorities', async () => {
		const { provider, accounts, changed, set } = setup();
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await provider.refresh();
		const old = provider.automations.get()[0];
		accounts.currentDefaultAccount = { ...account, enterprise: true };
		changed.fire(accounts.currentDefaultAccount);
		assert.deepStrictEqual({ automation: provider.getAutomation(old.id), canCreate: provider.canCreateAutomation.get(), state: provider.catalogueState.get() },
			{ automation: undefined, canCreate: false, state: 'unavailable' });
	});

	test('202 remains acknowledgement only and task history projects exact native resources', async () => {
		const { provider, api, set } = setup();
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await provider.refresh();
		const automation = provider.automations.get()[0];
		api.tasks = [{ id: 'task', state: 'waiting_for_user', created_at: definition.created_at }];
		assert.deepStrictEqual(await provider.runAutomation(automation.id), { kind: 'accepted' });
		await provider.refresh();
		const run = provider.runs.get()[0];
		assert.deepStrictEqual({ status: run.status, trigger: run.trigger, needsInput: run.needsInput, session: run.sessionResource?.toString(), url: run.externalResource?.toString() },
			{ status: 'running', trigger: 'external', needsInput: true, session: 'copilot-cloud-agent:/task/task', url: 'https://github.com/owner/private/tasks/task' });
	});

	test('idle definitions do not poll and postdispatch history discovery is bounded', async () => {
		const clock = useFakeTimers();
		try {
			const { provider, api, set } = setup();
			await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
			await provider.refresh();
			api.calls.length = 0;
			await clock.tickAsync(60_000);
			assert.deepStrictEqual(api.calls, []);
			await provider.runAutomation(provider.automations.get()[0].id);
			await clock.tickAsync(120_000);
			assert.deepStrictEqual(api.calls, ['run', 'history', 'history', 'history', 'history', 'history']);
		} finally {
			clock.restore();
		}
	});

	test('active history refreshes at 15 seconds and stops at completion or gate closure', async () => {
		const clock = useFakeTimers();
		try {
			const { provider, api, set } = setup();
			api.tasks = [{ id: 'task', state: 'running', created_at: definition.created_at }];
			await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
			await provider.refresh();
			api.calls.length = 0;
			await clock.tickAsync(14_999);
			assert.deepStrictEqual(api.calls, []);
			await clock.tickAsync(1);
			assert.deepStrictEqual(api.calls, ['history']);
			api.tasks = [{ ...api.tasks[0], state: 'completed' }];
			await clock.tickAsync(60_000);
			assert.deepStrictEqual(api.calls, ['history', 'history']);
			api.tasks = [{ ...api.tasks[0], state: 'running' }];
			await provider.refresh();
			api.calls.length = 0;
			await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, false);
			await clock.tickAsync(60_000);
			assert.deepStrictEqual({ calls: api.calls, runs: provider.runs.get() }, { calls: [], runs: [] });
		} finally {
			clock.restore();
		}
	});

	test('history failures retain rows without poisoning definition readiness', async () => {
		const { provider, api, set } = setup();
		api.tasks = [{ id: 'task', state: 'completed', created_at: definition.created_at }];
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await provider.refresh();
		const ids = provider.runs.get().map(run => run.id);
		api.historyError = new Error('History offline');
		await assert.rejects(provider.refresh(), /History offline/);
		assert.deepStrictEqual({
			catalogue: provider.catalogueState.get(), history: provider.historyState.get(),
			canCreate: provider.canCreateAutomation.get(), ids: provider.runs.get().map(run => run.id),
		}, { catalogue: 'ready', history: 'error', canCreate: true, ids });
		api.historyError = undefined;
		await provider.refresh();
		assert.strictEqual(provider.historyState.get(), 'ready');
	});

	test('local follow-ups restart bounded discovery even when the task is not yet in history', async () => {
		const clock = useFakeTimers();
		try {
			const { provider, api, set } = setup();
			api.tasks = [{ id: 'exact', state: 'completed', created_at: definition.created_at }];
			await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
			await provider.refresh();
			assert.strictEqual(provider.runs.get()[0].sessionResource?.toString(), 'copilot-cloud-agent:/task/exact');
			api.calls.length = 0;
			provider.observeLocalRequest(URI.parse('copilot-cloud-agent:/task/unlisted'));
			await clock.tickAsync(120_000);
			const requests = api.calls.slice();
			await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, false);
			provider.observeLocalRequest(URI.parse('copilot-cloud-agent:/task/exact'));
			await clock.tickAsync(120_000);
			assert.deepStrictEqual({ requests, afterDisabled: api.calls }, { requests: Array(5).fill('history'), afterDisabled: Array(5).fill('history') });
		} finally {
			clock.restore();
		}
	});

	test('dispatch and stop acknowledgements are not changed into failures by history errors', async () => {
		const { provider, api, set } = setup();
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await provider.refresh();
		api.historyError = new Error('History unavailable');
		const accepted = await provider.runAutomation(provider.automations.get()[0].id);
		api.historyError = undefined;
		api.tasks = [{ id: 'task', state: 'running', created_at: definition.created_at }];
		await provider.refresh();
		const run = provider.runs.get()[0];
		api.historyError = new Error('History unavailable');
		await provider.stopRun(run);
		await assert.rejects(provider.refresh(), /History unavailable/);
		assert.deepStrictEqual({
			accepted, stopped: api.calls.includes('stop'), status: provider.runs.get()[0].status, history: provider.historyState.get(),
		}, { accepted: { kind: 'accepted' }, stopped: true, status: 'running', history: 'error' });
	});

	test('preflight conflicts and partial patches preserve remote configuration', async () => {
		const { provider, api, set } = setup();
		api.definitions = [{ ...definition, tools: ['future-tool'], reasoning_effort: 'future' }];
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await provider.refresh();
		const expected = provider.automations.get()[0];
		api.definitions = [{ ...api.definitions[0], prompt: 'Web edit' }];
		const conflict = await provider.updateAutomationIfUnchanged(expected.id, { name: 'New' }, expected);
		await provider.updateAutomation(expected.id, { name: 'New' });
		assert.deepStrictEqual({ kind: conflict.kind, patch: api.patch }, { kind: 'conflict', patch: { name: 'New' } });
	});

	test('creation is explicit and rejects local configuration and unsupported schedules', async () => {
		const { provider, set } = setup();
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await provider.refresh();
		const options = { name: 'Create', prompt: 'Review', schedule: manual, target: { kind: 'workspace' as const, folderUri: workspace, providerId: 'cloud', sessionTypeId: 'cloud-agent', isolation: { kind: 'default' as const } } };
		await assert.rejects(provider.createAutomation({ ...options, mode: 'agent' }));
		await assert.rejects(provider.createAutomation({ ...options, schedule: { ...manual, interval: 'daily' } }));
		const created = await provider.createAutomation(options);
		assert.strictEqual(created.enabled, false);
	});

	test('changing a scheduled automation to manual replaces triggers with an empty object', async () => {
		const { provider, api, set } = setup();
		api.definitions = [{ ...definition, disabled: true, triggers: { interval: { types: ['daily'], hour_utc: 12, minute_utc: 30 } } }];
		await set(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING, true);
		await provider.refresh();
		const updated = await provider.updateAutomation(provider.automations.get()[0].id, { schedule: manual });
		assert.deepStrictEqual({ patch: api.patch, interval: updated.schedule.interval, enabled: updated.enabled }, {
			patch: { triggers: {} }, interval: 'manual', enabled: false,
		});
	});

	test('roundtrips UTC schedules and keeps unknown triggers read-only', () => {
		const daily = { ...manual, interval: 'daily' as const, timeZone: 'UTC' as const, scheduleHour: 7, scheduleMinute: 15 };
		assert.deepStrictEqual({ daily: cloudAutomationSchedule(cloudAutomationTriggers(daily)), custom: cloudAutomationSchedule({ webhook: { types: ['issue'] } }).interval },
			{ daily, custom: 'custom' });
	});
});
