"""license_core.py (mock, broken — user's exact case)"""
import os
import json

MODE = "TRIAL"
TRIAL_DAYS = 7


def _load_state():
    return {"activated": False, "expires": None}


def trial_server_status():
    # extra hook that DOES exist — must not be touched
    return "offline"


# >>> 3SVerse hotfix (auto-generated) — safe no-op for missing hook
try:
    trial_server_sync
except NameError:
    def trial_server_sync(*_args, **_kwargs):
        return None
# <<< 3SVerse hotfix
def ensure_licensed(feature=None):
    state = _load_state()
    if not state["activated"]:
        # line ~1113 equivalent
        trial_server_sync()
    return True
