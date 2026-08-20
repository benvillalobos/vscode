# Phase 5 — Provider-owned automation configuration snapshot

Self-contained working plan for the Automations dialog → `NewChatInputWidget`
migration. Uncommitted alongside `PLAN.md`, `PLAN_PHASE4.md`, and
`LEARNINGS.md`.

## Status: IMPLEMENTED (uncommitted)

Three parallel, read-only traces covered:

1. current dialog → descriptor → edit → runner flow;
2. Agent Host draft configuration;
3. Copilot Chat provider draft configuration.

Load-bearing claims below were checked directly against source. A focused
rubber-duck then challenged the semantic contract; consequential claims were
verified directly before adoption.

Implementation now includes the provider-neutral envelope, Agent Host and
Copilot local/cloud capture/replay, v3 ledger persistence, management threading,
dialog Save/Edit capture/seeding, runner replay, security-sensitive fail-closed
behavior, specifications, and targeted tests.

Validation:

- `npm run typecheck-client` — pass
- `npm run valid-layers-check` — pass
- 436 targeted tests passing, 13 pre-existing pending, 0 failing
- two focused code-review passes; all findings addressed; final retry review clean

## Product decisions (2026-08-17)

1. **Capture effective values shown by provider controls**, not explicit-choice
   provenance. Providers may recompute environment-derived values and enforce
   current policy/schema at replay.
2. **Keep automation storage at schema v3.** Older builds remain writable even
   though their next mutation may strip the unknown snapshot field. This
   compatibility tradeoff is accepted.
3. **Leave thinking/context controls visible** in the Automation dialog even
   though Save/Run will not preserve them yet. A Sessions model-configuration
   replay contract is out of Phase 5.
4. **Fail an automation run explicitly** if a saved security-sensitive
   permission/isolation choice can no longer be honored. Do not silently use a
   provider default.

## Goal

Save, edit, and run must use the same configuration:

> Save captures the configuration shown by the provider-owned controls. Edit
> creates its draft from that saved configuration before controls become
> interactive. Run creates the real draft from the same configuration before
> sending the prompt.

Providers own interpretation, validation, policy enforcement, and evolution of
their configuration. Shared Automations/Sessions code must not import provider
implementations or branch on provider IDs.

## Current state (verified)

| Value | Save now | Edit seed now | Run now |
|---|---|---|---|
| Target (workspace/quick chat/provider/type) | form state | yes | yes |
| Prompt/schedule/enabled | form/editor | yes | yes |
| Model | reads draft `ISession.modelId` | **no** — draft starts from current default | `setModel` |
| Mode/custom agent | reads draft `ISession.mode.id` | **no** — draft starts from current default | `setMode` where supported |
| Permission | **initial saved value only**, not current picker | **no** | `setPermissionLevel` where supported |
| Isolation/branch | Agent Host-only bridge reads dynamic config | target seeds form, not provider draft | worktree setters |
| Provider-defined config | not captured | not seeded | not replayed |
| Model configuration (thinking/context) | not captured | not seeded | no Sessions request contract |

Provider controls DO render in the dialog through `NewChatInputWidget` menus
(`automationDialog.ts:524-527`). The current temporary getters are at
`automationDialog.ts:646-652`; permission is explicitly marked TODO(phase5).

The draft synchronizer currently creates a draft from target identity only
(`automationDialog.ts:275-283`). Saved model/mode/permission/config are not
passed into that draft, so opening Edit can display current defaults and Save can
overwrite the descriptor without an intentional user change.

The runner maps the legacy descriptor fields to `ICreateNewSessionOptions`
(`automationRunner.ts:80-96`). Management then applies model, mode, permission,
and worktree fields after provider draft creation
(`sessionsManagementService.ts:819-856`).

## Provider facts that constrain the design

### Agent Host

- `NewSession._config` owns the current resolved schema + effective values.
- `getSessionConfig(sessionId)` exposes it; it does **not** distinguish explicit
  user picks from remembered/settings/policy/default seeds.
- `NewSession.waitForConfigResolution()` is reliable but provider-private.
- `provider.createNewSession(..., options)` can pass saved values into the
  `NewSession` constructor before `_createDraftSession` starts eager backend
  creation. This is safer than replaying values through UI setters after return.
- Dynamic values can change schema. Replay must re-resolve against the current
  host, reapply policy normalization, ignore/diagnose obsolete keys, and wait
  for the final resolve.
- Model and selected custom agent are already exposed through `ISession.modelId`
  and `ISession.mode`; an earlier exploration claim that private getters were
  required was wrong.
- Local and remote providers share `BaseAgentHostSessionsProvider`; the contract
  must work for both workspace drafts and quick chat.

### Copilot Chat provider

- Local CLI drafts separately own model, mode, permission, isolation, branch,
  and selected option values.
- Cloud drafts use extension-provided option groups and have a materially
  different capability set.
- Only model and mode are exposed through generic `ISession`; other values are
  provider-private.
- The provider does not support quick chat.
- It also does not retain whether permission/isolation/branch came from an
  explicit pick or from defaults/storage/automatic repository resolution.
- Snapshot capture/replay therefore belongs inside the provider, not in shared
  code downcasting concrete sessions.

## Recommended architecture: one opaque provider-owned snapshot

Add an optional provider-neutral capability to `ISessionsProvider`:

- capture the settled configuration of a new-session draft;
- accept a previously captured configuration in
  `ISessionsProviderCreateSessionOptions`;
- validate/version/re-resolve it inside the provider before publishing a usable
  draft.

The shared value should be opaque and serializable. Candidate shape:

```ts
interface ISessionProviderConfiguration {
	readonly providerId: string;
	readonly sessionTypeId: string;
	readonly version: number;
	readonly data: string;
}
```

The provider owns `data` and its version migration. Shared code may copy/store
it but must not inspect it. Shared code checks the envelope's provider/session
type against the selected target; the provider checks again before parsing.

Why creation options rather than post-creation setters:

- Agent Host can seed `NewSession` before eager `createSession`;
- Edit controls first observe the seeded draft, not defaults followed by a
  visible correction;
- providers can apply fields atomically/in the right order;
- schema evolution and policy enforcement stay provider-owned.

### Compatibility

Add an optional serialized provider snapshot to `IAutomationDescriptor`. Keep
the existing `modelId`, `mode`, `permissionLevel`, and target isolation fields
for legacy schema v1-v3 and providers without the new capability.

Runner precedence:

1. If a compatible provider snapshot exists and the selected provider/session
   type still match, pass it at draft creation.
2. Otherwise use the legacy per-field create options.
3. Provider validation/policy remains authoritative.
4. If a saved security-sensitive choice (permission or isolation) cannot be
   honored safely, fail the run explicitly. Providers may drop obsolete
   non-security presentation/options while reporting diagnostics, but must not
   silently replace a saved permission/isolation choice with a more permissive
   default.

Edit precedence is the same. If the user changes provider/session type, drop
the incompatible snapshot and create from that target's defaults.

### Storage-version decision

Automation storage is currently schema v3.

- **Keep v3 + optional field:** newer builds work, but an older build reads only
  known fields and `serializeAutomation` writes a fresh object without unknown
  fields. Its next mutation silently strips the snapshot.
- **Bump to v4:** older builds intentionally enter read-only mode
  (`automationService.ts:525-527`). This is more disruptive across versions,
  but prevents silent loss or running an automation without configuration the
  older build cannot understand.
- **Separate sidecar storage:** could preserve v3 compatibility but loses the
  ledger's atomic compare-and-swap semantics and adds lifecycle/migration
  complexity.

Decision: keep v3 and accept the stripping risk in favor of old-build
writability. Add tests that document this behavior. Existing v1-v3 descriptors
continue through legacy fields.

## Major unresolved decision: effective values vs explicit choices

Neither provider currently records selection provenance. A snapshot of current
state therefore captures **effective values**, including remembered defaults,
settings, and some automatic repository choices.

### Option A — capture effective values (recommended first slice)

- Smaller and gives deterministic Save/Edit/Run fidelity now.
- Matches what the controls visibly show at Save.
- Policy/current schema still override or reject stale values at replay.
- But future provider defaults do not flow into an existing automation.

### Option B — capture explicit choices only

- Preserves evolving provider defaults.
- Requires new provenance tracking in every relevant setter/picker and careful
  distinction between default seeding, edit replay, programmatic run replay,
  automatic repository updates, and actual user picks.
- Larger cross-provider change and easy to get subtly wrong.

Recommendation: implement effective-value snapshots first. Treat explicit-only
provenance as a separate feature unless product semantics require it now.

Effective-value fidelity has provider-defined exceptions. For example, Copilot
workspace-mode branch follows live Git state for the session lifetime; only a
worktree branch is a stable captured value. Providers may recompute
environment-derived values at replay and must document those semantics.

## Model configuration (thinking/context)

This is not currently a Sessions provider configuration:

- sessions `ModelPicker` falls back to global `ILanguageModelsService`;
- `NewChatInputWidget` send requests carry query/attachments/background only;
- the Sessions request path has no model-configuration field.

The thinking/context control is interactive in the dialog today, so silently
deferring while leaving it editable would violate the phase invariant. Do not
smuggle it into provider snapshot data. Either:

1. hide/disable model-configuration actions in the Automation composer for this
   phase; or
2. add a separate Sessions-wide model-configuration contract before including
   it in Phase 5.

Decision: leave the controls visible and explicitly defer fidelity. Do not add a
Sessions-wide model-configuration contract in Phase 5.

## Implementation slices

### 5A — Contract + first arbitrating Agent Host test ✅

- Add optional opaque capture/create capability to `ISessionsProvider`.
- Thread snapshot through `ISessionsProviderCreateSessionOptions` and
  `ICreateNewSessionOptions`.
- Before broad plumbing, prove one non-default Agent Host permission/mode can
  be captured and passed into a fresh draft through create options only, remains
  selected after config re-resolution, and never exposes the global default
  before correcting.

### 5B — Agent Host ✅

- Capture settled draft configuration inside the provider.
- Seed snapshot before `NewSession` eager creation.
- Re-resolve with current schema/policy and expose loading until settled.
- Cover workspace, quick chat, local, remote, obsolete keys, policy changes.

### 5C — Copilot Chat provider ✅

- Capture/replay local CLI fields and cloud option selections provider-side.
- Respect local/cloud capability differences.
- Seed inside construction before repository resolution starts.
- Treat workspace-mode branch as live environment state, not a stable captured
  branch; preserve worktree branch.
- Test provider/session-type mismatch and option disappearance.

### 5D — Automation storage ✅

- Add optional snapshot to Automation persistence using the chosen versioning
  strategy; preserve legacy descriptors.
- Tests: snapshot serialization, malformed/unsupported envelope, old schema
  compatibility, and chosen cross-version behavior.

### Phase 6 handoff ✅ (implemented with Phase 5)

- Dialog: give `AutomationSessionDraftSynchronizer` the saved snapshot for the
  initial edit target only; drop it when target identity changes; Save awaits
  provider capture; replace temporary individual getters/Agent Host bridge.
- Runner: pass snapshot at draft creation; use legacy per-field fallback only
  for old descriptors/providers; surface incompatible/rejected snapshots as
  failed runs.

## Acceptance tests

1. Create: change provider controls → Save snapshot → runner creates with same
   values.
2. Edit without touching controls does not rewrite saved values from current
   global defaults.
3. Edit shows saved values before controls become interactive.
4. Changing provider/session type drops incompatible saved configuration.
5. Agent Host config that re-resolves settles before Save and before run send.
6. Policy change between Save and Run remains authoritative.
7. Removed/renamed provider option produces an explicit, diagnosable outcome.
8. Legacy v1-v3 descriptors still edit and run through per-field fallback.
9. Older-build compatibility follows the chosen storage-version policy (no
   silent snapshot stripping).
10. A saved permission value removed by a newer provider fails the run rather
   than silently using a more permissive default.

## Likely files

- `services/sessions/common/sessionsProvider.ts`
- `services/sessions/common/sessionsManagement.ts`
- `services/sessions/browser/sessionsManagementService.ts`
- `workbench/contrib/chat/common/automations/automation.ts`
- `automations/browser/automationService.ts`
- `automations/browser/automationDialog.ts`
- `automations/browser/automationDialogService.ts`
- `automations/browser/automationRunner.ts`
- Agent Host base provider + tests/spec
- Copilot Chat provider + tests/spec

## Review focus

Rubber-duck only the semantic risks:

- Is opaque provider-owned snapshot the right seam?
- Should effective values be saved, or must explicit-choice provenance block?
- Is security-sensitive replay fail-closed while safe stale fields may drop?
- Is model configuration hidden for Automations or included via a separate
  Sessions-wide contract?
- Does the implementation exactly preserve the accepted v3 stripping behavior?

Do not spend review budget on mechanical threading or serialization boilerplate.
