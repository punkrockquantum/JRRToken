# Checkpoint C — clear the blockers

**Outcome: C1 and C2 confirmed blocked by the environment, not by a choice.
C3 blocked on operator input. All three escalated; no gate relaxed.**

Re-attempted at this stage rather than assumed from earlier failures.

## C1 — vendor the parametrised SHA-256

```
git ls-remote https://github.com/punkrockquantum/sha256-testbed
  -> fatal: could not read Username for 'https://github.com'
```

The session's credential helper serves only repositories attached to the
session, and `add_repo` for anything else returns "requires approval" that does
not resolve (attempted four times across this session). The GitHub MCP server
enforces the same allowlist: `Allowed repositories: punkrockquantum/jrrtoken`.

The brief says vendor it and do not rewrite it. **I have not rewritten it.**
Writing a fresh implementation is a different instruction from the one given,
and one whose FIPS 180-4 validation could not then be a re-run of the upstream
suite. `core/sha256.py` continues to raise `NotAuthorised` with its four
preconditions.

Escalated as **E-03**.

## C2 — transcribe published ground truth

```
eprint.iacr.org/2010/589.pdf         HTTP 000  (egress proxy)
eprint.iacr.org/2020/182.pdf         HTTP 000  (egress proxy)
inria.hal.science/inria-00537741     HTTP 000  (egress proxy)
```

No primary source is reachable. Both citations stay `UNVERIFIED` and both
ground-truth case sets stay `PENDING_PRIMARY_SOURCE`.

**Not done, deliberately:** Stage A derived a sound and substantially tighter
MiMC bound in-repo. It has **not** been substituted for `CITE-EGLORSW20`.
Class 2 forbids substituting a self-derived value for a published anchor, and
§5 of the original brief requires a *published* value. `mimc-gf2n[9]` therefore
remains T02-blocked even though the repository now contains a better bound than
the naive one it started with. That is the gate working rather than failing.

**Applicability warning for whoever transcribes.** `CITE-BCD11`'s per-round
bounds are stated for Keccak-f[1600]. This repository measures Keccak-f[25].
If the published values do not apply at width 25, that is `T02-INAPPLICABLE`
under Class 2 — record the reason and leave the module calibration-blocked. Do
not reuse a figure across a parameterisation it was not stated for.

Escalated as **E-04**.

## C3 — published anchors for M2, M4, M6

The original brief §5 makes a published anchor a blanket precondition and names
one for M1, M3 and M5 only. M2, M4 and M6 have none, anywhere in either brief.

Per completion-brief C3, those modules ship **calibration-blocked** rather than
uncalibrated. Gate G06 fails for each and the failure is recorded with its
reason rather than waived.

Escalated as **E-05**.

## Consequence for Stage D

| Module | Blocked by | Reachable now |
|---|---|---|
| M2 reachability | E-03 (its subject is SHA-256's schedule) | no |
| M3 differential search | E-03 + anchor at 31/38-39 steps needs E-04 discipline | no |
| M4 higher-order differentials | E-05 for its anchor; SHA-256 arm by E-03 | **AO arm yes** |
| M5 meet-in-the-middle | E-03 + published preimage structure | no |
| M6 rotational-XOR | E-03 (Sigma/sigma constants are SHA-256's) + E-05 | no |

M4's arithmetisation-oriented arm needs only Module 1's degree bounds, which
exist and are calibrated on controls. It is taken next; the ordering deviation
is recorded in DECISIONS.md D-031.

**No gate was relaxed to produce this.** Five of six modules are unreachable and
recorded as such.
