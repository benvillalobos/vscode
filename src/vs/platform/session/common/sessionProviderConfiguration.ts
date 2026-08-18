/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Opaque, provider-owned configuration captured from a new-session draft.
 */
export interface ISessionProviderConfiguration {
	readonly providerId: string;
	readonly sessionTypeId: string;
	readonly version: number;
	readonly data: string;
}
