/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';

export type AutomationConfigurationValue =
	| null
	| boolean
	| number
	| string
	| readonly AutomationConfigurationValue[]
	| { readonly [key: string]: AutomationConfigurationValue };

export interface IAutomationConfiguration {
	readonly version: number;
	readonly value: AutomationConfigurationValue;
}

export function isAutomationConfigurationObject(value: AutomationConfigurationValue): value is { readonly [key: string]: AutomationConfigurationValue } {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toAutomationConfigurationValue(value: unknown): AutomationConfigurationValue {
	const seen = new Set<object>();
	const convert = (candidate: unknown): AutomationConfigurationValue => {
		if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'string') {
			return candidate;
		}
		if (typeof candidate === 'number') {
			if (!Number.isFinite(candidate)) {
				throw new Error('Automation configuration numbers must be finite.');
			}
			return candidate;
		}
		if (typeof candidate !== 'object') {
			throw new Error('Automation configuration must be JSON-compatible.');
		}
		if (seen.has(candidate)) {
			throw new Error('Automation configuration cannot contain cycles.');
		}
		if (!Array.isArray(candidate)) {
			const prototype = Object.getPrototypeOf(candidate);
			if (prototype !== Object.prototype && prototype !== null) {
				throw new Error('Automation configuration objects must be plain objects.');
			}
		}

		seen.add(candidate);
		try {
			if (Array.isArray(candidate)) {
				return candidate.map(convert);
			}
			const result: { [key: string]: AutomationConfigurationValue } = {};
			for (const [key, child] of Object.entries(candidate)) {
				if (child !== undefined) {
					result[key] = convert(child);
				}
			}
			return result;
		} finally {
			seen.delete(candidate);
		}
	};
	return convert(value);
}

/**
 * How often an automation runs. `hourly` fires every hour from creation/update;
 * `daily`/`weekly` fire at the configured local-time hour/minute (and day-of-week).
 */
export type AutomationInterval = 'manual' | 'hourly' | 'daily' | 'weekly';

/**
 * Describes the cadence at which an automation should fire.
 *
 * Times are stored in local-time wall-clock values. The scheduler converts
 * them to UTC when computing concrete run instants so DST transitions are
 * handled correctly.
 */
export interface IAutomationSchedule {
	readonly interval: AutomationInterval;

	/** Hour-of-day, 0-23. Ignored for `manual` and `hourly`. */
	readonly scheduleHour: number;

	/** Minute-of-hour, 0-59. Ignored for `manual` and `hourly`. */
	readonly scheduleMinute: number;

	/** Day-of-week, 0 (Sunday) through 6 (Saturday). Only used for `weekly`. */
	readonly scheduleDay: number;
}

/** Repository isolation for a workspace-backed Automation target. */
export type AutomationWorkspaceIsolation =
	| { readonly kind: 'default' }
	| { readonly kind: 'folder' }
	| { readonly kind: 'worktree'; readonly branch: string };

/** The mutually exclusive execution targets an Automation can use. */
export type AutomationTarget =
	| {
		readonly kind: 'workspace';
		readonly folderUri: URI;
		readonly providerId?: string;
		readonly sessionTypeId?: string;
		readonly isolation: AutomationWorkspaceIsolation;
	}
	| {
		readonly kind: 'quickChat';
		readonly providerId: string;
		readonly sessionTypeId: string;
	};

/**
 * A single scheduled automation. Identity is the immutable `id`; everything
 * else may be edited by the user.
 */
export interface IAutomation {
	readonly id: string;
	readonly name: string;
	readonly prompt: string;
	readonly schedule: IAutomationSchedule;

	/** Explicit workspace-backed or workspace-less execution target. */
	readonly target: AutomationTarget;

	/** Opaque, versioned configuration owned by the target provider. */
	readonly configuration?: IAutomationConfiguration;

	/** @deprecated Migrated into {@link configuration}. */
	/** Optional language model identifier to seed the new session with. */
	readonly modelId?: string;

	/** @deprecated Migrated into {@link configuration}. */
	/** Optional chat mode (`agent`/`ask`/`edit`). Defaults to provider's default; custom modes unsupported. */
	readonly mode?: string;

	/** @deprecated Migrated into {@link configuration}. */
	/** Optional permission level (`default`/`autoApprove`/`autopilot`). Overrides only for scheduled runs; defaults to provider's default. */
	readonly permissionLevel?: string;

	readonly enabled: boolean;

	/** ISO-8601 UTC timestamp. */
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly lastRunAt?: string;

	/** ISO-8601 UTC timestamp; `undefined` when interval is `manual`. */
	readonly nextRunAt?: string;
}

/**
 * Lifecycle of an automation run. A run stays `running` while its agent session
 * is active or needs input, and becomes terminal when that session completes or
 * fails, or when tracking is cancelled or times out while the session may remain active.
 */
export type AutomationRunStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * What kicked off a run. `catch_up` fires once at startup for a due-time that
 * passed while VS Code was closed.
 */
export type AutomationRunTrigger = 'schedule' | 'catch_up' | 'manual';

export interface IAutomationRun {
	readonly id: string;
	readonly automationId: string;
	readonly status: AutomationRunStatus;
	readonly trigger: AutomationRunTrigger;

	/** Session resource URI (stringified), recorded as soon as the committed session is available. */
	readonly sessionResource?: string;

	readonly startedAt: string;
	readonly completedAt?: string;
	readonly errorMessage?: string;

	/** Window that claimed this run; the leader-election guard uses it to avoid duplicate execution across windows. */
	readonly leaderWindowId: number;
}
