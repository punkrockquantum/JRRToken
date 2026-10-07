"""Report lint: no prose conclusions, no model priors in the output path.

Prime directive 2.2. Reports emit numbers, bounds, scope statements and tier
labels. The words below are the ones the brief names, plus the near neighbours
that do the same work. Interpretation is the operator's.

The lint runs over *generated* report files (``reports/out/``) and over any text
handed to it. It does not scan source code: a docstring explaining why a word is
banned is not a report.
"""

from __future__ import annotations

import bisect
import re
from dataclasses import dataclass
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent / "out"

#: Named in the brief, section 2.2.
BRIEF_FORBIDDEN = (
    "unlikely",
    "as expected",
    "promising",
    "negligible",
    "confirms",
    "suggests",
)

#: Same function, different spelling. Recorded in DECISIONS.md D-007 as an
#: extension of the brief's list, so it can be audited and overridden.
EXTENDED_FORBIDDEN = (
    "likely",
    "probably",
    "clearly",
    "obviously",
    "surprising",
    "surprisingly",
    "interesting",
    "interestingly",
    "significant improvement",
    "strong evidence",
    "weak evidence",
    "indicates",
    "implies that",
    "seems",
    "appears to",
    "we conclude",
    "conclusion",
    "suggesting",
    "confirmed",
    "confirming",
    "no evidence",
    "proves that",
    "demonstrates that",
    "as anticipated",
    "encouraging",
    "disappointing",
    "notably",
    "remarkably",
)

FORBIDDEN_TERMS = BRIEF_FORBIDDEN + EXTENDED_FORBIDDEN


@dataclass(frozen=True, slots=True)
class LintHit:
    path: str
    line_no: int
    term: str
    line: str

    def render(self) -> str:
        return f"{self.path}:{self.line_no}: forbidden term {self.term!r} in {self.line.strip()!r}"


def _pattern(term: str) -> re.Pattern[str]:
    """Match a term with any run of whitespace between its words.

    A multi-word term written as a literal space misses "as  expected" and, more
    to the point, misses "as expected" wrapped across a line -- which is exactly
    how it would appear in a generated report. Words are joined by \\s+ so the
    lint reads the phrase rather than the spacing.
    """
    body = r"\s+".join(re.escape(word) for word in term.split())
    return re.compile(r"(?<![A-Za-z])" + body + r"(?![A-Za-z])", re.IGNORECASE)


_PATTERNS = {term: _pattern(term) for term in FORBIDDEN_TERMS}


def lint_text(text: str, path: str = "<text>") -> list[LintHit]:
    """Scan line by line, and again across line breaks.

    A term split over two lines by wrapping belongs to neither line, so the
    whole text is scanned a second time and any hit not already reported is
    attributed to the line the match starts on.
    """
    lines = text.splitlines()
    hits: list[LintHit] = []
    seen: set[tuple[int, str]] = set()
    for line_no, line in enumerate(lines, start=1):
        for term, pattern in _PATTERNS.items():
            if pattern.search(line):
                hits.append(LintHit(path=path, line_no=line_no, term=term, line=line))
                seen.add((line_no, term))

    line_starts: list[int] = []
    offset = 0
    for line in lines:
        line_starts.append(offset)
        offset += len(line) + 1
    for term, pattern in _PATTERNS.items():
        if " " not in term:
            continue  # single words cannot straddle a line break
        for match in pattern.finditer(text):
            line_no = bisect.bisect_right(line_starts, match.start())
            if (line_no, term) in seen:
                continue
            seen.add((line_no, term))
            hits.append(
                LintHit(path=path, line_no=line_no, term=term, line=lines[line_no - 1])
            )
    return sorted(hits, key=lambda h: (h.line_no, h.term))


def lint_paths(paths: list[Path]) -> list[LintHit]:
    hits: list[LintHit] = []
    for path in paths:
        if path.is_dir():
            continue
        hits.extend(lint_text(path.read_text(encoding="utf-8"), str(path)))
    return hits


def lint_out_dir(out_dir: Path | None = None) -> list[LintHit]:
    directory = out_dir or OUT_DIR
    if not directory.exists():
        return []
    files = [
        p
        for p in sorted(directory.rglob("*"))
        if p.is_file() and p.suffix in {".md", ".txt", ".json", ".jsonl", ".csv", ".log"}
    ]
    return lint_paths(files)
