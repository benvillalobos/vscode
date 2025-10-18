/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Provides folding ranges for git commit messages.
 * Folds consecutive comment lines (lines starting with '#') that Git adds to commit message files.
 */
export class GitCommitFoldingProvider implements vscode.FoldingRangeProvider {

	provideFoldingRanges(
		document: vscode.TextDocument,
		_context: vscode.FoldingContext,
		_token: vscode.CancellationToken
	): vscode.FoldingRange[] {
		const ranges: vscode.FoldingRange[] = [];

		if (document.lineCount === 0) {
			return ranges;
		}

		let commentBlockStart: number | undefined;

		for (let i = 0; i < document.lineCount; i++) {
			const line = document.lineAt(i).text;

			if (line.startsWith('#')) {
				// Start of a comment block or continuation
				if (commentBlockStart === undefined) {
					commentBlockStart = i;
				}
			} else if (commentBlockStart !== undefined) {
				// End of comment block found
				if (i - commentBlockStart > 1) {
					// Only create folding range if block has 2 or more lines
					ranges.push(new vscode.FoldingRange(
						commentBlockStart,
						i - 1,
						vscode.FoldingRangeKind.Comment
					));
				}
				commentBlockStart = undefined;
			}
		}

		// Handle comment block that extends to end of file
		if (commentBlockStart !== undefined && document.lineCount - commentBlockStart > 1) {
			ranges.push(new vscode.FoldingRange(
				commentBlockStart,
				document.lineCount - 1,
				vscode.FoldingRangeKind.Comment
			));
		}

		return ranges;
	}
}

/**
 * Registers the folding range provider for git commit messages.
 * @returns A disposable that unregisters the provider when disposed.
 */
export function registerFoldingProvider(): vscode.Disposable {
	return vscode.languages.registerFoldingRangeProvider(
		{ language: 'git-commit' },
		new GitCommitFoldingProvider()
	);
}
