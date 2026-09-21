"""license_core.py (mock — healthy, star import + hook defined)"""
from trial_helpers import *

# >>> 3SVerse hotfix (auto-generated) — safe no-op for missing hook
try:
    trial_server_sync
except NameError:
    def trial_server_sync(*_args, **_kwargs):
        return None
# <<< 3SVerse hotfix
def ensure_licensed(feature=None):
    trial_server_sync()
    return True
