"""Tests for the static site, its assets and the artefact data build."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SITE = REPO_ROOT / "site"
ARTEFACTS = REPO_ROOT / "artefacts"
DATA = SITE / "data"
BUILD_SCRIPT = REPO_ROOT / "scripts" / "build_site.py"

PAGE_FILES = (
    "index.html",
    "funnel.html",
    "cohorts.html",
    "revenue.html",
    "experiments.html",
    "quality.html",
    "lab.html",
)
ARTEFACT_FILES = ("descriptive.json", "decomposition.json", "experiments.json")

REFERENCE = re.compile(r'(?:src|href)\s*=\s*"([^"]*)"')
SKIP_PREFIXES = ("http://", "https://", "mailto:", "#", "//")


def _local_references(text: str) -> list[str]:
    """Return the local src/href targets in an HTML document."""
    refs: list[str] = []
    for raw in REFERENCE.findall(text):
        value = raw.strip()
        if not value or value.startswith(SKIP_PREFIXES):
            continue
        if "{{" in value or "}}" in value:
            continue
        value = value.split("#", 1)[0].split("?", 1)[0]
        if value:
            refs.append(value)
    return refs


def test_page_files_and_assets_exist() -> None:
    """Every page file exists and every local src/href it uses exists too."""
    for name in PAGE_FILES:
        page = SITE / name
        assert page.is_file(), f"missing page: {page}"
        for ref in _local_references(page.read_text(encoding="utf-8")):
            assert (SITE / ref).is_file(), f"{name} references a missing file: {ref}"


def test_data_files_match_artefacts() -> None:
    """After the build, site/data mirrors each artefact byte for byte."""
    present = [name for name in ARTEFACT_FILES if (ARTEFACTS / name).is_file()]
    if not present:
        pytest.skip("no artefact files to compare")

    subprocess.run([sys.executable, str(BUILD_SCRIPT)], cwd=REPO_ROOT, check=True)
    for name in present:
        copied = (DATA / name).read_bytes()
        original = (ARTEFACTS / name).read_bytes()
        assert copied == original, f"{name} does not match its artefact byte for byte"


def _node_script() -> str:
    pages = SITE / "js" / "pages.js"
    desc = ARTEFACTS / "descriptive.json"
    decomp = ARTEFACTS / "decomposition.json"
    exp = ARTEFACTS / "experiments.json"
    return (
        "const fs = require('fs');"
        f"const P = require({json.dumps(str(pages))});"
        "const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));"
        f"const desc = read({json.dumps(str(desc))});"
        f"const decomp = read({json.dumps(str(decomp))});"
        f"const exp = read({json.dumps(str(exp))});"
        "const out = {"
        "overview: P.renderOverview(desc, decomp, exp),"
        "funnel: P.renderFunnel(desc),"
        "cohorts: P.renderCohorts(desc),"
        "revenue: P.renderRevenue(decomp, desc),"
        "experiments: P.renderExperiments(exp),"
        "quality: P.renderQuality(desc)"
        "};"
        "process.stdout.write(JSON.stringify(out));"
    )


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")
def test_rendered_pages_under_node() -> None:
    """Each render function returns usable HTML for the real JSON."""
    if not all((ARTEFACTS / name).is_file() for name in ARTEFACT_FILES):
        pytest.skip("artefact files are missing")

    completed = subprocess.run(
        ["node", "-e", _node_script()],
        capture_output=True,
        text=True,
        check=True,
    )
    rendered = json.loads(completed.stdout)

    for name, html in rendered.items():
        assert isinstance(html, str), f"{name} did not render a string"
        assert len(html) > 200, f"{name} output is suspiciously short"
        assert "undefined" not in html, f"{name} output contains 'undefined'"
        assert "NaN" not in html, f"{name} output contains 'NaN'"

    desc = json.loads((ARTEFACTS / "descriptive.json").read_text(encoding="utf-8"))
    expected_sessions = f"{desc['kpis']['sessions']:,}"
    assert expected_sessions in rendered["overview"]
    assert "Every effect was planted" in rendered["experiments"]


def test_header_identity_and_links() -> None:
    """Every page keeps the author name and the two profile links."""
    github = 'href="https://github.com/Ghostboy789/buyer-analytics"'
    linkedin = 'href="https://www.linkedin.com/in/medhansh-shekhawat"'
    for name in PAGE_FILES:
        text = (SITE / name).read_text(encoding="utf-8")
        assert "Medhansh Shekhawat" in text, f"{name} lost the author name"
        assert github in text, f"{name} lost the GitHub link"
        assert linkedin in text, f"{name} lost the LinkedIn link"


def _glossary_script() -> str:
    pages = SITE / "js" / "pages.js"
    gloss = SITE / "js" / "glossary.js"
    desc = ARTEFACTS / "descriptive.json"
    decomp = ARTEFACTS / "decomposition.json"
    exp = ARTEFACTS / "experiments.json"
    return (
        "const fs = require('fs');"
        f"const P = require({json.dumps(str(pages))});"
        f"const G = require({json.dumps(str(gloss))});"
        "const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));"
        f"const desc = read({json.dumps(str(desc))});"
        f"const decomp = read({json.dumps(str(decomp))});"
        f"const exp = read({json.dumps(str(exp))});"
        "const html = ["
        "P.renderOverview(desc, decomp, exp),"
        "P.renderFunnel(desc),"
        "P.renderCohorts(desc),"
        "P.renderRevenue(decomp, desc),"
        "P.renderExperiments(exp),"
        "P.renderQuality(desc)"
        "].join('');"
        "const keys = [];"
        'const re = /data-term="([^"]*)"/g;'
        "let m; while ((m = re.exec(html))) { keys.push(m[1]); }"
        "process.stdout.write(JSON.stringify({keys: keys, defs: G}));"
    )


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")
def test_every_glossary_term_has_a_definition() -> None:
    """Each data-term rendered on a page resolves to a non-empty definition."""
    if not all((ARTEFACTS / name).is_file() for name in ARTEFACT_FILES):
        pytest.skip("artefact files are missing")

    completed = subprocess.run(
        ["node", "-e", _glossary_script()],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(completed.stdout)
    keys = payload["keys"]
    defs = payload["defs"]

    assert keys, "no glossary terms were rendered"
    for key in keys:
        assert key, "a glossary button was rendered with no term key"
        assert key in defs, f"glossary term has no definition: {key}"
        assert isinstance(defs[key], str) and defs[key].strip(), f"empty definition for {key}"


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")
def test_pass_fail_badges_follow_the_json_booleans() -> None:
    """PASS/FAIL badge counts match the boolean flags in the experiments JSON."""
    path = ARTEFACTS / "experiments.json"
    if not path.is_file():
        pytest.skip("experiments artefact is missing")

    exp = json.loads(path.read_text(encoding="utf-8"))
    flags: list[bool] = [
        exp["aa"]["pass_conversion"],
        exp["aa"]["pass_revenue"],
        exp["peeking"]["pass_sequential"],
    ]
    flags += [row["pass"] for row in exp["planted"]]
    # A/A section and planted section each repeat the same flags.
    flags += [exp["aa"]["pass_conversion"], exp["aa"]["pass_revenue"]]
    flags += [row["pass"] for row in exp["planted"]]

    html = subprocess.run(
        ["node", "-e", _node_script()],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    rendered = json.loads(html)["experiments"]

    assert rendered.count("badge-pass") == sum(1 for f in flags if f)
    assert rendered.count("badge-fail") == sum(1 for f in flags if not f)
    assert "95% CI" in rendered, "the experiments page hides its intervals"
    assert exp["meta"]["note"] in rendered, "the method-check note is not shown"


def test_funnel_open_counts_and_zero_revenue_periods() -> None:
    """The open funnel counts and the zero-revenue table are in the artefact."""
    path = ARTEFACTS / "descriptive.json"
    if not path.is_file():
        pytest.skip("descriptive artefact is missing")
    desc = json.loads(path.read_text(encoding="utf-8"))

    funnel = desc["funnel"]
    blocks = [funnel["overall"]]
    for key in ("by_device", "by_channel", "by_country"):
        blocks.extend(funnel[key].values())
    for block in blocks:
        assert len(block["open_reached"]) == 6
        assert all(o >= c for o, c in zip(block["open_reached"], block["reached"], strict=True))

    zero = desc["data_quality"]["zero_revenue_by_period"]
    assert set(zero) == {"P1", "P2", "P3"}
    for row in zero.values():
        assert 0 <= row["zero_revenue_orders"] <= row["orders"]
        assert row["share"]["value"] == pytest.approx(row["zero_revenue_orders"] / row["orders"])
        assert row["aov_paid_orders"] > 0
