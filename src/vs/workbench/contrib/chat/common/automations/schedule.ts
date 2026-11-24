/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { getErrorMessage } from '../../../../../base/common/errors.js';
import { validateAutomationCron } from '../../../../../platform/agentHost/common/automationCron.js';
import { IAutomationSchedule } from './automation.js';

/** Projects a fixed UTC schedule into local wall-clock fields using a Date.getTimezoneOffset() value. */
export function automationScheduleToLocal(schedule: IAutomationSchedule, timezoneOffset = new Date().getTimezoneOffset()): IAutomationSchedule {
	if (schedule.timeZone !== 'UTC') {
		return schedule;
	}
	const { timeZone: _timeZone, ...local } = shiftSchedule(schedule, -timezoneOffset);
	return local;
}

/** Converts local wall-clock fields to fixed UTC, using the same offset as the editing session. */
export function automationScheduleToUTC(schedule: IAutomationSchedule, timezoneOffset = new Date().getTimezoneOffset()): IAutomationSchedule {
	return schedule.timeZone === 'UTC' ? schedule : { ...shiftSchedule(schedule, timezoneOffset), timeZone: 'UTC' };
}

function shiftSchedule(schedule: IAutomationSchedule, minutes: number): IAutomationSchedule {
	if (schedule.interval !== 'daily' && schedule.interval !== 'weekly') {
		return schedule;
	}
	const shifted = schedule.scheduleHour * 60 + schedule.scheduleMinute + minutes;
	const minuteOfDay = ((shifted % 1440) + 1440) % 1440;
	return {
		...schedule,
		scheduleHour: Math.floor(minuteOfDay / 60),
		scheduleMinute: minuteOfDay % 60,
		scheduleDay: schedule.interval === 'weekly'
			? ((schedule.scheduleDay + Math.floor(shifted / 1440)) % 7 + 7) % 7
			: schedule.scheduleDay,
	};
}

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

export function formatAutomationSchedule(schedule: IAutomationSchedule): string {
	const localSchedule = automationScheduleToLocal(schedule);
	const { interval, scheduleHour, scheduleMinute } = localSchedule;
	const date = new Date(Date.UTC(2000, 0, 1, Math.max(0, Math.min(23, scheduleHour | 0)), Math.max(0, Math.min(59, scheduleMinute | 0))));
	const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
	switch (interval) {
		case 'once': return localize('scheduleOnceAt', "Once: {0}", schedule.runAt ? new Date(schedule.runAt).toLocaleString() : '');
		case 'cron': return localize('scheduleCron', "Cron: {0}", schedule.cronExpression);
		case 'hourly': return localize('scheduleHourly', "Hourly");
		case 'daily': return localize('scheduleDailyAt', "Daily at {0}", time);
		case 'weekdays': return localize('scheduleWeekdaysAt', "Weekdays at {0}", time);
		case 'weekly': {
			const day = DAYS_OF_WEEK[((localSchedule.scheduleDay % 7) + 7) % 7];
			return localize('scheduleWeeklyAt', "{0} at {1}", day, time);
		}
		case 'manual': return localize('scheduleManual', "Manual");
		case 'custom': return localize('scheduleCustom', "Custom schedule");
	}
}
