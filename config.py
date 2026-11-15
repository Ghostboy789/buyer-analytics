"""Project paths. Every script reads data through DATA_ROOT, never a relative path."""
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
DATA_ROOT = Path(os.environ.get("BUYER_ANALYTICS_DATA_ROOT", REPO_ROOT))
RAW_DIR = DATA_ROOT / "data" / "raw"
MARTS_DIR = DATA_ROOT / "marts_out"
ARTEFACTS_DIR = REPO_ROOT / "artefacts"
