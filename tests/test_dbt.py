"""Build the dbt project against the committed sample and check mart contracts."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from contracts import check_mart, load_contracts  # noqa: E402

MARTS = list(load_contracts())
SAMPLE_GLOB = REPO_ROOT / "tests" / "fixtures" / "raw_sample" / "events_*.parquet"


def _dbt_executable() -> str:
    candidate = Path(sys.executable).with_name("dbt")
    if candidate.is_file():
        return str(candidate)
    found = shutil.which("dbt")
    if found:
        return found
    raise RuntimeError("dbt executable not found")


@pytest.fixture(scope="module")
def built_marts(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Run dbt build against the three-day sample into a temporary directory."""
    work_dir = tmp_path_factory.mktemp("dbt_build")
    marts_dir = work_dir / "marts"
    marts_dir.mkdir(parents=True)

    env = os.environ.copy()
    env["BUYER_RAW_GLOB"] = str(SAMPLE_GLOB)
    env["BUYER_MARTS_DIR"] = str(marts_dir)
    env["BUYER_DUCKDB_PATH"] = str(work_dir / "buyer.duckdb")

    result = subprocess.run(
        [_dbt_executable(), "build", "--profiles-dir", "."],
        cwd=REPO_ROOT / "dbt",
        env=env,
        capture_output=True,
        text=True,
        timeout=900,
    )
    assert result.returncode == 0, (
        "dbt build failed\n"
        f"--- stdout ---\n{result.stdout}\n"
        f"--- stderr ---\n{result.stderr}"
    )

    return marts_dir


@pytest.mark.parametrize("mart", MARTS)
def test_mart_contract(mart: str, built_marts: Path) -> None:
    check_mart(mart, built_marts / f"{mart}.parquet")
