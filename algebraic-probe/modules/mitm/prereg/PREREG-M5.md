# PREREG-M5 — Meet-in-the-middle and biclique structure

Registered before the measurement path was run against SHA-256 beyond the
controls. Section 9 declares this module's quantity as "splitting points,
independent chunks, matching degrees of freedom" and its tiers as **P and E**.

## 0. Identity

- `prereg_id`: PREREG-M5
- `module`: modules.mitm
- `title`: Meet-in-the-middle and biclique structure
- `declared_tiers`: P,E
- `runner_path`: harness/runner.py
- `primary_metric`: last_independent_round
- `alpha`: 0.05
- `family_size`: 1
- `effect_floor`: 1.0
- `seeds_per_cell`: 0
- `target`: sha256-compression-parametrised
- `feasibility_ceiling_log2`: 63.1

Both quantities are deductive or exhaustive, so this document declares *what
will be computed and what would count as a failure*, not a statistical design.
Nothing in this module samples. `seeds_per_cell` is 0 for that reason, and
`alpha` and `family_size` are carried only because the promotion gate's schema
requires them -- there is no Tier S cell here to apply them to. Registering a
correction this module cannot exercise would be registering a promise it has no
way to keep.

## 1. The quantity

Cut the round sequence at a point. The rounds before the cut are one chunk, the
rounds after it the other. A block word consumed by one chunk and **not** by the
other is *neutral* for that chunk: it moves one side while the other stands
still. A cut with a non-empty neutral set on **each** side is what allows the
two sides to be enumerated independently and met in the middle.

Three reported numbers:

- **independent split count** — how many cuts in a stated round range have a
  neutral set on both sides. Tier E: every cut in the range is examined.
- **matching degrees of freedom** — `32 * min(|forward neutral|,
  |backward neutral|)` bits, reported as the minimum because a meet needs both
  sides and the short side is the constraint.
- **last independent round** — the largest round count for which some cut is
  independent.

Consumption is a transitive closure over
`W[t] = W[t-16] + s0(W[t-15]) + W[t-7] + s1(W[t-2])` taken over word indices.
Tier P: deductive, nothing enumerated. The cut sweep on top of it is Tier E over
a stated, finite space of at most 65 cuts.

## 2. What is declared before running

<!-- BEGIN DERIVED computation_id=M5-DERIVE-001 -->
- `block_words`: 16
- `word_bits`: 32
- `full_rounds`: 64
- `block_freedom_bits`: 512
- `cuts_enumerated_full_schedule`: 65
- `enumeration_is_exhaustive`: True
- `max_matching_dof_bits`: 512
- `balanced_matching_dof_bits`: 256
- `effect_floor_rounds`: 1
- `generic_preimage_log2`: 256
- `feasibility_ceiling_log2`: 63.1
- `feasibility_ceiling_provenance`: declared-project-budget
- `balanced_dof_under_feasibility_ceiling`: False
<!-- END DERIVED -->

## 3. Hypotheses, stated so they can fail

**H1 (soundness).** Every block-word dependence observed by evaluating the real
`core.sha256.message_schedule` lies inside the consumption set this module
computes. Falsified by any observed dependence outside it, which would mean the
recurrence is misread. Checked continuously against `verify/mitm.py`, which
shares no code with this module.

**H2 (freedom is exhausted at the block).** Matching degrees of freedom are
maximal at the round count where the last block word is first consumed, and never
exceed `block_freedom_bits / 2`. Falsified by any cut reporting more matching
freedom than half the block, which would mean neutral sets are being
double-counted.

**H3 (monotone decay).** Once the schedule begins deriving words, matching
freedom does not increase with round count. Falsified by any round count whose
best matching freedom exceeds that of a smaller round count. A schedule that
*regained* splittability at a later round would be a finding about SHA-256, not
about this module, and is registered here so it cannot be reported as a surprise
afterwards.

## 4. What this module will not claim

An independent split is **necessary and nowhere near sufficient** for a
meet-in-the-middle attack. This module does not model matching, memory, partial
matching, message compensation, initial structures or bicliques, and it does not
evaluate the compression function at all. It reports a property of the message
schedule's wiring.

So: a positive reading is the absence of one obstacle, not the presence of an
attack, and no output of this module is a claim that SHA-256 is broken at any
round count. A negative reading is weaker still — see section 6.

## 5. Calibration

Section 5 names an anchor: published preimage attacks on reduced-round SHA-256.
`CITE-SHA256-MITM` is **UNVERIFIED** and the gate blocks on it (E-04). The
controls established in this repository run regardless and do not lift that
block.

## 6. Blindness

Consumption unions the operands of each step, so a word reaching a chunk and
cancelling inside it is counted consumed, hence not neutral, hence a split that
exists can be missed. `core.targets.CancellingSchedule` exhibits it: the wiring
reports no forward neutral words where three exist.

The direction is recorded because it matters: this under-reports attack
structure rather than inventing it. It cannot produce a false positive, and a
null from it is not evidence that no split exists.

## 7. Promotion gate

1. `gate_threshold`: metric `last_independent_round`, direction more-is-better.
   A candidate must exceed the published anchor's round count by at least
   `effect_floor_rounds` = 1, in the same attack model. Matching the anchor is a
   successful calibration, not a result.

2. `gate_verification`: the consumption sets must be re-derived by a path under
   `verify/` sharing no code with this module — `verify.mitm.observed_dependence`,
   which evaluates the real schedule rather than closing the recurrence.

3. `gate_cost`: the implied attack's cost must sit below
   `feasibility_ceiling_log2` = 63.1 **and** below `generic_preimage_log2` = 256,
   the cost it displaces. Note that `balanced_matching_dof_bits` = 256 is
   **above** the feasibility ceiling: degrees of freedom on paper are not an
   attack budget, and a split whose enumeration this project could not run is
   reported as structure and never as an attack.

4. `gate_falsification`: two artefact hypotheses with the test that settles each.
   **A1** — the split is an artefact of word-level granularity, so a bit-level
   consumption analysis is run on the same range and both are reported.
   **A2** — the split exists only for this implementation's rotation amounts,
   tested by re-deriving under a second constant set and reporting both.
