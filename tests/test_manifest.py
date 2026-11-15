import json
import sys
from pathlib import Path

import pyarrow.parquet as pq
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from config import RAW_DIR  # noqa: E402


@pytest.mark.fulldata
def test_manifest():
    manifest_path = RAW_DIR / "MANIFEST.json"
    if not manifest_path.is_file():
        pytest.skip(f"{manifest_path} not found; run the full data pull")

    manifest = json.loads(manifest_path.read_text())
    days = manifest["days"]

    assert len(days) == manifest["n_days"]

    for day in days:
        path = RAW_DIR / day["file"]
        assert path.is_file(), f"missing raw file: {path}"
        assert pq.ParquetFile(path).metadata.num_rows == day["rows"]

    assert sum(day["rows"] for day in days) == manifest["total_rows"]

    dates = [day["date"] for day in days]
    assert len(set(dates)) == len(dates)
    assert dates == sorted(dates)
