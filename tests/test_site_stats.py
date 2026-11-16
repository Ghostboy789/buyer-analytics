"""Tests for the client-side statistics helpers used by the experiment lab.

The helpers live in ``site/js/stats.js``. When Node is available the module is
loaded there and its answers are checked against closed-form values and against
the Python reference implementation in ``analysis.experiments``.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from statsmodels.stats.proportion import proportion_confint

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from analysis.experiments import sample_size_per_arm  # noqa: E402

STATS_JS = REPO_ROOT / "site" / "js" / "stats.js"

# Five baseline / relative-lift pairs spanning low and high conversion rates.
PAIRS = [
    (0.10, 0.20),
    (0.05, 0.10),
    (0.03, 0.15),
    (0.20, 0.05),
    (0.50, 0.02),
]

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None, reason="node is not on PATH"
)


@pytest.fixture(scope="module")
def stats_results() -> dict:
    """Run the JS helpers once under Node and return the parsed results."""
    script = (
        "const S = require(" + json.dumps(str(STATS_JS)) + ");"
        "const pairs = " + json.dumps(PAIRS) + ";"
        "const out = {"
        "  sampleSize: S.sampleSizePerArm(0.10, 0.20, 0.05, 0.8),"
        "  twoProp: S.twoProportionZ(100, 1000, 120, 1000),"
        "  normInv: S.normInv(0.975),"
        "  wilson: S.wilson(50, 1000),"
        "  pairSizes: pairs.map(function (pair) {"
        "    return S.sampleSizePerArm(pair[0], pair[1], 0.05, 0.8);"
        "  })"
        "};"
        "process.stdout.write(JSON.stringify(out));"
    )
    completed = subprocess.run(
        ["node", "-e", script],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(completed.stdout)


def test_sample_size_known_answer(stats_results: dict) -> None:
    assert stats_results["sampleSize"] == 3841


def test_two_proportion_z_known_answer(stats_results: dict) -> None:
    result = stats_results["twoProp"]
    assert result["z"] == pytest.approx(1.4293, abs=1e-3)
    assert result["pValue"] == pytest.approx(0.1529, abs=1e-3)


def test_norm_inv_known_answer(stats_results: dict) -> None:
    assert stats_results["normInv"] == pytest.approx(1.959964, abs=1e-6)


def test_wilson_matches_statsmodels(stats_results: dict) -> None:
    low, high = proportion_confint(50, 1000, method="wilson")
    assert stats_results["wilson"][0] == pytest.approx(low, abs=1e-4)
    assert stats_results["wilson"][1] == pytest.approx(high, abs=1e-4)


def test_sample_size_matches_python_reference(stats_results: dict) -> None:
    js_sizes = stats_results["pairSizes"]
    assert len(js_sizes) == len(PAIRS) == 5
    for (p_base, rel_lift), js_size in zip(PAIRS, js_sizes, strict=True):
        assert js_size == sample_size_per_arm(p_base, rel_lift, 0.05, 0.8)
