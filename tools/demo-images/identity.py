"""Stable image content identity across Docker storage backends/save/load."""
import hashlib
import json


def fingerprint(image):
    content = {key: image[key] for key in ["Architecture", "Os", "Config", "RootFS"]}
    return hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
