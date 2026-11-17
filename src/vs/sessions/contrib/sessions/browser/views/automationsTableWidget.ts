/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { status } from '../../../../../base/browser/ui/aria/aria.js';
import { Button, ButtonWithDropdown } from '../../../../../base/browser/ui/button/button.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { InputBox } from '../../../../../base/browser/ui/inputbox/inputBox.js';
import { renderIcon } from '../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { ITableRenderer } from '../../../../../base/browser/ui/table/table.js';
import { Checkbox } from '../../../../../base/browser/ui/toggle/toggle.js';
import { SelectBox } from '../../../../../base/browser/ui/selectBox/selectBox.js';
import { DomScrollableElement } from '../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Action, toAction } from '../../../../../base/common/actions.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Event } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, observableSignalFromEvent } from '../../../../../base/common/observable.js';
import { basename } from '../../../../../base/common/resources.js';
import { ScrollbarVisibility } from '../../../../../base/common/scrollable.js';
import { localize } from '../../../../../nls.js';
import { WorkbenchToolBar } from '../../../../../platform/actions/browser/toolbar.js';
import { IMissionControlEnvironmentService } from '../../../../../platform/agentHost/common/missionControlEnvironment.js';
import { IRemoteAgentHostService, RemoteAgentHostsEnabledSettingId } from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextMenuService, IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { WorkbenchTable } from '../../../../../platform/list/browser/listService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { defaultButtonStyles, defaultCheckboxStyles, defaultInputBoxStyles, defaultSelectBoxStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { AccessibilityVerbositySettingId } from '../../../../../workbench/contrib/accessibility/browser/accessibilityConfiguration.js';
import { IAutomationDescriptor, IAutomationRun } from '../../../../../workbench/contrib/chat/common/automations/automation.js';
import { IAutomationService } from '../../../../../workbench/contrib/chat/common/automations/automationService.js';
import { automationTriggerSummary } from '../../../../../workbench/contrib/chat/common/automations/automationTriggers.js';
import { CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING } from '../../../../../workbench/contrib/chat/common/automations/automationsEnabled.js';
import { ENVIRONMENT_PICKER_MANAGE_REMOTES_SETTING, ENVIRONMENT_PICKER_SETTING } from '../../../../../workbench/contrib/sessions/common/chatConstants.js';
import { SESSIONS_SEND_LATER_ENABLED_SETTING } from '../../../../../workbench/contrib/sessions/common/sessionConfig.js';
import { formatSchedule, getAutomationRemoteStatusPresentation, getConnectedAutomationRemoteCount, getUnavailableAutomationsReasons, isAutomationVisible } from './automationCataloguePresentation.js';
import '../media/automationsModal.css';

type Category = 'all' | 'personal' | 'cloud' | 'repository';
type Column = 'name' | 'schedule' | 'target' | 'lastRun' | 'enabled';

interface AutomationRow {
	readonly automation: IAutomationDescriptor;
	readonly category: Exclude<Category, 'all'>;
	readonly name: string;
	readonly schedule: string;
	readonly target: string;
	readonly lastRun: string;
	readonly lastRunTime: string;
	readonly enabled: string;
	readonly canUpdate: boolean;
}

interface CellTemplate {
	readonly label: HTMLElement;
	readonly disposables: DisposableStore;
}

class AutomationCellRenderer implements ITableRenderer<AutomationRow, CellTemplate> {
	readonly templateId: string;
	private readonly toggles = new Map<string, Checkbox>();

	constructor(
		private readonly column: Column,
		private readonly toggle: (automation: IAutomationDescriptor) => void,
		private readonly hoverService: IHoverService,
	) {
		this.templateId = `automation-${column}`;
	}

	renderTemplate(container: HTMLElement): CellTemplate {
		const label = dom.append(container, dom.$('.automations-modal-cell'));
		label.classList.toggle('toggle-cell', this.column === 'enabled');
		return { label, disposables: new DisposableStore() };
	}

	renderElement(row: AutomationRow, _index: number, template: CellTemplate): void {
		template.disposables.clear();
		dom.clearNode(template.label);
		if (this.column === 'enabled') {
			const label = row.canUpdate
				? localize('automations.modal.toggle', "Enable automation {0}", row.name)
				: localize('automations.modal.readOnly', "Automation {0} cannot be changed. {1}", row.name, row.automation.readOnlyReason ?? localize('automations.modal.providerUnavailable', "Its provider is unavailable."));
			const checkbox = template.disposables.add(new Checkbox(label, row.automation.enabled, defaultCheckboxStyles));
			if (!row.canUpdate) {
				checkbox.disable();
			}
			template.label.appendChild(checkbox.domNode);
			checkbox.domNode.dataset.automationId = row.automation.id;
			this.toggles.set(row.automation.id, checkbox);
			template.disposables.add(toDisposable(() => this.toggles.delete(row.automation.id)));
			template.disposables.add(checkbox.onChange(() => {
				checkbox.checked = row.automation.enabled;
				this.toggle(row.automation);
			}));
		} else {
			template.label.textContent = row[this.column];
			template.disposables.add(this.hoverService.setupDelayedHover(template.label, { content: row[this.column] }));
		}
	}

	disposeElement(_row: AutomationRow, _index: number, template: CellTemplate): void {
		template.disposables.clear();
	}

	disposeTemplate(template: CellTemplate): void {
		template.disposables.dispose();
	}

	getToggle(id: string | undefined): HTMLElement | undefined {
		return id === undefined ? undefined : this.toggles.get(id)?.domNode;
	}
}

export class AutomationsTableWidget extends Disposable {
	readonly domNode: HTMLElement;
	protected readonly table: WorkbenchTable<AutomationRow>;
	private readonly search: InputBox;
	private readonly tableContainer: HTMLElement;
	private readonly tableInner: HTMLElement;
	private readonly tableScrollable: DomScrollableElement;
	private readonly tableMinWidth: number;
	private readonly toggleRenderer: AutomationCellRenderer;
	private readonly message: HTMLElement;
	private readonly warnings: HTMLElement;
	private readonly detail: HTMLElement;
	private readonly detailContent: HTMLElement;
	private readonly heading: HTMLElement;
	private readonly categories = new Map<Category, Button>();
	private readonly headers = new Map<Column, Button>();
	private rows: AutomationRow[] = [];
	private allRows: AutomationRow[] = [];
	private category: Category = 'all';
	private enabledFilter = 0;
	private sort: Column = 'name';
	private descending = false;
	private selectedId: string | undefined;
	private readonly pending = new Set<string>();

	constructor(
		container: HTMLElement,
		openWithAgent: () => Promise<void>,
		@IInstantiationService instantiationService: IInstantiationService,
		@IAutomationService private readonly automationService: IAutomationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextViewService contextViewService: IContextViewService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@ICommandService private readonly commandService: ICommandService,
		@IHoverService hoverService: IHoverService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IRemoteAgentHostService remoteAgentHostService: IRemoteAgentHostService,
		@IMissionControlEnvironmentService missionControlEnvironmentService: IMissionControlEnvironmentService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.domNode = dom.append(container, dom.$('.automations-modal-widget'));
		this._register(toDisposable(() => this.domNode.remove()));
		const navigation = dom.append(this.domNode, dom.$('nav.automations-modal-categories', { 'aria-label': localize('automations.modal.categories', "Automation categories") }));
		const categoryLabels: Record<Category, string> = {
			all: localize('automations.modal.all', "All automations"),
			personal: localize('automations.modal.personal', "Personal"),
			cloud: localize('automations.modal.cloud', "Cloud"),
			repository: localize('automations.modal.repository', "Repository"),
		};
		for (const category of ['all', 'personal', 'cloud', 'repository'] as const) {
			const button = this._register(new Button(navigation, {
				...defaultButtonStyles, secondary: true,
				buttonSecondaryBorder: undefined, buttonSecondaryBackground: undefined, buttonSecondaryForeground: undefined,
			}));
			this.categories.set(category, button);
			this._register(button.onDidClick(() => {
				this.category = category;
				this.heading.textContent = categoryLabels[category];
				this.renderRows();
			}));
		}
		const content = dom.append(this.domNode, dom.$('.automations-modal-content'));
		this.heading = dom.append(content, dom.$('h2'));
		this.heading.textContent = categoryLabels.all;
		dom.append(content, dom.$('p.automations-modal-description')).textContent = localize('automations.modal.description', "Agent sessions that run on a schedule or when something happens.");
		this.warnings = dom.append(content, dom.$('.automations-modal-warnings', { role: 'status' }));
		const warningIcon = dom.append(this.warnings, renderIcon(Codicon.warning));
		warningIcon.setAttribute('aria-hidden', 'true');
		const warningText = dom.append(this.warnings, dom.$('span'));
		const controls = dom.append(content, dom.$('.automations-modal-controls'));
		this.search = this._register(new InputBox(dom.append(controls, dom.$('.automations-modal-search')), contextViewService, {
			placeholder: localize('automations.modal.search', "Search automations"),
			ariaLabel: localize('automations.modal.search', "Search automations"),
			inputBoxStyles: defaultInputBoxStyles,
		}));
		this._register(this.search.onDidChange(() => this.renderRows()));
		const filter = this._register(new SelectBox([
			{ text: localize('automations.modal.anyState', "All States") },
			{ text: localize('automations.modal.onlyEnabled', "Enabled") },
			{ text: localize('automations.modal.onlyDisabled', "Disabled") },
		], 0, contextViewService, defaultSelectBoxStyles, { ariaLabel: localize('automations.modal.filter', "Filter automations by state") }));
		filter.render(dom.append(controls, dom.$('.automations-modal-filter')));
		this._register(filter.onDidSelect(event => {
			this.enabledFilter = event.index;
			this.renderRows();
		}));
		const create = this._register(new ButtonWithDropdown(controls, {
			...defaultButtonStyles,
			contextMenuProvider: contextMenuService,
			actions: [toAction({
				id: 'sessions.automations.createManually',
				label: localize('automations.modal.createManually', "Create Manually"),
				run: () => this.execute('sessionsView.newAutomation'),
			})],
			addPrimaryActionToDropdown: false,
		}));
		create.label = localize('automations.modal.createWithAgent', "Create with Agent");
		this._register(create.onDidClick(() => {
			void openWithAgent().catch(error => this.reportError(error));
		}));
		const toolbar = this._register(instantiationService.createInstance(WorkbenchToolBar, dom.append(controls, dom.$('.automations-modal-actions')), {
			ariaLabel: localize('automations.modal.actions', "Automation actions"),
		}));
		const refresh = this._register(new Action('sessions.automations.refresh', localize('automations.modal.refresh', "Refresh"), 'codicon codicon-refresh', true, () => this.execute('sessions.automations.refresh')));
		toolbar.setActions([refresh]);
		this.message = dom.append(content, dom.$('.automations-modal-message', { role: 'status' }));
		this.tableContainer = dom.append(content, dom.$('.automations-modal-table'));
		const viewport = dom.$('.automations-modal-table-viewport');
		this.tableInner = dom.append(viewport, dom.$('.automations-modal-table-inner'));
		this.tableScrollable = this._register(new DomScrollableElement(viewport, {
			horizontal: ScrollbarVisibility.Auto,
			vertical: ScrollbarVisibility.Hidden,
			useShadows: false,
			scrollYToX: true,
			horizontalScrollbarSize: 10,
		}));
		this.tableContainer.appendChild(this.tableScrollable.getDomNode());
		let ariaLabel = localize('automations.modal.table', "Automations. Columns: Name, Schedule, Runs on, Last run, On.");
		const help = keybindingService.lookupKeybinding('editor.action.accessibilityHelp')?.getAriaLabel();
		if (configurationService.getValue<boolean>(AccessibilityVerbositySettingId.Automations) && help) {
			ariaLabel = localize('automations.modal.tableWithHelp', "{0} Use {1} for accessibility help.", ariaLabel, help);
		}
		const definitions: { id: Column; label: string; weight: number; minimumWidth: number }[] = [
			{ id: 'name', label: localize('automations.modal.name', "Name"), weight: 0.3, minimumWidth: 180 },
			{ id: 'schedule', label: localize('automations.modal.schedule', "Schedule"), weight: 0.25, minimumWidth: 160 },
			{ id: 'target', label: localize('automations.modal.target', "Runs on"), weight: 0.2, minimumWidth: 140 },
			{ id: 'lastRun', label: localize('automations.modal.lastRun', "Last run"), weight: 0.2, minimumWidth: 160 },
			{ id: 'enabled', label: localize('automations.modal.on', "On"), weight: 0.05, minimumWidth: 48 },
		];
		const toggle = (automation: IAutomationDescriptor) => { void this.toggle(automation); };
		this.toggleRenderer = new AutomationCellRenderer('enabled', toggle, hoverService);
		const renderers = definitions.map(column => column.id === 'enabled' ? this.toggleRenderer : new AutomationCellRenderer(column.id, toggle, hoverService));
		const columns = definitions.map((column, index) => {
			const header = dom.$('.automations-modal-column-header');
			const button = this._register(new Button(header, {
				...defaultButtonStyles, secondary: true, hoverDelegate: getDefaultHoverDelegate('mouse'),
				buttonSecondaryBorder: undefined, buttonSecondaryBackground: undefined, buttonSecondaryForeground: undefined,
			}));
			button.label = column.label;
			this.headers.set(column.id, button);
			this._register(button.onDidClick(() => {
				this.descending = this.sort === column.id && !this.descending;
				this.sort = column.id;
				this.renderRows();
				status(localize('automations.modal.sorted', "Sorted by {0}, {1}.", column.label, this.descending ? localize('automations.modal.descending', "descending") : localize('automations.modal.ascending', "ascending")));
			}));
			return { ...column, headerElement: header, templateId: renderers[index].templateId, project: (row: AutomationRow) => row };
		});
		this.tableMinWidth = columns.reduce((width, column) => width + column.minimumWidth, 0);
		this.table = this._register(instantiationService.createInstance(WorkbenchTable<AutomationRow>, 'AutomationsTable', this.tableInner, {
			headerRowHeight: 32, getHeight: () => 36,
		}, columns, renderers, {
			identityProvider: { getId: row => row.automation.id },
			accessibilityProvider: { getWidgetAriaLabel: () => ariaLabel, getAriaLabel: row => this.rowSummary(row) },
			keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: row => row.name },
			multipleSelectionSupport: false,
			openOnSingleClick: true,
			horizontalScrolling: false,
		}));
		this.detail = dom.append(this.domNode, dom.$('section.automations-modal-detail', { 'aria-label': localize('automations.modal.details', "Automation details") }));
		this.detail.hidden = true;
		const closeDetail = this._register(new Button(this.detail, { ...defaultButtonStyles, secondary: true }));
		closeDetail.label = localize('automations.modal.closeDetails', "Close Details");
		this._register(closeDetail.onDidClick(() => {
			this.selectedId = undefined;
			this.renderDetail();
			this.table.domFocus();
		}));
		this.detailContent = dom.append(this.detail, dom.$('.automations-modal-detail-content'));
		this._register(this.table.onDidOpen(event => {
			this.selectedId = event.element?.automation.id;
			this.renderDetail();
		}));
		this._register(dom.addDisposableListener(this.search.inputElement, dom.EventType.KEY_DOWN, event => {
			if (new StandardKeyboardEvent(event).keyCode === KeyCode.DownArrow) {
				dom.EventHelper.stop(event, true);
				this.table.domFocus();
				this.table.focusFirst();
			}
		}));
		const resizeObserver = this._register(new dom.DisposableResizeObserver('AutomationsTable', () => this.layout(), dom.getWindow(this.domNode)));
		this._register(resizeObserver.observe(this.domNode));
		const configurationChanged = observableSignalFromEvent(this, configurationService.onDidChangeConfiguration);
		const remotesChanged = observableSignalFromEvent(this, Event.any(remoteAgentHostService.onDidChangeConfiguredEntries, remoteAgentHostService.onDidChangeConnections));
		this._register(autorun(reader => {
			configurationChanged.read(reader);
			remotesChanged.read(reader);
			const automations = automationService.automations.read(reader);
			const runs = automationService.runs.read(reader);
			const providers = [...automationService.availableProviders.read(reader), ...automationService.unavailableProviders.read(reader)];
			const state = automationService.catalogueState.read(reader);
			refresh.enabled = !automationService.isRefreshing?.read(reader);
			const latestRuns = new Map<string, IAutomationRun>();
			for (const run of runs) {
				const previous = latestRuns.get(run.automationId);
				if (!previous || run.startedAt > previous.startedAt) {
					latestRuns.set(run.automationId, run);
				}
			}
			this.allRows = automations.filter(automation => isAutomationVisible(automation, configurationService.getValue<boolean>(SESSIONS_SEND_LATER_ENABLED_SETTING) === true)).map(automation => {
				const provider = providers.find(provider => provider.id === automation.target.providerId);
				const last = latestRuns.get(automation.id);
				const time = last?.startedAt ?? automation.lastRunAt ?? '';
				const label = last ? last.status === 'completed' ? localize('automations.modal.completed', "Completed") : last.status === 'failed' ? localize('automations.modal.failed', "Failed") : last.status === 'running' ? localize('automations.modal.running', "Running") : localize('automations.modal.pending', "Pending") : '';
				return {
					automation,
					category: automation.ownership === 'repository' ? 'repository' : automationService.getProviderConfiguration?.(automation.target.providerId) ? 'cloud' : 'personal',
					name: automation.name,
					schedule: automationTriggerSummary(automation.cloudTrigger?.triggers ?? {}, true) ?? formatSchedule(automation.schedule),
					target: automation.targetDisplay?.label ?? provider?.label ?? (automation.target.kind === 'workspace' ? basename(automation.target.folderUri) : localize('automations.modal.chat', "Chat")),
					lastRun: time ? localize('automations.modal.runAt', "{0} {1}", label, new Date(time).toLocaleString()).trim() : localize('automations.modal.never', "Never"),
					lastRunTime: time,
					enabled: automation.enabled ? localize('automations.modal.enabled', "Enabled") : localize('automations.modal.disabled', "Disabled"),
					canUpdate: automationService.canUpdateAutomation(automation.id),
				};
			});
			const managementEnabled = !!configurationService.getValue<boolean>(RemoteAgentHostsEnabledSettingId)
				&& !!configurationService.getValue<boolean>(ENVIRONMENT_PICKER_SETTING)
				&& !!configurationService.getValue<boolean>(ENVIRONMENT_PICKER_MANAGE_REMOTES_SETTING);
			const remoteStatus = getAutomationRemoteStatusPresentation(automationService.unavailableProviders.read(reader), remoteAgentHostService.configuredEntries, missionControlEnvironmentService.hosts.read(reader).map(host => host.id), managementEnabled);
			const connected = getConnectedAutomationRemoteCount(remoteStatus.tunnelEntries, remoteAgentHostService.connections);
			const reasons = getUnavailableAutomationsReasons(remoteStatus.visibleUnavailableProviders);
			if (managementEnabled && remoteStatus.tunnelEntries.length > 0) {
				reasons.unshift(localize('automations.modal.remotes', "{0}/{1} remotes connected", connected, remoteStatus.tunnelEntries.length));
			}
			if (configurationService.getValue<boolean>(CHAT_CLOUD_AUTOMATIONS_ENABLED_SETTING) === false) {
				reasons.push(localize('automations.modal.cloudDisabled', "Cloud automations are disabled."));
			}
			warningText.textContent = reasons.join(' ');
			this.warnings.hidden = reasons.length === 0;
			const hasWarning = remoteStatus.visibleUnavailableProviders.length > 0 || managementEnabled && connected < remoteStatus.tunnelEntries.length;
			warningIcon.hidden = !hasWarning;
			this.warnings.classList.toggle('has-warning', hasWarning);
			this.message.dataset.catalogueState = state;
			this.renderRows();
		}));
		void this.refresh();
	}

	private async refresh(): Promise<void> {
		try {
			await this.automationService.refresh?.({ background: true });
		} catch (error) {
			this.logService.warn('[AutomationsTable] Failed to refresh automations', error);
			if (!this._store.isDisposed) {
				this.message.textContent = localize('automations.modal.refreshError', "Could not refresh automations. Use Refresh to try again.");
			}
		}
	}

	private async execute(command: string, ...args: readonly unknown[]): Promise<void> {
		try {
			await this.commandService.executeCommand(command, ...args);
		} catch (error) {
			this.reportError(error);
		}
	}

	private reportError(error: unknown): void {
		this.logService.error('[AutomationsTable] Action failed', error);
		this.notificationService.error(error instanceof Error ? error : String(error));
	}

	private async toggle(automation: IAutomationDescriptor): Promise<void> {
		if (this.pending.has(automation.id) || !this.automationService.canUpdateAutomation(automation.id)) {
			return;
		}
		this.pending.add(automation.id);
		try {
			await this.execute(automation.enabled ? 'sessions.automations.disable' : 'sessions.automations.enable', automation);
		} finally {
			this.pending.delete(automation.id);
			if (!this._store.isDisposed) {
				this.renderRows();
			}
		}
	}

	private renderRows(): void {
		const query = this.search.value.trim().toLocaleLowerCase();
		const activeElement = dom.getActiveElement();
		const hadFocus = !!activeElement && this.table.getHTMLElement().contains(activeElement);
		const toggleId = dom.isHTMLElement(activeElement) ? activeElement.dataset.automationId : undefined;
		const focusedId = toggleId ?? this.table.getFocusedElements()[0]?.automation.id;
		this.rows = this.allRows.filter(row => (this.category === 'all' || row.category === this.category)
			&& (this.enabledFilter === 0 || row.automation.enabled === (this.enabledFilter === 1))
			&& [row.name, row.automation.prompt, row.schedule, row.target].some(value => value.toLocaleLowerCase().includes(query)));
		this.rows.sort((first, second) => {
			const a = this.sort === 'lastRun' ? first.lastRunTime : first[this.sort];
			const b = this.sort === 'lastRun' ? second.lastRunTime : second[this.sort];
			return (this.descending ? -1 : 1) * (a.localeCompare(b) || first.automation.id.localeCompare(second.automation.id));
		});
		this.table.splice(0, this.table.length, this.rows);
		const focus = this.rows.findIndex(row => row.automation.id === focusedId);
		if (focus >= 0) {
			this.table.setFocus([focus]);
		}
		if (hadFocus) {
			const toggle = this.toggleRenderer.getToggle(toggleId);
			if (toggle && toggle.getAttribute('aria-disabled') !== 'true') {
				toggle.focus();
			} else if (this.rows.length) {
				this.table.domFocus();
				if (focus < 0) {
					this.table.focusFirst();
				}
			} else {
				this.search.focus();
			}
		}
		for (const [category, button] of this.categories) {
			const label = category === 'all' ? localize('automations.modal.all', "All automations") : category === 'personal' ? localize('automations.modal.personal', "Personal") : category === 'cloud' ? localize('automations.modal.cloud', "Cloud") : localize('automations.modal.repository', "Repository");
			button.label = localize('automations.modal.categoryCount', "{0} ({1})", label, this.allRows.filter(row => category === 'all' || row.category === category).length);
			button.element.setAttribute('aria-pressed', String(category === this.category));
		}
		for (const [column, button] of this.headers) {
			button.element.setAttribute('aria-pressed', String(column === this.sort));
			if (column === this.sort) {
				button.element.setAttribute('aria-description', this.descending ? localize('automations.modal.sortedDescending', "Sorted descending. Activate to sort ascending.") : localize('automations.modal.sortedAscending', "Sorted ascending. Activate to sort descending."));
			} else {
				button.element.removeAttribute('aria-description');
			}
		}
		const state = this.message.dataset.catalogueState;
		this.message.textContent = state === 'loading' ? localize('automations.modal.loading', "Loading automations...")
			: state === 'error' ? localize('automations.modal.error', "The catalogue could not be read completely. Use Refresh to try again.")
			: state === 'unavailable' ? localize('automations.modal.unavailable', "Some providers are unavailable. Showing available automations.")
			: localize('automations.modal.count', "{0} automations found", this.rows.length);
		this.renderDetail();
	}

	private renderDetail(): void {
		const row = this.rows.find(row => row.automation.id === this.selectedId);
		this.detail.hidden = !row;
		dom.clearNode(this.detailContent);
		if (row) {
			dom.append(this.detailContent, dom.$('h3')).textContent = row.name;
			dom.append(this.detailContent, dom.$('p')).textContent = row.automation.prompt;
			dom.append(this.detailContent, dom.$('p')).textContent = this.rowSummary(row);
			if (row.automation.readOnlyReason) {
				dom.append(this.detailContent, dom.$('p')).textContent = row.automation.readOnlyReason;
			}
		}
		this.layout();
	}

	private rowSummary(row: AutomationRow): string {
		return localize('automations.modal.rowSummary', "{0}. {1}. Runs on {2}. Last run: {3}. {4}.", row.name, row.schedule, row.target, row.lastRun, row.enabled);
	}

	getAccessibilityContent(): string {
		return [this.heading.textContent, this.warnings.textContent, this.message.textContent, ...this.rows.map(row => this.rowSummary(row))].filter(Boolean).join('\n');
	}

	focus(): void {
		this.search.focus();
	}

	layout(): void {
		const width = Math.max(this.tableMinWidth, this.tableContainer.clientWidth);
		const height = Math.max(100, this.tableContainer.clientHeight - (width > this.tableContainer.clientWidth ? 10 : 0));
		dom.size(this.tableInner, width, height);
		this.table.layout(height, width);
		this.tableScrollable.scanDomNode();
	}
}
