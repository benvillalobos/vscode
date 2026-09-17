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
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { AccessibilityVerbositySettingId } from '../../../../workbench/contrib/accessibility/browser/accessibilityConfiguration.js';
import { AbstractCustomView } from '../../../services/customView/browser/customView.js';
import { ICustomViewService } from '../../../services/customView/browser/customViewService.js';
import { GAME_CUSTOM_VIEW_ID } from '../common/game.js';

const GameCustomViewFocusContext = new RawContextKey<boolean>('gameCustomViewFocus', false);

class GameCustomView extends AbstractCustomView {
	readonly title = constObservable(localize('gameTitle', "Game"));

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();
	}

	render(container: HTMLElement): void {
		const scopedContextKeyService = this._register(this.contextKeyService.createScoped(container));
		GameCustomViewFocusContext.bindTo(scopedContextKeyService).set(true);
		container.setAttribute('aria-label', localize('gameContentLabel', "Game"));
	}

	layout(_width: number, _height: number): void { }
}

export class GameCustomViewContribution extends Disposable {
	static readonly ID = 'sessions.contrib.gameCustomView';

	constructor(
		@ICustomViewService customViewService: ICustomViewService,
	) {
		super();
		this._register(customViewService.registerCustomView({
			id: GAME_CUSTOM_VIEW_ID,
			ctor: new SyncDescriptor(GameCustomView),
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
			() => localize('gameHelp', "You are in the Game view. This view is currently empty. Open a session from the primary sidebar to return to your chats."),
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
