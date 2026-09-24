/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { getErrorMessage } from '../../../../../base/common/errors.js';
import { validateAutomationCron } from '../../../../../platform/agentHost/common/automationCron.js';

export function getAutomationCronValidationError(expression: string, timeZone: string): string | undefined {
	if (!expression.trim()) {
		return undefined;
	}
	try {
		validateAutomationCron(expression, timeZone);
		return undefined;
	} catch (error) {
		return getErrorMessage(error);
	}
}

export const DAYS_OF_WEEK: readonly string[] = [
	localize('automation.day.sun', "Sunday"),
	localize('automation.day.mon', "Monday"),
	localize('automation.day.tue', "Tuesday"),
	localize('automation.day.wed', "Wednesday"),
	localize('automation.day.thu', "Thursday"),
	localize('automation.day.fri', "Friday"),
	localize('automation.day.sat', "Saturday"),
];
