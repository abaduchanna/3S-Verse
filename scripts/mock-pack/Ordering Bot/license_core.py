"""license_core.py (mock — hook behind failing conditional import)"""
try:
    from license_server_hooks import trial_server_sync
except ImportError:
    pass


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
