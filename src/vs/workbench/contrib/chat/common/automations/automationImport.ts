/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import type { AutomationInterval, IAutomationSchedule } from './automation.js';

/**
 * Known frontmatter keys for `.automation.md` files.
 */
const KNOWN_KEYS = new Set(['name', 'schedule', 'target']);

/**
 * Parsed frontmatter from a `.automation.md` file.
 */
export interface IAutomationFileFrontmatter {
	readonly name: string;
	readonly schedule: string;
	readonly target: 'quickChat' | 'workspace';
}

/**
 * The result of parsing an `.automation.md` file: frontmatter + body prompt.
 */
export interface IParsedAutomationFile {
	readonly frontmatter: IAutomationFileFrontmatter;
	readonly prompt: string;
}

/**
 * Seed values ready to pass into the automation create dialog.
 */
export interface IAutomationImportDraft {
	readonly name: string;
	readonly prompt: string;
	readonly schedule: IAutomationSchedule;
	readonly targetKind: 'quickChat' | 'workspace';
}

export interface IAutomationImportIssue {
	readonly code:
		| 'missingFrontmatter'
		| 'invalidYaml'
		| 'unknownField'
		| 'missingField'
		| 'invalidFieldType'
		| 'invalidFieldValue'
		| 'invalidSchedule'
		| 'missingPrompt';
	readonly message: string;
}

export interface IAutomationImportResult {
	readonly ok: boolean;
	readonly parsed?: IParsedAutomationFile;
	readonly draft?: IAutomationImportDraft;
	readonly issues: readonly IAutomationImportIssue[];
}

// Schedule day abbreviations mapped to Date day-of-week (0=Sun, 6=Sat)
const DAY_ABBREVS: Record<string, number> = {
	sun: 0, sunday: 0,
	mon: 1, monday: 1,
	tue: 2, tuesday: 2,
	wed: 3, wednesday: 3,
	thu: 4, thursday: 4,
	fri: 5, friday: 5,
	sat: 6, saturday: 6,
};

/**
 * Parse a human-readable schedule string into an {@link IAutomationSchedule}.
 *
 * Accepted formats:
 * - `manual`
 * - `hourly`
 * - `daily HH:MM`
 * - `weekly <day> HH:MM`
 */
export function parseScheduleString(raw: string): IAutomationSchedule | undefined {
	const trimmed = raw.trim().toLowerCase();

	if (trimmed === 'manual') {
		return { interval: 'manual' as AutomationInterval, scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 };
	}

	if (trimmed === 'hourly') {
		return { interval: 'hourly' as AutomationInterval, scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 };
	}

	const dailyMatch = trimmed.match(/^daily\s+(\d{1,2}):(\d{2})$/);
	if (dailyMatch) {
		const hour = parseInt(dailyMatch[1], 10);
		const minute = parseInt(dailyMatch[2], 10);
		if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
			return undefined;
		}
		return { interval: 'daily' as AutomationInterval, scheduleHour: hour, scheduleMinute: minute, scheduleDay: 0 };
	}

	const weeklyMatch = trimmed.match(/^weekly\s+(\w+)\s+(\d{1,2}):(\d{2})$/);
	if (weeklyMatch) {
		const day = DAY_ABBREVS[weeklyMatch[1]];
		if (day === undefined) {
			return undefined;
		}
		const hour = parseInt(weeklyMatch[2], 10);
		const minute = parseInt(weeklyMatch[3], 10);
		if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
			return undefined;
		}
		return { interval: 'weekly' as AutomationInterval, scheduleHour: hour, scheduleMinute: minute, scheduleDay: day };
	}

	return undefined;
}

/**
 * Extract frontmatter and body from a markdown file.
 * Reuses the same delimiter detection as {@link PromptFileParser}.
 */
function extractFrontmatterAndBody(content: string): { yaml: string; body: string } | undefined {
	const lines = content.split(/\r?\n/);
	if (lines.length === 0 || !lines[0].match(/^---\s*$/)) {
		return undefined;
	}
	const endIndex = lines.findIndex((line, index) => index > 0 && line.match(/^---\s*$/));
	if (endIndex === -1) {
		return undefined;
	}
	const yaml = lines.slice(1, endIndex).join('\n');
	const body = lines.slice(endIndex + 1).join('\n').trim();
	return { yaml, body };
}

/**
 * Parse simple YAML key-value pairs. Handles only flat scalar values
 * (no nested objects, sequences, or multiline strings). This is intentionally
 * simple — automation frontmatter is a flat set of string fields.
 */
function parseSimpleYaml(yaml: string): Map<string, string> | undefined {
	const result = new Map<string, string>();
	const lines = yaml.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === '' || trimmed.startsWith('#')) {
			continue;
		}
		const colonIndex = trimmed.indexOf(':');
		if (colonIndex === -1) {
			return undefined;
		}
		const key = trimmed.substring(0, colonIndex).trim();
		let value = trimmed.substring(colonIndex + 1).trim();
		if (!key) {
			return undefined;
		}
		// Strip surrounding quotes (YAML allows both single and double)
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		result.set(key, value);
	}
	return result;
}

/**
 * Validate and parse the content of an `.automation.md` file.
 * Returns a result with issues (if any) and, when valid, a draft
 * ready for the automation create dialog.
 */
export function validateAutomationFile(content: string): IAutomationImportResult {
	const issues: IAutomationImportIssue[] = [];

	// Step 1: Extract frontmatter
	const extracted = extractFrontmatterAndBody(content);
	if (!extracted) {
		return {
			ok: false,
			issues: [{ code: 'missingFrontmatter', message: localize('import.missingFrontmatter', "File must start with YAML frontmatter delimited by ---") }],
		};
	}

	// Step 2: Parse YAML
	const fields = parseSimpleYaml(extracted.yaml);
	if (!fields) {
		return {
			ok: false,
			issues: [{ code: 'invalidYaml', message: localize('import.invalidYaml', "Failed to parse frontmatter YAML") }],
		};
	}

	// Step 3: Reject unknown keys
	for (const key of fields.keys()) {
		if (!KNOWN_KEYS.has(key)) {
			issues.push({ code: 'unknownField', message: localize('import.unknownField', "Unknown field: {0}", key) });
		}
	}

	// Step 4: Require fields
	const name = fields.get('name');
	if (!name) {
		issues.push({ code: 'missingField', message: localize('import.missingName', "Missing required field: name") });
	}

	const scheduleRaw = fields.get('schedule');
	if (!scheduleRaw) {
		issues.push({ code: 'missingField', message: localize('import.missingSchedule', "Missing required field: schedule") });
	}

	const targetRaw = fields.get('target');
	if (!targetRaw) {
		issues.push({ code: 'missingField', message: localize('import.missingTarget', "Missing required field: target") });
	}

	// Step 5: Validate target
	let targetKind: 'quickChat' | 'workspace' | undefined;
	if (targetRaw) {
		if (targetRaw !== 'quickChat' && targetRaw !== 'workspace') {
			issues.push({ code: 'invalidFieldValue', message: localize('import.invalidTarget', "Target must be 'quickChat' or 'workspace', got: {0}", targetRaw) });
		} else {
			targetKind = targetRaw;
		}
	}

	// Step 6: Parse schedule
	let schedule: IAutomationSchedule | undefined;
	if (scheduleRaw) {
		schedule = parseScheduleString(scheduleRaw);
		if (!schedule) {
			issues.push({ code: 'invalidSchedule', message: localize('import.invalidSchedule', "Invalid schedule: {0}. Expected: manual, hourly, daily HH:MM, or weekly <day> HH:MM", scheduleRaw) });
		}
	}

	// Step 7: Require prompt body
	if (!extracted.body) {
		issues.push({ code: 'missingPrompt', message: localize('import.missingPrompt', "File body is empty. The markdown body below the frontmatter is used as the automation prompt.") });
	}

	if (issues.length > 0) {
		return { ok: false, issues };
	}

	const parsed: IParsedAutomationFile = {
		frontmatter: { name: name!, schedule: scheduleRaw!, target: targetKind! },
		prompt: extracted.body,
	};

	const draft: IAutomationImportDraft = {
		name: name!,
		prompt: extracted.body,
		schedule: schedule!,
		targetKind: targetKind!,
	};

	return { ok: true, parsed, draft, issues: [] };
}
