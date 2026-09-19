/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from '../../../../base/common/collections.js';
import { ILanguageModelChatMetadata, ILanguageModelConfigurationSchema } from './languageModels.js';

/** Resolves the configured input window, falling back to the schema default and then the model's native window. */
export function resolveContextWindowInputTokens(
	modelConfiguration: IStringDictionary<unknown> | undefined,
	configurationSchema: ILanguageModelConfigurationSchema | undefined,
	maxInputTokens: number | undefined,
): number | undefined {
	const configuredContextSize = typeof modelConfiguration?.contextSize === 'number' ? modelConfiguration.contextSize : undefined;
	const schemaDefaultContextSize = configurationSchema?.properties?.contextSize?.default;
	return configuredContextSize
		?? (typeof schemaDefaultContextSize === 'number' ? schemaDefaultContextSize : undefined)
		?? maxInputTokens;
}

/** Requires registered metadata so the window includes the model's output budget, not just its configured input size. */
export function resolveChatContextWindow(
	metadata: ILanguageModelChatMetadata | undefined,
	modelConfiguration: IStringDictionary<unknown> | undefined,
): { maxOutputTokens: number | undefined; totalContextWindow: number } | undefined {
	if (!metadata) {
		return undefined;
	}
	const maxInputTokens = resolveContextWindowInputTokens(modelConfiguration, metadata.configurationSchema, metadata.maxInputTokens);
	const maxOutputTokens = metadata.maxOutputTokens;
	const totalContextWindow = (maxInputTokens ?? 0) + (maxOutputTokens ?? 0);
	return totalContextWindow > 0 ? { maxOutputTokens, totalContextWindow } : undefined;
}
