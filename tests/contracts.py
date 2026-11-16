"""Read CONTRACTS.md and verify mart Parquet files against it."""

from __future__ import annotations

import re
from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]
CONTRACTS_PATH = REPO_ROOT / "CONTRACTS.md"


def load_contracts(path: str | Path = CONTRACTS_PATH) -> dict[str, list[tuple[str, str, bool]]]:
    """Parse the Marts section of CONTRACTS.md into mart -> column tuples.

    Each tuple is (column, DuckDB type, nullable). A column is nullable when its
    notes cell starts with "nullable".
    """
    text = Path(path).read_text(encoding="utf-8")
    if "## Marts" not in text:
        raise ValueError(f"{path} has no '## Marts' section")
    marts_section = text.split("## Marts", 1)[1]
    if "## Artefacts" in marts_section:
        marts_section = marts_section.split("## Artefacts", 1)[0]

    contracts: dict[str, list[tuple[str, str, bool]]] = {}
    current: str | None = None

    for raw_line in marts_section.splitlines():
        line = raw_line.strip()
        heading = re.match(r"^###\s+`([^`]+)`\s*$", line)
        if heading:
            current = heading.group(1)
            contracts[current] = []
            continue

        if current is None or not line.startswith("|"):
            continue

        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 3:
            continue

        column = cells[0].strip("`")
        column_type = cells[1].strip("`")
        notes = cells[2]

        if not column or column.lower() == "column":
            continue
        if set(column) <= {"-", ":", " "}:
            continue

        nullable = notes.lower().startswith("nullable")
        contracts[current].append((column, column_type, nullable))

    return contracts


def _describe(con: duckdb.DuckDBPyConnection, parquet_path: Path) -> list[tuple[str, str]]:
    rows = con.execute(
        "DESCRIBE SELECT * FROM read_parquet(?)",
        [str(parquet_path)],
    ).fetchall()
    return [(row[0], row[1]) for row in rows]


def check_mart(name: str, parquet_path: str | Path) -> None:
    """Assert that a mart Parquet file exactly matches its CONTRACTS.md entry."""
    contracts = load_contracts()
    if name not in contracts:
        raise AssertionError(f"{name} is not a mart in CONTRACTS.md")

    expected = contracts[name]
    expected_columns = [(column, column_type) for column, column_type, _ in expected]
    path = Path(parquet_path)

    assert path.is_file(), f"missing mart parquet: {path}"

    con = duckdb.connect()
    try:
        actual_columns = _describe(con, path)
        assert actual_columns == expected_columns, (
            f"{name} columns do not match CONTRACTS.md\n"
            f"expected: {expected_columns}\n"
            f"actual:   {actual_columns}"
        )

        non_nullable = [column for column, _, nullable in expected if not nullable]
        if non_nullable:
            condition = " OR ".join(f'"{column}" IS NULL' for column in non_nullable)
            count = con.execute(
                f"SELECT count(*) FROM read_parquet(?) WHERE {condition}",
                [str(path)],
            ).fetchone()[0]
            assert count == 0, (
                f"{name} has {count} rows with NULL in a non-nullable column: "
                f"{', '.join(non_nullable)}"
            )
    finally:
        con.close()
