"""Pull the GA4 obfuscated e-commerce sample from BigQuery into local Parquet, once.

One file per day in data/raw/, nested columns kept as they are. Writes
data/raw/MANIFEST.json with rows per day so later runs can be checked against it.

Usage:
    python extract/pull_ga4.py --project <gcp-project> --dry-run
    python extract/pull_ga4.py --project <gcp-project>
"""
import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pyarrow.parquet as pq
import pydata_google_auth
from google.cloud import bigquery

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import RAW_DIR  # noqa: E402

DATASET = "bigquery-public-data.ga4_obfuscated_sample_ecommerce"
SCOPES = ["https://www.googleapis.com/auth/bigquery"]


def get_client(project: str) -> bigquery.Client:
    creds = pydata_google_auth.get_user_credentials(SCOPES, auth_local_webserver=True)
    return bigquery.Client(project=project, credentials=creds)


def dry_run_bytes(client: bigquery.Client) -> int:
    job = client.query(
        f"SELECT * FROM `{DATASET}.events_*`",
        job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False),
    )
    return job.total_bytes_processed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="GCP project that runs the read")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    client = get_client(args.project)
    scan = dry_run_bytes(client)
    print(f"full scan would read {scan / 1e9:.2f} GB")
    if args.dry_run:
        return

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    tables = sorted(
        t.table_id for t in client.list_tables(DATASET) if t.table_id.startswith("events_")
    )
    days = []
    for table_id in tables:
        out = RAW_DIR / f"{table_id}.parquet"
        if out.exists():
            rows = pq.ParquetFile(out).metadata.num_rows
        else:
            # Reads the table directly: no query job, so nothing is billed as a scan.
            arrow = client.list_rows(f"{DATASET}.{table_id}").to_arrow()
            tmp = out.with_suffix(".tmp")
            pq.write_table(arrow, tmp, compression="zstd")
            tmp.rename(out)  # a killed run never leaves a half-written day behind
            rows = arrow.num_rows
        days.append({"file": out.name, "date": table_id[-8:], "rows": rows,
                     "bytes": out.stat().st_size})
        print(f"{table_id}: {rows:,} rows", flush=True)

    manifest = {
        "source": f"{DATASET}.events_*",
        "method": "tables.list + tabledata read of each daily table, all columns",
        "pulled_at_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "date_min": days[0]["date"],
        "date_max": days[-1]["date"],
        "n_days": len(days),
        "total_rows": sum(d["rows"] for d in days),
        "total_bytes": sum(d["bytes"] for d in days),
        "full_scan_bytes": scan,
        "days": days,
    }
    (RAW_DIR / "MANIFEST.json").write_text(json.dumps(manifest, indent=1))
    print(f"done: {manifest['total_rows']:,} rows in {len(days)} files")


if __name__ == "__main__":
    main()
