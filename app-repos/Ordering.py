# Developed by www.3SVerse.com | Copyright © {date.today().year} | All rights reserved.
# VidaPay Automation Suite — Device Ordering Automation

"""
VidaPay Device Ordering Automation - GUI VERSION
Interactive UI/UX desktop app using Tkinter.

Updates in this version:
- Tabs split into "1. Stores", "2. Devices", "3. SIMs"
  - Devices tab uses product type "TBV Branded"
  - SIMs tab uses product type "SIM Cards" with default product
    "Total by Verizon SIM Kit" (editable)
  - Each tab has its own complete Order UI and state
- Status semantics clarified:
  - TBV/SIM dropdown can't open → store is locked (SKIPPED)
  - Available credit < unit price → INSUFFICIENT FUNDS
  - Credit sufficient but stock = 0 → OUT OF STOCK
  - (old "Credit Not Stock" status removed)
- Order log export changed from CSV to XLSX (openpyxl)
  - Color-coded Status column, frozen header row, auto-sized columns
  - Falls back to CSV if openpyxl is not installed
- Arizona D1 and Arizona D2 merged into one Arizona district
- Browser stays open after 2FA, after submit, after stop, and after errors
- Edge detach mode added
- Store selection by district
- Option 8 replacement: select stores by STORE NAME
- Store search
- Selected stores table
- Same order for all stores
- Different order for each store
- Product entry tables
- Live automation log
- Progress bar
- Manual 2FA Continue button
- CSV logging
- Stop button

Required:
pip install selenium
Microsoft Edge installed
Edge WebDriver available through Selenium Manager
"""

import os
from theme_manager import ThemeManager, apply_theme_to_window, get_copyright_year
from header_manager import FixedHeaderManager
from logo_handler import LogoHandler
import re
import csv
import sys
import base64
import time
import queue
import threading
import subprocess
import socket
import shutil
import tempfile
from datetime import datetime, date, timedelta
from collections import OrderedDict
from pathlib import Path

# ============================================================================
# VIDAPAY CORE  —  encrypted config storage + 7-day anti-rollback trial lock
# (Injected automatically. Do not edit the obfuscation logic.)
# ============================================================================
import json as _json
import hashlib as _hashlib
import hmac as _hmac
import struct as _struct
import time as _time
import datetime as _vp_dt

try:
    import winreg as _winreg
except Exception:
    _winreg = None

# Set per build. Trial build flips this to True.
IS_TRIAL = False
TRIAL_DAYS = 7
# 1-Year trial builds: TRIAL_SILENT = True (no popups; expires silently).
TRIAL_SILENT = False
_VP_APP_KEY = "DeviceOrdering"
_VP_SALT = b"VidaPay::2024::core::salt::DeviceOrdering"

# ---------------------------------------------------------------------------
# Packaged-app safety: when running as a PyInstaller .exe, sys.executable is the
# app itself (not python). Library code that tries to `pip install ...` via
# sys.executable would silently RELAUNCH the GUI (a second window). Block those
# calls in frozen mode so STT/dependency fallbacks fail gracefully instead.
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

_VP_CFG_CACHE = None

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

# ---------------------------------------------------------------------------
# 7-day trial with clock-rollback protection
# ---------------------------------------------------------------------------
def _vp_obf(num):
    return base64.b64encode(_vp_encrypt(str(int(num)).encode())).decode()

def _vp_deobf(text):
    try:
        dec = _vp_decrypt(base64.b64decode(text.encode()))
        return int(dec.decode()) if dec else None
    except Exception:
        return None

def _vp_reg_read():
    if _winreg is None:
        return None, None
    try:
        k = _winreg.OpenKey(_winreg.HKEY_CURRENT_USER,
                            r"Software\VidaPay\%s" % _VP_APP_KEY)
        fr, _ = _winreg.QueryValueEx(k, "fr")
        ls, _ = _winreg.QueryValueEx(k, "ls")
        _winreg.CloseKey(k)
        return _vp_deobf(fr), _vp_deobf(ls)
    except Exception:
        return None, None

def _vp_reg_write(fr, ls):
    if _winreg is None:
        return
    try:
        k = _winreg.CreateKey(_winreg.HKEY_CURRENT_USER,
                              r"Software\VidaPay\%s" % _VP_APP_KEY)
        _winreg.SetValueEx(k, "fr", 0, _winreg.REG_SZ, _vp_obf(fr))
        _winreg.SetValueEx(k, "ls", 0, _winreg.REG_SZ, _vp_obf(ls))
        _winreg.CloseKey(k)
    except Exception:
        pass

def _vp_file_read():
    try:
        p = _vp_base_dir() / ".vpsys"
        if p.exists():
            obj = _json.loads(p.read_text())
            return _vp_deobf(obj.get("fr", "")), _vp_deobf(obj.get("ls", ""))
    except Exception:
        pass
    return None, None

def _vp_file_write(fr, ls):
    try:
        p = _vp_base_dir() / ".vpsys"
        p.write_text(_json.dumps({"fr": _vp_obf(fr), "ls": _vp_obf(ls)}))
        try:
            import ctypes
            ctypes.windll.kernel32.SetFileAttributesW(str(p), 0x02)  # hidden
        except Exception:
            pass
    except Exception:
        pass

def _vp_trial_status():
    """Return (expired: bool, days_left: int). Anti-rollback enforced."""
    now = int(_time.time())
    fr_r, ls_r = _vp_reg_read()
    fr_f, ls_f = _vp_file_read()
    firsts = [x for x in (fr_r, fr_f) if x]
    lasts = [x for x in (ls_r, ls_f) if x]

    if not firsts:
        # genuine first run
        _vp_reg_write(now, now)
        _vp_file_write(now, now)
        return False, TRIAL_DAYS

    first_run = min(firsts)
    last_seen = max(lasts) if lasts else first_run
    # if clock was rolled back, never give time back: count from last_seen
    effective_now = max(now, last_seen)
    # heal both stores forward; keep earliest first_run
    _vp_reg_write(first_run, effective_now)
    _vp_file_write(first_run, effective_now)

    elapsed_days = (effective_now - first_run) / 86400.0
    days_left = int(TRIAL_DAYS - elapsed_days)
    if elapsed_days >= TRIAL_DAYS:
        return True, 0
    return False, max(0, days_left)

def _vp_enforce_trial():
    """Call before launching the GUI. Exits if the trial has expired."""
    if not IS_TRIAL:
        return
    expired, days_left = _vp_trial_status()
    if TRIAL_SILENT:
        # 1-Year build: no popups. Exits silently once the trial has expired.
        if expired:
            sys.exit(0)
        return
    try:
        import tkinter as _tkx
        from theme_manager import ThemeManager, apply_theme_to_window, get_copyright_year
        from tkinter import messagebox as _mb
        _r = _tkx.Tk()
        _r.withdraw()
        if expired:
            _mb.showerror(
                "Trial Expired",
                "Your %d-day free trial of this VidaPay tool has ended.\n\n"
                "Please contact your provider to unlock the full version."
                % TRIAL_DAYS)
            _r.destroy()
            sys.exit(0)
        else:
            _mb.showinfo(
                "VidaPay Trial",
                "Trial version — %d day(s) remaining.\n\n"
                "Contact your provider to upgrade to the full version."
                % days_left)
            _r.destroy()
    except Exception:
        if expired:
            sys.exit(0)
# ============================================================================
# END VIDAPAY CORE
# ============================================================================

import tkinter as tk
from tkinter import ttk, messagebox, filedialog

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.edge.options import Options
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.common.exceptions import (
    StaleElementReferenceException,
    ElementClickInterceptedException,
    TimeoutException,
    WebDriverException,
    NoSuchWindowException,
    InvalidSessionIdException,
)

# ============================================================================
# HUMAN VERIFICATION — reCAPTCHA v2 audio solver + Cloudflare Turnstile
# (shared with Vidapay Incentive Dashboard Extractor)
# ============================================================================
HUMAN_VERIFY_WAIT_SECONDS = 30

def get_current_url_lower(driver):
    try:
        return (driver.current_url or "").lower()
    except Exception:
        return ""

def get_body_text_lower(driver):
    try:
        return (driver.find_element(By.TAG_NAME, "body").text or "").lower()
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

def try_auto_click_human_verification(driver, log=print):
    """
    Click the visible human-verification widget.

    A. Google reCAPTCHA → audio solver (try_solve_recaptcha).
    B. Cloudflare Turnstile → real OS mouse click via pyautogui (only method
       that works against the sandboxed cross-origin Turnstile iframe).
    C. Plain visible <input type="checkbox"> in the main document → JS click.
    """

    # ------------------------------------------------------------------ #
    # A. Detect reCAPTCHA → audio solver                                  #
    # ------------------------------------------------------------------ #
    # A0. Cloudflare Turnstile closed-shadow pre-check — MUST run before
    #     reCAPTCHA: VidaPay keeps reCAPTCHA anchor iframes in the DOM at all
    #     times, and Turnstile's iframe lives inside a CLOSED shadow root that
    #     iframe selectors can never see. The hidden
    #     [name="cf-turnstile-response"] input in the MAIN DOM is the only
    #     reliable structural signal.
    try:
        _cf_shadow = driver.execute_script("""
            if (document.querySelector('[name="cf-turnstile-response"]')) return true;
            if (document.querySelector('input[id*="cf-chl-widget"]'))      return true;
            if (document.querySelector('#challenge-stage'))                return true;
            const bt = (document.body.innerText || '').toLowerCase();
            if (bt.includes('performing security verification'))           return true;
            return (document.title || '').toLowerCase().includes('just a moment');
        """)
    except Exception:
        _cf_shadow = False
    if _cf_shadow:
        log("Cloudflare Turnstile detected (closed-shadow safe) — CDP trusted click.")
        return _cdp_click_turnstile(driver, log=log)

    _RECAPTCHA_ANCHOR_SELECTORS = [
        "iframe[src*='recaptcha/api2/anchor']",
        "iframe[src*='recaptcha/enterprise/anchor']",
        "iframe[title*='reCAPTCHA']",
        "iframe[title*='not a robot']",
    ]
    for sel in _RECAPTCHA_ANCHOR_SELECTORS:
        try:
            if driver.find_element(By.CSS_SELECTOR, sel):
                log("reCAPTCHA anchor iframe detected — running audio solver directly.")
                return try_solve_recaptcha(driver, log=log)
        except Exception:
            pass

    # ------------------------------------------------------------------ #
    # B. Cloudflare Turnstile → pyautogui real mouse click               #
    # ------------------------------------------------------------------ #
    _TURNSTILE_PRESENT_SELECTORS = [
        "iframe[src*='challenges.cloudflare.com']",
        "iframe[src*='turnstile']",
        "iframe[title*='Widget']",
        ".cf-turnstile",
        "[class*='turnstile']",
        "#challenge-stage",
    ]
    for sel in _TURNSTILE_PRESENT_SELECTORS:
        try:
            if driver.find_element(By.CSS_SELECTOR, sel):
                log(f"Cloudflare Turnstile detected ({sel}) — CDP trusted click (screen-free).")
                return _cdp_click_turnstile(driver, log=log)
        except Exception:
            pass

    # ------------------------------------------------------------------ #
    # C. Plain visible checkbox in main document                          #
    # ------------------------------------------------------------------ #
    try:
        clicked = driver.execute_script(
            """
            function visible(el) {
                if (!el) return false;
                const s = window.getComputedStyle(el);
                const r = el.getBoundingClientRect();
                return s.display !== 'none' && s.visibility !== 'hidden' &&
                       s.opacity !== '0' && r.width > 0 && r.height > 0;
            }
            const box = Array.from(document.querySelectorAll('input[type="checkbox"]'))
                            .find(el => visible(el) && !el.checked);
            if (!box) return false;
            box.scrollIntoView({block:'center'});
            box.focus();
            box.checked = true;
            box.dispatchEvent(new Event('change', {bubbles:true}));
            box.dispatchEvent(new Event('input',  {bubbles:true}));
            box.click();
            return true;
            """
        )
        if clicked:
            log("JS-clicked plain checkbox in main document.")
            return True
    except Exception:
        pass

    return False

# ---------------------------------------------------------------------------
# reCAPTCHA v2 audio solver helpers
# ---------------------------------------------------------------------------

def _download_recaptcha_audio(driver, url, tmp_dir, log=print):
    """Download the reCAPTCHA audio MP3 using browser cookies."""
    try:
        import requests as _req
        cookies = {c["name"]: c["value"] for c in driver.get_cookies()}
        headers = {
            "User-Agent": driver.execute_script("return navigator.userAgent;"),
            "Referer": driver.current_url,
        }
        resp = _req.get(url, cookies=cookies, headers=headers, timeout=25)
        resp.raise_for_status()
        mp3_path = os.path.join(tmp_dir, "rc_audio.mp3")
        with open(mp3_path, "wb") as fh:
            fh.write(resp.content)
        log(f"Downloaded reCAPTCHA audio ({len(resp.content):,} bytes).")
        return mp3_path
    except Exception as exc:
        log(f"Audio download failed: {exc}")
        return None

def _get_ffmpeg_exe(log=print):
    """
    Return a working ffmpeg executable path.
    Tries in order:
      1. 'ffmpeg' on PATH
      2. Common Windows install locations
      3. imageio-ffmpeg bundled binary (auto-installs the package if needed)
    """
    # 1. PATH + common locations
    candidates = ["ffmpeg", "ffmpeg.exe"]
    common = [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
        str(Path.home() / "ffmpeg" / "bin" / "ffmpeg.exe"),
    ]
    for exe in candidates + common:
        try:
            r = subprocess.run([exe, "-version"], capture_output=True, timeout=5)
            if r.returncode == 0:
                return exe
        except Exception:
            pass

    # 2. imageio-ffmpeg — downloads a real static ffmpeg binary via pip
    try:
        try:
            import imageio_ffmpeg as _iio
        except ImportError:
            log("Installing imageio-ffmpeg (downloads real ffmpeg binary)...")
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "imageio-ffmpeg",
                 "--quiet", "--disable-pip-version-check"],
                capture_output=True, timeout=120,
            )
            import imageio_ffmpeg as _iio
        exe = _iio.get_ffmpeg_exe()
        r = subprocess.run([exe, "-version"], capture_output=True, timeout=5)
        if r.returncode == 0:
            log(f"Using ffmpeg via imageio-ffmpeg: {exe}")
            return exe
    except Exception as exc:
        log(f"imageio-ffmpeg failed: {exc}")

    return None

def _mp3_to_wav(mp3_path, wav_path, log=print):
    """Convert MP3 to 16kHz mono WAV using the best available ffmpeg. Returns True on success."""
    exe = _get_ffmpeg_exe(log=log)
    if not exe:
        log("No ffmpeg executable found — cannot convert MP3 to WAV.")
        return False
    try:
        result = subprocess.run(
            [exe, "-y", "-i", mp3_path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_path],
            capture_output=True, timeout=30,
        )
        if result.returncode == 0 and os.path.exists(wav_path):
            log("Converted MP3→WAV (16kHz mono).")
            return True
        log(f"ffmpeg returned {result.returncode}: {result.stderr[-200:]}")
    except Exception as exc:
        log(f"MP3→WAV conversion error: {exc}")
    return False

def _transcribe_wav_google(wav_path, log=print):
    """Transcribe a WAV file using Google Speech Recognition via SpeechRecognition."""
    try:
        import speech_recognition as _sr
    except ImportError:
        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "SpeechRecognition",
                 "--quiet", "--disable-pip-version-check"],
                capture_output=True, timeout=60,
            )
            import speech_recognition as _sr
        except Exception as exc:
            log(f"Cannot install SpeechRecognition: {exc}")
            return None
    try:
        rec = _sr.Recognizer()
        with _sr.AudioFile(wav_path) as src:
            audio = rec.record(src)
        text = rec.recognize_google(audio).lower().strip()
        log(f"Transcribed: '{text}'")
        return text
    except Exception as exc:
        log(f"Google STT failed: {exc}")
        return None

def _transcribe_wav_whisper(wav_path, log=print):
    """
    Transcribe a WAV using OpenAI Whisper (local, no API key).
    Auto-installs 'openai-whisper' on first use (~40MB, one-time download).
    """
    try:
        try:
            import whisper as _whisper
        except ImportError:
            log("Installing openai-whisper (one-time, ~40 MB)...")
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "openai-whisper",
                 "--quiet", "--disable-pip-version-check"],
                capture_output=True, timeout=180,
            )
            import whisper as _whisper
        model = _whisper.load_model("tiny")   # smallest/fastest model
        result = model.transcribe(wav_path, language="en", fp16=False)
        text = result.get("text", "").lower().strip()
        if text:
            log(f"Whisper transcribed: '{text}'")
            return text
    except Exception as exc:
        log(f"Whisper transcription failed: {exc}")
    return None

def _transcribe_audio_mp3(mp3_path, log=print):
    """
    Transcribe a reCAPTCHA MP3 audio challenge.

    Flow:
      1. Convert MP3 → WAV using real ffmpeg (via imageio-ffmpeg auto-install).
      2. Transcribe WAV with Google Speech Recognition (SpeechRecognition library).
      3. If Google STT fails, transcribe with OpenAI Whisper (local, no API key).
    """
    wav_path = mp3_path.replace(".mp3", ".wav")
    text = None

    try:
        if _mp3_to_wav(mp3_path, wav_path, log=log):
            # Try Google STT first (fast, online)
            text = _transcribe_wav_google(wav_path, log=log)

            # Whisper fallback (local, offline)
            if not text:
                text = _transcribe_wav_whisper(wav_path, log=log)
        else:
            # No ffmpeg at all — try Whisper directly on the MP3
            log("No ffmpeg — trying Whisper directly on MP3...")
            text = _transcribe_wav_whisper(mp3_path, log=log)
    finally:
        for p in (mp3_path, wav_path):
            try:
                os.remove(p)
            except Exception:
                pass

    if not text:
        log("All transcription methods failed.")
    return text

def _js_click(driver, selector_or_id, by_id=False, log=print):
    """
    Click an element purely through JavaScript — no ActionChains, no physical
    mouse coordinates.  Safe on dual-monitor setups where ActionChains coords
    are offset by the secondary display position.

    Uses the full synthetic event chain that Google's reCAPTCHA widget listens to:
      pointerover → mouseover → pointermove → mousemove →
      pointerdown  → mousedown → pointerup → mouseup → click
    """
    js = """
    const sel = arguments[0];
    const byId = arguments[1];
    const el = byId ? document.getElementById(sel)
                    : document.querySelector(sel);
    if (!el) return 'NOT_FOUND';
    el.scrollIntoView({block: 'center', inline: 'center'});
    const rect  = el.getBoundingClientRect();
    const cx    = rect.left + rect.width  / 2;
    const cy    = rect.top  + rect.height / 2;
    const opts  = {bubbles: true, cancelable: true, view: window,
                   clientX: cx, clientY: cy};
    ['pointerover','mouseover','pointermove','mousemove',
     'pointerdown','mousedown','pointerup','mouseup','click'
    ].forEach(t => el.dispatchEvent(new MouseEvent(t, opts)));
    return 'CLICKED';
    """
    try:
        result = driver.execute_script(js, selector_or_id, by_id)
        if result == "CLICKED":
            return True
        log(f"_js_click: element not found — {'#' if by_id else ''}{selector_or_id}")
        return False
    except Exception as exc:
        log(f"_js_click error ({'#' if by_id else ''}{selector_or_id}): {exc}")
        return False

def _js_get_attr(driver, css_selector, attr):
    """Return the value of an attribute on the first matching element, or None."""
    try:
        return driver.execute_script(
            "const el = document.querySelector(arguments[0]);"
            "return el ? el.getAttribute(arguments[1]) || el[arguments[1]] : null;",
            css_selector, attr,
        )
    except Exception:
        return None

def _js_set_value(driver, element_id, text):
    """Set an input field value and fire input/change events — cross-origin safe."""
    try:
        driver.execute_script(
            """
            const f = document.getElementById(arguments[0]);
            if (!f) return false;
            f.focus();
            // Simulate real keystrokes so React/Angular state picks up the value
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value').set;
            nativeInputValueSetter.call(f, arguments[1]);
            f.dispatchEvent(new Event('input',  {bubbles: true}));
            f.dispatchEvent(new Event('change', {bubbles: true}));
            f.dispatchEvent(new KeyboardEvent('keyup', {bubbles: true}));
            return true;
            """,
            element_id, text,
        )
        return True
    except Exception:
        return False

def try_solve_recaptcha(driver, log=print):
    """
    Google reCAPTCHA v2 audio-challenge solver — dual-monitor safe.

    Uses ONLY JavaScript events (no ActionChains / physical mouse moves) so
    screen coordinates on secondary monitors never cause misclicks.

    Flow:
      1. Wait 10 s for the widget to fully render.
      2. Switch into anchor iframe → JS-click .recaptcha-checkbox-border.
      3. Switch back, wait 3 s for the challenge bframe popup.
      4. Switch into bframe → if an image grid appears, JS-click the
         headphone/audio button (#recaptcha-audio-button) to switch to audio.
      5. Wait for audio panel, read .rc-audiochallenge-tdownload-link href.
      6. Download + transcribe the MP3.
      7. Switch back into bframe → JS-set #audio-response → JS-click
         #recaptcha-verify-button.
      8. Switch to main doc → JS-click #btnClick (orange login button).
    """
    import tempfile

    _ANCHOR_CSS = [
        "iframe[src*='recaptcha/api2/anchor']",
        "iframe[src*='recaptcha/enterprise/anchor']",
        "iframe[title*='reCAPTCHA']",
        "iframe[title*='not a robot']",
    ]
    _BFRAME_CSS = [
        "iframe[src*='recaptcha/api2/bframe']",
        "iframe[src*='recaptcha/enterprise/bframe']",
        "iframe[title*='recaptcha challenge']",
        "iframe[title*='challenge expires']",
    ]

    # ---- Step 1: locate anchor iframe ----
    anchor_iframe = None
    for sel in _ANCHOR_CSS:
        try:
            anchor_iframe = driver.find_element(By.CSS_SELECTOR, sel)
            break
        except Exception:
            pass

    if anchor_iframe is None:
        return False  # no reCAPTCHA on this page

    log("reCAPTCHA v2 detected — starting audio solver...")
    time.sleep(2)

    try:
        # ---- Step 2: TRUSTED click on the checkbox (screen-free) ----
        # A JS .click() is isTrusted=false - Google reCAPTCHA now ignores
        # it (checkbox toggles but never verifies). CDP Input events are
        # trusted and reach the cross-origin anchor iframe, so they are
        # tried FIRST and need no screen at all. The old JS path stays as
        # the fallback.
        clicked_checkbox = False
        try:
            if _cdp_click_iframe_checkbox(driver, anchor_iframe,
                                          offset_x=28, log=log):
                clicked_checkbox = True
                log("Clicked reCAPTCHA checkbox "
                    "(CDP trusted - screen-free).")
        except Exception as _cdp_exc:
            log(f"CDP trusted click unavailable ({_cdp_exc}) "
                f"- JS fallback.")

        if not clicked_checkbox:
            driver.switch_to.frame(anchor_iframe)
            log("Switched into reCAPTCHA anchor iframe.")

            # Wait for checkbox to appear
            WebDriverWait(driver, 10).until(
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, ".recaptcha-checkbox-border"))
            )

            clicked_checkbox = _js_click(
                driver, ".recaptcha-checkbox-border", by_id=False,
                log=log)
            if not clicked_checkbox:
                # fallback to the wrapper span
                clicked_checkbox = _js_click(
                    driver, "#recaptcha-anchor", by_id=True, log=log)

            if clicked_checkbox:
                log("Clicked reCAPTCHA checkbox (JS — dual-monitor safe).")
            else:
                log("Could not click reCAPTCHA checkbox.")
                driver.switch_to.default_content()
                return False

        driver.switch_to.default_content()
        log("Waiting 3 s for challenge popup to appear...")
        time.sleep(3)

        # ---- Step 3: locate bframe ----
        bframe = None
        for sel in _BFRAME_CSS:
            try:
                bframe = WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, sel))
                )
                break
            except Exception:
                pass

        if bframe is None:
            log("No challenge popup — reCAPTCHA passed via checkbox alone.")
            _click_login_verify_button(driver, log=log)
            return True

        # ---- Step 4: switch into bframe, click audio button ----
        driver.switch_to.frame(bframe)
        log("Switched into reCAPTCHA challenge bframe.")
        time.sleep(1)

        # The bframe may show an image grid challenge first.
        # Click #recaptcha-audio-button (the headphone icon) to switch to audio.
        # Retry up to 5 times — the button may not exist until the grid is shown.
        audio_switched = False
        for attempt in range(5):
            # Check if audio button exists
            has_audio_btn = driver.execute_script(
                "return !!document.getElementById('recaptcha-audio-button');"
            )
            if has_audio_btn:
                ok = _js_click(driver, "recaptcha-audio-button", by_id=True, log=log)
                if ok:
                    log(f"Clicked #recaptcha-audio-button (attempt {attempt+1}) — switching to audio challenge.")
                    audio_switched = True
                    break
            # Also try the CSS class selector
            ok = _js_click(driver, ".rc-button-audio", by_id=False, log=log)
            if ok:
                log(f"Clicked .rc-button-audio (attempt {attempt+1}) — switching to audio challenge.")
                audio_switched = True
                break
            log(f"Audio button not yet visible (attempt {attempt+1}/5), waiting 2 s...")
            time.sleep(2)

        if not audio_switched:
            log("Could not click audio challenge button — manual solving required.")
            driver.switch_to.default_content()
            return False

        # Wait for the audio challenge panel to render
        log("Waiting 4 s for audio challenge panel to load...")
        time.sleep(4)

        # ---- Step 5: read .rc-audiochallenge-tdownload-link href ----
        audio_url = None
        for _attempt in range(15):
            # Try JS first (more reliable inside cross-origin frames)
            url = driver.execute_script(
                """
                const a = document.querySelector(
                    '.rc-audiochallenge-tdownload-link, a[href*="audio.mp3"], a[download]'
                );
                return a ? (a.href || a.getAttribute('href')) : null;
                """
            )
            if url:
                audio_url = url
                break
            time.sleep(1)

        # Switch back to main doc before downloading
        driver.switch_to.default_content()

        if not audio_url:
            log("Could not find audio download link — manual solving required.")
            return False

        log(f"Audio URL: {audio_url[:100]}...")

        # ---- Step 6: download + transcribe ----
        tmp_dir = tempfile.mkdtemp(prefix="vp_rc_")
        mp3_path = _download_recaptcha_audio(driver, audio_url, tmp_dir, log=log)
        if not mp3_path:
            log("Audio download failed.")
            return False

        answer = _transcribe_audio_mp3(mp3_path, log=log)
        if not answer:
            log("Audio transcription failed.")
            return False

        log(f"Transcribed answer: '{answer}'")

        # ---- Step 7: switch back into bframe, fill answer, verify ----
        bframe = None
        for sel in _BFRAME_CSS:
            try:
                bframe = driver.find_element(By.CSS_SELECTOR, sel)
                break
            except Exception:
                pass

        if bframe is None:
            log("bframe disappeared after download — manual solving required.")
            return False

        driver.switch_to.frame(bframe)
        log("Switched back into bframe to submit answer.")

        # Wait for #audio-response to exist
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "audio-response"))
        )

        # Set the field value via JS (cross-origin + dual-monitor safe)
        set_ok = _js_set_value(driver, "audio-response", answer)
        if set_ok:
            log(f"Set #audio-response value: '{answer}'")
        else:
            log("Could not set #audio-response value — manual solving required.")
            driver.switch_to.default_content()
            return False

        time.sleep(0.5)

        # Click #recaptcha-verify-button via JS
        verify_ok = _js_click(driver, "recaptcha-verify-button", by_id=True, log=log)
        if verify_ok:
            log("Clicked #recaptcha-verify-button via JS.")
        else:
            log("Could not click #recaptcha-verify-button — manual solving required.")
            driver.switch_to.default_content()
            return False

        log("Waiting 4 s for reCAPTCHA to validate answer...")
        time.sleep(4)

        driver.switch_to.default_content()

        # ---- Step 8: click orange #btnClick login button ----
        _click_login_verify_button(driver, log=log)
        return True

    except Exception as exc:
        log(f"reCAPTCHA solver error: {exc}")
        try:
            driver.switch_to.default_content()
        except Exception:
            pass
        return False

def _click_login_verify_button(driver, log=print):
    """
    Click the orange Verify / login submit button (#btnClick) on the VidaPay
    login page after reCAPTCHA is solved.

    Pure JS — no ActionChains.  Dual-monitor safe.
    Force-removes the disabled attribute first because VidaPay keeps it disabled
    until the reCAPTCHA token propagates (can take 1-3 s).
    """
    _SELECTORS = [
        "#btnClick",
        "button[data-test-id='verify']",
        "button[data-callback='formSubmit']",
        "button.btn-orange[value='login']",
    ]

    end_time = time.time() + 15
    while time.time() < end_time:
        for sel in _SELECTORS:
            try:
                result = driver.execute_script(
                    """
                    const el = document.querySelector(arguments[0]);
                    if (!el) return 'NOT_FOUND';
                    el.removeAttribute('disabled');
                    el.classList.remove('disabled');
                    el.scrollIntoView({block: 'center', inline: 'center'});
                    const rect = el.getBoundingClientRect();
                    const cx = rect.left + rect.width  / 2;
                    const cy = rect.top  + rect.height / 2;
                    const opts = {bubbles:true, cancelable:true, view:window, clientX:cx, clientY:cy};
                    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(
                        t => el.dispatchEvent(new MouseEvent(t, opts))
                    );
                    return 'CLICKED';
                    """,
                    sel,
                )
                if result == "CLICKED":
                    log(f"Clicked login Verify button ({sel}) via JS.")
                    return True
            except Exception:
                continue
        time.sleep(0.5)

    log("Could not click login Verify button within 15 seconds.")
    return False

def wait_for_human_verification_clear(driver, stop_event=None, timeout=HUMAN_VERIFY_WAIT_SECONDS, log=print, context=""):
    if not is_human_verification_page(driver):
        return True

    label = f" during {context}" if context else ""

    # Check which widget type is present so we know whether to wait.
    # Cloudflare Turnstile needs 15 s to fully load its iframe JS before a
    # real mouse click will register.  reCAPTCHA handles its own timing
    # inside try_solve_recaptcha — no extra wait needed here.
    is_turnstile = False
    try:
        is_turnstile = bool(driver.find_elements(
            By.CSS_SELECTOR,
            "iframe[src*='challenges.cloudflare.com'], iframe[src*='turnstile'], "
            ".cf-turnstile, [class*='turnstile'], #challenge-stage",
        ))
    except Exception:
        pass

    if is_turnstile:
        log(f"Cloudflare Turnstile detected{label}. Waiting 15 seconds for iframe to fully load...")
        for _i in range(15):
            if stop_event is not None and stop_event.is_set():
                return False
            time.sleep(1)
        # If it cleared on its own, continue
        if not is_human_verification_page(driver):
            log("Human verification cleared during wait. Continuing automation.")
            try:
                wait_for_body(driver, timeout=15)
            except Exception:
                pass
            return True
    else:
        log(f"Human verification detected{label}. Attempting auto-click...")

    # Try auto-clicking the checkbox up to 3 times with short delays
    for attempt in range(3):
        if try_auto_click_human_verification(driver, log=log):
            time.sleep(2)
            if not is_human_verification_page(driver):
                log("Human verification cleared after auto-click. Continuing automation.")
                try:
                    wait_for_body(driver, timeout=15)
                except Exception:
                    pass
                return True
        time.sleep(2)

    log("Auto-click did not clear human verification. Waiting for page to advance...")

    end_time = time.time() + timeout
    last_log = 0

    while time.time() < end_time:
        if stop_event is not None and stop_event.is_set():
            return False

        # Keep retrying auto-click every 5 seconds
        try_auto_click_human_verification(driver, log=log)

        if not is_human_verification_page(driver):
            log("Human verification cleared. Continuing automation.")
            try:
                wait_for_body(driver, timeout=15)
            except Exception:
                pass
            time.sleep(1)
            return True

        now = time.time()
        if now - last_log >= 10:
            remaining = int(end_time - now)
            log(f"Still on human verification page. Retrying auto-click. Time left: {remaining} seconds.")
            last_log = now

        time.sleep(5)

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

# ============================================================================
# VIDAPAY BRANDING
# ============================================================================
APP_TITLE = "VidaPay Device Ordering Automation"
APP_SUBTITLE = "Device ordering automation with store selection, product ordering, 2FA handling, live logs, and CSV export"
BRAND_NAVY = "#090d26"
EMBEDDED_LOGO_B64 = ""
EMBEDDED_ICON_B64 = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "embedded_icon_b64.txt"), "r").read().strip() if not getattr(sys, "frozen", False) else open(os.path.join(getattr(sys, "_MEIPASS", "."), "assets", "embedded_icon_b64.txt"), "r").read().strip()

BRAND_NAVY_2 = "#050817"
BRAND_RED = "#f0541c"
BRAND_WHITE = "#ffffff"
BRAND_SURFACE = "#f6f7fb"
BRAND_BORDER = "#d8deea"
VIDAPAY_LOGO_B64 = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "vidapay_logo_b64.txt"), "r").read().strip() if not getattr(sys, "frozen", False) else open(os.path.join(getattr(sys, "_MEIPASS", "."), "assets", "vidapay_logo_b64.txt"), "r").read().strip()

# ============================================================================
# PRODUCT PRICE DATABASE
# ============================================================================
# Product prices now fetched dynamically from page
# ============================================================================
# UPDATED STORE DATABASE
# Arizona D1 and D2 are merged into Arizona
# ============================================================================
STORE_ROWS = list(_vp_get("stores", []))

# These values are used exactly when populating the Vidapay account dropdown.
# Keep the suffix/capitalization as provided by the portal.
ACCOUNT_ID_POPULATION_VALUES = {}

def build_store_database():
    stores = OrderedDict()

    for row in STORE_ROWS:
        district = row["district"]

        if district not in stores:
            stores[district] = []

        stores[district].append({
            "name": row["name"],
            "account_id": row["account_id"],
            "username": row.get("username", ""),
            "district": district,
        })

    return stores

STORES = build_store_database()

def get_all_stores_flat():
    items = []

    for index, row in enumerate(STORE_ROWS, 1):
        item = dict(row)
        item["index"] = index
        item["key"] = row["account_id"]
        items.append(item)

    return items

def normalize_text(value):
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()

def calculate_distribution(total_quantity, num_stores):
    if num_stores == 0:
        return []

    base_qty = total_quantity // num_stores
    remainder = total_quantity % num_stores
    distribution = [base_qty] * num_stores

    for i in range(remainder):
        distribution[i] += 1

    return distribution

# ============================================================================
# AUTOMATION CLASS
# ============================================================================
# WhatsApp 2FA Alert
# Sends "2FA" to the configured WhatsApp Desktop group whenever a 2FA page
# is detected.  Runs in a background thread — never blocks Selenium.
# Uses win32gui + ctypes for focus (pygetwindow.activate() is unreliable on
# Windows and throws even on success).
# ---------------------------------------------------------------------------
try:
    import pyautogui as _pyautogui
    _pyautogui.FAILSAFE = False

    # Test that keyboard functions actually work on this Python version.
    # pynput (pyautogui's keyboard backend) breaks on Python 3.14 with:
    #   "function() argument 'code' must be code, not str"
    # If the keyboard test fails, we'll use win32api as a fallback.
    _WA_KEYBOARD_OK = True
    try:
        if _sys.version_info >= (3, 14):
            # Force pynput keyboard backend to initialize — this is where
            # it crashes on 3.14
            from pynput.keyboard import Controller as _KBController
            _kb = _KBController()
    except Exception as _kb_err:
        _WA_KEYBOARD_OK = False
        _WA_IMPORT_ERROR = f"pynput keyboard backend issue (Python 3.14): {_kb_err}"
        # pyautogui is still imported — mouse functions work, but keyboard
        # functions (hotkey, press, write) will fail.  We'll use win32api
        # fallback for keyboard operations.
    else:
        _WA_IMPORT_ERROR = ""

    _WA_AVAILABLE = True
except Exception as _pag_err:
    _pyautogui = None
    _WA_AVAILABLE = False
    _WA_IMPORT_ERROR = str(_pag_err)
    _WA_KEYBOARD_OK = False
    import sys as _sys
    print(f"[DEBUG] pyautogui import FAILED: {_pag_err}", file=_sys.stderr, flush=True)

# ── win32api keyboard fallback (for Python 3.14 where pynput breaks) ────────
# These use SendInput via ctypes — no pynput dependency.
_WA_VK_MAP = {
    "ctrl": 0x11, "control": 0x11, "alt": 0x12, "menu": 0x12,
    "shift": 0x10, "win": 0x5B, "enter": 0x0D, "return": 0x0D,
    "tab": 0x09, "esc": 0x1B, "escape": 0x1B, "backspace": 0x08,
    "delete": 0x2E, "del": 0x2E, "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22, "up": 0x26, "down": 0x28,
    "left": 0x25, "right": 0x27, "space": 0x20, "a": 0x41, "c": 0x43,
    "f": 0x46, "v": 0x56, "x": 0x58,
}

def _wa_win32_key_down(vk_code):
    """Press a key down using SendInput (no pynput)."""
    import ctypes
    # INPUT_KEYBOARD = 1, KEYEVENTF_KEYDOWN = 0
    ctypes.windll.user32.keybd_event(vk_code, 0, 0, 0)

def _wa_win32_key_up(vk_code):
    """Release a key using SendInput (no pynput)."""
    import ctypes
    # KEYEVENTF_KEYUP = 0x0002
    ctypes.windll.user32.keybd_event(vk_code, 0, 0x0002, 0)

def _wa_win32_hotkey(*keys):
    """Press a keyboard shortcut (e.g. ctrl+v) using SendInput."""
    codes = []
    for k in keys:
        k_lower = k.lower()
        if k_lower in _WA_VK_MAP:
            codes.append(_WA_VK_MAP[k_lower])
        elif len(k) == 1:
            codes.append(ord(k.upper()))
        else:
            return  # unknown key
    # Press all keys down
    for code in codes:
        _wa_win32_key_down(code)
    # Release in reverse order
    for code in reversed(codes):
        _wa_win32_key_up(code)

def _wa_win32_press(key):
    """Press and release a single key using SendInput."""
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
    """Type text using SendInput (no pynput)."""
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

# Choose which keyboard backend to use
if _WA_AVAILABLE and not _WA_KEYBOARD_OK:
    # pynput is broken — use win32api fallback for keyboard ops
    _wa_hotkey = _wa_win32_hotkey
    _wa_press = _wa_win32_press
    _wa_write = _wa_win32_write
elif _WA_AVAILABLE:
    # pynput works — use pyautogui's keyboard functions
    _wa_hotkey = _pyautogui.hotkey
    _wa_press = _pyautogui.press
    _wa_write = _pyautogui.write
else:
    # pyautogui not available at all
    _wa_hotkey = _wa_win32_hotkey
    _wa_press = _wa_win32_press
    _wa_write = _wa_win32_write

_WA_GROUP_NAME = _vp_get("whatsapp_group", "")
_WA_MODE = _vp_get("whatsapp_mode", "desktop")  # "desktop" or "web"
_WA_SEARCH_SHORTCUT = "ctrl+f"

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

    Uses AttachThreadInput + BringWindowToTop + SetForegroundWindow.
    Falls back to pyautogui Alt+Tab cycling if the Win32 approach fails.
    """
    import time as _t
    try:
        import ctypes

        user32   = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

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

        # If minimised, restore first
        if wp.showCmd == 2:
            user32.ShowWindow(hwnd, 9)   # SW_RESTORE
            _t.sleep(0.3)

        # Attach to the foreground thread so we can steal focus legitimately
        fg_hwnd      = user32.GetForegroundWindow()
        fg_thread    = user32.GetWindowThreadProcessId(fg_hwnd, None)
        our_thread   = kernel32.GetCurrentThreadId()
        wa_thread    = user32.GetWindowThreadProcessId(hwnd, None)

        user32.AttachThreadInput(fg_thread, our_thread, True)
        user32.AttachThreadInput(fg_thread, wa_thread,  True)

        user32.ShowWindow(hwnd, 1)          # SW_SHOWNORMAL
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        user32.SetFocus(hwnd)

        user32.AttachThreadInput(fg_thread, our_thread, False)
        user32.AttachThreadInput(fg_thread, wa_thread,  False)

        _t.sleep(0.5)

        # Verify it actually came to front
        if user32.GetForegroundWindow() != hwnd:
            # Win32 focus failed — use Alt+Tab trick via pyautogui
            if _WA_AVAILABLE:
                _t.sleep(0.3)
                _wa_win32_key_down(_WA_VK_MAP["alt"])
                _t.sleep(0.1)
                _wa_press("tab")
                _t.sleep(0.3)
                _wa_win32_key_up(_WA_VK_MAP["alt"])
                _t.sleep(0.8)

    except Exception:
        pass

def _wa_ensure_focused(log=print):
    """Find WhatsApp, bring to foreground, and verify it is the active window.
    Returns hwnd on success, None on failure.
    Retries up to 3 times with different strategies."""
    import time as _t
    for attempt in range(3):
        hwnd = _wa_find_hwnd()
        if hwnd is None:
            log("WhatsApp Desktop not found — launching...")
            _wa_launch()
            _t.sleep(5)
            hwnd = _wa_find_hwnd()

        if hwnd is None:
            log("WhatsApp Desktop still not found after launch.")
            return None

        # Strategy 1: pygetwindow
        focused = False
        try:
            import pygetwindow as _gw
            windows = [w for w in _gw.getAllWindows()
                       if "whatsapp" in (w.title or "").lower()]
            if windows:
                win = windows[0]
                if win.isMinimized:
                    win.restore()
                    _t.sleep(0.3)
                win.activate()
                _t.sleep(1.0)
                focused = True
        except Exception:
            pass

        if not focused:
            # Strategy 2: Win32 focus
            _wa_focus_hwnd(hwnd)
            _t.sleep(0.5)

        # Verify
        try:
            import ctypes
            user32 = ctypes.windll.user32
            fg = user32.GetForegroundWindow()
            if fg == hwnd:
                return hwnd
            # Check by title match as fallback
            fg_title = user32.GetWindowText(fg) or ""
            if "whatsapp" in fg_title.lower():
                return fg
        except Exception:
            pass

        # Retry with Alt+Tab approach
        if _WA_AVAILABLE and attempt < 2:
            log(f"WhatsApp focus attempt {attempt+1}/3 — trying Alt+Tab...")
            _wa_win32_key_down(_WA_VK_MAP["alt"])
            _t.sleep(0.1)
            _wa_press("tab")
            _t.sleep(0.3)
            _wa_win32_key_up(_WA_VK_MAP["alt"])
            _t.sleep(1.5)
            try:
                import ctypes
                fg = ctypes.windll.user32.GetForegroundWindow()
                fg_title = ctypes.windll.user32.GetWindowText(fg) or ""
                if "whatsapp" in fg_title.lower():
                    return fg
            except Exception:
                pass

    log("Could not focus WhatsApp Desktop after 3 attempts.")
    return None

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

def send_whatsapp_2fa_alert(log=print):
    """Search for Boost Boys in WhatsApp Desktop and send '2FA'.

    Uses the exact same pattern as GFH_Inventory_Audit which is confirmed working:
    - activate window with pygetwindow (no repositioning)
    - Ctrl+F → ctrl+a → write(group_name) → Enter to open chat
    - pyperclip.copy + ctrl+v to paste message text
    - Never uses Escape, Tab, pixel clicks, or PowerShell clipboard
    """
    if not _WA_AVAILABLE:
        log(f"pyautogui not installed — WhatsApp 2FA alert skipped. Error: {_WA_IMPORT_ERROR}")
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

        # Use pygetwindow to activate — same as Inventory Audit
        try:
            import pygetwindow as _gw
            windows = [w for w in _gw.getAllWindows()
                       if "whatsapp" in (w.title or "").lower()]
            if windows:
                win = windows[0]
                if win.isMinimized:
                    win.restore()
                win.activate()
                _t.sleep(1)
                log("WhatsApp Desktop focused.")
            else:
                log("WhatsApp window not found via pygetwindow.")
        except Exception:
            # Fall back to hwnd focus if pygetwindow fails
            hwnd = _wa_find_hwnd()
            if hwnd:
                _wa_focus_hwnd(hwnd)
                log("WhatsApp Desktop focused (hwnd fallback).")
            else:
                log("WhatsApp Desktop window not found — skipping alert.")
                return False

        _t.sleep(1.0)

        # ── Search for group — exact Inventory Audit pattern ──────────────────
        # Ctrl+F opens search, ctrl+a clears it, write types the name, Enter opens
        _wa_hotkey("ctrl", "f")
        _t.sleep(0.7)
        _wa_hotkey("ctrl", "a")
        _t.sleep(0.2)
        if not (_WA_GROUP_NAME or "").strip():
            log("No WhatsApp group configured \u2014 skipping 2FA alert.")
            return False
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

def _vp_fire_whatsapp_2fa(log=print):
    """Fire a one-off WhatsApp 2FA alert in the background. Skips if no group set."""
    try:
        if not (_WA_GROUP_NAME or "").strip():
            log("No WhatsApp group configured \u2014 skipping 2FA alert.")
            return
        import threading as _vp_th
        _vp_th.Thread(target=send_whatsapp_2fa_alert, kwargs={"log": log}, daemon=True).start()
    except Exception as _exc:
        log("WhatsApp alert error: %s" % _exc)

def send_whatsapp_report_message(report_text, report_group_name, log=print):
    """Send a device-check report to a WhatsApp group via Desktop app."""
    if not _WA_AVAILABLE:
        log("pyautogui not installed — WhatsApp report skipped.")
        return False
    try:
        import pyperclip as _pyperclip
    except ImportError:
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "pyperclip",
                             "--quiet", "--disable-pip-version-check"],
                            capture_output=True, timeout=60)
            import pyperclip as _pyperclip
        except Exception:
            _pyperclip = None
    try:
        import time as _t
        if not (report_group_name or "").strip():
            log("No WhatsApp report group configured — skipping report."); return False

        # ── Focus WhatsApp reliably ──
        hwnd = _wa_ensure_focused(log=log)
        if hwnd is None:
            log("Cannot focus WhatsApp — report not sent."); return False

        _t.sleep(0.5)

        # ── Search for the report group ──
        # Press Escape first to close any open search/popup
        _wa_press("escape")
        _t.sleep(0.3)

        _wa_hotkey("ctrl", "f")
        _t.sleep(0.8)
        _wa_hotkey("ctrl", "a")
        _t.sleep(0.2)
        _wa_write(report_group_name, interval=0.05)
        _t.sleep(1.5)
        _wa_press("enter")
        _t.sleep(2.0)

        # ── Paste report text ──
        if _pyperclip is not None:
            _pyperclip.copy(report_text)
            _wa_hotkey("ctrl", "v")
        else:
            _wa_write(report_text[:500], interval=0.02)
        _t.sleep(0.8)
        _wa_press("enter")
        _t.sleep(1.5)

        log(f"WhatsApp report sent to '{report_group_name}' group.")
        return True
    except Exception as exc:
        log(f"WhatsApp report error: {exc}")
        return False

def send_whatsapp_report_image(image_path, report_group_name, log=print):
    """Send a screenshot image to a WhatsApp group via Desktop app."""
    if not _WA_AVAILABLE:
        return False
    try:
        import time as _t
        if not os.path.isfile(image_path):
            log(f"Screenshot file not found: {image_path}"); return False

        # ── Re-focus WhatsApp (may have lost focus after previous send) ──
        hwnd = _wa_ensure_focused(log=log)
        if hwnd is None:
            log("Cannot focus WhatsApp for image send."); return False
        _t.sleep(0.3)

        # ── Navigate to the group chat again ──
        _wa_press("escape")
        _t.sleep(0.3)
        _wa_hotkey("ctrl", "f")
        _t.sleep(0.8)
        _wa_hotkey("ctrl", "a")
        _t.sleep(0.2)
        _wa_write(report_group_name, interval=0.05)
        _t.sleep(1.5)
        _wa_press("enter")
        _t.sleep(2.0)

        # ── Copy image to clipboard and paste ──
        from PIL import Image
        import io as _io, win32clipboard
        image = Image.open(image_path).convert("RGB")
        buf = _io.BytesIO()
        image.save(buf, "BMP")
        bmp_data = buf.getvalue()[14:]
        win32clipboard.OpenClipboard()
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardData(win32clipboard.CF_DIB, bmp_data)
        win32clipboard.CloseClipboard()
        _t.sleep(0.5)
        _wa_hotkey("ctrl", "v")
        _t.sleep(2.0)
        _wa_press("enter")
        _t.sleep(1.5)
        log(f"WhatsApp screenshot sent to '{report_group_name}'.")
        return True
    except Exception as exc:
        log(f"WhatsApp image send error: {exc}")
        return False

def _copy_file_to_clipboard(file_path):
    """Put a file on the Windows clipboard using CF_HDROP format.
    After calling this, Ctrl+V in WhatsApp Desktop will paste the file
    as a document attachment (not as text).
    """
    import ctypes
    import ctypes.wintypes
    import struct

    # ── Declare Win32 function signatures for 64-bit correctness ──
    kernel32 = ctypes.windll.kernel32
    user32 = ctypes.windll.user32

    kernel32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
    kernel32.GlobalAlloc.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalSize.argtypes = [ctypes.c_void_p]
    kernel32.GlobalSize.restype = ctypes.c_size_t
    user32.OpenClipboard.argtypes = [ctypes.c_void_p]
    user32.OpenClipboard.restype = ctypes.c_int
    user32.EmptyClipboard.argtypes = []
    user32.EmptyClipboard.restype = ctypes.c_int
    user32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
    user32.SetClipboardData.restype = ctypes.c_void_p
    user32.CloseClipboard.argtypes = []
    user32.CloseClipboard.restype = ctypes.c_int

    file_path = os.path.abspath(file_path)

    # DROPFILES structure (20 bytes on 32-bit and 64-bit):
    #   DWORD pFiles   = 20  (offset to file list, always 20)
    #   POINT pt       = {x=0, y=0}  (two LONGs = 8 bytes)
    #   BOOL  fNC      = 1   (no coordinates)
    #   BOOL  fWide    = 1   (Unicode paths)
    DROPFILES_HEADER = struct.pack("Iiiii", 20, 0, 0, 1, 1)

    # File list: double-null terminated Unicode (UTF-16-LE) string
    file_list = (file_path + "\x00\x00").encode("utf-16-le")

    blob = DROPFILES_HEADER + file_list
    data_len = len(blob)

    # Allocate movable global memory (GMEM_MOVEABLE = 0x0002)
    GMEM_MOVEABLE = 0x0002
    hMem = kernel32.GlobalAlloc(GMEM_MOVEABLE, data_len)
    if not hMem:
        raise OSError("GlobalAlloc returned NULL")

    # Lock memory to get a writable pointer
    pMem = kernel32.GlobalLock(hMem)
    if not pMem:
        kernel32.GlobalFree(hMem)
        raise OSError(f"GlobalLock returned NULL (hMem=0x{hMem:X}, size={data_len})")

    # Copy data into the allocated memory
    ctypes.memmove(pMem, blob, data_len)

    # DO NOT call GlobalUnlock — clipboard takes ownership after SetClipboardData

    # Set clipboard data (CF_HDROP = 15)
    CF_HDROP = 15
    if not user32.OpenClipboard(None):
        raise OSError("OpenClipboard failed")
    user32.EmptyClipboard()
    result = user32.SetClipboardData(CF_HDROP, hMem)
    if not result:
        # SetClipboardData failed — clean up
        user32.CloseClipboard()
        kernel32.GlobalFree(hMem)
        raise OSError("SetClipboardData failed")
    user32.CloseClipboard()

def send_whatsapp_report_file(file_path, report_group_name, log=print,
                               caption_text=None):
    """Send a file (e.g. XLSX log) to a WhatsApp group via Desktop app.
    Uses CF_HDROP clipboard format — puts the file on clipboard, then
    Ctrl+V pastes it as a document attachment in WhatsApp.
    If caption_text is provided, it is typed as a caption on the file
    before pressing Enter to send."""
    if not _WA_AVAILABLE:
        log(f"pyautogui not installed — WhatsApp file send skipped. Error: {_WA_IMPORT_ERROR}")
        return False
    try:
        import time as _t
        if not os.path.isfile(file_path):
            log(f"File not found: {file_path}"); return False

        # ── Copy file to clipboard as CF_HDROP ──
        try:
            _copy_file_to_clipboard(file_path)
            log(f"File copied to clipboard: {os.path.basename(file_path)}")
        except Exception as clip_err:
            log(f"Clipboard file copy failed: {clip_err}")
            return False

        _t.sleep(0.5)

        # ── Focus WhatsApp ──
        hwnd = _wa_ensure_focused(log=log)
        if hwnd is None:
            log("Cannot focus WhatsApp for file send."); return False
        _t.sleep(0.5)

        # ── Navigate to the group chat ──
        _wa_press("escape")
        _t.sleep(0.3)
        _wa_hotkey("ctrl", "f")
        _t.sleep(0.8)
        _wa_hotkey("ctrl", "a")
        _t.sleep(0.2)
        _wa_write(report_group_name, interval=0.05)
        _t.sleep(1.5)
        _wa_press("enter")
        _t.sleep(2.0)

        # ── Paste file from clipboard (Ctrl+V) — WhatsApp Desktop shows
        #    a document attachment preview with a caption text input ──
        _wa_hotkey("ctrl", "v")
        _t.sleep(2.5)

        # ── Type caption text if provided (appears below the file preview) ──
        if caption_text:
            try:
                import pyperclip as _pyperclip
                _pyperclip.copy(caption_text)
                _wa_hotkey("ctrl", "v")
            except Exception:
                _wa_write(caption_text[:800], interval=0.02)
            _t.sleep(0.8)

        # ── Press Enter to send the attachment (with caption) ──
        _wa_press("enter")
        _t.sleep(1.5)

        log(f"WhatsApp file sent to '{report_group_name}': {os.path.basename(file_path)}")
        return True
    except Exception as exc:
        log(f"WhatsApp file send error: {exc}")
        return False

# ============================================================================
# EDGE / VPN BROWSER CONFIG  (ported from the Incentive Dashboard Extractor)
# The bot no longer force-closes your open Edge windows (which discards your
# tabs and logged-in sessions). Instead it uses a dedicated Edge automation
# profile opened with remote debugging enabled; you connect your VPN inside
# that window and Selenium attaches to the already-open browser.
# ============================================================================
CRM_MAIN_PANEL_URL = "https://www.vidapaycrm.com/Main%20Panel.aspx"

# Distinct from Extractor (port 9222) and Transfer Bot (port 9224) so
# running multiple GFH/VidaPay tools at once each gets its own Edge
# process/window instead of colliding on a shared profile+port and
# opening as tabs inside whichever tool launched first.
AUTOMATION_PROFILE_DIR = r"C:\VidaPay_Edge_Automation_Profile_Ordering"
REMOTE_DEBUGGING_PORT = 9223

# Active CDP port used when attaching. Fixed automation port by
# default; auto-discovered from DevToolsActivePort files when
# that port is closed (chrome://inspect remote debugging), see
# _discover_devtools_port (idea: chrome-devtools-mcp #1826).
_ACTIVE_CDP_PORT = REMOTE_DEBUGGING_PORT
ATTACH_TO_OPEN_EDGE = True

# ── Variant feature switches (set per build) ────────────────────────
# MULTIBROWSER builds: ENABLE_BROWSER_SELECT = True → a startup dialog
# lets the operator pick Edge / Chrome / Opera / Firefox / Brave.
ENABLE_BROWSER_SELECT = False
# NOCLONE builds: NOCLONE_MODE = True → standalone direct login; the
# bot launches its own browser without the VPN-setup/attach step, so it
# works without a VPN or a cloned/automation profile ritual.
NOCLONE_MODE = False
# Result of the browser-selection dialog (default = Microsoft Edge).
SELECTED_BROWSER = "edge"

PAGE_LOAD_TIMEOUT = 90
DOWNLOAD_DIR = str(Path.home() / "Downloads")


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

def wait_for_body(driver, timeout=HUMAN_VERIFY_WAIT_SECONDS):
    WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )


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


def open_vpn_setup_browser(url=None, log=print):
    if url is None:
        url = CRM_MAIN_PANEL_URL

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
        url,
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


def create_edge_driver(log=print, attach=None):
    """Start (or attach to) the automation Edge browser and return a Selenium driver.

    attach=True  → attach to the dedicated VPN-setup Edge window (remote debugging).
    attach=False → launch the automation browser directly, standalone (no VPN/attach
                   ritual) — used by NOCLONE builds.
    attach=None  → use the ATTACH_TO_OPEN_EDGE build constant.
    """
    global _ACTIVE_CDP_PORT
    if ATTACH_TO_OPEN_EDGE if attach is None else attach:
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

        options = Options()
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

    options = Options()
    options.add_argument("--start-maximized")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-popup-blocking")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument(f"--user-data-dir={AUTOMATION_PROFILE_DIR}")
    options.add_argument("--profile-directory=Default")

    # Anti-detection: hide that this is a WebDriver-controlled browser.
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

def create_variant_driver(log=print):
    """Create the driver configured for this build's variants.

    - MULTIBROWSER builds that picked Edge (or left the default) and all
      Edge-only builds go through the normal Edge automation-browser flow.
    - MULTIBROWSER builds that picked Chrome/Opera/Firefox/Brave launch that
      browser through browser_helper with an isolated automation profile.
    - NOCLONE builds skip the attach/VPN-setup ritual entirely and launch the
      automation browser directly (standalone direct login).
    """
    global SELECTED_BROWSER  # assigned in the fallback below; keep it module-level
    browser = (SELECTED_BROWSER or "edge").lower()

    if browser in ("chrome", "opera", "firefox", "brave"):
        try:
            import browser_helper
            return browser_helper.create_browser_driver(
                browser,
                download_dir=DOWNLOAD_DIR,
                log=log,
            )
        except Exception as e:
            log(f"Could not start {browser}: {e} — falling back to Edge.")
            SELECTED_BROWSER = "edge"

    # NOCLONE builds: standalone direct login — launch the browser ourselves,
    # no attach / VPN-setup window required.
    return create_edge_driver(log=log, attach=not NOCLONE_MODE)

class VidapayOrderingSystem:
    def __init__(
        self,
        login_account_id,
        login_username,
        login_password,
        download_folder,
        log_callback,
        progress_callback,
        wait_for_2fa_callback,
        stop_event,
        store_status_callback=None,
    ):
        self.login_account_id = login_account_id
        self.login_username = login_username
        self.login_password = login_password
        self.download_folder = download_folder

        self.log = log_callback
        self.progress = progress_callback
        self.wait_for_2fa = wait_for_2fa_callback
        self.stop_event = stop_event
        self.store_status_callback = store_status_callback
        self.store_statuses = {}

        self.driver = None
        self.wait = None
        self.actions = None

        self.total_ordered = 0
        self.total_cost = 0
        self.order_log = []
        self.wait_time = 2
        self.items_added_to_cart = False
        # Dynamic credit tracking: running available credit for the current
        # store/cart session. Seeded once from the account funds limit and
        # decremented as each line is added, so the bot verifies the real
        # REMAINING credit before adding each product. None = unreadable/off.
        self.remaining_credit = None
        self.credit_exhausted = False

        # Check-only mode (when True, never adds to cart or submits)
        self.check_only = False
        self.check_log = []

    def mark_store_status(self, store_info, status, detail=""):
        account_id = store_info.get("account_id", "")
        self.store_statuses[account_id] = {
            "status": status,
            "detail": detail,
            "store": store_info.get("name", ""),
        }

        if self.store_status_callback:
            try:
                self.store_status_callback(account_id, status, detail)
            except Exception as e:
                self.log(f"Store status UI update failed: {e}")

    def should_stop(self):
        return self.stop_event.is_set()

    def start_browser_and_login(self):
        if NOCLONE_MODE:
            self.log("Preparing VidaPay automation browser (standalone no-clone mode)...")
            self.log("(The bot launches its own browser — no VPN setup step required.)")
        elif ENABLE_BROWSER_SELECT:
            self.log(f"Preparing VidaPay automation browser ({SELECTED_BROWSER})...")
            self.log("(A dedicated automation browser window opens if needed -- keep any VPN connected in it.)")
        else:
            self.log("Preparing VidaPay Edge automation browser...")
            self.log("(A dedicated Edge automation window opens if needed -- keep your VPN connected in it.)")

        try:
            # ── Browser opening ported from the Incentive Dashboard Extractor ──
            # Attaches to the dedicated Edge automation profile (opens it via
            # open_vpn_setup_browser when necessary) instead of force-closing
            # the user's Edge windows and relaunching a private profile.
            # MULTIBROWSER builds launch the operator-selected browser instead.
            self.driver = create_variant_driver(log=self.log)
            self.actions = ActionChains(self.driver)
            self.wait = WebDriverWait(self.driver, 30)

            self.log(f"Opening VidaPay CRM main panel: {CRM_MAIN_PANEL_URL}")
            if not open_url_in_edge_tab(self.driver, CRM_MAIN_PANEL_URL, timeout=45, log=self.log):
                self.log("Failed to open the VidaPay CRM main panel in the Edge tab.")
                self.log("Browser kept open for manual review.")
                return False

            time.sleep(3)

            if self.should_stop():
                return False

            if self.is_main_panel_ready() or self.is_handset_ordering_page():
                self.log("Already logged in. Continuing to MA Handset Ordering.")
                return True

            self.log("Filling login credentials...")

            account_field = self.wait.until(
                EC.presence_of_element_located((By.ID, "AccountId"))
            )
            account_field.clear()
            account_field.send_keys(self.login_account_id)
            self.log(f"Account ID entered: {self.login_account_id}")

            username_field = self.driver.find_element(By.ID, "Username")
            username_field.clear()
            username_field.send_keys(self.login_username)
            self.log(f"Username entered: {self.login_username}")

            password_field = self.driver.find_element(By.ID, "Password")
            password_field.clear()
            password_field.send_keys(self.login_password)
            self.log("Password entered.")

            time.sleep(1)

            login_btn = None

            for selector in ["#LoginButton", "input[type='submit']", "button[type='submit']"]:
                try:
                    candidate = self.driver.find_element(By.CSS_SELECTOR, selector)

                    if candidate.is_displayed() and candidate.is_enabled():
                        login_btn = candidate
                        break
                except Exception:
                    continue

            if login_btn:
                login_btn.click()
                self.log("Login button clicked.")
            else:
                password_field.send_keys(Keys.RETURN)
                self.log("Enter key submitted login form.")

            if self.should_stop():
                return False

            return self.complete_vidapay_signin_flow()

        except Exception as e:
            self.log(f"Failed to start browser or login: {e}")
            return False

    def get_visible_h3_texts(self):
        texts = []
        try:
            for element in self.driver.find_elements(By.TAG_NAME, "h3"):
                try:
                    if element.is_displayed():
                        value = element.text.strip()
                        if value:
                            texts.append(value)
                except Exception:
                    continue
        except Exception:
            pass
        return texts

    def page_has_h3(self, expected_text):
        expected = expected_text.strip().lower()
        return any(expected in text.lower() for text in self.get_visible_h3_texts())

    def safe_click_element(self, element, label):
        try:
            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
            time.sleep(0.3)
            element.click()
            self.log(f"Clicked: {label}")
            return True
        except Exception:
            try:
                self.driver.execute_script("arguments[0].click();", element)
                self.log(f"Clicked by JavaScript: {label}")
                return True
            except Exception as e:
                self.log(f"Could not click {label}: {e}")
                return False

    def click_first_visible(self, locators, label):
        for by, value in locators:
            try:
                elements = self.driver.find_elements(by, value)
                for element in elements:
                    try:
                        if element.is_displayed() and element.is_enabled():
                            return self.safe_click_element(element, label)
                    except Exception:
                        continue
            except Exception:
                continue
        return False

    def is_main_panel_ready(self):
        try:
            elements = self.driver.find_elements(
                By.ID,
                "MainContent_panelActivationManager_hlMaHsOrdering"
            )
            return any(el.is_displayed() for el in elements)
        except Exception:
            return False

    def is_handset_ordering_page(self):
        try:
            checks = [
                "ctl00_MainContent_rcbAccountMaHs_Input",
                "MainContent_ddlProductName",
                "MainContent_btnAddToCart",
                "MainContent_btnSubmitCart",
            ]
            for element_id in checks:
                elements = self.driver.find_elements(By.ID, element_id)
                if any(el.is_displayed() for el in elements):
                    return True
        except Exception:
            pass
        return False

    def click_new_sign_in_next(self):
        locators = [
            (By.XPATH, "//button[contains(@onclick, 'goToTwoFactorCheck') and normalize-space()='Next']"),
            (By.CSS_SELECTOR, "button[onclick*='goToTwoFactorCheck']"),
            (By.XPATH, "//button[contains(@class, 'btn') and normalize-space()='Next']"),
        ]
        return self.click_first_visible(locators, "New Sign In Next")

    def click_trust_radio(self):
        locators = [
            (By.ID, "trustRadio"),
            (By.CSS_SELECTOR, "input[name='TrustedDevice'][value='True']"),
        ]

        for by, value in locators:
            try:
                elements = self.driver.find_elements(by, value)
                for element in elements:
                    try:
                        if element.is_displayed() and element.is_enabled():
                            if not element.is_selected():
                                return self.safe_click_element(element, "Trust this device radio")
                            self.log("Trust this device radio already selected.")
                            return True
                    except Exception:
                        continue
            except Exception:
                continue

        return False

    def click_setup_next(self, label="Setup Next"):
        locators = [
            (By.ID, "setupNextBtn"),
            (By.XPATH, "//button[@id='setupNextBtn' and normalize-space()='Next']"),
            (By.XPATH, "//button[contains(@onclick, 'submitThisForm') and normalize-space()='Next']"),
            (By.XPATH, "//button[contains(@class, 'btn') and normalize-space()='Next']"),
        ]
        return self.click_first_visible(locators, label)

    def click_ready_to_go_continue(self):
        locators = [
            (By.XPATH, "//button[contains(@onclick, 'vidapayAutomaticSignIn') and normalize-space()='Continue']"),
            (By.CSS_SELECTOR, "button[onclick*='vidapayAutomaticSignIn']"),
            (By.XPATH, "//button[contains(@class, 'btn') and normalize-space()='Continue']"),
        ]
        return self.click_first_visible(locators, "Ready to Go Continue")

    def complete_vidapay_signin_flow(self, timeout_seconds=420):
        self.log("Checking VidaPay sign-in state...")

        started_at = time.time()
        last_state = None
        two_factor_logged = False
        trust_clicked = False
        setup_next_clicks = 0
        ready_clicked = False

        while time.time() - started_at < timeout_seconds:
            if self.should_stop():
                self.log("Sign-in flow stopped by user.")
                return False

            if self.is_handset_ordering_page():
                self.log("MA Handset Ordering page is already open.")
                return True

            if self.is_main_panel_ready():
                self.log("Main Panel detected. Continuing to MA Handset Ordering.")
                return True

            h3_texts = self.get_visible_h3_texts()
            current_state = " | ".join(h3_texts) if h3_texts else "No known sign-in heading"
            if current_state != last_state:
                self.log(f"Current sign-in state: {current_state}")
                last_state = current_state

            if self.page_has_h3("New Sign In"):
                self.log("New Sign In page detected.")
                if self.click_new_sign_in_next():
                    time.sleep(3)
                    continue

            trust_radio_visible = False
            try:
                trust_radio_visible = any(
                    el.is_displayed()
                    for el in self.driver.find_elements(By.ID, "trustRadio")
                )
            except Exception:
                trust_radio_visible = False

            if trust_radio_visible and not trust_clicked:
                self.log("Trust This Device page detected.")
                if self.click_trust_radio():
                    trust_clicked = True
                    time.sleep(0.5)
                    if self.click_setup_next("Trust This Device Next"):
                        setup_next_clicks += 1
                        time.sleep(3)
                        continue

            # Some accounts show one more Next screen after trusting the device.
            if trust_clicked and setup_next_clicks < 3:
                if self.click_setup_next("Additional setup Next"):
                    setup_next_clicks += 1
                    time.sleep(3)
                    continue

            if self.page_has_h3("Ready to Go") or not ready_clicked:
                if self.click_ready_to_go_continue():
                    ready_clicked = True
                    time.sleep(5)
                    continue

            if self.page_has_h3("2-Factor Authentication"):
                if not two_factor_logged:
                    self.log("2-Factor Authentication detected. Waiting for approval in IBM Verify.")
                    two_factor_logged = True
                    _vp_fire_whatsapp_2fa(self.log)
                time.sleep(2)
                continue

            # Handle Cloudflare Turnstile or reCAPTCHA if it appears during sign-in
            if is_human_verification_page(self.driver):
                self.log("Human verification detected during sign-in. Attempting auto-solve...")
                wait_for_human_verification_clear(
                    self.driver,
                    stop_event=self.stop_event,
                    log=self.log,
                    context="sign-in flow",
                )
                continue

            time.sleep(2)

        self.log("Timed out while waiting for VidaPay sign-in flow to finish.")
        self.log("Browser kept open for manual review.")
        return False

    def click_handset_ordering(self):
        if self.is_handset_ordering_page():
            self.log("Already on MA Handset Ordering page.")
            return True

        self.log("Looking for MA Handset Ordering link...")

        try:
            end_time = time.time() + 60

            while time.time() < end_time:
                if self.should_stop():
                    return False

                if self.is_handset_ordering_page():
                    self.log("MA Handset Ordering page detected.")
                    return True

                links = self.driver.find_elements(
                    By.ID,
                    "MainContent_panelActivationManager_hlMaHsOrdering"
                )

                for link in links:
                    try:
                        if link.is_displayed() and link.is_enabled():
                            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", link)
                            time.sleep(1)
                            link.click()
                            self.log("Clicked MA Handset Ordering.")
                            time.sleep(self.wait_time)
                            return True
                    except Exception:
                        continue

                # Fallback by link text when ID changes.
                fallback_links = self.driver.find_elements(
                    By.XPATH,
                    "//*[contains(normalize-space(), 'MA Handset Ordering')]"
                )

                for link in fallback_links:
                    try:
                        if link.is_displayed() and link.is_enabled():
                            self.safe_click_element(link, "MA Handset Ordering")
                            time.sleep(self.wait_time)
                            return True
                    except Exception:
                        continue

                time.sleep(2)

            self.log("MA Handset Ordering link was not found within 60 seconds.")
            return False

        except Exception as e:
            self.log(f"MA Handset Ordering link error: {e}")
            return False

    def click_submit_button(self):
        if not self.items_added_to_cart:
            self.log("No items were added to cart. Submit skipped.")
            return True

        self.log("Clicking Submit button to finalize all orders...")

        for attempt in range(3):
            if self.should_stop():
                return False

            try:
                time.sleep(2)

                submit_btns = self.driver.find_elements(
                    By.ID,
                    "MainContent_btnSubmitCart"
                )

                if not submit_btns:
                    self.log("Submit button not found. Cart might be empty.")
                    return True

                submit_btn = submit_btns[0]

                if not submit_btn.is_displayed() or not submit_btn.is_enabled():
                    self.log("Submit button is not clickable.")
                    return True

                self.driver.execute_script("arguments[0].scrollIntoView(true);", submit_btn)
                time.sleep(1)
                submit_btn.click()

                self.log("Submit button clicked.")
                time.sleep(3)
                return True

            except Exception as e:
                self.log(f"Submit attempt {attempt + 1} failed: {str(e)[:100]}")
                time.sleep(2)

        self.log("Submit button failed after retries.")
        return False

    def click_new_order_button(self):
        """
        Click the 'New Order' button to start a fresh cart/order session.
        Required after submitting an order when there is still remaining
        quantity to distribute — the CRM cart cannot be reused across a
        second visit to a store already in the current cart, so we must
        finish (submit) the current order and start a new one before
        continuing.
        """
        self.log("Clicking New Order to start a fresh order session...")

        for attempt in range(3):
            if self.should_stop():
                return False

            try:
                time.sleep(2)

                new_order_btns = self.driver.find_elements(
                    By.ID,
                    "MainContent_btnNewOrder"
                )

                if not new_order_btns:
                    self.log("New Order button not found.")
                    return False

                new_order_btn = new_order_btns[0]

                self.driver.execute_script("arguments[0].scrollIntoView(true);", new_order_btn)
                time.sleep(1)

                try:
                    new_order_btn.click()
                except ElementClickInterceptedException:
                    self.driver.execute_script("arguments[0].click();", new_order_btn)

                self.log("New Order button clicked.")
                time.sleep(self.wait_time + 2)
                self.items_added_to_cart = False
                return True

            except Exception as e:
                self.log(f"New Order click attempt {attempt + 1} failed: {str(e)[:100]}")
                time.sleep(2)

        self.log("New Order button failed after retries.")
        return False

    def select_tsp_id(self, account_id, store_name=""):
        display_name = store_name if store_name else account_id

        self.log(f"Selecting store: {display_name} | Account field value: {account_id}")

        methods = [
            ("Write, Arrow Down, Tab", self._select_tspid_method_1),
            ("Write, click dropdown item", self._select_tspid_method_2),
            ("Write, Enter", self._select_tspid_method_3),
            ("JavaScript injection", self._select_tspid_method_4),
        ]

        for method_name, method in methods:
            if self.should_stop():
                return False

            self.log(f"Trying account selection method: {method_name}")

            for attempt in range(2):
                try:
                    time.sleep(2)

                    input_field = self.wait.until(
                        EC.presence_of_element_located(
                            (By.ID, "ctl00_MainContent_rcbAccountMaHs_Input")
                        )
                    )

                    input_field.clear()
                    time.sleep(0.5)

                    if method(input_field, account_id):
                        self.log(f"Account selected using method: {method_name}")
                        time.sleep(self.wait_time + 3)

                        try:
                            self.driver.find_element(
                                By.ID,
                                "MainContent_lblAccountFundsLimit"
                            )
                            self.log("Account verified.")
                            return True
                        except Exception:
                            try:
                                self.driver.find_element(By.CLASS_NAME, "rfdSelectText")
                                self.log("Account verified.")
                                return True
                            except Exception:
                                self.log("Account verification not visible. Continuing.")
                                return True

                except StaleElementReferenceException:
                    self.log(f"Stale element on attempt {attempt + 1}. Retrying...")
                    time.sleep(2)
                except Exception as e:
                    self.log(f"{method_name} attempt {attempt + 1} failed: {str(e)[:100]}")
                    time.sleep(2)

            self.log(f"Method failed: {method_name}")

        self.log(f"All account selection methods failed for Account ID: {account_id}")
        return False

    def _select_tspid_method_1(self, input_field, account_id):
        try:
            input_field.send_keys(account_id)
            time.sleep(1)
            input_field.send_keys(Keys.ARROW_DOWN)
            time.sleep(1)
            input_field.send_keys(Keys.TAB)
            return True
        except Exception as e:
            self.log(f"Method 1 failed: {e}")
            return False

    def _select_tspid_method_2(self, input_field, account_id):
        try:
            input_field.send_keys(account_id)
            time.sleep(2)

            items = self.driver.find_elements(
                By.CSS_SELECTOR,
                ".rcbItem, .rcbHovered, li[class*='rcb']"
            )

            for item in items:
                item_text = item.text.strip()

                if account_id in item_text or item_text == account_id:
                    item.click()
                    self.log(f"Clicked matching account item: {item_text[:60]}")
                    return True

            input_field.send_keys(Keys.ENTER)
            return True

        except Exception as e:
            self.log(f"Method 2 failed: {e}")
            return False

    def _select_tspid_method_3(self, input_field, account_id):
        try:
            input_field.send_keys(account_id)
            time.sleep(1)
            input_field.send_keys(Keys.ENTER)
            return True
        except Exception as e:
            self.log(f"Method 3 failed: {e}")
            return False

    def _select_tspid_method_4(self, input_field, account_id):
        try:
            js_script = f"""
            var input = document.getElementById('ctl00_MainContent_rcbAccountMaHs_Input');
            input.value = '{account_id}';
            input.dispatchEvent(new Event('change'));
            input.dispatchEvent(new KeyboardEvent('keydown', {{key: 'Enter'}}));
            """
            self.driver.execute_script(js_script)
            return True
        except Exception as e:
            self.log(f"Method 4 failed: {e}")
            return False

    def select_product_type_with_retry(self, account_id, store_name, product_type="TBV Branded"):
        max_retries = 3

        for attempt in range(max_retries):
            if self.should_stop():
                return False

            self.log(f"Selecting product type {product_type}. Attempt {attempt + 1}/{max_retries}")

            try:
                time.sleep(2)

                # Short 12-second wait — if dropdown never appears the store is locked
                try:
                    dropdown_trigger = WebDriverWait(self.driver, 12).until(
                        EC.element_to_be_clickable((By.CLASS_NAME, "rfdSelectText"))
                    )
                except TimeoutException:
                    self.log(f"{product_type} dropdown not found after 12s. Store is locked for ordering. Skipping.")
                    return "SKIP"

                self.driver.execute_script("arguments[0].scrollIntoView(true);", dropdown_trigger)
                time.sleep(0.5)
                dropdown_trigger.click()
                time.sleep(1)

                # Check if the requested product type is in the open dropdown
                type_options = self.driver.find_elements(
                    By.XPATH, f"//li[text()='{product_type}']"
                )
                visible_type = [o for o in type_options if o.is_displayed()]

                if not visible_type:
                    self.log(f"{product_type} not in dropdown. Store locked for {product_type} ordering. Skipping.")
                    try:
                        self.driver.find_element(By.TAG_NAME, "body").send_keys(Keys.ESCAPE)
                    except Exception:
                        pass
                    return "SKIP"

                # Product type is present — select it
                type_option = self.wait.until(
                    EC.element_to_be_clickable((By.XPATH, f"//li[text()='{product_type}']"))
                )
                self.driver.execute_script("arguments[0].scrollIntoView(true);", type_option)
                time.sleep(0.5)
                type_option.click()

                self.log(f"Selected: {product_type}.")
                time.sleep(self.wait_time)
                return True

            except (StaleElementReferenceException, ElementClickInterceptedException) as e:
                self.log(f"Product type selection failed: {str(e)[:100]}")

                if attempt < max_retries - 1:
                    self.log("Retrying by re-entering Account ID.")
                    if self.select_tsp_id(account_id, store_name):
                        self.log("Account ID re-entered.")
                    else:
                        self.log("Account ID re-entry failed.")
                    time.sleep(2)
                else:
                    self.log("Product type selection failed after retries.")
                    return False

        return False

    def get_available_funds(self):
        """
        Read the available funds label and return the dollar amount as a float.
        Returns None if the element cannot be read (caller should decide how to proceed).
        """
        try:
            time.sleep(1)

            funds_element = self.wait.until(
                EC.presence_of_element_located(
                    (By.ID, "MainContent_lblAccountFundsLimit")
                )
            )

            funds_text = funds_element.text.strip()
            funds = float(re.sub(r"[^\d.-]", "", funds_text))
            self.log(f"Available funds: ${funds:,.2f}")
            return funds

        except Exception as e:
            self.log(f"Could not read available funds: {e}")
            return None

    def _get_running_funds(self):
        """
        Return the running available credit for the current store/cart session.
        Seeded lazily from the account funds limit
        (MainContent_lblAccountFundsLimit) on first call, then updated
        dynamically as items are added to the cart, so the next product is
        checked against the credit that actually remains (the raw limit label
        does not drop when items are added).
        """
        if self.remaining_credit is None:
            self.remaining_credit = self.get_available_funds()
        return self.remaining_credit

    def compute_affordable_qty(self, requested_qty, unit_price, available_funds):
        """
        Given a requested quantity, the unit price, and the available funds,
        return the largest quantity we can actually afford.

        Rules:
        - If unit_price is unknown (<= 0), credit cannot be verified locally.
          Proceed with the full requested_qty — the CRM server will reject the
          order on submit if credit is truly insufficient.
        - If available_funds is None (unreadable), same approach: proceed and
          let the server validate.
        - Otherwise: affordable = floor(available_funds / unit_price), capped to requested_qty.
        - If affordable == 0 (credit doesn't cover even a single unit), return 0.
        """
        if unit_price <= 0:
            self.log("Unit price not in local database — skipping local credit check.")
            self.log("The CRM will reject the order on submit if credit is insufficient.")
            return requested_qty

        if available_funds is None:
            self.log("Available funds unreadable — skipping local credit check.")
            self.log("The CRM will reject the order on submit if credit is insufficient.")
            return requested_qty

        affordable = int(available_funds / unit_price)
        capped = min(requested_qty, affordable)

        if capped < requested_qty:
            self.log(
                f"Funds cap: ${available_funds:,.2f} / ${unit_price:,.2f} per unit "
                f"= {affordable} affordable. Requested {requested_qty} → using {capped}."
            )

        return capped

    def get_product_price_from_page(self):
        """Try to read the unit price directly from the CRM page after a
        product has been selected.  Tries several common ASP.NET label IDs.
        Returns the price as a float, or None if none of the elements exist
        or their text cannot be parsed."""
        price_candidates = [
            "MainContent_lblUnitPrice",
            "MainContent_lblPrice",
            "MainContent_lblProductPrice",
            "MainContent_lblItemPrice",
            "MainContent_txtUnitPrice",
            "MainContent_lblProductCost",
        ]
        for elem_id in price_candidates:
            try:
                el = self.driver.find_element(By.ID, elem_id)
                text = (el.text or "").strip()
                if not text:
                    continue
                price = float(re.sub(r"[^\d.-]", "", text))
                if price > 0:
                    self.log(f"Live unit price from page ({elem_id}): ${price:,.2f}")
                    return price
            except Exception:
                continue
        return None

    def get_product_price_from_db(self, exact_product_name):
        """Return the unit price for the currently selected product.

        The live CRM page is the only source of truth — we read the price
        from #MainContent_lblProductCost (and a few sibling IDs as fallback)
        after the product has been selected in the dropdown. There is no
        local hardcoded price database anymore.
        """
        live_price = self.get_product_price_from_page()
        if live_price is not None:
            return live_price
        self.log(f"Live price not found on page for: {exact_product_name}")
        return 0.0

    def select_product_and_get_exact_name(self, search_term):
        self.log(f"Searching product: {search_term}")

        for attempt in range(3):
            if self.should_stop():
                return None

            try:
                time.sleep(1)

                product_dropdown = self.wait.until(
                    EC.element_to_be_clickable(
                        (By.ID, "MainContent_ddlProductName")
                    )
                )

                product_dropdown.click()
                time.sleep(1)

                options = product_dropdown.find_elements(By.TAG_NAME, "option")

                for opt in options:
                    opt_text = opt.text.strip()

                    if search_term.lower() == opt_text.lower():
                        self.driver.execute_script("arguments[0].scrollIntoView(true);", opt)
                        time.sleep(0.5)
                        opt.click()
                        self.log(f"Selected exact match: {opt_text}")
                        time.sleep(self.wait_time)
                        return opt_text

                for opt in options:
                    opt_text = opt.text.strip()

                    if search_term.lower() in opt_text.lower():
                        self.driver.execute_script("arguments[0].scrollIntoView(true);", opt)
                        time.sleep(0.5)
                        opt.click()
                        self.log(f"Selected partial match: {opt_text}")
                        time.sleep(self.wait_time)
                        return opt_text

                self.log(f"Product not found: {search_term}")
                return None

            except StaleElementReferenceException:
                self.log(f"Stale product dropdown on attempt {attempt + 1}. Retrying.")
                time.sleep(1)
            except Exception as e:
                self.log(f"Product selection failed: {e}")
                return None

        return None

    def check_available_inventory(self):
        try:
            time.sleep(1)

            inventory_element = self.wait.until(
                EC.presence_of_element_located(
                    (By.ID, "MainContent_lblAvailableInventory")
                )
            )

            available = int(inventory_element.text.strip())
            self.log(f"Available inventory: {available}")
            return available

        except Exception as e:
            self.log(f"Inventory check failed: {e}")
            return 0

    def set_quantity_with_retry(self, quantity):
        for attempt in range(3):
            if self.should_stop():
                return False

            try:
                qty_field = self.wait.until(
                    EC.presence_of_element_located(
                        (By.ID, "MainContent_txtMinMaxStepQty")
                    )
                )

                max_qty_attr = qty_field.get_attribute("max")
                max_qty = int(max_qty_attr) if max_qty_attr else 999

                if quantity > max_qty:
                    self.log(f"Requested {quantity} exceeds max {max_qty}. Using {max_qty}.")
                    quantity = max_qty

                qty_field.clear()
                time.sleep(0.5)
                qty_field.send_keys(str(quantity))
                time.sleep(0.5)

                self.log(f"Quantity set to: {quantity}")
                return True

            except StaleElementReferenceException:
                self.log(f"Stale quantity field on attempt {attempt + 1}. Retrying.")
                time.sleep(1)
            except Exception as e:
                self.log(f"Quantity field failed: {e}")
                time.sleep(1)

        return False

    def add_to_cart_with_retry(self):
        for attempt in range(3):
            if self.should_stop():
                return False

            try:
                add_btn = self.wait.until(
                    EC.element_to_be_clickable((By.ID, "MainContent_btnAddToCart"))
                )

                self.driver.execute_script("arguments[0].scrollIntoView(true);", add_btn)
                time.sleep(0.5)
                add_btn.click()
                time.sleep(1)

                self.log("Added to cart.")
                self.items_added_to_cart = True
                return True

            except StaleElementReferenceException:
                self.log(f"Stale Add to Cart button on attempt {attempt + 1}. Retrying.")
                time.sleep(1)
            except ElementClickInterceptedException:
                self.log("Click intercepted. Trying JavaScript click.")

                try:
                    add_btn = self.driver.find_element(By.ID, "MainContent_btnAddToCart")
                    self.driver.execute_script("arguments[0].click();", add_btn)
                    self.log("Added to cart through JavaScript.")
                    self.items_added_to_cart = True
                    return True
                except Exception:
                    pass
            except Exception as e:
                self.log(f"Add to Cart failed: {e}")
                time.sleep(1)

        return False

    def _availability_strings(self, stock_ok, unit_price, available_funds):
        """Return (stock_str, credit_str) describing whether stock and
        credit/funds were each available, independent of one another, for
        CSV reporting. stock_ok: True/False/None (None = unknown/not checked).
        """
        if stock_ok is None:
            stock_str = "Unknown"
        else:
            stock_str = "Yes" if stock_ok else "No"

        if available_funds is None or not unit_price or unit_price <= 0:
            credit_str = "Unknown"
        else:
            credit_str = "Yes" if available_funds >= unit_price else "No"

        return stock_str, credit_str

    def order_single_product(self, product_search, quantity, store_info, order_type="NORMAL"):
        """
        Select a product, cap the quantity by available inventory AND available funds,
        then add to cart.

        quantity=9999 is the sentinel for "MAX per store" — it will be capped by
        both inventory and funds automatically.
        """
        self.log(f"Product: {product_search} | Requested quantity: {quantity if quantity < 9000 else 'MAX'}")

        exact_name = self.select_product_and_get_exact_name(product_search)

        if not exact_name:
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": product_search,
                "Product Selected": "NOT FOUND",
                "Quantity": 0,
                "Unit Price": 0,
                "Total Cost": 0,
                "Stock Available": "Unknown",
                "Credit Available": "N/A",
                "Status": "PRODUCT NOT FOUND",
            })
            return 0

        # ── price lookup ──────────────────────────────────────────────────────
        unit_price = self.get_product_price_from_db(exact_name)

        # ── funds check FIRST ────────────────────────────────────────────────
        # If available credit can't cover even a single unit, the order can't
        # be placed regardless of stock → record INSUFFICIENT FUNDS and stop.
        available_funds = self._get_running_funds()
        available_inventory = self.check_available_inventory()
        credit_amt = f"${available_funds:,.2f}" if available_funds is not None else "Unknown"

        if unit_price > 0 and available_funds is not None and available_funds < unit_price:
            funds_str = f"${available_funds:,.2f}" if available_funds is not None else "$?"
            self.log(
                f"Insufficient funds: unit price ${unit_price:,.2f}, "
                f"available funds {funds_str}."
            )
            self.credit_exhausted = True  # no remaining credit for this product
            stock_str = str(available_inventory) if available_inventory is not None else "Unknown"
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": product_search,
                "Product Selected": exact_name,
                "Quantity": 0,
                "Unit Price": unit_price,
                "Total Cost": 0,
                "Stock Available": (available_inventory if available_inventory is not None else "Unknown"),
                "Credit Available": credit_amt,
                "Status": "INSUFFICIENT FUNDS",
            })
            return 0

        # ── stock check ──────────────────────────────────────────────────────
        # Funds are sufficient (or unknown) — if no stock, the order can't be
        # placed → record OUT OF STOCK and stop.
        if available_inventory == 0:
            stock_str = str(available_inventory) if available_inventory is not None else "Unknown"
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": product_search,
                "Product Selected": exact_name,
                "Quantity": 0,
                "Unit Price": unit_price,
                "Total Cost": 0,
                "Stock Available": (available_inventory if available_inventory is not None else "Unknown"),
                "Credit Available": credit_amt,
                "Status": "OUT OF STOCK",
            })
            return 0

        # Start from the smaller of requested qty and available inventory
        order_qty = min(quantity, available_inventory)

        if order_qty < quantity and quantity < 9000:
            self.log(f"Inventory cap: only {available_inventory} in stock. Ordered qty reduced to {order_qty}.")

        # ── funds cap (still applies when N×cost exceeds credit) ─────────────
        order_qty = self.compute_affordable_qty(order_qty, unit_price, available_funds)

        if order_qty == 0:
            funds_str = f"${available_funds:,.2f}" if available_funds is not None else "$?"
            msg = (
                f"Cannot afford even 1 unit. "
                f"Unit price ${unit_price:,.2f}, available funds {funds_str}."
            )
            self.log(msg)
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": product_search,
                "Product Selected": exact_name,
                "Quantity": 0,
                "Unit Price": unit_price,
                "Total Cost": 0,
                "Stock Available": (available_inventory if available_inventory is not None else "Unknown"),
                "Credit Available": credit_amt,
                "Status": "INSUFFICIENT FUNDS",
            })
            return 0

        # ── set quantity and add to cart ──────────────────────────────────────
        if not self.set_quantity_with_retry(order_qty):
            return 0

        if not self.add_to_cart_with_retry():
            return 0

        total_cost = order_qty * unit_price
        self.total_cost += total_cost

        # Dynamic credit: consume this line's cost from the running remaining
        # credit so the next product is checked against what's genuinely left.
        if self.remaining_credit is not None:
            self.remaining_credit -= total_cost
            if self.remaining_credit < 0:
                self.remaining_credit = 0.0
            self.log(f"Remaining credit after adding: ${self.remaining_credit:,.2f}")

        self.order_log.append({
            "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "District": store_info["district"],
            "Account ID": store_info["account_id"],
            "Username": store_info.get("username", ""),
            "Store name": store_info["name"],
            "Product Searched": product_search,
            "Product Selected": exact_name,
            "Quantity": order_qty,
            "Unit Price": unit_price,
            "Total Cost": total_cost,
            "Stock Available": (available_inventory if available_inventory is not None else "Unknown"),
            "Credit Available": credit_amt,
            "Status": f"SUCCESS ({order_type})",
        })

        self.log(f"Unit price: ${unit_price:,.2f} | Ordered: {order_qty} | Total: ${total_cost:,.2f}")
        return order_qty

    def process_district_distribute(
        self,
        product_name: str,
        district_target: int,
        store_list: list,
        district_name: str,
        product_type: str = "TBV Branded",
    ) -> int:
        """
        Order `district_target` units of `product_name` across the stores in
        `store_list` (all belonging to the same district).

        Algorithm (one cart/order session at a time):
        1. Walk through the stores once, requesting up to the full remaining
           target from each. Each store orders min(remaining, inventory,
           affordable-by-credit) — if a store's credit can't cover what we
           asked for, we just take what it CAN afford and the shortfall rolls
           forward to the next store in the same pass.
        2. A store is only ever visited ONCE per cart/order session — the CRM
           cart does not support re-selecting a store that's already been used
           in the current, not-yet-submitted cart.
        3. If target isn't met after visiting every store once, and at least
           one store isn't permanently exhausted (out of stock AND out of
           credit), we submit the current cart (Submit) and click New Order to
           start a fresh cart, then run another full pass through the stores.
        4. Continue until the target is met, every store is exhausted, or no
           progress is made in a full session (safety stop).

        Returns the total units actually ordered across the district.
        """
        if district_target <= 0 or not store_list:
            return 0

        self.log(f"{'='*60}")
        self.log(f"DISTRICT DISTRIBUTE ({product_type}): {district_name} | Target: {district_target} units")
        self.log(f"Stores: {[s['name'] for s in store_list]}")
        self.log(f"{'='*60}")

        n = len(store_list)
        district_total = 0
        remaining = district_target

        # Permanently exhausted (out of stock AND out of credit) — never revisit,
        # even in a brand-new order session.
        store_exhausted = [False] * n

        # Safety cap on how many New-Order cycles we'll do, to guarantee
        # termination even if something behaves unexpectedly.
        max_sessions = n + 2
        session_num = 0

        while remaining > 0 and not all(store_exhausted) and session_num < max_sessions:
            session_num += 1
            self.log(f"  Order session {session_num}: {remaining} unit(s) still needed.")
            made_progress = False

            for i, store in enumerate(store_list):
                if self.should_stop():
                    return district_total

                if store_exhausted[i] or remaining <= 0:
                    continue

                self.log(f"  [{i+1}/{n}] {store['name']} — requesting up to {remaining} (rolling shortfall included)")

                if not self._setup_store_for_ordering(store, product_type=product_type):
                    self.log(f"  Store setup failed: {store['name']}. Will retry in a future session.")
                    continue

                ordered = self._order_capped(product_name, remaining, store)
                district_total += ordered
                self.total_ordered += ordered
                remaining -= ordered

                if ordered > 0:
                    made_progress = True
                    self.log(f"  Ordered {ordered}. Remaining target: {remaining}")
                else:
                    store_exhausted[i] = self._store_is_exhausted(product_name, store)
                    self.log(f"  Store ordered 0. Exhausted={store_exhausted[i]}. Remaining target: {remaining}")

            if remaining <= 0:
                break

            if all(store_exhausted):
                self.log("  All stores exhausted (no stock and no credit left anywhere). Stopping.")
                break

            if not made_progress:
                self.log("  No progress made this session. Stopping to avoid an infinite loop.")
                break

            # Every non-exhausted store has now been visited once in this cart.
            # We cannot re-select any of them again in the same, uncommitted cart
            # (the system does not allow it), so finish this order and start a
            # fresh one before continuing to distribute the remainder.
            self.log("  Completing current order and starting a new one to continue distributing...")

            if self.items_added_to_cart:
                if not self.click_submit_button():
                    self.log("  Could not submit current order. Stopping distribute loop.")
                    break

            if not self.click_new_order_button():
                self.log("  Could not start a new order session. Stopping distribute loop.")
                break

        if remaining > 0:
            self.log(f"  WARNING: {district_name} target {district_target} — only {district_total} ordered. {remaining} short.")
        else:
            self.log(f"  {district_name} target {district_target} ACHIEVED. Total ordered: {district_total}.")

        return district_total

    def _setup_store_for_ordering(self, store_info: dict, product_type: str = "TBV Branded") -> bool:
        """Select the store account and the requested product type. Returns False on failure."""
        self.remaining_credit = None
        self.credit_exhausted = False
        if not self.select_tsp_id(store_info["account_id"], store_info["name"]):
            self.log(f"Account selection failed: {store_info['name']}")
            return False
        if self.should_stop():
            return False
        if not self.select_product_type_with_retry(store_info["account_id"], store_info["name"], product_type=product_type):
            self.log(f"Product type selection failed: {store_info['name']}")
            return False
        return True

    def _order_capped(self, product_name: str, requested_qty: int, store_info: dict) -> int:
        """
        Select the product, apply inventory + funds caps, add to cart.
        Returns the actual quantity ordered (may be < requested_qty).
        Does NOT navigate to the store — caller must call _setup_store_for_ordering first.
        """
        exact_name = self.select_product_and_get_exact_name(product_name)
        if not exact_name:
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": product_name,
                "Product Selected": "NOT FOUND",
                "Quantity": 0,
                "Unit Price": 0,
                "Total Cost": 0,
                "Stock Available": "Unknown",
                "Credit Available": "N/A",
                "Status": "PRODUCT NOT FOUND",
            })
            return 0

        unit_price = self.get_product_price_from_db(exact_name)

        # Funds check FIRST
        available_funds = self._get_running_funds()
        available_inventory = self.check_available_inventory()
        credit_amt = f"${available_funds:,.2f}" if available_funds is not None else "Unknown"

        if unit_price > 0 and available_funds is not None and available_funds < unit_price:
            funds_str = f"${available_funds:,.2f}" if available_funds is not None else "$?"
            self.log(
                f"Insufficient funds: unit price ${unit_price:,.2f}, "
                f"available funds {funds_str}."
            )
            self.credit_exhausted = True  # no remaining credit for this product
            stock_str = str(available_inventory) if available_inventory is not None else "Unknown"
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": product_name,
                "Product Selected": exact_name,
                "Quantity": 0,
                "Unit Price": unit_price,
                "Total Cost": 0,
                "Stock Available": (available_inventory if available_inventory is not None else "Unknown"),
                "Credit Available": credit_amt,
                "Status": "INSUFFICIENT FUNDS",
            })
            return 0

        # Stock check second
        if available_inventory == 0:
            stock_str = str(available_inventory) if available_inventory is not None else "Unknown"
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": product_name,
                "Product Selected": exact_name,
                "Quantity": 0,
                "Unit Price": unit_price,
                "Total Cost": 0,
                "Stock Available": (available_inventory if available_inventory is not None else "Unknown"),
                "Credit Available": credit_amt,
                "Status": "OUT OF STOCK",
            })
            return 0

        order_qty = min(requested_qty, available_inventory)
        if order_qty < requested_qty:
            self.log(f"Inventory cap: {available_inventory} available. Using {order_qty} of {requested_qty}.")

        order_qty = self.compute_affordable_qty(order_qty, unit_price, available_funds)

        if order_qty == 0:
            funds_str2 = f"${available_funds:,.2f}" if available_funds is not None else "$?"
            self.log(
                f"Cannot afford even 1 unit. "
                f"Price ${unit_price:,.2f}, funds {funds_str2}."
            )
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": product_name,
                "Product Selected": exact_name,
                "Quantity": 0,
                "Unit Price": unit_price,
                "Total Cost": 0,
                "Stock Available": (available_inventory if available_inventory is not None else "Unknown"),
                "Credit Available": credit_amt,
                "Status": "INSUFFICIENT FUNDS",
            })
            return 0

        if not self.set_quantity_with_retry(order_qty):
            return 0
        if not self.add_to_cart_with_retry():
            return 0

        total_cost = order_qty * unit_price
        self.total_cost += total_cost

        # Dynamic credit: consume this line's cost from the running remaining
        # credit so the next product is checked against what's genuinely left.
        if self.remaining_credit is not None:
            self.remaining_credit -= total_cost
            if self.remaining_credit < 0:
                self.remaining_credit = 0.0
            self.log(f"Remaining credit after adding: ${self.remaining_credit:,.2f}")

        self.order_log.append({
            "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "District": store_info["district"],
            "Account ID": store_info["account_id"],
            "Username": store_info.get("username", ""),
            "Store name": store_info["name"],
            "Product Searched": product_name,
            "Product Selected": exact_name,
            "Quantity": order_qty,
            "Unit Price": unit_price,
            "Total Cost": total_cost,
            "Stock Available": (available_inventory if available_inventory is not None else "Unknown"),
            "Credit Available": credit_amt,
            "Status": "SUCCESS (DISTRIBUTE)",
        })
        self.log(f"Price ${unit_price:,.2f} | Ordered {order_qty} | Cost ${total_cost:,.2f}")
        return order_qty

    def _store_is_exhausted(self, product_name: str, store_info: dict) -> bool:
        """
        Quick check: is the store both out of stock AND out of funds for this product?
        Used to decide whether to skip a store in carry-over rounds.
        """
        # Re-select the product to read live inventory
        try:
            exact_name = self.select_product_and_get_exact_name(product_name)
            if not exact_name:
                return True  # product not found = can't order

            inventory = self.check_available_inventory()
            if inventory == 0:
                return True  # out of stock

            # Check funds
            unit_price = self.get_product_price_from_db(exact_name)
            funds = self.get_available_funds()
            if funds is not None and unit_price > 0 and funds < unit_price:
                return True  # can't afford even 1

            return False
        except Exception:
            return True

    def process_single_store_products(self, store_info, products_list, product_type="TBV Branded"):
        self.mark_store_status(store_info, "RUNNING", "Processing store")
        self.log("============================================================")
        self.log(f"PROCESSING STORE ({product_type}): {store_info['name']} | Account field value: {store_info['account_id']}")
        self.log(f"District: {store_info['district']} | Username: {store_info.get('username', '')}")
        self.log(f"Products to order: {len(products_list)}")
        self.log("============================================================")

        if self.should_stop():
            self.mark_store_status(store_info, "STOPPED", "Stopped before account selection")
            return 0

        if not self.select_tsp_id(store_info["account_id"], store_info["name"]):
            detail = "Account selection failed"
            self.log(f"FAILED STORE: {store_info['name']} | {detail}")
            self.mark_store_status(store_info, "FAILED", detail)
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": "STORE LEVEL",
                "Product Selected": "N/A",
                "Quantity": 0,
                "Unit Price": 0,
                "Total Cost": 0,
                "Stock Available": "Unknown",
                "Credit Available": "N/A",
                "Status": detail,
            })
            return 0

        if self.should_stop():
            self.mark_store_status(store_info, "STOPPED", "Stopped after account selection")
            return 0

        ptype_result = self.select_product_type_with_retry(store_info["account_id"], store_info["name"], product_type=product_type)

        if ptype_result == "SKIP":
            detail = f"Store locked — {product_type} not available for ordering"
            self.log(f"SKIPPED STORE: {store_info['name']} | {detail}")
            self.mark_store_status(store_info, "SKIPPED", detail)
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": "STORE LEVEL",
                "Product Selected": "N/A",
                "Quantity": 0,
                "Unit Price": 0,
                "Total Cost": 0,
                "Stock Available": "Unknown",
                "Credit Available": "N/A",
                "Status": f"SKIPPED — STORE LOCKED / NO {product_type.upper()}",
            })
            return 0

        if not ptype_result:
            detail = "Product type selection failed"
            self.log(f"FAILED STORE: {store_info['name']} | {detail}")
            self.mark_store_status(store_info, "FAILED", detail)
            self.order_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Username": store_info.get("username", ""),
                "Store name": store_info["name"],
                "Product Searched": "STORE LEVEL",
                "Product Selected": "N/A",
                "Quantity": 0,
                "Unit Price": 0,
                "Total Cost": 0,
                "Stock Available": "Unknown",
                "Credit Available": "N/A",
                "Status": detail,
            })
            return 0

        if self.should_stop():
            self.mark_store_status(store_info, "STOPPED", "Stopped after product type selection")
            return 0

        # ── Dynamic credit tracking: start each store with a fresh credit read ──
        self.remaining_credit = None
        self.credit_exhausted = False

        # NOTE: A previous pre-check here tried to look up product prices from
        # a hardcoded local DB (PRODUCT_PRICES) before any product had been
        # selected. That DB no longer exists, and — more importantly — the
        # correct behaviour is to read the LIVE price from the CRM page AFTER
        # the product is selected. The per-product order flow already does
        # that via get_product_price_from_db() -> get_product_price_from_page().
        # So we intentionally skip the pre-check and let each product attempt
        # discover its own live price.

        store_total = 0
        attempted_products = 0
        added_products = []

        for product in products_list:
            if self.should_stop():
                self.mark_store_status(store_info, "STOPPED", "Stopped during product ordering")
                break

            attempted_products += 1

            if product["type"] == "max":
                qty = self.order_single_product(
                    product["name"],
                    9999,
                    store_info,
                    "MAX PER STORE"
                )
            else:
                # "specified", "same_qty", "distribute" all carry an explicit quantity
                qty = self.order_single_product(
                    product["name"],
                    product["quantity"],
                    store_info,
                    product["type"].upper()
                )

            store_total += qty
            self.total_ordered += qty
            if qty > 0:
                added_products.append(f"{product['name']} x{qty}")
            time.sleep(1)

            # Dynamic credit gate: if this line consumed all remaining credit,
            # stop trying to add further products for this store.
            if self.credit_exhausted:
                log_detail = f"Added {', '.join(added_products) if added_products else 'none'}"
                self.log(f"STOPPING STORE (insufficient credit): {store_info['name']} | {log_detail}")
                break

        if self.should_stop():
            self.log(f"Store stopped: {store_info['name']} | Ordered before stop: {store_total}")
        elif self.credit_exhausted and added_products:
            detail = f"Ordered {store_total} unit(s); credit exhausted after adding {', '.join(added_products)}"
            self.log(f"STORE PARTIAL (credit exhausted): {store_info['name']} | {detail}")
            self.mark_store_status(store_info, "SUCCESS", f"Ordered {store_total} unit(s) (credit exhausted)")
        elif store_total > 0:
            self.mark_store_status(store_info, "SUCCESS", f"Ordered {store_total} unit(s)")
        else:
            # Check if all zero-qty results were soft/expected reasons
            soft_statuses = {"INSUFFICIENT FUNDS", "OUT OF STOCK", "PRODUCT NOT FOUND"}
            store_entries = [
                e for e in self.order_log
                if e.get("Account ID") == store_info["account_id"]
                and e.get("Store name") == store_info["name"]
            ]
            recent = store_entries[-attempted_products:] if attempted_products and store_entries else []
            all_soft = bool(recent) and all(e.get("Status", "") in soft_statuses for e in recent)

            if all_soft:
                detail = "Skipped — insufficient funds or no stock for all products"
                self.log(f"SKIPPED STORE: {store_info['name']} | {detail}")
                self.mark_store_status(store_info, "SKIPPED", detail)
            else:
                detail = "No units ordered. Product not found, out of stock, or add-to-cart failed"
                self.log(f"FAILED STORE: {store_info['name']} | {detail}")
                self.mark_store_status(store_info, "FAILED", detail)

        self.log(f"Store total ordered: {store_total} unit(s)")
        return store_total

    # ------------------------------------------------------------------- #
    # CHECK-ONLY MODE  —  reads stock & credit without ordering anything
    # ------------------------------------------------------------------- #

    def check_single_device(self, product_search, store_info, store_credit=None):
        """Select product, read stock & credit, log. NO ordering.
        store_credit: pre-read credit amount for this store (avoids N/A when
        product is not found but credit is visible on the product page).
        """
        exact_name = self.select_product_and_get_exact_name(product_search)
        if not exact_name:
            credit_str = f"${store_credit:,.2f}" if store_credit is not None else "N/A"
            self.check_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"],
                "Account ID": store_info["account_id"],
                "Store Name": store_info["name"],
                "Product": product_search,
                "Selected": "NOT FOUND",
                "Stock": "N/A",
                "Credit": credit_str,
                "Price": 0,
                "Status": "PRODUCT NOT FOUND",
            })
            self.log(f"  >> {product_search} | NOT FOUND | Credit: {credit_str}")
            return

        # Read live data from page
        available_funds = self.get_available_funds()
        # Use live funds if available, otherwise fall back to store_credit
        if available_funds is not None:
            store_credit = available_funds
        available_inventory = self.check_available_inventory()

        # Live price from the CRM page is the only source of truth — read
        # it AFTER the product has been selected. No local price DB fallback.
        unit_price = self.get_product_price_from_page() or 0.0

        stock_str = str(available_inventory) if available_inventory is not None else "Unknown"
        credit_str = f"${store_credit:,.2f}" if store_credit is not None else "Unknown"
        price_str = f"${unit_price:,.2f}" if unit_price else "N/A"

        if unit_price and unit_price > 0 and store_credit is not None:
            can_afford = "Yes" if store_credit >= unit_price else "No"
        else:
            can_afford = "Unknown"

        if available_inventory is not None and available_inventory > 0 and can_afford == "Yes":
            status = "AVAILABLE"
        elif available_inventory is not None and available_inventory > 0 and can_afford == "No":
            status = "IN STOCK — Low Credit"
        elif available_inventory is not None and available_inventory == 0:
            status = "OUT OF STOCK"
        else:
            status = "CHECKED"

        self.check_log.append({
            "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "District": store_info["district"],
            "Account ID": store_info["account_id"],
            "Store Name": store_info["name"],
            "Product": product_search,
            "Selected": exact_name,
            "Stock": stock_str,
            "Credit": credit_str,
            "Price": price_str,
            "Status": status,
        })
        self.log(f"  >> {exact_name} | Stock: {stock_str} | Credit: {credit_str} | {status}")

    def check_single_store(self, store_info, products_list, product_type="TBV Branded"):
        """Navigate to store, check each device, NO ordering."""
        self.mark_store_status(store_info, "CHECKING", "Checking devices...")
        self.log("=" * 60)
        self.log(f"CHECKING STORE: {store_info['name']} | Account: {store_info['account_id']}")
        self.log(f"District: {store_info['district']} | Devices: {len(products_list)}")
        self.log("=" * 60)

        if self.should_stop():
            self.mark_store_status(store_info, "STOPPED", "Stopped"); return

        if not self.select_tsp_id(store_info["account_id"], store_info["name"]):
            self.mark_store_status(store_info, "FAILED", "Account selection failed")
            self.check_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"], "Account ID": store_info["account_id"],
                "Store Name": store_info["name"], "Product": "STORE LEVEL",
                "Selected": "N/A", "Stock": "N/A", "Credit": "N/A",
                "Price": 0, "Status": "ACCOUNT SELECTION FAILED",
            })
            return

        if self.should_stop():
            self.mark_store_status(store_info, "STOPPED", "Stopped"); return

        ptype_result = self.select_product_type_with_retry(
            store_info["account_id"], store_info["name"], product_type=product_type)

        if ptype_result == "SKIP":
            self.mark_store_status(store_info, "SKIPPED", "Store locked")
            self.check_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"], "Account ID": store_info["account_id"],
                "Store Name": store_info["name"], "Product": "STORE LEVEL",
                "Selected": "N/A", "Stock": "N/A", "Credit": "N/A",
                "Price": 0, "Status": "SKIPPED — STORE LOCKED",
            })
            return

        if not ptype_result:
            self.mark_store_status(store_info, "FAILED", "Product type failed")
            # Try to read credit even though product type failed
            _fail_credit = self.get_available_funds()
            _fail_credit_str = f"${_fail_credit:,.2f}" if _fail_credit is not None else "N/A"
            self.check_log.append({
                "Date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "District": store_info["district"], "Account ID": store_info["account_id"],
                "Store Name": store_info["name"], "Product": "STORE LEVEL",
                "Selected": "N/A", "Stock": "N/A", "Credit": _fail_credit_str,
                "Price": 0, "Status": "PRODUCT TYPE FAILED",
            })
            return

        # ── Read available funds once for this store (shared across all devices) ──
        store_credit = self.get_available_funds()
        if store_credit is not None:
            self.log(f"  Store available credit: ${store_credit:,.2f}")
        else:
            self.log(f"  Store available credit: could not read")

        # Check each device
        for idx, product in enumerate(products_list):
            if self.should_stop():
                self.mark_store_status(store_info, "STOPPED", "Stopped mid-check"); break
            self.log(f"  --- Device {idx+1}/{len(products_list)} ---")
            product_name = product.get("name", product) if isinstance(product, dict) else product
            self.check_single_device(product_name, store_info, store_credit=store_credit)
            time.sleep(1)

        self.mark_store_status(store_info, "DONE", "Check complete")
        self.log(f"Store check complete: {store_info['name']}")

    def run_check(self, store_list, products_list, product_type="TBV Branded"):
        """Top-level check runner: login → navigate → check each store → report."""
        self.log("CHECK ONLY MODE — no devices will be ordered.")
        for i, store in enumerate(store_list):
            if self.should_stop(): break
            self.progress(i, len(store_list), store["name"])
            self.check_single_store(store, products_list, product_type)
        self.progress(len(store_list), len(store_list), "Done")

    def build_check_report(self):
        """Build WhatsApp report text.
        Locked stores:   "[store(s)] is/are locked for placing order(s)"
        Unavailable:     "[device] is/are not available in [district(s)]"
        Available:        details by district/store
        """
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        lines = [f"VidaPay Device Check - {timestamp}", ""]

        # ── Separate into three buckets ──
        locked = [r for r in self.check_log
                  if "LOCKED" in str(r.get("Status", "")).upper()
                  or "STORE LEVEL" in str(r.get("Product", "")).upper()]
        available = [r for r in self.check_log
                     if str(r.get("Status", "")).upper().startswith("AVAILABLE")]
        unavailable = [r for r in self.check_log
                       if r not in locked and r not in available]

        # ── Locked stores ──
        if locked:
            store_names = []
            for r in locked:
                name = str(r.get("Store Name") or "Unknown")
                if name not in store_names:
                    store_names.append(name)
            if len(store_names) == 1:
                lines.append(f"{store_names[0]} is locked for placing order(s)")
            else:
                lines.append(f"{', '.join(store_names)} are locked for placing order(s)")
            lines.append("")

        # ── Unavailable devices ──
        if unavailable:
            prod_districts = OrderedDict()
            for r in unavailable:
                prod = str(r.get("Product") or r.get("Selected") or "Unknown")
                dist = str(r.get("District") or "Unknown")
                prod_districts.setdefault(prod, set()).add(dist)
            for prod, districts in prod_districts.items():
                dist_list = sorted(districts)
                if len(dist_list) == 1:
                    lines.append(f"{prod} is not available in {dist_list[0]}")
                else:
                    lines.append(f"{prod} are not available in {', '.join(dist_list)}")
            lines.append("")

        # ── Available devices ──
        if available:
            lines.append(f"Available devices ({len(available)}):")
            sorted_rows = sorted(available, key=lambda r: (
                str(r.get("District", "")).lower(),
                str(r.get("Store Name", "")).lower(),
            ))
            by_district = OrderedDict()
            for r in sorted_rows:
                dist = r.get("District", "")
                store = r.get("Store Name", "")
                by_district.setdefault(dist, OrderedDict()).setdefault(store, []).append(r)
            for dist, stores in by_district.items():
                lines.append(f"")
                lines.append(f"[{dist}]")
                for store_name, rows in stores.items():
                    lines.append(f"  {store_name}")
                    for r in rows:
                        lines.append(
                            f"    {r.get('Selected', r.get('Product','?'))} "
                            f"| Stock: {r.get('Stock','?')} "
                            f"| Credit: {r.get('Credit','?')}"
                        )
            lines.append("")

        lines.append(f"Total records: {len(self.check_log)}")
        return "\n\n".join(lines)

    def save_check_xlsx_log(self):
        """Save check-only results as color-coded XLSX."""
        if not self.check_log:
            self.log("No check records to save."); return None
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        download_folder = self.download_folder.strip()
        if not download_folder:
            download_folder = os.path.join(os.path.expanduser("~"), "Downloads")
        os.makedirs(download_folder, exist_ok=True)
        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
            filename = f"vidapay_device_check_{timestamp}.xlsx"
            filepath = os.path.join(download_folder, filename)
            wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Device Check"
            fields = ["Date", "District", "Account ID", "Store Name", "Product",
                       "Selected", "Stock", "Credit", "Price", "Status"]
            # ── Title heading row (prominent) ──
            title_font = Font(bold=True, size=16, color="FFFFFF", name="Calibri")
            title_fill = PatternFill(start_color="0D47A1", end_color="0D47A1", fill_type="solid")
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(fields))
            title_cell = ws.cell(row=1, column=1,
                value=f"VidaPay Device Check Report  —  {datetime.now().strftime('%Y-%m-%d %H:%M')}")
            title_cell.font = title_font; title_cell.fill = title_fill
            title_cell.alignment = Alignment(horizontal="center", vertical="center")
            # ── Header row (row 2) ──
            header_font = Font(bold=True, color="FFFFFF", size=10)
            header_fill = PatternFill(start_color="333333", end_color="333333", fill_type="solid")
            thin_border = Border(
                left=Side(style="thin"), right=Side(style="thin"),
                top=Side(style="thin"), bottom=Side(style="thin"))
            for col_idx, field in enumerate(fields, 1):
                cell = ws.cell(row=2, column=col_idx, value=field)
                cell.font = header_font; cell.fill = header_fill
                cell.alignment = Alignment(horizontal="center"); cell.border = thin_border
            status_colors = {
                "AVAILABLE": PatternFill(start_color="C6EFCE", end_color="C6EFCE", fill_type="solid"),
                "IN STOCK": PatternFill(start_color="FFEB9C", end_color="FFEB9C", fill_type="solid"),
                "OUT OF STOCK": PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid"),
                "PRODUCT NOT FOUND": PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid"),
            }
            for row_idx, record in enumerate(self.check_log, 3):
                for col_idx, field in enumerate(fields, 1):
                    cell = ws.cell(row=row_idx, column=col_idx, value=record.get(field, ""))
                    cell.border = thin_border; cell.alignment = Alignment(vertical="center", wrap_text=False)
                status = str(record.get("Status", ""))
                for key, fill in status_colors.items():
                    if key in status:
                        ws.cell(row=row_idx, column=len(fields)).fill = fill; break
            for col_idx in range(1, len(fields) + 1):
                ws.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = 18
            ws.freeze_panes = "A3"
            # Auto-filter only on header row + data rows (not the title row)
            if self.check_log:
                last_row = len(self.check_log) + 2  # title=row1, header=row2, data starts=row3
                ws.auto_filter.ref = f"A2:{openpyxl.utils.get_column_letter(len(fields))}{last_row}"
            ws.row_dimensions[1].height = 36
            wb.save(filepath)
            self.log(f"Check report saved: {filepath}")
            return filepath
        except ImportError:
            self.log("openpyxl not installed — skipping XLSX save.")
            return None
        except Exception as e:
            self.log(f"XLSX save error: {e}")
            return None

    def send_check_report(self, report_group_name, report_file_path=None):
        """Send check report to WhatsApp group — XLSX file with text caption.
        If no file, falls back to sending text only."""
        report_text = self.build_check_report()
        if not report_group_name:
            self.log("No report group configured — skipping WhatsApp report."); return
        try:
            # Send file WITH text as caption (single message)
            if report_file_path and os.path.isfile(report_file_path):
                send_whatsapp_report_file(report_file_path, report_group_name,
                                          log=self.log, caption_text=report_text)
            else:
                # No file — send text only
                send_whatsapp_report_message(report_text, report_group_name, log=self.log)
        except Exception as e:
            self.log(f"WhatsApp report error: {e}")

    def take_screenshot(self, filepath):
        """Take a screenshot of the current browser page."""
        try:
            self.driver.save_screenshot(filepath)
            self.log(f"Screenshot saved: {filepath}")
            return filepath
        except Exception as e:
            self.log(f"Screenshot failed: {e}")
            return None

    def save_xlsx_log(self):
        """Save the order log as an .xlsx file using openpyxl.

        Falls back to CSV if openpyxl isn't installed, so the user never loses
        the log.
        """
        if not self.order_log:
            self.log("No orders to log.")
            return None

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        download_folder = self.download_folder.strip()
        if not download_folder:
            download_folder = os.path.join(os.path.expanduser("~"), "Downloads")

        os.makedirs(download_folder, exist_ok=True)

        fieldnames = [
            "Date",
            "District",
            "Account ID",
            "Username",
            "Store name",
            "Product Searched",
            "Product Selected",
            "Quantity",
            "Unit Price",
            "Total Cost",
            "Stock Available",
            "Credit Available",
            "Status",
        ]

        try:
            import openpyxl
            from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
            from openpyxl.utils import get_column_letter

            filename = f"vidapay_order_log_{timestamp}.xlsx"
            filepath = os.path.join(download_folder, filename)

            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "Order Log"

            # ── Title heading row (prominent) ──
            title_font = Font(bold=True, size=16, color="FFFFFF", name="Calibri")
            title_fill = PatternFill(start_color="0D47A1", end_color="0D47A1", fill_type="solid")
            ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(fieldnames))
            title_cell = ws.cell(row=1, column=1,
                value=f"VidaPay Order Log  —  {datetime.now().strftime('%Y-%m-%d %H:%M')}")
            title_cell.font = title_font; title_cell.fill = title_fill
            title_cell.alignment = Alignment(horizontal="center", vertical="center")

            # Header row (row 2)
            header_font = Font(bold=True, color="FFFFFF")
            header_fill = PatternFill(start_color="090D26", end_color="090D26", fill_type="solid")
            center = Alignment(horizontal="center", vertical="center")
            thin = Side(border_style="thin", color="D8DEEA")
            border = Border(left=thin, right=thin, top=thin, bottom=thin)

            for col_idx, name in enumerate(fieldnames, 1):
                cell = ws.cell(row=2, column=col_idx, value=name)
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = center
                cell.border = border

            # Data rows
            for row_idx, row in enumerate(self.order_log, start=3):
                for col_idx, name in enumerate(fieldnames, 1):
                    value = row.get(name, "")
                    if name == "Unit Price":
                        value = row.get(name, 0)
                        cell = ws.cell(row=row_idx, column=col_idx, value=value)
                        cell.number_format = '"$"#,##0.00'
                    elif name == "Total Cost":
                        value = row.get(name, 0)
                        cell = ws.cell(row=row_idx, column=col_idx, value=value)
                        cell.number_format = '"$"#,##0.00'
                    elif name == "Quantity":
                        cell = ws.cell(row=row_idx, column=col_idx, value=row.get(name, 0))
                    else:
                        cell = ws.cell(row=row_idx, column=col_idx, value=value)
                    cell.border = border
                    cell.alignment = Alignment(vertical="center")

                    # Color-code the Status cell
                    if name == "Status":
                        st = str(value).upper()
                        if st.startswith("SUCCESS"):
                            cell.fill = PatternFill(start_color="D1FAE5", end_color="D1FAE5", fill_type="solid")
                        elif st.startswith("INSUFFICIENT"):
                            cell.fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
                        elif st.startswith("OUT OF STOCK"):
                            cell.fill = PatternFill(start_color="FECACA", end_color="FECACA", fill_type="solid")
                        elif st.startswith("PRODUCT NOT FOUND"):
                            cell.fill = PatternFill(start_color="E5E7EB", end_color="E5E7EB", fill_type="solid")
                        elif st.startswith("SKIPPED"):
                            cell.fill = PatternFill(start_color="FDE68A", end_color="FDE68A", fill_type="solid")

            # Auto-size columns (approximate)
            ws.freeze_panes = "A3"
            ws.row_dimensions[1].height = 36
            # Auto-filter only on header row + data rows (not the title row)
            if self.order_log:
                last_row = len(self.order_log) + 2
                ws.auto_filter.ref = f"A2:{openpyxl.utils.get_column_letter(len(fieldnames))}{last_row}"
            for col_idx, name in enumerate(fieldnames, 1):
                max_len = len(str(name))
                for row_idx in range(3, len(self.order_log) + 3):
                    v = ws.cell(row=row_idx, column=col_idx).value
                    if v is not None:
                        max_len = max(max_len, len(str(v)))
                ws.column_dimensions[get_column_letter(col_idx)].width = min(max_len + 3, 50)

            # Freeze header
            ws.freeze_panes = "A2"

            wb.save(filepath)

            self.log(f"XLSX log saved: {filepath}")
            self.log(f"Total records: {len(self.order_log)}")
            self.log(f"Total cost: ${self.total_cost:,.2f}")
            return filepath

        except ImportError:
            # Fallback: write CSV if openpyxl missing
            self.log("openpyxl not installed — falling back to CSV export.")
            csv_filename = f"vidapay_order_log_{timestamp}.csv"
            csv_filepath = os.path.join(download_folder, csv_filename)
            try:
                with open(csv_filepath, "w", newline="", encoding="utf-8-sig") as file:
                    writer = csv.DictWriter(file, fieldnames=fieldnames)
                    writer.writeheader()
                    for row in self.order_log:
                        formatted = dict(row)
                        formatted["Unit Price"] = f"${row.get('Unit Price', 0):,.2f}"
                        formatted["Total Cost"] = f"${row.get('Total Cost', 0):,.2f}"
                        writer.writerow(formatted)
                self.log(f"CSV log saved (fallback): {csv_filepath}")
                return csv_filepath
            except Exception as e:
                self.log(f"CSV fallback save failed: {e}")
                return None

        except Exception as e:
            self.log(f"XLSX save failed: {e}")
            return None

    def close(self):
        # IMPORTANT:
        # Do not call self.driver.quit() here.
        # The user wants Edge to stay open after 2FA, after submit, after stop, and after errors.
        self.log("Browser close skipped. Edge stays open.")
        return

# ============================================================================
# GUI APPLICATION
# ============================================================================
VIDAPAY_ICON_ICO_B64 = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "vidapay_icon_ico_b64.txt"), "r").read().strip() if not getattr(sys, "frozen", False) else open(os.path.join(getattr(sys, "_MEIPASS", "."), "assets", "vidapay_icon_ico_b64.txt"), "r").read().strip()

class VidapayGUI(tk.Tk):
    def __init__(self):
        super().__init__()

        # Set icon IMMEDIATELY after Tk creation, BEFORE any update_idletasks
        self.apply_app_icon()

        self.title(APP_TITLE)
        _sw, _sh = self.winfo_screenwidth(), self.winfo_screenheight()
        _w, _h = int(_sw * 0.9), int(_sh * 0.9)
        _x, _y = (_sw - _w) // 2, max(0, (_sh - _h) // 2 - 15)
        self.geometry("%dx%d+%d+%d" % (_w, _h, _x, _y))
        self.minsize(min(1100, _w), min(700, _h))
        self._apply_dynamic_geometry()
        self.after(10, lambda: self.state("zoomed"))
        self.configure(background=BRAND_SURFACE)
        _cbar = tk.Frame(self, bg="#090d26", height=24)
        _cbar.pack(fill="x", side="bottom")
        _cbar.pack_propagate(False)
        tk.Label(_cbar, text=f"Developed by www.3SVerse.com | Copyright © {date.today().year} | All rights reserved.  |  Independent vendor - not affiliated with VidaPay.",
                 font=("Segoe UI", 8), fg="#9d9db8", bg="#090d26").pack(expand=True, fill="both")

        self.logo_image = None
        self.logo_icon = None

        self.log_queue = queue.Queue()
        self.stop_event = threading.Event()
        self.twofa_event = threading.Event()
        self.worker_thread = None
        self.active_system = None
        self.last_report_path = None  # last saved XLSX check report
        self.last_check_log = []       # check_log snapshot for resend

        self.all_stores = get_all_stores_flat()
        self.selected_stores = OrderedDict()
        self.store_status_map = {}
        self.store_status_detail_map = {}

        # ── Per-flow order state ──────────────────────────────────────
        # Each flow ("device" or "sim") keeps its own:
        #   - order_type_var        : "same" | "different"
        #   - same_order_products   : list of product dicts
        #   - different_order_products : {store_key: [product dicts]}
        #   - same_product_name_var / same_quantity_var / same_mode_var
        #   - same_product_tree / diff_canvas / diff_inner
        # Active flow is set when the user clicks a tab.
        self._flows = {}  # populated by _order_tab_factory
        self.active_flow = "device"

        self.district_vars = {}

        self.theme_manager = ThemeManager("VidaPay Device Ordering", app_name="VidaPay_Device_Ordering")
        apply_theme_to_window(self, self.theme_manager)

        self.configure_style()
        self.create_layout()
        self.refresh_all_store_tree()
        self.refresh_selected_store_tree()
        # Initialize both flow trees/dropdowns now that factories ran
        for _f in self._flows.keys():
            self._refresh_same_product_tree(_f)
        self.after(150, self.flush_log_queue)
        # Re-apply the saved theme AFTER the layout exists so widgets created
        # with default Tk colors (Live Log console and friends) come up themed
        # on first launch — previously the theme walk ran before the UI was
        # built, leaving the Live Log panel light in dark mode.
        self._apply_theme()

        # NOTE: create_layout() -> create_header() already builds a complete,
        # working header (logo, title, subtitle, theme toggle) and packs it
        # at the very top. This second FixedHeaderManager block used to run
        # afterward and pack ANOTHER header frame with no positional pack
        # argument, so tkinter appended it after everything already packed
        # (the body/tabs) — landing at the bottom of the window as a
        # duplicate header instead of the top. Removed; create_header()'s
        # header is the one and only header for this app.

    def _apply_dynamic_geometry(self) -> None:
        """Size the window to 90% of the screen and center it.

        Works on any laptop/monitor/PC (1080p, 1440p, 2K, 4K) and respects
        Windows DPI scaling (run after _enable_dpi_awareness()). The window
        stays resizable so Windows Snap gestures keep working — it centers
        on launch, then snaps normally to 50% left/right, corners or via
        Win+arrow shortcuts.
        """
        try:
            self.update_idletasks()
            sw, sh = self.winfo_screenwidth(), self.winfo_screenheight()
            w = max(640, min(int(sw * 0.90), sw - 20))
            h = max(480, min(int(sh * 0.90), sh - 40))
            x = max(0, (sw - w) // 2)
            y = max(0, (sh - h) // 2)
            self.geometry(f"{w}x{h}+{x}+{y}")
            self.minsize(min(1100, max(560, sw // 2)),
                         min(700, max(420, sh // 2)))
            self.resizable(True, True)
        except Exception:
            pass

    def configure_style(self):
        """Configure ttk styles using the ACTIVE theme colors (not hardcoded).
        Called on init and on every theme toggle so panels stay in sync."""
        style = ttk.Style()
        style.theme_use("clam")

        # Get current theme colors (dark or light)
        c = self.theme_manager.get_colors()

        style.configure("TFrame", background=c["bg"])
        style.configure("Header.TFrame", background=c["navy"])
        style.map("Header.TFrame", background=[("active", c["navy"])])
        style.configure("HeaderLeft.TFrame", background=c["navy"])
        style.map("HeaderLeft.TFrame", background=[("active", c["navy"])])
        style.configure("Header.TLabel", background=c["navy"], foreground=BRAND_WHITE, font=("Segoe UI", 17, "bold"))
        style.configure("SubHeader.TLabel", background=c["navy"], foreground="#d9dce7", font=("Segoe UI", 9))
        style.configure("Divider.TFrame", background=c["red"])
        style.configure("TLabel", background=c["bg"], foreground=c["text"], font=("Segoe UI", 9))
        style.configure("Section.TLabel", background=c["bg"], foreground=c["text"], font=("Segoe UI", 11, "bold"))
        style.configure("TButton", font=("Segoe UI", 9), padding=(10, 5),
                        background=c["panel_alt"], foreground=c["text"], bordercolor=c["border"])
        style.map("TButton", background=[("active", c["border"]), ("disabled", c["panel_alt"])], foreground=[("active", c["text"]), ("disabled", c["text_dim"])])
        style.configure("Accent.TButton", font=("Segoe UI", 10, "bold"), foreground=BRAND_WHITE, background=c["red"], bordercolor=c["red"], focusthickness=0)
        style.map("Accent.TButton", background=[("active", "#c91524"), ("pressed", "#b61220"), ("disabled", c["red"])], foreground=[("active", "#ffffff"), ("pressed", "#ffffff"), ("disabled", "#ffe3d7")])
        style.configure("Danger.TButton", font=("Segoe UI", 10, "bold"), foreground=BRAND_WHITE, background=BRAND_NAVY_2, bordercolor=BRAND_NAVY_2)
        style.map("Danger.TButton", background=[("active", "#111735"), ("pressed", "#050817"), ("disabled", "BRAND_NAVY_2")], foreground=[("disabled", "#aeb4d0")])
        style.configure("Treeview", font=("Segoe UI", 9), rowheight=25, background=c["panel"], fieldbackground=c["panel"], bordercolor=c["border"], borderwidth=1, foreground=c["text"])
        style.configure("Treeview.Heading", font=("Segoe UI", 9, "bold"), background=c["navy"], foreground="#ffffff")
        style.map("Treeview", background=[("selected", c["red"])], foreground=[("selected", "#ffffff")])
        style.configure("TNotebook", background=c["bg"], borderwidth=0)
        style.configure("TNotebook.Tab", font=("Segoe UI", 10, "bold"), padding=(14, 8), background=c["panel_alt"], foreground=c["text"])
        style.map("TNotebook.Tab", background=[("selected", c["red"])], foreground=[("selected", "#ffffff")])
        style.configure("TEntry", fieldbackground=c["input"], foreground=c["text"], insertcolor=c["text"], bordercolor=c["border"])
        style.configure("TCombobox", fieldbackground=c["input"], foreground=c["text"],
                        background=c["panel_alt"], arrowcolor=c["text"],
                        bordercolor=c["border"], lightcolor=c["border"],
                        darkcolor=c["border"])
        # clam's built-in combobox map forces a LIGHT readonly field — in dark
        # mode the scheduler filters show a white box with near-white text.
        # Pin every state to the active palette and theme the popdown too.
        style.map("TCombobox",
                  fieldbackground=[("readonly", c["input"]), ("disabled", c["panel_alt"])],
                  foreground=[("readonly", c["text"]), ("disabled", c["text_dim"])],
                  background=[("readonly", c["panel_alt"]), ("active", c["panel_alt"]),
                              ("pressed", c["panel_alt"])],
                  arrowcolor=[("disabled", c["text_dim"])])
        self._style_combobox_popdown()
        style.configure("TCheckbutton", background=c["bg"], foreground=c["text"])
        style.map("TCheckbutton", background=[("active", c["bg"])], foreground=[("active", c["text"])])
        style.configure("TLabelframe", background=c["bg"], bordercolor=c["border"])
        style.configure("TLabelframe.Label", background=c["bg"], foreground=c["text"])
        style.configure("Hint.TLabel", background=c["bg"], foreground=c["text_dim"], font=("Segoe UI", 8))
        style.configure("Horizontal.TProgressbar", background=c["red"], troughcolor=c["panel_alt"])

    def _style_combobox_popdown(self):
        """Theme combobox dropdown lists for the ACTIVE theme. The popdown is
        a plain tk.Listbox spawned by Tk itself: the option database covers
        listboxes created after this call, and any already-created popdown is
        restyled directly (best effort — internal listbox paths differ across
        Tk 8.6 builds)."""
        c = self.theme_manager.get_colors()
        self.option_add("*TCombobox*Listbox.background", c["panel_alt"])
        self.option_add("*TCombobox*Listbox.foreground", c["text"])
        self.option_add("*TCombobox*Listbox.selectBackground", c["red"])
        self.option_add("*TCombobox*Listbox.selectForeground", "#ffffff")
        self.option_add("*TCombobox*Listbox.font", ("Segoe UI", 9))
        stack = list(self.winfo_children())
        while stack:
            w = stack.pop()
            try:
                stack.extend(w.winfo_children())
            except Exception:
                pass
            if isinstance(w, ttk.Combobox):
                try:
                    pop = str(self.tk.call("ttk::combobox::PopdownWindow", w))
                except Exception:
                    continue
                for lb_path in (pop + ".f.l", pop + ".l"):
                    try:
                        self.tk.call(lb_path, "configure",
                                     "-background", c["panel_alt"],
                                     "-foreground", c["text"],
                                     "-selectbackground", c["red"],
                                     "-selectforeground", "#ffffff")
                        break
                    except Exception:
                        continue

    def create_layout(self):
        self.create_header()
        self.create_top_controls()
        self._body = ttk.Frame(self)
        self._body.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self.create_main_tabs()
        self.create_bottom_log_area()


    def _extract_embedded(self, b64, filename):
        """Decode an embedded base64 asset into a temp file; return path or None."""
        try:
            if not b64:
                return None
            import base64 as _b64, tempfile, os
            target = os.path.join(tempfile.gettempdir(), filename)
            with open(target, "wb") as fh:
                fh.write(_b64.b64decode(b64))
            return target if os.path.isfile(target) else None
        except Exception:
            return None


    def apply_app_icon(self):
        """Set taskbar + titlebar icon — must be called BEFORE create_layout."""
        import sys as _sys, os as _os

        # Try _MEIPASS first
        _meipass = getattr(_sys, "_MEIPASS", None)
        if _meipass:
            _ico_path = _os.path.join(_meipass, "vidapay_icon.ico")
            if _os.path.exists(_ico_path):
                try:
                    self.iconbitmap(default=_ico_path)
                    self.after(200, lambda p=_ico_path: self.iconbitmap(default=p))
                    return
                except Exception as e:
                    pass
        # Fallback: decode to %TEMP%
        try:
            import base64 as _b64, tempfile as _tf
            data = _b64.b64decode(EMBEDDED_ICON_B64.strip())
            _tmp_dir = _os.environ.get("TEMP", _tf.gettempdir())
            _ico_path = _os.path.join(_tmp_dir, "vidapay_ordering_icon.ico")
            with open(_ico_path, "wb") as _f:
                _f.write(data)
            self.iconbitmap(default=_ico_path)
            self.after(200, lambda p=_ico_path: self.iconbitmap(default=p))
            return
        except Exception as e:
            pass
    def create_header(self):
        header = ttk.Frame(self, style="Header.TFrame")
        header._tag = "header"
        header.pack(fill="x")

        # LEFT: Logo — grid column 0 (fixed width)
        logo_frame = ttk.Frame(header, style="HeaderLeft.TFrame")
        logo_frame.grid(row=0, column=0, sticky="nsw", padx=(18, 16), pady=12)

        self.logo_image = self.load_brand_logo(target_height=60, max_width=285)
        if self.logo_image:
            logo_label = tk.Label(logo_frame, image=self.logo_image, bg=BRAND_NAVY, bd=0, highlightthickness=0)
            logo_label.pack(anchor="w")

        divider = tk.Frame(header, bg=BRAND_RED, width=3, height=58)
        divider.grid(row=0, column=1, sticky="nsw", pady=14)

        # RIGHT: Theme toggle — grid column 2 (fixed width)
        theme_btn = self.theme_manager.create_theme_toggle_button(header, callback=self._apply_theme)
        theme_btn.grid(row=0, column=2, sticky="ne", padx=(16, 18), pady=12)

        # Let the divider column absorb all spare horizontal space so the
        # logo stays pinned left and the theme button stays pinned right.
        header.columnconfigure(0, weight=0)
        header.columnconfigure(1, weight=1)
        header.columnconfigure(2, weight=0)

        # CENTER: Title — spans ALL columns, fills the entire header area.
        # anchor="center" centers text both H and V within the label.
        # lower() puts it behind logo/divider/theme button so they stay visible.
        title = ttk.Label(header, text=APP_TITLE, style="Header.TLabel", anchor="center")
        title.grid(row=0, column=0, columnspan=3, sticky="nsew")
        title.lower()

    def _apply_theme(self, colors=None):
        """Re-apply theme: reconfigure custom ttk styles + walk widgets."""
        self.configure_style()
        apply_theme_to_window(self, self.theme_manager)
        # Keep the Live Log on its dedicated dark-console palette instead of
        # the generic panel colors the widget walk applies to Text widgets.
        if hasattr(self, "log_text"):
            try:
                _c = self.theme_manager.get_colors()
                self.log_text.configure(
                    bg=_c.get("log_bg", "#05070f"),
                    fg=_c.get("log_fg", "#cbd5e1"),
                    insertbackground=_c.get("log_fg", "#cbd5e1"),
                )
            except Exception:
                pass
        # Re-theme combobox popdowns that were already created.
        try:
            self._style_combobox_popdown()
        except Exception:
            pass

    def load_brand_logo(self, target_height=60, max_width=285):
        try:
            raw = base64.b64decode(VIDAPAY_LOGO_B64)
            try:
                from io import BytesIO
                from PIL import Image, ImageTk

                image = Image.open(BytesIO(raw)).convert("RGBA")
                width, height = image.size
                scale = min(target_height / max(height, 1), max_width / max(width, 1))
                new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
                image = image.resize(new_size, Image.LANCZOS)
                return ImageTk.PhotoImage(image)
            except Exception:
                import tempfile
                logo_file = tempfile.NamedTemporaryFile(delete=False, suffix=".png")
                logo_file.write(raw)
                logo_file.close()
                image = tk.PhotoImage(file=logo_file.name)
                if image.height() > target_height or image.width() > max_width:
                    factor = max(1, int(max(image.height() / target_height, image.width() / max_width)))
                    image = image.subsample(factor, factor)
                return image
        except Exception:
            return None

    def _vp_build_district_boxes(self):
        for w in self._vp_district_box_frame.winfo_children():
            w.destroy()
        self.district_vars = {}
        districts = sorted({s["district"] for s in self.all_stores if s.get("district")})
        if not districts:
            ttk.Label(self._vp_district_box_frame,
                      text="(No stores yet \u2014 click Add Store)").pack(anchor="w")
        for idx, district in enumerate(districts, 1):
            var = tk.BooleanVar(value=False)
            self.district_vars[district] = var
            ttk.Checkbutton(self._vp_district_box_frame, text="%d. %s" % (idx, district),
                            variable=var).pack(anchor="w", pady=2)

    def _vp_refresh_after_store_change(self):
        self.all_stores = get_all_stores_flat()
        try:
            self._vp_build_district_boxes()
        except Exception:
            pass
        self.refresh_all_store_tree()
        _vp_put("stores", [dict(d) for d in STORE_ROWS])

    def vp_add_store(self):
        dlg = tk.Toplevel(self)
        dlg.title("Add Store")
        dlg.configure(bg=BRAND_SURFACE)
        dlg.transient(self)
        dlg.grab_set()
        fields = [("District", "district"), ("Store Name", "name"),
                  ("Account ID", "account_id")]
        vars_ = {}
        for i, (label, key) in enumerate(fields):
            ttk.Label(dlg, text=label).grid(row=i, column=0, sticky="w", padx=12, pady=6)
            v = tk.StringVar()
            ttk.Entry(dlg, textvariable=v, width=34).grid(row=i, column=1, padx=12, pady=6)
            vars_[key] = v

        def save():
            row = {k: vars_[k].get().strip() for k in vars_}
            if not row["name"] or not row["account_id"] or not row["district"]:
                messagebox.showwarning("Missing", "District, Store Name and Account ID are required.", parent=dlg)
                return
            for existing in STORE_ROWS:
                if existing.get("account_id") == row["account_id"]:
                    messagebox.showwarning("Duplicate", "That Account ID already exists.", parent=dlg)
                    return
            STORE_ROWS.append(row)
            self._vp_refresh_after_store_change()
            dlg.destroy()
            self.log_message("Store added: %s" % row["name"])

        ttk.Button(dlg, text="Save Store", style="Accent.TButton", command=save).grid(row=len(fields), column=0, columnspan=2, pady=10)
        dlg.wait_window()

    def vp_remove_store(self):
        sel = self.all_store_tree.selection()
        if not sel:
            messagebox.showinfo("Remove Store", "Highlight a store in the 'All Stores' list first.")
            return
        ids = set()
        for iid in sel:
            vals = self.all_store_tree.item(iid, "values")
            if len(vals) >= 4:
                ids.add(str(vals[3]))
        removed = [r for r in STORE_ROWS if r.get("account_id") in ids]
        for r in removed:
            STORE_ROWS.remove(r)
            self.selected_stores.pop(r.get("account_id"), None)
        self._vp_refresh_after_store_change()
        self.refresh_selected_store_tree()
        self.log_message("Removed %d store(s)." % len(removed))

    def vp_save_all(self):
        global _WA_GROUP_NAME, _WA_MODE
        try:
            grp = self.whatsapp_group_var.get().strip()
        except Exception:
            grp = ""
        _WA_GROUP_NAME = grp
        _WA_MODE = self.wa_mode_var.get()
        cfg = _vp_config_load()
        cfg["stores"] = [dict(d) for d in STORE_ROWS]
        cfg["whatsapp_group"] = grp
        cfg["whatsapp_mode"] = _WA_MODE
        cfg["whatsapp_report_group"] = self.whatsapp_report_group_var.get().strip()
        cfg["sched_hour"] = self.sched_hour_var.get()
        cfg["sched_min"] = self.sched_min_var.get()
        cfg["sched_repeat"] = self.sched_repeat_var.get()
        cfg["download_folder"] = self.download_folder_var.get().strip()
        cfg["login"] = {
            "account_id": self.login_account_id_var.get().strip(),
            "username": self.login_username_var.get().strip(),
            "password": self.login_password_var.get(),
        }
        _vp_config_save(cfg)
        messagebox.showinfo("Saved",
            "Stores, login, WhatsApp groups, and folder saved (encrypted). They load automatically next time.")

    def vp_import_excel(self):
        try:
            import openpyxl
        except ImportError:
            messagebox.showerror("Missing Dependency", "openpyxl is required for Excel import.")
            return
        path = filedialog.askopenfilename(title="Select Excel file with stores",
            filetypes=[("Excel files", "*.xlsx *.xls"), ("All files", "*.*")])
        if not path:
            return
        try:
            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))
        except Exception as e:
            messagebox.showerror("Import Failed", "Could not read the Excel file: %s" % e)
            return
        if not rows:
            messagebox.showwarning("Empty File", "The selected Excel file has no data.")
            return
        header = [str(c).strip().lower() if c is not None else "" for c in rows[0]]
        def _find(*names):
            for n in names:
                if n in header:
                    return header.index(n)
            return None
        i_name = _find("store", "store name", "name")
        i_acc = _find("account_id", "account id", "accountid", "account")
        i_dist = _find("district", "region")
        i_user = _find("username", "user")
        if i_name is None or i_acc is None:
            messagebox.showerror("Missing Columns",
                "The Excel file needs at least a Store and an Account ID column. Found: %s"
                % ", ".join(c for c in header if c))
            return
        added = updated = skipped = 0
        for row in rows[1:]:
            try:
                def _cell(i):
                    return str(row[i]).strip() if (i is not None and i < len(row) and row[i] is not None) else ""
                name = _cell(i_name); acc = _cell(i_acc)
                dist = _cell(i_dist); user = _cell(i_user)
                if not name or not acc or name.lower() in ("none", "nan") or acc.lower() in ("none", "nan"):
                    skipped += 1
                    continue
                entry = {"district": dist, "name": name, "account_id": acc, "username": user}
                ex = next((k for k, r in enumerate(STORE_ROWS) if r.get("account_id") == acc), None)
                if ex is not None:
                    STORE_ROWS[ex] = entry
                    updated += 1
                else:
                    STORE_ROWS.append(entry)
                    added += 1
            except Exception:
                skipped += 1
        self._vp_refresh_after_store_change()
        messagebox.showinfo("Import Complete",
            "Added: %d  |  Updated: %d  |  Skipped: %d" % (added, updated, skipped))
        self.log_message("Excel import: added=%d updated=%d skipped=%d" % (added, updated, skipped))

    # ── Download import templates (extractor pattern) ─────────────────────
    def _save_import_template_xlsx(self, sheet_title, initial_file, headers,
                                   example_rows, column_hint, done_note):
        """Builds and saves one import template workbook with the import
        columns already defined in the header row (LANCZOS-free, openpyxl)."""
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
        try:
            self.log(f"Import template saved: {save_path}")
        except Exception:
            pass

    def vp_download_template(self):
        """Store import template — columns match vp_import_excel:
        district | store | account_id."""
        self._save_import_template_xlsx(
            sheet_title="Stores",
            initial_file="VidaPay_Ordering_Stores_Template.xlsx",
            headers=["district", "store", "account_id"],
            example_rows=[
                ["Arizona", "Store 1", "0001"],
                ["Houston", "Store 2", "0002"],
            ],
            column_hint="district | store | account_id",
            done_note="Replace the two example rows with real stores, then use Import from Excel.",
        )


    def vp_download_order_template(self):
        """Order tab import template - columns match
        _import_different_order_xlsx: Store Name | Product Name | Quantity."""
        self._save_import_template_xlsx(
            sheet_title="Order",
            initial_file="VidaPay_Ordering_Template.xlsx",
            headers=["Store Name", "Product Name", "Quantity"],
            example_rows=[
                ["Store 1", "Total by Verizon SIM Kit", "5"],
                ["Store 2", "TBV Branded Device", "max"],
            ],
            column_hint="Store Name | Product Name | Quantity",
            done_note=("Fill one row per store-product pair. Quantity: a number "
                       "or 'max' for MAX per store. Store names must match the "
                       "stores selected under 1. Stores."),
        )


    def create_top_controls(self):
        frame = ttk.Frame(self)
        frame.pack(fill="x", padx=12, pady=10)

        ttk.Label(frame, text="Login Account ID").grid(row=0, column=0, sticky="w")
        self.login_account_id_var = tk.StringVar(value=_vp_get("login", {}).get("account_id", ""))
        ttk.Entry(frame, textvariable=self.login_account_id_var, width=18).grid(row=1, column=0, padx=(0, 10), sticky="w")

        ttk.Label(frame, text="Username").grid(row=0, column=1, sticky="w")
        self.login_username_var = tk.StringVar(value=_vp_get("login", {}).get("username", ""))
        ttk.Entry(frame, textvariable=self.login_username_var, width=18).grid(row=1, column=1, padx=(0, 10), sticky="w")

        ttk.Label(frame, text="Password").grid(row=0, column=2, sticky="w")
        self.login_password_var = tk.StringVar(value=_vp_get("login", {}).get("password", ""))
        ttk.Entry(frame, textvariable=self.login_password_var, width=24, show="*").grid(row=1, column=2, padx=(0, 10), sticky="w")

        ttk.Label(frame, text="Download Folder").grid(row=0, column=3, sticky="w")
        default_downloads = os.path.join(os.path.expanduser("~"), "Downloads")
        self.download_folder_var = tk.StringVar(value=default_downloads)
        ttk.Entry(frame, textvariable=self.download_folder_var, width=46).grid(row=1, column=3, padx=(0, 6), sticky="w")

        ttk.Button(frame, text="Browse", command=self.browse_download_folder).grid(row=1, column=4, padx=(0, 14), sticky="w")

        self.start_button = ttk.Button(frame, text="Start Automation", style="Accent.TButton", command=self.start_automation)
        self.start_button.grid(row=1, column=5, padx=(0, 8), sticky="e")

        self.stop_button = ttk.Button(frame, text="Stop", style="Danger.TButton", command=self.stop_automation, state="disabled")
        self.stop_button.grid(row=1, column=6, padx=(0, 8), sticky="e")

        self.continue_2fa_button = ttk.Button(frame, text="Continue After 2FA", command=self.continue_after_2fa, state="disabled")
        self.continue_2fa_button.grid(row=1, column=7, sticky="e")

        self.save_info_button = ttk.Button(frame, text="Save Info", style="Accent.TButton", command=self.vp_save_all)
        self.save_info_button.grid(row=1, column=8, padx=(8, 0), sticky="e")

        frame.columnconfigure(3, weight=1)

    def create_main_tabs(self):
        self.notebook = ttk.Notebook(self._body)
        self.notebook.pack(side="left", fill="both", expand=True, padx=(0, 10), pady=0)
        self.notebook.configure(height=520)

        self.store_tab = ttk.Frame(self.notebook)
        self.order_tab = ttk.Frame(self.notebook)

        self.notebook.add(self.store_tab, text="1. Stores")
        self.notebook.add(self.order_tab, text="2. Order")

        self.create_store_tab()
        self._build_order_tab()

        # Default to Devices mode being selected
        self.active_flow = "device"

    def create_store_tab(self):
        container = ttk.Frame(self.store_tab)
        container.pack(fill="both", expand=True, padx=10, pady=10)

        # Use grid so we can control column weights properly
        container.columnconfigure(0, weight=0, minsize=160)   # left: district checkboxes
        container.columnconfigure(1, weight=3)                 # center: all stores list
        container.columnconfigure(2, weight=4)                 # right: selected stores (wider)
        container.rowconfigure(0, weight=1)

        left = ttk.Frame(container)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 10))

        center = ttk.Frame(container)
        center.grid(row=0, column=1, sticky="nsew", padx=(0, 10))

        right = ttk.Frame(container)
        right.grid(row=0, column=2, sticky="nsew")

        ttk.Label(left, text="District Options", style="Section.TLabel").pack(anchor="w")

        self._vp_district_box_frame = ttk.Frame(left)
        self._vp_district_box_frame.pack(anchor="w", fill="x")
        self._vp_build_district_boxes()

        ttk.Button(left, text="Add Checked Districts", command=self.add_checked_districts).pack(fill="x", pady=(12, 4))
        ttk.Button(left, text="Add All Stores", command=self.add_all_stores).pack(fill="x", pady=4)
        ttk.Button(left, text="Clear Selected Stores", command=self.clear_selected_stores).pack(fill="x", pady=4)

        ttk.Separator(left, orient="horizontal").pack(fill="x", pady=8)
        ttk.Label(left, text="Manage Stores", style="Section.TLabel").pack(anchor="w")
        ttk.Button(left, text="Add Store", style="Accent.TButton", command=self.vp_add_store).pack(fill="x", pady=(6, 4))
        ttk.Button(left, text="Remove Highlighted Store", command=self.vp_remove_store).pack(fill="x", pady=4)
        ttk.Button(left, text="Import from Excel", command=self.vp_import_excel).pack(fill="x", pady=4)
        ttk.Button(left, text="Download Template", command=self.vp_download_template).pack(fill="x", pady=4)
        ttk.Button(left, text="Save All Info", style="Accent.TButton", command=self.vp_save_all).pack(fill="x", pady=4)

        ttk.Label(center, text="All Stores", style="Section.TLabel").pack(anchor="w")

        search_row = ttk.Frame(center)
        search_row.pack(fill="x", pady=(4, 6))

        ttk.Label(search_row, text="8. Search by Store Name").pack(side="left")
        self.store_search_var = tk.StringVar()
        search_entry = ttk.Entry(search_row, textvariable=self.store_search_var)
        search_entry.pack(side="left", fill="x", expand=True, padx=6)
        search_entry.bind("<KeyRelease>", lambda event: self.refresh_all_store_tree())

        ttk.Button(search_row, text="Add Name Matches", command=self.add_search_matches).pack(side="left", padx=(0, 6))
        ttk.Button(search_row, text="Reset", command=self.reset_store_search).pack(side="left")

        self.all_store_tree = ttk.Treeview(
            center,
            columns=("index", "district", "store", "account_id"),
            show="headings",
            selectmode="extended",
            height=11,
        )

        self.all_store_tree.heading("index", text="#")
        self.all_store_tree.heading("district", text="District")
        self.all_store_tree.heading("store", text="Store")
        self.all_store_tree.heading("account_id", text="Account ID")

        self.all_store_tree.column("index", width=45, anchor="center")
        self.all_store_tree.column("district", width=130)
        self.all_store_tree.column("store", width=210)
        self.all_store_tree.column("account_id", width=90, anchor="center")

        self.all_store_tree.pack(fill="both", expand=True)

        center_buttons = ttk.Frame(center)
        center_buttons.pack(fill="x", pady=6)

        ttk.Button(center_buttons, text="Add Selected Rows", command=self.add_selected_store_rows).pack(side="left")
        ttk.Button(center_buttons, text="Add Filtered Stores", command=self.add_filtered_stores).pack(side="left", padx=6)

        ttk.Label(right, text="Selected Stores", style="Section.TLabel").grid(row=0, column=0, sticky="w", pady=(0, 4))

        # Bottom buttons pinned first so they are always visible
        right_buttons = ttk.Frame(right)
        right_buttons.grid(row=2, column=0, sticky="w", pady=(4, 0))
        ttk.Button(right_buttons, text="Remove Selected", command=self.remove_selected_stores).pack(side="left")
        ttk.Button(right_buttons, text="Clear", command=self.clear_selected_stores).pack(side="left", padx=6)

        self.selected_count_var = tk.StringVar(value="Selected stores: 0")
        ttk.Label(right, textvariable=self.selected_count_var).grid(row=3, column=0, sticky="w")

        sel_tree_frame = ttk.Frame(right)
        sel_tree_frame.grid(row=1, column=0, sticky="nsew")
        right.rowconfigure(1, weight=1)
        right.columnconfigure(0, weight=1)

        self.selected_store_tree = ttk.Treeview(
            sel_tree_frame,
            columns=("district", "store", "account_id", "status"),
            show="headings",
            selectmode="extended",
        )

        sel_scrollx = ttk.Scrollbar(sel_tree_frame, orient="horizontal", command=self.selected_store_tree.xview)
        sel_scrolly = ttk.Scrollbar(sel_tree_frame, orient="vertical", command=self.selected_store_tree.yview)
        self.selected_store_tree.configure(xscrollcommand=sel_scrollx.set, yscrollcommand=sel_scrolly.set)

        self.selected_store_tree.heading("district", text="District")
        self.selected_store_tree.heading("store", text="Store")
        self.selected_store_tree.heading("account_id", text="Account ID")
        self.selected_store_tree.heading("status", text="Status")

        self.selected_store_tree.column("district", width=110, minwidth=80)
        self.selected_store_tree.column("store", width=160, minwidth=100)
        self.selected_store_tree.column("account_id", width=155, anchor="center", minwidth=100)
        self.selected_store_tree.column("status", width=130, anchor="center", minwidth=80)

        # These are always light/pastel highlight colors, regardless of the
        # app's light/dark theme, so the row text must always stay dark to
        # be readable. Previously only `background` was set here — in dark
        # mode the base Treeview style's foreground is light/white, which
        # combined with these near-white backgrounds made the row text
        # nearly invisible.
        self.selected_store_tree.tag_configure("status_pending", background="#ffffff", foreground="#111827")
        self.selected_store_tree.tag_configure("status_running", background="#fff4cc", foreground="#111827")
        self.selected_store_tree.tag_configure("status_success", background="#d1fae5", foreground="#111827")
        self.selected_store_tree.tag_configure("status_failed", background="#fecaca", foreground="#111827")
        self.selected_store_tree.tag_configure("status_stopped", background="#e5e7eb", foreground="#111827")
        self.selected_store_tree.tag_configure("status_skipped", background="#fde68a", foreground="#111827")

        sel_scrolly.pack(side="right", fill="y")
        sel_scrollx.pack(side="bottom", fill="x")
        self.selected_store_tree.pack(side="left", fill="both", expand=True)

    # ════════════════════════════════════════════════════════════════════════
    # ORDER-TAB FACTORY (flow-aware: builds the same UI for Devices and SIMs)
    # ════════════════════════════════════════════════════════════════════════
    #
    # Each flow has its own state dict stored in self._flows[flow] with keys:
    #     product_type           : "TBV Branded" | "SIM Cards"
    #     default_product_name   : "" | "Total by Verizon SIM Kit"
    #     order_type_var         : tk.StringVar ("same" | "different")
    #     same_order_products    : list
    #     different_order_products : dict {store_key: [product dicts]}
    #     same_product_name_var  / same_quantity_var / same_mode_var
    #     same_order_frame       / different_order_frame
    #     same_product_tree
    #     diff_canvas            / diff_inner / diff_canvas_window
    #
    # All the original "self.same_*" / "self.different_*" / "self.order_type_var"
    # helpers below are flow-aware: they operate on self._flows[self.active_flow].

    # ── Order tab: single tab with Device / SIM toggle ─────────────

    def _build_order_tab(self):
        """Build the combined Order tab with a Product Type toggle at the top.

        Instead of separate Devices / SIMs notebook tabs (which caused
        active_flow to reset when the user clicked the Stores tab), both
        flows live in one tab.  A radio-button toggle switches the visible
        ordering UI.
        """
        outer = ttk.Frame(self.order_tab)
        outer.pack(fill="both", expand=True)

        # ── Product-type toggle ──────────────────────────────────────────
        toggle_bar = ttk.Frame(outer)
        toggle_bar.pack(fill="x", padx=10, pady=(10, 0))

        self._order_mode_var = tk.StringVar(value="device")

        ttk.Label(toggle_bar, text="Product Type:", style="Section.TLabel").pack(side="left")
        ttk.Radiobutton(
            toggle_bar,
            text="Devices  (TBV Branded)",
            variable=self._order_mode_var,
            value="device",
            command=self._on_order_mode_changed,
        ).pack(side="left", padx=(14, 0))
        ttk.Radiobutton(
            toggle_bar,
            text="SIMs  (SIM Cards)",
            variable=self._order_mode_var,
            value="sim",
            command=self._on_order_mode_changed,
        ).pack(side="left", padx=(14, 0))

        ttk.Separator(outer, orient="horizontal").pack(fill="x", padx=10, pady=8)

        # ── Build both flows into *outer* (containers stay unpacked) ────
        self._order_tab_factory(outer, flow="device")
        self._order_tab_factory(outer, flow="sim")

        # Show device flow by default
        self._on_order_mode_changed()

    def _on_order_mode_changed(self):
        """Show / hide the Device or SIM ordering UI based on the toggle."""
        new_flow = self._order_mode_var.get()
        self.active_flow = new_flow

        # Hide both containers, then show the active one
        for f_key in self._flows:
            self._flows[f_key]["container_frame"].pack_forget()

        self._flows[new_flow]["container_frame"].pack(
            fill="both", expand=True, padx=10, pady=(0, 10)
        )

    def _order_tab_factory(self, parent, flow="device"):
        """Build one full Order UI (Devices or SIMs) inside `parent`."""
        if flow == "sim":
            product_type = "SIM Cards"
            default_product_name = "Total by Verizon SIM Kit"
            section_title = "SIM Ordering"
        else:
            product_type = "TBV Branded"
            default_product_name = ""
            section_title = "Device Ordering"

        container = ttk.Frame(parent)
        # NOTE: container is NOT packed here — _on_order_mode_changed packs it

        top = ttk.Frame(container)
        top.pack(fill="x")

        ttk.Label(
            top,
            text=f"{section_title}  (Product Type: {product_type})",
            style="Section.TLabel",
        ).pack(anchor="w")
        ttk.Separator(top, orient="horizontal").pack(fill="x", pady=(4, 8))

        ttk.Label(top, text="Order Type", style="Section.TLabel").pack(anchor="w")

        order_type_var = tk.StringVar(value="same")

        def _on_order_type_change(_flow=flow):
            self._refresh_order_type_view(_flow)

        ttk.Radiobutton(
            top,
            text="Same order for all selected stores",
            variable=order_type_var,
            value="same",
            command=_on_order_type_change,
        ).pack(anchor="w", pady=2)

        ttk.Radiobutton(
            top,
            text="Different order for each selected store",
            variable=order_type_var,
            value="different",
            command=_on_order_type_change,
        ).pack(anchor="w", pady=2)

        order_frames_container = ttk.Frame(container)
        order_frames_container.pack(fill="both", expand=True, pady=(10, 0))

        same_order_frame = ttk.Frame(order_frames_container)
        different_order_frame = ttk.Frame(order_frames_container)

        # Same-order product entry row
        ttk.Label(same_order_frame, text="Same Order Products", style="Section.TLabel").pack(anchor="w")

        row = ttk.Frame(same_order_frame)
        row.pack(fill="x", pady=(6, 8))

        ttk.Label(row, text="Product Name").grid(row=0, column=0, sticky="w")
        same_product_name_var = tk.StringVar(value=default_product_name)
        ttk.Entry(row, textvariable=same_product_name_var, width=52).grid(row=1, column=0, padx=(0, 8), sticky="w")

        ttk.Label(row, text="Quantity").grid(row=0, column=1, sticky="w")
        same_quantity_var = tk.StringVar()
        ttk.Entry(row, textvariable=same_quantity_var, width=14).grid(row=1, column=1, padx=(0, 8), sticky="w")

        same_mode_var = tk.StringVar(value="same_qty")

        mode_frame = ttk.Frame(row)
        mode_frame.grid(row=1, column=2, padx=(0, 10), sticky="w")

        ttk.Radiobutton(
            mode_frame,
            text="Same qty per store",
            variable=same_mode_var,
            value="same_qty",
        ).pack(side="left", padx=(0, 8))

        ttk.Radiobutton(
            mode_frame,
            text="Distribute total",
            variable=same_mode_var,
            value="distribute",
        ).pack(side="left", padx=(0, 8))

        ttk.Radiobutton(
            mode_frame,
            text="MAX per store",
            variable=same_mode_var,
            value="max",
        ).pack(side="left")

        def _add_same(_flow=flow):
            self._add_same_product(_flow)
        def _rm_same(_flow=flow):
            self._remove_same_products(_flow)

        ttk.Button(row, text="Add Product", command=_add_same).grid(row=1, column=3, padx=(0, 8), sticky="w")
        ttk.Button(row, text="Remove Selected", command=_rm_same).grid(row=1, column=4, sticky="w")

        same_product_tree = ttk.Treeview(
            same_order_frame,
            columns=("product", "type", "quantity"),
            show="headings",
            selectmode="extended",
            height=14,
        )
        same_product_tree.heading("product", text="Product")
        same_product_tree.heading("type", text="Mode")
        same_product_tree.heading("quantity", text="Quantity")
        same_product_tree.column("product", width=520)
        same_product_tree.column("type", width=200, anchor="center")
        same_product_tree.column("quantity", width=140, anchor="center")
        same_product_tree.pack(fill="both", expand=True)

        # Different-order scrollable canvas
        toolbar = ttk.Frame(different_order_frame)
        toolbar.pack(fill="x", pady=(0, 6))

        ttk.Label(toolbar, text="Different Order per Store", style="Section.TLabel").pack(side="left")

        def _upload_xlsx(_flow=flow):
            self._import_different_order_xlsx(_flow)

        ttk.Button(
            toolbar,
            text="Upload XLSX",
            command=_upload_xlsx,
        ).pack(side="right", padx=(6, 0))

        ttk.Button(
            toolbar,
            text="Download Template",
            command=self.vp_download_order_template,
        ).pack(side="right", padx=(0, 6))

        ttk.Label(
            toolbar,
            text="XLSX format: columns  Store Name | Product Name | Quantity  (header row required)",
            style="Hint.TLabel",
        ).pack(side="right")

        canvas_frame = ttk.Frame(different_order_frame)
        canvas_frame.pack(fill="both", expand=True)

        diff_canvas = tk.Canvas(canvas_frame, background=BRAND_SURFACE, highlightthickness=0)
        diff_vsb = ttk.Scrollbar(canvas_frame, orient="vertical", command=diff_canvas.yview)
        diff_canvas.configure(yscrollcommand=diff_vsb.set)
        diff_vsb.pack(side="right", fill="y")
        diff_canvas.pack(side="left", fill="both", expand=True)

        diff_inner = ttk.Frame(diff_canvas)
        diff_canvas_window = diff_canvas.create_window((0, 0), window=diff_inner, anchor="nw")

        def _on_inner_cfg(_e=None, _flow=flow):
            self._on_diff_inner_configure(_flow)
        def _on_canvas_resize(e, _flow=flow):
            self._on_diff_canvas_resize(_flow, e)

        diff_inner.bind("<Configure>", _on_inner_cfg)
        diff_canvas.bind("<Configure>", _on_canvas_resize)

        diff_canvas.bind("<Enter>", lambda _e, _flow=flow: self._bind_diff_mousewheel(_flow))
        diff_canvas.bind("<Leave>", lambda _e, _flow=flow: self._unbind_diff_mousewheel(_flow))

        # Store all per-flow state
        self._flows[flow] = {
            "product_type": product_type,
            "default_product_name": default_product_name,
            "section_title": section_title,
            "order_type_var": order_type_var,
            "same_order_products": [],
            "different_order_products": {},
            "same_product_name_var": same_product_name_var,
            "same_quantity_var": same_quantity_var,
            "same_mode_var": same_mode_var,
            "same_order_frame": same_order_frame,
            "different_order_frame": different_order_frame,
            "same_product_tree": same_product_tree,
            "diff_canvas": diff_canvas,
            "diff_inner": diff_inner,
            "diff_canvas_window": diff_canvas_window,
            "container_frame": container,
        }

        # Initial view: show same-order frame
        self._refresh_order_type_view(flow)

    # ── canvas resize helpers (flow-aware) ───────────────────────────────────

    def _on_diff_inner_configure(self, flow, _event=None):
        f = self._flows[flow]
        f["diff_canvas"].configure(scrollregion=f["diff_canvas"].bbox("all"))

    def _on_diff_canvas_resize(self, flow, event):
        f = self._flows[flow]
        f["diff_canvas"].itemconfig(f["diff_canvas_window"], width=event.width)

    def _bind_diff_mousewheel(self, flow):
        def _scroll(event, _flow=flow):
            self._diff_mousewheel(_flow, event)
        self._flows[flow]["diff_canvas"].bind_all("<MouseWheel>", _scroll)

    def _unbind_diff_mousewheel(self, flow):
        self._flows[flow]["diff_canvas"].unbind_all("<MouseWheel>")

    def _diff_mousewheel(self, flow, event):
        f = self._flows[flow]
        f["diff_canvas"].yview_scroll(int(-1 * (event.delta / 120)), "units")

    # ── rebuild the scrollable store rows (flow-aware) ───────────────────────

    def _rebuild_different_order_rows(self, flow):
        f = self._flows[flow]
        for widget in f["diff_inner"].winfo_children():
            widget.destroy()
        for store_key, store in self.selected_stores.items():
            self._build_store_block(flow, store_key, store)
        self._on_diff_inner_configure(flow)

    def _build_store_block(self, flow, store_key, store):
        f = self._flows[flow]
        outer = ttk.Frame(f["diff_inner"], relief="groove", borderwidth=1)
        outer.pack(fill="x", padx=6, pady=4)

        hdr = ttk.Frame(outer)
        hdr.pack(fill="x", padx=6, pady=(4, 2))

        ttk.Label(
            hdr,
            text=f"\U0001f3ea  {store['name']}  |  {store['district']}  |  {store['account_id']}",
            style="Section.TLabel",
        ).pack(side="left")

        ttk.Button(
            hdr,
            text="+ Add Product",
            command=lambda k=store_key, blk=outer, _flow=flow: self._add_product_row(_flow, k, blk),
        ).pack(side="right")

        col_hdr = ttk.Frame(outer)
        col_hdr.pack(fill="x", padx=6)
        ttk.Label(col_hdr, text="Product Name", width=55, style="Hint.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(col_hdr, text="Qty", width=8, style="Hint.TLabel").grid(row=0, column=1, padx=4)
        ttk.Label(col_hdr, text="MAX", width=6, style="Hint.TLabel").grid(row=0, column=2)

        rows_frame = ttk.Frame(outer)
        rows_frame.pack(fill="x", padx=6, pady=(2, 6))
        rows_frame.store_key = store_key  # type: ignore[attr-defined]

        existing = f["different_order_products"].get(store_key, [])
        for product in existing:
            self._insert_product_row(flow, store_key, rows_frame, product)
        if not existing:
            self._insert_product_row(flow, store_key, rows_frame)

    def _add_product_row(self, flow, store_key, block_frame):
        rows_frame = None
        for child in block_frame.winfo_children():
            if hasattr(child, "store_key") and child.store_key == store_key:
                rows_frame = child
                break
        if rows_frame is None:
            return
        self._insert_product_row(flow, store_key, rows_frame)
        self._on_diff_inner_configure(flow)

    def _insert_product_row(self, flow, store_key, rows_frame, product=None):
        default_name = self._flows[flow]["default_product_name"]
        product_var = tk.StringVar(value=(product["name"] if product else default_name))
        qty_var = tk.StringVar(value=str(product["quantity"]) if product and product.get("quantity") else "")
        max_var = tk.BooleanVar(value=(product["type"] == "max") if product else False)

        row = ttk.Frame(rows_frame)
        row.pack(fill="x", pady=1)

        name_entry = ttk.Entry(row, textvariable=product_var, width=55)
        name_entry.grid(row=0, column=0, sticky="ew", padx=(0, 4))

        qty_entry = ttk.Entry(row, textvariable=qty_var, width=8)
        qty_entry.grid(row=0, column=1, padx=4)

        max_cb = ttk.Checkbutton(row, variable=max_var, text="MAX")
        max_cb.grid(row=0, column=2, padx=4)

        def remove_row(_flow=flow):
            row.destroy()
            self._sync_different_order_products(_flow)
            self._on_diff_inner_configure(_flow)

        ttk.Button(row, text="\u2715", width=3, command=remove_row).grid(row=0, column=3, padx=(4, 0))

        row.columnconfigure(0, weight=1)

        row._product_var = product_var  # type: ignore[attr-defined]
        row._qty_var = qty_var  # type: ignore[attr-defined]
        row._max_var = max_var  # type: ignore[attr-defined]
        row._store_key = store_key  # type: ignore[attr-defined]

        product_var.trace_add("write", lambda *_a, _f=flow: self._sync_different_order_products(_f))
        qty_var.trace_add("write", lambda *_a, _f=flow: self._sync_different_order_products(_f))
        max_var.trace_add("write", lambda *_a, _f=flow: self._sync_different_order_products(_f))

    def _sync_different_order_products(self, flow):
        f = self._flows[flow]
        new_map = {}
        for child in f["diff_inner"].winfo_children():
            for sub in child.winfo_children():
                if not hasattr(sub, "store_key"):
                    continue
                rows_frame = sub
                store_key = rows_frame.store_key
                products = []
                for row in rows_frame.winfo_children():
                    try:
                        name = row._product_var.get().strip()
                        if not name:
                            continue
                        is_max = row._max_var.get()
                        if is_max:
                            products.append({"name": name, "type": "max", "quantity": None})
                        else:
                            qty_text = row._qty_var.get().strip()
                            try:
                                qty = int(qty_text)
                                if qty <= 0:
                                    continue
                            except ValueError:
                                continue
                            products.append({"name": name, "type": "specified", "quantity": qty})
                    except Exception:
                        continue
                if products:
                    new_map[store_key] = products
        f["different_order_products"] = new_map

    # ── XLSX import (flow-aware) ─────────────────────────────────────────────

    def _import_different_order_xlsx(self, flow):
        filepath = filedialog.askopenfilename(
            title="Select XLSX File",
            filetypes=[("Excel files", "*.xlsx *.xls"), ("All files", "*.*")],
        )
        if not filepath:
            return

        try:
            import openpyxl
            wb = openpyxl.load_workbook(filepath, read_only=True, data_only=True)
            ws = wb.active

            rows = list(ws.iter_rows(values_only=True))
            wb.close()

            if not rows:
                messagebox.showerror("XLSX Error", "The file appears to be empty.")
                return

            header = [str(c).strip().lower() if c is not None else "" for c in rows[0]]

            col_store = col_product = col_qty = None
            for idx, h in enumerate(header):
                if "store" in h:
                    col_store = idx
                elif "product" in h:
                    col_product = idx
                elif "qty" in h or "quantity" in h:
                    col_qty = idx

            if col_store is None or col_product is None or col_qty is None:
                messagebox.showerror(
                    "XLSX Error",
                    "Could not find required columns.\n"
                    "Expected: Store Name | Product Name | Quantity",
                )
                return

            name_to_key = {}
            for key, store in self.selected_stores.items():
                name_to_key[normalize_text(store["name"])] = key

            imported = 0
            skipped_stores = set()

            for row in rows[1:]:
                if len(row) <= max(col_store, col_product, col_qty):
                    continue

                store_cell = row[col_store]
                product_cell = row[col_product]
                qty_cell = row[col_qty]

                if store_cell is None or product_cell is None:
                    continue

                store_name_norm = normalize_text(str(store_cell))
                product_name = str(product_cell).strip()
                qty_raw = str(qty_cell).strip() if qty_cell is not None else ""

                store_key = name_to_key.get(store_name_norm)
                if store_key is None:
                    skipped_stores.add(str(store_cell).strip())
                    continue

                if qty_raw.lower() == "max" or qty_raw == "":
                    product = {"name": product_name, "type": "max", "quantity": None}
                else:
                    try:
                        qty = int(float(qty_raw))
                        if qty <= 0:
                            continue
                        product = {"name": product_name, "type": "specified", "quantity": qty}
                    except ValueError:
                        continue

                f = self._flows[flow]
                if store_key not in f["different_order_products"]:
                    f["different_order_products"][store_key] = []
                f["different_order_products"][store_key].append(product)
                imported += 1

            self._rebuild_different_order_rows(flow)

            msg = f"Imported {imported} product row(s) from XLSX."
            if skipped_stores:
                msg += f"\n\nSkipped (store not in selected list):\n" + "\n".join(sorted(skipped_stores))

            messagebox.showinfo("XLSX Import", msg)
            self.log_message(msg.replace("\n", " | "))

        except ImportError:
            messagebox.showerror(
                "Missing Library",
                "openpyxl is required for XLSX import.\n\nRun:  pip install openpyxl",
            )
        except Exception as e:
            messagebox.showerror("XLSX Error", str(e))

    # ── refresh order-type view (flow-aware) ─────────────────────────────────

    def _refresh_order_type_view(self, flow):
        f = self._flows[flow]
        f["same_order_frame"].pack_forget()
        f["different_order_frame"].pack_forget()

        if f["order_type_var"].get() == "same":
            f["same_order_frame"].pack(fill="both", expand=True)
        else:
            f["different_order_frame"].pack(fill="both", expand=True)
            self._rebuild_different_order_rows(flow)

    # ── add/remove same products (flow-aware) ────────────────────────────────

    def _add_same_product(self, flow):
        f = self._flows[flow]
        name = f["same_product_name_var"].get().strip()

        if not name:
            messagebox.showwarning("Product Missing", "Enter product name.")
            return

        mode = f["same_mode_var"].get()  # "same_qty" | "distribute" | "max"

        if mode == "max":
            product = {
                "name": name,
                "type": "max",
                "quantity": None,
                "district_qtys": {},
            }

        elif mode == "distribute":
            district_qtys = self._ask_district_quantities(name)
            if district_qtys is None:
                return  # user cancelled

            total_qty = sum(district_qtys.values())

            if total_qty <= 0:
                messagebox.showwarning("No Quantity", "All district quantities are 0. Nothing to order.")
                return

            product = {
                "name": name,
                "type": "distribute",
                "quantity": total_qty,
                "district_qtys": district_qtys,
            }

        else:  # same_qty
            qty_text = f["same_quantity_var"].get().strip()
            try:
                qty = int(qty_text)
                if qty <= 0:
                    raise ValueError
            except ValueError:
                messagebox.showwarning("Invalid Quantity", "Enter a positive quantity or select MAX per store.")
                return

            product = {
                "name": name,
                "type": "same_qty",
                "quantity": qty,
                "district_qtys": {},
            }

        f["same_order_products"].append(product)
        f["same_product_name_var"].set(f["default_product_name"])
        f["same_quantity_var"].set("")
        f["same_mode_var"].set("same_qty")

        self._refresh_same_product_tree(flow)

    def _refresh_same_product_tree(self, flow):
        f = self._flows[flow]
        tree = f["same_product_tree"]
        for item in tree.get_children():
            tree.delete(item)

        MODE_LABELS = {
            "max":        "MAX per store",
            "same_qty":   "Same qty per store",
            "distribute": "Distribute by district",
        }

        for idx, product in enumerate(f["same_order_products"]):
            ptype = product["type"]
            type_display = MODE_LABELS.get(ptype, ptype)

            if ptype == "distribute":
                dq = product.get("district_qtys", {})
                qty_display = "  |  ".join(f"{d}: {q}" for d, q in dq.items()) if dq else str(product.get("quantity", ""))
            elif ptype == "max":
                qty_display = "MAX"
            else:
                qty_display = str(product.get("quantity", ""))

            tree.insert(
                "",
                "end",
                iid=str(idx),
                values=(product["name"], type_display, qty_display)
            )

    def _remove_same_products(self, flow):
        f = self._flows[flow]
        tree = f["same_product_tree"]
        selected = tree.selection()

        if not selected:
            return

        indexes = sorted([int(iid) for iid in selected], reverse=True)

        for index in indexes:
            if 0 <= index < len(f["same_order_products"]):
                f["same_order_products"].pop(index)

        self._refresh_same_product_tree(flow)

    # ── Check Scheduler ──────────────────────────────────────────────
    _scheduler_thread = None
    _scheduler_stop = threading.Event()

    def _toggle_scheduler(self):
        if self.scheduler_enabled_var.get():
            self._start_scheduler()
        else:
            self._stop_scheduler()

    def _start_scheduler(self):
        self._scheduler_stop.clear()
        self.scheduler_status_var.set("Scheduler starting...")
        self._scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self._scheduler_thread.start()

    def _stop_scheduler(self):
        self._scheduler_stop.set()
        self.scheduler_status_var.set("Scheduler stopped")

    def _scheduler_loop(self):
        """Background loop: sleep until the next scheduled time, then run check."""
        while not self._scheduler_stop.is_set():
            try:
                hour = int(self.sched_hour_var.get())
                minute = int(self.sched_min_var.get())
                repeat_min = int(self.sched_repeat_var.get())
            except ValueError:
                self.after(0, lambda: self.scheduler_status_var.set("Invalid time"))
                break

            now = datetime.now()
            target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            # Keep adding repeat interval until target is in the future
            while target <= now:
                target += timedelta(minutes=repeat_min)

            wait_seconds = (target - now).total_seconds()
            if wait_seconds > 0:
                # Show countdown
                def update_countdown(remaining):
                    if self._scheduler_stop.is_set():
                        return
                    h = int(remaining // 3600)
                    m = int((remaining % 3600) // 60)
                    s = int(remaining % 60)
                    self.after(0, lambda: self.scheduler_status_var.set(
                        f"Next check in {h}h {m}m {s}s"))
                    if remaining <= 0:
                        return True  # trigger
                    return False

                # Check every 10 seconds
                while wait_seconds > 0 and not self._scheduler_stop.is_set():
                    update_countdown(wait_seconds)
                    time.sleep(10)
                    wait_seconds -= 10

            if self._scheduler_stop.is_set():
                break

            # ── Run the scheduled check ──
            self.after(0, lambda: self.scheduler_status_var.set("Running scheduled check..."))
            try:
                self._run_scheduled_check()
            except Exception as e:
                self.after(0, lambda: self.scheduler_status_var.set(f"Check error: {e}"))

    def _run_scheduled_check(self):
        """Run check mode from scheduler — same as manual check but automatic."""
        if self.worker_thread and self.worker_thread.is_alive():
            self.scheduler_status_var.set("Automation running — check skipped")
            return

        # Validate we have stores and products
        selected_stores = list(self.selected_stores.values())
        if not selected_stores:
            self.scheduler_status_var.set("No stores selected")
            return

        flow = self.active_flow
        f = self._flows[flow]
        same_order_products = list(f["same_order_products"])
        check_products = [p.get("name", p) if isinstance(p, dict) else p
                           for p in same_order_products]
        if not check_products:
            self.scheduler_status_var.set("No products to check")
            return

        active_product_type = f["product_type"]

        self.stop_event.clear()
        self.twofa_event.clear()

        self.progress_var.set(0)
        self.after(0, lambda: self.status_var.set("Scheduled check running..."))
        self.after(0, lambda: self.start_button.config(state="disabled"))

        system = VidapayOrderingSystem(
            login_account_id=self.login_account_id_var.get().strip(),
            login_username=self.login_username_var.get().strip(),
            login_password=self.login_password_var.get().strip(),
            download_folder=self.download_folder_var.get().strip(),
            log_callback=self.log_message,
            progress_callback=self.update_progress_safe,
            wait_for_2fa_callback=self.wait_for_manual_2fa,
            stop_event=self.stop_event,
            store_status_callback=self.set_store_status_safe,
        )
        system.check_only = True
        system.download_folder = self.download_folder_var.get().strip()
        self.active_system = system

        self.log_message("[SCHEDULER] Starting scheduled device check...")

        if not system.start_browser_and_login():
            self.log_message("[SCHEDULER] Login failed.")
            self.after(0, lambda: self.start_button.config(state="normal"))
            self.scheduler_status_var.set("Login failed — retry next cycle")
            return

        if not system.click_handset_ordering():
            self.log_message("[SCHEDULER] Could not open MA Handset Ordering.")
            self.after(0, lambda: self.start_button.config(state="normal"))
            self.scheduler_status_var.set("Navigation failed — retry next cycle")
            return

        system.run_check(selected_stores, check_products, product_type=active_product_type)

        # Save report
        report_path = system.save_check_xlsx_log()
        self.last_report_path = report_path
        self.last_check_log = list(system.check_log)

        # Send WhatsApp report with log file
        report_group = self.whatsapp_report_group_var.get().strip()
        if report_group:
            system.send_check_report(report_group, report_path)

        self.log_message("[SCHEDULER] Device check complete.")
        self.after(0, lambda: self.start_button.config(state="normal"))
        next_run = datetime.now().strftime("%H:%M")
        self.after(0, lambda: self.scheduler_status_var.set(f"Last check at {next_run}"))

    # Summary tab removed per user request.

    def create_bottom_log_area(self):
        frame = ttk.Frame(self._body, width=340)
        frame.pack(side="right", fill="y", expand=False)
        frame.pack_propagate(False)

        wa = ttk.Frame(frame)
        wa.pack(fill="x", pady=(0, 4))
        ttk.Label(wa, text="WhatsApp 2FA Group", style="Section.TLabel").pack(anchor="w")
        self.whatsapp_group_var = tk.StringVar(value=_vp_get("whatsapp_group", ""))
        ttk.Entry(wa, textvariable=self.whatsapp_group_var).pack(fill="x", pady=(3, 2))
        # WhatsApp mode: Desktop (pyautogui) or Web (browser tab)
        wa_mode_row = ttk.Frame(wa)
        wa_mode_row.pack(fill="x", pady=(2, 6))
        ttk.Label(wa_mode_row, text="Send via:", style="Section.TLabel").pack(side="left", padx=(0, 6))
        self.wa_mode_var = tk.StringVar(value=_vp_get("whatsapp_mode", "desktop"))
        ttk.Radiobutton(wa_mode_row, text="Desktop App", variable=self.wa_mode_var,
                        value="desktop").pack(side="left", padx=(0, 8))
        ttk.Radiobutton(wa_mode_row, text="WhatsApp Web", variable=self.wa_mode_var,
                        value="web").pack(side="left")

        wa2 = ttk.Frame(frame)
        wa2.pack(fill="x", pady=(0, 4))
        ttk.Label(wa2, text="WhatsApp Report Group", style="Section.TLabel").pack(anchor="w")
        self.whatsapp_report_group_var = tk.StringVar(value=_vp_get("whatsapp_report_group", ""))
        ttk.Entry(wa2, textvariable=self.whatsapp_report_group_var).pack(fill="x", pady=(3, 6))

        check_frame = ttk.Frame(frame)
        check_frame.pack(fill="x", pady=(0, 4))
        self.check_only_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(check_frame, text="Check Only (no ordering)",
                         variable=self.check_only_var).pack(anchor="w")

        # ── Check Scheduler ──
        sched_frame = ttk.LabelFrame(frame, text="Check Scheduler")
        sched_frame.pack(fill="x", pady=(4, 4))
        self.scheduler_enabled_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(sched_frame, text="Enable Scheduler",
                         variable=self.scheduler_enabled_var,
                         command=self._toggle_scheduler).pack(anchor="w", padx=4)
        time_row = ttk.Frame(sched_frame)
        time_row.pack(fill="x", padx=4, pady=2)
        ttk.Label(time_row, text="Schedule Time:").pack(side="left")
        self.sched_hour_var = tk.StringVar(value=_vp_get("sched_hour", "09"))
        self.sched_min_var = tk.StringVar(value=_vp_get("sched_min", "00"))
        ttk.Combobox(time_row, textvariable=self.sched_hour_var,
                      values=[f"{h:02d}" for h in range(24)],
                      width=3, state="readonly").pack(side="left", padx=2)
        ttk.Label(time_row, text=":").pack(side="left")
        ttk.Combobox(time_row, textvariable=self.sched_min_var,
                      values=[f"{m:02d}" for m in range(0, 60, 5)],
                      width=3, state="readonly").pack(side="left", padx=2)
        # Repeat interval
        repeat_row = ttk.Frame(sched_frame)
        repeat_row.pack(fill="x", padx=4, pady=2)
        ttk.Label(repeat_row, text="Repeat every:").pack(side="left")
        self.sched_repeat_var = tk.StringVar(value=_vp_get("sched_repeat", "60"))
        ttk.Combobox(repeat_row, textvariable=self.sched_repeat_var,
                      values=["30", "60", "90", "120", "180", "240", "360", "480", "720", "1440"],
                      width=5, state="readonly").pack(side="left", padx=2)
        ttk.Label(repeat_row, text="min").pack(side="left")
        self.scheduler_status_var = tk.StringVar(value="Scheduler idle")
        ttk.Label(sched_frame, textvariable=self.scheduler_status_var,
                  font=("Consolas", 7)).pack(anchor="w", padx=4, pady=(0, 2))

        ttk.Separator(frame, orient="horizontal").pack(fill="x", pady=(0, 6))

        top = ttk.Frame(frame)
        top.pack(fill="x")

        ttk.Label(top, text="Live Log", style="Section.TLabel").pack(side="left")

        btn_frame = ttk.Frame(top)
        btn_frame.pack(side="right")

        ttk.Button(btn_frame, text="📋 Copy Log", command=self._copy_log_to_clipboard).pack(side="left", padx=(0, 4))
        ttk.Button(btn_frame, text="💾 Save Log", command=self._save_log_to_file).pack(side="left", padx=(0, 4))
        ttk.Button(btn_frame, text="📤 Resend Report", command=self._resend_report).pack(side="left")

        self.status_var = tk.StringVar(value="Ready.")
        ttk.Label(top, textvariable=self.status_var).pack(side="right", padx=(0, 8))

        self.progress_var = tk.DoubleVar(value=0)
        self.progress_bar = ttk.Progressbar(frame, variable=self.progress_var, maximum=100)
        self.progress_bar.pack(fill="x", pady=(4, 6))

        self.log_text = tk.Text(frame, width=42, height=18, wrap="word", font=("Consolas", 8))
        scroll = ttk.Scrollbar(frame, orient="vertical", command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.log_text.pack(fill="both", expand=True)

    def _copy_log_to_clipboard(self):
        try:
            content = self.log_text.get("1.0", "end")
            self.clipboard_clear()
            self.clipboard_append(content)
            messagebox.showinfo("Copied", "Log copied to clipboard.")
        except Exception as e:
            messagebox.showerror("Copy Error", str(e))

    def _save_log_to_file(self):
        try:
            path = filedialog.asksaveasfilename(
                defaultextension=".txt",
                filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
                initialfile=f"vidapay_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt",
                title="Save Log File",
            )
            if path:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(self.log_text.get("1.0", "end"))
                messagebox.showinfo("Saved", f"Log saved to:\n{path}")
        except Exception as e:
            messagebox.showerror("Save Error", str(e))

    def _resend_report(self):
        """Re-send the last check report to WhatsApp (text + XLSX file).
        Runs in a background thread so it doesn't freeze the GUI."""
        report_group = self.whatsapp_report_group_var.get().strip()
        if not report_group:
            messagebox.showwarning("No Report Group",
                                   "Set a WhatsApp Report Group name first.")
            return
        if not self.last_check_log:
            messagebox.showwarning("No Report",
                                   "No check report available. Run a device check first.")
            return

        report_path = self.last_report_path
        # If the XLSX file was deleted, regenerate it
        if not report_path or not os.path.isfile(report_path):
            self.log_message("[RESEND] XLSX file not found, regenerating...")
            # Temporarily create a system object just to save the XLSX
            try:
                tmp = object.__new__(VidapayOrderingSystem)
                tmp.check_log = list(self.last_check_log)
                tmp.download_folder = self.download_folder_var.get().strip()
                tmp.log = self.log_message
                report_path = tmp.save_check_xlsx_log()
                self.last_report_path = report_path
            except Exception as e:
                messagebox.showerror("Error", f"Could not regenerate report: {e}")
                return

        if not report_path:
            messagebox.showwarning("No Report File",
                                   "Could not save XLSX report. Check your download folder.")
            return

        self.log_message("[RESEND] Sending report to WhatsApp...")
        def _send_thread():
            try:
                # Build report text from saved check_log
                tmp = object.__new__(VidapayOrderingSystem)
                tmp.check_log = list(self.last_check_log)
                tmp.download_folder = self.download_folder_var.get().strip()
                tmp.log = self.log_message
                report_text = tmp.build_check_report()
                # Send file WITH text as caption
                send_whatsapp_report_file(report_path, report_group,
                                          log=self.log_message,
                                          caption_text=report_text)
                self.after(0, lambda: self.log_message("[RESEND] Report sent successfully."))
            except Exception as e:
                self.after(0, lambda: self.log_message(f"[RESEND] Error: {e}"))

        threading.Thread(target=_send_thread, daemon=True).start()

    def browse_download_folder(self):
        folder = filedialog.askdirectory()

        if folder:
            self.download_folder_var.set(folder)

    def refresh_all_store_tree(self):
        search = normalize_text(self.store_search_var.get())

        for item in self.all_store_tree.get_children():
            self.all_store_tree.delete(item)

        for store in self.all_stores:
            store_search_blob = normalize_text(
                f"{store['name']} {store['district']} {store['account_id']}"
            )

            if search and search not in store_search_blob:
                continue

            self.all_store_tree.insert(
                "",
                "end",
                iid=str(store["index"]),
                values=(
                    store["index"],
                    store["district"],
                    store["name"],
                    store["account_id"],
                )
            )

    def reset_store_search(self):
        self.store_search_var.set("")
        self.refresh_all_store_tree()

    def add_store_to_selected(self, store):
        key = store["account_id"]

        if key not in self.selected_stores:
            self.selected_stores[key] = {
                "district": store["district"],
                "name": store["name"],
                "account_id": store["account_id"],
                "username": store.get("username", ""),
            }
            self.store_status_map[key] = "Pending"
            self.store_status_detail_map[key] = ""

        self.refresh_selected_store_tree()
        for _f in self._flows:
            if self._flows[_f]["order_type_var"].get() == "different":
                self._rebuild_different_order_rows(_f)

    def add_checked_districts(self):
        added = 0

        for district, var in self.district_vars.items():
            if var.get():
                for store in self.all_stores:
                    if store["district"] == district:
                        key = store["account_id"]

                        if key not in self.selected_stores:
                            self.add_store_to_selected(store)
                            added += 1

        self.log_message(f"Added {added} store(s) from checked districts.")

    def add_all_stores(self):
        for store in self.all_stores:
            self.add_store_to_selected(store)

        self.log_message(f"Added all stores. Total selected: {len(self.selected_stores)}")

    def add_selected_store_rows(self):
        selected = self.all_store_tree.selection()

        if not selected:
            messagebox.showinfo("No Store Selected", "Select one or more rows from All Stores.")
            return

        for iid in selected:
            index = int(iid)
            store = next((x for x in self.all_stores if x["index"] == index), None)

            if store:
                self.add_store_to_selected(store)

        self.log_message(f"Selected stores updated. Total selected: {len(self.selected_stores)}")

    def add_filtered_stores(self):
        rows = self.all_store_tree.get_children()

        if not rows:
            messagebox.showinfo("No Filter Results", "No stores are visible in the current filter.")
            return

        for iid in rows:
            index = int(iid)
            store = next((x for x in self.all_stores if x["index"] == index), None)

            if store:
                self.add_store_to_selected(store)

        self.log_message(f"Added filtered stores. Total selected: {len(self.selected_stores)}")

    def add_search_matches(self):
        search = normalize_text(self.store_search_var.get())

        if not search:
            messagebox.showinfo("Search Required", "Type a store name first.")
            return

        matches = []

        for store in self.all_stores:
            store_name = normalize_text(store["name"])

            if search in store_name:
                matches.append(store)

        if not matches:
            messagebox.showwarning("No Matches", "No store matched your search.")
            return

        for store in matches:
            self.add_store_to_selected(store)

        self.log_message(f"Added {len(matches)} store name match(es).")

    def remove_selected_stores(self):
        selected = self.selected_store_tree.selection()

        if not selected:
            messagebox.showinfo("No Store Selected", "Select one or more stores to remove.")
            return

        for iid in selected:
            if iid in self.selected_stores:
                del self.selected_stores[iid]
            self.store_status_map.pop(iid, None)
            self.store_status_detail_map.pop(iid, None)
            for _f in self._flows:
                self._flows[_f]["different_order_products"].pop(iid, None)

        self.refresh_selected_store_tree()
        for _f in self._flows:
            if self._flows[_f]["order_type_var"].get() == "different":
                self._rebuild_different_order_rows(_f)
        self.log_message(f"Selected stores updated. Total selected: {len(self.selected_stores)}")

    def clear_selected_stores(self):
        self.selected_stores.clear()
        self.store_status_map.clear()
        self.store_status_detail_map.clear()
        for _f in self._flows:
            self._flows[_f]["different_order_products"].clear()
        self.refresh_selected_store_tree()
        for _f in self._flows:
            if self._flows[_f]["order_type_var"].get() == "different":
                self._rebuild_different_order_rows(_f)
        self.log_message("Selected stores cleared.")

    def get_status_tag(self, status):
        status_upper = str(status).upper()
        if status_upper.startswith("SUCCESS"):
            return "status_success"
        if status_upper.startswith("FAILED"):
            return "status_failed"
        if status_upper.startswith("RUNNING"):
            return "status_running"
        if status_upper.startswith("STOPPED"):
            return "status_stopped"
        if status_upper.startswith("SKIPPED"):
            return "status_skipped"
        return "status_pending"

    def set_store_status_safe(self, account_id, status, detail=""):
        self.after(0, lambda: self.set_store_status(account_id, status, detail))

    def set_store_status(self, account_id, status, detail=""):
        self.store_status_map[account_id] = status
        self.store_status_detail_map[account_id] = detail

        if account_id in self.selected_stores and self.selected_store_tree.exists(account_id):
            store = self.selected_stores[account_id]
            display_status = status if not detail else f"{status}: {detail}"
            if len(display_status) > 52:
                display_status = display_status[:49] + "..."

            self.selected_store_tree.item(
                account_id,
                values=(
                    store["district"],
                    store["name"],
                    store["account_id"],
                    display_status,
                ),
                tags=(self.get_status_tag(status),),
            )

        if str(status).upper().startswith("FAILED"):
            self.log_message(f"FAILED HIGHLIGHTED: {self.selected_stores.get(account_id, {}).get('name', account_id)} | {detail}")

    def refresh_selected_store_tree(self):
        for item in self.selected_store_tree.get_children():
            self.selected_store_tree.delete(item)

        for key, store in self.selected_stores.items():
            status = self.store_status_map.get(key, "Pending")
            detail = self.store_status_detail_map.get(key, "")
            display_status = status if not detail else f"{status}: {detail}"
            if len(display_status) > 52:
                display_status = display_status[:49] + "..."

            self.selected_store_tree.insert(
                "",
                "end",
                iid=key,
                values=(
                    store["district"],
                    store["name"],
                    store["account_id"],
                    display_status,
                ),
                tags=(self.get_status_tag(status),),
            )

        self.selected_count_var.set(f"Selected stores: {len(self.selected_stores)}")

    # on_order_flow_change / refresh_order_type_view were replaced by the
    # flow-aware _refresh_order_type_view(flow) above.

    def _get_selected_districts_ordered(self):
        """Return the unique districts from selected stores, in first-appearance order."""
        seen = []
        for store in self.selected_stores.values():
            d = store["district"]
            if d not in seen:
                seen.append(d)
        return seen

    def _ask_district_quantities(self, product_name):
        """
        Open a modal dialog with one quantity entry per selected district.
        Returns dict {district: qty} or None if user cancelled.
        """
        districts = self._get_selected_districts_ordered()

        if not districts:
            messagebox.showwarning("No Stores", "Select at least one store before adding a distribute product.")
            return None

        dialog = tk.Toplevel(self)
        dialog.title("Set District Quantities")
        dialog.resizable(False, False)
        dialog.grab_set()

        ttk.Label(dialog, text=f"Product: {product_name}", font=("Segoe UI", 10, "bold")).pack(padx=16, pady=(14, 4), anchor="w")
        ttk.Label(
            dialog,
            text="Enter the quantity target for each district.\n"
                 "The bot will keep ordering across stores in the district\n"
                 "until that exact total is reached.",
            foreground="#555",
        ).pack(padx=16, pady=(0, 10), anchor="w")

        entries = {}
        for district in districts:
            row = ttk.Frame(dialog)
            row.pack(fill="x", padx=16, pady=3)
            ttk.Label(row, text=district, width=22, anchor="w").pack(side="left")
            var = tk.StringVar()
            ttk.Entry(row, textvariable=var, width=10).pack(side="left", padx=(6, 0))
            entries[district] = var

        result = {}
        cancelled = [False]

        def on_ok():
            for d, var in entries.items():
                txt = var.get().strip()
                try:
                    qty = int(txt)
                    if qty < 0:
                        raise ValueError
                    result[d] = qty
                except ValueError:
                    messagebox.showwarning("Invalid Quantity", f"Enter a whole number ≥ 0 for '{d}'.")
                    return
            dialog.destroy()

        def on_cancel():
            cancelled[0] = True
            dialog.destroy()

        btn_row = ttk.Frame(dialog)
        btn_row.pack(fill="x", padx=16, pady=(10, 14))
        ttk.Button(btn_row, text="OK", command=on_ok).pack(side="left", padx=(0, 8))
        ttk.Button(btn_row, text="Cancel", command=on_cancel).pack(side="left")

        # Centre over parent
        self.update_idletasks()
        px, py = self.winfo_rootx(), self.winfo_rooty()
        pw, ph = self.winfo_width(), self.winfo_height()
        dialog.update_idletasks()
        dw, dh = dialog.winfo_width(), dialog.winfo_height()
        dialog.geometry(f"+{px + (pw - dw) // 2}+{py + (ph - dh) // 2}")

        dialog.wait_window()

        if cancelled[0] or not result:
            return None
        return result

    # add_same_product / refresh_same_product_tree / remove_same_products
    # were replaced by the flow-aware _add_same_product / _refresh_same_product_tree
    # / _remove_same_products methods above.

    def refresh_different_store_dropdown(self):
        # Rebuild different-order rows on all flows currently showing that view
        for flow in self._flows:
            f = self._flows[flow]
            if f["order_type_var"].get() == "different":
                self._rebuild_different_order_rows(flow)

    def get_selected_diff_store_key(self):
        return None

    def add_different_product(self):
        pass

    def refresh_different_product_tree(self):
        pass

    def remove_different_products(self):
        pass

    def refresh_summary(self):
        pass

    def validate_before_run(self):
        if not self.login_account_id_var.get().strip():
            messagebox.showwarning("Missing Login Account ID", "Enter login Account ID.")
            return False

        if not self.login_username_var.get().strip():
            messagebox.showwarning("Missing Username", "Enter login username.")
            return False

        # The VidaPay CRM sign-in page's Account ID field is numeric-only
        # (max 6 digits) — see its <input type="number" ... id="AccountId">.
        # If Account ID has non-digit characters while Username is purely
        # numeric, the values are almost certainly sitting in the wrong
        # boxes (e.g. left over from an older saved config). Catch it here
        # instead of letting automation silently fail at the live site,
        # where the numeric-only field just rejects the non-digit input
        # and gets submitted empty.
        acc = self.login_account_id_var.get().strip()
        user = self.login_username_var.get().strip()
        if not acc.isdigit() and user.isdigit():
            swap = messagebox.askyesno(
                "Account ID / Username look swapped",
                "VidaPay's Account ID field only accepts numbers (up to 6 digits).\n\n"
                f"Login Account ID is currently: {acc!r}\n"
                f"Username is currently: {user!r}\n\n"
                "These look like they're in the wrong boxes. Swap them now?"
            )
            if swap:
                self.login_account_id_var.set(user)
                self.login_username_var.set(acc)
            else:
                return False
        elif acc and not acc.isdigit():
            messagebox.showwarning(
                "Account ID Should Be Numeric",
                "VidaPay's Account ID field only accepts numbers (up to 6 digits).\n"
                f"Login Account ID is currently: {acc!r}\n\n"
                "The site will reject this and submit the field empty. Please "
                "double-check the value before starting."
            )
            return False

        if not self.login_password_var.get().strip():
            messagebox.showwarning("Missing Password", "Enter login password.")
            return False

        if not self.selected_stores:
            messagebox.showwarning("No Stores", "Select at least one store.")
            return False

        flow = self.active_flow
        f = self._flows[flow]

        # Auto-detect: if the active flow has no products but the other does,
        # switch automatically so the user doesn't get a cryptic "No Products" error.
        has_products = bool(f["same_order_products"]) or bool(f["different_order_products"])
        if not has_products:
            other = "sim" if flow == "device" else "device"
            other_f = self._flows[other]
            if other_f["same_order_products"] or other_f["different_order_products"]:
                flow = other
                f = other_f
                self.active_flow = flow
                self._order_mode_var.set(flow)
                self.log_message(f"Auto-switched to {f['section_title']} mode (products found there).")

        if f["order_type_var"].get() == "same":
            if not f["same_order_products"]:
                messagebox.showwarning("No Products", "Add at least one product.")
                return False
        else:
            # Sync row widgets → per-flow different_order_products before checking
            self._sync_different_order_products(flow)

            missing = []

            for store in self.selected_stores.values():
                key = store["account_id"]

                if not f["different_order_products"].get(key):
                    missing.append(store["name"])

            if missing:
                messagebox.showwarning(
                    "Missing Products",
                    "Add products for these stores or remove them:\n\n" + "\n".join(missing)
                )
                return False

        return True

    def start_automation(self):
        if self.worker_thread and self.worker_thread.is_alive():
            messagebox.showinfo("Running", "Automation is already running.")
            return

        if not self.validate_before_run():
            return

        is_check_only = self.check_only_var.get()
        flow_label = "SIMs (SIM Cards)" if self.active_flow == "sim" else "Devices (TBV Branded)"
        mode_label = "CHECK ONLY — no devices will be ordered" if is_check_only else "ORDER MODE"
        confirmed = messagebox.askyesno(
            "Confirm Run",
            f"Start Vidapay automation with the selected stores and products?\n\n"
            f"Order Flow: {flow_label}\n"
            f"Mode: {mode_label}"
        )

        if not confirmed:
            return

        self.stop_event.clear()
        self.twofa_event.clear()

        # Ensure in-widget data is committed before the worker thread reads it
        _af = self.active_flow
        if self._flows[_af]["order_type_var"].get() == "different":
            self._sync_different_order_products(_af)

        for account_id in self.selected_stores.keys():
            self.store_status_map[account_id] = "Pending"
            self.store_status_detail_map[account_id] = ""
        self.refresh_selected_store_tree()

        self.progress_var.set(0)
        self.status_var.set("Running...")
        self.start_button.config(state="disabled")
        self.stop_button.config(state="normal")
        self.continue_2fa_button.config(state="disabled")

        self.log_message("Starting automation...")

        self.worker_thread = threading.Thread(target=self.run_automation_worker, daemon=True)
        self.worker_thread.start()

    def stop_automation(self):
        self.stop_event.set()
        self.log_message("Stop requested. The bot will stop after the current browser step.")

    def continue_after_2fa(self):
        self.twofa_event.set()
        self.continue_2fa_button.config(state="disabled")
        self.log_message("Continue After 2FA clicked.")

    def wait_for_manual_2fa(self):
        self.root_after_enable_2fa_button()
        self.twofa_event.wait()

    def root_after_enable_2fa_button(self):
        self.after(0, lambda: self.continue_2fa_button.config(state="normal"))

    def run_automation_worker(self):
        system = None

        try:
            selected_stores = list(self.selected_stores.values())

            # ── Pull all per-flow state up front (worker reads from self.*
            #    are not safe after the UI changes state during the run).
            flow = self.active_flow
            f = self._flows[flow]
            order_type = f["order_type_var"].get()
            active_product_type = f["product_type"]
            same_order_products = list(f["same_order_products"])
            different_order_products = {k: list(v) for k, v in f["different_order_products"].items()}
            self.log_message(f"Active product type for this run: {active_product_type}")

            system = VidapayOrderingSystem(
                login_account_id=self.login_account_id_var.get().strip(),
                login_username=self.login_username_var.get().strip(),
                login_password=self.login_password_var.get().strip(),
                download_folder=self.download_folder_var.get().strip(),
                log_callback=self.log_message,
                progress_callback=self.update_progress_safe,
                wait_for_2fa_callback=self.wait_for_manual_2fa,
                stop_event=self.stop_event,
                store_status_callback=self.set_store_status_safe,
            )

            # Set check-only mode
            system.check_only = self.check_only_var.get()
            system.download_folder = self.download_folder_var.get().strip()

            # Keep a permanent reference to the Selenium object.
            # This prevents Python cleanup from destroying the session when the worker exits.
            self.active_system = system

            if not system.start_browser_and_login():
                self.log_message("Login step failed or stopped.")
                self.log_message("Browser kept open.")
                return

            self.log_message("2FA completed. Browser will stay open from this point onward.")

            if self.stop_event.is_set():
                self.log_message("Stopped before ordering.")
                self.log_message("Browser kept open.")
                return

            if not system.click_handset_ordering():
                self.log_message("Could not open MA Handset Ordering.")
                self.log_message("Browser kept open.")
                return

            # ═══════════════════════════════════════════════════════════════
            # CHECK-ONLY BRANCH — reads stock/credit, no ordering
            # ═══════════════════════════════════════════════════════════════
            if system.check_only:
                # Build flat product name list from same_order_products
                check_products = [p.get("name", p) if isinstance(p, dict) else p
                                   for p in same_order_products]
                if not check_products:
                    self.log_message("No products to check. Add devices in the order tab.")
                    return

                system.run_check(selected_stores, check_products, product_type=active_product_type)

                # Save XLSX check report
                report_path = system.save_check_xlsx_log()

                # Save report path for resend
                self.last_report_path = report_path
                self.last_check_log = list(system.check_log)

                # Send WhatsApp report (text + XLSX file)
                report_group = self.whatsapp_report_group_var.get().strip()
                if report_group:
                    system.send_check_report(report_group, report_path)

                self.log_message("=" * 70)
                self.log_message("DEVICE CHECK COMPLETE")
                self.log_message(f"Total records: {len(system.check_log)}")
                if report_path:
                    self.log_message(f"Report saved to: {report_path}")
                self.log_message("Browser kept open. No devices were ordered.")
                self.log_message("=" * 70)
                return

            # ═══════════════════════════════════════════════════════════════
            # NORMAL ORDER MODE (existing logic)
            # ═══════════════════════════════════════════════════════════════

            total_stores = len(selected_stores)

            if order_type == "same":
                # ── Build per-store product lists ────────────────────────────

                # Index each selected store by position for the product map
                store_product_map = {i: [] for i in range(total_stores)}

                # For "distribute" mode we need district groupings of the
                # SELECTED stores (not all stores).
                #
                # Algorithm:
                #   1. Find the unique districts present in the selected list,
                #      preserving their first-appearance order.
                #   2. For each district, collect the indices (0-based positions
                #      within selected_stores) of all its member stores.
                #   3. Split total quantity equally across districts first
                #      (district_qty = total ÷ num_districts, remainder added
                #       to the first N districts one unit each).
                #   4. Within each district, split that district's share equally
                #      across its member stores (same remainder rule).

                # Build district → [store_index, ...] mapping (ordered)
                district_store_indices = OrderedDict()
                for i, store in enumerate(selected_stores):
                    d = store["district"]
                    if d not in district_store_indices:
                        district_store_indices[d] = []
                    district_store_indices[d].append(i)

                for product in same_order_products:
                    ptype = product["type"]

                    if ptype == "max":
                        # MAX per store — every store gets a max-order entry
                        for i in range(total_stores):
                            store_product_map[i].append({
                                "name": product["name"],
                                "type": "max",
                                "quantity": None,
                            })

                    elif ptype == "same_qty":
                        # Same fixed quantity ordered at every store
                        for i in range(total_stores):
                            store_product_map[i].append({
                                "name": product["name"],
                                "type": "specified",
                                "quantity": product["quantity"],
                            })

                    else:
                        # ── district-based distribute with user-specified targets ──
                        district_qtys = product.get("district_qtys", {})

                        if not district_qtys:
                            # Fallback: shouldn't happen, but skip gracefully
                            self.log_message(f"No district quantities defined for '{product['name']}'. Skipping.")
                            continue

                        # Log the planned distribution
                        self.log_message(
                            f"Distribute '{product['name']}' by district:"
                        )
                        for dname, dqty in district_qtys.items():
                            self.log_message(f"  {dname}: {dqty} units target")

                        # Run the district-level ordering loop for each district.
                        # MULTI-DISTRICT FLOW: after each district's order is
                        # submitted, click the "New Order" button
                        # (MainContent_btnNewOrder) so the next district starts
                        # with a fresh cart. The CRM does not allow mixing
                        # multiple districts in a single cart session.
                        district_items = list(district_qtys.items())
                        num_districts = len(district_items)
                        for d_idx, (dname, d_target) in enumerate(district_items):
                            if self.stop_event.is_set():
                                break
                            if d_target <= 0:
                                self.log_message(f"  {dname}: target is 0, skipping.")
                                continue

                            # Collect the stores in this district (in selected order)
                            d_stores = [s for s in selected_stores if s["district"] == dname]
                            if not d_stores:
                                self.log_message(f"  {dname}: no selected stores for this district.")
                                continue

                            system.process_district_distribute(
                                product_name=product["name"],
                                district_target=d_target,
                                store_list=d_stores,
                                district_name=dname,
                                product_type=active_product_type,
                            )

                            # If more districts remain, finish this order
                            # (submit) and click "New Order" before the next
                            # district gets a clean cart.
                            if d_idx < num_districts - 1 and not self.stop_event.is_set():
                                self.log_message(
                                    f"District '{dname}' complete \u2014 submitting and "
                                    f"clicking 'New Order' before next district."
                                )
                                if system.items_added_to_cart:
                                    if not system.click_submit_button():
                                        self.log_message(
                                            "  Could not submit current district order. "
                                            "Continuing anyway."
                                        )
                                if not system.click_new_order_button():
                                    self.log_message(
                                        "  Could not click 'New Order' before next district. "
                                        "Continuing anyway."
                                    )

                        # After district distribute, skip the normal per-store loop for this product
                        continue

                # ── Process stores grouped by district (submit between districts) ──
                self._process_stores_district_grouped(
                    system,
                    selected_stores,
                    total_stores,
                    active_product_type,
                    lambda i, store: store_product_map[i],
                )

            else:
                # ── Process stores grouped by district (submit between districts) ──
                self._process_stores_district_grouped(
                    system,
                    selected_stores,
                    total_stores,
                    active_product_type,
                    lambda i, store: different_order_products.get(store["account_id"], []),
                )

            if not self.stop_event.is_set():
                system.click_submit_button()
                system.save_xlsx_log()

                self.log_message("=" * 70)
                self.log_message("COMPLETE")
                self.log_message(f"Total units ordered: {system.total_ordered}")
                self.log_message(f"Total cost: ${system.total_cost:,.2f}")
                self.log_message("Browser kept open after submitting orders.")
                self.log_message("=" * 70)
            else:
                self.log_message("Automation stopped by user.")
                self.log_message("Browser kept open.")

        except Exception as e:
            self.log_message(f"Automation error: {e}")

            import traceback
            self.log_message(traceback.format_exc())
            self.log_message("Browser kept open after error.")

        finally:
            # IMPORTANT: Never close Edge here.
            # The old version called system.close() unless submit succeeded.
            # That closed Edge immediately after 2FA when any post-2FA step failed.
            self.log_message("Final step reached. Edge was not closed by the bot.")
            self.after(0, self.reset_run_buttons)

    def _process_stores_district_grouped(self, system, selected_stores,
                                        total_stores, active_product_type,
                                        products_for_store_fn):
        """
        Process the selected stores grouped by district, i.e. add each
        district's stores' items, then submit the district order and click
        'New Order' before moving to the next district, so the CRM never mixes
        multiple districts into a single cart/submit. The raw per-store loop
        previously added ALL districts into ONE cart and submitted once at the
        very end.

        products_for_store_fn(store_index, store) -> list of products for that
        store (kept as a callback because 'same' orders index by position while
        'different' orders index by account_id).
        """
        district_indices = OrderedDict()
        for i, store in enumerate(selected_stores):
            district_indices.setdefault(store["district"], []).append(i)

        districts = list(district_indices.keys())
        for d_idx, dname in enumerate(districts):
            if self.stop_event.is_set():
                break

            idxs = district_indices[dname]
            self.log_message(f"PROCESSING DISTRICT ({dname}): {len(idxs)} store(s)")

            for i in idxs:
                if self.stop_event.is_set():
                    break

                store = selected_stores[i]
                self.update_progress_safe(i, total_stores, store["name"])
                products_for_store = products_for_store_fn(i, store)
                if products_for_store:
                    system.process_single_store_products(
                        store, products_for_store,
                        product_type=active_product_type,
                    )
                self.update_progress_safe(i + 1, total_stores, store["name"])

            # If more districts remain, finish this order (submit) and click
            # 'New Order' before the next district gets a clean cart.
            if d_idx < len(districts) - 1 and not self.stop_event.is_set():
                self.log_message(
                    f"District '{dname}' complete \u2014 submitting and "
                    f"clicking 'New Order' before next district."
                )
                if system.items_added_to_cart:
                    if not system.click_submit_button():
                        self.log_message(
                            "  Could not submit current district order. "
                            "Continuing anyway."
                        )
                if not system.click_new_order_button():
                    self.log_message(
                        "  Could not click 'New Order' before next district. "
                        "Continuing anyway."
                    )

    def update_progress_safe(self, current, total, store_name=""):
        if total <= 0:
            percent = 0
        else:
            percent = (current / total) * 100

        def update():
            self.progress_var.set(percent)

            if store_name:
                self.status_var.set(f"Processing {current}/{total}: {store_name}")
            else:
                self.status_var.set(f"Processing {current}/{total}")

        self.after(0, update)

    def reset_run_buttons(self):
        self.start_button.config(state="normal")
        self.stop_button.config(state="disabled")
        self.continue_2fa_button.config(state="disabled")
        self.status_var.set("Ready.")

    def log_message(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_queue.put(f"[{timestamp}] {message}")

    def flush_log_queue(self):
        try:
            while True:
                message = self.log_queue.get_nowait()
                self.log_text.insert("end", message + "\n")
                self.log_text.see("end")
        except queue.Empty:
            pass

        self.after(150, self.flush_log_queue)

# ============================================================================
# MAIN
# ============================================================================
def _enable_dpi_awareness() -> None:
    """Make Windows report physical pixels so winfo_screen* is accurate on
    high-DPI displays (1080p, 1440p, 2K, 4K, DPI-scaled laptops)."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        # Set AppUserModelID BEFORE any window is created — this is what
        # makes the taskbar show our icon instead of the generic Python icon.
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(1)  # system DPI aware
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

def main():
    # AppUserModelID must be set before any Tk window is created so Windows
    # taskbar shows our icon instead of the generic Python/PyInstaller icon.
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("VidaPay.DeviceOrdering")
    except Exception:
        pass
    _enable_dpi_awareness()
    _vp_enforce_trial()

    # --- 3SVerse license gate: machine-locked activation (before any GUI) ---
    import license_core
    if not license_core.ensure_licensed():
        sys.exit(0)

    # MULTIBROWSER builds: ask which browser to use before the GUI opens
    # (must run on the main thread, before any WebDriver work).
    if ENABLE_BROWSER_SELECT:
        try:
            from browser_helper import select_browser
            global SELECTED_BROWSER
            SELECTED_BROWSER = select_browser() or "edge"
        except Exception:
            SELECTED_BROWSER = "edge"

    app = VidapayGUI()
    app.mainloop()

if __name__ == "__main__":
    main()