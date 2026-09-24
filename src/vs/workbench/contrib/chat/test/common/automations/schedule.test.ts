/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { getAutomationCronValidationError } from '../../../common/automations/schedule.js';

suite('Automation cron input validation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps empty input neutral and reports the host validation message', () => {
		assert.deepStrictEqual(['', '   ', '*/2 * * * *', '0 24 * * *'].map(expression => getAutomationCronValidationError(expression, 'UTC')), [
			undefined, undefined, undefined, 'Hour value is outside 0-23: 24',
		]);
	});
});
