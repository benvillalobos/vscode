/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { AccessibleContentProvider, AccessibleViewProviderId, AccessibleViewType } from '../../../../../platform/accessibility/browser/accessibleView.js';
import { AccessibleViewRegistry, IAccessibleViewImplementation } from '../../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { ChatAIDisabledSettingId } from '../../../../../platform/chat/common/chatSettings.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService, IScopedContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../../workbench/browser/editor.js';
import { EditorPane } from '../../../../../workbench/browser/parts/editor/editorPane.js';
import { EditorExtensions, IEditorOpenContext } from '../../../../../workbench/common/editor.js';
import { AccessibilityVerbositySettingId } from '../../../../../workbench/contrib/accessibility/browser/accessibilityConfiguration.js';
import { CHAT_AUTOMATIONS_ENABLED_SETTING } from '../../../../../workbench/contrib/chat/common/automations/automationsEnabled.js';
import { IEditorGroup } from '../../../../../workbench/services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../../workbench/services/editor/common/editorService.js';
import { AUTOMATIONS_MODAL_SETTING, AutomationsEditorInput } from './automationsEditorInput.js';
import { AutomationsTableWidget } from './automationsTableWidget.js';

const AutomationsEditorFocusedContext = new RawContextKey<boolean>('automationsEditorFocused', false);

export class AutomationsEditor extends EditorPane {
	static readonly ID = 'sessions.editor.automations';
	private container: HTMLElement | undefined;
	private scopedContext: IScopedContextKeyService | undefined;
	private widgetInstantiationService: IInstantiationService | undefined;
	private readonly widget = this._register(new MutableDisposable<AutomationsTableWidget>());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@ILogService private readonly logService: ILogService,
	) {
		super(AutomationsEditor.ID, group, telemetryService, themeService, storageService);
		this._register(configurationService.onDidChangeConfiguration(event => {
			if ([AUTOMATIONS_MODAL_SETTING, CHAT_AUTOMATIONS_ENABLED_SETTING, ChatAIDisabledSettingId].some(key => event.affectsConfiguration(key))) {
				this.updateWidget();
				if (!this.isEnabled() && this.input) {
					void this.editorService.closeEditor({ editor: this.input, groupId: this.group.id }).catch(error => {
						this.logService.error('[AutomationsEditor] Failed to close disabled modal', error);
					});
				}
			}
		}));
	}

	override get scopedContextKeyService(): IContextKeyService | undefined { return this.scopedContext; }

	protected override createEditor(parent: HTMLElement): void {
		this.container = dom.append(parent, dom.$('.automations-modal-editor'));
		this.scopedContext = this._register(this.contextKeyService.createScoped(this.container));
		AutomationsEditorFocusedContext.bindTo(this.scopedContext).set(true);
		this.widgetInstantiationService = this._register(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, this.scopedContext])));
	}

	override async setInput(input: AutomationsEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!token.isCancellationRequested) {
			this.updateWidget();
		}
	}

	protected override setEditorVisible(visible: boolean): void {
		if (visible) {
			this.updateWidget();
		} else {
			this.widget.clear();
		}
	}

	override clearInput(): void {
		this.widget.clear();
		super.clearInput();
	}

	private updateWidget(): void {
		if (!this.container || !this.widgetInstantiationService || !this.input) {
			return;
		}
		if (!this.isEnabled() || !this.isVisible()) {
			this.widget.clear();
			return;
		}
		if (!this.widget.value) {
			this.widget.value = this.widgetInstantiationService.createInstance(AutomationsTableWidget, this.container, async () => {
				if (this.input) {
					await this.editorService.closeEditor({ editor: this.input, groupId: this.group.id });
				}
				await this.commandService.executeCommand('sessions.automations.createWithAgent');
			});
		}
		this.widget.value.layout();
	}

	private isEnabled(): boolean {
		return this.configurationService.getValue<boolean>(AUTOMATIONS_MODAL_SETTING) === true
			&& this.configurationService.getValue<boolean>(CHAT_AUTOMATIONS_ENABLED_SETTING) === true
			&& !this.configurationService.getValue<boolean>(ChatAIDisabledSettingId);
	}

	override focus(): void {
		super.focus();
		this.widget.value?.focus();
	}

	getAccessibilityContent(): string { return this.widget.value?.getAccessibilityContent() ?? ''; }

	layout(dimension: dom.Dimension): void {
		if (this.container) {
			dom.size(this.container, dimension.width, dimension.height);
			this.widget.value?.layout();
		}
	}
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(AutomationsEditor, AutomationsEditor.ID, localize('automations.modal.name', "Automations")),
	[new SyncDescriptor(AutomationsEditorInput)],
);

class AutomationsModalAccessibleView implements IAccessibleViewImplementation {
	readonly priority = 125;
	readonly name = 'automations-modal';
	readonly when = AutomationsEditorFocusedContext;
	constructor(readonly type: AccessibleViewType) { }

	getProvider(accessor: ServicesAccessor): AccessibleContentProvider | undefined {
		const editor = accessor.get(IEditorService).activeEditorPane;
		if (!(editor instanceof AutomationsEditor)) {
			return undefined;
		}
		const focused = dom.getActiveElement();
		return new AccessibleContentProvider(
			AccessibleViewProviderId.Automations,
			{ type: this.type },
			() => this.type === AccessibleViewType.Help ? [
				localize('automations.modal.help.overview', "You are in the Automations modal. It uses the same provider-owned automations as the default view. Closing the modal does not stop automations."),
				localize('automations.modal.help.navigation', "Use Tab and Shift+Tab to reach categories, search, state filter, creation controls, sortable column headers, and the table. Use Down Arrow from Search to enter the table, then Up and Down Arrow to navigate. Enter opens the selected automation's details. Close Details returns focus to the table. Escape closes the modal and returns focus to its opener."),
				localize('automations.modal.help.actions', "Activate a column header to sort; activate it again to reverse the order. The On column contains enable checkboxes. Unavailable providers cannot be changed. Create with Agent starts a new draft. Choose Create Manually from its dropdown to open a separate automation dialog. Escape closes only the top dialog. Use Refresh to reload the catalogue."),
				localize('automations.modal.help.scope', "This alternative catalogue currently shows definitions and the latest run status. Full run history, templates, contextual editing, and contextual Run actions remain in the default Automations view. Turn off chat.automations.modal to return to that view."),
			].join('\n') : editor.getAccessibilityContent(),
			() => { if (dom.isHTMLElement(focused) && focused.isConnected) { focused.focus(); } else { editor.focus(); } },
			AccessibilityVerbositySettingId.Automations,
		);
	}
}

AccessibleViewRegistry.register(new AutomationsModalAccessibleView(AccessibleViewType.Help));
AccessibleViewRegistry.register(new AutomationsModalAccessibleView(AccessibleViewType.View));
