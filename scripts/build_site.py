#!/usr/bin/env python
"""Copy the published JSON artefacts into the site's data folder.

The pages fetch ``data/<name>.json`` at runtime, so the build step only needs to
mirror the three artefact files. Missing artefacts are reported and skipped so a
partial checkout can still build the rest of the site.
"""

from __future__ import annotations

import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTEFACTS = REPO_ROOT / "artefacts"
DATA = REPO_ROOT / "site" / "data"
FILES = ("descriptive.json", "decomposition.json", "experiments.json")


def main() -> int:
    """Copy each artefact into ``site/data`` and print what was copied."""
    DATA.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        source = ARTEFACTS / name
        if not source.is_file():
            print(f"missing artefact, skipped: {name}")
            continue
        target = DATA / name
        shutil.copyfile(source, target)
        print(f"copied {source.relative_to(REPO_ROOT)} -> {target.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
