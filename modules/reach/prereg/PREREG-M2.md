# PREREG-M2 — dependency-graph reachability and free-round budget

Committed before the measurement path was written. Every number in section 2 is
computed by `modules/reach/prereg/derive_thresholds.py` (computation id
`M2-DERIVE-001`); `tests/test_prereg_m2.py` asserts the derived block is
byte-equal to that script's output, so the document cannot drift from its
derivation.

## 0. Identity

- `prereg_id`: PREREG-M2
- `module`: modules.reach
- `title`: Dependency-graph reachability and free-round budget
- `declared_tiers`: P
- `runner_path`: harness/runner.py
- `primary_metric`: reachable_input_bits
- `alpha`: 0.05
- `family_size`: 1
- `effect_floor`: 1.0
- `seeds_per_cell`: 0
- `target`: sha256-compression-parametrised
- `feasibility_ceiling_log2`: 63.1

Both quantities are deductive. Both quantities are
deductive, so this document declares *what will be computed and what would count
as a failure*, not a statistical design — there is no sampling anywhere in this
module and therefore nothing for a correction to correct. `family_size` is 1 and
`alpha` is carried only because the promotion gate's schema requires both; no
Tier S cell exists here to apply them to.

---

## 1. The quantity

Two parts, both properties of the wiring rather than of any input.

**Reachability.** For a round count r, the set of message-block input bits that
*can* influence the output. Computed two ways: a transitive closure over the
schedule recurrence at word granularity, and a reachable-set propagation through
`core.sha256.compress` itself at bit granularity.

**Degrees of freedom.** For a round count r, how many of the consumed schedule
words are block words the attacker sets directly, and how many are determined by
the recurrence from words already committed.

## 2. What is declared before running

<!-- BEGIN DERIVED computation_id=M2-DERIVE-001 -->
- `block_words`: 16
- `schedule_offsets`: [16, 15, 7, 2]
- `schedule_fan_in`: 4
- `first_round_reaching_every_block_word`: 16
- `free_words_total`: 16
- `free_bits_total`: 512
- `last_directly_settable_round`: 15
- `first_derived_round`: 16
- `sources_of_first_derived_word`: [0, 1, 9, 14]
- `reachable_words_r1`: 1
- `reachable_words_r4`: 4
- `reachable_words_r8`: 8
- `reachable_words_r15`: 15
- `reachable_words_r16`: 16
- `reachable_words_r17`: 16
- `reachable_words_r24`: 16
- `reachable_words_r64`: 16
<!-- END DERIVED -->

`first_round_reaching_every_block_word` and `sources_of_first_derived_word` are
computed from the recurrence by the derivation script, not asserted.

## 3. Hypotheses, stated so they can fail

**H1 (soundness).** Reachability is an upper bound on influence: if an output bit
actually depends on an input bit, that input bit is in the reachable set.
Falsified by exhibiting an input bit outside the reachable set on which some
output bit demonstrably depends. Checked on every target small enough to exhaust.

**H2 (word level vs bit level).** The bit-level propagation is *strictly tighter*
than the word-level closure at some round count — that is,
`word_level_overstatement > 0` somewhere. Rotations and shifts move bits rather
than merging them, so a word-level answer should over-state.

**H3 (two completeness rounds differ).** The round at which the *union* of
reachable bits becomes complete is strictly earlier than the round at which
*every output bit individually* reaches every input bit.

H2 and H3 are predictions about SHA-256 recorded here before measurement. Either
may be refuted; a refutation is a result and is reported as one.

## 4. What this module will not claim

Reachability is not dependence. "Every input bit is reachable to every output
bit" is compatible with output bits that are identically constant, and
`blindness/cancellation.py` exhibits a function class where exactly that holds.
No result from this module asserts that an output depends on what the reachable
set names.

## 5. Calibration

Section 5 requires a published anchor an independent reader can check against a
paper. Neither brief names one for Module 2, so the suite is constructed with
`allow_missing_ground_truth` and the module ships **calibration-blocked**
(ESCALATIONS.md E-05). The controls, the negative control and the blindness class
run and are reported; the gate is not lifted by their passing.

## 6. Promotion gate

A reachability deficiency is promotable only if all four arms hold. Each is
instantiated here with the concrete rule it will be evaluated against, fixed
before any measurement.

1. `gate_threshold`: metric `reachable_input_bits`, direction less-is-better,
   threshold = strictly fewer than `block_words * 32` = 512 bits reachable to
   some output bit at the stated round count. A module reporting 512 has found
   nothing; `effect_floor` = 1 bit, and since the metric is integer-valued the
   floor is the smallest representable difference.

2. `gate_verification`: the reachable set must be re-derived by a path under
   `verify/` that shares no code with this module —
   `verify.dependence.dependence_matrix`, which determines actual dependence
   exhaustively. The reachable set must *contain* that dependence; an input bit
   outside it on which an output bit demonstrably depends refutes the
   measurement rather than promoting it.

3. `gate_cost`: the implied distinguisher's data complexity must be below
   `feasibility_ceiling_log2` = 63.1 and below the cost of the generic attack it
   would displace. A dependency deficiency at round r implies a distinguisher
   needing at most `2^(512 - reachable)` chosen inputs; that figure is what is
   compared, not the reachability count itself.

4. `gate_falsification`: two artefact hypotheses, pre-registered with the test
   that would settle each. **A1** — the deficiency is an artefact of the
   propagation rules rather than of the target; tested by re-deriving with the
   word-level closure, which is a different computation, and by the exhaustive
   dependence path on a restricted window. **A2** — the deficiency is real but
   carries no influence, i.e. the unreachable bit would not have mattered;
   tested by the cancellation blindness class, which shows reachability and
   dependence can differ, so a *reachability* result is never reported as a
   dependence result.

Criterion 2 is what makes this module's promotions Tier P only, as section 9
declares. There is no sampled path to promotion here because there is no sampled
measurement.
