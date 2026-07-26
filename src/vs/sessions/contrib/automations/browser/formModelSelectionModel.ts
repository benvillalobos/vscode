/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun, IObservable, observableValue } from '../../../../base/common/observable.js';
import { ILanguageModelsService } from '../../../../workbench/contrib/chat/common/languageModels.js';
import { ChatAgentLocation, ChatModeKind } from '../../../../workbench/contrib/chat/common/constants.js';
import { filterModelsForSession } from '../../../../workbench/contrib/chat/browser/widget/input/chatInputModelUtils.js';
import { getRegisteredLanguageModels } from '../../../../workbench/contrib/chat/common/modelSelection.js';
import { hasSelectableModel, INormalizedSessionModelPickerOptions, ISessionModelSelectionModel, ISessionModelSelectionState } from '../../chat/browser/sessionModelSelectionModel.js';

const DEFAULT_OPTIONS: INormalizedSessionModelPickerOptions = {
	useGroupedModelPicker: true,
	showFeatured: true,
	showUnavailableFeatured: false,
	showManageModelsAction: false,
	showAutoModel: true,
};

/**
 * A sessionless model selection model for the automation dialog.
 * Filters the global model pool by the selected session type.
 */
export class FormModelSelectionModel extends Disposable implements ISessionModelSelectionModel {
	declare readonly _serviceBrand: undefined;

	private readonly _state = observableValue<ISessionModelSelectionState>(this, {
		currentModel: undefined,
		pendingSelection: undefined,
		models: [],
		options: DEFAULT_OPTIONS,
		hasSelectableModel: false,
	});

	readonly state: IObservable<ISessionModelSelectionState> = this._state;

	constructor(
		private readonly _sessionType: IObservable<string | undefined>,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
	) {
		super();

		this._register(autorun(reader => {
			this._refresh(this._sessionType.read(reader));
		}));
		this._register(this._languageModelsService.onDidChangeLanguageModels(() => {
			this._refresh(this._sessionType.get());
		}));
	}

	selectModel(modelIdentifier: string): boolean {
		const current = this._state.get();
		const model = current.models.find(candidate => candidate.identifier === modelIdentifier);
		if (!model) {
			return false;
		}

		this._state.set({
			...current,
			currentModel: model,
			pendingSelection: undefined,
		}, undefined);

		return true;
	}

	private _refresh(sessionType: string | undefined): void {
		const allModels = getRegisteredLanguageModels(this._languageModelsService);
		const models = filterModelsForSession(allModels, sessionType, ChatModeKind.Agent, ChatAgentLocation.Chat);
		const current = this._state.get();
		const currentModel = current.currentModel && models.find(model => model.identifier === current.currentModel?.identifier);
		const fallbackModel = models.find(model => model.metadata.isDefaultForLocation?.[ChatAgentLocation.Chat]) ?? models[0];

		this._state.set({
			models,
			options: DEFAULT_OPTIONS,
			hasSelectableModel: hasSelectableModel(models, DEFAULT_OPTIONS),
			currentModel: currentModel ?? fallbackModel,
			pendingSelection: undefined,
		}, undefined);
	}
}
