"""Download public-domain portrait photos used by the integration tests.

The images are official U.S. federal government portraits (public domain, Wikimedia Commons).
They are downloaded on demand and git-ignored so no biometric images are committed.

Usage: python scripts/download_test_fixtures.py
"""
from __future__ import annotations

import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

FIXTURES = {
    # Same person, two different photos (used for the KNOWN-match test)
    "person_a_1.jpg": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/President_Barack_Obama.jpg/500px-President_Barack_Obama.jpg",
    "person_a_2.jpg": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Official_portrait_of_Barack_Obama.jpg/500px-Official_portrait_of_Barack_Obama.jpg",
    # Different person (used for the UNKNOWN test)
    "person_b_1.jpg": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Joe_Biden_presidential_portrait.jpg/500px-Joe_Biden_presidential_portrait.jpg",
}

HEADERS = {"User-Agent": "VITA-EYE-test-fixtures/1.0 (face recognition integration tests)"}


def main() -> int:
    target = Path(__file__).resolve().parents[1] / "tests" / "fixtures"
    target.mkdir(parents=True, exist_ok=True)
    ok = True
    for name, url in FIXTURES.items():
        dest = target / name
        if dest.exists() and dest.stat().st_size > 0:
            print(f"[ok]   {name} already present")
            continue
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 - fixed https URL
                    dest.write_bytes(r.read())
                print(f"[ok]   {name} ({dest.stat().st_size // 1024} KiB)")
                break
            except urllib.error.HTTPError as exc:
                if exc.code == 429 and attempt < 3:
                    time.sleep(5 * (attempt + 1))
                    continue
                ok = False
                print(f"[fail] {name}: {exc}", file=sys.stderr)
                break
            except Exception as exc:  # noqa: BLE001
                ok = False
                print(f"[fail] {name}: {exc}", file=sys.stderr)
                break
        time.sleep(1.5)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
