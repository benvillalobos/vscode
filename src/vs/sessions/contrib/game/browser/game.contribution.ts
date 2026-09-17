/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveElement, isHTMLElement } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { constObservable } from '../../../../base/common/observable.js';
import { localize } from '../../../../nls.js';
import { AccessibleContentProvider, AccessibleViewProviderId, AccessibleViewType } from '../../../../platform/accessibility/browser/accessibleView.js';
import { AccessibleViewRegistry, IAccessibleViewImplementation } from '../../../../platform/accessibility/browser/accessibleViewRegistry.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { AccessibilityVerbositySettingId } from '../../../../workbench/contrib/accessibility/browser/accessibilityConfiguration.js';
import { AbstractCustomView } from '../../../services/customView/browser/customView.js';
import { ICustomViewService } from '../../../services/customView/browser/customViewService.js';
import { GAME_CUSTOM_VIEW_ID } from '../common/game.js';
import { GameWidget, gameStatusLabel } from './gameWidget.js';
import { IGameService } from './gameService.js';

const GameCustomViewFocusContext = new RawContextKey<boolean>('gameCustomViewFocus', false);

class GameCustomView extends AbstractCustomView {
	readonly title = constObservable(localize('gameTitle', "Game"));
	override readonly maxWidth = Number.MAX_SAFE_INTEGER;
	private widget: GameWidget | undefined;

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	render(container: HTMLElement): void {
		const scopedContextKeyService = this._register(this.contextKeyService.createScoped(container));
		GameCustomViewFocusContext.bindTo(scopedContextKeyService).set(true);
		container.setAttribute('aria-label', localize('gameContentLabel', "Game"));
		this.widget = this._register(this.instantiationService.createInstance(GameWidget));
		container.appendChild(this.widget.element);
	}

	layout(width: number, height: number): void {
		this.widget?.layout(width, height);
	}

	override focus(): void { this.widget?.focus(); }
}

export class GameCustomViewContribution extends Disposable {
	static readonly ID = 'sessions.contrib.gameCustomView';

	constructor(
		@ICustomViewService customViewService: ICustomViewService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();
		this._register(customViewService.registerCustomView({
			id: GAME_CUSTOM_VIEW_ID,
			ctor: new SyncDescriptor(GameCustomView),
		}, { restore: !configurationService.getValue<boolean>('chat.disableAIFeatures') }));
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('chat.disableAIFeatures') && configurationService.getValue<boolean>('chat.disableAIFeatures') && customViewService.activeCustomView.get()?.id === GAME_CUSTOM_VIEW_ID) {
				customViewService.hideCustomView();
			}
		}));
	}
}

class GameCustomViewAccessibilityHelp implements IAccessibleViewImplementation {
	readonly type = AccessibleViewType.Help;
	readonly priority = 106;
	readonly name = 'sessions-game-help';
	readonly when = GameCustomViewFocusContext;

	getProvider(): AccessibleContentProvider {
		const focusedElement = getActiveElement();
		return new AccessibleContentProvider(
			AccessibleViewProviderId.SessionsGame,
			{ type: AccessibleViewType.Help },
			() => localize('gameHelp', "You are in Worklands, a spatial map of agent work. Use Spawn Blob to prepare a unit and New Task to create a task site. Select a unit, then click a task or use Assign Task to assign it. Drag pieces or use arrow keys on a focused piece to move them. Movement never sends a request. Choose a workspace and provider, enter orders, then use Dispatch to start real work with your existing approval settings. Status labels and changed-file counts reflect the provider, not simulated progress. Spawn Child prepares a chat in the selected session. Smaller linked units show child chats and agent-created sessions. Open Chat handles approvals, reads results, and returns to the standard session UI. Remove from Map never deletes or cancels a real session. Your map and unsent orders are saved locally."),
			() => {
				if (isHTMLElement(focusedElement) && focusedElement.isConnected) {
					focusedElement.focus();
				}
			},
			AccessibilityVerbositySettingId.SessionsGame,
		);
	}
}

class GameCustomViewAccessibleView implements IAccessibleViewImplementation {
	readonly type = AccessibleViewType.View;
	readonly priority = 106;
	readonly name = 'sessions-game-view';
	readonly when = GameCustomViewFocusContext;

	getProvider(accessor: ServicesAccessor): AccessibleContentProvider {
		const service = accessor.get(IGameService);
		const focusedElement = getActiveElement();
		return new AccessibleContentProvider(
			AccessibleViewProviderId.SessionsGame,
			{ type: AccessibleViewType.View },
			() => {
				const board = service.board.get();
				const units = service.units.get();
				return [
					localize('gameAccessibleTitle', "Worklands: tasks and units"),
					...board.tasks.map(task => localize('gameAccessibleTask', "Task: {0}. Instructions: {1}. Assigned units: {2}.", task.title, task.prompt, units.filter(unit => unit.taskId === task.id).map(unit => unit.name).join(', ') || localize('gameNone', "None"))),
					...units.map(unit => localize('gameAccessibleUnit', "Unit: {0}. {1}. Parent: {2}. Task: {3}. {4} files changed. {5}", unit.name, gameStatusLabel(unit.status), units.find(parent => parent.id === unit.parentId)?.name ?? localize('gameNone', "None"), board.tasks.find(task => task.id === unit.taskId)?.title ?? localize('gameNone', "None"), unit.files, unit.activity)),
				].join('\n\n');
			},
			() => {
				if (isHTMLElement(focusedElement) && focusedElement.isConnected) {
					focusedElement.focus();
				}
			},
			AccessibilityVerbositySettingId.SessionsGame,
		);
	}
}

registerWorkbenchContribution2(GameCustomViewContribution.ID, GameCustomViewContribution, WorkbenchPhase.BlockRestore);
AccessibleViewRegistry.register(new GameCustomViewAccessibilityHelp());
AccessibleViewRegistry.register(new GameCustomViewAccessibleView());
