/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IAutomationDescriptor, IAutomationSchedule } from './automation.js';
import { ICreateAutomationOptions, IUpdateAutomationOptions } from './automationService.js';

export interface IAutomationDialogSeedValues {
	readonly name?: string;
	readonly prompt?: string;
	readonly schedule?: Partial<IAutomationSchedule>;
	readonly targetKind?: 'quickChat' | 'workspace';
}

export interface IShowAutomationDialogOptions {
	readonly existing?: IAutomationDescriptor;
	readonly seed?: IAutomationDialogSeedValues;
}

export type IAutomationDialogResult =
	| { readonly kind: 'create'; readonly value: ICreateAutomationOptions }
	| { readonly kind: 'update'; readonly id: string; readonly value: IUpdateAutomationOptions };

export const IAutomationDialogService = createDecorator<IAutomationDialogService>('automationDialogService');

/**
 * Bridges the workbench Automations UI (list widget) to the Sessions-layer
 * dialog implementation without a cross-layer import: the widget depends only
 * on this interface, while {@link AutomationDialogService} (sessions) provides it.
 */
export interface IAutomationDialogService {
	readonly _serviceBrand: undefined;
	showAutomationDialog(options: IShowAutomationDialogOptions): Promise<IAutomationDialogResult | undefined>;
}
