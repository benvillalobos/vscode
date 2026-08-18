/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const AgentHostPreserveTitleMetadataKey = 'vscode.agentHost.preserveTitle';

export function readAgentHostPreserveTitle(state: { readonly _meta?: Record<string, unknown> } | undefined): boolean {
	// eslint-disable-next-line local/code-no-untyped-meta-access -- sanctioned access to the namespaced preserve-title slot.
	return state?._meta?.[AgentHostPreserveTitleMetadataKey] === true;
}
