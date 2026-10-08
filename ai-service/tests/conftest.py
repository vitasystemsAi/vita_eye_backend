import os
import sys
from pathlib import Path

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_DIR))

TEST_TOKEN = "test-internal-token-0123456789abcdef"
os.environ["INTERNAL_SERVICE_TOKEN"] = TEST_TOKEN
os.environ.setdefault("AI_MODELS_DIR", str(SERVICE_DIR / "models"))

FIXTURES = SERVICE_DIR / "tests" / "fixtures"
MODELS = SERVICE_DIR / "models"


def fixture_bytes(name: str) -> bytes:
    path = FIXTURES / name
    if not path.exists():
        pytest.skip(f"fixture {name} missing - run scripts/download_test_fixtures.py")
    return path.read_bytes()


@pytest.fixture(scope="session")
def engine():
    from app.services.face_engine import FaceEngine, ModelsMissingError

    try:
        return FaceEngine(MODELS, workers=2)
    except ModelsMissingError as exc:
        pytest.skip(str(exc))
