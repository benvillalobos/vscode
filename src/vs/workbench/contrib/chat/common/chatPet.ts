/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ChatPetState = 'idle' | 'sleep' | 'waking' | 'typing' | 'rendering' | 'achievementUnlocked' | 'buttonPress' | 'complete' | 'love' | 'clapping' | 'jump' | 'cool' | 'yapping' | 'yappingMouthOpen' | 'sing' | 'speechless' | 'worry' | 'dizzy' | 'falling' | 'wallImpact' | 'splat' | 'onTheRun' | 'searching' | 'searchingDown';

export function getChatPetBuddyName(quality: string | undefined): 'buddy-idle-stable' | 'buddy-idle-insiders' {
	return quality === 'stable' ? 'buddy-idle-stable' : 'buddy-idle-insiders';
}

export function getChatPetSpriteName(state: ChatPetState, quality: string | undefined): string {
	const variant = quality === 'stable' ? 'stable' : 'insiders';
	switch (state) {
		case 'love':
			return `buddy-love-${variant}`;
		case 'clapping':
			return `buddy-clapping-${variant}`;
		case 'cool':
			return `buddy-cool-${variant}`;
		case 'buttonPress':
			return `buddy-press-button-${variant}`;
		case 'falling':
			return `buddy-falling-${variant}`;
		case 'jump':
			return `buddy-jump-${variant}`;
		case 'dizzy':
			return `buddy-dizzy-${variant}`;
		case 'wallImpact':
			return `buddy-wall-impact-${variant}`;
		case 'splat':
			return `buddy-splat-${variant}`;
		case 'onTheRun':
		case 'searching':
		case 'searchingDown':
			return `buddy-search-${variant}`;
		case 'sleep':
			return `buddy-sleep-${variant}`;
		case 'waking':
			return `buddy-waking-${variant}`;
		case 'typing':
			return `buddy-typing-${variant}`;
		case 'rendering':
		case 'achievementUnlocked':
			return `buddy-rendering-${variant}`;
		case 'yappingMouthOpen':
			return `buddy-yapping-${variant}`;
		case 'sing':
		case 'speechless':
		case 'worry':
			return `buddy-${state}-${variant}`;
		default:
			return getChatPetBuddyName(quality);
	}
}
