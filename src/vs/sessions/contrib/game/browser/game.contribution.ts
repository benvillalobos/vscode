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
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { AccessibilityVerbositySettingId } from '../../../../workbench/contrib/accessibility/browser/accessibilityConfiguration.js';
import { AbstractCustomView } from '../../../services/customView/browser/customView.js';
import { ICustomViewService } from '../../../services/customView/browser/customViewService.js';
import { GAME_CUSTOM_VIEW_ID, GameCustomViewFocusContext } from '../common/game.js';
import { GameWidget, gameContextLabel, gameStatusLabel } from './gameWidget.js';
import { IGameService } from './gameService.js';

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
		this.widget = this._register(this.instantiationService.createInstance(GameWidget, {}));
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
			() => [
				localize('gameHelp', "You are in Worklands, a spatial map of agent work. Use Spawn Blob to prepare a unit and New Task to create a task site. Select a unit, then click a task or use Assign Task to assign it. To rename a blob, click its name in the detail pane, or Tab to the name and press Enter or Space. Enter confirms the new name and Escape cancels. Drag pieces or use arrow keys on a focused piece to move them. Movement never sends a request. Choose a workspace and provider, enter orders, then use Dispatch to start real work with your existing approval settings. Status labels and changed-file counts reflect the provider, not simulated progress. Spawn Child prepares a chat in the selected session. Smaller linked units show child chats and agent-created sessions. Double-click a blob's body or select it and use Open Chat to open its conversation in the right-hand chat pane while keeping the game visible. Child blobs open their own chat. Close Chat returns focus to the selected map piece. Draft blobs have no chat until dispatched. Right-click a blob or press Shift+F10 on it for Archive Session and Delete. Archive Session archives the real session and is unavailable for individual child chats. Delete uses the real session or chat deletion confirmation; a draft is only removed from the map. Remove from Map never deletes or cancels a real session. Your map and unsent orders are saved locally."),
				localize('gamePetHelp', "Blobs convey status through their chat pet artwork, with only their name underneath. Their accessible labels and the inspector still report live status. Dispatching pets type; working pets have a speech bubble. Pets needing input or reporting an error look worried. At most three working or dispatching pets animate, prioritizing selection. A completed turn automatically puts the pet to sleep; no acknowledgment is needed. Resting means the turn completed, not verified task completion. Sleeping pets keep their names, positions, and task connections. Dispatch wakes them immediately. Task labels count resting pets even when their crew is hidden."),
				localize('gameTaskEditingHelp', "To edit a selected task, click its title or description in the detail pane, or Tab to either field and press Enter or Space. Use Save to keep the change or Cancel to discard it. Enter saves a title or description. In a description, Shift+Enter inserts a new line. Escape cancels and returns focus to the field. Selecting another piece discards an unsaved edit. Editing never sends a request; the next dispatch includes the updated task brief."),
				localize('gameSelectionHelp', "Drag the map background to draw a selection rectangle. Releasing selects visible blobs whose centers are inside it; minimized crews and task sites are excluded. Escape cancels the rectangle. Shift-drag adds to the selection. Shift-click a blob, or focus it and press Shift+Enter or Shift+Space, to toggle it in the selection. The dock shows a portrait for each selected blob. Hover a portrait for its name. Tab reaches portraits; Left and Right arrows, Home, and End navigate them. Clicking a portrait or pressing Enter or Space selects only that blob and restores its individual orders. Delete Blobs in Command deletes the selected blobs using existing session and chat confirmations; drafts are removed locally. No selection gesture sends orders."),
				localize('gameMarkDoneHelp', "With multiple blobs selected, Mark Blobs as Done in Command marks their sessions as done using the same action as the session list. Their blobs are removed from the map without deleting the conversations. Include a child chat's parent blob in the selection; child chats cannot mark an unselected parent session as done. Draft blobs are removed locally. The action is unavailable while a selected blob is dispatching or its session is missing."),
				localize('gameDeselectHelp', "In a multi-selection, hovering or focusing a portrait reveals a close button in its top-right corner. Use it to remove only that blob from the selection, without removing it from the map or changing its session. Tab from a portrait to its Remove from Selection button, then press Enter or Space. Focus moves to a neighboring portrait."),
				localize('gameContextHelp', "When reported context window usage is above 50 percent, a blob looks frustrated and shows an exclamation mark. Hover or select it to read the context percentage. This does not change its working, resting, or approval status. The expression clears at 50 percent or below. Blobs without available usage data keep their normal expression."),
				localize('gameNavigationHelp', "The map extends beyond the viewport. Scroll or use its scrollbars to explore. Hold Ctrl or Shift while scrolling to zoom around the pointer. Hold the middle mouse button and drag to pan the camera without moving pieces. Release the button or press Escape to stop panning. With the map background focused, plus and minus zoom, zero resets to 100 percent, and arrow keys pan. Zoom ranges from 50 to 200 percent and does not change saved positions. Dragged blobs move outward from task sites so the task and blob remain visible."),
			].join('\n'),
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
					...units.map(unit => localize('gameAccessibleUnitContext', "Unit: {0}. {1}. Parent: {2}. Task: {3}. {4} files changed. {5} {6}", unit.name, gameStatusLabel(unit.status), units.find(parent => parent.id === unit.parentId)?.name ?? localize('gameNone', "None"), board.tasks.find(task => task.id === unit.taskId)?.title ?? localize('gameNone', "None"), unit.files, unit.activity, gameContextLabel(unit))),
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
