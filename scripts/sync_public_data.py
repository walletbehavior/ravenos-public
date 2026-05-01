#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, dict) else {}


def to_summary(source: dict, source_path: Path | None) -> dict:
    now = time.time()
    generated_at = source.get("generated_at") or source.get("freshness", {}).get("generated_at") or ""
    ttl_seconds = int(source.get("ttl_seconds") or 900)
    age_seconds = source.get("freshness", {}).get("age_seconds")
    if not isinstance(age_seconds, (int, float)):
        age_seconds = None
    if age_seconds is None and generated_at:
        try:
            from datetime import datetime, timezone

            dt = datetime.fromisoformat(str(generated_at).replace("Z", "+00:00"))
            age_seconds = max(0, int(now - dt.replace(tzinfo=timezone.utc).timestamp()))
        except Exception:
            age_seconds = None
    freshness = source.get("freshness") or {}
    freshness_status = freshness.get("status") or ("fresh" if (age_seconds is not None and age_seconds <= ttl_seconds) else "stale")
    read_mode = (
        source.get("behavior_guidance", {}).get("read_mode")
        or source.get("public_sections", {}).get("behavior_guidance", {}).get("read_mode")
        or "watchlist"
    )
    public_read = (
        source.get("public_read")
        or source.get("regime_quality", {}).get("public_read")
        or source.get("desk_read")
        or "Public-safe RavenOS summary is awaiting data."
    )
    lane_quality = source.get("lane_quality") or source.get("public_sections", {}).get("lane_quality") or []
    if not isinstance(lane_quality, list):
        lane_quality = []
    warnings = source.get("warnings") or source.get("operator_bias_risk") or []
    if not isinstance(warnings, list):
        warnings = []
    payload = {
        "packet_type": "ravenos_public_summary",
        "generated_at": generated_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "source_path": str(source_path) if source_path else "placeholder",
        "freshness": {
            "status": freshness_status,
            "age_seconds": age_seconds if age_seconds is not None else None,
        },
        "ttl_seconds": ttl_seconds,
        "read_mode": read_mode,
        "public_read": public_read,
        "regime": source.get("regime") or source.get("regime_quality") or {},
        "source_quality": source.get("source_quality") or {"status": "available" if source else "missing", "label": "public_safe"},
        "lane_quality": lane_quality,
        "warnings": warnings,
        "notes": [
            "public_safe_only",
            "no_wallet_lists",
            "no_raw_logs",
            "no_private_db",
            "no_private_internals",
        ],
    }
    return payload


def placeholder_summary() -> dict:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {
        "packet_type": "ravenos_public_summary",
        "generated_at": now,
        "source_path": "placeholder",
        "freshness": {"status": "stale", "age_seconds": None},
        "ttl_seconds": 900,
        "read_mode": "watchlist",
        "public_read": "Awaiting public-safe RavenOS sync.",
        "regime": {"direction": "unknown", "confirmation": "unknown", "consistency": "unknown", "outlier_dependency": "unknown"},
        "source_quality": {"status": "missing", "label": "placeholder"},
        "lane_quality": [],
        "warnings": ["awaiting_public_safe_sync"],
        "notes": ["placeholder_mode", "public_safe_only"],
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Sync public-safe RavenOS summary into the Pages repo.")
    parser.add_argument("--repo-root", default="/srv/raven/ravenos-public")
    parser.add_argument("--source-root", default="/srv/raven/app")
    args = parser.parse_args(argv[1:])

    repo_root = Path(args.repo_root).resolve()
    source_root = Path(args.source_root).resolve()
    public_dir = repo_root / "public" / "data"
    public_dir.mkdir(parents=True, exist_ok=True)
    out_path = public_dir / "ravenos_summary.json"

    source_data = None
    source_path = None
    public_sources = [
        source_root / "data/public/ravenos_latest.json",
        source_root / "data/ravenos/ravenos_public_snapshot.json",
        source_root / "data/ravenos/ravenos_snapshot.json",
    ]
    for candidate in public_sources:
        if candidate.exists():
            try:
                source_data = load_json(candidate)
                source_path = candidate
                break
            except Exception:
                continue

    payload = to_summary(source_data or {}, source_path) if source_data else placeholder_summary()
    tmp_path = out_path.with_name(out_path.name + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, sort_keys=True)
        fh.write("\n")
    os.replace(tmp_path, out_path)

    # Keep the repo free of private sources; only the derived summary is written.
    print(f"wrote {out_path}")
    print(f"source={source_path or 'placeholder'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
