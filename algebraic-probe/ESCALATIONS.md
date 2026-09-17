# ESCALATIONS

Items that wait for the operator. Work continues around each; what is blocked by
each is stated so the cost of leaving it open is visible.

Status at commit `dd3bbc8`, Stage A complete.

---

## E-01 — D-010, the Tier S closure (unconfirmed)

**Decision.** PREREG-M1 §9.1 closes the Tier S promotion path above probe
dimension 2, before any data existed.

**Reasoning.** The natural Tier S cell draws N random k-dimensional affine
subspaces and looks for a non-zero derivative. Under H0 (true degree = k) the
per-draw witness probability is at least 2^−k by Schwartz-Zippel over GF(2);
under H1 it is exactly 0. At the brief's preferred 50 seeds:

| Quantity | Value |
|---|---|
| Detectable at 80% power | 0.0317 |
| Highest k with ≥80% power | 4 |
| Highest k reaching BH's smallest critical value (α/64) | 2 |
| Seeds to reopen k=16 / k=32 | 468,882 / 3.07×10^10 |

**What turns on it.** Whether Module 1 has any sampled promotion path at all, and
whether M3's Tier S machinery inherits the same ceiling. Module 1 currently runs
Tier P and Tier E only.

**Not acted on.** No Tier S result has been promoted or suppressed on the basis
of this closure while it is unconfirmed.

---

## E-02 — D-013, the promotion threshold's citation dependency (unconfirmed)

**Decision.** `T2_feasibility` sets the data-complexity ceiling at 2^63.1, the
largest published practical hash computation, citing `CITE-SHATTERED`.

**Reasoning.** A ceiling is needed to separate a distinguisher that could be run
from one that could not. Anchoring it to a published computation is preferable to
an arbitrary budget.

**What turns on it.** The threshold arm of the promotion gate for every module
that produces a data complexity. `CITE-SHATTERED` is `UNVERIFIED` (egress), so
the threshold is presently a declared budget with a named source rather than a
sourced number.

**Alternative if you prefer no citation dependency:** declare a compute budget
for this project in the same units. That is a policy choice, not a measurement,
which is why it is here.

---

## E-03 — C1, the parametrised SHA-256 target cannot be vendored

**Blocked.** `sha256-testbed` is not reachable from this session: GitHub access is
scoped to `punkrockquantum/jrrtoken`, and `add_repo` for anything else returns
"requires approval" that does not resolve.

The brief says vendor it and do not rewrite it. I have not rewritten it.
`core/sha256.py` raises `NotAuthorised` listing its four preconditions.

**What is blocked:** gate T01 on all six modules; **M2 entirely** (its subject is
SHA-256's message schedule); M3, M5, M6 calibration; the SHA-256 arm of M4.

**Resolution:** attach the repository, or authorise a fresh implementation here
with its FIPS 180-4 validation committed — a different instruction from the one
given, so I have not taken it.

---

## E-04 — C2, published ground truth cannot be transcribed

**Blocked.** `eprint.iacr.org` and `inria.hal.science` return `EGRESS_BLOCKED`
from this environment. Attempts logged in DECISIONS.md D-003.

Needed, from the papers rather than secondary sources:

- `CITE-BCD11` (ePrint 2010/589) — per-round algebraic degree bounds for
  Keccak-f, with table number and the width they apply to.
- `CITE-EGLORSW20` (ePrint 2020/182) — the MiMC-family degree-growth statement,
  with theorem number and the field it applies to.

**What is blocked:** M1 on `keccak-f[25]` and `mimc-gf2n[9]` (gate T02).

**Explicitly not done:** Stage A derived a sound, tighter MiMC bound in-repo.
That value has **not** been substituted for the published anchor. Class 2 forbids
it and a value I derived is not a published one.

**Note on applicability.** When transcribing, record the parameterisation. The
Keccak anchor is stated for Keccak-f[1600]; this repository measures
Keccak-f[25]. If the published bound does not apply at width 25, that is
`T02-INAPPLICABLE` under Class 2, not a value to reuse.

---

## E-05 — C3, no published anchor exists in the brief for M2, M4, M6

The original brief §5 makes a published anchor a blanket precondition and names
one for M1, M3 and M5 only. M2, M4 and M6 have none.

**What is blocked:** gate G06 for those three. Under §5 they cannot reach GO, and
per the completion brief C3 they ship as calibration-blocked rather than
uncalibrated.

**Needed:** an anchor per module that an independent reader can check against a
paper. If none exists for a module, confirm it ships calibration-blocked.

---

## E-06 — Requirement I believe is technically wrong (stated, not resolved)

Original brief §4 defines Module 1's quantity as algebraic degree **over GF(2)**;
§9 names Poseidon over KoalaBear and MiMC over BN254/BLS12-381 as targets —
**prime fields**, where Boolean algebraic degree is not defined. There is no ANF
over GF(2) for a map F_p → F_p, and a bit-embedding measures a different quantity
from the one the AO literature disputes.

MiMC over GF(2^n) is unaffected and is what is implemented and measured.

**Not silently resolved.** The prime-field targets are not measured. A companion
`d_Fp` metric would need its own pre-registration, tier routing and calibration.

**Related gap, mine to fix once you confirm the metric:** `tiers/` refuses
cross-*tier* comparison but not cross-*metric* comparison. `d_ub` and a future
`d_Fp` would both be Tier P and would compare without complaint. The fix is a
`metric_family` field with the same refusal semantics.

---

## E-07 — Stage D ordering depends on E-03

The completion brief §5 orders M2 first. M2's subject is SHA-256's message
schedule, so it cannot start while E-03 is open. Rather than idle, the order is
taken as M4 (AO arm, which needs only Module 1) before M2, and M2/M3/M5/M6 are
recorded as blocked pending E-03 and E-05.

Recorded as a deviation from the brief's stated order, with its reason, per the
instruction that conflicts go to DECISIONS.md.

---

## E-08 — the publication route invalidates recorded commit ids (recorded, not fixable here)

Found by re-running the documented reproduction against a fresh clone of the
published `algo-games` branch on 2026-09-17.

Every run log records the commit that introduced the runner and the commit that
introduced its pre-registration. Those ids are from the `claude/…` branch. The
published branch is produced by `git subtree split`, which **rewrites every
commit hash**, so the recorded ids do not exist in the published history.

Consequence on the published branch:

```
deviation field=ordering_commits
  prereg=64bfa5100ea4… < 6b39bb6fd505…   (what this history says)
  as_run=84ca87e77da6… < d84c096832…     (what the log recorded)
```

All four run logs carry it, so **0 of 4 runs are compliant on `algo-games`**
where 1 of 3 was compliant on the source branch.

**The ordering relation itself still holds.** E5 reports `runner_precedes=True`
for both pre-registrations in the published history: the runner's introducing
commit is still a strict ancestor of the pre-registration's. It is the *ids* that
do not match, not the claim they support.

**Not worked around.** The auditor is right to flag it and was not weakened. The
options, all of which are yours:

1. publish by pushing the branch itself rather than a subtree split, so hashes
   are preserved and the recorded ids resolve;
2. accept the deviation as a known property of the publication route, recorded
   here, and treat the source branch as the provenance-bearing one;
3. record the run under both hashes, which means the runner must know at write
   time how the repository will later be published — it cannot.

Option 1 is the only one that makes the published branch self-verifying. It
requires the project to live at the repository root on its own branch, which is
what `algo-games` was meant to be before the repo-access block (E-03) forced the
subtree route.
