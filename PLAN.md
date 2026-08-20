# Automation dialog chat input migration

## Goal

Replace the Automation dialog's embedded `ChatInputPart` with `NewChatInputWidget`.

The finished dialog should:

- look like the current dialog;
- use provider-contributed session controls, including isolation and branch;
- keep Automation choices isolated from the normal New Chat composer;
- save and replay every relevant provider choice;
- preserve create, edit, quick-chat, keyboard, and accessibility behavior.

## Guiding order

**Visual shell first. Data contract second. Cleanup last.**

We should not design value extraction around individual DOM controls. The provider owns those controls, so the provider should also own how their state is captured and restored.

## Current shape

### Automation dialog

[`automationDialog.ts`](src/vs/sessions/contrib/automations/browser/automationDialog.ts)

- Builds the form and embeds `ChatInputPart`.
- Owns the workspace and session-type pickers.
- Owns a separate isolation checkbox and branch picker.
- Creates an Automation-only draft session through `AutomationSessionDraftSynchronizer`.
- Reads prompt, model, mode, permission, isolation, and branch through individual getters.

[`automationDialogService.ts`](src/vs/sessions/contrib/automations/browser/automationDialogService.ts)

- Owns dialog lifecycle, validation, focus trapping, and final result creation.
- Converts form state into the persisted Automation descriptor.

### Automation draft

[`sessionsManagementService.ts`](src/vs/sessions/services/sessions/browser/sessionsManagementService.ts)

- Keeps `automationSession` separate from the normal `newSession`.
- Replaces and disposes Automation drafts independently.
- Currently exposes `automationSession` as `ISession`.

### New chat input

[`newChatInput.ts`](src/vs/sessions/contrib/chat/browser/newChatInput.ts)

- Requires `IObservable<IActiveSession | undefined>`.
- Creates scoped session services for provider-contributed menus.
- Renders:
  - input editor;
  - attachments;
  - pet;
  - model/agent controls;
  - voice/dictation controls;
  - optional Send button;
  - session controls;
  - repository controls.
- Already supports `renderSendButton: false`.
- Does not yet support hiding the pet.
- Restores the normal New Chat draft from shared storage.
- Uses the normal New Chat model-selection persistence.

### Agent Host provider

[`baseAgentHostSessionsProvider.ts`](src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts)

- Owns dynamic draft configuration and its schema.
- Supplies provider controls through the New Session menus.
- Waits for configuration resolution before a real Send.
- Can expose the resolved create-session config.
- Currently remembers picker changes in profile storage.

## Important findings

### 1. The session type does not match

The Automation service provides `ISession`; `NewChatInputWidget` expects `IActiveSession`.

**Recommended direction:** introduce a provider-neutral composer-session facade or narrow the widget's required session contract. Do not make an Automation draft globally active.

### 2. The controls are scoped, but some state is not

The widget's `ISessionContext` is scoped correctly. However:

- model selection writes the profile-wide New Chat model preference;
- Agent Host dynamic config writes remembered profile values;
- custom-agent selection writes its profile preference;
- the mode picker model is currently shared and follows the window's active session.

This is the main cross-form contamination risk.

**Required invariant:** a choice in the Automation dialog may update only its Automation draft and persisted Automation. It must not change New Chat defaults or another open composer.

### 3. Embedded feature decisions (settled)

The embedded widget carries features the current dialog does not. Decisions:

| Feature | Decision |
|---|---|
| Pet | Keep |
| Send button | Hide (dialog button commits) |
| Attachments / drag & drop | Hide |
| Voice / dictation | Keep |
| Onboarding surfaces | Hide |
| Notification lane | Hide |
| Accessibility label | Keep default (no Send-oriented override needed) |
| New Chat draft restore/history | Do not use shared restore. Only scope to the Automation draft if cheap; otherwise disable. |

**Open sub-question:** whether draft restore/history can be scoped to the Automation draft, or should simply be off. See decision 1 below.

### 4. Provider config must settle before Save

Agent Host picker changes can trigger asynchronous schema re-resolution. The normal Send path waits for this. The dialog Save path currently does not.

**Required invariant:** Save waits for the latest draft target and provider configuration before taking a snapshot.

### 5. Existing persistence is too narrow

The Automation descriptor stores model, mode, permission, isolation, and branch as separate fields. Provider-contributed controls can represent more state, including custom agents and host-defined configuration.

**Recommended direction:** add a provider-neutral, serializable new-session configuration snapshot. Providers capture and replay their own values. Preserve legacy fields during migration.

### 6. Styling is tied to the normal New Chat host

The new input's bottom controls are styled under `.new-chat-widget-container`. The Automation dialog will not inherit that layout automatically.

**Recommended direction:** add a reusable embedded/compact presentation seam, then apply only dialog layout overrides. Reuse picker internals and tokens instead of duplicating their styles.

## Recommended migration phases

### Phase 1 — Make `NewChatInputWidget` safely embeddable

No Automation behavior change yet.

- [x] Session contract → dedicated facade (Phase 2 side; widget contract unchanged).
- [x] Keep the pet (no option needed).
- [x] Reuse `renderSendButton: false`.
- [x] Add an option to disable attachments and drag & drop (`hideAttachments`).
- [x] Keep voice/dictation available (no new option needed).
- [x] Add an option to suppress onboarding and notification surfaces (`suppressNotices`).
- [x] Add an option to disable shared draft persistence (`disableDraftPersistence`). History already caller-scoped via `historyKey`.
- [x] Caller-supplied placeholder already supported. Default accessibility label kept.
- [ ] Isolated selection-persistence policy → deferred to Phase 4 (state isolation).
- [ ] Clean hook for extra leading controls → handled in Phase 2 rendering.
- [ ] Widget option tests → covered by the Phase 2 fixture/visual checkpoint (widget needs full workbench DI; no cheap unit harness).

**Checkpoint:** the regular New Chat composer is unchanged. `typecheck-client` passes.

### Phase 2 — Render the Automation visual shell

- [x] Add a `renderExtraControls` hook to the widget (leading controls slot).
- [x] Instantiate the widget with a `VisibleSession` facade over the Automation draft observable.
- [x] Use a dialog-scoped context-key service.
- [x] Bind session-derived context keys to the Automation draft (`setActiveSessionContextKeys` + `IsNewChatSessionContext`).
- [x] Render the existing Automation workspace picker and session-type picker via `renderExtraControls`.
- [x] Let `Menus.NewSessionControl`, `Menus.NewSessionConfig`, and `Menus.NewSessionRepositoryConfig` supply provider controls (via scoped `ISessionContext` + context keys).
- [x] Add dialog-scoped compact layout styles (un-hide input container, lay out bottom row, size chips).
- [x] Hide Send, attachments, onboarding, and notification surfaces. Keep voice/dictation and the pet.
- [x] Set the Automation prompt placeholder.
- [x] Keep Enter as newline (existing keybinding, `inAutomationsDialog`) and the dialog button as commit.

**Checkpoint:** compiles cleanly; 235 automation unit tests pass. Runtime visual pass still needed.

**Post-Phase-2 polish (landed in the same commit series):**
- Consolidated the session-type picker: the dialog reuses `chatInput.sessionTypePicker` (folder/quick-chat driven) instead of building a second one; `renderForm` setup was resequenced so `chatInput` is created before the picker is configured/wired.
- Ordered the row `session type · workspace · provider pickers · provider repo picker`.
- Styling fixes: neutralized the dialog's `<ul>` indent on the composer toolbars (specificity-corrected), compact-sized + hover-highlighted the session-type/workspace chips, hid the workspace chevron, restored the workspace label, collapsed the empty voice toolbar's trailing gap.

**Interim gaps (deliberate; resolved in later phases):**
- Save reads model from the draft and isolation/branch from the provider draft config. Mode is read from `session.mode`; permission falls back to the initial value. Full fidelity → Phase 5.
- Edit does not yet pre-select the saved model/mode/permission in the pickers (prompt does seed). Edit seeding from a snapshot → Phase 5/6.
- The dialog's old isolation-group / branch UI code and its CSS remain in the file but are no longer rendered → removed in Phase 3.

### Phase 3 — Remove the dialog-owned isolation UI ✅

- [x] Remove `AutomationIsolationGroupActionViewItem` (+ `BranchLoadState`, `setAutomationControlVisible`).
- [x] Remove the Automation branch-loading and Git-repository code (imports/usages).
- [x] Remove the three `ChatInputSecondary` action registrations and the dead `onDidChangeSessionTarget` emitter.
- [x] Remove obsolete isolation/branch/harness CSS.
- [x] Remove the branch-picker DOM tests + scaffolding; keep validation/focus/model tests under the renamed 'Automation dialog form' suite.
- [x] Remove the unused `MenuId.AutomationsDialogInput` (platform).
- [x] Keep workspace and session-type target switching intact; keep `AutomationIsolationModel` (folder/quick-chat state) and `normalizeAutomationBranchNames`/`resolveAutomationModelIdentifier` (Phase-5 reuse).

**Checkpoint:** typecheck clean; 223 automation tests pass (12 dead-UI tests removed). Committed as two logical commits.

**Checkpoint:** isolation and branch come only from the selected provider.

### Phase 4 — Isolate picker state → SKIPPED / DEFERRED (2026-08-17) — see **[PLAN_PHASE4.md](PLAN_PHASE4.md)**

**Status:** intentionally **skipped**. Investigation + design complete and
reviewed (explore agents + rubber-duck + arch-review + claim-verification, all
grounded); Scope-A code implemented then stashed (`git stash@{0}`,
`files/scope-a.patch`). No Phase-4 commits.

**Decision:** the profile-wide "remembered" picks (model, thinking level,
permission, execution mode) may leak — because they are only read to **seed the
new-session page and the automation draft**. Accepted condition, **VERIFIED to
hold today:** clicking into an EXISTING session loads that session's own settings,
not the cache (model: `sessionModelSelectionModel.ts:244` branches
untitled-vs-existing; config: remembered store read only in
`_initialNewSessionConfig`, `baseAgentHostSessionsProvider.ts:3074`). Full leak
inventory, two-mechanism map, and the recommended design (if revisited) live in
PLAN_PHASE4.md.

### Phase 5 — Add provider-owned snapshot and replay → see **[PLAN_PHASE5.md](PLAN_PHASE5.md)**

**Status:** IMPLEMENTED (uncommitted). Three parallel source traces + focused
rubber-duck informed the design; two code-review passes found and verified fixes.
Typecheck, layer validation, and 436 targeted tests pass.

Define an optional opaque, versioned provider snapshot that providers capture
from a settled draft and accept at draft creation. Providers own parsing,
migration, current-schema validation, policy enforcement, and replay ordering.
Shared code checks provider/session-type identity but never inspects snapshot
data.

- [x] Provider-neutral capture/create-options contract.
- [x] First Agent Host round-trip test proving create-option seeding is early enough.
- [x] Agent Host local/remote + workspace/quick-chat capture/replay.
- [x] Copilot local/cloud capture/replay with live workspace-branch semantics.
- [x] Automation persistence + legacy compatibility using schema v3.

**Decisions:** capture effective shown values; keep storage schema v3 (accept old
builds may strip the snapshot); leave thinking/context visible but not preserved;
fail runs when saved permission/isolation cannot be honored. Explicit-choice
provenance and Sessions model-configuration replay are separate features.

### Phase 6 — Wire Save, edit, and run

**Status:** IMPLEMENTED with Phase 5 so the snapshot capability is functional
end-to-end rather than unused plumbing.

Save order:

1. Validate form fields.
2. Synchronize the target draft.
3. Wait for provider config to settle.
4. Read prompt and target pickers.
5. Ask the provider for the draft snapshot.
6. Persist the normalized Automation descriptor.

Edit order:

1. Read the descriptor.
2. Convert legacy fields to the normalized snapshot.
3. Seed workspace and session type.
4. Create the Automation draft with the saved snapshot.
5. Render controls from that draft.

Run order:

1. Resolve the target provider.
2. Create the real draft with the saved snapshot.
3. Wait for configuration.
4. Send the scheduled prompt.

### Phase 7 — Cleanup and validation

- [ ] Remove obsolete `ChatInputPart` imports, stubs, menu actions, and CSS.
- [ ] Remove getter plumbing replaced by the snapshot contract.
- [ ] Update Automation persistence tests and legacy migration tests.
- [ ] Update management-service draft lifecycle tests.
- [ ] Add provider snapshot/replay tests.
- [ ] Add no-cross-persistence tests.
- [ ] Validate create, edit, quick chat, workspace, narrow dialog, dark/light/HC themes.
- [ ] Validate keyboard focus, popup Escape behavior, Enter/newline, and screen-reader labels.
- [ ] Run targeted unit tests and the layer check if contracts/imports move.

## Value ownership

| Value | Owner after migration |
|---|---|
| Name, schedule, enabled | Automation form |
| Prompt | `NewChatInputWidget` editor |
| Workspace / quick chat | Automation workspace picker |
| Provider / session type | Session-type picker |
| Model | Provider-backed Automation draft |
| Mode / custom agent | Provider-backed Automation draft |
| Permissions | Provider-backed Automation draft |
| Isolation / branch | Provider-backed Automation draft |
| Other provider config | Provider-backed Automation draft |

## Decisions to make together

1. **Persistence shape:** add one normalized configuration snapshot or extend individual legacy fields.
2. **Default semantics:** persist explicit choices only, or pin every resolved provider value.

## Decisions

- **Session contract:** use a dedicated Automation composer-session facade. Keep the shared `NewChatInputWidget` and picker session contract stable, and do not make the Automation draft globally active.
- **Embedded features:** hide Send, attachments/drag-drop, onboarding, and notifications. Keep voice/dictation and the pet. Keep the default input accessibility label. Do not use shared New Chat draft restore; only scope restore/history to the Automation draft if it is cheap, otherwise leave it off.

## First implementation slice

Recommended first slice:

1. Add safe embedding options to `NewChatInputWidget`.
2. Add the Automation-scoped session/context plumbing.
3. Render and style the widget with provider controls.
4. Stop before Save/config extraction.

This gives the requested visual checkpoint without committing us to the wrong persistence contract.
