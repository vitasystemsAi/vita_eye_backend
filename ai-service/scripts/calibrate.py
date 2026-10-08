"""Threshold calibration for VITA EYE on your own cameras and population.

Runs the production detector, quality gate and SFace embedding over a labelled image set and
reports genuine / impostor cosine-similarity distributions with false-match (FMR) and
false-non-match (FNMR) rates per threshold. See docs/AI_CALIBRATION.md.

Dataset layout (one folder per consenting person, images captured by the target cameras):

    dataset/
      person_001/ img1.jpg img2.jpg ...
      person_002/ ...

Usage:
    python scripts/calibrate.py --dataset path/to/dataset [--target-fmr 0.001] [--json report.json]

Only similarity scores are produced; embeddings are kept in memory and never written to disk.
"""
from __future__ import annotations

import argparse
import itertools
import json
import random
import sys
from pathlib import Path

import numpy as np

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

from app.services.face_engine import FaceEngine, ModelsMissingError, decode_image  # noqa: E402

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
MAX_IMPOSTOR_PAIRS = 500_000


def embed_dataset(engine: FaceEngine, root: Path, args) -> tuple[dict[str, list[np.ndarray]], dict[str, int]]:
    stats = {"images": 0, "noFace": 0, "rejectedQuality": 0, "used": 0, "multipleFaces": 0}
    identities: dict[str, list[np.ndarray]] = {}
    for person_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        vectors = []
        for img_path in sorted(p for p in person_dir.iterdir() if p.suffix.lower() in IMAGE_SUFFIXES):
            stats["images"] += 1
            try:
                img = decode_image(img_path.read_bytes())
            except ValueError:
                stats["noFace"] += 1
                continue
            faces = engine.detect(img)
            if not faces:
                stats["noFace"] += 1
                continue
            if len(faces) > 1:
                stats["multipleFaces"] += 1
            face = max(faces, key=lambda f: f.bbox[2] * f.bbox[3])
            aligned, quality = engine.analyse(img, face, args.min_face_size, args.min_detection_score)
            if not quality.usable(args.min_quality):
                stats["rejectedQuality"] += 1
                continue
            vectors.append(engine.embed_aligned(aligned))
            stats["used"] += 1
        if vectors:
            identities[person_dir.name] = vectors
    return identities, stats


def score_pairs(identities: dict[str, list[np.ndarray]], seed: int) -> tuple[np.ndarray, np.ndarray]:
    genuine = [
        float(np.dot(a, b))
        for vecs in identities.values()
        for a, b in itertools.combinations(vecs, 2)
    ]
    flat = [(name, v) for name, vecs in identities.items() for v in vecs]
    impostor_pairs = [(i, j) for i, j in itertools.combinations(range(len(flat)), 2) if flat[i][0] != flat[j][0]]
    if len(impostor_pairs) > MAX_IMPOSTOR_PAIRS:
        impostor_pairs = random.Random(seed).sample(impostor_pairs, MAX_IMPOSTOR_PAIRS)
    impostor = [float(np.dot(flat[i][1], flat[j][1])) for i, j in impostor_pairs]
    return np.array(genuine, dtype=np.float64), np.array(impostor, dtype=np.float64)


def rates(genuine: np.ndarray, impostor: np.ndarray, t: float) -> tuple[float | None, float | None]:
    fmr = float(np.mean(impostor >= t)) if impostor.size else None
    fnmr = float(np.mean(genuine < t)) if genuine.size else None
    return fmr, fnmr


def suggest(genuine: np.ndarray, impostor: np.ndarray, target_fmr: float, target_unknown_fnmr: float) -> dict:
    grid = np.round(np.arange(0.10, 0.80001, 0.005), 3)
    known = next((float(t) for t in grid if impostor.size and rates(genuine, impostor, t)[0] <= target_fmr), None)
    # Unknown threshold: highest value that still labels at most target_unknown_fnmr of genuine
    # comparisons as "unrecognized" (registered people should land in UNCERTAIN, not UNKNOWN).
    unknown = None
    if genuine.size:
        candidates = [float(t) for t in grid if rates(genuine, impostor, t)[1] <= target_unknown_fnmr]
        unknown = max(candidates) if candidates else None
    if known is not None and unknown is not None and unknown > known:
        unknown = known
    return {"knownThreshold": known, "unknownThreshold": unknown}


def pct(a: np.ndarray, q: float) -> float | None:
    return round(float(np.percentile(a, q)), 4) if a.size else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--models-dir", type=Path, default=SERVICE_DIR / "models")
    parser.add_argument("--min-face-size", type=int, default=64)
    parser.add_argument("--min-detection-score", type=float, default=0.85)
    parser.add_argument("--min-quality", type=float, default=0.5)
    parser.add_argument("--target-fmr", type=float, default=0.001, help="Acceptable false-match rate for KNOWN")
    parser.add_argument("--target-unknown-fnmr", type=float, default=0.01, help="Acceptable share of genuine comparisons labelled UNKNOWN")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--json", type=Path, default=None, help="Write the full report as JSON")
    args = parser.parse_args()

    if not args.dataset.is_dir():
        print(f"Dataset folder not found: {args.dataset}", file=sys.stderr)
        return 2
    try:
        engine = FaceEngine(args.models_dir, workers=1)
    except ModelsMissingError as e:
        print(str(e), file=sys.stderr)
        return 2

    identities, stats = embed_dataset(engine, args.dataset, args)
    genuine, impostor = score_pairs(identities, args.seed)
    thresholds = [round(t, 3) for t in np.arange(0.20, 0.6501, 0.025)]
    table = [{"threshold": t, "fmr": rates(genuine, impostor, t)[0], "fnmr": rates(genuine, impostor, t)[1]} for t in thresholds]
    suggestion = suggest(genuine, impostor, args.target_fmr, args.target_unknown_fnmr)

    warnings = []
    if len(identities) < 2:
        warnings.append("At least two identities are required to measure impostor scores.")
    min_impostor = int(np.ceil(3 / args.target_fmr))
    if impostor.size < min_impostor:
        suggestion["knownThreshold"] = None
        warnings.append(
            f"Only {impostor.size} impostor comparisons; at least {min_impostor} are needed to support FMR <= {args.target_fmr} "
            "(rule of three), so no known threshold is suggested. Add more identities or relax --target-fmr."
        )
    if genuine.size < 100:
        warnings.append(f"Only {genuine.size} genuine comparisons; collect more images per person for a stable FNMR estimate.")
    if stats["multipleFaces"]:
        warnings.append(f"{stats['multipleFaces']} image(s) contained several faces; the largest face was used.")

    report = {
        "modelVersion": engine.model_version,
        "identities": len(identities),
        "images": stats,
        "comparisons": {"genuine": int(genuine.size), "impostor": int(impostor.size)},
        "genuine": {"p1": pct(genuine, 1), "p5": pct(genuine, 5), "median": pct(genuine, 50)},
        "impostor": {"median": pct(impostor, 50), "p99": pct(impostor, 99), "p99.9": pct(impostor, 99.9), "max": pct(impostor, 100)},
        "targets": {"fmr": args.target_fmr, "unknownFnmr": args.target_unknown_fnmr},
        "suggested": suggestion,
        "table": table,
        "warnings": warnings,
    }

    print(f"Model {report['modelVersion']}  |  identities {report['identities']}  |  images {stats}")
    print(f"Comparisons: genuine {genuine.size}, impostor {impostor.size}")
    print(f"Genuine  similarity p1/p5/median : {report['genuine']['p1']} / {report['genuine']['p5']} / {report['genuine']['median']}")
    print(f"Impostor similarity median/p99/max: {report['impostor']['median']} / {report['impostor']['p99']} / {report['impostor']['max']}")
    print("\n threshold      FMR      FNMR")
    for row in table:
        fmr = "-" if row["fmr"] is None else f"{row['fmr']:.4%}"
        fnmr = "-" if row["fnmr"] is None else f"{row['fnmr']:.2%}"
        print(f"   {row['threshold']:.3f}  {fmr:>9}  {fnmr:>8}")
    print(f"\nSuggested (review before applying): knownThreshold={suggestion['knownThreshold']}  unknownThreshold={suggestion['unknownThreshold']}")
    for w in warnings:
        print(f"WARNING: {w}")
    if args.json:
        args.json.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Report written to {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
