/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';

export interface GamePoint {
	readonly x: number;
	readonly y: number;
}

export interface GameTask extends GamePoint {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
	/** When true, the task's assigned units are hidden from the map. */
	readonly minimized?: boolean;
}

export type GameIsolation = 'worktree' | 'workspace';

/** Where a dispatch creates its session: a workspace folder and the provider that serves it. */
export interface GameTarget {
	readonly folder?: string;
	readonly providerId?: string;
	readonly sessionTypeId?: string;
	/** Whether the dispatch gets its own worktree. Defaults to {@link gameDefaultIsolation}. */
	readonly isolation?: GameIsolation;
}

export const gameDefaultIsolation: GameIsolation = 'workspace';

export interface GameUnit extends GamePoint, GameTarget {
	readonly id: string;
	readonly name: string;
	readonly taskId?: string;
	readonly session?: string;
	readonly chat?: string;
	readonly parentId?: string;
	readonly draft: string;
	/** The task the unit's session already has as chat history context, so dispatch only re-briefs it when this changes. */
	readonly briefedTaskId?: string;
}

export interface GameBoard extends GameTarget {
	readonly version: 1;
	readonly tasks: readonly GameTask[];
	readonly units: readonly GameUnit[];
	/** Default model identifier applied to brand-new sessions dispatched from the map. */
	readonly modelId?: string;
	/** Default permission level (a {@link ChatPermissionLevel} value) applied to brand-new sessions dispatched from the map. */
	readonly permissionLevel?: string;
}

export const emptyGameBoard: GameBoard = { version: 1, tasks: [], units: [] };

/** The workspace a unit dispatches into: its own target, or the board default for units saved before per-unit targets. */
export function gameUnitTarget(board: GameBoard, unit: GameTarget): GameTarget {
	return unit.folder ? { folder: unit.folder, providerId: unit.providerId, sessionTypeId: unit.sessionTypeId, isolation: unit.isolation } : board;
}

/** Short label for a workspace folder URI, qualified by the remote authority so dev box targets are distinguishable. */
export function gameWorkspaceLabel(folder: string): string {
	const uri = URI.parse(folder);
	const name = basename(uri) || uri.path;
	return uri.authority ? `${name} (${uri.authority})` : name;
}

/** Assignment radius in the map's normalized 0-100 coordinate space. */
export const gameTaskAssignmentRadius = 44;

export function clampGamePoint(point: GamePoint): GamePoint {
	return {
		x: Math.max(6, Math.min(94, point.x)),
		y: Math.max(10, Math.min(88, point.y)),
	};
}

export function nearestGameTask(tasks: readonly GameTask[], point: GamePoint): GameTask | undefined {
	return tasks.reduce<GameTask | undefined>((nearest, task) => {
		const distance = Math.hypot(task.x - point.x, task.y - point.y);
		return distance <= gameTaskAssignmentRadius && (!nearest || distance < Math.hypot(nearest.x - point.x, nearest.y - point.y)) ? task : nearest;
	}, undefined);
}

export function gameSpawnPoint(index: number): GamePoint {
	return { x: 12 + (index % 7) * 11, y: 77 + (Math.floor(index / 7) % 2) * 9 };
}

export function gameSatellitePoint(parent: GamePoint, index: number): GamePoint {
	const angle = Math.PI / 2 + index * 2.399963;
	const radius = 14 + Math.floor(index / 6) * 6;
	return clampGamePoint({ x: parent.x + Math.cos(angle) * radius, y: parent.y + Math.sin(angle) * radius });
}

/** Reject malformed saved boards instead of interpreting them as executable work. */
export function isGameBoard(value: unknown): value is GameBoard {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const board = value as Partial<GameBoard>;
	const point = (value: GamePoint) => Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 100 && value.y >= 0 && value.y <= 100;
	const optionalString = (value: unknown) => value === undefined || typeof value === 'string';
	const optionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean';
	const optionalIsolation = (value: unknown) => value === undefined || value === 'worktree' || value === 'workspace';
	return board.version === 1
		&& Array.isArray(board.tasks) && board.tasks.length <= 200
		&& Array.isArray(board.units) && board.units.length <= 500
		&& optionalString(board.folder) && optionalString(board.providerId) && optionalString(board.sessionTypeId)
		&& optionalIsolation(board.isolation)
		&& optionalString(board.modelId) && optionalString(board.permissionLevel)
		&& board.tasks.every(task => task && typeof task.id === 'string' && typeof task.title === 'string' && typeof task.prompt === 'string' && point(task) && optionalBoolean(task.minimized))
		&& board.units.every(unit => unit && typeof unit.id === 'string' && typeof unit.name === 'string' && typeof unit.draft === 'string' && point(unit)
			&& optionalString(unit.taskId) && optionalString(unit.session) && optionalString(unit.chat) && optionalString(unit.parentId) && optionalString(unit.briefedTaskId)
			&& optionalString(unit.folder) && optionalString(unit.providerId) && optionalString(unit.sessionTypeId) && optionalIsolation(unit.isolation))
		&& new Set(board.tasks.map(task => task.id)).size === board.tasks.length
		&& new Set(board.units.map(unit => unit.id)).size === board.units.length;
}
