/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { SnakeGameController } from './snakeGameController.js';
import './media/snakeGame.css';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';

registerEditorContribution(SnakeGameController.ID, SnakeGameController, EditorContributionInstantiation.Lazy);

// Register command to start the snake game
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'editor.action.startSnakeGame',
			title: localize2('startSnakeGame', 'Start Snake Game'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor();
		if (editor) {
			const controller = editor.getContribution<SnakeGameController>(SnakeGameController.ID);
			controller?.startGame();
		}
	}
});

// Register command to exit the snake game
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'editor.action.exitSnakeGame',
			title: localize2('exitSnakeGame', 'Exit Snake Game'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): void {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor();
		if (editor) {
			const controller = editor.getContribution<SnakeGameController>(SnakeGameController.ID);
			controller?.exitGame();
		}
	}
});
