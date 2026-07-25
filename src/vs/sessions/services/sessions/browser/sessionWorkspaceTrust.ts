/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { ISessionsManagementService } from '../common/sessionsManagement.js';

// TODO: Tests?
export async function requestSessionWorkspaceTrust(
	folderUri: URI,
	preferredProviderId: string | undefined,
	sessionsManagementService: ISessionsManagementService,
	workspaceTrustRequestService: IWorkspaceTrustRequestService,
): Promise<boolean> {
	const resolved = sessionsManagementService.resolveWorkspace(folderUri, preferredProviderId);
	if (!resolved?.workspace.requiresWorkspaceTrust) {
		return true;
	}
	return !!await workspaceTrustRequestService.requestResourcesTrust({
		uri: folderUri,
		message: localize('sessionsService.trustFolderMessage', "An agent session will be able to read files, run commands, and make changes in this folder."),
	});
}
