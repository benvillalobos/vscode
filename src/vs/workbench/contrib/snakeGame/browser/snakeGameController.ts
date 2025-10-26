/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { Range } from '../../../../editor/common/core/range.js';
import { TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { ModelDecorationOptions } from '../../../../editor/common/model/textModel.js';
import * as dom from '../../../../base/browser/dom.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { IKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';

enum Direction {
	Up,
	Down,
	Left,
	Right
}

interface SnakePosition {
	lineNumber: number;
	column: number;
}

const INITIAL_SPEED = 150; // milliseconds

export class SnakeGameController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.snakeGame';

	private isPlaying: boolean = false;
	private snake: SnakePosition[] = [];
	private direction: Direction = Direction.Up;
	private pendingDirection: Direction | null = null;
	private score: number = 0;
	private speed: number = INITIAL_SPEED;
	private gameLoopInterval: IDisposable | null = null;
	private decorationIds: string[] = [];
	private originalReadOnly: boolean = false;
	private gameOverOverlay: HTMLElement | null = null;

	private static readonly SNAKE_HEAD_DECORATION = ModelDecorationOptions.register({
		description: 'snake-head',
		className: 'snake-head',
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
	});

	private static readonly SNAKE_BODY_DECORATION = ModelDecorationOptions.register({
		description: 'snake-body',
		className: 'snake-body',
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
	});

	private static readonly SNAKE_BLINK_DECORATION = ModelDecorationOptions.register({
		description: 'snake-blink',
		className: 'snake-body snake-blink',
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
	});

	constructor(
		private readonly editor: ICodeEditor,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super();

		// Register keyboard listener
		this._register(this.editor.onKeyDown((e) => this.handleKeyDown(e)));
	}

	public startGame(): void {
		const model = this.editor.getModel();
		if (!model || this.isPlaying) {
			return;
		}

		// Check if editor has any text
		const lineCount = model.getLineCount();
		if (lineCount === 0 || (lineCount === 1 && model.getLineContent(1).trim().length === 0)) {
			return; // Can't play with empty document
		}

		// Store original readonly state
		const options = this.editor.getOptions();
		this.originalReadOnly = options.get(EditorOption.readOnly);

		// Set editor to readonly
		this.editor.updateOptions({ readOnly: true });

		// Initialize snake in the middle of the editor
		const middleLine = Math.floor(lineCount / 2) + 1;
		const lineContent = model.getLineContent(middleLine);
		const middleColumn = Math.floor(lineContent.length / 2) + 1;

		this.snake = [{ lineNumber: middleLine, column: middleColumn }];
		this.direction = Direction.Up;
		this.pendingDirection = null;
		this.score = 0;
		this.speed = INITIAL_SPEED;
		this.isPlaying = true;

		// Start game loop
		this.startGameLoop();

		// Update decorations
		this.updateDecorations();
	}

	public exitGame(): void {
		if (!this.isPlaying) {
			return;
		}

		this.stopGame();
	}

	private startGameLoop(): void {
		const targetWindow = dom.getWindow(this.editor.getDomNode());
		this.gameLoopInterval = dom.disposableWindowInterval(targetWindow, () => this.tick(), this.speed);
	}

	private stopGameLoop(): void {
		if (this.gameLoopInterval !== null) {
			this.gameLoopInterval.dispose();
			this.gameLoopInterval = null;
		}
	}

	private handleKeyDown(e: IKeyboardEvent): void {
		if (!this.isPlaying) {
			return;
		}

		let newDirection: Direction | null = null;

		// Arrow keys
		if (e.keyCode === 16) { // UpArrow
			newDirection = Direction.Up;
		} else if (e.keyCode === 18) { // DownArrow
			newDirection = Direction.Down;
		} else if (e.keyCode === 15) { // LeftArrow
			newDirection = Direction.Left;
		} else if (e.keyCode === 17) { // RightArrow
			newDirection = Direction.Right;
		}
		// WASD keys
		else if (e.keyCode === 45) { // W
			newDirection = Direction.Up;
		} else if (e.keyCode === 48) { // S
			newDirection = Direction.Down;
		} else if (e.keyCode === 31) { // A
			newDirection = Direction.Left;
		} else if (e.keyCode === 32) { // D
			newDirection = Direction.Right;
		}

		if (newDirection !== null) {
			// Prevent 180-degree turns
			const isOpposite =
				(this.direction === Direction.Up && newDirection === Direction.Down) ||
				(this.direction === Direction.Down && newDirection === Direction.Up) ||
				(this.direction === Direction.Left && newDirection === Direction.Right) ||
				(this.direction === Direction.Right && newDirection === Direction.Left);

			if (!isOpposite) {
				this.pendingDirection = newDirection;
			}

			e.preventDefault();
			e.stopPropagation();
		}
	}

	private tick(): void {
		const model = this.editor.getModel();
		if (!model || !this.isPlaying) {
			return;
		}

		// Apply pending direction change
		if (this.pendingDirection !== null) {
			this.direction = this.pendingDirection;
			this.pendingDirection = null;
		}

		// Calculate new head position based on direction
		const head = this.snake[0];
		let newHead: SnakePosition;

		switch (this.direction) {
			case Direction.Up:
				newHead = { lineNumber: head.lineNumber - 1, column: head.column };
				break;
			case Direction.Down:
				newHead = { lineNumber: head.lineNumber + 1, column: head.column };
				break;
			case Direction.Left:
				newHead = { lineNumber: head.lineNumber, column: head.column - 1 };
				break;
			case Direction.Right:
				newHead = { lineNumber: head.lineNumber, column: head.column + 1 };
				break;
		}

		// Check collision with bounds
		const lineCount = model.getLineCount();
		if (newHead.lineNumber < 1 || newHead.lineNumber > lineCount) {
			this.stopGame();
			return;
		}

		const lineMaxColumn = model.getLineMaxColumn(newHead.lineNumber);
		if (newHead.column < 1 || newHead.column >= lineMaxColumn) {
			this.stopGame();
			return;
		}

		// Check collision with self
		for (const segment of this.snake) {
			if (segment.lineNumber === newHead.lineNumber && segment.column === newHead.column) {
				this.stopGame();
				return;
			}
		}

		// Check if eating a character
		const range = new Range(newHead.lineNumber, newHead.column, newHead.lineNumber, newHead.column + 1);
		const characterAtPosition = model.getValueInRange(range);
		const ateCharacter = characterAtPosition.trim().length > 0;

		// Add new head
		this.snake.unshift(newHead);

		if (ateCharacter) {
			// Delete the character
			model.pushEditOperations(
				[],
				[{ range, text: ' ' }],
				() => null
			);
			this.score++;

			// Increase speed (decrease interval)
			if (this.speed > 50) {
				this.speed = Math.max(50, this.speed - 5);
				this.stopGameLoop();
				this.startGameLoop();
			}
		} else {
			// Remove tail if no character eaten
			this.snake.pop();
		}

		this.updateDecorations();
	}

	private updateDecorations(): void {
		const model = this.editor.getModel();
		if (!model) {
			return;
		}

		const decorations: { range: Range; options: ModelDecorationOptions }[] = [];

		for (let i = 0; i < this.snake.length; i++) {
			const segment = this.snake[i];
			const range = new Range(
				segment.lineNumber,
				segment.column,
				segment.lineNumber,
				segment.column + 1
			);

			decorations.push({
				range,
				options: i === 0 ? SnakeGameController.SNAKE_HEAD_DECORATION : SnakeGameController.SNAKE_BODY_DECORATION
			});
		}

		this.editor.changeDecorations((accessor) => {
			this.decorationIds = accessor.deltaDecorations(this.decorationIds, decorations);
		});
	}

	private stopGame(): void {
		this.isPlaying = false;
		this.stopGameLoop();

		// Blink the snake before clearing
		if (this.snake.length > 0) {
			this.blinkSnakeAndShowGameOver();
		} else {
			// Restore readonly state
			this.editor.updateOptions({ readOnly: this.originalReadOnly });
			const model = this.editor.getModel();
			if (model) {
				this.decorationIds = model.deltaDecorations(this.decorationIds, []);
			}
			this.snake = [];
		}
	}

	private blinkSnakeAndShowGameOver(): void {
		const model = this.editor.getModel();
		if (!model) {
			return;
		}

		// Apply blink decoration to all snake segments
		const blinkDecorations: { range: Range; options: ModelDecorationOptions }[] = [];
		for (const segment of this.snake) {
			const range = new Range(
				segment.lineNumber,
				segment.column,
				segment.lineNumber,
				segment.column + 1
			);
			blinkDecorations.push({
				range,
				options: SnakeGameController.SNAKE_BLINK_DECORATION
			});
		}

		this.editor.changeDecorations((accessor) => {
			this.decorationIds = accessor.deltaDecorations(this.decorationIds, blinkDecorations);
		});

		// Show game over overlay
		const editorDom = this.editor.getDomNode();
		if (editorDom) {
			const targetWindow = dom.getWindow(editorDom);
			const overlay = targetWindow.document.createElement('div');
			overlay.className = 'snake-game-over-overlay';
			overlay.textContent = `Game Over! Score: ${this.score}`;
			editorDom.appendChild(overlay);
			this.gameOverOverlay = overlay;

			// Clear decorations and overlay after animation
			dom.disposableWindowInterval(targetWindow, () => {
				if (this.gameOverOverlay && this.gameOverOverlay.parentNode) {
					this.gameOverOverlay.parentNode.removeChild(this.gameOverOverlay);
					this.gameOverOverlay = null;
				}
				this.editor.updateOptions({ readOnly: this.originalReadOnly });
				const currentModel = this.editor.getModel();
				if (currentModel) {
					this.decorationIds = currentModel.deltaDecorations(this.decorationIds, []);
				}
				this.snake = [];
				return true; // Stop the interval
			}, 2000, 1);
		}
	}

	public override dispose(): void {
		this.stopGame();
		super.dispose();
	}
}
