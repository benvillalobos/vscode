/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { toAutomationConfigurationValue } from '../../../common/automations/automation.js';

suite('Automation configuration', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('converts JSON-compatible values', () => {
		const value = Object.assign(Object.create(null), {
			modelId: 'model',
			sessionConfig: {
				enabled: true,
				threshold: 3,
				values: [null, 'value'],
				omitted: undefined,
			},
		});

		assert.deepStrictEqual(toAutomationConfigurationValue(value), {
			modelId: 'model',
			sessionConfig: {
				enabled: true,
				threshold: 3,
				values: [null, 'value'],
			},
		});
	});

	test('rejects values that cannot be persisted safely', () => {
		class Configuration { }
		const cyclic: { self?: object } = {};
		cyclic.self = cyclic;
		const sparse = new Array(1);

		assert.throws(() => toAutomationConfigurationValue(Number.NaN), /numbers must be finite/);
		assert.throws(() => toAutomationConfigurationValue(Number.POSITIVE_INFINITY), /numbers must be finite/);
		assert.throws(() => toAutomationConfigurationValue(new Configuration()), /plain objects/);
		assert.throws(() => toAutomationConfigurationValue(cyclic), /cannot contain cycles/);
		assert.throws(() => toAutomationConfigurationValue(sparse), /cannot be sparse/);
		assert.throws(() => toAutomationConfigurationValue(() => { }), /JSON-compatible/);
	});

	test('preserves special object keys through a JSON round trip', () => {
		const value = JSON.parse('{\"__proto__\":{\"enabled\":true},\"constructor\":\"value\"}');
		const converted = toAutomationConfigurationValue(value);

		assert.deepStrictEqual(JSON.parse(JSON.stringify(converted)), value);
	});
});
