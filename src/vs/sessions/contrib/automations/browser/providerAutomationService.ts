/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { derived, IObservable, observableSignalFromEvent } from '../../../../base/common/observable.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IAutomation, IAutomationConfiguration, IAutomationRun, AutomationRunTrigger } from '../../../../workbench/contrib/chat/common/automations/automation.js';
import { AutomationMutationGuard, IAutomationRunClaim, IAutomationService, ICreateAutomationOptions, IGuardedAutomationUpdateResult, IUpdateAutomationOptions, IUpdateAutomationRunOptions } from '../../../../workbench/contrib/chat/common/automations/automationService.js';
import { ISessionsProvidersService } from '../../../services/sessions/browser/sessionsProvidersService.js';
import { ISessionsProviderAutomations } from '../../../services/sessions/common/sessionsProvider.js';
import { AutomationService } from './automationService.js';

interface IAutomationStoreEntry {
	readonly providerId: string | undefined;
	readonly store: ISessionsProviderAutomations;
}

export class ProviderAutomationService extends Disposable implements IAutomationService {

	declare readonly _serviceBrand: undefined;

	private readonly legacyStore: AutomationService;
	private readonly providersChanged;
	private readonly migrationSequencer = new Sequencer();
	private migrationPromise: Promise<void> = Promise.resolve();

	readonly automations: IObservable<readonly IAutomation[]>;
	readonly runs: IObservable<readonly IAutomationRun[]>;

	constructor(
		@ISessionsProvidersService private readonly sessionsProvidersService: ISessionsProvidersService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.legacyStore = this._register(instantiationService.createInstance(AutomationService));
		this.providersChanged = observableSignalFromEvent(this, sessionsProvidersService.onDidChangeProviders);
		this.automations = derived(this, reader => {
			this.providersChanged.read(reader);
			return this.getStores()
				.flatMap(entry => [...entry.store.automations.read(reader)])
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		});
		this.runs = derived(this, reader => {
			this.providersChanged.read(reader);
			return this.getStores()
				.flatMap(entry => [...entry.store.runs.read(reader)])
				.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
		});
		this._register(sessionsProvidersService.onDidChangeProviders(() => this.queueMigration()));
		this.queueMigration();
	}

	getAutomation(id: string): IAutomation | undefined {
		return this.findAutomationStore(id)?.store.getAutomation(id);
	}

	runsFor(automationId: string): IObservable<readonly IAutomationRun[]> {
		return derived(this, reader => this.runs.read(reader).filter(run => run.automationId === automationId));
	}

	createAutomation(options: ICreateAutomationOptions, mutationGuard?: AutomationMutationGuard): Promise<IAutomation> {
		return this.getCreationStore(options).createAutomation(options, mutationGuard);
	}

	updateAutomation(id: string, patch: IUpdateAutomationOptions): Promise<IAutomation> {
		return this.requireAutomationStore(id).updateAutomation(id, patch);
	}

	updateAutomationIfUnchanged(id: string, patch: IUpdateAutomationOptions, expected: IAutomation, mutationGuard?: AutomationMutationGuard): Promise<IGuardedAutomationUpdateResult> {
		return this.requireAutomationStore(id).updateAutomationIfUnchanged(id, patch, expected, mutationGuard);
	}

	deleteAutomation(id: string, mutationGuard?: AutomationMutationGuard): Promise<void> {
		return this.requireAutomationStore(id).deleteAutomation(id, mutationGuard);
	}

	recordRunStart(automationId: string, trigger: AutomationRunTrigger, leaderWindowId: number): Promise<IAutomationRunClaim> {
		return this.requireAutomationStore(automationId).recordRunStart(automationId, trigger, leaderWindowId);
	}

	updateRun(runId: string, patch: IUpdateAutomationRunOptions): Promise<IAutomationRun | undefined> {
		const store = this.findRunStore(runId);
		return store ? store.updateRun(runId, patch) : Promise.resolve(undefined);
	}

	deleteRun(runId: string): Promise<void> {
		const store = this.findRunStore(runId);
		return store ? store.deleteRun(runId) : Promise.resolve();
	}

	getActiveRunFor(automationId: string): IAutomationRun | undefined {
		return this.findAutomationStore(automationId)?.store.getActiveRunFor(automationId);
	}

	async markStaleRunsFailed(reason: string): Promise<void> {
		await Promise.all(this.getStores().map(entry => entry.store.markStaleRunsFailed(reason)));
	}

	waitForMigrationForTesting(): Promise<void> {
		return this.migrationPromise;
	}

	private getStores(): IAutomationStoreEntry[] {
		const providerStores = this.sessionsProvidersService.getProviders()
			.filter(provider => provider.automations)
			.map(provider => ({ providerId: provider.id, store: provider.automations! }));
		return [...providerStores, { providerId: undefined, store: this.legacyStore }];
	}

	private getCreationStore(options: ICreateAutomationOptions): ISessionsProviderAutomations {
		const providerId = options.target.providerId;
		if (providerId) {
			const providerStore = this.sessionsProvidersService.getProvider(providerId)?.automations;
			if (providerStore) {
				return providerStore;
			}
		}
		return this.legacyStore;
	}

	private findAutomationStore(id: string): IAutomationStoreEntry | undefined {
		return this.getStores().find(entry => !!entry.store.getAutomation(id));
	}

	private requireAutomationStore(id: string): ISessionsProviderAutomations {
		const entry = this.findAutomationStore(id);
		if (!entry) {
			throw new Error(`Automation '${id}' does not exist.`);
		}
		return entry.store;
	}

	private findRunStore(runId: string): ISessionsProviderAutomations | undefined {
		return this.getStores().find(entry => entry.store.runs.get().some(run => run.id === runId))?.store;
	}

	private queueMigration(): void {
		this.migrationPromise = this.migrationSequencer.queue(() => this.migrateLegacyAutomations()).catch(error => {
			this.logService.error('[ProviderAutomationService] Failed to migrate legacy Automations.', error);
		});
	}

	private async migrateLegacyAutomations(): Promise<void> {
		for (const automation of [...this.legacyStore.automations.get()]) {
			const providerId = automation.target.providerId;
			if (!providerId) {
				continue;
			}
			const provider = this.sessionsProvidersService.getProvider(providerId);
			if (!provider?.automations || !provider.automationConfiguration) {
				continue;
			}
			const configuration = automation.configuration
				?? legacyAutomationConfiguration(automation);
			const migrated: IAutomation = {
				...automation,
				configuration: provider.automationConfiguration.validateAutomationConfiguration(automation.target.sessionTypeId ?? '', configuration),
				modelId: undefined,
				mode: undefined,
				permissionLevel: undefined,
			};
			await provider.automations.importAutomation(migrated, this.legacyStore.runsFor(automation.id).get());
			await this.legacyStore.removeAutomationForMigration(automation.id);
		}
	}
}

function legacyAutomationConfiguration(automation: IAutomation): IAutomationConfiguration {
	return {
		version: 1,
		value: {
			...(automation.modelId ? { modelId: automation.modelId } : {}),
			...(automation.mode ? { modeId: automation.mode } : {}),
			...(automation.permissionLevel ? { permissionLevel: automation.permissionLevel } : {}),
		},
	};
}
