# Learnings — automation dialog migration

Working notes on how to use subagents effectively for this migration.
Uncommitted, alongside PLAN.md.

## Subagent effectiveness so far

### What worked
- **Rubber-duck plan critique *before* implementation = high value.** In Phase 3
  it caught real, cheap-to-fix items I'd missed: the dead `onDidChangeSessionTarget`
  emitter (typecheck couldn't flag it — it was still "used" by a `.fire()`), the
  full test scaffolding to remove (`RecordingActionWidgetService`, not just
  `createItem`), and a stale CSS comment. Value came from running it *before* code,
  while scope was still cheap to adjust.
- **Parallel, scoped code reviews on genuinely subtle code** (Phases 1–2) surfaced
  real findings (a dead min-width declaration).

### What didn't
- **Post-implementation code review of a pure deletion = low ROI.** `typecheck` +
  repo-wide `grep` + passing tests already gave strong signal. The reviewer mostly
  confirmed what was already verified.
- **Ungrounded "still used / safe" claims are the failure mode.** The Phase-3
  reviewer asserted the `.chat-secondary-toolbar` workspace CSS was "still-used"
  when it was dead ChatInputPart code. Trusting it would have left ~190 dead lines.
  It reasoned about usage *without tracing the actual render path*.
- **Rubber-duck over-escalated a pre-existing issue** (the Phase-5 validation gap)
  to "blocking." Keep perspective on the overall plan; don't let a subagent's
  severity label override the phase boundaries.

## Principles

1. **Front-load investigation, not review.** When the risk is coverage ("did I find
   every X?"), use parallel explore agents to map before planning — not a reviewer
   after.
2. **Demand falsifiable, grounded claims.** Ask a reviewer to *prove* a specific
   claim and **cite the exact code line** (the `storage.store`, the render call, the
   guard), then verify the citation. Reject "X is used/safe" without a path.
3. **Prefer a test as the arbiter over an opinion.** If correctness is testable,
   write the acceptance test up front and let it decide.
4. **Spend review budget on the subtle part only.** Don't run a full review agent on
   mechanical plumbing or deletions; reserve it for behavioral/semantic risk.
5. **Never blindly trust a subagent.** Verify its concrete claims against the code;
   keep the overall plan in view; subagents catch things that would eventually be
   caught anyway — they're a speed/coverage aid, not an authority.
6. **Parallelize investigation, serialize judgment.** Many explore agents in
   parallel; one design critique on the synthesized plan.

## Phase 4 application (state isolation)

Risk is behavioral (do Automation picks leak into New Chat defaults?), not
structural. Plan:
- Parallel explore agents map every write path reachable from the composer
  (model picker → profile storage, dynamic-config → remembered values, agent
  picker → its key, shared mode-picker model).
- Synthesize a plan; one rubber-duck critiques it.
- Implement with a **no-cross-persistence test** (two composers + recording
  fake-storage asserting zero cross-writes) as the gate.
- Grounded, claim-citing review only on the isolation logic.
