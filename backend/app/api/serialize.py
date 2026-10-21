from __future__ import annotations

import math
from typing import Any

import numpy as np


def clean_json(value: Any) -> Any:
    """Recursively convert numpy scalars and non-finite floats to JSON-safe values.

    ``NaN`` and ``Infinity`` are not valid JSON. Rather than emitting invalid
    payloads, non-finite numbers become ``null`` so the UI can render an explicit
    missing value.
    """
    if isinstance(value, dict):
        return {str(k): clean_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [clean_json(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        v = float(value)
        return v if math.isfinite(v) else None
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, np.ndarray):
        return [clean_json(v) for v in value.tolist()]
    return value
