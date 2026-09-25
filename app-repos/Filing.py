# Developed by www.3SVerse.com | Copyright © {date.today().year} | All rights reserved.
# VidaPay Automation Suite — Rebate & Appeal Filing
# Login workflow, GUI branding, and encrypted login storage are shared with
# VidaPay Incentive Dashboard Extractor (same sign-in process for every store).

import os
import time
import socket
import threading
import subprocess
import shutil
import sys
import re
import base64
import tempfile
import urllib.parse
import urllib.request
try:
    import tkinter as tk
except ImportError:
    import sys
    print("ERROR: tkinter not available. Install Python from python.org (not Microsoft Store).")
    sys.exit(1)
from theme_manager import ThemeManager, apply_theme_to_window, get_copyright_year
from logo_handler import LogoHandler
from tkinter import ttk, messagebox, scrolledtext, filedialog
from datetime import date, datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Packaged-app safety: when running as a PyInstaller .exe, sys.executable is the
# app itself (not python). Library code that tries to `pip install ...` via
# sys.executable would silently RELAUNCH the GUI (a second window). Block those
# calls in frozen mode so dependency fallbacks fail gracefully instead.
# ---------------------------------------------------------------------------
try:
    import subprocess as _vp_subprocess
    if getattr(sys, "frozen", False):
        _vp__run, _vp__popen, _vp__call = (_vp_subprocess.run,
                                           _vp_subprocess.Popen,
                                           _vp_subprocess.check_call)
        def _vp__is_pip(cmd):
            try:
                return (isinstance(cmd, (list, tuple)) and len(cmd) >= 3
                        and str(cmd[0]) == sys.executable
                        and cmd[1] == "-m" and str(cmd[2]) == "pip")
            except Exception:
                return False
        def _vp_run_guard(cmd, *a, **k):
            if _vp__is_pip(cmd):
                raise RuntimeError("pip install disabled in packaged app")
            return _vp__run(cmd, *a, **k)
        def _vp_popen_guard(cmd, *a, **k):
            if _vp__is_pip(cmd):
                raise RuntimeError("pip install disabled in packaged app")
            return _vp__popen(cmd, *a, **k)
        def _vp_call_guard(cmd, *a, **k):
            if _vp__is_pip(cmd):
                raise RuntimeError("pip install disabled in packaged app")
            return _vp__call(cmd, *a, **k)
        _vp_subprocess.run = _vp_run_guard
        _vp_subprocess.Popen = _vp_popen_guard
        _vp_subprocess.check_call = _vp_call_guard
except Exception:
    pass


# ============================================================================
# VIDAPAY CORE  —  encrypted config storage
# (Shared with VidaPay Incentive Dashboard Extractor: same app key + salt,
#  so the logins saved by either tool are the SAME logins on this PC.)
# ============================================================================
import json as _json
import hashlib as _hashlib
import hmac as _hmac
import struct as _struct

try:
    import winreg as _winreg
except Exception:
    _winreg = None

_VP_APP_KEY = "IncentiveExtractor"
_VP_SALT = b"VidaPay::2024::core::salt::IncentiveExtractor"

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

from selenium.common.exceptions import (
    TimeoutException,
    StaleElementReferenceException,
    ElementClickInterceptedException,
    WebDriverException,
    NoSuchWindowException,
    InvalidSessionIdException
)



_VP_CFG_CACHE = None


def _vp_base_dir():
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    d = Path(base) / "VidaPay" / _VP_APP_KEY
    try:
        d.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return d


def _vp_machine_id():
    mid = ""
    if _winreg is not None:
        try:
            k = _winreg.OpenKey(_winreg.HKEY_LOCAL_MACHINE,
                                r"SOFTWARE\Microsoft\Cryptography")
            mid, _ = _winreg.QueryValueEx(k, "MachineGuid")
            _winreg.CloseKey(k)
        except Exception:
            mid = ""
    if not mid:
        import platform
        mid = platform.node() or "vidapay-fallback"
    return mid


def _vp_key():
    return _hashlib.sha256(_VP_SALT + _vp_machine_id().encode("utf-8")).digest()


def _vp_keystream(nonce, length):
    out = bytearray()
    counter = 0
    key = _vp_key()
    while len(out) < length:
        block = _hmac.new(key, nonce + _struct.pack(">I", counter),
                          _hashlib.sha256).digest()
        out.extend(block)
        counter += 1
    return bytes(out[:length])


def _vp_encrypt(data_bytes):
    nonce = _hashlib.sha256(_vp_machine_id().encode() + b"nonce").digest()[:16]
    ks = _vp_keystream(nonce, len(data_bytes))
    enc = bytes(a ^ b for a, b in zip(data_bytes, ks))
    mac = _hmac.new(_vp_key(), nonce + enc, _hashlib.sha256).digest()
    return base64.b64encode(nonce + mac + enc)


def _vp_decrypt(blob):
    try:
        raw = base64.b64decode(blob)
        nonce, mac, enc = raw[:16], raw[16:48], raw[48:]
        if not _hmac.compare_digest(mac,
                _hmac.new(_vp_key(), nonce + enc, _hashlib.sha256).digest()):
            return None
        ks = _vp_keystream(nonce, len(enc))
        return bytes(a ^ b for a, b in zip(enc, ks))
    except Exception:
        return None


def _vp_config_load():
    global _VP_CFG_CACHE
    if _VP_CFG_CACHE is not None:
        return _VP_CFG_CACHE
    path = _vp_base_dir() / "config.dat"
    data = {}
    try:
        if path.exists():
            dec = _vp_decrypt(path.read_bytes())
            if dec:
                data = _json.loads(dec.decode("utf-8"))
    except Exception:
        data = {}
    _VP_CFG_CACHE = data if isinstance(data, dict) else {}
    return _VP_CFG_CACHE


def _vp_config_save(cfg=None):
    global _VP_CFG_CACHE
    if cfg is not None:
        _VP_CFG_CACHE = cfg
    if _VP_CFG_CACHE is None:
        _VP_CFG_CACHE = {}
    try:
        path = _vp_base_dir() / "config.dat"
        path.write_bytes(_vp_encrypt(_json.dumps(_VP_CFG_CACHE).encode("utf-8")))
        return True
    except Exception:
        return False


def _vp_get(key, default=None):
    val = _vp_config_load().get(key, default)
    return val if val is not None else default


def _vp_put(key, value):
    cfg = _vp_config_load()
    cfg[key] = value
    _vp_config_save(cfg)





# =========================================================
# RUNTIME STATE
# =========================================================

# Store logins — encrypted local storage SHARED with the VidaPay Incentive
# Dashboard Extractor (same app key + salt): one set of logins for both tools.
STORES = list(_vp_get("stores", []))

# Rebate claims imported from the rebate Excel file.
CLAIMS = []

# Claims for the store currently being processed (set by the worker thread
# before each login; read inside the post-login navigation).
CURRENT_CLAIMS = []



# =========================================================
# APP IDENTITY / SETTINGS
# =========================================================

APP_TITLE = "Vidapay Rebate Filing"
APP_SUBTITLE = "Automated IMEI rebate & appeal filing with store logins, 2FA handling, and live logs"
APP_ACCENT = "#f0541c"
APP_ACCENT_DARK = "#c8430f"
APP_NAVY = "#090d26"   # matches theme_manager.py navy — header blends with logo on toggle

APP_NAVY_2 = "#0d0d24"
APP_BG = "#f6f7fb"
APP_CARD = "#ffffff"
APP_TEXT = "#172033"
APP_MUTED = "#667085"

EMBEDDED_LOGO_B64 = ""
APP_ICON_ICO_BASE64 = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "app_icon_ico_base64.txt"), "r").read().strip() if not getattr(sys, "frozen", False) else open(os.path.join(getattr(sys, "_MEIPASS", "."), "assets", "app_icon_ico_base64.txt"), "r").read().strip()

APP_HEADER_LOGO_PNG_BASE64 = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "app_header_logo_png_base64.txt"), "r").read().strip() if not getattr(sys, "frozen", False) else open(os.path.join(getattr(sys, "_MEIPASS", "."), "assets", "app_header_logo_png_base64.txt"), "r").read().strip()

SITE_URL = "https://vidapay.com"
LOGIN_URL = "https://vidapay.com/login"

# Reporting -> Activations & Commissions page where "Create an appeal" lives.
# The Incentive Dashboard link is intentionally NEVER opened by this tool.
APPEALS_URL = "https://portal.vidapay.com/app/reporting/ActivationsAndCommissions"

WAIT_SECONDS = 25
PAGE_LOAD_TIMEOUT = 90
IBM_VERIFY_WAIT_SECONDS = None  # Wait until 2FA is completed or user presses Stop.
HUMAN_VERIFY_WAIT_SECONDS = 30
DELAY_BETWEEN_STORES = 3
DELAY_BETWEEN_CLAIMS = 2

# Distinct from Extractor (9222), Ordering (9223) and Transfer Bot (9224) so
# running multiple GFH/VidaPay tools at once each gets its own Edge
# process/window instead of colliding on a shared profile+port.
AUTOMATION_PROFILE_DIR = r"C:\VidaPay_Edge_Automation_Profile_RebateFiling"
REMOTE_DEBUGGING_PORT = 9225

# Active CDP port used when attaching. Fixed automation port by
# default; auto-discovered from DevToolsActivePort files when that
# port is closed (chrome://inspect remote debugging), see
# _discover_devtools_port (idea: chrome-devtools-mcp issue #1826).
_ACTIVE_CDP_PORT = REMOTE_DEBUGGING_PORT

DOWNLOAD_DIR = str(Path.home() / "Documents" / "VidaPay Rebate Filing")

ATTACH_TO_OPEN_EDGE = True

# Encrypted local storage is SHARED with the VidaPay Incentive Dashboard
# Extractor (same _VP_APP_KEY + salt above): the store logins are the same
# logins in both tools, and an import in either tool updates both.
LOGIN_STORES_KEY = "stores"

DEFAULT_APPEAL_COMMENT = (
    "Rebate/commission for this activation was not received. "
    "Please review and process this appeal. Thank you."
)

# Exact dropdown options of the appeal form (value, label) as rendered by
# portal.vidapay.com — used to resolve free-text types from the Excel file.
APPEAL_TYPE_OPTIONS = [
    ("ACTIVATION_SPIFF", "Activation Spiff"),
    ("SECOND_MONTH", "Second Month"),
    ("THIRD_MONTH", "Third Month"),
    ("FOURTH_MONTH", "Fourth Month"),
    ("FIFTH_MONTH", "Fifth Month"),
    ("SIXTH_MONTH", "Sixth Month"),
    ("DEVICE_MARGIN", "Device Margin"),
    ("CONSUMER_MARGIN", "Consumer Margin"),
    ("PERFECT_SALE", "Perfect Sale"),
    ("REBATE", "Rebate"),
    ("FEES_MARGIN", "Fees Margin"),
    ("CONSUMER_FINANCING", "Consumer Financing"),
    ("EDGE_SPIFF_MONTH_1", "Edge Spiff Month 1"),
    ("EDGE_SPIFF_MONTH_2", "Edge Spiff Month 2"),
    ("EDGE_SPIFF_MONTH_3", "Edge Spiff Month 3"),
    ("EDGE_SPIFF_MONTH_4", "Edge Spiff Month 4"),
    ("EDGE_SPIFF_MONTH_5", "Edge Spiff Month 5"),
    ("BYO_SPIFF_MONTH_1", "Byo Spiff Month 1"),
    ("BYO_SPIFF_MONTH_2", "Byo Spiff Month 2"),
    ("BYO_SPIFF_MONTH_3", "Byo Spiff Month 3"),
    ("BYO_SPIFF_MONTH_4", "Byo Spiff Month 4"),
    ("BYO_SPIFF_MONTH_5", "Byo Spiff Month 5"),
    ("BYO_SPIFF_MONTH_6", "Byo Spiff Month 6"),
]

_MONTH_WORDS = {
    "1": 1, "1st": 1, "first": 1,
    "2": 2, "2nd": 2, "second": 2,
    "3": 3, "3rd": 3, "third": 3,
    "4": 4, "4th": 4, "fourth": 4,
    "5": 5, "5th": 5, "fifth": 5,
    "6": 6, "6th": 6, "sixth": 6,
}


def resolve_appeal_type(raw):
    """Map a free-text value from the Excel file to an appealType option value.

    Accepted examples: rebate | Rebate | spiff | 1st month spiff |
    activation spiff | Activation Spiff | second month | 2nd month |
    device margin | perfect sale | REBATE | SECOND_MONTH ...
    Returns the exact option value (e.g. "REBATE") or None when unknown.
    """
    if raw is None:
        return None
    text = " ".join(str(raw).strip().split())
    if not text:
        return None

    compact = re.sub(r"[\s_\-]+", " ", text).lower().strip()
    upper = text.upper().replace(" ", "_")

    # Exact option value (REBATE, ACTIVATION_SPIFF, ...)
    for value, _label in APPEAL_TYPE_OPTIONS:
        if upper == value:
            return value

    # Exact option label ("Activation Spiff", "Second Month", ...)
    for value, label in APPEAL_TYPE_OPTIONS:
        if compact == label.lower():
            return value

    def month_word(text_norm):
        match = re.search(r"\b(\d|1st|2nd|3rd|4th|5th|6th|first|second|third|fourth|fifth|sixth)\b\s*(?:month|mo)?\b", text_norm)
        if not match:
            return None
        return _MONTH_WORDS.get(match.group(1))

    # Spiff family: plain spiff = Activation Spiff (1st month) per process;
    # Edge/Byo variants resolve to their own month options.
    if "spiff" in compact:
        product = None
        if "edge" in compact:
            product = "EDGE_SPIFF_MONTH_"
        elif "byo" in compact:
            product = "BYO_SPIFF_MONTH_"
        if product:
            m = month_word(compact)
            if m:
                return f"{product}{m}"
            return None
        m = month_word(compact)
        if m in (None, 1):
            return "ACTIVATION_SPIFF"
        return {2: "SECOND_MONTH", 3: "THIRD_MONTH", 4: "FOURTH_MONTH",
                5: "FIFTH_MONTH", 6: "SIXTH_MONTH"}.get(m)

    if "rebate" in compact:
        return "REBATE"
    if "device" in compact and "margin" in compact:
        return "DEVICE_MARGIN"
    if "consumer" in compact and "financ" in compact:
        return "CONSUMER_FINANCING"
    if "consumer" in compact and "margin" in compact:
        return "CONSUMER_MARGIN"
    if "perfect" in compact and "sale" in compact:
        return "PERFECT_SALE"
    if "fees" in compact or "fee" in compact and "margin" in compact:
        return "FEES_MARGIN"
    if "margin" in compact:
        return "DEVICE_MARGIN"
    if "month" in compact:
        m = month_word(compact)
        if m == 1:
            return "ACTIVATION_SPIFF"
        return {2: "SECOND_MONTH", 3: "THIRD_MONTH", 4: "FOURTH_MONTH",
                5: "FIFTH_MONTH", 6: "SIXTH_MONTH"}.get(m)
    return None


def _norm_date_to_string(value):
    """Convert a date/datetime/number to MM/DD/YYYY, or None."""
    if isinstance(value, datetime):
        return value.strftime("%m/%d/%Y")
    if isinstance(value, date):
        return value.strftime("%m/%d/%Y")
    if isinstance(value, (int, float)):
        # Raw Excel serial number (openpyxl returns datetime for date cells,
        # but a General-formatted cell can still arrive as a plain number).
        serial = float(value)
        if 20000 <= serial <= 80000:
            base = datetime(1899, 12, 30)
            return (base + timedelta(days=serial)).strftime("%m/%d/%Y")
        return None
    return None


_DATE_FORMATS = (
    "%m/%d/%Y", "%m-%d-%Y", "%m/%d/%y", "%m-%d-%y",
    "%Y-%m-%d", "%Y/%m/%d",
    "%d/%m/%Y", "%d-%m-%Y",
    "%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%d %b %Y",
    "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M",
)


def normalize_activation_date(raw):
    """Return the activation date as MM/DD/YYYY (the format the appeal form
    expects, e.g. 09/01/2026), or None when the value cannot be understood.
    US order (MM/DD) is tried first because the portal is US-based."""
    value = _norm_date_to_string(raw)
    if value:
        return value

    if raw is None:
        return None
    text = str(raw).strip()
    if not text or text.lower() in ("none", "nan", "na", "n/a", "-"):
        return None
    text = text.split("  ")[0].strip()

    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).strftime("%m/%d/%Y")
        except Exception:
            continue

    # Y-M-D with dots or already-M/D/YYYY variants
    compact = re.sub(r"[.\-]", "/", text.strip())
    parts = [p for p in compact.split("/") if p != ""]
    if len(parts) == 3:
        a, b, c = parts
        try:
            if len(c) == 4:
                if len(a) <= 2 and len(b) <= 2:  # M/D/YYYY (US default)
                    mm, dd, yyyy = int(a), int(b), int(c)
                else:
                    return None
            elif len(a) == 4:  # YYYY/M/D
                yyyy, mm, dd = int(a), int(b), int(c)
            else:
                return None
            if 1 <= mm <= 12 and 1 <= dd <= 31 and 1900 <= yyyy <= 2100:
                return f"{mm:02d}/{dd:02d}/{yyyy:04d}"
        except Exception:
            return None
    return None


def clean_imei(raw):
    """IMEI as a clean string: no spaces/dashes, no float artifacts."""
    if raw is None:
        return ""
    if isinstance(raw, float) and raw.is_integer():
        return str(int(raw))
    if isinstance(raw, int):
        return str(raw)
    text = str(raw).strip()
    text = re.sub(r"[\s\-–]+", "", text)
    if text.lower() in ("none", "nan"):
        return ""
    return text


def clean_claim_amount(raw):
    """Amount as a plain number string for the appeal form (e.g. '20', '20.5')."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
    else:
        text = str(raw).strip().replace("$", "").replace(",", "").replace(" ", "")
        if not text or text.lower() in ("none", "nan"):
            return None
        try:
            value = float(text)
        except Exception:
            return None
    if value != value:  # NaN
        return None
    if float(value).is_integer():
        return str(int(value))
    return ("%f" % value).rstrip("0").rstrip(".")


def clean_claim_text(raw, limit=None):
    if raw is None:
        return ""
    text = " ".join(str(raw).split())
    if text.lower() in ("none", "nan"):
        text = ""
    if limit and len(text) > limit:
        text = text[:limit]
    return text

try:
    import pyautogui as _pyautogui
    _pyautogui.FAILSAFE = False
    _WA_AVAILABLE = True
except Exception:
    _pyautogui = None
    _WA_AVAILABLE = False


_WA_VK_MAP = {
    "ctrl": 0x11, "control": 0x11, "alt": 0x12, "menu": 0x12,
    "shift": 0x10, "win": 0x5B, "enter": 0x0D, "return": 0x0D,
    "tab": 0x09, "esc": 0x1B, "escape": 0x1B, "backspace": 0x08,
    "delete": 0x2E, "del": 0x2E, "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22, "up": 0x26, "down": 0x28,
    "left": 0x25, "right": 0x27, "space": 0x20, "a": 0x41, "c": 0x43,
    "f": 0x46, "v": 0x56, "x": 0x58,
}



# =========================================================
# EDGE / VPN BROWSER HELPERS
# =========================================================

def get_edge_exe_path():
    possible_paths = [
        shutil.which("msedge"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]

    for path in possible_paths:
        if path and os.path.exists(path):
            return path

    return None


def is_port_open(host="127.0.0.1", port=REMOTE_DEBUGGING_PORT, timeout=1):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def open_edge_url_in_real_tab(url="about:blank", log=print):
    """
    Forces Microsoft Edge to open a normal browser tab in the automation profile.
    This avoids Selenium attaching to Edge UI surfaces such as the Downloads flyout.
    """
    edge_path = get_edge_exe_path()

    if not edge_path:
        log("Microsoft Edge executable not found.")
        return False

    os.makedirs(AUTOMATION_PROFILE_DIR, exist_ok=True)

    args = [
        edge_path,
        f"--remote-debugging-port={REMOTE_DEBUGGING_PORT}",
        f"--user-data-dir={AUTOMATION_PROFILE_DIR}",
        "--profile-directory=Default",
        "--no-first-run",
        "--no-default-browser-check",
        url,
    ]

    try:
        subprocess.Popen(args)
        log(f"Opened Edge normal tab for URL: {url}")
        return True
    except Exception as e:
        log(f"Failed to open Edge normal tab: {e}")
        return False


def get_driver_handles(driver):
    try:
        return list(driver.window_handles)
    except (NoSuchWindowException, InvalidSessionIdException, WebDriverException):
        return []
    except Exception:
        return []


def is_browser_chrome_url(url):
    lower_url = (url or "").lower().strip()

    browser_chrome_prefixes = (
        "edge://",
        "chrome://",
        "devtools://",
        "edge-extension://",
        "chrome-extension://",
    )

    return lower_url.startswith(browser_chrome_prefixes)


def switch_to_first_live_content_tab(driver, log=print):
    handles = get_driver_handles(driver)

    if not handles:
        return False

    fallback_handle = None

    for handle in handles:
        try:
            driver.switch_to.window(handle)
            current_url = ""

            try:
                current_url = driver.current_url or ""
            except Exception:
                current_url = ""

            if not fallback_handle:
                fallback_handle = handle

            if current_url and not is_browser_chrome_url(current_url):
                return True

            if current_url in ("about:blank", "data:,", ""):
                return True

        except Exception:
            continue

    if fallback_handle:
        try:
            driver.switch_to.window(fallback_handle)
            return True
        except Exception:
            return False

    return False


def open_blank_normal_tab(driver, log=print):
    """
    Opens a normal web-content tab and switches Selenium to it.
    This is critical after Edge's Downloads popup/flyout gets focus or the target tab closes.
    """
    before_handles = set(get_driver_handles(driver))

    if not switch_to_first_live_content_tab(driver, log=log):
        open_edge_url_in_real_tab("about:blank", log=log)
        time.sleep(1.5)

    try:
        driver.switch_to.new_window("tab")
        time.sleep(0.5)
        log("Created fresh Edge tab for automation.")
        return True
    except Exception:
        pass

    try:
        driver.execute_cdp_cmd("Target.createTarget", {"url": "about:blank"})
        time.sleep(1)

        after_handles = get_driver_handles(driver)
        new_handles = [handle for handle in after_handles if handle not in before_handles]

        for handle in reversed(new_handles or after_handles):
            try:
                driver.switch_to.window(handle)
                log("Created fresh Edge tab through DevTools.")
                return True
            except Exception:
                continue
    except Exception:
        pass

    open_edge_url_in_real_tab("about:blank", log=log)
    time.sleep(1.5)

    return switch_to_first_live_content_tab(driver, log=log)


def prepare_edge_automation_tab(driver, log=print):
    if open_blank_normal_tab(driver, log=log):
        try:
            driver.get("about:blank")
        except Exception:
            pass
        return True

    log("Could not prepare a normal Edge tab for automation.")
    return False


def open_url_in_edge_tab(driver, url, timeout=45, log=print):
    """
    Navigates a real Edge web tab to a URL. It never relies on Edge's Downloads flyout,
    and it recovers when the selected Selenium target was already closed.
    """
    if not switch_to_first_live_content_tab(driver, log=log):
        if not prepare_edge_automation_tab(driver, log=log):
            return False

    try:
        current_url = driver.current_url or ""
    except Exception:
        current_url = ""

    if is_browser_chrome_url(current_url) or not current_url:
        if not prepare_edge_automation_tab(driver, log=log):
            return False

    log(f"Opening URL in Edge address bar: {url}")

    try:
        driver.get(url)
        wait_for_body(driver, timeout=timeout)
        return True
    except (NoSuchWindowException, InvalidSessionIdException, WebDriverException) as first_error:
        log(f"Direct navigation hit a closed/non-page target. Recovering: {first_error}")

        try:
            prepare_edge_automation_tab(driver, log=log)
            driver.get(url)
            wait_for_body(driver, timeout=timeout)
            return True
        except Exception as second_error:
            log(f"Recovered navigation failed: {second_error}")
            return False
    except Exception as e:
        log(f"Navigation failed: {e}")
        return False


def open_vpn_setup_browser(log=print):
    os.makedirs(AUTOMATION_PROFILE_DIR, exist_ok=True)

    if is_port_open():
        log("Automation Edge is already open and ready.")
        log("Use that Edge window. Confirm VPN is connected there.")
        return True

    edge_path = get_edge_exe_path()

    if not edge_path:
        log("Microsoft Edge executable not found.")
        return False

    args = [
        edge_path,
        f"--remote-debugging-port={REMOTE_DEBUGGING_PORT}",
        f"--user-data-dir={AUTOMATION_PROFILE_DIR}",
        "--profile-directory=Default",
        "--no-first-run",
        "--no-default-browser-check",
        SITE_URL,
    ]

    try:
        subprocess.Popen(args)
        log("Opened dedicated Edge automation browser.")
        log("Connect VPN inside this Edge window.")
        log("Keep this Edge window open while running store access.")

        for _ in range(20):
            if is_port_open():
                log("Automation Edge remote connection is ready.")
                return True

            time.sleep(0.5)

        log("Edge opened, but remote debugging port is not ready yet.")
        log("Wait a few seconds, then click Open VPN Browser Setup again.")
        return False

    except Exception as e:
        log(f"Failed to open VPN setup browser: {e}")
        return False


def create_edge_driver(log=print):
    global _ACTIVE_CDP_PORT
    if ATTACH_TO_OPEN_EDGE:
        if not is_port_open():
            # fixed automation port closed - zero-config discovery from
            # DevToolsActivePort files (chrome://inspect remote debugging;
            # idea: chrome-devtools-mcp#1826)
            _ACTIVE_CDP_PORT = (_discover_devtools_port(log=log)
                                or REMOTE_DEBUGGING_PORT)
        if not is_port_open(port=_ACTIVE_CDP_PORT):
            log("Automation Edge is not open.")
            log("Opening VPN Browser Setup now.")
            open_vpn_setup_browser(log=log)

        if not is_port_open(port=_ACTIVE_CDP_PORT):
            raise WebDriverException(
                "Automation Edge is not available on remote debugging port. "
                "Click Open VPN Browser Setup first and keep that Edge window open."
            )

        options = EdgeOptions()
        options.add_experimental_option(
            "debuggerAddress",
            f"127.0.0.1:{_ACTIVE_CDP_PORT}"
        )

        driver = webdriver.Edge(options=options)
        driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT)

        if not prepare_edge_automation_tab(driver, log=log):
            raise WebDriverException(
                "Edge is open, but Selenium could not attach to a normal browser tab. "
                "Close the Edge Downloads popup/flyout and try again."
            )

        _inject_anti_detection(driver)
        return driver

    options = EdgeOptions()
    options.add_argument("--start-maximized")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-popup-blocking")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument(f"--user-data-dir={AUTOMATION_PROFILE_DIR}")
    options.add_argument("--profile-directory=Default")

    # ── Anti-detection: hide that this is a WebDriver-controlled browser ──────
    # Cloudflare reads navigator.webdriver and several other automation
    # signals. Without masking these, it may refuse to render the Turnstile
    # widget normally or escalate to a harder managed challenge.
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument("--disable-blink-features=AutomationControlled")

    prefs = {
        "download.default_directory": DOWNLOAD_DIR,
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
        "credentials_enable_service": False,
        "profile.password_manager_enabled": False,
    }

    options.add_experimental_option("prefs", prefs)

    driver = webdriver.Edge(options=options)
    driver.set_page_load_timeout(PAGE_LOAD_TIMEOUT)
    _inject_anti_detection(driver)
    return driver


def _inject_anti_detection(driver):
    """Inject CDP script that removes navigator.webdriver before every page load."""
    try:
        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": """
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined, configurable: true
                    });
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => [1, 2, 3, 4, 5], configurable: true
                    });
                    Object.defineProperty(navigator, 'languages', {
                        get: () => ['en-US', 'en'], configurable: true
                    });
                    window.chrome = { runtime: {} };
                """
            }
        )
    except Exception:
        pass


def configure_download_folder(driver, log=print):
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)

    configured = False

    try:
        driver.execute_cdp_cmd(
            "Browser.setDownloadBehavior",
            {
                "behavior": "allow",
                "downloadPath": DOWNLOAD_DIR,
                "eventsEnabled": False,
            }
        )
        configured = True
    except Exception:
        pass

    try:
        driver.execute_cdp_cmd(
            "Page.setDownloadBehavior",
            {
                "behavior": "allow",
                "downloadPath": DOWNLOAD_DIR,
            }
        )
        configured = True
    except Exception:
        pass

    if configured:
        log(f"Download folder set: {DOWNLOAD_DIR}")
    else:
        log(f"Download folder prepared: {DOWNLOAD_DIR}")


def wait_for_body(driver, timeout=WAIT_SECONDS):
    WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )


def js_is_displayed(driver, element):
    try:
        return bool(
            driver.execute_script(
                """
                const el = arguments[0];

                if (!el) return false;

                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();

                return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    rect.width > 0 &&
                    rect.height > 0
                );
                """,
                element
            )
        )
    except Exception:
        return False


def safe_click(driver, locator, timeout=WAIT_SECONDS, name="element", log=print):
    element = WebDriverWait(driver, timeout).until(
        EC.element_to_be_clickable(locator)
    )

    driver.execute_script(
        "arguments[0].scrollIntoView({block: 'center'});",
        element
    )

    time.sleep(0.2)

    try:
        element.click()
    except (ElementClickInterceptedException, StaleElementReferenceException, WebDriverException):
        driver.execute_script("arguments[0].click();", element)

    log(f"Clicked: {name}")
    return element


def safe_type(driver, locator, text, timeout=WAIT_SECONDS, name="field", log=print):
    element = WebDriverWait(driver, timeout).until(
        EC.visibility_of_element_located(locator)
    )

    driver.execute_script(
        "arguments[0].scrollIntoView({block: 'center'});",
        element
    )

    driver.execute_script("arguments[0].click();", element)

    # Robust clear: JS wipe fires input/change so React/Angular/Vue bindings
    # treat the field as empty before we type.  element.clear() is kept as a
    # secondary fallback for plain HTML inputs.
    try:
        driver.execute_script(
            """
            arguments[0].value = '';
            arguments[0].dispatchEvent(new Event('input',  {bubbles: true}));
            arguments[0].dispatchEvent(new Event('change', {bubbles: true}));
            """,
            element,
        )
    except Exception:
        pass
    try:
        element.clear()
    except Exception:
        pass

    try:
        _existing = element.get_attribute("value") or ""
        if _existing:
            element.send_keys("\ue003" * (len(_existing) + 2))
    except Exception:
        pass

    element.send_keys(text)

    log(f"Filled: {name}")
    return element


def safe_type_any(driver, locators, text, timeout=WAIT_SECONDS, name="field", log=print):
    last_error = None

    for locator in locators:
        try:
            return safe_type(driver, locator, text, timeout=timeout, name=name, log=log)
        except Exception as e:
            last_error = e
            continue

    raise last_error if last_error else TimeoutException(f"Could not fill {name}")


def click_if_present(driver, locator, timeout=1, name="optional element", log=print):
    try:
        safe_click(driver, locator, timeout=timeout, name=name, log=log)
        return True
    except TimeoutException:
        return False
    except Exception as e:
        log(f"Skipped {name}: {e}")
        return False


def visible_elements(driver, locator):
    visible = []

    try:
        elements = driver.find_elements(*locator)

        for element in elements:
            try:
                if element.is_displayed() or js_is_displayed(driver, element):
                    visible.append(element)
            except Exception:
                continue

    except Exception:
        pass

    return visible


def reset_browser_session(driver, log=print):
    try:
        driver.execute_cdp_cmd("Network.clearBrowserCookies", {})
        driver.execute_cdp_cmd("Network.clearBrowserCache", {})
        log("Browser cookies/cache cleared for clean login.")
    except Exception:
        try:
            driver.delete_all_cookies()
            log("Browser cookies cleared.")
        except Exception:
            pass


def check_site_access(driver, log=print):
    try:
        if not open_url_in_edge_tab(driver, SITE_URL, timeout=45, log=log):
            log("Website access failed: could not open VidaPay in a normal Edge tab.")
            return False

        current_url = driver.current_url.lower()
        body_text = driver.find_element(By.TAG_NAME, "body").text.lower()

        if "vidapay" in current_url:
            log("VidaPay URL loaded.")
            return True

        if "sign in" in body_text or "login" in body_text:
            log("VidaPay login page detected.")
            return True

        log("Website opened, but expected VidaPay content was not detected.")
        return True

    except Exception as e:
        log(f"Website access failed: {e}")
        return False




# =========================================================
# PAGE STATE DETECTION
# =========================================================

PAGE_STATE_LOGIN = "LOGIN"


PAGE_STATE_HUMAN_VERIFY = "HUMAN_VERIFY"


PAGE_STATE_NEW_SIGN_IN = "NEW_SIGN_IN"


PAGE_STATE_IBM_VERIFY = "IBM_VERIFY"


PAGE_STATE_TRUST_DEVICE = "TRUST_DEVICE"


PAGE_STATE_TRUST_THIS_DEVICE = "TRUST_THIS_DEVICE"


PAGE_STATE_READY_TO_GO = "READY_TO_GO"


PAGE_STATE_SECURITY_UPGRADE = "SECURITY_UPGRADE"


PAGE_STATE_SETUP_NEXT = "SETUP_NEXT"


PAGE_STATE_ALERTS = "ALERTS"


PAGE_STATE_PORTAL = "PORTAL"


PAGE_STATE_UNKNOWN = "UNKNOWN"


TERMINAL_LOGIN_STATES = (PAGE_STATE_ALERTS, PAGE_STATE_PORTAL)


SETUP_FLOW_STATES = (
    PAGE_STATE_NEW_SIGN_IN,
    PAGE_STATE_IBM_VERIFY,
    PAGE_STATE_TRUST_DEVICE,
    PAGE_STATE_TRUST_THIS_DEVICE,
    PAGE_STATE_READY_TO_GO,
    PAGE_STATE_SECURITY_UPGRADE,
    PAGE_STATE_SETUP_NEXT,
)





def get_visible_heading_texts_lower(driver):
    try:
        headings = driver.execute_script(
            """
            return Array.from(document.querySelectorAll('h1,h2,h3,h4,legend')).map(el => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                return visible ? (el.innerText || el.textContent || '').trim().toLowerCase() : '';
            }).filter(Boolean);
            """
        )

        if isinstance(headings, list):
            return [str(item).strip().lower() for item in headings if str(item).strip()]
    except Exception:
        pass

    return []


def heading_or_body_has(driver, phrase):
    phrase = phrase.lower().strip()

    for heading in get_visible_heading_texts_lower(driver):
        if phrase in heading:
            return True

    return phrase in get_body_text_lower(driver)


def has_h3_heading(driver, phrase):
    phrase = phrase.lower().strip()

    try:
        texts = driver.execute_script(
            """
            return Array.from(document.querySelectorAll('h3')).map(el => {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                return visible ? (el.innerText || el.textContent || '').trim().toLowerCase() : '';
            }).filter(Boolean);
            """
        )

        return any(phrase in str(text).lower() for text in texts)
    except Exception:
        return heading_or_body_has(driver, phrase)


def is_login_page(driver):
    current_url = get_current_url_lower(driver)
    body_text = get_body_text_lower(driver)

    if "/login" in current_url:
        return True

    return (
        "account id" in body_text and
        "user name" in body_text and
        "password" in body_text and
        "sign in" in body_text
    )


def is_alerts_page(driver):
    current_url = get_current_url_lower(driver)
    body_text = get_body_text_lower(driver)

    has_alert_text = (
        "alerts" in body_text or
        "user passwords" in body_text or
        "passwords expiring" in body_text or
        "expired passwords" in body_text
    )

    has_later = False

    try:
        has_later = len(find_visible_later_buttons(driver)) > 0
    except Exception:
        has_later = False

    if has_alert_text and (has_later or "vidapay" in body_text):
        return True

    if "portal.vidapay.com" in current_url and has_later:
        return True

    return False


def is_portal_loaded(driver):
    current_url = get_current_url_lower(driver)
    body_text = get_body_text_lower(driver)

    if is_alerts_page(driver):
        return True

    if "portal.vidapay.com/app" in current_url:
        return True

    if "portal.vidapay.com/dashboard" in current_url:
        return True

    portal_markers = [
        "all transactions",
        "incentive dashboard",
        "dashboard",
        "account balance",
        "transactions",
    ]

    return "portal.vidapay.com" in current_url and any(marker in body_text for marker in portal_markers)


def is_new_sign_in_page(driver):
    current_url = get_current_url_lower(driver)

    return (
        "twofactornewdevicesignin" in current_url or
        has_h3_heading(driver, "new sign in")
    )


def is_two_factor_authentication_page(driver):
    current_url = get_current_url_lower(driver)

    return (
        "twofactorcheck" in current_url or
        has_h3_heading(driver, "2-factor authentication") or
        has_h3_heading(driver, "two-factor authentication")
    )


def is_trust_this_device_page(driver):
    current_url = get_current_url_lower(driver)

    return (
        "twofactorupdatename" in current_url or
        has_h3_heading(driver, "trust this device")
    )


def is_ready_to_go_page(driver):
    current_url = get_current_url_lower(driver)

    return (
        "twofactorready" in current_url or
        has_h3_heading(driver, "ready to go")
    )


def is_security_upgrade_page(driver):
    current_url = get_current_url_lower(driver)

    return (
        "secureupgradeoptions" in current_url or
        has_h3_heading(driver, "important: upgrade security") or
        has_h3_heading(driver, "upgrade security")
    )


def is_visible_enabled_by_css(driver, css_selector):
    try:
        return bool(
            driver.execute_script(
                """
                const el = document.querySelector(arguments[0]);
                if (!el) return false;

                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                const visible = (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    rect.width > 0 &&
                    rect.height > 0 &&
                    el.getClientRects().length > 0
                );

                return visible && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
                """,
                css_selector,
            )
        )
    except Exception:
        return False


def trust_radio_exists(driver):
    """
    VidaPay sometimes places #trustRadio and #setupNextBtn in the HTML before
    Selenium reports the radio as visible. The earlier working flow continued
    from those HTML controls. This function intentionally checks DOM presence,
    not only visual visibility.
    """
    try:
        return bool(driver.find_elements(By.ID, "trustRadio"))
    except Exception:
        return False


def setup_next_exists_in_dom(driver):
    try:
        return bool(driver.find_elements(By.ID, "setupNextBtn"))
    except Exception:
        return False


def is_trust_device_ready(driver):
    if trust_radio_exists(driver):
        return True

    try:
        trust_box = driver.find_element(By.ID, "trust")

        if trust_box:
            return trust_box.is_displayed() or js_is_displayed(driver, trust_box)
    except Exception:
        pass

    return False


def get_setup_next_buttons(driver):
    buttons = []

    locators = [
        (By.XPATH, "//button[@id='setupNextBtn']"),
        (By.XPATH, "//button[contains(@class,'pull-right') and normalize-space()='Next']"),
        (By.XPATH, "//button[normalize-space()='Next']"),
    ]

    for locator in locators:
        try:
            found = driver.find_elements(*locator)

            for button in found:
                try:
                    if button not in buttons:
                        buttons.append(button)
                except Exception:
                    continue
        except Exception:
            continue

    return buttons


def has_any_setup_next_button(driver):
    buttons = get_setup_next_buttons(driver)

    for button in buttons:
        try:
            if button.is_displayed() or js_is_displayed(driver, button):
                return True
        except Exception:
            continue

    try:
        return bool(
            driver.execute_script(
                """
                function visible(el) {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return (
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0' &&
                        rect.width > 0 &&
                        rect.height > 0 &&
                        el.getClientRects().length > 0 &&
                        !el.disabled &&
                        el.getAttribute('aria-disabled') !== 'true'
                    );
                }

                const byId = document.querySelector('button#setupNextBtn');
                if (visible(byId)) return true;

                return Array.from(document.querySelectorAll('button, input[type=button], input[type=submit]')).some(el => {
                    const text = (el.innerText || el.value || '').trim().toLowerCase();
                    return visible(el) && (text === 'next' || text.includes('next'));
                });
                """
            )
        )
    except Exception:
        return False


def is_twofactor_setup_next_page(driver):
    current_url = get_current_url_lower(driver)

    setup_url_markers = [
        "twofactorupdatename",
        "twofactorready",
        "twofactorsetup",
        "twofactornewdevice",
    ]

    if any(marker in current_url for marker in setup_url_markers):
        return True

    if "twofactor" in current_url and has_any_setup_next_button(driver):
        return True

    return False


def get_page_state(driver):
    try:
        if is_human_verification_page(driver):
            return PAGE_STATE_HUMAN_VERIFY
    except Exception:
        pass

    try:
        if is_ready_to_go_page(driver):
            return PAGE_STATE_READY_TO_GO
    except Exception:
        pass

    try:
        if is_trust_this_device_page(driver):
            return PAGE_STATE_TRUST_THIS_DEVICE
    except Exception:
        pass

    try:
        if is_security_upgrade_page(driver):
            return PAGE_STATE_SECURITY_UPGRADE
    except Exception:
        pass

    try:
        if is_trust_device_ready(driver):
            return PAGE_STATE_TRUST_DEVICE
    except Exception:
        pass

    try:
        if is_new_sign_in_page(driver):
            return PAGE_STATE_NEW_SIGN_IN
    except Exception:
        pass

    try:
        if is_alerts_page(driver):
            return PAGE_STATE_ALERTS
    except Exception:
        pass

    try:
        if is_portal_loaded(driver):
            return PAGE_STATE_PORTAL
    except Exception:
        pass

    try:
        if is_two_factor_authentication_page(driver):
            return PAGE_STATE_IBM_VERIFY
    except Exception:
        pass

    try:
        if is_twofactor_setup_next_page(driver):
            return PAGE_STATE_SETUP_NEXT
    except Exception:
        pass

    try:
        if is_login_page(driver):
            return PAGE_STATE_LOGIN
    except Exception:
        pass

    return PAGE_STATE_UNKNOWN


def log_current_page_state(driver, log=print, prefix="Current page"):
    state = get_page_state(driver)
    current_url = get_current_url_lower(driver)

    try:
        headings = get_visible_heading_texts_lower(driver)
        heading_text = " | ".join(headings[:3]) if headings else "no visible h3/h headings"
    except Exception:
        heading_text = "heading read failed"

    log(f"{prefix}: {state} | {current_url} | {heading_text}")
    return state


def is_two_factor_container_present(driver):
    locators = [
        (By.ID, "twoFactorCheck"),
        (By.ID, "2faSetupForm"),
        (By.ID, "send-info"),
        (By.ID, "trust"),
        (By.ID, "trustRadio"),
    ]

    for locator in locators:
        try:
            elements = driver.find_elements(*locator)

            for element in elements:
                try:
                    if element.is_displayed() or js_is_displayed(driver, element):
                        return True
                except Exception:
                    continue

        except Exception:
            continue

    return False


def is_send_info_visible(driver):
    try:
        send_info = driver.find_element(By.ID, "send-info")
        return send_info.is_displayed() or js_is_displayed(driver, send_info)
    except Exception:
        return False


def click_matching_button_js(driver, label, text_contains=None, onclick_contains=None, button_id=None, timeout=25, log=print):
    end_time = time.time() + timeout
    last_log = 0

    while time.time() < end_time:
        try:
            clicked = driver.execute_script(
                """
                const textContains = (arguments[0] || '').toLowerCase();
                const onclickContains = (arguments[1] || '').toLowerCase();
                const buttonId = arguments[2] || '';

                const elements = Array.from(document.querySelectorAll('button, input[type=button], input[type=submit], a'));

                function textOf(el) {
                    return (el.innerText || el.value || el.textContent || '').trim().toLowerCase();
                }

                function isUsable(el) {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return (
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0' &&
                        rect.width > 0 &&
                        rect.height > 0 &&
                        el.getClientRects().length > 0 &&
                        !el.disabled &&
                        el.getAttribute('aria-disabled') !== 'true'
                    );
                }

                const btn = elements.find(el => {
                    const id = el.id || '';
                    const onclick = (el.getAttribute('onclick') || '').toLowerCase();
                    const text = textOf(el);

                    if (buttonId && id !== buttonId) return false;
                    if (onclickContains && !onclick.includes(onclickContains)) return false;
                    if (textContains && !text.includes(textContains)) return false;
                    return isUsable(el);
                });

                if (!btn) return false;

                btn.removeAttribute('disabled');
                btn.disabled = false;
                btn.removeAttribute('aria-disabled');
                btn.scrollIntoView({block: 'center'});

                try { btn.focus(); } catch (err) {}

                try {
                    btn.click();
                    return true;
                } catch (err) {
                    const event = new MouseEvent('click', {bubbles: true, cancelable: true, view: window});
                    btn.dispatchEvent(event);
                    return true;
                }
                """,
                text_contains,
                onclick_contains,
                button_id,
            )

            if clicked:
                log(f"Clicked: {label}")
                time.sleep(1.2)
                return True

        except Exception:
            pass

        now = time.time()
        if now - last_log >= 5:
            log(f"Waiting for {label}...")
            last_log = now

        time.sleep(0.25)

    log(f"{label} was not found or not clickable within {timeout} seconds.")
    return False


def click_new_sign_in_next(driver, log=print):
    clicked = click_matching_button_js(
        driver,
        label="New Sign In Next",
        text_contains="next",
        onclick_contains="gototwofactorcheck",
        timeout=30,
        log=log,
    )

    if clicked:
        return True

    return click_matching_button_js(
        driver,
        label="New Sign In Next fallback",
        text_contains="next",
        timeout=10,
        log=log,
    )


def click_trust_device_next(driver, log=print):
    clicked = click_matching_button_js(
        driver,
        label="2FA Trust Device Next",
        text_contains="next",
        onclick_contains="submitthisform",
        button_id="setupNextBtn",
        timeout=30,
        log=log,
    )

    if clicked:
        return True

    return click_matching_button_js(
        driver,
        label="2FA Trust Device Next fallback",
        text_contains="next",
        button_id="setupNextBtn",
        timeout=30,
        log=log,
    )


def click_trust_this_device_next(driver, log=print):
    clicked = click_matching_button_js(
        driver,
        label="Trust This Device Next",
        text_contains="next",
        button_id="setupNextBtn",
        timeout=30,
        log=log,
    )

    if clicked:
        return True

    return click_matching_button_js(
        driver,
        label="Trust This Device Next fallback",
        text_contains="next",
        timeout=10,
        log=log,
    )


def click_ready_to_go_continue(driver, log=print):
    clicked = click_matching_button_js(
        driver,
        label="Ready To Go Continue",
        text_contains="continue",
        onclick_contains="vidapayautomaticsignin",
        timeout=18,
        log=log,
    )

    if clicked:
        return True

    clicked = click_matching_button_js(
        driver,
        label="Ready To Go Continue fallback",
        text_contains="continue",
        timeout=30,
        log=log,
    )

    if clicked:
        return True

    # Older VidaPay variants reused setupNextBtn on the Ready To Go page.
    return click_matching_button_js(
        driver,
        label="Ready To Go final Next fallback",
        text_contains="next",
        button_id="setupNextBtn",
        timeout=8,
        log=log,
    )


def select_trust_radio_quickly(driver, timeout=None, stop_event=None, log=print):
    """
    Stay on the 2-Factor Authentication page until VidaPay exposes the Trust Device
    radio in HTML, then select it immediately. This does not fail after 12 or 45 seconds.
    It exits only when Trust Device appears, the page moves forward, or the user presses Stop.
    """
    log("2-Factor Authentication page asked. Waiting here until 2FA is completed and Trust Device HTML is available...")
    end_time = None if timeout is None or timeout <= 0 else time.time() + timeout
    last_log = 0

    while end_time is None or time.time() < end_time:
        if stop_event is not None and stop_event.is_set():
            return False

        try:
            selected = driver.execute_script(
                """
                const radio = document.querySelector('#trustRadio');
                if (!radio) return false;

                radio.removeAttribute('disabled');
                radio.disabled = false;
                radio.removeAttribute('aria-disabled');
                radio.checked = true;

                try { radio.scrollIntoView({block: 'center'}); } catch (err) {}
                try { radio.focus(); } catch (err) {}
                try { radio.click(); } catch (err) {}

                radio.dispatchEvent(new Event('input', { bubbles: true }));
                radio.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
                """
            )

            if selected:
                log("2FA completed. Selected Trust Device radio from HTML location.")
                time.sleep(0.2)
                return True
        except Exception:
            pass

        state = get_page_state(driver)

        if state == PAGE_STATE_HUMAN_VERIFY:
            if not wait_for_human_verification_clear(driver, stop_event=stop_event, log=log, context="2FA clear"):
                return False
            continue

        if state in TERMINAL_LOGIN_STATES:
            log("Portal or alerts page loaded before Trust Device selection. Continuing.")
            return True

        if state in (PAGE_STATE_TRUST_THIS_DEVICE, PAGE_STATE_READY_TO_GO, PAGE_STATE_SECURITY_UPGRADE, PAGE_STATE_SETUP_NEXT):
            log("Already past Trust Device radio. Continuing setup flow.")
            return True

        now = time.time()
        if now - last_log >= 8:
            if state == PAGE_STATE_IBM_VERIFY:
                log("Still on 2FA page. Waiting for IBM Verify approval and Trust Device HTML controls...")
            else:
                log_current_page_state(driver, log=log, prefix="Trust radio HTML wait page")
            last_log = now

        time.sleep(0.5)

    log("Trust Device radio HTML location did not appear before timeout.")
    log_current_page_state(driver, log=log, prefix="Trust radio timeout page")
    return False


def wait_for_state(driver, stop_event, wanted_states, timeout=90, log=print, prefix="State wait"):
    end_time = time.time() + timeout
    last_state = None

    while time.time() < end_time:
        if stop_event.is_set():
            return False

        state = get_page_state(driver)

        if state != last_state:
            log_current_page_state(driver, log=log, prefix=prefix)
            last_state = state

        if state == PAGE_STATE_HUMAN_VERIFY:
            if not wait_for_human_verification_clear(driver, stop_event=stop_event, log=log, context=prefix):
                return False
            last_state = None
            continue

        if state in wanted_states:
            return state

        time.sleep(0.5)

    log(f"Timed out while waiting for: {', '.join(wanted_states)}")
    log_current_page_state(driver, log=log, prefix="Timed out on page")
    return False




# =========================================================
# HUMAN VERIFICATION (Cloudflare Turnstile / reCAPTCHA)
# =========================================================

def click_home_sign_in_button(driver, log=print):
    sign_in_locators = [
        (By.ID, "login-btn"),
        (By.XPATH, "//button[@id='login-btn' and normalize-space()='Sign In']"),
        (By.XPATH, "//button[@onclick=\"location.href='/login'\"]"),
        (By.XPATH, "//button[contains(@class,'btn-orange') and contains(normalize-space(),'Sign In')]"),
    ]

    for locator in sign_in_locators:
        try:
            safe_click(
                driver,
                locator,
                timeout=8,
                name="Home Sign In button",
                log=log
            )
            return True
        except Exception:
            continue

    log("Sign In button not clickable. Opening /login directly.")

    try:
        if open_url_in_edge_tab(driver, LOGIN_URL, timeout=WAIT_SECONDS, log=log):
            log("Login page opened directly.")
            return True
        log("Failed to open login page directly.")
        return False
    except Exception as e:
        log(f"Failed to open login page directly: {e}")
        return False


def get_current_url_lower(driver):
    try:
        return driver.current_url.lower()
    except Exception:
        return ""


def get_body_text_lower(driver):
    try:
        return driver.find_element(By.TAG_NAME, "body").text.lower()
    except Exception:
        return ""


def is_human_verification_page(driver):
    """
    Detects Cloudflare / human verification pages.
    The script does not click or bypass this control. It pauses until the user
    manually completes the check in the open Edge automation window.
    """
    current_url = get_current_url_lower(driver)
    body_text = get_body_text_lower(driver)

    text_markers = [
        "verify you are human",
        "verify human",
        "confirm you are human",
        "checking your browser",
        "security check",
        "cloudflare",
        "cf-turnstile",
        "turnstile",
        "review the security of your connection",
        "i'm not a robot",
        "not a robot",
        "recaptcha",
    ]

    if any(marker in body_text for marker in text_markers):
        return True

    if "challenge" in current_url and ("cloudflare" in body_text or "verify" in body_text):
        return True

    try:
        return bool(
            driver.execute_script(
                """
                function visible(el) {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return (
                        style.display !== 'none' &&
                        style.visibility !== 'hidden' &&
                        style.opacity !== '0' &&
                        rect.width > 0 &&
                        rect.height > 0 &&
                        el.getClientRects().length > 0
                    );
                }

                const bodyText = (document.body && document.body.innerText || '').toLowerCase();
                const hasVerifyText = bodyText.includes('verify') || bodyText.includes('human') || bodyText.includes('cloudflare') || bodyText.includes('robot');
                const visibleCheckbox = Array.from(document.querySelectorAll('input[type="checkbox"]')).some(visible);
                const turnstile = !!document.querySelector('[name="cf-turnstile-response"], .cf-turnstile, iframe[src*="turnstile"], iframe[src*="cloudflare"], iframe[src*="challenge"]');
                const recaptcha = !!document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, #recaptcha-anchor, #rc-anchor-container');

                return (visibleCheckbox && hasVerifyText) || turnstile || recaptcha;
                """
            )
        )
    except Exception:
        return False


def _cdp_trusted_click(driver, vp_x, vp_y, log=print):
    """One trusted left-click at VIEWPORT coords via CDP Input events.

    Screen-free: no OS cursor movement, no focus change - works while the
    Edge window sits on any monitor or behind other windows (it just must
    not be minimized). The events are isTrusted=true, which is what Google
    reCAPTCHA now requires (a JS .click() is isTrusted=false and ignored).

    Idea ref: chrome-devtools-mcp issue #1826."""
    def _dispatch(etype, buttons, count):
        driver.execute_cdp_cmd("Input.dispatchMouseEvent", {
            "type": etype,
            "x": float(vp_x),
            "y": float(vp_y),
            "button": "left",
            "buttons": buttons,
            "clickCount": count,
        })

    try:
        _dispatch("mouseMoved", 0, 0)
        time.sleep(0.06)
        _dispatch("mousePressed", 1, 1)
        time.sleep(0.09)
        _dispatch("mouseReleased", 0, 1)
        return True
    except Exception as exc:
        log(f"CDP trusted click failed: {exc}")
        return False


def _cdp_click_iframe_checkbox(driver, iframe_el, offset_x=28, log=print):
    """Trusted CDP click on the checkbox inside a cross-origin challenge
    iframe (reCAPTCHA anchor / Turnstile). The click point is computed
    from the iframe's viewport rect + offset, so it never needs the
    screen, the mouse, or JS. Returns False when it could not fire so
    the caller can fall back to the legacy clickers."""
    try:
        driver.execute_script(
            "arguments[0].scrollIntoView({block:'center'});", iframe_el)
        time.sleep(0.4)
        rect = driver.execute_script(
            "const r = arguments[0].getBoundingClientRect();"
            "return {left: r.left, top: r.top, width: r.width,"
            "        height: r.height};", iframe_el)
        if not rect or not rect.get("width"):
            log("Challenge iframe has zero size - not rendered yet.")
            return False
        x = rect["left"] + offset_x
        y = rect["top"] + rect["height"] / 2.0
        log(f"CDP trusted click at viewport ({x:.0f},{y:.0f}) "
            f"(iframe {rect['width']:.0f}x{rect['height']:.0f}).")
        return _cdp_trusted_click(driver, x, y, log=log)
    except Exception as exc:
        log(f"CDP iframe checkbox click error: {exc}")
        return False


def _discover_devtools_port(log=print):
    """Zero-config CDP port discovery (chrome-devtools-mcp#1826).
    Chrome/Edge write DevToolsActivePort (line 1 = port) whenever remote
    debugging is on - including the chrome://inspect remote-debugging
    toggle on the user's normal browser. Returns the first port that
    answers, or None."""
    candidates = []
    la = os.environ.get("LOCALAPPDATA")
    if la:
        candidates += [
            os.path.join(la, "Microsoft", "Edge", "User Data",
                         "DevToolsActivePort"),
            os.path.join(la, "Google", "Chrome", "User Data",
                         "DevToolsActivePort"),
        ]
    try:
        candidates.append(os.path.join(AUTOMATION_PROFILE_DIR,
                                       "DevToolsActivePort"))
    except Exception:
        pass
    for path in candidates:
        try:
            with open(path, "r", encoding="utf-8",
                      errors="ignore") as fh:
                port = int((fh.readline() or "").strip())
        except Exception:
            continue
        if not 0 < port < 65536:
            continue
        try:
            with socket.create_connection(("127.0.0.1", port),
                                          timeout=1):
                log(f"CDP port {port} discovered via {path}")
                return port
        except Exception:
            continue
    return None


def _cdp_click_turnstile(driver, log=print):
    """
    Solve the Cloudflare Turnstile widget using a CDP trusted click.

    Why this replaced the old pyautogui approach:
      - pyautogui moves the REAL OS mouse and needs Edge in the FOREGROUND
        (SetForegroundWindow), so it hijacks the user's screen. That breaks
        the "run automation on one screen, work on another" workflow.
      - CDP Input.dispatchMouseEvent synthesizes trusted (isTrusted=true)
        browser-level input at VIEWPORT coordinates. From the page's point
        of view it is indistinguishable from a real click, but it never
        touches the OS mouse, never steals focus, and works regardless of
        which monitor Edge sits on or what DPI scaling is in play.

    Widget location (unchanged, proven trick): Cloudflare renders the
    Turnstile iframe inside a CLOSED shadow root, so querySelector can never
    see the iframe itself. But Cloudflare ALWAYS injects a hidden
    [name="cf-turnstile-response"] input into the MAIN DOM; the parent chain
    of that input hosts the ~300x65 widget box, and getBoundingClientRect()
    on it yields the exact viewport coordinates for the CDP click.

    Success signal: the response token filling in the MAIN DOM:
        document.querySelector('[name="cf-turnstile-response"]').value
    Non-empty token = Turnstile accepted the solve. Checked BEFORE clicking
    (managed / non-interactive challenges pass with no click at all) and
    polled after every click attempt.
    """

    def _token():
        try:
            return driver.execute_script("""
                const el = document.querySelector('[name="cf-turnstile-response"]');
                return el && el.value ? el.value : '';
            """) or ""
        except Exception:
            return ""

    def _cleared():
        try:
            still = driver.execute_script("""
                const t = (document.body.innerText || '').toLowerCase();
                if (t.includes('verify you are human') || t.includes('verify human')) return true;
                if (t.includes('performing security verification')) return true;
                if (t.includes('just a moment')) return true;
                return false;
            """)
            return not still
        except Exception:
            return False

    def _cdp_click(x, y):
        """Trusted click at viewport (x, y) via CDP input events."""
        try:
            # Approach movement — pointer trajectory is one of the signals
            steps = [(x - 60, y - 45), (x - 25, y - 15), (x, y)]
            for sx, sy in steps:
                driver.execute_cdp_cmd("Input.dispatchMouseEvent", {
                    "type": "mouseMoved", "x": int(sx), "y": int(sy),
                    "button": "none", "buttons": 0,
                })
                time.sleep(0.06)
            driver.execute_cdp_cmd("Input.dispatchMouseEvent", {
                "type": "mousePressed", "x": int(x), "y": int(y),
                "button": "left", "buttons": 1, "clickCount": 1,
            })
            time.sleep(0.08)
            driver.execute_cdp_cmd("Input.dispatchMouseEvent", {
                "type": "mouseReleased", "x": int(x), "y": int(y),
                "button": "left", "buttons": 0, "clickCount": 1,
            })
            return True
        except Exception as e:
            log(f"  CDP click error: {e}")
            return False

    def _actions_click(el, x_off, w):
        """Fallback trusted click via Selenium ActionChains (also CDP-level,
        also completely screen-free)."""
        try:
            from selenium.webdriver.common.action_chains import ActionChains
            ActionChains(driver).move_to_element_with_offset(
                el, int(x_off - w / 2), 0).click().perform()
            return True
        except Exception as e:
            log(f"  ActionChains click error: {e}")
            return False

    # -- 0. Already solved? (managed / non-interactive auto-pass) -------------
    tok = _token()
    if tok:
        log("  Turnstile token already present - no click needed.")
        return True

    time.sleep(2.0)  # let the widget finish rendering

    # -- 1. Locate the widget box by geometry (closed-shadow safe) ------------
    rect = None
    for tick in range(10):
        try:
            rect = driver.execute_script("""
                const cfInput = document.querySelector(
                    '[name="cf-turnstile-response"], input[id*="cf-chl-widget"]');
                if (cfInput) {
                    let el = cfInput.parentElement;
                    for (let i = 0; i < 6 && el; i++) {
                        const r = el.getBoundingClientRect();
                        if (r.width >= 250 && r.width <= 380 &&
                            r.height >= 45 && r.height <= 110 &&
                            (r.top > 0 || r.left > 0)) {
                            return {left:r.left, top:r.top,
                                    width:r.width, height:r.height,
                                    source:'cf-input-parent'};
                        }
                        el = el.parentElement;
                    }
                }
                const all = document.querySelectorAll('div');
                for (const el of all) {
                    const r = el.getBoundingClientRect();
                    if (r.width >= 280 && r.width <= 320 && r.height >= 55 && r.height <= 75) {
                        const txt = (el.innerText || '').trim().toLowerCase();
                        if (txt.includes('verify you are human') || txt.includes('verify')) {
                            return {left:r.left, top:r.top, width:r.width, height:r.height};
                        }
                    }
                }
                return null;
            """)
            if rect:
                log(f"  Turnstile widget located (tick {tick+1}/10): "
                    f"{int(rect['width'])}x{int(rect['height'])}px "
                    f"at viewport ({int(rect['left'])},{int(rect['top'])}).")
                break
            # Bail out early when this is clearly NOT a Turnstile page, so the
            # reCAPTCHA branch is not starved.
            if tick >= 4:
                has_cf = driver.execute_script("""
                    return !!(document.querySelector('[name="cf-turnstile-response"]') ||
                              document.querySelector('input[id*="cf-chl-widget"]') ||
                              document.querySelector('.cf-turnstile'));
                """)
                if not has_cf:
                    log("  No Turnstile widget/response input found - not a Turnstile page.")
                    return False
        except Exception:
            pass
        time.sleep(1)

    if not rect:
        log("  Could not locate the Turnstile widget box by geometry scan.")
        return False

    # -- 2. Scroll the widget into view and re-read its rect ------------------
    try:
        driver.execute_script("""
            const cfInput = document.querySelector('[name="cf-turnstile-response"]');
            let el = null;
            if (cfInput) {
                el = cfInput.parentElement;
                for (let i = 0; i < 6 && el; i++) {
                    const r = el.getBoundingClientRect();
                    if (r.width >= 250 && r.width <= 380 && r.height >= 45 && r.height <= 110) break;
                    el = el.parentElement;
                }
            }
            if (!el) {
                const all = document.querySelectorAll('div');
                for (const c of all) {
                    const r = c.getBoundingClientRect();
                    const txt = (c.innerText || '').trim().toLowerCase();
                    if (r.width >= 280 && r.width <= 320 && r.height >= 55 && r.height <= 75 &&
                        txt.includes('verify')) { el = c; break; }
                }
            }
            if (el) el.scrollIntoView({block:'center', inline:'center'});
        """)
        time.sleep(0.8)
        rect2 = driver.execute_script("""
            const cfInput = document.querySelector('[name="cf-turnstile-response"]');
            if (cfInput) {
                let el = cfInput.parentElement;
                for (let i = 0; i < 6 && el; i++) {
                    const r = el.getBoundingClientRect();
                    if (r.width >= 250 && r.width <= 380 && r.height >= 45 && r.height <= 110 &&
                        r.top > 0 && r.left > 0) {
                        return {left:r.left, top:r.top, width:r.width, height:r.height};
                    }
                    el = el.parentElement;
                }
            }
            return null;
        """)
        if rect2:
            rect = rect2
    except Exception:
        pass

    time.sleep(1.0)  # let Cloudflare's JS listeners fully bind

    # -- 3. Click attempts across the checkbox zone ---------------------------
    w = rect["width"]
    attempts = [(x_off, "checkbox") for x_off in (22, 16, 30, 12, 40)]
    attempts.append((w / 2, "centre"))

    for x_off, label in attempts:
        if _token():
            log("  Turnstile token present - solved.")
            return True
        cx = rect["left"] + x_off
        cy = rect["top"] + rect["height"] / 2
        log(f"  CDP trusted click at viewport ({int(cx)},{int(cy)}) [{label}]...")
        clicked = _cdp_click(cx, cy)
        if not clicked:
            # Fallback: ActionChains on the wrapper element (still screen-free)
            try:
                el = driver.execute_script("""
                    const cfInput = document.querySelector('[name="cf-turnstile-response"]');
                    if (cfInput) {
                        let p = cfInput.parentElement;
                        for (let i = 0; i < 6 && p; i++) {
                            const r = p.getBoundingClientRect();
                            if (r.width >= 250 && r.width <= 380 && r.height >= 45 && r.height <= 110)
                                return p;
                            p = p.parentElement;
                        }
                    }
                    return null;
                """)
                if el:
                    clicked = _actions_click(el, x_off, rect["width"])
            except Exception:
                pass
        # Poll for the token - the definitive success signal (up to 8s)
        for _w in range(16):
            time.sleep(0.5)
            if _token():
                log("  Turnstile token captured - verified CLEAR.")
                return True
            if _w == 5 and _cleared():
                log("  Challenge text gone - treated as cleared.")
                return True

    log("  CDP Turnstile click did not yield a token - falling through to human wait.")
    return False

def _ensure_pip_package(package_import, pip_name, log=print):
    try:
        __import__(package_import)
        return True
    except ImportError:
        log(f"  Installing {pip_name}...")
        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", pip_name, "--quiet",
                 "--disable-pip-version-check"],
                capture_output=True, timeout=120,
            )
            __import__(package_import)
            return True
        except Exception as e:
            log(f"  Could not install {pip_name}: {e}")
            return False


def _get_ffmpeg_path(log=print):
    ff = shutil.which("ffmpeg")
    if ff:
        return ff
    try:
        if _ensure_pip_package("imageio_ffmpeg", "imageio-ffmpeg", log=log):
            import imageio_ffmpeg
            return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    return None


def _browser_fetch_mp3(driver, url, log=print):
    """Fetch a URL through the CURRENT Selenium browsing context's own
    JavaScript (browser cookies, real User-Agent, browser TLS stack).
    Returns raw bytes, or None on any failure. Call it while switched INTO
    the frame whose origin should issue the request - for reCAPTCHA audio
    that is the bframe (www.google.com, same origin as the audio link)."""
    js = (
        "const done = arguments[arguments.length - 1];"
        "fetch(arguments[0], {credentials: 'include'})"
        ".then(function(r){ if (!r.ok) { throw new Error('HTTP ' + r.status); }"
        "  return r.arrayBuffer(); })"
        ".then(function(buf){"
        "  const b = new Uint8Array(buf); let s = '';"
        "  for (let i = 0; i < b.length; i += 0x8000)"
        "    s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));"
        "  done({ok: true, b64: btoa(s)}); })"
        ".catch(function(e){ done({ok: false, error: String(e)}); });"
    )
    try:
        driver.set_script_timeout(45)
        res = driver.execute_async_script(js, url)
    except Exception as e:
        log(f"  Browser fetch error: {e}")
        return None
    if not res or not res.get("ok"):
        log("  Browser fetch failed: %s" % (res.get("error") if res else "no result"))
        return None
    try:
        return base64.b64decode(res["b64"])
    except Exception as e:
        log(f"  Browser fetch decode failed: {e}")
        return None


def _python_fetch_mp3(url, user_agent, referer, cookies, timeout=30):
    """Direct download that mimics the browser exactly: the real UA, the
    google.com session cookies captured from the bframe, and the bframe
    referer. Raises on failure so the caller can retry."""
    hdrs = {
        "User-Agent": user_agent,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": referer or "https://www.google.com/",
    }
    if cookies:
        hdrs["Cookie"] = "; ".join(
            "%s=%s" % (c.get("name"), c.get("value")) for c in cookies
        )
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _looks_like_mp3(b):
    """Cheap sanity check: an MP3 starts with an ID3 tag or an MPEG audio
    frame sync (0xFF then 3 sync bits). Google occasionally serves an HTML
    error page instead of audio when a challenge expired - catch that here
    with a clear diagnostic instead of a confusing ffmpeg failure."""
    return bool(b) and len(b) >= 3 and (
        b[:3] == b"ID3" or (b[0] == 0xFF and (b[1] & 0xE0) == 0xE0)
    )


def try_solve_recaptcha(driver, log=print):
    """
    Solve reCAPTCHA v2 via audio challenge, then click VidaPay's #btnClick.
    Steps:
      1. Switch into anchor iframe → click checkbox
      2. Wait for a VISIBLE bframe → click audio button (JS-click fallback)
      3. Download MP3 from rc-audiochallenge-tdownload-link
      4. Convert to WAV with ffmpeg, transcribe with Google STT (Whisper fallback)
      5. Enter answer into #audio-response → click #recaptcha-verify-button
      6. Switch back to default content → click #btnClick to submit login
    """
    if not _ensure_pip_package("speech_recognition", "SpeechRecognition", log=log):
        log("  SpeechRecognition unavailable.")
        return False
    import speech_recognition as sr

    ffmpeg = _get_ffmpeg_path(log=log)
    if not ffmpeg:
        log("  ffmpeg not found — cannot solve reCAPTCHA audio.")
        return False

    try:
        driver.switch_to.default_content()

        # 1. Anchor iframe → click checkbox
        anchor = None
        for sel in ["iframe[src*='recaptcha/api2/anchor']",
                    "iframe[src*='recaptcha/enterprise/anchor']",
                    "iframe[title*='reCAPTCHA']",
                    "iframe[title*='not a robot']"]:
            try:
                anchor = driver.find_element(By.CSS_SELECTOR, sel)
                break
            except Exception:
                pass
        if not anchor:
            log("  reCAPTCHA anchor iframe not found.")
            return False

        _cb_trusted = False
        try:
            # TRUSTED click on the checkbox, straight through the anchor
            # iframe (screen-free). Google ignores JS .click() events
            # (isTrusted=false), so this is tried BEFORE the legacy
            # element-click path below.
            _cb_trusted = _cdp_click_iframe_checkbox(driver, anchor,
                                                     offset_x=28, log=log)
            if _cb_trusted:
                log("  Checkbox clicked (CDP trusted - screen-free).")
                time.sleep(2)
        except Exception as _cdp_exc:
            log(f"  CDP trusted click unavailable ({_cdp_exc}) - "
                f"falling back to the element click.")
        if not _cb_trusted:
            driver.switch_to.frame(anchor)
            time.sleep(0.5)
            try:
                cb = driver.find_element(By.ID, "recaptcha-anchor")
                if driver.execute_script(
                        "return arguments[0].getAttribute('aria-checked');",
                        cb) != "true":
                    cb.click()
                    log("  Checkbox clicked.")
                    time.sleep(2)
            except Exception:
                pass
        driver.switch_to.default_content()
        time.sleep(1.5)

        # 2. bframe → click audio button.
        # The challenge iframe can take several seconds to RENDER after the
        # checkbox click, and stale/hidden bframes from earlier cycles linger
        # in the DOM — so WAIT for a *visible* bframe instead of grabbing the
        # first match, then wait generously for the audio button with a
        # JS-click fallback (a bare 8s wait timed out with
        # "Could not click audio button: Message: ").
        _BFRAME_SELS = [
            "iframe[src*='recaptcha/api2/bframe']",
            "iframe[src*='recaptcha/enterprise/bframe']",
            "iframe[title*='recaptcha challenge']",
            "iframe[title*='challenge expires']",
        ]

        def _find_bframe():
            driver.switch_to.default_content()
            for sel in _BFRAME_SELS:
                try:
                    _f = driver.find_element(By.CSS_SELECTOR, sel)
                    if _f.is_displayed():
                        return _f
                except Exception:
                    continue
            return None

        try:
            WebDriverWait(driver, 15).until(lambda d: _find_bframe() is not None)
        except Exception:
            pass
        bframe = _find_bframe()

        solved_no_challenge = False
        if not bframe:
            # No challenge appeared — the checkbox may have solved it alone.
            _checked = False
            for _asel in ("iframe[src*='recaptcha/api2/anchor']",
                          "iframe[src*='recaptcha/enterprise/anchor']",
                          "iframe[title*='reCAPTCHA']",
                          "iframe[title*='not a robot']"):
                try:
                    _anchor_el = driver.find_element(By.CSS_SELECTOR, _asel)
                    driver.switch_to.frame(_anchor_el)
                    _checked = driver.execute_script(
                        "return arguments[0].getAttribute('aria-checked');",
                        driver.find_element(By.ID, "recaptcha-anchor")) == "true"
                    break
                except Exception:
                    continue
            driver.switch_to.default_content()
            if _checked:
                log("  Checkbox solved instantly — no audio challenge needed.")
                solved_no_challenge = True
            else:
                log("  reCAPTCHA challenge iframe did not appear.")
                return False

        transcript = None
        submitted = solved_no_challenge

        if not solved_no_challenge:
            driver.switch_to.frame(bframe)
            time.sleep(1)

            audio_btn = None
            _AB_SELS = [
                (By.ID, "recaptcha-audio-button"),
                (By.CSS_SELECTOR, "button[title*='audio' i]"),
                (By.CSS_SELECTOR, "button[title*='Audio']"),
            ]
            _deadline = time.time() + 15
            while time.time() < _deadline and audio_btn is None:
                for _sel in _AB_SELS:
                    try:
                        for _el in driver.find_elements(*_sel):
                            try:
                                if _el.is_displayed() and _el.is_enabled():
                                    audio_btn = _el
                                    break
                            except Exception:
                                continue
                    except Exception:
                        pass
                    if audio_btn is not None:
                        break
                if audio_btn is None:
                    time.sleep(0.5)
            if audio_btn is None:
                log("  Could not click audio button: challenge controls never appeared.")
                driver.switch_to.default_content()
                return False
            try:
                audio_btn.click()
            except Exception:
                driver.execute_script("arguments[0].click();", audio_btn)
            log("  Audio button clicked.")
            time.sleep(2)

        # 3–5. Audio-challenge loop: up to 3 cycles.
        # On each failed transcription we click #recaptcha-reload-button
        # inside the bframe to get a fresh audio clip, then retry.
        for audio_cycle in range(0 if solved_no_challenge else 3):
            if audio_cycle > 0:
                # ── Reload audio challenge ────────────────────────────────────
                log(f"  Reloading audio challenge (cycle {audio_cycle + 1})...")
                _bf = _find_bframe()
                if not _bf:
                    log("  bframe gone — cannot reload.")
                    break
                driver.switch_to.frame(_bf)
                try:
                    _rb = WebDriverWait(driver, 6).until(
                        EC.element_to_be_clickable((By.ID, "recaptcha-reload-button"))
                    )
                    _rb.click()
                    log("  Audio challenge reloaded.")
                    time.sleep(2.5)
                except Exception as _re:
                    log(f"  Reload button not clickable: {_re}")
                    driver.switch_to.default_content()
                    break
                driver.switch_to.default_content()
                time.sleep(0.5)

            # ── Step 3: get MP3 URL ───────────────────────────────────────────
            _bf2 = _find_bframe()
            if not _bf2:
                log("  bframe missing — cannot get MP3.")
                break
            driver.switch_to.frame(_bf2)
            time.sleep(1)
            mp3_url = None
            try:
                mp3_url = driver.find_element(
                    By.CSS_SELECTOR, "a.rc-audiochallenge-tdownload-link"
                ).get_attribute("href")
            except Exception:
                pass
            if not mp3_url:
                try:
                    mp3_url = driver.find_element(
                        By.CSS_SELECTOR, "audio#audio-source, audio source"
                    ).get_attribute("src")
                except Exception:
                    pass
            if not mp3_url:
                driver.switch_to.default_content()
                log(f"  MP3 URL not found (cycle {audio_cycle + 1}).")
                continue
            log(f"  MP3 URL obtained (cycle {audio_cycle + 1}).")

            # Capture the google.com session context while still inside the
            # bframe (needed by the direct-download fallback below).
            try:
                _gcookies = driver.get_cookies()
            except Exception:
                _gcookies = []
            try:
                _greferer = driver.current_url or "https://www.google.com/"
            except Exception:
                _greferer = "https://www.google.com/"
            try:
                _gua = driver.execute_script("return navigator.userAgent;") or "Mozilla/5.0"
            except Exception:
                _gua = "Mozilla/5.0"

            # PRIMARY: download the MP3 through the browser itself. The fetch
            # runs inside the bframe's own JS context (same origin as the
            # audio link) with the browser's cookies, real User-Agent and
            # TLS stack. Google resets bare-urllib connections (WinError
            # 10054) but not the browser's own requests.
            mp3_bytes = None
            if mp3_url:
                # Two quick browser-context attempts - this is the path
                # Google does NOT reset (real browser TLS, cookies, same
                # origin as the payload link).
                for _b in range(2):
                    _got = _browser_fetch_mp3(driver, mp3_url, log=log)
                    if _got and _looks_like_mp3(_got):
                        mp3_bytes = _got
                        break
                    if _got:
                        log(f"  Browser fetch returned non-audio payload "
                            f"({len(_got)} bytes, head={_got[:16]!r}).")
                    time.sleep(1)
            driver.switch_to.default_content()

            # Step 4: Download -> WAV -> STT
            transcript = None
            with tempfile.TemporaryDirectory() as tmp:
                mp3 = os.path.join(tmp, "c.mp3")
                wav = os.path.join(tmp, "c.wav")
                if mp3_bytes is None:
                    # FALLBACK: direct download mimicking the browser exactly
                    # (real UA + google.com cookies + referer), 2 attempts.
                    for _d in range(2):
                        try:
                            _got = _python_fetch_mp3(
                                mp3_url, _gua, _greferer, _gcookies, timeout=30
                            )
                            if _looks_like_mp3(_got):
                                mp3_bytes = _got
                                break
                            log(f"  Fallback returned non-audio payload "
                                f"({len(_got)} bytes, head={_got[:16]!r}).")
                        except Exception as e:
                            log(f"  MP3 download failed (attempt {_d + 1}/2): {e}")
                        time.sleep(2)
                if mp3_bytes is None:
                    continue
                try:
                    with open(mp3, "wb") as _fh:
                        _fh.write(mp3_bytes)
                    log("  MP3 downloaded.")
                except Exception as e:
                    log(f"  MP3 save failed: {e}")
                    continue
                try:
                    subprocess.run([ffmpeg, "-y", "-i", mp3, "-ar", "16000", "-ac", "1", wav],
                                   capture_output=True, timeout=30)
                    if not os.path.exists(wav):
                        log("  ffmpeg conversion failed.")
                        continue
                except Exception as e:
                    log(f"  ffmpeg error: {e}")
                    continue

                # Primary: Google STT (with 2 retries on network errors)
                for _g in range(2):
                    try:
                        rec = sr.Recognizer()
                        with sr.AudioFile(wav) as _src:
                            _audio = rec.record(_src)
                        transcript = rec.recognize_google(_audio)
                        log(f"  Google STT: '{transcript}'")
                        break
                    except Exception as e:
                        log(f"  Google STT attempt {_g+1} failed: {e}")
                        time.sleep(1)

                # Fallback 1: Whisper
                if not transcript:
                    log("  Trying Whisper...")
                    try:
                        if _ensure_pip_package("whisper", "openai-whisper", log=log):
                            import whisper as _w
                            _model = _w.load_model("base")
                            transcript = _model.transcribe(wav).get("text", "").strip()
                            log(f"  Whisper: '{transcript}'")
                    except Exception as e2:
                        log(f"  Whisper failed: {e2}")

                # Fallback 2: vosk (lightweight offline model)
                if not transcript:
                    log("  Trying vosk offline STT...")
                    try:
                        if _ensure_pip_package("vosk", "vosk", log=log):
                            import vosk as _vosk, json as _json, wave as _wave
                            _vosk_model_path = os.path.join(
                                os.path.expanduser("~"), ".vosk", "model-en-us-0.22-lgraph"
                            )
                            if not os.path.isdir(_vosk_model_path):
                                log("  vosk model not found — downloading small model...")
                                import urllib.request as _ur, zipfile as _zf, io as _io
                                _model_url = (
                                    "https://alphacephei.com/vosk/models/"
                                    "vosk-model-small-en-us-0.15.zip"
                                )
                                _vosk_model_path = os.path.join(
                                    os.path.expanduser("~"), ".vosk", "vosk-model-small-en-us-0.15"
                                )
                                os.makedirs(os.path.dirname(_vosk_model_path), exist_ok=True)
                                if not os.path.isdir(_vosk_model_path):
                                    with _ur.urlopen(_model_url, timeout=60) as _r:
                                        _zf.ZipFile(_io.BytesIO(_r.read())).extractall(
                                            os.path.dirname(_vosk_model_path)
                                        )
                                    log("  vosk model downloaded.")
                            if os.path.isdir(_vosk_model_path):
                                _vm = _vosk.Model(_vosk_model_path)
                                _wf = _wave.open(wav, "rb")
                                _vr = _vosk.KaldiRecognizer(_vm, _wf.getframerate())
                                _parts = []
                                while True:
                                    _chunk = _wf.readframes(4000)
                                    if not _chunk:
                                        break
                                    if _vr.AcceptWaveform(_chunk):
                                        _parts.append(_json.loads(_vr.Result()).get("text", ""))
                                _parts.append(_json.loads(_vr.FinalResult()).get("text", ""))
                                transcript = " ".join(p for p in _parts if p).strip()
                                log(f"  vosk: '{transcript}'")
                    except Exception as e3:
                        log(f"  vosk failed: {e3}")

            if not transcript:
                log(f"  All STT methods failed on cycle {audio_cycle + 1}.")
                continue  # reload and try a new audio clip

            # ── Step 5: submit answer ─────────────────────────────────────────
            _bf3 = _find_bframe()
            if not _bf3:
                log("  bframe gone before answer entry.")
                break
            driver.switch_to.frame(_bf3)
            time.sleep(0.5)
            inp = None
            try:
                inp = WebDriverWait(driver, 10).until(
                    EC.element_to_be_clickable((By.ID, "audio-response"))
                )
                inp.clear()
                inp.send_keys(transcript.lower().strip())
                time.sleep(0.4)
                # Wait for the VERIFY button, click it, and fall back to a
                # JS click — the bare find_element().click() here raced the
                # challenge reload and silently failed, leaving the solver
                # stuck on the audio step.
                _vbtn = WebDriverWait(driver, 10).until(
                    EC.element_to_be_clickable((By.ID, "recaptcha-verify-button"))
                )
                try:
                    _vbtn.click()
                except Exception:
                    driver.execute_script("arguments[0].click();", _vbtn)
                log(f"  reCAPTCHA answer submitted (cycle {audio_cycle + 1}).")
                time.sleep(2.5)

                # Check for "Multiple correct solutions required" error.
                # This means our answer was right but reCAPTCHA wants more.
                # Click reload and try a fresh audio clip on the next cycle.
                _multi_err = False
                try:
                    _err_el = driver.find_element(
                        By.CSS_SELECTOR, ".rc-audiochallenge-error-message"
                    )
                    _err_text = (_err_el.get_attribute("textContent") or "").strip().lower()
                    if "multiple correct solutions" in _err_text or _err_el.is_displayed():
                        log(f"  'Multiple correct solutions required' — reloading challenge...")
                        _multi_err = True
                        try:
                            _rb = driver.find_element(By.ID, "recaptcha-reload-button")
                            _rb.click()
                            log("  Audio challenge reloaded after multi-solution error.")
                            time.sleep(2.5)
                        except Exception as _rbe:
                            log(f"  Reload button not found after multi-solution error: {_rbe}")
                except Exception:
                    pass

                if not _multi_err:
                    submitted = True
            except Exception as e:
                log(f"  Could not submit answer: {e}")
                # Last-chance fallback: ENTER inside the answer box also
                # submits the reCAPTCHA form.
                try:
                    if inp is not None:
                        from selenium.webdriver.common.keys import Keys as _K2
                        inp.send_keys(_K2.ENTER)
                        log("  Answer re-submitted via ENTER.")
                        time.sleep(2.5)
                        submitted = True
                except Exception:
                    pass
            driver.switch_to.default_content()
            if submitted:
                break  # exit audio_cycle loop

        driver.switch_to.default_content()
        time.sleep(1.5)
        if not submitted:
            log("  reCAPTCHA audio solve exhausted all cycles.")
            return False

        # 6. Click VidaPay's login Verify button (#btnClick) — robust, retried
        driver.switch_to.default_content()
        time.sleep(1)
        clicked_verify = False
        for attempt in range(5):
            try:
                # Try by ID first
                btns = driver.find_elements(By.ID, "btnClick")
                # Then orange verify buttons / data-test-id
                btns += driver.find_elements(
                    By.CSS_SELECTOR,
                    "button[data-test-id='verify'], button[value='login'], "
                    "button[data-callback='formSubmit']")
                btns += driver.find_elements(
                    By.XPATH,
                    "//button[contains(@class,'btn-orange') and "
                    "contains(translate(normalize-space(),'VERIFY','verify'),'verify')]")
                target = None
                for b in btns:
                    try:
                        if b.is_displayed() and b.is_enabled():
                            target = b
                            break
                    except Exception:
                        continue
                if target is not None:
                    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", target)
                    time.sleep(0.4)
                    try:
                        target.click()
                    except Exception:
                        driver.execute_script("arguments[0].click();", target)
                    log(f"  Clicked login Verify button (#btnClick) on attempt {attempt+1}.")
                    clicked_verify = True
                    time.sleep(2.5)
                    break
            except Exception:
                pass
            time.sleep(1.5)  # button may render a moment after reCAPTCHA clears

        if not clicked_verify:
            log("  Verify button (#btnClick) not found after solving reCAPTCHA.")

        return True

    except Exception as e:
        log(f"  reCAPTCHA solver error: {e}")
        try:
            driver.switch_to.default_content()
        except Exception:
            pass
        return False


def try_auto_click_human_verification(driver, log=print):
    """Route to correct verification handler. CF checked FIRST."""

    # A. Cloudflare Turnstile — ALWAYS check before reCAPTCHA.
    # VidaPay keeps reCAPTCHA anchor iframes in the DOM at all times,
    # so checking reCAPTCHA first always matches even on CF-only pages.
    is_cf = driver.execute_script("""
        if (document.querySelector('#BbLB6'))                                   return true;
        if (document.querySelector('#challenge-stage'))                         return true;
        if (document.querySelector('.cf-turnstile'))                            return true;
        if (document.querySelector('[class*="turnstile"]'))                     return true;
        if (document.querySelector('iframe[src*="challenges.cloudflare.com"]')) return true;
        if (document.querySelector('iframe[src*="turnstile"]'))                 return true;
        if (document.querySelector('#branding'))                                return true;
        if (document.querySelector('input[type="checkbox"]'))                   return true;
        // Turnstile always injects a hidden response input in the MAIN DOM even when
        // the iframe sits inside a closed shadow root (unreachable by querySelector).
        if (document.querySelector('[name="cf-turnstile-response"]'))           return true;
        if (document.querySelector('input[id*="cf-chl-widget"]'))               return true;
        const bt = (document.body.innerText || '').toLowerCase();
        if (bt.includes('performing security verification'))                     return true;
        if (bt.includes('just a moment') &&
            document.title.toLowerCase().includes('just a moment'))             return true;
        return false;
    """)
    if is_cf:
        log("Cloudflare challenge detected — CDP trusted click (screen-free).")
        return _cdp_click_turnstile(driver, log=log)

    # B. reCAPTCHA — only if CF is definitively absent
    for sel in ["iframe[src*='recaptcha/api2/anchor']",
                "iframe[src*='recaptcha/enterprise/anchor']",
                "iframe[title*='reCAPTCHA']",
                "iframe[title*='not a robot']"]:
        try:
            if driver.find_element(By.CSS_SELECTOR, sel):
                log("reCAPTCHA detected — running audio solver.")
                return try_solve_recaptcha(driver, log=log)
        except Exception:
            pass

    # C. VidaPay login Verify button (#btnClick) with no active CAPTCHA
    try:
        btn = driver.find_element(By.ID, "btnClick")
        if btn.is_displayed():
            btn.click()
            log("  Clicked #btnClick.")
            time.sleep(2)
            return True
    except Exception:
        pass

    return False


def wait_for_human_verification_clear(driver, stop_event=None, timeout=HUMAN_VERIFY_WAIT_SECONDS, log=print, context=""):
    if not is_human_verification_page(driver):
        return True

    label = f" during {context}" if context else ""
    log(f"Human verification detected{label}.")

    # ── Managed-challenge interstitial ("Performing security verification" /
    # "Just a moment...") resolves itself automatically via Cloudflare's own
    # JS after a short delay — no click is needed or possible for this page.
    # Detect it and just wait before attempting any click strategy.
    try:
        is_managed = driver.execute_script("""
            const t = (document.body.innerText || '').toLowerCase();
            return t.includes('performing security verification') ||
                   t.includes('just a moment') ||
                   document.title.toLowerCase().includes('just a moment');
        """)
    except Exception:
        is_managed = False

    if is_managed:
        log("  Managed challenge interstitial detected — waiting up to 15s for auto-resolve...")
        for _w in range(15):
            time.sleep(1)
            if not is_human_verification_page(driver):
                log("  Managed challenge resolved automatically. Continuing.")
                try:
                    wait_for_body(driver, timeout=15)
                except Exception:
                    pass
                return True
        log("  Managed challenge still present after 15s — proceeding to click strategies.")

    MAX_CYCLES = 3

    for cycle in range(1, MAX_CYCLES + 1):
        if stop_event is not None and stop_event.is_set():
            return False

        log(f"  Cycle {cycle}/{MAX_CYCLES}...")
        clicked = try_auto_click_human_verification(driver, log=log)

        if clicked:
            log(f"  Click delivered — waiting up to 10s for page to clear...")
            for _w in range(10):
                time.sleep(1)
                if not is_human_verification_page(driver):
                    log("  Verification cleared. Continuing.")
                    try:
                        wait_for_body(driver, timeout=15)
                    except Exception:
                        pass
                    return True
            log(f"  Cycle {cycle}: still showing verification after click.")
        else:
            log(f"  Cycle {cycle}: could not deliver click.")

        if cycle < MAX_CYCLES:
            log(f"  Waiting 5s before retry {cycle + 1}...")
            for _i in range(5):
                if stop_event is not None and stop_event.is_set():
                    return False
                time.sleep(1)
            if not is_human_verification_page(driver):
                log("  Verification cleared between retries. Continuing.")
                try:
                    wait_for_body(driver, timeout=15)
                except Exception:
                    pass
                return True

    log("Human verification did not clear automatically.")
    # -- Grace period: beep + wait for a manual solve instead of failing fast --
    # The automation may run on a second screen while the user works elsewhere;
    # give them a chance to solve the challenge by hand before giving up.
    try:
        import winsound
        for _b in range(3):
            winsound.Beep(1200, 300)
            time.sleep(0.25)
        log("  Beeped 3x - waiting up to 120s for a manual solve...")
    except Exception:
        log("  Waiting up to 120s for a manual solve...")
    _cleared_manually = False
    for _g in range(60):  # 60 x 2s = 120s
        if stop_event is not None and stop_event.is_set():
            return False
        time.sleep(2)
        if not is_human_verification_page(driver):
            _cleared_manually = True
            break
        if _g in (7, 22, 37, 52):
            log("  Still waiting for manual solve...")
    if _cleared_manually:
        log("  Verification cleared manually. Continuing.")
        try:
            wait_for_body(driver, timeout=15)
        except Exception:
            pass
        return True
    log("  No manual solve within 120s. Stopping this store.")
    return False




# =========================================================
# WHATSAPP 2FA ALERTS
# =========================================================

def _wa_win32_key_down(vk_code):
    import ctypes
    ctypes.windll.user32.keybd_event(vk_code, 0, 0, 0)


def _wa_win32_key_up(vk_code):
    import ctypes
    ctypes.windll.user32.keybd_event(vk_code, 0, 0x0002, 0)


def _wa_win32_hotkey(*keys):
    codes = []
    for k in keys:
        k_lower = k.lower()
        if k_lower in _WA_VK_MAP:
            codes.append(_WA_VK_MAP[k_lower])
        elif len(k) == 1:
            codes.append(ord(k.upper()))
        else:
            return
    for code in codes:
        _wa_win32_key_down(code)
    for code in reversed(codes):
        _wa_win32_key_up(code)


def _wa_win32_press(key):
    k_lower = key.lower()
    if k_lower in _WA_VK_MAP:
        code = _WA_VK_MAP[k_lower]
    elif len(key) == 1:
        code = ord(key.upper())
    else:
        return
    _wa_win32_key_down(code)
    _wa_win32_key_up(code)


def _wa_win32_write(text, interval=0.0):
    import ctypes
    for char in text:
        vk = ctypes.windll.user32.VkKeyScanW(ord(char))
        if vk == -1:
            continue
        code = vk & 0xFF
        shift = (vk >> 8) & 1
        if shift:
            _wa_win32_key_down(_WA_VK_MAP["shift"])
        _wa_win32_key_down(code)
        _wa_win32_key_up(code)
        if shift:
            _wa_win32_key_up(_WA_VK_MAP["shift"])
        if interval > 0:
            import time as _t
            _t.sleep(interval)


def _wa_find_hwnd():
    """Return the HWND of the first visible WhatsApp Desktop window, or None."""
    try:
        import win32gui
        found = []

        def _cb(hwnd, _):
            if win32gui.IsWindowVisible(hwnd) and "WhatsApp" in (win32gui.GetWindowText(hwnd) or ""):
                found.append(hwnd)
        win32gui.EnumWindows(_cb, None)
        return found[0] if found else None
    except Exception:
        return None


def _wa_focus_hwnd(hwnd):
    """Bring WhatsApp to foreground WITHOUT moving or resizing the window.

    Uses AttachThreadInput + BringWindowToTop instead of SetForegroundWindow,
    which is the only reliable way to bring a window to front on multi-monitor
    setups without Windows internally calling SetWindowPos and moving it.
    """
    try:
        import ctypes

        user32   = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        # Save placement so we can detect if it was minimised
        class _POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
        class _RECT(ctypes.Structure):
            _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                        ("right", ctypes.c_long), ("bottom", ctypes.c_long)]
        class _WINDOWPLACEMENT(ctypes.Structure):
            _fields_ = [
                ("length",           ctypes.c_uint),
                ("flags",            ctypes.c_uint),
                ("showCmd",          ctypes.c_uint),
                ("ptMinPosition",    _POINT),
                ("ptMaxPosition",    _POINT),
                ("rcNormalPosition", _RECT),
            ]

        wp = _WINDOWPLACEMENT()
        wp.length = ctypes.sizeof(_WINDOWPLACEMENT)
        user32.GetWindowPlacement(hwnd, ctypes.byref(wp))

        # If minimised, restore IN-PLACE using SW_SHOWNOACTIVATE (4)
        # This un-minimises WITHOUT activating or changing position
        if wp.showCmd in (2, 6, 7):   # minimised variants
            user32.ShowWindow(hwnd, 4)   # SW_SHOWNOACTIVATE
            import time as _t; _t.sleep(0.25)

        # Attach to the foreground thread so we can steal focus legitimately
        fg_hwnd      = user32.GetForegroundWindow()
        fg_thread    = user32.GetWindowThreadProcessId(fg_hwnd, None)
        our_thread   = kernel32.GetCurrentThreadId()
        wa_thread    = user32.GetWindowThreadProcessId(hwnd, None)

        user32.AttachThreadInput(fg_thread, our_thread, True)
        user32.AttachThreadInput(fg_thread, wa_thread,  True)

        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)  # activate WITHOUT moving/resizing
        user32.SetFocus(hwnd)

        user32.AttachThreadInput(fg_thread, our_thread, False)
        user32.AttachThreadInput(fg_thread, wa_thread,  False)

        import time as _t; _t.sleep(0.3)

    except Exception:
        pass


def _wa_launch():
    """Try multiple methods to open WhatsApp Desktop."""
    import subprocess as _sp
    launch_cmds = [
        ["explorer.exe", "whatsapp:"],
        "start whatsapp:",
        r'explorer.exe "shell:AppsFolder\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"',
    ]
    for cmd in launch_cmds:
        try:
            if isinstance(cmd, list):
                _sp.Popen(cmd, shell=False)
            else:
                _sp.Popen(cmd, shell=True)
            return
        except Exception:
            continue


def send_whatsapp_2fa_alert(log=print, driver=None):
    """Send a '2FA' alert via WhatsApp Desktop (pyautogui) or WhatsApp Web
    (browser tab), depending on the _WA_MODE global set in the UI."""
    if _WA_MODE == "web":
        return _send_whatsapp_web_alert(log=log, driver=driver)
    return _send_whatsapp_desktop_alert(log=log)


def _send_whatsapp_web_alert(log=print, driver=None):
    """Send '2FA' via WhatsApp Web opened in a new browser tab."""
    if not (_WA_GROUP_NAME or "").strip():
        log("No WhatsApp group configured — skipping 2FA alert.")
        return False
    if driver is None:
        log("No browser driver available for WhatsApp Web — skipping.")
        return False
    import time as _t
    try:
        import urllib.parse
        group_encoded = urllib.parse.quote(_WA_GROUP_NAME)
        # Open WhatsApp Web in a new tab
        driver.execute_script("window.open('https://web.whatsapp.com', '_blank');")
        _t.sleep(4)
        driver.switch_to.window(driver.window_handles[-1])
        _t.sleep(3)
        log("WhatsApp Web opened — searching for group...")
        # Use the search box
        from selenium.webdriver.common.by import By
        from selenium.webdriver.common.keys import Keys
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
        wait = WebDriverWait(driver, 20)
        search = wait.until(EC.element_to_be_clickable(
            (By.XPATH, "//div[@contenteditable='true'][@data-tab='3']")))
        search.click()
        _t.sleep(0.5)
        search.send_keys(_WA_GROUP_NAME)
        _t.sleep(2)
        search.send_keys(Keys.ENTER)
        _t.sleep(1.5)
        # Type message in chat input
        chat_input = wait.until(EC.element_to_be_clickable(
            (By.XPATH, "//div[@contenteditable='true'][@data-tab='10']")))
        chat_input.click()
        chat_input.send_keys("2FA")
        _t.sleep(0.5)
        chat_input.send_keys(Keys.ENTER)
        _t.sleep(1)
        log(f"WhatsApp Web 2FA alert sent to '{_WA_GROUP_NAME}' group.")
        return True
    except Exception as exc:
        log(f"WhatsApp Web alert error: {exc}")
        return False


def _send_whatsapp_desktop_alert(log=print):
    """Search for the configured WhatsApp group in WhatsApp Desktop and send '2FA'.

    Uses a confirmed-working desktop automation pattern:
    - activate window via _wa_focus_hwnd (no repositioning, no SW_RESTORE)
    - Ctrl+F → ctrl+a → write(group_name) → Enter to open chat
    - pyperclip.copy + ctrl+v to paste message text
    - Never uses Escape, Tab, pixel clicks, or PowerShell clipboard
    """
    if not _WA_AVAILABLE:
        log("pyautogui not installed – WhatsApp 2FA alert skipped.")
        return False

    # Gate BEFORE any window interaction — an empty group field must never
    # launch, focus, or send keystrokes to WhatsApp.
    if not (_WA_GROUP_NAME or "").strip():
        log("No WhatsApp group configured — skipping 2FA alert.")
        return False

    import time as _t

    # Ensure pyperclip is available for reliable text paste
    try:
        import pyperclip as _pyperclip
    except ImportError:
        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "pyperclip", "--quiet",
                 "--disable-pip-version-check"],
                capture_output=True, timeout=60,
            )
            import pyperclip as _pyperclip
        except Exception:
            _pyperclip = None

    try:
        # ── Open / focus WhatsApp without repositioning ───────────────────────
        hwnd = _wa_find_hwnd()
        if hwnd is None:
            log("WhatsApp Desktop not open — launching...")
            _wa_launch()
            _t.sleep(5)

        # Layout-safe focus: never SW_RESTORE / restore() a snapped or
        # maximised window — that visibly changes its layout. Focus goes
        # through _wa_focus_hwnd, which un-minimises IN PLACE only when
        # actually minimised and then foregrounds the window without
        # touching its placement.
        if hwnd is None:
            log("WhatsApp Desktop window not found — skipping alert.")
            return False
        _wa_focus_hwnd(hwnd)
        log("WhatsApp Desktop focused (window layout untouched).")

        _t.sleep(1.0)

        # ── Search for group — exact Inventory Audit pattern ──────────────────
        # Ctrl+F opens search, ctrl+a clears it, write types the name, Enter opens
        _wa_hotkey("ctrl", "f")
        _t.sleep(0.7)
        _wa_hotkey("ctrl", "a")
        _t.sleep(0.2)
        _wa_write(_WA_GROUP_NAME, interval=0.05)
        _t.sleep(1.2)
        _wa_press("enter")
        _t.sleep(1.5)

        # ── Paste "2FA" and send ──────────────────────────────────────────────
        if _pyperclip is not None:
            _pyperclip.copy("2FA")
            _wa_hotkey("ctrl", "v")
        else:
            _wa_write("2FA", interval=0.1)

        _t.sleep(0.7)
        _wa_press("enter")
        _t.sleep(1.0)

        log(f"WhatsApp 2FA alert sent to '{_WA_GROUP_NAME}' group.")
        return True

    except Exception as exc:
        log(f"WhatsApp 2FA alert error: {exc}")
        return False





_WA_GROUP_NAME = _vp_get("whatsapp_group", "")


_WA_MODE = _vp_get("whatsapp_mode", "desktop")  # "desktop" or "web"


_wa_hotkey = _wa_win32_hotkey


_wa_press = _wa_win32_press


_wa_write = _wa_win32_write




# =========================================================
# 2FA (IBM VERIFY) / TRUST DEVICE SETUP FLOW
# =========================================================

def wait_for_ibm_verify_approval(driver, stop_event, timeout=IBM_VERIFY_WAIT_SECONDS, log=print):
    log("Checking current page before waiting for IBM Verify.")

    end_time = None if timeout is None or timeout <= 0 else time.time() + timeout
    last_log = 0
    last_state = None
    _2fa_alert_sent = False

    while end_time is None or time.time() < end_time:
        if stop_event.is_set():
            return False

        state = get_page_state(driver)

        if state != last_state:
            log_current_page_state(driver, log=log, prefix="Detected page")
            last_state = state

        # Fire WhatsApp 2FA alert once when any 2FA page is first detected
        # (covers both IBM_VERIFY and TRUST_DEVICE flows)
        if state in (PAGE_STATE_IBM_VERIFY, PAGE_STATE_TRUST_DEVICE) and not _2fa_alert_sent:
            _2fa_alert_sent = True
            threading.Thread(
                target=send_whatsapp_2fa_alert,
                args=(log,),
                daemon=True,
            ).start()

        if state == PAGE_STATE_HUMAN_VERIFY:
            if not wait_for_human_verification_clear(driver, stop_event=stop_event, log=log, context="login"):
                return False
            last_state = None
            continue

        if state in TERMINAL_LOGIN_STATES:
            log("Login is already past IBM Verify. Continuing.")
            return state

        if state == PAGE_STATE_NEW_SIGN_IN:
            if not click_new_sign_in_next(driver, log=log):
                return False
            last_state = None
            continue

        if state == PAGE_STATE_TRUST_DEVICE:
            log("Trust Device HTML controls detected. Continuing without waiting for visual radio state.")
            return PAGE_STATE_TRUST_DEVICE

        if state in (PAGE_STATE_TRUST_THIS_DEVICE, PAGE_STATE_READY_TO_GO, PAGE_STATE_SECURITY_UPGRADE, PAGE_STATE_SETUP_NEXT):
            log("Login is already in setup flow. Continuing setup.")
            return state

        now = time.time()

        if now - last_log >= 8:
            if state == PAGE_STATE_IBM_VERIFY and is_send_info_visible(driver):
                log("2FA page detected. Waiting for Trust Device HTML controls or portal redirect...")
            elif state == PAGE_STATE_IBM_VERIFY:
                log("2-Factor Authentication page detected. Waiting for Trust Device HTML controls...")
            elif state == PAGE_STATE_LOGIN:
                log("Still on login page after sign in. Waiting for next page...")
            else:
                log("Waiting. Page state not confirmed yet...")

            last_log = now

        time.sleep(0.5)

    log("IBM Verify approval wait ended before Trust Device was available.")
    log_current_page_state(driver, log=log, prefix="Timed out on page")
    return False


def wait_for_two_factor_check_card(driver, timeout=90, log=print):
    log("Waiting for 2FA Trust Device HTML controls...")

    end_time = time.time() + timeout
    last_state = None

    while time.time() < end_time:
        state = get_page_state(driver)

        if state != last_state:
            log_current_page_state(driver, log=log, prefix="2FA trust check")
            last_state = state

        if state == PAGE_STATE_HUMAN_VERIFY:
            if not wait_for_human_verification_clear(driver, log=log, context="2FA trust check"):
                return False
            last_state = None
            continue

        if state == PAGE_STATE_TRUST_DEVICE:
            log("2FA Trust Device HTML controls detected.")
            return PAGE_STATE_TRUST_DEVICE

        if state in TERMINAL_LOGIN_STATES:
            log("Already past 2FA trust device screen. Continuing.")
            return state

        if state in (PAGE_STATE_TRUST_THIS_DEVICE, PAGE_STATE_READY_TO_GO, PAGE_STATE_SECURITY_UPGRADE, PAGE_STATE_SETUP_NEXT):
            log("Already past Trust Device radio. Continuing setup flow.")
            return state

        time.sleep(0.5)

    log("2FA Trust Device HTML controls not detected.")
    log_current_page_state(driver, log=log, prefix="Timed out on page")
    return False


def wait_for_two_factor_to_clear(driver, timeout=90, log=print):
    log("Waiting for 2FA screen to clear...")

    end_time = time.time() + timeout

    while time.time() < end_time:
        state = get_page_state(driver)

        if state in TERMINAL_LOGIN_STATES:
            log("2FA cleared. Portal or alerts page loaded.")
            return True

        if state not in (PAGE_STATE_IBM_VERIFY, PAGE_STATE_TRUST_DEVICE, PAGE_STATE_TRUST_THIS_DEVICE, PAGE_STATE_READY_TO_GO, PAGE_STATE_SECURITY_UPGRADE, PAGE_STATE_SETUP_NEXT):
            if not is_two_factor_container_present(driver):
                log("2FA screen cleared.")
                return True

        time.sleep(1)

    log("2FA screen did not clear in time.")
    log_current_page_state(driver, log=log, prefix="Timed out on page")
    return False


def handle_ibm_verify_and_setup(driver, stop_event, log=print):
    initial_state = log_current_page_state(driver, log=log, prefix="After login page")

    if initial_state in TERMINAL_LOGIN_STATES:
        log("No IBM Verify action required. Already inside portal flow.")
        return initial_state

    if initial_state == PAGE_STATE_NEW_SIGN_IN or get_current_url_lower(driver).find("twofactornewdevicesignin") >= 0:
        if not click_new_sign_in_next(driver, log=log):
            return False

    result = wait_for_ibm_verify_approval(
        driver,
        stop_event=stop_event,
        timeout=None,
        log=log,
    )

    return result


def click_setup_next_button(driver, label, log=print, timeout=25):
    return click_matching_button_js(
        driver,
        label=label,
        text_contains="next",
        button_id="setupNextBtn",
        timeout=timeout,
        log=log,
    )


def has_visible_setup_next_button(driver):
    return has_any_setup_next_button(driver)


def wait_for_setup_next_or_terminal(driver, stop_event, step_name, timeout=90, log=print):
    log(f"Waiting for {step_name}...")

    wanted = (
        PAGE_STATE_TRUST_THIS_DEVICE,
        PAGE_STATE_READY_TO_GO,
        PAGE_STATE_SECURITY_UPGRADE,
        PAGE_STATE_SETUP_NEXT,
        PAGE_STATE_TRUST_DEVICE,
        PAGE_STATE_ALERTS,
        PAGE_STATE_PORTAL,
    )

    return wait_for_state(
        driver,
        stop_event=stop_event,
        wanted_states=wanted,
        timeout=timeout,
        log=log,
        prefix=f"{step_name} check",
    )


def wait_for_alerts_or_portal_after_final_next(driver, stop_event, timeout=90, log=print):
    log("Waiting for Alerts or Portal after Ready To Go Continue...")

    result = wait_for_state(
        driver,
        stop_event=stop_event,
        wanted_states=TERMINAL_LOGIN_STATES,
        timeout=timeout,
        log=log,
        prefix="After Ready To Go Continue",
    )

    if result in TERMINAL_LOGIN_STATES:
        log("Ready To Go flow completed. Alerts or portal page loaded.")
        return True

    return False


def complete_remaining_setup_next_flow(driver, stop_event, max_next_clicks=5, log=print):
    steps_done = 0

    while steps_done < max_next_clicks:
        if stop_event.is_set():
            return False

        state = get_page_state(driver)
        log_current_page_state(driver, log=log, prefix="Setup flow page")

        if state == PAGE_STATE_HUMAN_VERIFY:
            if not wait_for_human_verification_clear(driver, stop_event=stop_event, log=log, context="setup flow"):
                return False
            continue

        if state in TERMINAL_LOGIN_STATES:
            log("Setup flow completed. Portal or alerts page loaded.")
            return True

        if state == PAGE_STATE_SECURITY_UPGRADE:
            log("Important Upgrade Security page detected. Not clicking its Next button because it can throw error=io without a selected option.")
            log("Waiting for Ready To Go, Alerts, or Portal instead.")
            wait_state = wait_for_state(
                driver,
                stop_event=stop_event,
                wanted_states=(PAGE_STATE_READY_TO_GO, PAGE_STATE_ALERTS, PAGE_STATE_PORTAL),
                timeout=20,
                log=log,
                prefix="Security upgrade wait",
            )

            if wait_state == PAGE_STATE_READY_TO_GO:
                continue

            if wait_state in TERMINAL_LOGIN_STATES:
                return True

            log("Security upgrade page did not advance safely. Manual review needed for this store.")
            return False

        if state == PAGE_STATE_TRUST_DEVICE:
            if not select_trust_radio_quickly(driver, timeout=None, stop_event=stop_event, log=log):
                return False

            if not click_trust_device_next(driver, log=log):
                return False

            steps_done += 1
            continue

        if state in (PAGE_STATE_TRUST_THIS_DEVICE, PAGE_STATE_SETUP_NEXT):
            if not click_trust_this_device_next(driver, log=log):
                state_after_failed_click = get_page_state(driver)

                if state_after_failed_click in TERMINAL_LOGIN_STATES:
                    log("Portal or alerts page loaded before Trust This Device Next click. Continuing.")
                    return True

                if state_after_failed_click == PAGE_STATE_READY_TO_GO:
                    continue

                return False

            steps_done += 1
            time.sleep(1)
            continue

        if state == PAGE_STATE_READY_TO_GO:
            if not click_ready_to_go_continue(driver, log=log):
                return False

            return wait_for_alerts_or_portal_after_final_next(
                driver,
                stop_event=stop_event,
                timeout=90,
                log=log,
            )

        wait_state = wait_for_setup_next_or_terminal(
            driver,
            stop_event=stop_event,
            step_name="next setup step",
            timeout=45,
            log=log,
        )

        if not wait_state:
            log("No more setup pages were found, and portal/alerts did not load.")
            return False

        if wait_state in TERMINAL_LOGIN_STATES:
            log("Setup flow completed. Portal or alerts page loaded.")
            return True

        steps_done += 1

    log(f"Setup flow reached safety limit after {max_next_clicks} setup action(s).")
    log_current_page_state(driver, log=log, prefix="Setup safety-limit page")
    return get_page_state(driver) in TERMINAL_LOGIN_STATES


def finish_setup_steps(driver, stop_event, account_id, log=print):
    state = log_current_page_state(driver, log=log, prefix="Before Trust Device handling")

    if state in TERMINAL_LOGIN_STATES:
        log("Already past Trust Device. Skipping Trust Device setup steps.")
        return True

    log("Finishing 2FA setup steps using h3 and HTML locations.")

    if state == PAGE_STATE_NEW_SIGN_IN:
        if not click_new_sign_in_next(driver, log=log):
            return False
        state = wait_for_ibm_verify_approval(driver, stop_event=stop_event, timeout=None, log=log)

    if state == PAGE_STATE_IBM_VERIFY:
        state = wait_for_ibm_verify_approval(driver, stop_event=stop_event, timeout=None, log=log)

    if state in TERMINAL_LOGIN_STATES:
        return True

    if state == PAGE_STATE_TRUST_DEVICE:
        if not select_trust_radio_quickly(driver, timeout=None, stop_event=stop_event, log=log):
            return False

        if not click_trust_device_next(driver, log=log):
            state_after_failed_click = get_page_state(driver)

            if state_after_failed_click in TERMINAL_LOGIN_STATES:
                log("Portal or alerts page loaded before 2FA Trust Device Next click. Continuing.")
                return True

            log("2FA Trust Device Next was not clicked.")
            return False

        time.sleep(1)

    return complete_remaining_setup_next_flow(
        driver,
        stop_event=stop_event,
        max_next_clicks=6,
        log=log,
    )


def get_later_locators():
    return [
        (By.XPATH, "//button[normalize-space()='Later']"),
        (By.XPATH, "//button[contains(normalize-space(),'Later')]"),
        (By.XPATH, "//button[.//text()[normalize-space()='Later']]"),
        (By.XPATH, "//button[.//*[normalize-space()='Later']]"),
        (By.XPATH, "//a[normalize-space()='Later']"),
        (By.XPATH, "//a[contains(normalize-space(),'Later')]"),
        (By.XPATH, "//*[@role='button' and normalize-space()='Later']"),
        (By.XPATH, "//*[@role='button' and contains(normalize-space(),'Later')]"),
        (By.XPATH, "//*[self::button or self::a or @role='button'][contains(normalize-space(), 'Later')]"),
    ]


def find_visible_later_buttons(driver):
    visible_buttons = []

    for locator in get_later_locators():
        try:
            buttons = driver.find_elements(*locator)

            for button in buttons:
                try:
                    if button.is_displayed() or js_is_displayed(driver, button):
                        if button not in visible_buttons:
                            visible_buttons.append(button)
                except Exception:
                    continue

        except Exception:
            continue

    return visible_buttons


def click_later_once(driver, log=print):
    buttons = find_visible_later_buttons(driver)

    if not buttons:
        return False

    button = buttons[0]

    try:
        driver.execute_script(
            "arguments[0].scrollIntoView({block: 'center'});",
            button
        )

        time.sleep(0.3)

        try:
            button.click()
        except Exception:
            driver.execute_script("arguments[0].click();", button)

        log("Clicked Later")
        time.sleep(1.0)
        return True

    except Exception as e:
        log(f"Later click failed once: {e}")
        return False


def clear_all_later_alerts(driver, log=print):
    log("Clearing all visible Later alerts...")

    clicked_count = 0
    max_clicks = 12
    no_button_rounds = 0

    while clicked_count < max_clicks:
        buttons = find_visible_later_buttons(driver)

        if not buttons:
            no_button_rounds += 1

            if no_button_rounds >= 2:
                break

            time.sleep(0.5)
            continue

        no_button_rounds = 0

        clicked = click_later_once(driver, log=log)

        if clicked:
            clicked_count += 1
        else:
            break

    if clicked_count == 0:
        log("No Later button found. Moving ahead.")
    else:
        log(f"Later alerts cleared. Clicked {clicked_count} Later button(s).")

    return clicked_count


def clear_initial_later_alerts_once(driver, log=print):
    log("Initial alerts/Later check. This is the only Later-clearing pass for this store.")
    clicked_count = clear_all_later_alerts(driver, log=log)
    log("Later clearing is now disabled for page navigation in this store run.")
    return clicked_count




# =========================================================
# TSP VERIFICATION / PORTAL READINESS
# =========================================================

def is_store_tsp_visible(driver, account_id):
    if not account_id:
        return False

    if is_two_factor_container_present(driver):
        return False

    locators = [
        (By.XPATH, f"//span[contains(@class,'pr-2') and contains(@class,'font-semibold') and normalize-space()='{account_id}']"),
        (By.XPATH, f"//span[contains(@class,'font-semibold') and normalize-space()='{account_id}']"),
        (By.XPATH, f"//*[normalize-space()='{account_id}']"),
    ]

    for locator in locators:
        try:
            elements = driver.find_elements(*locator)

            for element in elements:
                if element.is_displayed() or js_is_displayed(driver, element):
                    return True

        except Exception:
            continue

    return False


def wait_for_store_tsp(driver, account_id, timeout=20, log=print):
    end_time = time.time() + timeout

    while time.time() < end_time:
        if is_store_tsp_visible(driver, account_id):
            log(f"TSP ID confirmed: {account_id}")
            return True

        time.sleep(0.5)

    log(f"TSP ID not confirmed: {account_id}")
    return False


def get_visible_font_semibold_texts(driver):
    """
    Reads visible values from spans such as:
    <span class="font-semibold">000000 </span>
    Returns cleaned visible text values.
    """
    values = []

    try:
        js_values = driver.execute_script(
            """
            const nodes = Array.from(document.querySelectorAll('span.font-semibold, span[class*="font-semibold"]'));

            function visible(el) {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    rect.width > 0 &&
                    rect.height > 0 &&
                    el.getClientRects().length > 0
                );
            }

            return nodes
                .filter(visible)
                .map(el => (el.innerText || el.textContent || '').trim())
                .filter(Boolean);
            """
        )

        if isinstance(js_values, list):
            for value in js_values:
                clean_value = " ".join(str(value).split()).strip()
                if clean_value and clean_value not in values:
                    values.append(clean_value)
    except Exception:
        pass

    try:
        spans = driver.find_elements(By.XPATH, "//span[contains(concat(' ', normalize-space(@class), ' '), ' font-semibold ')]")

        for span in spans:
            try:
                if span.is_displayed() or js_is_displayed(driver, span):
                    clean_value = " ".join(span.text.split()).strip()
                    if clean_value and clean_value not in values:
                        values.append(clean_value)
            except Exception:
                continue
    except Exception:
        pass

    return values


def normalize_tsp_text(value):
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def verify_logged_in_tsp_id(driver, account_id, timeout=25, log=print, context="current page"):
    """
    MATCH: expected account_id is visible in span.font-semibold.
    MISMATCH: another numeric font-semibold value is visible.
    MISSING: no usable TSP value became visible before timeout.
    """
    expected = normalize_tsp_text(account_id)
    end_time = time.time() + timeout
    last_seen_values = []
    wait_logged = False

    while time.time() < end_time:
        values = get_visible_font_semibold_texts(driver)
        normalized_values = [normalize_tsp_text(value) for value in values]
        normalized_values = [value for value in normalized_values if value]

        if expected and expected in normalized_values:
            log(f"TSP ID matched on {context}: {account_id}")
            return "MATCH"

        numeric_candidates = [value for value in normalized_values if value.isdigit() and len(value) >= 5]

        if numeric_candidates and expected not in numeric_candidates:
            found = ", ".join(sorted(set(numeric_candidates)))
            log(f"TSP ID mismatch on {context}. Expected {account_id}; found {found}.")
            return "MISMATCH"

        if values != last_seen_values:
            last_seen_values = values
            if values:
                log(f"TSP check on {context}. Visible font-semibold values: {', '.join(values)}")

        if not wait_logged:
            log(f"Waiting up to {int(timeout)}s for TSP ID {account_id} on {context} "
                "(soft check — filing continues if the panel shows no ID)...")
            wait_logged = True

        time.sleep(0.5)

    values = get_visible_font_semibold_texts(driver)
    if values:
        log(f"TSP ID missing on {context}. Expected {account_id}; visible values: {', '.join(values)}")
    else:
        log(f"TSP ID missing on {context}. Expected {account_id}; no visible font-semibold TSP span found.")

    return "MISSING"


def clear_session_for_tsp_retry(driver, log=print):
    log("Clearing cookies/cache because TSP ID did not match the selected store.")
    reset_browser_session(driver, log=log)

    try:
        open_url_in_edge_tab(driver, "about:blank", timeout=10, log=log)
    except Exception:
        pass


def wait_for_portal_or_alerts_ready(driver, timeout=30, log=print):
    end_time = time.time() + timeout
    last_state = None

    while time.time() < end_time:
        state = get_page_state(driver)

        if state != last_state:
            log_current_page_state(driver, log=log, prefix="Portal readiness check")
            last_state = state

        if state in (PAGE_STATE_ALERTS, PAGE_STATE_PORTAL):
            return True

        time.sleep(1)

    log("Portal or alerts page not confirmed in time.")
    return False




# =========================================================
# REBATE / APPEAL FILING ENGINE
# =========================================================

CLAIM_STATUS_PENDING = "Pending"
CLAIM_STATUS_RUNNING = "Running"
CLAIM_STATUS_SUBMITTED = "Submitted"
CLAIM_STATUS_FAILED = "Failed"
CLAIM_STATUS_UNKNOWN = "Unknown"
CLAIM_STATUS_STOPPED = "Stopped"


def get_visible_element(driver, locator, timeout=15):
    return WebDriverWait(driver, timeout).until(
        EC.visibility_of_element_located(locator)
    )


def appeal_form_is_open(driver):
    """True when the appeal form (IMEI field) is already visible on screen."""
    try:
        elements = driver.find_elements(By.CSS_SELECTOR, "input[name='imei']")
        for element in elements:
            if element.is_displayed() or js_is_displayed(driver, element):
                return True
    except Exception:
        pass
    return False


def appeal_mode_picker_visible(driver):
    """True when the appeal dialog's mode picker ('IMEI and Activation
    Date' option) is on screen — the step between 'Create an appeal' and
    the IMEI form itself."""
    try:
        for element in driver.find_elements(
            By.XPATH, "//*[normalize-space()='IMEI and Activation Date']"
        ):
            try:
                if element.is_displayed() or js_is_displayed(driver, element):
                    return True
            except Exception:
                continue
    except Exception:
        pass
    return False


def click_month_to_date_button(driver, log=print, timeout=10):
    """Clicks the 'Month-to-Date' filter pill on the Activations &
    Commissions page:

        <button type="submit" class=" rounded-l-md border-2 ... hover:bg-secondary">
            Month-to-Date
        </button>

    The pill is a submit button whose visible text is exactly
    'Month-to-Date'. Some dashboard states only render the
    'Create an appeal' control after this filter round-trips."""
    locators = [
        (By.XPATH, "//button[normalize-space()='Month-to-Date']"),
        (By.XPATH, "//button[contains(normalize-space(),'Month-to-Date')]"),
        (By.XPATH, "//button[@type='submit' and contains(normalize-space(),'Month-to-Date')]"),
        (By.XPATH, "//*[contains(normalize-space(),'Month-to-Date')]"),
    ]

    # Fast probe first: find_elements returns instantly, so a page without
    # the pill skips four full-timeout safe_click waits.
    matched = None
    try:
        for locator in locators:
            for element in driver.find_elements(*locator):
                try:
                    if element.is_displayed() or js_is_displayed(driver, element):
                        matched = locator
                        break
                except Exception:
                    continue
            if matched:
                break
    except Exception:
        matched = None

    try:
        safe_click(
            driver,
            matched or locators[0],
            timeout=timeout if matched else 4,
            name="Month-to-Date",
            log=log,
        )
        time.sleep(1.5)
        return True
    except Exception:
        pass

    log("'Month-to-Date' button not found.")
    return False


def click_create_an_appeal(driver, log=print, timeout=WAIT_SECONDS):
    if appeal_form_is_open(driver):
        log("Appeal form is already open. Skipping the Create an appeal click.")
        return True

    locators = [
        (By.XPATH, "//span[normalize-space()='Create an appeal']"),
        (By.XPATH, "//button[normalize-space()='Create an appeal']"),
        (By.XPATH, "//*[normalize-space()='Create an appeal']"),
        (By.XPATH, "//span[contains(normalize-space(),'Create an appeal')]"),
        (By.XPATH, "//button[contains(normalize-space(),'Create an appeal')]"),
    ]

    for locator in locators:
        try:
            safe_click(driver, locator, timeout=timeout, name="Create an appeal", log=log)
            return True
        except Exception:
            continue

    # Fallback: some dashboard states don't render "Create an appeal" until
    # the Month-to-Date (MTD) pill submits the reporting filter and re-renders
    # the page. Click MTD, then retry the Create-an-appeal click.
    log("'Create an appeal' not found — clicking Month-to-Date (MTD) first, then retrying...")
    if click_month_to_date_button(driver, log=log, timeout=timeout):
        time.sleep(2)
        for locator in locators:
            try:
                safe_click(driver, locator, timeout=timeout, name="Create an appeal", log=log)
                return True
            except Exception:
                continue

    log("'Create an appeal' button not found.")
    return False


def click_imei_activation_date_option(driver, log=print, timeout=15):
    """Selects the 'IMEI and Activation Date' appeal mode inside the appeal
    dialog.

    Updated panel flow: after 'Create an appeal' the dialog first asks for
    the appeal mode — the IMEI input only renders AFTER this option is
    clicked. The option text is clicked first; if the IMEI form still does
    not appear, the click is retried on the text's interactive ancestors
    (button / label / role=radio / role=button) until the form opens."""
    if appeal_form_is_open(driver):
        log("IMEI form already open — appeal-mode picker not needed.")
        return True

    base_xpaths = [
        "//span[normalize-space()='IMEI and Activation Date']",
        "//label[normalize-space()='IMEI and Activation Date']",
        "//*[normalize-space()='IMEI and Activation Date']",
        "//span[contains(normalize-space(),'IMEI and Activation')]",
    ]
    ancestor_suffixes = [
        "",  # the element itself
        "/ancestor::button[1]",
        "/ancestor::label[1]",
        "/ancestor::*[@role='radio'][1]",
        "/ancestor::*[@role='button'][1]",
    ]
    candidates = [
        base + suffix for base in base_xpaths for suffix in ancestor_suffixes
    ]

    def probe_visible(xpath):
        try:
            for element in driver.find_elements(By.XPATH, xpath):
                try:
                    if element.is_displayed() or js_is_displayed(driver, element):
                        return True
                except Exception:
                    continue
        except Exception:
            pass
        return False

    end_time = time.time() + max(timeout, 5)
    tried = set()

    while time.time() < end_time:
        if appeal_form_is_open(driver):
            log("Appeal mode 'IMEI and Activation Date' selected — IMEI form is open.")
            return True

        progress = False
        for xpath in candidates:
            if xpath in tried or not probe_visible(xpath):
                continue
            try:
                safe_click(driver, (By.XPATH, xpath), timeout=4,
                           name="IMEI and Activation Date", log=log)
            except Exception:
                tried.add(xpath)
                continue
            tried.add(xpath)
            progress = True
            time.sleep(1.2)
            if appeal_form_is_open(driver):
                log("Appeal mode 'IMEI and Activation Date' selected — IMEI form is open.")
                return True
            break  # re-evaluate candidates from the top after each real click

        if not progress:
            time.sleep(0.8)

    if appeal_form_is_open(driver):
        return True

    log("'IMEI and Activation Date' option not found or it did not reveal the IMEI form. Continuing with the active form mode.")
    return False


def js_set_input_value(driver, element, text):
    """Set an input value through the native setter so React state updates."""
    driver.execute_script(
        """
        const el = arguments[0];
        const value = arguments[1] === undefined ? '' : String(arguments[1]);
        const proto = (el instanceof HTMLTextAreaElement)
            ? HTMLTextAreaElement.prototype
            : (el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input',  {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        """,
        element,
        "" if text is None else str(text),
    )


def fill_field_with_fallback(driver, locator, text, timeout=15, name="field", log=print):
    """safe_type first; verify the value landed; otherwise set via JS."""
    element = safe_type(driver, locator, text, timeout=timeout, name=name, log=log)
    try:
        current = element.get_attribute("value") or ""
    except Exception:
        current = ""
    if str(current).strip() == str(text).strip():
        return element
    log(f"{name}: typed value did not stick. Setting it with JavaScript fallback.")
    try:
        js_set_input_value(driver, element, text)
    except Exception as js_error:
        log(f"{name}: JavaScript fallback failed: {js_error}")
    try:
        current = element.get_attribute("value") or ""
    except Exception:
        current = ""
    return element if str(current).strip() == str(text).strip() else None


def _describe_active_element(driver):
    """Short human-readable tag for the currently focused element (logging)."""
    try:
        return driver.execute_script(
            "const a = document.activeElement;"
            "if (!a) return 'none';"
            "let t = a.tagName ? a.tagName.toLowerCase() : 'unknown';"
            "if (a.name) t += '[' + a.name + ']';"
            "else if (a.id) t += '#' + a.id;"
            "return t;"
        )
    except Exception:
        return "unknown"


def press_tab_after_field(driver, element, log=print, name="field"):
    """Moves focus off `element` with a TAB key press.

    The updated claim panel expects pure KEYBOARD navigation between the
    appeal fields: IMEI -> TAB -> date -> TAB -> type -> TAB -> amount ->
    TAB -> comments -> Submit. Clicking into the next field (safe_type's
    JS click) opens the date picker on the date input, and an extra TAB
    after the comments box closes the whole side panel.

    Before the TAB the helper makes sure focus actually sits on
    `element` (a JS fallback fill can leave focus elsewhere). WebElement
    identity is compared inside the page because two WebDriver lookups
    of the same DOM node get different element ids."""
    try:
        if element is not None:
            same = False
            try:
                same = bool(driver.execute_script(
                    "return arguments[0] === document.activeElement;", element))
            except Exception:
                same = False
            if not same:
                try:
                    driver.execute_script("arguments[0].focus();", element)
                except Exception:
                    pass
        active = driver.switch_to.active_element
        active.send_keys(Keys.TAB)
        time.sleep(0.4)
        log(f"TAB pressed after {name} — focus now on: {_describe_active_element(driver)}")
        return True
    except Exception as error:
        log(f"TAB after {name} failed: {error}")
        return False


def fill_imei_field(driver, imei, log=print, timeout=15):
    element = fill_field_with_fallback(
        driver,
        (By.CSS_SELECTOR, "input[name='imei']"),
        imei,
        timeout=timeout,
        name="IMEI",
        log=log,
    )
    if element is None:
        log(f"IMEI field could not be filled with '{imei}'.")
        return False
    # Keyboard flow: TAB out of the IMEI field lands on the activation
    # date field — the date field is never clicked (a click opens the
    # date picker and the panel flow breaks).
    press_tab_after_field(driver, element, log=log, name="IMEI")
    return True


def dismiss_date_picker(driver):
    """Close any open date popup without touching the appeal modal itself."""
    try:
        active = driver.switch_to.active_element
        active.send_keys(Keys.ESCAPE)
        return
    except Exception:
        pass
    try:
        driver.execute_script("document.activeElement && document.activeElement.blur();")
    except Exception:
        pass


def fill_activation_date_field(driver, date_text, log=print, timeout=15):
    """TYPES the activation date (MM/DD/YYYY) with pure keyboard flow.

    The date picker is never clicked open and the calendar is never
    touched ('date select nahi karni, date likhni hai'). Focus arrives
    here via the TAB pressed after the IMEI field; the date is typed,
    then a TAB confirms it and moves focus to the appeal-type dropdown
    — exactly the manual flow. No ENTER, no ESCAPE, no picker click."""
    locators = [
        (By.CSS_SELECTOR, "input#activationDate"),
        (By.CSS_SELECTOR, "input[name='activationDate']"),
        (By.XPATH, "//input[@placeholder='Select the date of activation']"),
    ]

    last_error = None
    for locator in locators:
        try:
            element = WebDriverWait(driver, timeout).until(
                EC.visibility_of_element_located(locator)
            )
        except Exception as error:
            last_error = error
            continue

        def current_value():
            try:
                return element.get_attribute("value") or ""
            except Exception:
                return ""

        # Focus the date field WITHOUT clicking it (a click opens the
        # date picker). The TAB after IMEI usually already sits here.
        try:
            same = bool(driver.execute_script(
                "return arguments[0] === document.activeElement;", element))
        except Exception:
            same = False
        if not same:
            try:
                driver.execute_script("arguments[0].focus();", element)
            except Exception:
                pass

        # Clear any leftover text without clicking (JS wipe keeps React
        # state in sync).
        js_set_input_value(driver, element, "")
        time.sleep(0.2)

        # TYPE the date, character by character, like on a keyboard.
        try:
            element.send_keys(date_text)
        except Exception as error:
            log(f"Activation date typing failed: {error}")
        time.sleep(0.3)

        if not re.match(r"^\d{2}/\d{2}/\d{4}$", current_value()):
            # Typed value did not stick — set it without touching the picker.
            js_set_input_value(driver, element, date_text)
            time.sleep(0.4)

        if re.match(r"^\d{2}/\d{2}/\d{4}$", current_value()):
            # TAB confirms the typed date and lands on the type dropdown —
            # no ENTER, no picker click, no ESCAPE.
            press_tab_after_field(driver, element, log=log, name="Activation Date")
            log(f"Activation date set: {current_value()}")
            return True

        log(f"Activation date field did not accept '{date_text}' (current value: '{current_value()}').")
        return False

    if last_error:
        log(f"Activation date field not found: {last_error}")
    return False


def select_appeal_type(driver, type_value, log=print, timeout=15):
    """Selects the appeal type from the native <select id='appealType'>."""
    locators = [
        (By.CSS_SELECTOR, "select#appealType"),
        (By.CSS_SELECTOR, "select[name='appealType']"),
        (By.XPATH, "//select[@name='appealType' or @id='appealType']"),
    ]

    for locator in locators:
        try:
            element = WebDriverWait(driver, timeout).until(
                EC.visibility_of_element_located(locator)
            )
        except Exception:
            continue

        label = type_value
        try:
            Select(element).select_by_value(type_value)
        except Exception:
            try:
                js_set_input_value(driver, element, type_value)
            except Exception:
                pass

        try:
            current_value = element.get_attribute("value") or ""
        except Exception:
            current_value = ""
        if current_value == type_value:
            try:
                Select(element).options
                for option in Select(element).all_selected_options:
                    label = option.text.strip() or type_value
            except Exception:
                pass
            # Keyboard flow: TAB moves focus from the dropdown to the
            # amount field.
            press_tab_after_field(driver, element, log=log, name="Appeal Type")
            log(f"Appeal type selected: {label}")
            return True

        log(f"Appeal type selection did not stick (value now: '{current_value}').")
        return False

    log("Appeal type dropdown not found.")
    return False


def fill_claim_amount_field(driver, amount_text, log=print, timeout=15):
    element = fill_field_with_fallback(
        driver,
        (By.CSS_SELECTOR, "input[name='proposedCommissionAmount']"),
        amount_text,
        timeout=timeout,
        name="Claim amount",
        log=log,
    )
    if element is None:
        log(f"Claim amount field could not be filled with '{amount_text}'.")
        return False
    # Keyboard flow: TAB moves focus from the amount field to the
    # comments box.
    press_tab_after_field(driver, element, log=log, name="Claim Amount")
    return True


def fill_appeal_comments(driver, comments_text, log=print, timeout=12):
    locators = [
        (By.CSS_SELECTOR, "textarea[placeholder*='additional comments']"),
        (By.CSS_SELECTOR, "textarea[placeholder*='Additional comments']"),
        (By.XPATH, "//textarea[contains(@placeholder,'comments to explain')]"),
        (By.XPATH, "(//textarea)[1]"),
    ]

    for locator in locators:
        try:
            fill_field_with_fallback(
                driver, locator, comments_text, timeout=timeout, name="Comments", log=log
            )
            # KEYBOARD RULE: NO TAB after the comments box — an extra TAB
            # moves focus out of the form and closes the whole side panel.
            # Submit is clicked directly instead.
            log("Comments filled. No TAB after comments — submitting directly.")
            return True
        except Exception:
            continue

    log("Comments box not found. Continuing without comments.")
    return False


_APPEAL_FIELD_SELECTORS = [
    "input[name='imei']",
    "input#activationDate",
    "input[name='activationDate']",
    "input[name='proposedCommissionAmount']",
    "textarea",
]


def clear_appeal_form_fields(driver, log=print):
    """Wipes every visible appeal-form field before the next entry.

    The updated claim panel keeps the previous claim's values pre-filled
    when the appeal form opens again ('fields already filled hoti hain').
    Without this wipe the next appeal could inherit the previous IMEI,
    activation date, amount, or comments."""
    cleared = 0
    for selector in _APPEAL_FIELD_SELECTORS:
        try:
            elements = driver.find_elements(By.CSS_SELECTOR, selector)
        except Exception:
            continue
        for element in elements:
            try:
                if not (element.is_displayed() or js_is_displayed(driver, element)):
                    continue
                if not (element.get_attribute("value") or "").strip():
                    continue
                js_set_input_value(driver, element, "")
                cleared += 1
            except Exception:
                continue
    if cleared:
        log(f"Cleared {cleared} pre-filled appeal field(s) for the next entry.")
    return cleared


def submit_appeal_form(driver, log=print, timeout=15):
    locators = [
        (By.CSS_SELECTOR, "button.vp-btn-submit"),
        (By.XPATH, "//button[@type='submit' and contains(@class,'vp-btn-submit')]"),
        (By.XPATH, "//button[@type='submit' and normalize-space()='Submit']"),
        (By.XPATH, "//button[normalize-space()='Submit']"),
    ]

    for locator in locators:
        try:
            safe_click(driver, locator, timeout=timeout, name="Submit", log=log)
            return True
        except Exception:
            continue

    log("Submit button not found.")
    return False


_ERROR_SCAN_JS = """
const selectors = [
    '[class*="error" i]',
    '[class*="invalid" i]',
    '[role="alert"]',
    '.text-red-500', '.text-red-600', '.text-danger'
];
const seen = new Set();
const out = [];
for (const sel of selectors) {
    let nodes;
    try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
    for (const el of nodes) {
        if (seen.has(el)) continue;
        seen.add(el);
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue;
        const t = (el.innerText || '').trim();
        if (t && t.length < 300) out.push(t);
    }
}
return out.slice(0, 6).join(' | ');
"""


def scan_visible_error_text(driver):
    try:
        return driver.execute_script(_ERROR_SCAN_JS) or ""
    except Exception:
        return ""


_SUCCESS_MARKERS = (
    "appeal submitted", "submitted successfully", "successfully submitted",
    "appeal created", "appeal has been created", "appeal has been submitted",
    "appeal has been received", "appeal received", "appeal filed",
    "request submitted", "request received", "submitted for review",
    "success", "thank you",
)


def wait_for_appeal_result(driver, timeout=25, log=print):
    """Waits for a clear outcome after Submit.
    Returns (status, message): SUBMITTED / FAILED / UNKNOWN."""
    end_time = time.time() + timeout
    last_error_text = ""

    while time.time() < end_time:
        form_open = appeal_form_is_open(driver)

        try:
            imei_elements = driver.find_elements(By.CSS_SELECTOR, "input[name='imei']")
            imei_value = ""
            for element in imei_elements:
                if element.is_displayed() or js_is_displayed(driver, element):
                    imei_value = element.get_attribute("value") or ""
                    break
        except Exception:
            imei_value = ""

        body_text = ""
        try:
            body_text = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
        except Exception:
            body_text = ""

        success_hit = next((marker for marker in _SUCCESS_MARKERS if marker in body_text), None)

        error_text = scan_visible_error_text(driver)
        combined = (body_text + "\n" + (error_text or "")).lower()

        # "Commission already appealed." means the claim WAS filed before —
        # the portal refuses a duplicate appeal. That is a filed claim, not
        # a failure, so it is recorded as Submitted (log shows: filed).
        if "already appealed" in (error_text or "").lower() or "commission already appealed" in combined:
            log("Portal: 'Commission already appealed' — claim was filed earlier. "
                "Recording as FILED in the log.")
            return CLAIM_STATUS_SUBMITTED, "Already appealed — commission was filed earlier"

        if not form_open:
            log("Appeal form closed after submit — treating as submitted.")
            return CLAIM_STATUS_SUBMITTED, "Form closed after submit"

        if success_hit:
            log(f"Success message detected: '{success_hit}'.")
            return CLAIM_STATUS_SUBMITTED, f"Confirmation: {success_hit}"

        if form_open and not imei_value.strip():
            # Form reset itself for the next entry — common after a clean submit.
            log("Appeal form cleared after submit — treating as submitted.")
            return CLAIM_STATUS_SUBMITTED, "Form reset for next entry"

        if "activation order not found" in combined:
            log("Portal error: Activation order not found — recorded in the filing log.")
            return CLAIM_STATUS_FAILED, "Activation order not found"

        if error_text and error_text != last_error_text:
            lowered = error_text.lower()
            if any(word in lowered for word in ("required", "invalid", "error", "failed", "must", "already", "unable", "not valid", "not found")):
                log(f"Error message detected: {error_text}")
                return CLAIM_STATUS_FAILED, error_text[:250]
            last_error_text = error_text

        time.sleep(0.5)

    return CLAIM_STATUS_UNKNOWN, "No clear confirmation after submit — verify manually"


def file_single_appeal(driver, claim, stop_event, log=print):
    """Files ONE appeal claim on the open Activations & Commissions page.
    Returns (status, message)."""
    imei = claim.get("imei", "")
    date_text = claim.get("activation_date", "")
    type_value = claim.get("type_value") or ""
    amount_text = claim.get("amount", "")
    comments_text = claim.get("comments") or DEFAULT_APPEAL_COMMENT

    if stop_event.is_set():
        return CLAIM_STATUS_STOPPED, "Stopped before filing"

    log("-" * 70)
    log(f"Claim: IMEI {imei} | {date_text} | {type_value} | ${amount_text}")

    # If the appeal dialog is already sitting on its mode picker (e.g. the
    # previous attempt left it open), skip the 'Create an appeal' click.
    if appeal_mode_picker_visible(driver):
        log("Appeal mode picker already open — skipping the 'Create an appeal' click.")
    elif not click_create_an_appeal(driver, log=log):
        return CLAIM_STATUS_FAILED, "'Create an appeal' not found"

    # Updated panel flow: the dialog first asks for the appeal mode —
    # 'IMEI and Activation Date' must be clicked BEFORE the IMEI input
    # renders. Select the mode first, only then wait for the field.
    click_imei_activation_date_option(driver, log=log)

    try:
        get_visible_element(driver, (By.CSS_SELECTOR, "input[name='imei']"), timeout=15)
    except Exception:
        log("IMEI form still closed — re-clicking 'Create an appeal' once, then re-selecting the mode.")
        if not click_create_an_appeal(driver, log=log):
            return CLAIM_STATUS_FAILED, "'Create an appeal' not found (retry)"
        click_imei_activation_date_option(driver, log=log)
        try:
            get_visible_element(driver, (By.CSS_SELECTOR, "input[name='imei']"), timeout=15)
        except Exception as error:
            return CLAIM_STATUS_FAILED, f"Appeal form did not open after appeal-mode selection: {error}"

    # The panel re-opens the form pre-filled with the previous claim's
    # values — wipe them before typing so no appeal inherits old data.
    clear_appeal_form_fields(driver, log=log)
    time.sleep(0.5)

    # Keyboard flow (matches the manual filing process):
    # IMEI > TAB > date (typed, never picked) > TAB > type dropdown >
    # TAB > amount > TAB > comments > NO TAB > Submit.
    log("Keyboard flow: IMEI > TAB > date typed > TAB > type > TAB > amount > TAB > comments > Submit (no TAB after comments).")

    if not fill_imei_field(driver, imei, log=log):
        return CLAIM_STATUS_FAILED, "IMEI field fill failed"
    if stop_event.is_set():
        return CLAIM_STATUS_STOPPED, "Stopped while filling form"

    if not fill_activation_date_field(driver, date_text, log=log):
        return CLAIM_STATUS_FAILED, "Activation date fill failed"

    if not select_appeal_type(driver, type_value, log=log):
        return CLAIM_STATUS_FAILED, f"Appeal type select failed ({type_value})"

    if not fill_claim_amount_field(driver, amount_text, log=log):
        return CLAIM_STATUS_FAILED, "Claim amount fill failed"

    fill_appeal_comments(driver, comments_text, log=log)

    if not submit_appeal_form(driver, log=log):
        return CLAIM_STATUS_FAILED, "Submit button not found"

    log("Submitted. Waiting for the result...")
    status, message = wait_for_appeal_result(driver, timeout=25, log=log)

    if status in (CLAIM_STATUS_SUBMITTED, CLAIM_STATUS_UNKNOWN):
        # The claim panel takes 5-8 seconds to reset after a successful
        # submit — clicking 'Create an appeal' earlier than that breaks
        # the next entry (user: "jab submit hogai to create appeal phir
        # click karo per 5-8 sec ke bad").
        log("Panel reset wait: pausing ~6.5 seconds before the next 'Create an appeal' click.")
        time.sleep(6.5)

    return status, message


def file_appeals_for_store(driver, claims, store_name, stop_event, log=print):
    """Files every pending claim for the currently logged-in store."""
    pending = [c for c in claims if c.get("status") != CLAIM_STATUS_SUBMITTED]
    if not pending:
        log("No pending claims for this store.")
        return

    log(f"Filing {len(pending)} claim(s) for {store_name}.")
    for index, claim in enumerate(pending, start=1):
        if stop_event.is_set():
            for remaining in pending[index - 1:]:
                if remaining.get("status") != CLAIM_STATUS_SUBMITTED:
                    remaining["status"] = CLAIM_STATUS_STOPPED
                    remaining["message"] = "Stopped by user"
                    remaining["filed_at"] = datetime.now().strftime("%m/%d/%Y %I:%M %p")
            log("Stopped by user. Remaining claims marked Stopped.")
            break

        log(f"[{store_name}] Claim {index}/{len(pending)}")
        claim["status"] = CLAIM_STATUS_RUNNING
        claim["message"] = ""
        try:
            status, message = file_single_appeal(driver, claim, stop_event, log=log)
        except Exception as error:
            status, message = CLAIM_STATUS_FAILED, f"Exception while filing: {error}"
            log(f"Exception while filing IMEI {claim.get('imei', '')}: {error}")

        claim["status"] = status
        claim["message"] = message
        claim["filed_at"] = datetime.now().strftime("%m/%d/%Y %I:%M %p")
        log(f"Result: {status} — {message}")
        time.sleep(DELAY_BETWEEN_CLAIMS)


def post_login_portal_navigation(driver, account_id, store_name, stop_event, log=print):
    """Rebate-filing version of the post-login flow:
    landing page -> clear one-time Later alerts -> open the Activations &
    Commissions reporting URL DIRECTLY (never the Incentive Dashboard link)
    -> click 'Month-to-Date' (updated claim-panel flow) -> soft TSP ID check
    (blocks only on a DIFFERENT visible ID; a missing ID never stops the
    store) -> file this store's IMEI claims."""
    if stop_event.is_set():
        return False

    log("Starting post-login navigation (Rebate Filing).")
    log_current_page_state(driver, log=log, prefix="Post-login entry page")

    wait_for_portal_or_alerts_ready(driver, timeout=15, log=log)

    if is_alerts_page(driver) or find_visible_later_buttons(driver):
        log("Alerts/Later page detected. Clearing Later buttons one time before direct URL navigation.")
        clear_initial_later_alerts_once(driver, log=log)
        time.sleep(2)
    else:
        log("No initial Later alert detected. Moving directly to URL navigation.")

    if stop_event.is_set():
        return False

    log("Opening Activations & Commissions reporting page directly (Incentive link skipped):")
    log(f"  {APPEALS_URL}")

    if not open_url_in_edge_tab(driver, APPEALS_URL, timeout=45, log=log):
        log("Direct Activations & Commissions URL did not open.")
        return False

    if not wait_for_human_verification_clear(driver, stop_event=stop_event, log=log, context="Activations & Commissions page"):
        return False

    try:
        wait_for_body(driver, timeout=25)
    except Exception:
        pass

    time.sleep(4)
    log_current_page_state(driver, log=log, prefix="After Activations & Commissions URL")

    # Updated claim-panel flow: the 'Month-to-Date' pill must be clicked as
    # soon as the Activations & Commissions page opens — it submits the
    # reporting filter so the month's claims load and the 'Create an
    # appeal' control renders. Filing never starts before this click.
    log("Clicking 'Month-to-Date' on arrival (updated claim-panel flow).")
    click_month_to_date_button(driver, log=log, timeout=10)
    time.sleep(3)
    log_current_page_state(driver, log=log, prefix="After Month-to-Date filter")

    tsp_status = verify_logged_in_tsp_id(
        driver,
        account_id,
        timeout=15,
        log=log,
        context="after Month-to-Date filter",
    )

    if tsp_status == "MISMATCH":
        log("Wrong TSP ID visible on the claim panel. Clearing cache/cookies and retrying this store.")
        return "TSP_MISMATCH"

    if tsp_status != "MATCH":
        # The updated panel often shows only the TSP name (e.g. 'CLERK') in
        # its font-semibold header spans — no numeric ID. This session was
        # opened with the store's own credentials and every appeal is keyed
        # by IMEI, so a missing (not mismatched) ID must not block filing.
        log("TSP ID not visible on the updated claim panel. Session opened "
            "with this store's own credentials — continuing filing.")

    if stop_event.is_set():
        return False

    claims = [c for c in CURRENT_CLAIMS if c.get("status") != CLAIM_STATUS_SUBMITTED]
    if not claims:
        log("No pending claims for this store. Nothing to file.")
        return True

    file_appeals_for_store(driver, claims, store_name, stop_event, log=log)

    submitted = len([c for c in CURRENT_CLAIMS if c.get("status") == CLAIM_STATUS_SUBMITTED])
    log(f"Claim filing pass done for {store_name}: {submitted}/{len(CURRENT_CLAIMS)} submitted.")
    return True


# =========================================================
# LOGIN FLOW (verbatim from VidaPay Incentive Dashboard Extractor)
# =========================================================

def login_store(store_data, stop_event, set_current_driver, log=print, retry_attempt=1, max_retry_attempts=2):
    store_name = store_data["store"]
    account_id = store_data["account_id"]
    username = store_data["username"]
    password = store_data["password"]

    driver = None

    try:
        log("")
        log("=" * 80)
        log(f"Starting: {store_name}")
        log(f"Account ID: {account_id}")
        log(f"Login attempt: {retry_attempt}/{max_retry_attempts}")
        log("=" * 80)

        driver = create_edge_driver(log=log)
        set_current_driver(driver)

        configure_download_folder(driver, log=log)
        reset_browser_session(driver, log=log)

        if not check_site_access(driver, log=log):
            return False

        if not wait_for_human_verification_clear(driver, stop_event=stop_event, log=log, context="site access"):
            return False

        if not click_home_sign_in_button(driver, log=log):
            return False

        wait_for_body(driver)

        if not wait_for_human_verification_clear(driver, stop_event=stop_event, log=log, context="login page"):
            return False

        try:
            safe_type_any(
                driver,
                [
                    (By.XPATH, "//label[contains(normalize-space(),'Account ID')]/following::input[1]"),
                    (By.XPATH, "//input[contains(@placeholder,'Account') or contains(@name,'account') or contains(@id,'account')]"),
                    (By.XPATH, "(//input[not(@type='hidden') and not(@type='password')])[1]"),
                ],
                account_id,
                timeout=20,
                name="Account ID",
                log=log,
            )
        except Exception:
            log("Login fields were not ready after Home Sign In. Opening /login directly and retrying fields.")
            if not open_url_in_edge_tab(driver, LOGIN_URL, timeout=WAIT_SECONDS, log=log):
                return False
            wait_for_body(driver)
            safe_type_any(
                driver,
                [
                    (By.XPATH, "//label[contains(normalize-space(),'Account ID')]/following::input[1]"),
                    (By.XPATH, "//input[contains(@placeholder,'Account') or contains(@name,'account') or contains(@id,'account')]"),
                    (By.XPATH, "(//input[not(@type='hidden') and not(@type='password')])[1]"),
                ],
                account_id,
                timeout=25,
                name="Account ID",
                log=log,
            )

        safe_type_any(
            driver,
            [
                (By.XPATH, "//label[contains(normalize-space(),'User Name')]/following::input[1]"),
                (By.XPATH, "//input[contains(@placeholder,'User') or contains(@name,'user') or contains(@id,'user')]"),
                (By.XPATH, "(//input[not(@type='hidden') and not(@type='password')])[2]"),
            ],
            username,
            timeout=25,
            name="Username",
            log=log,
        )

        safe_type_any(
            driver,
            [
                (By.XPATH, "//input[@type='password']"),
                (By.XPATH, "//label[contains(normalize-space(),'Password')]/following::input[1]"),
            ],
            password,
            timeout=25,
            name="Password",
            log=log,
        )

        old_url = driver.current_url

        safe_click(
            driver,
            (
                By.XPATH,
                "//button[contains(normalize-space(),'Sign In')]"
            ),
            name="Login Sign In",
            log=log
        )

        try:
            WebDriverWait(driver, 15).until(
                EC.url_changes(old_url)
            )
            log("URL changed after login.")
        except TimeoutException:
            log("URL did not change after login. Continuing.")

        # ── Check for invalid credentials error and retry up to 2 times ──────
        for _cred_retry in range(2):
            time.sleep(1.5)
            try:
                invalid = driver.execute_script("""
                    const items = Array.from(document.querySelectorAll('li, .error, .alert, [class*="error"], [class*="invalid"], [class*="alert"]'));
                    for (const el of items) {
                        const t = (el.innerText || '').toLowerCase();
                        if (t.includes('invalid') || t.includes('incorrect') || t.includes('wrong') || t.includes('failed')) {
                            return el.innerText.trim();
                        }
                    }
                    return null;
                """)
            except Exception:
                invalid = None

            if not invalid:
                break

            log(f"Login error detected: '{invalid}' — re-entering credentials (attempt {_cred_retry + 2})...")
            time.sleep(1)

            # Clear and re-fill all three fields
            try:
                safe_type_any(
                    driver,
                    [
                        (By.XPATH, "//label[contains(normalize-space(),'Account ID')]/following::input[1]"),
                        (By.XPATH, "//input[contains(@placeholder,'Account') or contains(@name,'account') or contains(@id,'account')]"),
                        (By.XPATH, "(//input[not(@type='hidden') and not(@type='password')])[1]"),
                    ],
                    account_id, timeout=15, name="Account ID (retry)", log=log,
                )
                safe_type_any(
                    driver,
                    [
                        (By.XPATH, "//label[contains(normalize-space(),'User Name')]/following::input[1]"),
                        (By.XPATH, "//input[contains(@placeholder,'User') or contains(@name,'user') or contains(@id,'user')]"),
                        (By.XPATH, "(//input[not(@type='hidden') and not(@type='password')])[2]"),
                    ],
                    username, timeout=15, name="Username (retry)", log=log,
                )
                safe_type_any(
                    driver,
                    [
                        (By.XPATH, "//input[@type='password']"),
                        (By.XPATH, "//label[contains(normalize-space(),'Password')]/following::input[1]"),
                    ],
                    password, timeout=15, name="Password (retry)", log=log,
                )
                old_url = driver.current_url
                safe_click(
                    driver,
                    (By.XPATH, "//button[contains(normalize-space(),'Sign In')]"),
                    name="Login Sign In (retry)",
                    log=log,
                )
                try:
                    WebDriverWait(driver, 15).until(EC.url_changes(old_url))
                    log("URL changed after credential retry.")
                except TimeoutException:
                    log("URL did not change after credential retry. Continuing.")
            except Exception as ce:
                log(f"Credential retry failed: {ce}")
                break

        if not wait_for_human_verification_clear(driver, stop_event=stop_event, log=log, context="after sign in"):
            return False

        if stop_event.is_set():
            return False

        two_factor_result = handle_ibm_verify_and_setup(driver, stop_event, log=log)

        if not two_factor_result:
            log("IBM Verify approval was not completed. Stopping before Trust Device.")
            return False

        if stop_event.is_set():
            return False

        if two_factor_result in SETUP_FLOW_STATES:
            if not finish_setup_steps(
                driver,
                stop_event,
                account_id=account_id,
                log=log
            ):
                log("2FA setup did not complete.")
                return False
        else:
            log("Trust Device setup skipped because portal or alerts page is already loaded.")

        if stop_event.is_set():
            return False

        post_login_result = post_login_portal_navigation(
            driver,
            account_id=account_id,
            store_name=store_name,
            stop_event=stop_event,
            log=log
        )

        if post_login_result == "TSP_MISMATCH":
            if retry_attempt < max_retry_attempts:
                clear_session_for_tsp_retry(driver, log=log)
                log("Retrying the same store from a clean login session.")
                return login_store(
                    store_data=store_data,
                    stop_event=stop_event,
                    set_current_driver=set_current_driver,
                    log=log,
                    retry_attempt=retry_attempt + 1,
                    max_retry_attempts=max_retry_attempts,
                )

            log("TSP ID still did not match after retry. Stopping this store to avoid wrong export.")
            return False

        if not post_login_result:
            log("Post-login navigation did not complete.")
            return False

        log(f"Completed: {store_name}")
        log(f"Final URL: {driver.current_url}")

        time.sleep(2)
        return True

    except TimeoutException as e:
        log(f"Timeout for {store_name}: {e}")
        return False

    except WebDriverException as e:
        log(f"Edge/WebDriver error for {store_name}: {e}")
        return False

    except Exception as e:
        log(f"Failed for {store_name}: {e}")
        return False

    finally:
        try:
            if driver:
                if ATTACH_TO_OPEN_EDGE:
                    try:
                        switch_to_first_live_content_tab(driver, log=log)
                    except Exception:
                        pass
                    log("Detached from Edge. Automation browser remains open for VPN/session.")
                else:
                    driver.quit()
        except Exception:
            pass

        set_current_driver(None)




# =========================================================
# EXCEL PARSING (logins + rebates) & FILING LOG
# =========================================================

def _excel_header_index(header, wanted_names):
    """Return the column index for the first matching header name."""
    for wanted in wanted_names:
        for idx, cell in enumerate(header):
            if cell == wanted:
                return idx
    for wanted in wanted_names:
        for idx, cell in enumerate(header):
            if wanted in cell:
                return idx
    return None


def _excel_cell(row, idx):
    if idx is None or idx >= len(row):
        return None
    return row[idx]


def parse_login_workbook_rows(file_path, log=print):
    """Reads store credentials from Excel (same format as the Extractor).
    Required columns (case-insensitive, any order):
        store | account_id | username | password
    Returns (logins, skipped, errors)."""
    import openpyxl

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return [], 0, ["The selected Excel file has no data."]

    header = [str(cell).strip().lower() if cell is not None else "" for cell in rows[0]]

    col = {
        "store": _excel_header_index(header, ["store", "store name", "store_name"]),
        "account_id": _excel_header_index(header, ["account_id", "account id", "accountid", "account", "tsp", "tsp id"]),
        "username": _excel_header_index(header, ["username", "user name", "user_name", "user"]),
        "password": _excel_header_index(header, ["password", "pass", "pwd"]),
    }

    missing = [name for name, idx in col.items() if idx is None]
    if missing:
        return [], 0, [
            "The login Excel must have columns: store, account_id, username, password (missing: %s)" % ", ".join(missing)
        ]

    logins = []
    skipped = 0
    errors = []

    for row_num, row in enumerate(rows[1:], start=2):
        try:
            store_val = clean_claim_text(_excel_cell(row, col["store"]), limit=120)
            account_val = clean_claim_text(_excel_cell(row, col["account_id"]), limit=40)
            user_val = clean_claim_text(_excel_cell(row, col["username"]), limit=120)
            pass_val = str(_excel_cell(row, col["password"]) or "").strip()

            if isinstance(_excel_cell(row, col["password"]), float) and _excel_cell(row, col["password"]).is_integer():
                pass_val = str(int(_excel_cell(row, col["password"])))

            if not all([store_val, account_val, user_val, pass_val]):
                skipped += 1
                continue

            if any(v.lower() in ("none", "nan") for v in [store_val, account_val, user_val, pass_val]):
                skipped += 1
                continue

            logins.append({
                "store": store_val,
                "account_id": account_val,
                "username": user_val,
                "password": pass_val,
            })
        except Exception as row_exc:
            errors.append(f"Row {row_num}: {row_exc}")

    return logins, skipped, errors


def parse_rebate_workbook_rows(file_path, log=print):
    """Reads rebate/appeal rows from Excel.
    Recognized columns (case-insensitive, any order):
        imei (required) | activation date (required) | type (required) |
        amount (required) | store / account id (at least one) | comments (optional)
    Only fully valid rows become claims; broken rows are reported back.
    Returns (claims, skipped, errors)."""
    import openpyxl

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return [], 0, ["The selected Excel file has no data."]

    header = [str(cell).strip().lower() if cell is not None else "" for cell in rows[0]]

    col = {
        "store": _excel_header_index(header, ["store", "store name", "store_name"]),
        "account_id": _excel_header_index(header, ["account_id", "account id", "accountid", "account", "tsp", "tsp id"]),
        "activation_date": _excel_header_index(header, ["activation date", "activation_date", "date of activation", "activation", "date"]),
        "imei": _excel_header_index(header, ["imei"]),
        "type": _excel_header_index(header, ["type", "appeal type", "appeal_type", "incentive type"]),
        "amount": _excel_header_index(header, ["amount", "claim amount", "proposed commission", "commission amount", "value"]),
        "comments": _excel_header_index(header, ["comment", "comments", "note", "notes"]),
    }

    missing = [name for name in ("imei", "activation_date", "type", "amount") if col[name] is None]
    if missing:
        return [], 0, [
            "The rebate Excel must have columns: imei, activation date, type, amount "
            "(missing: %s). Optional: store / account id / comments." % ", ".join(missing)
        ]

    claims = []
    skipped = 0
    errors = []

    for row_num, row in enumerate(rows[1:], start=2):
        try:
            imei = clean_imei(_excel_cell(row, col["imei"]))
            date_text = normalize_activation_date(_excel_cell(row, col["activation_date"]))
            type_raw = clean_claim_text(_excel_cell(row, col["type"]), limit=80)
            type_value = resolve_appeal_type(type_raw)
            amount = clean_claim_amount(_excel_cell(row, col["amount"]))
            store_val = clean_claim_text(_excel_cell(row, col["store"]), limit=120) if col["store"] is not None else ""
            account_val = clean_claim_text(_excel_cell(row, col["account_id"]), limit=40) if col["account_id"] is not None else ""
            comments = clean_claim_text(_excel_cell(row, col["comments"]), limit=280) if col["comments"] is not None else ""

            problems = []
            if not imei:
                problems.append("missing IMEI")
            if not date_text:
                problems.append("bad activation date")
            if not type_value:
                problems.append(f"unknown type '{type_raw}'")
            if amount is None:
                problems.append("bad amount")
            if not store_val and not account_val:
                problems.append("no store / account id")

            if problems:
                errors.append(f"Row {row_num}: " + ", ".join(problems))
                skipped += 1
                continue

            claims.append({
                "row": row_num,
                "store": store_val,
                "account_id": account_val,
                "imei": imei,
                "activation_date": date_text,
                "type_raw": type_raw,
                "type_value": type_value,
                "amount": amount,
                "comments": comments,
                "status": CLAIM_STATUS_PENDING,
                "message": "",
                "filed_at": "",
            })
        except Exception as row_exc:
            errors.append(f"Row {row_num}: {row_exc}")
            skipped += 1

    return claims, skipped, errors


def match_claim_store(claim):
    """Find the STORES entry for a claim by account_id, then by store name."""
    account_val = re.sub(r"\D", "", str(claim.get("account_id", "")))
    store_val = str(claim.get("store", "")).strip().lower()

    if account_val:
        for store in STORES:
            if re.sub(r"\D", "", str(store.get("account_id", ""))) == account_val and account_val:
                return store

    if store_val:
        for store in STORES:
            if str(store.get("store", "")).strip().lower() == store_val:
                return store
    return None


# ---------------------------------------------------------------------
# Session filing logs (always on)
# Every filing session writes a dated text log plus a dated Excel log to
# Documents/VidaPay Rebate Filing. The text log is appended live (one line
# per log message) so a crash or a closed window can never lose the record
# of which claims were filed. The Excel log keeps one stable file per
# session and is refreshed after every store and again at the end.
# ---------------------------------------------------------------------

SESSION_LOG_FILE = None      # Path of the live .log text file (or None)
SESSION_XLSX_FILE = None     # Stable per-session .xlsx path (or None)


def start_session_logging(log=print):
    """Creates the dated session log files. Called once when filing starts."""
    global SESSION_LOG_FILE, SESSION_XLSX_FILE
    try:
        folder = Path(DOWNLOAD_DIR)
        folder.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        SESSION_LOG_FILE = folder / f"filing_session_{stamp}.log"
        SESSION_XLSX_FILE = folder / f"rebate_filing_log_{stamp}.xlsx"
        with open(SESSION_LOG_FILE, "w", encoding="utf-8") as handle:
            handle.write(
                f"VidaPay Rebate Filing - filing session started "
                f"{datetime.now().strftime('%m/%d/%Y %I:%M %p')}\n")
            handle.write("=" * 80 + "\n")
        log(f"Session log started: {SESSION_LOG_FILE}")
    except Exception as exc:
        SESSION_LOG_FILE = None
        SESSION_XLSX_FILE = None
        log(f"Session log could not be started: {exc}")


def stop_session_logging():
    """Marks the session as closed (files stay on disk)."""
    global SESSION_LOG_FILE, SESSION_XLSX_FILE
    SESSION_LOG_FILE = None
    SESSION_XLSX_FILE = None


def append_session_log(message):
    """Appends one line to the live session log (best effort, never raises)."""
    path = SESSION_LOG_FILE
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(f"[{datetime.now().strftime('%I:%M:%S %p')}] {message}\n")
    except Exception:
        pass


def write_filing_log_excel(log=print, verbose=True):
    """Writes every claim (submitted / failed / pending / stopped) to a dated
    Excel log inside DOWNLOAD_DIR. Returns the file path or None."""
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
    except Exception as exc:
        log(f"Could not load openpyxl for the filing log: {exc}")
        return None

    try:
        folder = Path(DOWNLOAD_DIR)
        folder.mkdir(parents=True, exist_ok=True)
        if SESSION_XLSX_FILE:
            # One Excel file per session, refreshed as the run progresses.
            path = Path(SESSION_XLSX_FILE)
        else:
            stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            path = folder / f"rebate_filing_log_{stamp}.xlsx"

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Filing Log"

        headers = ["Store", "Account ID", "IMEI", "Activation Date", "Type", "Amount",
                   "Status", "Message", "Filed At", "Excel Row"]
        ws.append(headers)
        for cell in ws[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="090D26")
            cell.alignment = Alignment(vertical="center")

        status_fills = {
            CLAIM_STATUS_SUBMITTED: PatternFill("solid", fgColor="DCEFDC"),
            CLAIM_STATUS_FAILED: PatternFill("solid", fgColor="FBE0E0"),
            CLAIM_STATUS_UNKNOWN: PatternFill("solid", fgColor="FFF4CE"),
            CLAIM_STATUS_STOPPED: PatternFill("solid", fgColor="FFF4CE"),
        }

        type_label_by_value = {value: label for value, label in APPEAL_TYPE_OPTIONS}

        for claim in CLAIMS:
            ws.append([
                claim.get("store", ""),
                claim.get("account_id", ""),
                claim.get("imei", ""),
                claim.get("activation_date", ""),
                type_label_by_value.get(claim.get("type_value"), claim.get("type_raw", "")),
                claim.get("amount", ""),
                claim.get("status", ""),
                claim.get("message", ""),
                claim.get("filed_at", ""),
                claim.get("row", ""),
            ])
            fill = status_fills.get(claim.get("status"))
            if fill is not None:
                ws.cell(row=ws.max_row, column=7).fill = fill

        widths = [26, 14, 20, 16, 20, 12, 12, 44, 20, 10]
        for idx, width in enumerate(widths, start=1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(idx)].width = width
        ws.freeze_panes = "A2"

        wb.save(str(path))
        if verbose:
            log(f"Filing log saved: {path}")
        return str(path)
    except Exception as exc:
        log(f"Writing the filing log failed: {exc}")
        return None


def get_app_asset_dir():
    base = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(base) / "Vidapay_Rebate_Filing"


def ensure_app_assets():
    asset_dir = get_app_asset_dir()
    asset_dir.mkdir(parents=True, exist_ok=True)

    icon_path = asset_dir / "vidapay_icon.ico"
    logo_path = asset_dir / "vidapay_rebate_filing_logo.png"

    try:
        icon_bytes = base64.b64decode(APP_ICON_ICO_BASE64)
        if not icon_path.exists() or icon_path.stat().st_size != len(icon_bytes):
            icon_path.write_bytes(icon_bytes)
    except Exception:
        icon_path = None

    try:
        logo_bytes = base64.b64decode(APP_HEADER_LOGO_PNG_BASE64)
        if not logo_path.exists() or logo_path.stat().st_size != len(logo_bytes):
            logo_path.write_bytes(logo_bytes)
    except Exception:
        logo_path = None

    return icon_path, logo_path



def clean_store_record(store):
    return {
        "store": str(store.get("store", "")).strip(),
        "account_id": str(store.get("account_id", "")).strip(),
        "username": str(store.get("username", "")).strip(),
        "password": str(store.get("password", "")),
    }


def persist_stores_to_hardcoded_data(stores, log=print):
    try:
        cleaned = [clean_store_record(store) for store in stores]
        _vp_put("stores", cleaned)
        log("Saved %d store(s) to encrypted local storage." % len(cleaned))
        return True
    except Exception as e:
        log("Save failed: %s" % e)
        return False


class StoreFormDialog(tk.Toplevel):
    def __init__(self, master, title, initial=None, password_only=False):
        super().__init__(master)
        self.title(title)
        self.resizable(False, False)
        self.result = None
        self.password_only = password_only
        self.transient(master)
        self.grab_set()

        # Pull actual live theme colors so the dialog matches the current
        # light/dark mode instead of always using the hardcoded APP_BG.
        try:
            app = master
            while app.master:
                app = app.master
            self._theme_colors = app.theme_manager.get_colors()
        except Exception:
            self._theme_colors = {}
        _bg = self._theme_colors.get("bg", APP_BG)
        _fg = self._theme_colors.get("text", "#16213a")
        _input_bg = self._theme_colors.get("input", "#ffffff")
        self.configure(bg=_bg)

        initial = initial or {}
        self.store_var = tk.StringVar(value=str(initial.get("store", "")))
        self.account_id_var = tk.StringVar(value=str(initial.get("account_id", "")))
        self.username_var = tk.StringVar(value=str(initial.get("username", "")))
        self.password_var = tk.StringVar(value=str(initial.get("password", "")))
        self.confirm_password_var = tk.StringVar(value=str(initial.get("password", "")))
        self.show_password_var = tk.BooleanVar(value=False)

        self.build_ui()
        self.protocol("WM_DELETE_WINDOW", self.cancel)
        self.bind("<Return>", lambda event: self.submit())
        self.bind("<Escape>", lambda event: self.cancel())
        self.update_idletasks()

        x = master.winfo_rootx() + max(0, (master.winfo_width() - self.winfo_width()) // 2)
        y = master.winfo_rooty() + max(0, (master.winfo_height() - self.winfo_height()) // 2)
        self.geometry(f"+{x}+{y}")

        if password_only:
            self.password_entry.focus_set()
        else:
            self.store_entry.focus_set()

        self.wait_window(self)

    def build_ui(self):
        container = ttk.Frame(self, style="Dialog.TFrame", padding=(18, 16))
        container.grid(row=0, column=0, sticky="nsew")
        container.grid_columnconfigure(1, weight=1)

        title_text = "Change Store Password" if self.password_only else "Store Login Details"
        ttk.Label(container, text=title_text, style="DialogTitle.TLabel").grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 14))
        row = 1

        if not self.password_only:
            ttk.Label(container, text="Store", style="DialogLabel.TLabel").grid(row=row, column=0, sticky="w", padx=(0, 10), pady=6)
            self.store_entry = ttk.Entry(container, textvariable=self.store_var, width=38)
            self.store_entry.grid(row=row, column=1, sticky="ew", pady=6)
            row += 1

            ttk.Label(container, text="Account ID", style="DialogLabel.TLabel").grid(row=row, column=0, sticky="w", padx=(0, 10), pady=6)
            self.account_entry = ttk.Entry(container, textvariable=self.account_id_var, width=38)
            self.account_entry.grid(row=row, column=1, sticky="ew", pady=6)
            row += 1

            ttk.Label(container, text="Username", style="DialogLabel.TLabel").grid(row=row, column=0, sticky="w", padx=(0, 10), pady=6)
            self.username_entry = ttk.Entry(container, textvariable=self.username_var, width=38)
            self.username_entry.grid(row=row, column=1, sticky="ew", pady=6)
            row += 1
        else:
            self.store_entry = None
            self.account_entry = None
            self.username_entry = None

        ttk.Label(container, text="Password", style="DialogLabel.TLabel").grid(row=row, column=0, sticky="w", padx=(0, 10), pady=6)
        self.password_entry = ttk.Entry(container, textvariable=self.password_var, width=38, show="*")
        self.password_entry.grid(row=row, column=1, sticky="ew", pady=6)
        row += 1

        ttk.Label(container, text="Confirm", style="DialogLabel.TLabel").grid(row=row, column=0, sticky="w", padx=(0, 10), pady=6)
        self.confirm_entry = ttk.Entry(container, textvariable=self.confirm_password_var, width=38, show="*")
        self.confirm_entry.grid(row=row, column=1, sticky="ew", pady=6)
        row += 1

        show_box = ttk.Checkbutton(container, text="Show password", variable=self.show_password_var, command=self.toggle_password)
        show_box.grid(row=row, column=1, sticky="w", pady=(4, 12))
        row += 1

        buttons = ttk.Frame(container, style="Dialog.TFrame")
        buttons.grid(row=row, column=0, columnspan=2, sticky="e", pady=(8, 0))
        ttk.Button(buttons, text="Cancel", command=self.cancel).grid(row=0, column=0, padx=(0, 8))
        ttk.Button(buttons, text="Save", style="Accent.TButton", command=self.submit).grid(row=0, column=1)

    def toggle_password(self):
        show_char = "" if self.show_password_var.get() else "*"
        self.password_entry.config(show=show_char)
        self.confirm_entry.config(show=show_char)

    def submit(self):
        password = self.password_var.get()
        confirm_password = self.confirm_password_var.get()

        if not password.strip():
            messagebox.showerror("Missing Password", "Enter the password.", parent=self)
            self.password_entry.focus_set()
            return

        if password != confirm_password:
            messagebox.showerror("Password Mismatch", "Password and confirm password do not match.", parent=self)
            self.confirm_entry.focus_set()
            return

        if self.password_only:
            self.result = {"password": password}
            self.destroy()
            return

        store = self.store_var.get().strip()
        account_id = self.account_id_var.get().strip()
        username = self.username_var.get().strip()

        if not store:
            messagebox.showerror("Missing Store", "Enter the store name.", parent=self)
            self.store_entry.focus_set()
            return

        if not account_id:
            messagebox.showerror("Missing Account ID", "Enter the Account ID.", parent=self)
            self.account_entry.focus_set()
            return

        if not account_id.isdigit():
            messagebox.showerror("Invalid Account ID", "Account ID must contain numbers only.", parent=self)
            self.account_entry.focus_set()
            return

        if not username:
            messagebox.showerror("Missing Username", "Enter the username.", parent=self)
            self.username_entry.focus_set()
            return

        self.result = {"store": store, "account_id": account_id, "username": username, "password": password}
        self.destroy()

    def cancel(self):
        self.result = None
        self.destroy()




# =========================================================
# UI APP - INTERACTIVE UI / UX
# =========================================================

class VidaPayApp:
    def __init__(self, root):
        self.root = root
        self.root.title(APP_TITLE)
        # Dynamic screen resolution support: size to 90% of the screen and
        # center it (DPI-aware), then stay a normal resizable top-level so
        # Windows Snap (50% left/right, corners, Win+arrow) keeps working.
        self._apply_dynamic_geometry()
        self.root.after(10, lambda: self.root.state("zoomed"))

        self.icon_path, self.logo_path = ensure_app_assets()
        self.logo_image = None
        self.header_logo_image = None
        self.apply_app_icon()

        self.stop_event = threading.Event()
        self.worker_thread = None
        self.current_driver = None
        self.running = False
        self._skip_mode = False

        self.store_index_by_iid = {}
        self.claim_index_by_iid = {}
        self.visible_iids = []
        self.claim_visible_iids = []
        self.last_run_total = 0
        self.last_run_done = 0
        self.submitted_count = 0
        self.failed_count = 0

        self.search_var = tk.StringVar()
        self.status_filter_var = tk.StringVar(value="All")
        self.current_store_var = tk.StringVar(value="Idle")
        self.progress_var = tk.DoubleVar(value=0)
        self.progress_text_var = tk.StringVar(value="0 / 0")
        self.selected_text_var = tk.StringVar(value="Selected: 0")
        self.total_text_var = tk.StringVar(value=f"Stores: {len(STORES)}")
        self.submitted_text_var = tk.StringVar(value="Submitted: 0")
        self.failed_text_var = tk.StringVar(value="Failed: 0")
        self.claims_total_text_var = tk.StringVar(value=f"Claims: {len(CLAIMS)}")
        self.show_passwords_var = tk.BooleanVar(value=False)
        self.appeal_comment_var = tk.StringVar(value=str(_vp_get("appeal_comment", DEFAULT_APPEAL_COMMENT)))

        self.theme_manager = ThemeManager(default="dark", app_name="VidaPay_Rebate_Filing")

        self.build_ui()
        self.apply_filter()
        # Apply the theme AFTER the UI exists so classic (non-ttk) widgets —
        # the process log box, toolbar wrapper frames, root background — are
        # colored too. Applying it before the build left them light in dark
        # mode until the user toggled themes.
        self._apply_theme()

    def _apply_dynamic_geometry(self) -> None:
        """Size the window to 90% of the screen and center it."""
        try:
            root = self.root
            root.update_idletasks()
            sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
            w = max(640, min(int(sw * 0.90), sw - 20))
            h = max(480, min(int(sh * 0.90), sh - 40))
            x = max(0, (sw - w) // 2)
            y = max(0, (sh - h) // 2)
            root.geometry(f"{w}x{h}+{x}+{y}")
            root.minsize(min(1220, max(560, sw // 2)),
                         min(740, max(420, sh // 2)))
            root.resizable(True, True)
        except Exception:
            pass

    def apply_app_icon(self):
        # iconbitmap — sets the titlebar and taskbar ICO on Windows
        import sys as _sys, os as _os
        _meipass = getattr(_sys, "_MEIPASS", None)
        if _meipass:
            _ico_path = _os.path.join(_meipass, "vidapay_icon.ico")
            if _os.path.exists(_ico_path):
                try:
                    self.root.iconbitmap(default=_ico_path)
                    self.root.after(200, lambda p=_ico_path: self.root.iconbitmap(default=p))
                    return
                except Exception:
                    pass
        try:
            import base64 as _b64, tempfile as _tf
            data = _b64.b64decode(APP_ICON_ICO_BASE64.strip())
            _tmp_dir = _os.environ.get("TEMP", _tf.gettempdir())
            _ico_path = _os.path.join(_tmp_dir, "vidapay_rebate_filing_icon.ico")
            with open(_ico_path, "wb") as _f:
                _f.write(data)
            self.root.iconbitmap(default=_ico_path)
            self.root.after(200, lambda p=_ico_path: self.root.iconbitmap(default=p))
            return
        except Exception:
            pass
        try:
            if self.icon_path:
                self.root.iconbitmap(default=str(self.icon_path))
                self.root.after(200, lambda: self.root.iconbitmap(default=str(self.icon_path)))
        except Exception:
            pass

    def build_ui(self):
        try:
            _root_bg = self.theme_manager.get_colors().get("bg", APP_BG)
        except Exception:
            _root_bg = APP_BG
        self.root.configure(bg=_root_bg)
        self.root.grid_rowconfigure(2, weight=1)
        self.root.grid_columnconfigure(0, weight=1)
        self.setup_styles()
        self.build_header()
        self.build_toolbar()
        self.build_main_area()
        self.build_footer()
        _cbar = tk.Frame(self.root, bg="#090d26", height=24)
        _cbar.grid(row=99, column=0, sticky="ew")
        _cbar.grid_propagate(False)
        _cbar._tag = "footer"
        _deact = tk.Label(_cbar, text="Deactivate this PC", font=("Segoe UI", 8, "underline"),
                          fg="#9d9db8", bg="#090d26", cursor="hand2")
        _deact.pack(side="right", padx=10)
        _deact.bind("<Button-1>", lambda _e: self._deactivate_this_pc())
        _cbar_label = tk.Label(_cbar, text=f"Developed by www.3SVerse.com | Copyright © {date.today().year} | All rights reserved.  |  Independent vendor - not affiliated with VidaPay.",
                 font=("Segoe UI", 8), fg="#9d9db8", bg="#090d26")
        _cbar_label.pack(expand=True, fill="both")
        _cbar_label._tag = "footer_label"
        self.load_store_rows()
        self.load_claim_rows()
        self.write_startup_steps()

    def _deactivate_this_pc(self):
        """Self-service seat release (footer link): frees THIS PC's
        activation in the license ledger so the same key can be activated
        on another PC (laptop replaced / upgraded). The key itself is
        never consumed by deactivating."""
        from tkinter import messagebox as _mb
        import threading as _th
        import license_core as _lc
        if not _mb.askyesno(
                "Deactivate this PC",
                "Release this PC's activation?\n\n"
                "Your license key is NOT consumed - you can activate the "
                "same key on any other PC at any time (for example after a "
                "laptop replacement).\n\nThis PC will stop running the tool "
                "until it is activated again.",
                parent=self.root):
            return

        def _work():
            ok, msg = _lc.deactivate_this_pc()
            self.root.after(0, lambda: self._deactivate_done(ok, msg))

        _th.Thread(target=_work, daemon=True).start()

    def _deactivate_done(self, ok, msg):
        from tkinter import messagebox as _mb
        if ok:
            _mb.showinfo("Deactivated", msg, parent=self.root)
            self.root.destroy()
        else:
            _mb.showwarning("Not deactivated", msg, parent=self.root)

    def setup_styles(self):
        """Configure ttk styles using the ACTIVE theme colors (not hardcoded)."""
        self.style = ttk.Style()
        # Re-issuing theme_use("clam") when clam is ALREADY active resets the
        # whole ttk style database (wipes Accent/Action/Danger button styles,
        # card frames, combobox colors). Only switch on first init.
        if str(self.style.theme_use()) != "clam":
            try:
                self.style.theme_use("clam")
            except Exception:
                pass

        c = self.theme_manager.get_colors()

        self.style.configure(".", font=("Segoe UI", 10), background=c["bg"])
        self.style.configure("Main.TFrame", background=c["bg"])
        self.style.configure("Header.TFrame", background=APP_NAVY)
        self.style.map("Header.TFrame", background=[("active", c["navy"])])
        self.style.configure("Toolbar.TFrame", background=c["panel"])
        self.style.configure("Card.TFrame", background=c["panel"], relief="flat")
        self.style.configure("Dialog.TFrame", background=c["bg"])
        self.style.configure("Title.TLabel", background=c["navy"], foreground="#ffffff", font=("Segoe UI", 21, "bold"))
        self.style.configure("HeaderSubtle.TLabel", background=c["navy"], foreground="#c9ceda", font=("Segoe UI", 9))
        self.style.configure("Subtle.TLabel", background=c["bg"], foreground=c["text_dim"], font=("Segoe UI", 9))
        self.style.configure("CardTitle.TLabel", background=c["panel"], foreground=c["text_dim"], font=("Segoe UI", 9, "bold"))
        self.style.configure("CardValue.TLabel", background=c["panel"], foreground=c["text"], font=("Segoe UI", 16, "bold"))
        self.style.configure("DialogTitle.TLabel", background=c["bg"], foreground=c["text"], font=("Segoe UI", 14, "bold"))
        self.style.configure("DialogLabel.TLabel", background=c["bg"], foreground=c["text"], font=("Segoe UI", 10, "bold"))
        self.style.configure("Action.TButton", font=("Segoe UI", 10, "bold"), padding=(12, 8),
                             background=c["panel_alt"], foreground=c["text"])
        # Pin hover/pressed/disabled states — otherwise clam's light defaults
        # bleed through in dark mode (light-gray disabled buttons, washed-out
        # hover) and button labels become unreadable.
        self.style.map("Action.TButton",
                       background=[("active", c["panel"]), ("pressed", c["panel"]), ("disabled", c["panel_alt"])],
                       foreground=[("active", c["text"]), ("pressed", c["text"]), ("disabled", c["text_dim"])])
        self.style.configure("Accent.TButton", font=("Segoe UI", 10, "bold"), padding=(12, 8), background=c["red"], foreground="#ffffff")
        self.style.map("Accent.TButton", background=[("active", APP_ACCENT_DARK), ("pressed", APP_ACCENT_DARK), ("disabled", c["red"])], foreground=[("active", "#ffffff"), ("pressed", "#ffffff"), ("disabled", "#ffe3d7")])
        self.style.configure("Danger.TButton", font=("Segoe UI", 10, "bold"), padding=(12, 8), background="#7f1d1d", foreground="#ffffff")
        self.style.map("Danger.TButton", background=[("active", "#991b1b"), ("pressed", "#991b1b"), ("disabled", "#7f1d1d")], foreground=[("disabled", "#d9a3a3")])
        self.style.configure("Treeview", rowheight=34, font=("Segoe UI", 10), background=c["panel"], fieldbackground=c["panel"], foreground=c["text"], borderwidth=0)
        self.style.configure("Treeview.Heading", font=("Segoe UI", 10, "bold"), padding=(8, 10), background=c["navy"], foreground="#ffffff")
        self.style.map("Treeview", background=[("selected", c["red"])], foreground=[("selected", "#ffffff")])
        self.style.configure("TEntry", fieldbackground=c["input"], foreground=c["text"], insertcolor=c["text"], bordercolor=c["border"])
        # Combobox: clam's built-in map forces a LIGHT readonly field, so in
        # dark mode the status filter shows a white box with near-white text
        # (font invisible). Pin every state to the active palette and theme
        # the dropdown popdown listbox as well.
        self.style.configure("TCombobox", fieldbackground=c["input"], foreground=c["text"],
                             background=c["panel_alt"], arrowcolor=c["text"],
                             bordercolor=c["border"], lightcolor=c["border"],
                             darkcolor=c["border"])
        self.style.map("TCombobox",
                       fieldbackground=[("readonly", c["input"]), ("disabled", c["panel_alt"])],
                       foreground=[("readonly", c["text"]), ("disabled", c["text_dim"])],
                       background=[("readonly", c["panel_alt"]), ("active", c["panel_alt"]),
                                   ("pressed", c["panel_alt"])],
                       arrowcolor=[("disabled", c["text_dim"])])
        self._style_combobox_popdown()
        self.style.configure("TCheckbutton", background=c["bg"], foreground=c["text"])
        self.style.configure("TRadiobutton", background=c["panel"], foreground=c["text"])
        self.style.configure("TNotebook", background=c["bg"], borderwidth=0)
        self.style.configure("TNotebook.Tab", font=("Segoe UI", 10, "bold"), padding=(12, 6), background=c["panel_alt"], foreground=c["text"])
        self.style.map("TNotebook.Tab", background=[("selected", c["red"])], foreground=[("selected", "#ffffff")])
        self.style.configure("TLabelframe", background=c["bg"], bordercolor=c["border"])
        self.style.configure("TLabelframe.Label", background=c["bg"], foreground=c["text"])

    def _style_combobox_popdown(self):
        """Theme the combobox dropdown list. The popdown is a plain tk.Listbox
        spawned by Tk itself: the option database covers listboxes created
        after this call, and any already-created popdown is restyled directly
        (best effort - internal listbox paths differ across Tk 8.6 builds)."""
        c = self.theme_manager.get_colors()
        self.root.option_add("*TCombobox*Listbox.background", c["panel_alt"])
        self.root.option_add("*TCombobox*Listbox.foreground", c["text"])
        self.root.option_add("*TCombobox*Listbox.selectBackground", c["red"])
        self.root.option_add("*TCombobox*Listbox.selectForeground", "#ffffff")
        self.root.option_add("*TCombobox*Listbox.font", ("Segoe UI", 10))
        for cb in (getattr(self, "status_filter", None),):
            if cb is None:
                continue
            try:
                pop = str(cb.tk.call("ttk::combobox::PopdownWindow", cb))
            except Exception:
                continue
            for lb_path in (pop + ".f.l", pop + ".l"):
                try:
                    cb.tk.call(lb_path, "configure",
                               "-background", c["panel_alt"],
                               "-foreground", c["text"],
                               "-selectbackground", c["red"],
                               "-selectforeground", "#ffffff")
                    break
                except Exception:
                    continue

    def build_header(self):
        """Header matched to the VidaPay tool suite: logo on the left, a thin
        red divider, centered title, theme toggle on the far right."""
        header = tk.Frame(self.root, bg=APP_NAVY, height=108)
        header.grid(row=0, column=0, sticky="ew")
        header.grid_propagate(False)
        header._tag = "header"
        header.columnconfigure(1, weight=1)

        logo_frame = tk.Frame(header, bg=APP_NAVY)
        logo_frame.grid(row=0, column=0, sticky="nsw", padx=(18, 16), pady=12)
        logo_frame._tag = "header"

        logo_path = None
        try:
            if self.logo_path and os.path.exists(str(self.logo_path)):
                logo_path = str(self.logo_path)
        except Exception:
            pass
        # No file fallback needed: ensure_app_assets() writes the embedded
        # VidaPay logo (APP_HEADER_LOGO_PNG_BASE64). If that fails the
        # LogoHandler text placeholder ("VIDAPAY") below is used.

        self.logo_handler = LogoHandler(logo_frame)
        if logo_path and self.logo_handler.load_logo_from_file(logo_path, width=285, height=60, bg=APP_NAVY):
            self.logo_handler.pack(anchor="w")
        else:
            self.logo_handler.create_text_placeholder("VIDAPAY", color=APP_ACCENT, size=22, bg=APP_NAVY)
            self.logo_handler.pack(anchor="w")
        if getattr(self.logo_handler, "logo_widget", None) is not None:
            self.logo_handler.logo_widget._tag = "header_label"

        divider = tk.Frame(header, bg=APP_ACCENT, width=3, height=58)
        divider.grid(row=0, column=1, sticky="nsw", pady=14)
        divider.grid_propagate(False)
        divider._tag = "header"

        title_lbl = tk.Label(header, text=APP_TITLE, font=("Segoe UI", 18, "bold"), fg="#ffffff", bg=APP_NAVY, anchor="center")
        title_lbl.grid(row=0, column=0, columnspan=4, sticky="nsew")
        title_lbl.lower()
        title_lbl._tag = "header_label"

        right = tk.Frame(header, bg=APP_NAVY)
        right.grid(row=0, column=3, sticky="ne", padx=(16, 16), pady=12)
        right._tag = "header"
        self.theme_toggle_btn = tk.Button(
            right,
            text="\u2600\ufe0f" if self.theme_manager.current_theme == "dark" else "\U0001F319",
            command=self.toggle_theme,
            bg=APP_ACCENT, fg="#ffffff",
            activebackground=APP_ACCENT_DARK, activeforeground="#ffffff",
            relief=tk.FLAT, padx=14, pady=8, font=("Segoe UI", 12, "bold"),
            cursor="hand2", highlightthickness=0, borderwidth=0,
        )
        self.theme_toggle_btn.pack()
        self.theme_toggle_btn._tag = "header_label"

    def toggle_theme(self):
        """Flip dark/light, refresh ttk styles (panels) and raw-tk widget colors."""
        self.theme_manager.toggle()
        # _apply_theme() re-inits the clam theme via apply_theme_to_window,
        # which resets every custom ttk style configured before it. Re-assert
        # setup_styles() AFTER so Accent/Action/Danger buttons and cards get
        # the last word with the NEW palette.
        self._apply_theme()
        self.setup_styles()
        if hasattr(self, "theme_toggle_btn"):
            self.theme_toggle_btn.configure(
                text="\u2600\ufe0f" if self.theme_manager.current_theme == "dark" else "\U0001F319"
            )

    def _configure_tree_tags(self):
        """Treeview row-tag colors that adapt to light/dark theme."""
        try:
            c = self.theme_manager.get_colors()
        except Exception:
            c = {}
        dark = getattr(self.theme_manager, "current_theme", "light") == "dark"
        if dark:
            odd_bg  = c.get("panel",     "#141c3a")
            even_bg = c.get("panel_alt", "#1c2447")
        else:
            odd_bg  = "#ffffff"
            even_bg = "#f8fafc"
        fg = c.get("text", "#16213a")
        dim = c.get("text_dim", "#475467")
        for tree in [getattr(self, "tree", None), getattr(self, "claims_tree", None)]:
            if tree is None:
                continue
            tree.tag_configure("odd",     background=odd_bg,   foreground=fg)
            tree.tag_configure("even",    background=even_bg,  foreground=fg)
            tree.tag_configure("pending", foreground=dim)
            tree.tag_configure("running", background="#dbeafe", foreground="#1d4ed8")
            tree.tag_configure("success", background="#dcfce7", foreground="#166534")
            tree.tag_configure("failed",  background="#fee2e2", foreground="#991b1b")
            tree.tag_configure("stopped", background="#fef3c7", foreground="#92400e")
            tree.tag_configure("unknown", background="#fef3c7", foreground="#92400e")

    def _apply_theme(self, colors=None):
        """Apply theme colors to all widgets EXCEPT header/footer bar."""
        if colors is None:
            try:
                colors = self.theme_manager.get_colors()
            except Exception:
                return
        apply_theme_to_window(self.root, self.theme_manager)
        try:
            self.root.configure(bg=colors.get("bg", "#f6f7fb"))
        except Exception:
            pass
        _PROTECTED = {"header", "header_label", "footer", "footer_label", "brand", "logo", "run", "sched", "stop"}
        def _walk(widget):
            try:
                tag = getattr(widget, "_tag", None)
                if tag not in _PROTECTED:
                    bg = colors.get("bg", "#f6f7fb")
                    fg = colors.get("text", "#16213a")
                    if isinstance(widget, tk.Frame):
                        widget.configure(bg=bg)
                    elif isinstance(widget, tk.Label):
                        widget.configure(bg=bg, fg=fg)
                    elif isinstance(widget, tk.Entry):
                        widget.configure(bg=colors.get("input", "#ffffff"), fg=fg)
                    elif isinstance(widget, tk.Button):
                        widget.configure(bg=bg, fg=fg)
                    elif isinstance(widget, scrolledtext.ScrolledText):
                        widget.configure(
                            bg=colors.get("panel", "#ffffff"),
                            fg=fg,
                            insertbackground=fg
                        )
                for child in widget.winfo_children():
                    _walk(child)
            except Exception:
                pass
        _walk(self.root)
        self._configure_tree_tags()
        if hasattr(self, "log_box"):
            try:
                self.log_box.configure(
                    bg=colors.get("log_bg", "#0f1830"),
                    fg=colors.get("log_fg", "#e2e8f0"),
                    insertbackground=colors.get("log_fg", "#e2e8f0"),
                )
            except Exception:
                pass


    def build_toolbar(self):
        toolbar_frame = tk.Frame(self.root)
        toolbar_frame.grid(row=1, column=0, sticky="ew", padx=10, pady=5)
        toolbar_frame.grid_columnconfigure(0, weight=1)
        toolbar = ttk.Frame(toolbar_frame, style="Toolbar.TFrame", padding=(16, 10, 16, 10))
        toolbar.grid(row=0, column=0, sticky="ew")
        toolbar.grid_columnconfigure(0, weight=1)

        search_frame = ttk.Frame(toolbar, style="Toolbar.TFrame")
        search_frame.grid(row=0, column=0, sticky="ew")
        search_frame.grid_columnconfigure(1, weight=1)
        ttk.Label(search_frame, text="Search", style="Subtle.TLabel").grid(row=0, column=0, padx=(0, 8), sticky="w")
        self.search_entry = ttk.Entry(search_frame, textvariable=self.search_var, font=("Segoe UI", 10))
        self.search_entry.grid(row=0, column=1, sticky="ew", padx=(0, 12), ipady=5)
        self.search_entry.bind("<KeyRelease>", lambda event: self.apply_filter())
        ttk.Label(search_frame, text="Status", style="Subtle.TLabel").grid(row=0, column=2, padx=(0, 8), sticky="w")
        self.status_filter = ttk.Combobox(search_frame, textvariable=self.status_filter_var, values=("All", "Pending", "Running", "Submitted", "Failed", "Stopped"), state="readonly", width=12)
        self.status_filter.grid(row=0, column=3, sticky="w", padx=(0, 12), ipady=4)
        self.status_filter.bind("<<ComboboxSelected>>", lambda event: self.apply_filter())
        self.show_passwords_check = ttk.Checkbutton(search_frame, text="Show Passwords", variable=self.show_passwords_var, command=self.refresh_password_column)
        self.show_passwords_check.grid(row=0, column=4, sticky="w", padx=(0, 12))
        ttk.Button(search_frame, text="Clear Filter", style="Action.TButton", command=self.clear_filters).grid(row=0, column=5, sticky="e")

        buttons = ttk.Frame(toolbar, style="Toolbar.TFrame")
        buttons.grid(row=1, column=0, sticky="ew", pady=(10, 0))
        buttons.grid_columnconfigure(14, weight=1)
        self.vpn_setup_btn = ttk.Button(buttons, text="Open VPN Browser Setup", style="Accent.TButton", command=self.open_vpn_setup)
        self.vpn_setup_btn.grid(row=0, column=0, padx=(0, 8), sticky="w")
        self.import_logins_btn = ttk.Button(buttons, text="Import Logins (Excel)", style="Accent.TButton", command=self.import_logins_from_excel)
        self.import_logins_btn.grid(row=0, column=1, padx=(0, 8), sticky="w")
        self.import_rebates_btn = ttk.Button(buttons, text="Import Rebates (Excel)", style="Accent.TButton", command=self.import_rebates_from_excel)
        self.import_rebates_btn.grid(row=0, column=2, padx=(0, 8), sticky="w")
        self.start_btn = ttk.Button(buttons, text="Start Filing", style="Accent.TButton", command=self.start_filing)
        self.start_btn.grid(row=0, column=3, padx=(0, 8), sticky="w")
        self.stop_btn = ttk.Button(buttons, text="Stop", style="Danger.TButton", command=self.stop_run, state="disabled")
        self.stop_btn.grid(row=0, column=4, padx=(0, 8), sticky="w")
        self.skip_btn = ttk.Button(buttons, text="Skip Store", style="Danger.TButton", command=self.skip_store, state="disabled")
        self.skip_btn.grid(row=0, column=5, padx=(0, 8), sticky="w")
        self.add_store_btn = ttk.Button(buttons, text="Add Store", style="Action.TButton", command=self.add_store)
        self.add_store_btn.grid(row=0, column=6, padx=(0, 8), sticky="w")
        self.edit_store_btn = ttk.Button(buttons, text="Edit Selected", style="Action.TButton", command=self.edit_selected_store)
        self.edit_store_btn.grid(row=0, column=7, padx=(0, 8), sticky="w")
        self.change_password_btn = ttk.Button(buttons, text="Change Password", style="Action.TButton", command=self.change_selected_password)
        self.change_password_btn.grid(row=0, column=8, padx=(0, 8), sticky="w")
        self.remove_store_btn = ttk.Button(buttons, text="Remove Selected", style="Danger.TButton", command=self.remove_selected_store)
        self.remove_store_btn.grid(row=0, column=9, padx=(0, 8), sticky="w")
        self.mark_pending_btn = ttk.Button(buttons, text="Reset Claim Status", style="Action.TButton", command=self.mark_selected_claims_pending)
        self.mark_pending_btn.grid(row=0, column=10, padx=(0, 8), sticky="w")
        self.logs_btn = ttk.Button(buttons, text="Open Logs Folder", style="Action.TButton", command=self.open_logs_folder)
        self.logs_btn.grid(row=0, column=11, padx=(0, 8), sticky="w")
        self.clear_log_btn = ttk.Button(buttons, text="Clear Log", style="Action.TButton", command=self.clear_log)
        self.clear_log_btn.grid(row=0, column=14, sticky="e")

        wa = ttk.Frame(toolbar, style="Toolbar.TFrame")
        wa.grid(row=2, column=0, sticky="ew", pady=(10, 0))
        ttk.Label(wa, text="Default Appeal Comment", style="Subtle.TLabel").grid(row=0, column=0, padx=(0, 8), sticky="w")
        self.appeal_comment_entry = ttk.Entry(wa, textvariable=self.appeal_comment_var, font=("Segoe UI", 10))
        self.appeal_comment_entry.grid(row=0, column=1, padx=(0, 16), ipady=4, sticky="ew")
        wa.grid_columnconfigure(1, weight=1)

        ttk.Label(wa, text="WhatsApp 2FA Group", style="Subtle.TLabel").grid(row=0, column=2, padx=(0, 8), sticky="w")
        self.whatsapp_group_var = tk.StringVar(value=_vp_get("whatsapp_group", ""))
        ttk.Entry(wa, textvariable=self.whatsapp_group_var, width=22, font=("Segoe UI", 10)).grid(row=0, column=3, padx=(0, 12), ipady=4, sticky="w")

        ttk.Label(wa, text="WhatsApp:", style="Subtle.TLabel").grid(row=0, column=4, padx=(0, 6), sticky="w")
        self.wa_mode_var = tk.StringVar(value=_vp_get("whatsapp_mode", "desktop"))
        ttk.Radiobutton(wa, text="Desktop", variable=self.wa_mode_var, value="desktop",
                        style="TRadiobutton").grid(row=0, column=5, padx=(0, 4), sticky="w")
        ttk.Radiobutton(wa, text="Web", variable=self.wa_mode_var, value="web",
                        style="TRadiobutton").grid(row=0, column=6, padx=(0, 12), sticky="w")

        ttk.Button(wa, text="Save All Info", style="Accent.TButton", command=self.vp_save_all).grid(row=0, column=7, sticky="w")

    def vp_save_all(self):
        global _WA_GROUP_NAME, _WA_MODE
        grp = self.whatsapp_group_var.get().strip()
        mode = self.wa_mode_var.get()
        comment = self.appeal_comment_var.get().strip() or DEFAULT_APPEAL_COMMENT
        _WA_GROUP_NAME = grp
        _WA_MODE = mode
        cfg = _vp_config_load()
        cfg["whatsapp_group"] = grp
        cfg["whatsapp_mode"] = mode
        cfg["appeal_comment"] = comment
        cfg["stores"] = [clean_store_record(st) for st in STORES]
        _vp_config_save(cfg)
        self.log("Saved comment, WhatsApp group and %d store login(s) securely (encrypted)." % len(STORES))
        messagebox.showinfo("Saved", "All info saved (encrypted). It loads automatically next time.")

    def build_main_area(self):
        main = ttk.Frame(self.root, style="Main.TFrame", padding=(16, 0, 16, 8))
        main.grid(row=2, column=0, sticky="nsew")
        main.grid_rowconfigure(1, weight=1)
        main.grid_columnconfigure(0, weight=1)
        self.build_cards(main)

        paned = ttk.PanedWindow(main, orient="horizontal")
        paned.grid(row=1, column=0, sticky="nsew", pady=(10, 0))

        left_paned = ttk.PanedWindow(paned, orient="vertical")
        paned.add(left_paned, weight=3)

        # ── Stores card ──────────────────────────────────────────────────────
        table_card = ttk.Frame(left_paned, style="Card.TFrame", padding=(10, 10))
        table_card.grid_rowconfigure(1, weight=1)
        table_card.grid_columnconfigure(0, weight=1)
        table_header = ttk.Frame(table_card, style="Card.TFrame")
        table_header.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        table_header.grid_columnconfigure(0, weight=1)
        ttk.Label(table_header, text="Store Logins", style="CardValue.TLabel").grid(row=0, column=0, sticky="w")
        self.logins_template_btn = ttk.Button(table_header, text="Download Logins Template", style="Action.TButton", command=self.download_logins_template)
        self.logins_template_btn.grid(row=0, column=1, sticky="e", padx=(0, 10))
        self.selected_label = ttk.Label(table_header, textvariable=self.selected_text_var, style="CardTitle.TLabel")
        self.selected_label.grid(row=0, column=2, sticky="e")

        tree_frame = ttk.Frame(table_card, style="Card.TFrame")
        tree_frame.grid(row=1, column=0, sticky="nsew")
        tree_frame.grid_rowconfigure(0, weight=1)
        tree_frame.grid_columnconfigure(0, weight=1)
        columns = ("no", "store", "account_id", "username", "password", "claims", "status", "last_result")
        self.tree = ttk.Treeview(tree_frame, columns=columns, show="headings", selectmode="extended", height=10)
        for col, label in (("no", "#"), ("store", "Store Name"), ("account_id", "Account ID"), ("username", "Username"), ("password", "Password"), ("claims", "Claims"), ("status", "Status"), ("last_result", "Last Result")):
            self.tree.heading(col, text=label, command=lambda c=col: self.sort_tree(c, False))
        self.tree.column("no", width=54, minwidth=48, anchor="center", stretch=False)
        self.tree.column("store", width=230, minwidth=160, anchor="w", stretch=True)
        self.tree.column("account_id", width=110, minwidth=95, anchor="center", stretch=False)
        self.tree.column("username", width=115, minwidth=95, anchor="center", stretch=False)
        self.tree.column("password", width=125, minwidth=105, anchor="center", stretch=False)
        self.tree.column("claims", width=80, minwidth=65, anchor="center", stretch=False)
        self.tree.column("status", width=100, minwidth=90, anchor="center", stretch=False)
        self.tree.column("last_result", width=220, minwidth=150, anchor="w", stretch=True)
        y_scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        x_scrollbar = ttk.Scrollbar(tree_frame, orient="horizontal", command=self.tree.xview)
        self.tree.configure(yscrollcommand=y_scrollbar.set, xscrollcommand=x_scrollbar.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        y_scrollbar.grid(row=0, column=1, sticky="ns")
        x_scrollbar.grid(row=1, column=0, sticky="ew")
        self.tree.bind("<<TreeviewSelect>>", lambda event: self.update_selected_count())
        self.tree.bind("<Button-3>", self.show_tree_menu)
        left_paned.add(table_card, weight=1)

        # ── Rebates card ─────────────────────────────────────────────────────
        claims_card = ttk.Frame(left_paned, style="Card.TFrame", padding=(10, 10))
        claims_card.grid_rowconfigure(1, weight=1)
        claims_card.grid_columnconfigure(0, weight=1)
        claims_header = ttk.Frame(claims_card, style="Card.TFrame")
        claims_header.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        claims_header.grid_columnconfigure(0, weight=1)
        ttk.Label(claims_header, text="Rebate Claims", style="CardValue.TLabel").grid(row=0, column=0, sticky="w")
        self.rebates_template_btn = ttk.Button(claims_header, text="Download Rebates Template", style="Action.TButton", command=self.download_rebates_template)
        self.rebates_template_btn.grid(row=0, column=1, sticky="e", padx=(0, 10))
        ttk.Label(claims_header, textvariable=self.claims_total_text_var, style="CardTitle.TLabel").grid(row=0, column=2, sticky="e")

        claims_frame = ttk.Frame(claims_card, style="Card.TFrame")
        claims_frame.grid(row=1, column=0, sticky="nsew")
        claims_frame.grid_rowconfigure(0, weight=1)
        claims_frame.grid_columnconfigure(0, weight=1)
        claim_columns = ("rno", "store", "imei", "activation_date", "type", "amount", "status", "message")
        self.claims_tree = ttk.Treeview(claims_frame, columns=claim_columns, show="headings", selectmode="extended", height=10)
        for col, label in (("rno", "#"), ("store", "Store"), ("imei", "IMEI"), ("activation_date", "Activation Date"), ("type", "Type"), ("amount", "Amount"), ("status", "Status"), ("message", "Message")):
            self.claims_tree.heading(col, text=label, command=lambda c=col: self.sort_claims_tree(c, False))
        self.claims_tree.column("rno", width=50, minwidth=44, anchor="center", stretch=False)
        self.claims_tree.column("store", width=170, minwidth=120, anchor="w", stretch=True)
        self.claims_tree.column("imei", width=140, minwidth=110, anchor="center", stretch=False)
        self.claims_tree.column("activation_date", width=115, minwidth=95, anchor="center", stretch=False)
        self.claims_tree.column("type", width=125, minwidth=95, anchor="center", stretch=False)
        self.claims_tree.column("amount", width=80, minwidth=65, anchor="e", stretch=False)
        self.claims_tree.column("status", width=95, minwidth=85, anchor="center", stretch=False)
        self.claims_tree.column("message", width=220, minwidth=140, anchor="w", stretch=True)
        claims_y = ttk.Scrollbar(claims_frame, orient="vertical", command=self.claims_tree.yview)
        claims_x = ttk.Scrollbar(claims_frame, orient="horizontal", command=self.claims_tree.xview)
        self.claims_tree.configure(yscrollcommand=claims_y.set, xscrollcommand=claims_x.set)
        self.claims_tree.grid(row=0, column=0, sticky="nsew")
        claims_y.grid(row=0, column=1, sticky="ns")
        claims_x.grid(row=1, column=0, sticky="ew")
        self.claims_tree.bind("<Button-3>", self.show_claims_tree_menu)
        left_paned.add(claims_card, weight=1)

        # ── Process log card ─────────────────────────────────────────────────
        log_card = ttk.Frame(paned, style="Card.TFrame", padding=(10, 10))
        log_card.grid_rowconfigure(1, weight=1)
        log_card.grid_columnconfigure(0, weight=1)
        log_header = ttk.Frame(log_card, style="Card.TFrame")
        log_header.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        log_header.grid_columnconfigure(0, weight=1)
        ttk.Label(log_header, text="Process Log", style="CardValue.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Button(log_header, text="Copy Log", style="Action.TButton", command=self.copy_log).grid(row=0, column=1, sticky="e", padx=(0, 8))
        ttk.Button(log_header, text="Clear", style="Action.TButton", command=self.clear_log).grid(row=0, column=2, sticky="e")
        _log_c = self.theme_manager.get_colors()
        self.log_box = scrolledtext.ScrolledText(
            log_card, height=12, font=("Consolas", 10), wrap="word", bd=0, relief="flat",
            bg=_log_c.get("log_bg", "#0f1830"), fg=_log_c.get("log_fg", "#e2e8f0"),
            insertbackground=_log_c.get("log_fg", "#e2e8f0"),
        )
        self.log_box.grid(row=1, column=0, sticky="nsew")

        self.context_menu = tk.Menu(self.root, tearoff=0)
        self.context_menu.add_command(label="Edit Selected Store", command=self.edit_selected_store)
        self.context_menu.add_command(label="Change Selected Password", command=self.change_selected_password)
        self.context_menu.add_command(label="Mark as Pending", command=self.mark_selected_pending)
        self.context_menu.add_separator()
        self.context_menu.add_command(label="Copy Selected Store Info", command=self.copy_selected_store_info)

        self.claims_context_menu = tk.Menu(self.root, tearoff=0)
        self.claims_context_menu.add_command(label="Reset Selected Claim(s) to Pending", command=self.mark_selected_claims_pending)
        self.claims_context_menu.add_command(label="Copy Selected Claim Info", command=self.copy_selected_claim_info)

        paned.add(log_card, weight=2)

    def build_cards(self, parent):
        cards = ttk.Frame(parent, style="Main.TFrame")
        cards.grid(row=0, column=0, sticky="ew")
        for column in range(5):
            cards.grid_columnconfigure(column, weight=1)
        self.create_stat_card(cards, 0, "TOTAL STORES", self.total_text_var)
        self.create_stat_card(cards, 1, "CURRENT", self.current_store_var)
        self.create_stat_card(cards, 2, "SUBMITTED", self.submitted_text_var)
        self.create_stat_card(cards, 3, "FAILED", self.failed_text_var)
        progress_card = ttk.Frame(cards, style="Card.TFrame", padding=(14, 10))
        progress_card.grid(row=0, column=4, sticky="ew", padx=(8, 0))
        progress_card.grid_columnconfigure(0, weight=1)
        ttk.Label(progress_card, text="PROGRESS", style="CardTitle.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(progress_card, textvariable=self.progress_text_var, style="CardValue.TLabel").grid(row=1, column=0, sticky="w", pady=(2, 6))
        self.progress = ttk.Progressbar(progress_card, variable=self.progress_var, maximum=100, mode="determinate")
        self.progress.grid(row=2, column=0, sticky="ew")

    def create_stat_card(self, parent, column, title, variable):
        card = ttk.Frame(parent, style="Card.TFrame", padding=(14, 10))
        card.grid(row=0, column=column, sticky="ew", padx=(0, 8))
        card.grid_columnconfigure(0, weight=1)
        ttk.Label(card, text=title, style="CardTitle.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(card, textvariable=variable, style="CardValue.TLabel").grid(row=1, column=0, sticky="w", pady=(2, 0))

    def build_footer(self):
        footer = ttk.Frame(self.root, style="Main.TFrame", padding=(16, 0, 16, 12))
        footer.grid(row=3, column=0, sticky="ew")
        footer.grid_columnconfigure(0, weight=1)
        ttk.Label(footer, text=f"Automation profile: {AUTOMATION_PROFILE_DIR}", style="Subtle.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(footer, text="Logins are shared (encrypted) with VidaPay Incentive Dashboard Extractor on this PC.", style="Subtle.TLabel").grid(row=0, column=1, sticky="e")

    def write_startup_steps(self):
        self.log(f"{APP_TITLE} loaded.")
        self.log("Step 1: Click Open VPN Browser Setup and connect VPN inside that Edge window.")
        self.log("Step 2: Import Logins (Excel) — deletes ALL existing logins, then imports the Excel rows.")
        self.log("         Login Excel columns: store, account_id, username, password (same as the Extractor).")
        self.log("Step 3: Import Rebates (Excel) — columns: imei, activation date, type, amount (+ store or account id, optional comments).")
        self.log("         Type accepts: Rebate, Spiff / 1st month spiff, Second Month, Device Margin, ...")
        self.log("Step 4: Press Start Filing — each store is logged in, the Activations & Commissions page opens directly, the Month-to-Date filter is clicked, then filing starts.")
        self.log("Step 5: Per IMEI/spiff: Create an appeal > IMEI and Activation Date > pre-filled fields are auto-cleared > IMEI + date + type + amount + comments > Submit.")
        self.log("Step 6: Every IMEI shows Submitted / Failed here, and an Excel filing log is saved after the run.")
        self.log(f"Rebate filing logs will save here: {DOWNLOAD_DIR}")
        self.log("Step 7: If Verify human appears, complete it manually in the Edge window — the script continues automatically.")
        self.log("Step 8: 2FA (IBM Verify) must be approved on the phone, or the WhatsApp alert group is notified.")


    def password_display(self, password):
        if self.show_passwords_var.get():
            return password
        return "•" * min(max(len(str(password)), 6), 12)

    def save_store_data(self):
        return persist_stores_to_hardcoded_data(STORES, log=self.log)

    def add_store(self):
        if self.running:
            return
        dialog = StoreFormDialog(self.root, "Add Store")
        if not dialog.result:
            return
        new_store = clean_store_record(dialog.result)
        for store in STORES:
            if store["account_id"] == new_store["account_id"]:
                messagebox.showerror("Duplicate Account ID", f"Account ID {new_store['account_id']} already exists for {store['store']}.")
                return
        STORES.append(new_store)
        self.load_store_rows()
        self.save_store_data()
        self.log(f"Added store: {new_store['store']} / {new_store['account_id']}")
        self.select_store_by_account_id(new_store["account_id"])

    def edit_selected_store(self):
        if self.running:
            return
        selected = self.tree.selection()
        if len(selected) != 1:
            messagebox.showwarning("Select One Store", "Select exactly one store to edit.")
            return
        iid = selected[0]
        index = self.store_index_by_iid.get(iid)
        if index is None:
            return
        old_store = STORES[index]
        dialog = StoreFormDialog(self.root, "Edit Store", initial=old_store)
        if not dialog.result:
            return
        updated_store = clean_store_record(dialog.result)
        for other_index, store in enumerate(STORES):
            if other_index != index and store["account_id"] == updated_store["account_id"]:
                messagebox.showerror("Duplicate Account ID", f"Account ID {updated_store['account_id']} already exists for {store['store']}.")
                return
        STORES[index] = updated_store
        self.load_store_rows()
        self.save_store_data()
        self.log(f"Updated store: {updated_store['store']} / {updated_store['account_id']}")
        self.select_store_by_account_id(updated_store["account_id"])

    def remove_selected_store(self):
        if self.running:
            return
        selected = self.tree.selection()
        if not selected:
            messagebox.showwarning("No Store Selected", "Select one or more store rows to remove.")
            return
        indices = sorted({self.store_index_by_iid.get(iid) for iid in selected if self.store_index_by_iid.get(iid) is not None}, reverse=True)
        if not indices:
            return
        names = [STORES[i]["store"] for i in indices]
        if not messagebox.askyesno("Remove Store(s)", "Remove %d store login(s)?\n\n%s" % (len(indices), ", ".join(names))):
            return
        for i in indices:
            del STORES[i]
        self.load_store_rows()
        self.save_store_data()
        self.log("Removed %d store login(s): %s" % (len(names), ", ".join(names)))

    def change_selected_password(self):
        if self.running:
            return
        selected = self.tree.selection()
        if not selected:
            messagebox.showwarning("No Store Selected", "Select one or more store rows first.")
            return
        initial = {"password": STORES[self.store_index_by_iid[selected[0]]]["password"]}
        dialog = StoreFormDialog(self.root, "Change Password", initial=initial, password_only=True)
        if not dialog.result:
            return
        new_password = dialog.result["password"]
        changed = 0
        changed_names = []
        for iid in selected:
            index = self.store_index_by_iid.get(iid)
            if index is None:
                continue
            STORES[index]["password"] = new_password
            changed += 1
            changed_names.append(STORES[index]["store"])
        self.refresh_password_column()
        self.save_store_data()
        self.log(f"Password updated for {changed} store login(s): {', '.join(changed_names)}")

    def refresh_password_column(self):
        if not hasattr(self, "tree"):
            return
        for iid, index in self.store_index_by_iid.items():
            values = list(self.tree.item(iid, "values"))
            while len(values) < 8:
                values.append("")
            values[4] = self.password_display(STORES[index].get("password", ""))
            self.tree.item(iid, values=values)
        self.apply_filter()

    def select_store_by_account_id(self, account_id):
        for iid, index in self.store_index_by_iid.items():
            if STORES[index]["account_id"] == account_id:
                self.tree.selection_set(iid)
                self.tree.see(iid)
                self.update_selected_count()
                return

    def load_store_rows(self):
        if not hasattr(self, "tree"):
            return
        self.tree.delete(*self.tree.get_children())
        self.store_index_by_iid.clear()
        for index, store in enumerate(STORES, start=1):
            iid = str(index - 1)
            self.store_index_by_iid[iid] = index - 1
            tag = "even" if index % 2 == 0 else "odd"
            claim_count = self.claim_count_for_store(store)
            self.tree.insert("", "end", iid=iid, values=(index, store["store"], store["account_id"], store["username"], self.password_display(store.get("password", "")), claim_count, "Pending", "Ready"), tags=(tag, "pending"))
        self.apply_filter()
        self.update_selected_count()

    def claim_count_for_store(self, store):
        count = 0
        for claim in CLAIMS:
            matched = match_claim_store(claim)
            if matched is not None and matched.get("account_id") == store.get("account_id"):
                count += 1
        return count

    def apply_filter(self):
        if not hasattr(self, "tree"):
            return
        query = self.search_var.get().strip().lower()
        status_filter = self.status_filter_var.get().strip().lower()
        self.visible_iids = []
        for iid in list(self.store_index_by_iid.keys()):
            values = self.tree.item(iid, "values")
            row_status = str(values[6]).lower() if len(values) >= 7 else "pending"
            index = self.store_index_by_iid.get(iid)
            store = STORES[index] if index is not None else {}
            searchable_values = list(values) + [store.get("password", "")]
            row_text = " ".join(str(value).lower() for value in searchable_values)
            query_match = not query or query in row_text
            status_match = status_filter == "all" or row_status == status_filter
            if query_match and status_match:
                self.tree.reattach(iid, "", "end")
                self.visible_iids.append(iid)
            else:
                self.tree.detach(iid)
        self.total_text_var.set(f"Stores: {len(self.visible_iids)} / {len(STORES)}")
        self.update_selected_count()

    def clear_filters(self):
        self.search_var.set("")
        self.status_filter_var.set("All")
        self.apply_filter()
        self.search_entry.focus_set()

    def sort_tree(self, column, reverse):
        rows = []
        for iid in self.visible_iids:
            value = self.tree.set(iid, column)
            if column in ("no", "account_id", "claims"):
                try:
                    sort_value = int(value)
                except Exception:
                    sort_value = value
            else:
                sort_value = str(value).lower()
            rows.append((sort_value, iid))
        rows.sort(reverse=reverse)
        for position, (_, iid) in enumerate(rows):
            self.tree.move(iid, "", position)
        self.tree.heading(column, command=lambda: self.sort_tree(column, not reverse))

    def sort_claims_tree(self, column, reverse):
        rows = []
        for iid in self.claim_index_by_iid.keys():
            value = self.claims_tree.set(iid, column)
            if column in ("rno", "amount"):
                try:
                    sort_value = float(value)
                except Exception:
                    sort_value = value
            else:
                sort_value = str(value).lower()
            rows.append((sort_value, iid))
        rows.sort(reverse=reverse)
        for position, (_, iid) in enumerate(rows):
            self.claims_tree.move(iid, "", position)
        self.claims_tree.heading(column, command=lambda: self.sort_claims_tree(column, not reverse))

    def update_selected_count(self):
        selected_count = len(self.tree.selection()) if hasattr(self, "tree") else 0
        self.selected_text_var.set(f"Selected: {selected_count}")

    def update_row_status(self, store_data, status, message=""):
        def apply_update():
            iid = self.find_iid_by_store(store_data)
            if iid is None:
                return
            values = list(self.tree.item(iid, "values"))
            while len(values) < 8:
                values.append("")
            values[6] = status
            values[7] = message or status
            tag_status = status.strip().lower()
            base_tag = "even" if int(values[0]) % 2 == 0 else "odd"
            allowed_tags = {"pending", "running", "success", "failed", "stopped"}
            if tag_status not in allowed_tags:
                tag_status = "pending"
            self.tree.item(iid, values=values, tags=(base_tag, tag_status))
            if status in ("Running", "Failed", "Success", "Stopped"):
                try:
                    self.tree.see(iid)
                except Exception:
                    pass
            self.apply_filter()
        self.root.after(0, apply_update)

    def find_iid_by_store(self, store_data):
        for iid, index in self.store_index_by_iid.items():
            store = STORES[index]
            if store["store"] == store_data["store"] and store["account_id"] == store_data["account_id"]:
                return iid
        return None

    def mark_selected_pending(self):
        selected = self.tree.selection()
        for iid in selected:
            index = self.store_index_by_iid.get(iid)
            if index is not None:
                self.update_row_status(STORES[index], "Pending", "Ready")

    def open_vpn_setup(self):
        if self.running:
            messagebox.showwarning("Process Running", "Stop the current process before opening VPN setup.")
            return
        result = open_vpn_setup_browser(log=self.log)
        if result:
            self.log("VPN Browser Setup Edge window is ready. Connect VPN inside it and keep it open.")

    def open_logs_folder(self):
        folder = Path(DOWNLOAD_DIR)
        folder.mkdir(parents=True, exist_ok=True)
        try:
            os.startfile(str(folder))
        except Exception as e:
            messagebox.showerror("Open Logs Folder Failed", str(e))

    def get_selected_stores(self):
        selected = self.tree.selection()
        if not selected:
            messagebox.showwarning("No Store Selected", "Select one or more store rows first.")
            return []
        stores = []
        for iid in selected:
            index = self.store_index_by_iid.get(iid)
            if index is not None:
                stores.append(STORES[index])
        return stores

    def get_filtered_stores(self):
        stores = []
        for iid in self.visible_iids:
            index = self.store_index_by_iid.get(iid)
            if index is not None:
                stores.append(STORES[index])
        return stores

    # ======================================================================
    # IMPORT LOGINS (Excel) — deletes ALL existing logins first, then imports
    # ======================================================================

    def import_logins_from_excel(self):
        if self.running:
            messagebox.showwarning("Process Running", "Stop the current process before importing logins.")
            return
        try:
            import openpyxl  # noqa: F401
        except ImportError:
            messagebox.showerror(
                "Missing Dependency",
                "openpyxl is required for Excel import.\n\nInstall it with:\n  pip install openpyxl",
            )
            return

        if STORES:
            confirm = messagebox.askyesno(
                "Replace All Logins",
                "This will DELETE all %d existing store login(s) and replace them with the rows in the Excel file.\n\nContinue?" % len(STORES),
            )
            if not confirm:
                return

        file_path = filedialog.askopenfilename(
            title="Select Excel file with store logins",
            filetypes=[("Excel files", "*.xlsx *.xls"), ("All files", "*.*")],
        )
        if not file_path:
            return

        logins, skipped, errors = parse_login_workbook_rows(file_path, log=self.log)

        if not logins:
            detail = "\n".join(errors[:10]) if errors else "No valid rows were found."
            messagebox.showerror("Import Failed", "No store logins were imported.\n\n" + detail)
            self.log("Login import produced 0 usable rows.")
            return

        old_count = len(STORES)
        STORES[:] = [clean_store_record(entry) for entry in logins]
        self.load_store_rows()
        persist_ok = self.save_store_data()

        summary = (
            "Login import complete.\n\n"
            f"  Deleted:  {old_count} old login(s)\n"
            f"  Imported: {len(logins)} new login(s)\n"
            f"  Skipped:  {skipped} row(s)\n"
        )
        if errors:
            summary += "\nRow errors (%d):\n" % len(errors) + "\n".join(errors[:10])
        if not persist_ok:
            summary += "\n\nWarning: Changes are in memory but could not be saved to encrypted storage."
        else:
            summary += "\n\nThese logins are now shared with the VidaPay Incentive Dashboard Extractor."
        messagebox.showinfo("Import Result", summary)
        self.log(f"Login import: deleted={old_count}, imported={len(logins)}, skipped={skipped}")

    # ======================================================================
    # IMPORT REBATES (Excel)
    # ======================================================================

    def import_rebates_from_excel(self):
        if self.running:
            messagebox.showwarning("Process Running", "Stop the current process before importing rebates.")
            return
        try:
            import openpyxl  # noqa: F401
        except ImportError:
            messagebox.showerror(
                "Missing Dependency",
                "openpyxl is required for Excel import.\n\nInstall it with:\n  pip install openpyxl",
            )
            return

        file_path = filedialog.askopenfilename(
            title="Select Excel file with rebate information",
            filetypes=[("Excel files", "*.xlsx *.xls"), ("All files", "*.*")],
        )
        if not file_path:
            return

        claims, skipped, errors = parse_rebate_workbook_rows(file_path, log=self.log)

        if not claims:
            detail = "\n".join(errors[:12]) if errors else "No valid rows were found."
            messagebox.showerror("Import Failed", "No rebate claims were imported.\n\n" + detail)
            self.log("Rebate import produced 0 usable rows.")
            return

        if CLAIMS:
            replace = messagebox.askyesno(
                "Replace Existing Claims",
                "There are %d existing claim row(s). Replace them with this import?\n\n"
                "Yes = replace all rows with this file\n"
                "No = append this file to the existing rows" % len(CLAIMS),
            )
            if replace:
                CLAIMS[:] = claims
            else:
                CLAIMS.extend(claims)
        else:
            CLAIMS[:] = claims

        self.load_claim_rows()
        self.load_store_rows()

        unmatched = [c for c in CLAIMS if match_claim_store(c) is None]
        summary = (
            "Rebate import complete.\n\n"
            f"  Imported: {len(claims)} claim row(s)\n"
            f"  Skipped:  {skipped} row(s)\n"
        )
        if unmatched:
            summary += (
                f"\n  No matching login yet: {len(unmatched)} claim row(s)"
                "\n  (their store name / account id must exist under Import Logins before filing)"
            )
        if errors:
            summary += "\n\nRow errors (%d):\n" % len(errors) + "\n".join(errors[:12])
        messagebox.showinfo("Import Result", summary)
        self.log(f"Rebate import: imported={len(claims)}, skipped={skipped}, unmatched_stores={len(unmatched)}")

    # ======================================================================
    # DOWNLOAD IMPORT TEMPLATES (Excel)
    # ======================================================================

    def download_logins_template(self):
        """Generates an Excel template pre-filled with the logins import
        columns (store | account_id | username | password) and example rows."""
        self._save_import_template(
            sheet_title="Logins",
            initial_file="VidaPay_Logins_Template.xlsx",
            headers=["store", "account_id", "username", "password"],
            example_rows=[
                ["Store 1", "0001", "user1@example.com", "password123"],
                ["Store 2", "0002", "user2@example.com", "password456"],
            ],
            column_hint="store | account_id | username | password",
            done_note="Replace the two example rows with real store logins, then use Import Logins (Excel).",
        )

    def download_rebates_template(self):
        """Generates an Excel template pre-filled with the rebates import
        columns (store / account_id | imei | activation date | type | amount
        | comments) and example rows."""
        self._save_import_template(
            sheet_title="Rebates",
            initial_file="VidaPay_Rebates_Template.xlsx",
            headers=["store", "account_id", "imei", "activation date", "type", "amount", "comments"],
            example_rows=[
                ["Store 1", "0001", "350000000000123", "09/01/2026", "Rebate", 50.00, ""],
                ["Store 2", "0002", "350000000000124", "09/02/2026", "Activation Spiff", 25.00, ""],
            ],
            column_hint="store / account_id | imei | activation date | type | amount | comments (optional)",
            done_note=("Replace the two example rows with real claims — store OR account_id must match an "
                       "imported login.\nActivation date = MM/DD/YYYY. Type examples: Rebate, Activation "
                       "Spiff, Second Month, Device Margin."),
        )

    def _save_import_template(self, sheet_title, initial_file, headers, example_rows, column_hint, done_note):
        """Shared helper: builds and saves one import template workbook with
        the import columns already defined in the header row."""
        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill
            from openpyxl.utils import get_column_letter
        except ImportError:
            messagebox.showerror(
                "Missing Dependency",
                "openpyxl is required to build the template.\n\nInstall it with:\n  pip install openpyxl",
            )
            return

        save_path = filedialog.asksaveasfilename(
            title="Save import template",
            defaultextension=".xlsx",
            initialfile=initial_file,
            filetypes=[("Excel file", "*.xlsx")],
        )
        if not save_path:
            return

        try:
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = sheet_title

            header_fill = PatternFill("solid", fgColor="090D26")
            for c, name in enumerate(headers, start=1):
                cell = ws.cell(row=1, column=c, value=name)
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = header_fill
                ws.column_dimensions[get_column_letter(c)].width = 28

            for row in example_rows:
                ws.append(row)

            wb.save(save_path)
        except Exception as exc:
            messagebox.showerror("Template Failed", f"Could not create the template:\n\n{exc}")
            return

        messagebox.showinfo(
            "Template Ready",
            f"Template saved:\n{save_path}\n\n"
            f"Columns: {column_hint}\n\n"
            f"{done_note}",
        )
        self.log(f"Import template saved: {save_path}")

    # ======================================================================
    # CLAIM TREE
    # ======================================================================

    def load_claim_rows(self):
        if not hasattr(self, "claims_tree"):
            return
        self.claims_tree.delete(*self.claims_tree.get_children())
        self.claim_index_by_iid.clear()
        type_label_by_value = {value: label for value, label in APPEAL_TYPE_OPTIONS}
        for index, claim in enumerate(CLAIMS, start=1):
            iid = f"claim-{index - 1}"
            self.claim_index_by_iid[iid] = index - 1
            tag = "even" if index % 2 == 0 else "odd"
            status = claim.get("status", CLAIM_STATUS_PENDING)
            status_tag = status.strip().lower()
            if status_tag not in ("pending", "running", "submitted", "failed", "stopped", "unknown"):
                status_tag = "pending"
            type_label = type_label_by_value.get(claim.get("type_value"), claim.get("type_raw", ""))
            values = (
                index,
                claim.get("store", "") or "(by account id)",
                claim.get("imei", ""),
                claim.get("activation_date", ""),
                type_label,
                claim.get("amount", ""),
                status,
                claim.get("message", ""),
            )
            self.claims_tree.insert("", "end", iid=iid, values=values, tags=(tag, status_tag))
        self.claims_total_text_var.set(f"Claims: {len(CLAIMS)}")
        self.refresh_store_claim_counts()
        self.update_progress()

    def refresh_store_claim_counts(self):
        if not hasattr(self, "tree"):
            return
        for iid, index in self.store_index_by_iid.items():
            if index >= len(STORES):
                continue
            values = list(self.tree.item(iid, "values"))
            while len(values) < 8:
                values.append("")
            values[5] = self.claim_count_for_store(STORES[index])
            self.tree.item(iid, values=values)

    def find_claim_iid(self, claim):
        for iid, index in self.claim_index_by_iid.items():
            if 0 <= index < len(CLAIMS) and CLAIMS[index] is claim:
                return iid
        return None

    def update_claim_row(self, claim, status=None, message=None):
        def apply_update():
            iid = self.find_claim_iid(claim)
            if iid is None:
                return
            if status is not None:
                claim["status"] = status
            if message is not None:
                claim["message"] = message
            values = list(self.claims_tree.item(iid, "values"))
            while len(values) < 8:
                values.append("")
            values[6] = claim.get("status", "")
            values[7] = claim.get("message", "")
            base_tag = "even" if int(values[0]) % 2 == 0 else "odd"
            tag_status = str(values[6]).strip().lower()
            if tag_status not in ("pending", "running", "submitted", "failed", "stopped", "unknown"):
                tag_status = "pending"
            self.claims_tree.item(iid, values=values, tags=(base_tag, tag_status))
            try:
                self.claims_tree.see(iid)
            except Exception:
                pass
        self.root.after(0, apply_update)

    def mark_selected_claims_pending(self):
        if self.running:
            return
        selected = self.claims_tree.selection()
        if not selected:
            messagebox.showwarning("No Claim Selected", "Select one or more claim rows first.")
            return
        for iid in selected:
            index = self.claim_index_by_iid.get(iid)
            if index is not None and 0 <= index < len(CLAIMS):
                claim = CLAIMS[index]
                self.update_claim_row(claim, status=CLAIM_STATUS_PENDING, message="Reset by user")
        self.log("Selected claim(s) reset to Pending.")

    def copy_selected_claim_info(self):
        selected = self.claims_tree.selection()
        if not selected:
            return
        lines = []
        for iid in selected:
            values = self.claims_tree.item(iid, "values")
            lines.append(" | ".join(str(value) for value in values))
        text = "\n".join(lines)
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.log("Selected claim info copied to clipboard.")

    def show_claims_tree_menu(self, event):
        iid = self.claims_tree.identify_row(event.y)
        if iid:
            if iid not in self.claims_tree.selection():
                self.claims_tree.selection_set(iid)
            self.claims_context_menu.tk_popup(event.x_root, event.y_root)


    # ======================================================================
    # RUN FLOW
    # ======================================================================

    def start_filing(self):
        if self.running:
            return
        if not STORES:
            messagebox.showwarning("No Logins", "Import logins first (Import Logins > Excel).")
            return
        if not CLAIMS:
            messagebox.showwarning("No Claims", "Import the rebate Excel first (Import Rebates > Excel).")
            return

        pending = [c for c in CLAIMS if c.get("status") in (CLAIM_STATUS_PENDING, CLAIM_STATUS_FAILED, CLAIM_STATUS_STOPPED)]
        if not pending:
            messagebox.showinfo("Nothing To File", "Every claim is already submitted.\nUse Reset Claim Status to re-file specific claims.")
            return

        unmatched = []
        store_claims = {}
        for claim in pending:
            store = match_claim_store(claim)
            if store is None:
                unmatched.append(claim)
                continue
            key = (store["store"], store["account_id"])
            store_claims.setdefault(key, []).append(claim)

        for claim in unmatched:
            self.update_claim_row(claim, status=CLAIM_STATUS_FAILED, message="No matching store login — check store name / account id")

        if not store_claims:
            messagebox.showerror(
                "No Matching Logins",
                "None of the %d pending claim row(s) match an imported store login.\n\n"
                "Match by account id or store name, then press Start Filing again." % len(pending),
            )
            return

        ordered_stores = []
        for store in STORES:
            key = (store["store"], store["account_id"])
            if key in store_claims:
                ordered_stores.append(store)

        total_claims = sum(len(v) for v in store_claims.values())
        confirm = messagebox.askyesno(
            "Start Filing",
            "This will file %d claim(s) across %d store(s), one by one, in the automation Edge window.\n\n"
            "Each IMEI goes through: Create an appeal > IMEI and Activation Date > fill > Submit.\n\n"
            "%s"
            "Continue?" % (
                total_claims,
                len(ordered_stores),
                ("%d claim row(s) have NO matching login and will be marked Failed.\n\n" % len(unmatched)) if unmatched else "",
            ),
        )
        if not confirm:
            return

        self.start_worker(ordered_stores, store_claims)

    def start_worker(self, stores, store_claims):
        global CURRENT_CLAIMS
        CURRENT_CLAIMS = []
        self._skip_mode = False
        self.stop_event.clear()
        self.last_run_total = sum(len(v) for v in store_claims.values())
        self.last_run_done = 0
        self.submitted_count = 0
        self.failed_count = 0
        self.progress_var.set(0)
        self.progress_text_var.set(f"0 / {self.last_run_total} claims")
        self.submitted_text_var.set("Submitted: 0")
        self.failed_text_var.set("Failed: 0")
        self.current_store_var.set("Starting")
        for store in stores:
            for claim in store_claims.get((store["store"], store["account_id"]), []):
                self.update_claim_row(claim, status=CLAIM_STATUS_PENDING, message="Queued")
            self.update_row_status(store, "Pending", "Queued")
        self.set_running_state(True)
        self.worker_thread = threading.Thread(target=self.run_stores, args=(stores, store_claims), daemon=True)
        self.worker_thread.start()

    def set_current_driver(self, driver):
        self.current_driver = driver

    def log(self, message):
        try:
            self.root.after(0, self._write_log, message)
        except Exception:
            print(message)

    def _write_log(self, message):
        self.log_box.insert("end", str(message) + "\n")
        self.log_box.see("end")
        append_session_log(message)

    def clear_log(self):
        self.log_box.delete("1.0", "end")

    def copy_log(self):
        text = self.log_box.get("1.0", "end").strip()
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.log("Log copied to clipboard.")

    def copy_selected_store_info(self):
        selected = self.tree.selection()
        if not selected:
            return
        lines = []
        for iid in selected:
            values = list(self.tree.item(iid, "values"))
            if len(values) >= 5 and not self.show_passwords_var.get():
                values[4] = "[hidden]"
            lines.append(" | ".join(str(value) for value in values))
        text = "\n".join(lines)
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.log("Selected store info copied to clipboard.")

    def show_tree_menu(self, event):
        iid = self.tree.identify_row(event.y)
        if iid:
            if iid not in self.tree.selection():
                self.tree.selection_set(iid)
            self.context_menu.tk_popup(event.x_root, event.y_root)

    def set_running_state(self, running):
        self.running = running
        if running:
            for btn in (self.vpn_setup_btn, self.start_btn, self.import_logins_btn,
                        self.import_rebates_btn, self.add_store_btn, self.edit_store_btn,
                        self.change_password_btn, self.remove_store_btn, self.mark_pending_btn):
                btn.config(state="disabled")
            self.stop_btn.config(state="normal")
            self.skip_btn.config(state="normal")
            self.search_entry.config(state="disabled")
            self.status_filter.config(state="disabled")
        else:
            for btn in (self.vpn_setup_btn, self.start_btn, self.import_logins_btn,
                        self.import_rebates_btn, self.add_store_btn, self.edit_store_btn,
                        self.change_password_btn, self.remove_store_btn, self.mark_pending_btn):
                btn.config(state="normal")
            self.stop_btn.config(state="disabled")
            self.skip_btn.config(state="disabled")
            self.search_entry.config(state="normal")
            self.status_filter.config(state="readonly")

    def update_progress(self):
        if self.last_run_total <= 0:
            percent = 0
        else:
            # Progress is measured in CLAIMS submitted, not stores.
            percent = (self.submitted_count / self.last_run_total) * 100
        self.progress_var.set(percent)
        self.progress_text_var.set(f"{self.submitted_count} / {self.last_run_total} claims")
        self.submitted_text_var.set(f"Submitted: {self.submitted_count}")
        self.failed_text_var.set(f"Failed: {self.failed_count}")

    def run_stores(self, stores, store_claims):
        """Runs the full filing session and guarantees the filing logs are
        written afterwards - even on a crash or a closed window - so there
        is always a record of which claims were filed."""
        start_session_logging(log=self.log)
        try:
            self._run_stores_inner(stores, store_claims)
        finally:
            self.log("")
            self.log("Saving the filing logs (Excel + session log)...")
            xlsx_path = write_filing_log_excel(log=self.log)
            txt_path = str(SESSION_LOG_FILE) if SESSION_LOG_FILE else None
            stop_session_logging()
            self.root.after(0, lambda: self._show_filing_log_popup(xlsx_path, txt_path))

    def _show_filing_log_popup(self, xlsx_path, txt_path):
        """Tells the user exactly where the filing logs were saved."""
        try:
            lines = ["Filing logs saved in Documents\\VidaPay Rebate Filing:"]
            if xlsx_path:
                lines.append("Excel log: " + str(xlsx_path))
            if txt_path:
                lines.append("Text log: " + str(txt_path))
            messagebox.showinfo("Filing log saved", "\n".join(lines))
        except Exception:
            pass

    def _run_stores_inner(self, stores, store_claims):
        """File the full queue, then automatically retry failed stores until
        every claim is submitted or the user stops."""
        self.log("")
        self.log(f"Stores to file: {len(stores)} | Claims in this run: {self.last_run_total}")

        failed = self._run_pass(stores, store_claims, pass_label="MAIN")

        MAX_RETRY_PASSES = 3
        retry_num = 0
        while failed and not self.stop_event.is_set() and retry_num < MAX_RETRY_PASSES:
            retry_num += 1
            self.log("")
            self.log("=" * 80)
            self.log(f"RETRY PASS {retry_num}/{MAX_RETRY_PASSES} — {len(failed)} store(s) with unsubmitted claims")
            self.log("=" * 80)
            for st in failed:
                self.update_row_status(st, "Pending", "Queued for retry")
            time.sleep(DELAY_BETWEEN_STORES)
            failed = self._run_pass(failed, store_claims, pass_label=f"RETRY {retry_num}")

        # ── Final summary + Excel filing log ─────────────────────────────────
        self.log("")
        self.log("=" * 80)
        self.log("FINAL SUMMARY")
        self.log("=" * 80)
        total_selected = sum(len(v) for v in store_claims.values())
        self.log(f"Claims in this run: {total_selected}")
        self.log(f"Submitted: {self.submitted_count}")
        self.log(f"Failed/Unknown: {self.failed_count}")
        still_open = [c for c in CLAIMS if c.get("status") in (CLAIM_STATUS_FAILED, CLAIM_STATUS_UNKNOWN, CLAIM_STATUS_STOPPED, CLAIM_STATUS_PENDING)]
        if still_open:
            self.log(f"Not submitted yet: {len(still_open)} claim row(s) — see the rebate table and the Excel log.")
        self.log("=" * 80)

        self.root.after(0, self.current_store_var.set, "Stopped" if self.stop_event.is_set() else "Idle")
        self.root.after(0, self.set_running_state, False)
        self.root.after(0, self.update_progress)

    def _run_pass(self, stores, store_claims, pass_label="MAIN"):
        """Run one pass over the given stores. Returns stores that still have
        unsubmitted claims."""
        global CURRENT_CLAIMS
        failed_stores = []
        for index, store in enumerate(stores, start=1):
            if self.stop_event.is_set():
                self.log("Process stopped by user.")
                self.update_row_status(store, "Stopped", "Stopped before run")
                break

            claims = [c for c in store_claims.get((store["store"], store["account_id"]), [])
                      if c.get("status") != CLAIM_STATUS_SUBMITTED]
            CURRENT_CLAIMS = claims

            already = len(store_claims.get((store["store"], store["account_id"]), [])) - len(claims)
            self.root.after(0, self.current_store_var.set, store["store"])
            self.update_row_status(store, "Running", f"{len(claims)} claim(s) to file" + (f" ({already} already done)" if already else ""))
            self.log("")
            self.log(f"[{pass_label}] Queue: {index}/{len(stores)} — {store['store']} ({len(claims)} claim(s))")

            if not claims:
                self.log("All claims for this store are already submitted.")
                self.update_row_status(store, "Success", "All claims already submitted")
                continue

            result = login_store(store_data=store, stop_event=self.stop_event, set_current_driver=self.set_current_driver, log=self.log)

            # --- handle skip-store ---
            if self._skip_mode:
                self._skip_mode = False
                self.stop_event.clear()
                self.update_row_status(store, "Stopped", "Skipped by user")
                self.failed_count += 1
                failed_stores.append(store)
                self.root.after(0, self.update_progress)
                continue
            # -------------------------

            submitted_now = len([c for c in claims if c.get("status") == CLAIM_STATUS_SUBMITTED])
            unknown_now = len([c for c in claims if c.get("status") == CLAIM_STATUS_UNKNOWN])
            open_now = len([c for c in claims if c.get("status") != CLAIM_STATUS_SUBMITTED])

            self.submitted_count += submitted_now
            self.failed_count += unknown_now + max(0, open_now - unknown_now)

            if result and open_now == 0:
                self.update_row_status(store, "Success", f"{submitted_now} claim(s) submitted")
            elif submitted_now > 0:
                self.update_row_status(store, "Failed", f"{submitted_now} submitted, {open_now} still open")
                failed_stores.append(store)
            else:
                row_message = "Stopped" if self.stop_event.is_set() else "Failed. Check log"
                row_status = "Stopped" if self.stop_event.is_set() else "Failed"
                self.update_row_status(store, row_status, row_message)
                if not self.stop_event.is_set():
                    failed_stores.append(store)

            self.root.after(0, self.update_progress)
            # Refresh the Excel filing log after every store so the record of
            # which claims were filed is always current on disk.
            write_filing_log_excel(log=self.log, verbose=False)
            if index < len(stores) and not self.stop_event.is_set():
                self.log(f"Waiting {DELAY_BETWEEN_STORES} seconds before next store...")
                time.sleep(DELAY_BETWEEN_STORES)

        CURRENT_CLAIMS = []
        return failed_stores

    def skip_store(self):
        """Abort the current store and continue automatically to the next one."""
        self._skip_mode = True
        self.stop_event.set()
        self.log("Skipping current store — will continue with next store...")

    def stop_run(self):
        self._skip_mode = False
        self.stop_event.set()
        self.current_store_var.set("Stopping")
        self.log("Stopping process...")
        try:
            if self.current_driver:
                self.current_driver.quit()
        except Exception:
            pass
        # No force-kill here — killing the process from the UI thread was
        # crashing the whole app whenever Selenium was still busy. The worker
        # is a daemon thread; stop_event above signals it to exit gracefully
        # and the driver quit() unblocks any in-flight Selenium command.


# =========================================================
# RUN APP
# =========================================================

def _enable_dpi_awareness() -> None:
    """Make Windows report physical pixels so winfo_screen* is accurate on
    high-DPI displays (1080p, 1440p, 2K, 4K, DPI-scaled laptops)."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)  # system DPI aware
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


if __name__ == "__main__":
    _enable_dpi_awareness()
    # Windows taskbar icon grouping: AppUserModelID MUST be set BEFORE the
    # first Tk window is created, or Windows ignores it and falls back to
    # the generic Python/Tk icon in the taskbar.
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("VidaPay.RebateFiling")
        except Exception:
            pass
    # --- 3SVerse license gate: machine-locked activation (before any GUI) ---
    import license_core
    if not license_core.ensure_licensed():
        sys.exit(0)
    root = tk.Tk()
    app = VidaPayApp(root)
    root.mainloop()
