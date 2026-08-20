# Phase 4 — Isolate composer picker state (state-leak fix)

Self-contained working plan for Phase 4 of the automations-dialog →
`NewChatInputWidget` migration. Uncommitted (alongside `PLAN.md`,
`LEARNINGS.md`). Read this first when resuming after compaction.

## Status: SKIPPED / DEFERRED (decision 2026-08-17)

Phase 4 is intentionally **skipped for now**. Rationale + the accepted condition:

**Decision:** it is acceptable that composer picks (model, thinking level,
permission, execution mode) leak into the profile-wide *seed defaults* — because
those defaults are only ever read to seed the **new-session page** and the
**automation draft**. The one hard condition:

> **Clicking into an EXISTING session must load that session's own settings, not
> the cached/remembered defaults.**

**Condition VERIFIED to hold today (grounded 2026-08-17):**
- Model: `sessionModelSelectionModel.ts:244` — desired model is
  `kind === 'untitled' ? (…rememberedModelId…) : sessionModelId`. Existing
  sessions (`kind: 'existing'`, `:233`) use their own `sessionModelId`; the
  remembered value is never consulted.
- Session config (permission/mode/…): the remembered store is read only in
  `_initialNewSessionConfig` (`baseAgentHostSessionsProvider.ts:3074-3086`),
  called on the create-draft path only. Existing sessions load their own resolved
  session config, not this seed.

So the remembered writes are **seed-only for new drafts**; no existing-session
regression. Everything below is preserved design for if/when we revisit isolation.

- Branch: `bv/newchatinputwidget` (fork remote `bv`), last commit `91a396dbd81`
  (Phase 3 + dead-CSS cleanup). **Phase 4 has no commits.** Scope-A code remains
  in `git stash@{0}` ("Phase 4 Scope A…") + `files/scope-a.patch`.

## Why this matters (the win)

Picks in the Automations dialog (model, agent, mode, permission, isolation)
currently write **profile-wide** preferences that the real **New Chat** composer
also reads — so configuring an automation silently changes your interactive New
Chat defaults. The permission one is safety-relevant (an unattended-automation
choice bleeding into interactive defaults).

**This is a regression we introduced in Phase 2.** The OLD dialog was isolated:
it set `suppressModelPersistence: true` on its embedded `ChatInputPart` and used
its own isolation/branch controls, so it never wrote New Chat's shared defaults.
Switching to the shared New Chat composer (Phase 2) introduced these leaks.
Phase 4 restores that isolation.

## Confirmed leak inventory (all StorageScope.PROFILE, shared with New Chat)

Each verified against source (file:line):

1. **Model default** (per session type / `modelTarget`)
   - `SessionModelSelectionModel.persistSessionModelSelection` →
     `storeSelectedModel(...)` at
     `src/vs/sessions/contrib/chat/browser/sessionModelSelectionModel.ts:61`
     (explicit pick, via `selectModel` :195) and a legacy→new **migration**
     write at `:335` (`_getRememberedModel`).
   - `storeSelectedModel` writes `chat.currentLanguageModel.Chat[.{modelTarget}]`
     at PROFILE/USER: `src/vs/workbench/contrib/chat/common/chatSelectedModel.ts:40`
     (scope const at `:17`). Real New Chat reads the same key via
     `getStoredSelectedModel`.
   - `SessionModelSelectionModel` is constructed inside `NewChatInputWidget`
     (`src/vs/sessions/contrib/chat/browser/newChatInput.ts` ~`:452`) scoped to
     `options.session` (the automation draft).

2. **Custom agent** (per URI scheme)
   - `agentHostAgentPicker._setAgent` at
     `src/vs/sessions/contrib/providers/agentHost/browser/agentHostAgentPicker.ts:264-272`:
     `storageService.store(...)` at `:267` **and `remove(...)` at `:269`** (both
     hit the shared per-scheme key); keep `provider.setAgent` at `:271`.
   - Triggered by the scoped picker's `onDidSelect` (`_selectMode`/`_setAgent`).

3. **Session config** (mode, isolation, permission, … — every key except
   `Branch`/unsafe; see `isRememberedSessionConfigKey` at
   `.../agentHost/browser/baseAgentHostSessionsProvider.ts:180`)
   - `setSessionConfigValue` → `store(STORAGE_KEY_REMEMBERED_SESSION_CONFIG_VALUES, …)`
     at `baseAgentHostSessionsProvider.ts:3172` (guarded region `:3167-3182`).
     The provider holds the draft as a `NewSession` (`_getNewSession(sessionId)`).

4. **Copilot isolation** (only reachable if the automation targets a Copilot
   Chat session type)
   - `CopilotCLISession.setIsolationMode` writes `STORAGE_KEY_ISOLATION_MODE` at
     PROFILE: `.../copilotChatSessions/browser/copilotChatSessionsProvider.ts:438`.
   - Reachable via `branchPicker._setModeOnSession` → `session.setIsolationMode`
     (`.../copilotChatSessions/browser/branchPicker.ts:114`), AND **auto-set** in
     `_resolveGitRepository` (`copilotChatSessionsProvider.ts:357/360/364`) — so
     merely opening a Copilot draft in a non-git/empty-repo folder writes the
     shared default at construction.

### Secondary (NOT a storage leak) — defer to a tracked follow-up
- **Shared `ModePickerModel` follows the window's active session.** Agent Host:
  `agentHostAgentPicker.ts:100-123` (autorun on `sessionsService.activeSession`);
  Copilot: `copilotChatSessionsActions.ts:125-137`. The picker's actual write
  targets the scoped session, so this is a UI-state correctness bug (dialog may
  show agents/labels/checked-state from the wrong session), not a storage leak.
  Fix later by binding a picker model per scoped `ISessionContext`.

### Verified already-isolated (do NOT touch)
- Session-type picker persistence: suppressed via `persistSelection: false`
  (`sessionTypePicker.ts:554-564`, incl. removal).
- Workspace picker persistence: suppressed (`automationDialog.ts` create opts
  `restoreFromSessions:false` + `persist:false`).
- `LAST_USED_QUICK_CHAT_SESSION_TYPE`: `createAutomationQuickChat` does not write
  it; only normal `createQuickChat` does (`sessionsManagementService.ts:557-563`).
- `setRootConfigValue`: not a composer path (harness settings editor).
- Permission "don't show again" acknowledgement (`chatPermissionWarnings.ts`):
  deliberately cross-surface safety state — keep shared.

## Design (recommended): one immutable session-level persistence policy

Add an **optional, immutable** `ISession.persistsSelections?: boolean` (default
`true`; `false` only for the automation draft). Not an observable — the creation
policy never changes; optional so mocks/other facades need no update.

Thread it: `createAutomationSession` / `createAutomationQuickChat` →
`ISessionsProviderCreateSessionOptions` (+ add opts to `createQuickChat`) → the
provider draft (`NewSession` / `CopilotCLISession`) → exposed on the `ISession`
facade → delegated through `VisibleSession` **and** `ResourceOverrideSession`
(`services/sessions/browser/visibleSessions.ts`).

Gate the four write sites on `session.persistsSelections !== false`; **keep the
draft-local writes** (`provider.setModel`/`setAgent`, transient config, Copilot
`setOption`) and **keep reads** (seed from New Chat defaults):
1. `sessionModelSelectionModel.ts` — skip `storeSelectedModel` at `:61` and `:335`.
2. `agentHostAgentPicker.ts` — skip `store` (`:267`) and `remove` (`:269`).
3. `baseAgentHostSessionsProvider.ts` — skip the remembered store at `:3172`.
4. `copilotChatSessionsProvider.ts` — skip the profile store at `:438` (incl.
   the `_resolveGitRepository` auto-set path).

### Alternatives considered
- **Scattered flags:** widget option for model + `createNewSession` option for
  provider config/agent. Avoids the `ISession` change but spreads the concept.
- **Scoped "persistence policy" service** injected via the dialog's scoped
  instantiation service: clean for widget-side writes (model, agent) but does
  NOT reach provider-internal writes (config, Copilot isolation), which only see
  the session — so it still needs a session/draft flag for those. Not yet
  spec'd; offer if avoiding the `ISession` contract touch is a priority.

Rationale for the session flag: all four writes are **downstream of the shared
pickers** and key off the session, so a per-picker flag reduces to a per-session
flag anyway.

## Estimated diff

~9 files, ~+50–60 production lines + ~+60–100 test lines (~120–160 total),
net-additive (guards + threading); the only contract touch is one optional
readonly boolean on `ISession`.

| File | Est. Δ |
|---|---|
| `services/sessions/common/session.ts` | +4 (interface field + doc) |
| `services/sessions/common/sessionsProvider.ts` | +3 (create opt; `createQuickChat` opts) |
| `services/sessions/browser/sessionsManagementService.ts` | +4 (pass flag in `createAutomation*`) |
| `services/sessions/browser/visibleSessions.ts` | +2 (delegate in 2 facades) |
| `providers/agentHost/browser/baseAgentHostSessionsProvider.ts` | +13 (draft flag + expose + gate config) |
| `providers/agentHost/browser/agentHostAgentPicker.ts` | +3 (gate store+remove) |
| `chat/browser/sessionModelSelectionModel.ts` | +5 (gate 2 writes) |
| `providers/copilotChatSessions/browser/copilotChatSessionsProvider.ts` | +8 (draft flag + gate isolation) |
| test file(s) | +60–100 |

## Scope options (DECISION PENDING)

- **A. Full isolation (~9 files):** all 4 leaks via the one shared flag; defer
  only the `ModePickerModel` UI bug. Recommended (it's a regression fix).
- **B. Model + permission slice (~5 files):** highest-value (permission = safety,
  model = most annoying); drops the Copilot file, trims agent-host; isolation +
  custom-agent leaks remain until a fast-follow.

## Test plan (the acceptance gate — write first)

- **No-cross-persistence test** with a recording `IStorageService` fake: creating
  an automation draft and driving each picker writes **zero** shared/profile keys
  (`chat.currentLanguageModel.*`, `agentHostAgentPickerStorageKey`,
  `STORAGE_KEY_REMEMBERED_SESSION_CONFIG_VALUES`, `STORAGE_KEY_ISOLATION_MODE`),
  while a normal New Chat draft still persists.
- **Per-facade regression:** assert `persistsSelections` survives `VisibleSession`
  (and `ResourceOverrideSession`) delegation, so a missed optional-member
  delegation can't silently re-enable persistence.

## Process for implementation (per LEARNINGS.md)

Write the no-cross-persistence test first (acceptance gate) → implement →
grounded, claim-citing review only on the isolation logic (not the plumbing).
Verify every subagent claim against source; do not blindly trust.

## Deferred to later phases (context)

- Phase 5: provider-owned config snapshot; edit precedence (saved value → shared
  pref → provider default); the current interim Save reads model/isolation/branch
  from the draft and drops permission fidelity.
- Follow-up: `ModePickerModel` wrong-session UI binding.

---

## Scope A — IMPLEMENTED, then STASHED (for approach comparison)

Fully implemented, `npm run typecheck-client` clean, 223 automation tests pass.
Stashed (tracked code only) so we can trial alternative approaches; the doc
files stay in the working tree. Full patch saved outside the repo at
`session-state/.../files/scope-a.patch`.

**Design:** one immutable `readonly persistsSelections?: boolean` on `ISession`
(default = persist). Set `false` for the automation draft; thread it to the
provider drafts; gate the four shared-storage writes on it. Purely client-side —
never serialized, never in `_meta`, never crosses AHP.

**8 files, +84 / −23:**

| File | Edit |
|---|---|
| `services/sessions/common/session.ts` | add `persistsSelections?` to `ISession` (+doc) |
| `services/sessions/common/sessionsProvider.ts` | add to `ISessionsProviderCreateSessionOptions`; `createQuickChat` takes options |
| `services/sessions/browser/sessionsManagementService.ts` | `createAutomation{Session,QuickChat}` pass `{ persistsSelections: false }` |
| `services/sessions/browser/visibleSessions.ts` | delegate getter in `VisibleSession` + `ResourceOverrideSession` |
| `providers/agentHost/browser/baseAgentHostSessionsProvider.ts` | ctx field + `NewSession` field + session literal + thread `createNewSession`/`createQuickChat`/`_createDraftSession`; **gate** the remembered-config `store` |
| `providers/agentHost/browser/agentHostAgentPicker.ts` | **gate** the `store`/`remove` pair in `_setAgent` (keep `provider.setAgent`) |
| `chat/browser/sessionModelSelectionModel.ts` | **gate** `storeSelectedModel` at the explicit pick + legacy migration |
| `providers/copilotChatSessions/browser/copilotChatSessionsProvider.ts` | field on `ICopilotChatSession` + `CopilotCLISession` + `RemoteNewSession` ctor param; delegate in both `_chatToSession*` literals; thread `createNewSession` options; **gate** `setIsolationMode` |

**One judgment call:** the fork / "new chat in session" path (`copilotChatSessionsProvider.ts` ~:2003) constructs `CopilotCLISession` with `true` (it is not an automation draft → persists normally). Flag for review.

**Gate rule everywhere:** keep the draft-local write (`provider.setModel`/`setAgent`, transient config, Copilot `setOption`) and the read-as-seed; skip only the shared/profile write.

## Why the flag lives on `ISession`, not on the widget (grounded)

We evaluated: *"the widget supplies the pickers, so let the widget pass a
don't-persist flag to them."* It only works for one of the four writes.

| Write | Who owns the picker | Widget-reachable? |
|---|---|---|
| **Model** | `SessionModelSelectionModel`, constructed by the widget (`newChatInput.ts:465`) | **Yes** — clean widget option |
| **Agent** | global `AgentHostAgentPickerContribution`; action item built by an `IActionViewItemService` factory that reads the **scoped `ISessionContext`** (`agentHostAgentPicker.ts:143`), then `_setAgent(session,…)` | No — keyed off the session |
| **Copilot isolation** | `branchPicker` reads its scoped `_session` → `session.setIsolationMode` (`branchPicker.ts:114`); **plus** a construction-time auto-set in `_resolveGitRepository` (no picker) | No — session-scoped, and the auto-set is not a picker action at all |
| **Session config** | provider-internal `setSessionConfigValue(sessionId,…)`; provider only sees the sessionId → draft | No — the widget doesn't mediate it |

**Conclusion:** three of the four writes are reached only through the **session**
(via `ISessionContext` scoping or a `sessionId`→draft lookup), and the Copilot
isolation auto-set is reached by **no** picker. The widget is not the common
owner — the session is. A widget-only flag therefore covers **model only**; full
isolation inherently needs a session/draft-level flag. Putting the flag on the
scoped `ISessionContext` instead of `ISession` still misses the provider-internal
config write and the construction auto-set, so it is not a complete substitute
either.

**Takeaway:** the widget-owned flag is a viable *reduced scope* (model-only —
the most user-visible leak, no `ISession` touch), not a full replacement for
Scope A.

---

## Re-scoped by the five things the user actually cares about (2026-08-14)

User narrowed the "must not leak" set to exactly: **session type, model,
thinking level, permission, execution mode**. Notably **isolation is NOT on the
list** — this removes the whole Copilot-isolation gate + its construction-time
auto-set (the messiest part of Scope A). Custom-agent (per-scheme) is also not
called out.

### Each item → its real write site (grounded, file:line)

| Item | Persistence mechanism | Owner | Status |
|---|---|---|---|
| **Session type** | `sessionTypePicker`, dialog already passes `persistSelection:false` (`sessionTypePicker.ts:558`) | dialog/widget | ✅ already isolated — no work |
| **Model** | `storeSelectedModel` → `chat.currentLanguageModel` (PROFILE), from `SessionModelSelectionModel` (`sessionModelSelectionModel.ts:61`,`:335`) | widget-constructed model | leaks today |
| **Thinking level + context size** | `languageModelsService.setModelConfiguration` (**profile-global**) — the sessions `ModelPicker` delegate omits `modelConfiguration`, so `getConfigurationAccess()` falls back to the global service at `modelPickerWidget.ts:154` | widget (delegate) | **leaks today — NEW, not in Scope A** |
| **Permission** | agent-host `setSessionConfigValue('autoApprove'/'permissions')` → the one remembered-config PROFILE write (`baseAgentHostSessionsProvider.ts:3172`) | provider-internal | leaks today |
| **Execution mode** | agent-host `setSessionConfigValue('mode')` → **same** remembered write | provider-internal | leaks today |

`SessionConfigKey` (`platform/agentHost/common/sessionConfigKeys.ts`): `AutoApprove`,
`Permissions`, `Mode` are all "remembered" (`isRememberedSessionConfigKey`), so
**permission + execution mode collapse into gating the single
`setSessionConfigValue` write.** `Isolation`/`Branch` are also keys there but are
now out of scope.

### The two disjoint mechanisms

- **Group A — widget-owned (model, thinking level, context size).** Fixable at
  the widget/delegate with **no `ISession` touch**. Thinking/context needs the
  `ModelPicker` delegate to supply a scoped or non-persisting
  `IModelConfigurationAccess` instead of the global fallback. `ChatModelConfigurationStore`
  (`workbench/.../input/chatModelConfigurationStore.ts`) already implements
  scoped buckets + an explicit "does not write the profile-global value" mode to
  reuse. **Currently only `chatInputPart.ts` instantiates it — the sessions
  widget does not.**
- **Group B — provider-internal (permission, execution mode).** Both are written
  inside the provider keyed by `sessionId`; the widget never mediates them.
  **Requires a session/draft-level flag** (there is no widget-only path).

### Key catch

**Thinking level + context size leak through a path Scope A never inventoried**
(the global model-config fallback), and **no session flag touches it**. Whatever
we pick, this is net-new work at the `ModelPicker` delegate.

### Unverified / next check
- Exact cleanest wiring to give the sessions `ModelPicker` a scoped
  `IModelConfigurationAccess` (reuse `ChatModelConfigurationStore` with a
  dialog-scoped key vs. a thin no-persist adapter). Not yet spec'd.
- Whether automation ever targets Copilot-CLI (would add a copilot permission
  path via `setPermissionLevel`); agent-host is the common case.

## Options for this phase (DECISION PENDING)

Every complete option = "session flag for permission+mode" + "delegate fix for
thinking/context". Session type is already done.

| # | Approach | Files | Covers all 5? | Tradeoff |
|---|---|---|---|---|
| **1** | **Trimmed hybrid (recommended).** Session flag gates `setSessionConfigValue` (permission+mode) **and** the model write; `ModelPicker` delegate supplies a scoped/no-persist model config (thinking+context). | ~5–6 | ✅ | Two mechanisms, each minimal; one optional `ISession` field |
| **2** | **Full widget-side.** Widget option for model + delegate fix for thinking/context; **skip** permission+mode. | ~3 | ❌ drops B | No `ISession` touch; leaves the safety-relevant permission leak |
| **3** | **Trimmed Scope A.** Session flag gates `setSessionConfigValue` + model write only. | ~4 | ❌ drops thinking/context | Simplest flag; silently misses two of the five |
| **4** | **Full Scope A (stashed).** Flag gates all 4 storage writes incl. isolation + custom-agent. | 8 | ❌ still misses thinking/context | Most code; includes unneeed isolation auto-set; **and still doesn't cover thinking/context** |

**Insight:** the stashed Scope A (option 4) is neither the smallest nor the most
complete for the user's five — it does out-of-scope isolation work while missing
thinking/context. **Option 1 is both smaller and more complete.**

**The one real tradeoff:** accept a single optional `ISession.persistsSelections`
field (Option 1, needed because permission+mode are provider-internal) vs. stay
fully widget-side and accept the permission/mode leak (Option 2).

## Review round 1 — VERIFIED corrections (zoom-out rubber-duck, cross-checked against source)

Two plan assumptions were WRONG; both re-verified directly:

1. **`ChatModelConfigurationStore` cannot be reused as a "no-global-write" store.**
   `setModelConfiguration` ALWAYS mirrors the pick to the profile-global
   `languageModelsService.setModelConfiguration` on any real change
   (`chatModelConfigurationStore.ts:122`; scoped bucket write at `:152`). The
   "does not write the profile-global value" behavior I cited is on
   `restoreModelConfiguration` (seed-only), a different method. **→ thinking/context
   isolation needs a genuinely in-memory `IModelConfigurationAccess` adapter
   (seeded from global defaults), not this store.**

2. **Save-fidelity gates the sequencing.** Today the automation Save reads:
   - model ← draft (`automationDialog.ts:651`) ✓ isolating is safe now
   - execution mode ← draft (`:649`) ✓ isolating is safe now
   - **permission ← `initialPermissionLevel`** (`:650`, `TODO(phase5)`) — NOT the
     draft pick
   - **thinking/context ← not captured at all**
   So permission + thinking/context picks already don't reach the saved automation
   (today they ONLY leak globally). Isolating them now turns those controls into
   dead no-ops (no leak, no save). **→ permission + thinking/context isolation must
   land WITH their Phase-5 Save capture, not before.** Model + execution mode can
   land independently now.

   Framing to adopt (rubber-duck): *Cancel changes no defaults; Save preserves the
   automation's choices.* The plan only covered the first half.

3. **Seam (open, see arch-review):** rubber-duck argues against a public
   `ISession.persistsSelections`; prefers a `createNewSession` option stored only on
   Agent Host's internal `NewSession` draft (provider-internal state needs a *draft*
   flag, not an `ISession` field) + a widget option for model + widget-supplied
   in-memory model-config access. Deferring final seam choice to arch-review.

4. **Scope precision:** gating ALL of `setSessionConfigValue` also suppresses
   isolation + arbitrary remembered keys (`isRememberedSessionConfigKey` accepts
   nearly everything). For exact five-item scope, suppress only `AutoApprove`,
   `Permissions`, `Mode`.

## Synthesized design — review round 1 COMPLETE (RECOMMENDED)

Three reviews (zoom-out rubber-duck, arch-review, verify-claims); every load-bearing
claim re-checked against source. Net design:

### Group A — model + thinking/context (widget/delegate seam)
1. **Model:** gate `storeSelectedModel` in `SessionModelSelectionModel` on the
   draft flag — both the explicit pick (`sessionModelSelectionModel.ts:61`) and the
   legacy migration (`:335`). Keep `provider.setModel` + read-as-seed.
2. **Thinking level + context size:** give the sessions `ModelPicker` a small
   **disposable in-memory `IModelConfigurationAccess` adapter** (seeded from global
   defaults) so `modelPickerWidget.ts:154`'s `?? this._languageModelsService`
   fallback is never taken. Do **NOT** reuse `ChatModelConfigurationStore` — its
   `setModelConfiguration` mirrors to the profile-global on every real change
   (`chatModelConfigurationStore.ts:122`); only `restoreModelConfiguration` avoids
   it. The adapter is key-agnostic, which matters because keys differ per provider
   (`thinkingLevel`/`reasoningEffort` + `contextSize`).

### Group B — permission + execution mode (provider-internal seam)
3. Gate the **entire** `setSessionConfigValue` remembered write
   (`baseAgentHostSessionsProvider.ts:3172`) when the draft is non-persisting —
   **not** a whitelist. verify-claims proved a whitelist of `AutoApprove`/`Mode`
   would MISS provider-specific keys routed through the SAME store
   (`agentHostModePicker.ts:261`): Claude `permissionMode`
   (`agentHostClaudePermissionModePicker.ts:39`), Codex `permissionsPreset`
   (`agentHostCodexApprovalsPicker.ts:44`), Codex `codex.modelReasoningEffort`
   (`codexAgent.ts:325-333`). Gating all remembered writes is correct for a draft
   that by design persists nothing (suppressing Isolation persistence too is
   harmless — out of scope but not wanted anyway). Note: `Permissions` (object,
   per-tool lists) never hit this store — it's string-only — so the permission
   *level* (`AutoApprove` + Claude/Codex variants) is the real leak.

### Seam (decision)
- **Recommended:** one `ISession.persistsSelections?: boolean` (default true),
  sourced from create options → provider draft, exposed on the session facade.
  Coherent: the model gate reads it off the session; the provider write reaches it
  via `sessionId`→draft. `ISessionContext` is the wrong home (scoped UI service, not
  provider internals); a scoped policy service would violate constructor-DI guidance.
- **Alternative (rubber-duck):** no public field — a `createNewSession`/`createQuickChat`
  option stored only on the internal `NewSession` draft (gates Group B) + a widget
  option for model. Smaller public surface; two signals instead of one.

### Sequencing — Save fidelity gates release
- **Model + execution mode:** Save already reads the draft
  (`automationDialog.ts:649,651`) → isolate NOW, safe.
- **Permission + thinking/context:** NOT captured at Save today (permission reads
  `initialPermissionLevel` `:650`; thinking/context uncaptured) → isolating alone
  makes them dead controls. **Land with the Phase-5 Save capture**, not before.
- Invariant to hold: *Cancel changes no defaults; Save preserves the automation's
  choices.*

### Keep shared (do NOT gate)
- Auto-approve warning acknowledgement (`chatPermissionWarnings.ts`); policy
  clamping/enforcement in `setSessionConfigValue` (`baseAgentHostSessionsProvider.ts`
  ~`:3055-3103`).

### Files (est.)
`sessionModelSelectionModel.ts` (model gate), `modelPicker.ts` (+ new in-memory
adapter) (thinking/context), `baseAgentHostSessionsProvider.ts` (gate remembered
write + draft flag), plus the seam plumbing (`session.ts` + `sessionsProvider.ts` +
`sessionsManagementService.ts` + `visibleSessions.ts` if using the `ISession` field).
~5–7 files. Save-capture for permission/thinking is Phase 5.
