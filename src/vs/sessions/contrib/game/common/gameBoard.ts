/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface GamePoint {
	readonly x: number;
	readonly y: number;
}

export interface GameTask extends GamePoint {
	readonly id: string;
	readonly title: string;
	readonly prompt: string;
}

export interface GameUnit extends GamePoint {
	readonly id: string;
	readonly name: string;
	readonly taskId?: string;
	readonly session?: string;
	readonly chat?: string;
	readonly parentId?: string;
	readonly draft: string;
}

export interface GameBoard {
	readonly version: 1;
	readonly tasks: readonly GameTask[];
	readonly units: readonly GameUnit[];
	readonly folder?: string;
	readonly providerId?: string;
	readonly sessionTypeId?: string;
}

export const emptyGameBoard: GameBoard = { version: 1, tasks: [], units: [] };

export function clampGamePoint(point: GamePoint): GamePoint {
	return {
		x: Math.max(6, Math.min(94, point.x)),
		y: Math.max(10, Math.min(88, point.y)),
	};
}

export function nearestGameTask(tasks: readonly GameTask[], point: GamePoint): GameTask | undefined {
	return tasks.reduce<GameTask | undefined>((nearest, task) => {
		const distance = Math.hypot(task.x - point.x, task.y - point.y);
		return distance <= 15 && (!nearest || distance < Math.hypot(nearest.x - point.x, nearest.y - point.y)) ? task : nearest;
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
	return board.version === 1
		&& Array.isArray(board.tasks) && board.tasks.length <= 200
		&& Array.isArray(board.units) && board.units.length <= 500
		&& optionalString(board.folder) && optionalString(board.providerId) && optionalString(board.sessionTypeId)
		&& board.tasks.every(task => task && typeof task.id === 'string' && typeof task.title === 'string' && typeof task.prompt === 'string' && point(task))
		&& board.units.every(unit => unit && typeof unit.id === 'string' && typeof unit.name === 'string' && typeof unit.draft === 'string' && point(unit)
			&& optionalString(unit.taskId) && optionalString(unit.session) && optionalString(unit.chat) && optionalString(unit.parentId))
		&& new Set(board.tasks.map(task => task.id)).size === board.tasks.length
		&& new Set(board.units.map(unit => unit.id)).size === board.units.length;
}
