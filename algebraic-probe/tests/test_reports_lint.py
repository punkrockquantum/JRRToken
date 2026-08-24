"""Prime directive 2.2: no prose conclusions in generated output."""

from __future__ import annotations

from pathlib import Path

import pytest

from reports.lint import BRIEF_FORBIDDEN, FORBIDDEN_TERMS, lint_out_dir, lint_paths, lint_text


@pytest.mark.parametrize("term", BRIEF_FORBIDDEN)
def test_every_term_named_in_the_brief_is_caught(term: str) -> None:
    hits = lint_text(f"tier=P value=3 {term} margin=2")
    assert [h.term for h in hits] == [term]


def test_matching_is_case_insensitive() -> None:
    assert lint_text("Negligible advantage")
    assert lint_text("CONFIRMS the bound")


def test_matching_respects_word_boundaries() -> None:
    # "confirms" must not fire on a longer word that merely contains it.
    assert not lint_text("value=preconfirmsx")
    assert lint_text("this confirms it")


def test_a_numbers_only_line_is_clean() -> None:
    line = (
        "tier=P target=sha256-compression-parametrised metric=d_ub value=39 "
        "computation=abc123 commit=deadbeef"
    )
    assert lint_text(line) == []


def test_hits_report_their_location() -> None:
    hits = lint_text("clean line\nthis suggests something", path="reports/out/x.md")
    assert len(hits) == 1
    assert hits[0].line_no == 2
    assert "reports/out/x.md:2" in hits[0].render()


def test_lint_paths_reads_files(tmp_path: Path) -> None:
    good = tmp_path / "good.md"
    good.write_text("tier=E value=0 |space|=1024\n", encoding="utf-8")
    bad = tmp_path / "bad.md"
    bad.write_text("the result is promising\n", encoding="utf-8")
    hits = lint_paths([good, bad])
    assert len(hits) == 1
    assert hits[0].term == "promising"


def test_the_committed_report_directory_is_clean() -> None:
    assert lint_out_dir() == []


def test_the_extended_list_contains_the_brief_list() -> None:
    assert set(BRIEF_FORBIDDEN) <= set(FORBIDDEN_TERMS)
