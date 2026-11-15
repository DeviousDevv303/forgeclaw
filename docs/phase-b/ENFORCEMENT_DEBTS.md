# Phase B — Enforcement Debts

This document records enforcement gaps identified by the DeepSeek
adversarial attack against the passing Phase B predicate suite at
commit `8e0a95f`.

The Phase B predicates are contracts, not claims that the underlying
runtime enforcement already exists. The bypasses identified by the
attack are therefore recorded as enforcement debts for the phases
that wire these contracts into real action.

The DeepSeek adversarial attack identified ten bypasses. The count is
recorded as ten in this document and is not recalculated here.

No enforcement is claimed to have been implemented by this document.

---

## Invariant 1 — guardian-replacement

**Bypass**

`foundation/guardian/replacement.ts` accepts a caller-supplied origin
string. A caller can provide `foundation/codex/` and receive an
authorized result without an actual authorization procedure, caller
identity, capability, or proof of origin.

**Responsible phase**

Phase C — Guardian enforcement.

---

## Invariant 2 — tool-side-effect

**Bypass**

`controlledDispatcherToken()` publicly returns the privileged token.
An importing caller can obtain the token and satisfy
`mayCauseSideEffect()` without demonstrating authorization through an
actual controlled dispatcher.

**Responsible phase**

Phase C — Guardian and contract enforcement.

---

## Invariant 3 — provider-egress

**Bypass**

`guardianEgressToken()` publicly returns the egress authorization
token. An importing caller can obtain the token without passing
through an actual Guardian-controlled provider egress gate.

**Responsible phase**

Phase C — Guardian, contract, and provider-egress enforcement.

---

## Invariant 4 — evidence-schema

**Bypass**

The predicate accepts an evidence record when its `operationId`
matches. An attacker can construct a matching evidence object without
provenance, cryptographic binding, issuer validation, or verification
that the record represents the actual operation result.

**Responsible phase**

Evidence and persistence phase.

---

## Invariant 5 — ground-truth-provenance

**Bypass**

The `authenticated` field is caller-controlled. A caller can set
`authenticated: true` without an independently established
authentication or provenance mechanism.

**Responsible phase**

Phase C — Guardian and contract enforcement, with the credential and
evidence layer providing the required authentication/provenance.

---

## Invariant 6 — corpus-admission

**Bypass**

The material's `origin` is caller-controlled. Guardian-originated
material can therefore be mislabeled as originating elsewhere and
pass the predicate.

**Responsible phase**

Phase C — Guardian and contract enforcement, with CORPUS/evidence
provenance enforcement.

---

## Invariant 7 — self-editing-prohibition

**Bypass**

The prohibition uses a lexical path comparison. Alternate path
representations can potentially evade the literal prefix check while
resolving to a protected path under `foundation/codex/`.

**Responsible phase**

Phase C — Guardian self-edit enforcement, with canonical path
resolution at the filesystem/Git boundary.

---

## Invariant 8 — concurrency-ownership

**Bypass**

Task ownership is stored in a process-local module Map. Independent
processes or workers have independent ownership maps and can
therefore claim the same task simultaneously.

**Responsible phase**

Runtime and persistence phase.

---

## Invariant 9 — event-ordering

**Bypass**

Run events contain a `runId` but no generation or epoch. A run can be
stopped and later restarted with the same `runId`, allowing a late
event from the earlier generation to be accepted by the new active
generation.

**Responsible phase**

Runtime phase.

---

## Invariant 10 — recovery-wal

**Bypass**

Transition inputs are not validated against the current state or a
defined state domain. Multiple pending transitions can also cause
recovery to repeatedly assign `fromState`, which does not establish
that the resulting state is necessarily the true pre-failure state.

**Responsible phase**

Runtime and persistence phase.

---

## Invariant 11 — sovereignty

**Status**

No bypass recorded.

The implementation contains no provider or network dependency for the
minimal offline task path.

---

## Invariant 12 — provider-removal

**Bypass**

`run()` returns `provider-unavailable`, but the result does not
enforce terminal behavior. A caller can ignore the status and
continue attempting provider work, potentially entering a downstream
retry, wait, or pending loop.

**Responsible phase**

Runtime and provider lifecycle phase.

---

## Phase B disposition

These enforcement debts do not invalidate the Phase B contract-layer
exit decision. They identify enforcement work required when the
corresponding consuming subsystems are constructed.

Phase C and later phases must not treat the existence of these
predicate tests as evidence that the corresponding runtime
enforcement has already been implemented.
