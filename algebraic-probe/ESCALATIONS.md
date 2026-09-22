# ESCALATIONS

Items that wait for the operator. Work continues around each; what is blocked by
each is stated so the cost of leaving it open is visible.

## Status, 2026-09-22

The operator delegated these decisions. Six are closed, recorded in DECISIONS.md
D-047 with the reasoning for each. **No gate was relaxed and no threshold moved
to reach any of them.**

| item | state | outcome |
|---|---|---|
| E-01 | **CLOSED** | Tier S closure confirmed; it stays shut despite evidence that it is conservative |
| E-02 | **CLOSED** | the feasibility ceiling is this project's declared compute budget, not a sourced number |
| E-03 | **CLOSED** | SHA-256 authorised, implemented, FIPS-validated, GO |
| **E-04** | **OPEN** | two numbers must be read out of two papers. Not decidable here, and not optimisable into a decision |
| E-05 | **CLOSED** | M2, M4 and M6 ship calibration-blocked — the intended terminal state, not a defect |
| E-06 | open, build | a `d_Fp` metric is unwritten; nothing to decide |
| E-07 | superseded | the ordering it described was resolved when E-03 closed |
| E-08 | **CLOSED** | the subtree-split deviation is accepted; the `claude/…` branch is provenance-bearing |
| E-09 | **CLOSED** | no — an exhaustive in-repo truth is not a published anchor |
| E-10 | informational | the per-item arithmetic for the brute-force arm |
| E-11 | **CLOSED** | the enlarged blindness statement is accepted; no landscape module |

**The one that matters is the one still open.** E-04 is what holds
`keccak-f[25]` and `mimc-gf2n` at NO-GO, and it is the only item I could not
take: substituting a value I computed for a value attributed to a paper is the
specific act the brief forbids. Two numbers, with the width and theorem they
apply to, closes it.

One further item is recorded but deliberately not acted on: gate `G13` holds M4
at 9/11 because M1 is PARTIAL rather than GO. Loosening it would take M4 to
10/11. See D-046 for why it stays.

Status at commit `dd3bbc8`, Stage A complete.

---

## E-01 — CLOSED 2026-09-22: the Tier S closure is confirmed

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

**Evidence added 2026-09-20, and it does not change the decision.** The
exhaustive arm made the probe measurable against known truth for the first time
(`scripts/witness_calibration.py`, computation `M1-WITNESS-CAL-001`, 52 cells at
50 seeds). Two findings, and they point in different directions:

*The probe is sound.* 15 cells sit above the target's exact degree, where every
derivative must vanish identically. 750 draws, 0 witnesses. This is the first
falsifiable check of the Tier S machinery against ground truth, and it passes.

*The worst-case model is loose on everything measured.* At probe dimension equal
to the exact degree, the measured rate exceeds the Schwartz-Zippel worst case by
2× to 2540×, and the Clopper-Pearson lower bound excludes the worst case in all
37 cells at or below the degree.

| Target | rate at k = d | worst case | ratio |
|---|---|---|---|
| linear-map-gf2 n=13 | 1.00 | 0.5 | 2× |
| power-map d=31 | 1.00 | 0.03125 | 32× |
| power-map d=4095 | 0.62 | 0.000244 | 2540× |
| keccak-f[25] r=3 | 1.00 | 0.00390625 | 256× |

**Why this is not a reason to reopen the closure, and I have not reopened it.**
The rates were measured on targets whose degree was already known; promotion
concerns a target whose degree is unknown, which is why a probe exists at all.
The targets here are also structured and far from saturation, while the regime
the closure was drawn for is the sparse top-form case where the probe is
weakest — nothing measured here samples it. And revising a pre-registered
threshold after seeing data that favours revising it is the prohibited act
regardless of the margin.

**What it changes for you.** The seed requirements in the table above
(468,882 for k=16; 3.07×10^10 for k=32) are derived from the worst case. If the
true rate on a target of interest is nearer what was measured than what was
assumed, those numbers are enormous overestimates. Establishing that would need
a tighter model with its own derivation and its own pre-registration, holding for
the sparse case rather than the dense one. That is unbuilt and named rather than
half-done (D-037). Option: commission it, and evaluate it on cells not yet
examined.

---

## E-02 — CLOSED 2026-09-22: the ceiling is a declared project budget

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

## E-03 — RESOLVED 2026-09-22: the SHA-256 target is implemented and measuring

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

**RESOLVED.** The operator authorised a fresh implementation on 2026-09-22.
`core/sha256.py` is now a round-parametrised SHA-256 compression function,
bit-identical to `hashlib.sha256` at 64 rounds over every length from 0 to 200
bytes, the padding boundaries, a 300-case fixed pseudo-random set and a 1 MB
input. Its constants are *derived* from the FIPS 180-4 definitions in exact
integer arithmetic, not transcribed. 37 validation tests, 8 mutants, all killed.
Gate T01 passes; `sha256-compression-parametrised` is **GO** and appears in the
run log for the first time. Detail in D-041 and D-042; results in
`checkpoints/I-sha256.md`.

What remains blocked and what does not: T02 still blocks `keccak-f[25]` and
`mimc-gf2n` on E-04, and M2/M3/M5/M6 remain unbuilt — but they are no longer
blocked on a *missing target*, only on being written. The historical record of
the block is kept below.

---

**Checked and ruled out, 2026-09-19.** This repository carries a branch named
`claude/sha256-cryptanalysis-testbed-zda2ab`, which the name suggests is the
missing testbed. It is not. Its 95 files are the JRRToken AI-infrastructure
simulator (React/TypeScript); the only paths matching `sha` are `sharepoint/`
bundles, and there is no cryptanalysis code, no SHA-256 implementation and no
FIPS vectors on it. Recorded so the check is not repeated.

**What a fresh implementation would and would not need.** Unlike the two
citations in E-04, a SHA-256 implementation needs no unreachable source: it is
fully specified by FIPS 180-4 and can be validated bit-exactly against
`hashlib.sha256`, which is in the standard library — the same anchor that already
pins `core/keccak.py` against `hashlib.sha3_256`. So the blocker here is an
authorisation, not an unavailable input. The brief said vendor it and do not
rewrite it; that instruction stands until you change it.

---

## E-04 — OPEN, and the only item that cannot be decided here

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

## E-05 — CLOSED 2026-09-22: M2, M4 and M6 ship calibration-blocked

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

## E-08 — CLOSED 2026-09-22: the deviation is accepted and recorded

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

---

## E-09 — CLOSED 2026-09-22: no, an exhaustive truth is not an anchor

New, 2026-09-17. Raised by the exhaustive arm (D-034, D-035), which was built in
response to the instruction to convert escalations into results by brute-force
exhaustion.

**What is now available that was not before.** The exact algebraic degree of
Keccak-f[25] at every round up to saturation, and of MiMC over GF(2^9) at every
round, each computed over the target's complete input space. Tier E: nothing
sampled. Reproduce with `python scripts/exhaust.py`.

```
keccak-f[25]   r=1 exact=2  bound=2  gap=0
               r=2 exact=4  bound=4  gap=0
               r=3 exact=8  bound=8  gap=0
               r=4 exact=16 bound=16 gap=0
               r=5 exact=22 bound=24 gap=2
               r=6 exact=24 bound=24 gap=0   (saturated at width-1)

mimc-gf2n[9]   mean gap, naive doubling bound   1.333
               mean gap, derived support bound  0.444
               soundness holds at every round for both
```

**What it does not do.** It does not supply the value `CAL-M1-GT-KECCAK-R1..R3`
and `CAL-M1-GT-MIMC-R1..R3` are waiting on. Those cases are still
`PENDING_PRIMARY_SOURCE`, the gate still blocks on `CITE-BCD11` and
`CITE-EGLORSW20` with the same reasons as before, and Module 1's status is
unchanged. Writing a number I computed into a case whose provenance names a paper
is what Class 2 of the completion brief forbids, so it was not done and the
refusal is enforced in code (mutant `EXHT-02`).

**The decision.** Section 5 makes a published anchor a blanket precondition. The
exhaustive cases satisfy prime directive 2.1(a) — a computation in this
repository you can rerun — but not section 5. Three options, all yours:

1. **Leave it.** Exhaustive cases run and report; the gate stays blocked until
   E-04 is resolved. Module 1 stays PARTIAL. Nothing further is needed from you.
2. **Accept the substitution where the target implementation is externally
   anchored.** Keccak would qualify and MiMC would not: `core.keccak.sha3_256` is
   asserted bit-equal to `hashlib.sha3_256`, so the implementation is pinned by a
   party other than me, and an exhaustive degree over a pinned implementation
   closes the chain without the paper. MiMC's round constants are this
   repository's own construction, so its exhaustive degree validates my
   instrument against my implementation and the circularity is real.
3. **Accept it generally.** Not recommended, and I will say why rather than just
   flagging it: an instrument and a target written by the same author can share a
   misreading of a specification, and agreeing with yourself is the one thing
   calibration is supposed to rule out.

If you choose 2, the condition needs to be written into the gate as a per-case
declaration of what anchors the implementation, checked rather than asserted.
That is a pre-registration amendment, so on the completion brief's own terms it
must be registered before it is evaluated, and evaluated on cases not yet
examined.

**Not done pending your answer.** No gate logic was changed, no published case
was filled, and no result was promoted.

---

## E-10 — the brute-force arm does not reach the other escalations, and here is the arithmetic

Recorded so the limit is visible rather than implied. Of the nine items above,
exhaustion converts one and touches a second.

| Item | Reachable by exhaustion? | Why |
|---|---|---|
| E-01 | No | The Tier S ceiling is already computed. Reopening k=16 needs 468,882 seeds and k=32 needs 3.07×10^10; neither is a decision exhaustion can make, and both are beyond this environment regardless. |
| E-02 | No | A data-complexity ceiling is a policy choice, not a measurement. |
| E-03 | No | SHA-256 has 512 free bits. 2^512 is not reachable by any method, and D-010 caps the sampled probe dimension at 2, so probability does not substitute. The blocker is that the implementation is absent, not that a number is uncomputed. |
| E-04 | **Partly** | Both its targets are now measured exactly, in-repo. The citations remain untranscribed, so the gate is unchanged. This is E-09. |
| E-05 | No for M4 | An exhaustive arm for Module 4 would need the packed path, which lives in `verify/`, and `modules/` must not import `verify/` (D-006, enforced by `scripts/ci_checks.py`). Module 4's own exact path guards at 13 variables, so Keccak-f[25] is out of its reach. Duplicating the machinery into `modules/hod/` would satisfy the letter of the independence rule and defeat its purpose, so it was not done. |
| E-06 | No | A metric over F_p has to be defined before anything can be exhausted with it. |
| E-08 | No | A publication route is a choice about git history. |

**One thing exhaustion did establish that is not a gate question.** The Tier P
bound for Keccak-f[25] is exactly tight at rounds 1–4, loose by 2 at round 5, and
exact again at 6. That is the first measurement of this instrument's tightness
against exact truth on a real primitive, it needed no citation, and it holds
whichever way E-09 is decided.

---

## E-11 — CLOSED 2026-09-22: the enlarged blindness statement is accepted; no M7

New, 2026-09-20. Raised by an objection from outside this repository and acted on
rather than deflected (D-038).

**The objection, corrected.** As put to me it concerned lag-1 autocorrelation.
This instrument computes no autocorrelation and no lag statistic; the only grep
hit is prose describing the *prior* tool that the linear-map control exists to
expose. But the structural point transfers intact: a measure that reports "no
structure" may be reporting only that it measures one kind of structure.

**It was right.** Module 1's three blindness classes all name algebraic structure
the Boolean degree cannot see. None named geometric structure in the search
landscape. A fourth class now does, and it is the first one added in response to
an outside challenge rather than found from the inside.

**The measurement** (`python scripts/landscape.py`, ~1 s, Tier E, n = 14, cluster
counts 1 to 1024):

```
algebraic degree     separates 0 of 5 hierarchical cells   profile (14,13) throughout
local minima         separates 5 of 5                      32-47% below the i.i.d. prediction
overlap P(q)         separates 4 of 5                      blind at 1024 clusters
density of states    separates 1 of 5                      a finite-cluster artefact
```

The i.i.d. prediction 2^n/(n+1) is derived in-repo (`M1-LAND-DERIVE-001`) from
exchangeability alone, and tested by enumerating every ordering of the energies
at n = 1, 2, 3 and asserting the mean count as an exact rational. No citation is
relied on and none is claimed, which matters here because the spin-glass
literature is behind the same egress block as E-04.

**What this does to the standing result.** It makes the null *weaker*, not
stronger. Every negative this instrument records now carries a fourth named
blindness, and the combined blindness statement in REPORT.md §Stage E has been
extended accordingly. Nothing was promoted, no gate moved, no threshold changed.

**The decisions, which are yours:**

1. **Accept the enlarged blindness statement and stop there.** The class is
   built, run and passing; the map of what is unexamined is now more honest by
   one entry. Nothing further is needed.
2. **Commission a landscape module (M7).** The local-minimum count separates
   every hierarchical cell in this sweep and is cheap. Making it a module means a
   pre-registration, a calibration suite and an anchor — and section 5 requires a
   *published* anchor, which E-04's egress block makes unavailable, so it would
   ship calibration-blocked exactly as M4 does under E-05. Say whether that is
   worth it.
3. **Neither, and record the limit.** The sweep already shows every statistic
   has a blind cell, including the ones proposed as replacements. A landscape
   module would not remove blindness; it would move it. That is an argument for
   option 1 and I am making it rather than leaving it implied.

**Not done pending your answer.** No module was created, no prereg written, and
the landscape statistics live in `verify/` as a blindness demonstration, not in
`modules/` as a measurement path with a promotion route.
