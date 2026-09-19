/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

export const GAME_CUSTOM_VIEW_ID = 'sessions.customView.game';
export const GameCustomViewFocusContext = new RawContextKey<boolean>('gameCustomViewFocus', false);
