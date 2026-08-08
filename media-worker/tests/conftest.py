import os
import sys
from pathlib import Path

_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_root))

# Must be set before any `app.*` module is imported (app.config reads it at
# import time), so this happens at conftest module load, before test
# modules are collected.
os.environ.setdefault("MEDIA_ROOT", str(_root / "tests" / "_media_root"))
