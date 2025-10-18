/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext } from 'vscode';
import { registerAPICommands } from './api/api1';
import { GitBaseExtensionImpl } from './api/extension';
import { Model } from './model';
import { registerFoldingProvider } from './foldingProvider';

export function activate(context: ExtensionContext): GitBaseExtensionImpl {
	const apiImpl = new GitBaseExtensionImpl(new Model());
	context.subscriptions.push(registerAPICommands(apiImpl));
	context.subscriptions.push(registerFoldingProvider());

	return apiImpl;
}
