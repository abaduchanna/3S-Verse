#!/usr/bin/env python3
# ============================================================
#  GFH INVENTORY DASHBOARD  -  FIREBASE UPLOADER (REBUILT)
# ============================================================
#  Kya karta hai:
#    Aap ki Excel (.xlsx) ya CSV file ke SAARE rows read kar ke
#    dashboard (gfhinventorydashboard.netlify.app) ke Firebase
#    database par upload kar deta hai.
#
#  Zaroori:
#    - Excel mein 25 columns BILKUL isi order mein hone chahiye
#      (order neeche EXPECTED_HEADERS mein likha hai).
#    - Upload poora database REPLACE karta hai (purana data delete
#      ho kar nayi file ka data aata hai). Is liye pehli baar
#      "Backup" option zaroor chalao.
#
#  Use:
#    RUN_UPLOAD.bat double-click karo  (ya: python GFH_Inventory_Upload.py)
#    Ya Excel file ko is .bat par drag & drop kar do.
# ============================================================

import json
import os
import sys
import csv
import time
import datetime

# ------------------------- CONFIG ---------------------------
FIREBASE_DB_URL = "https://gfh-inventory-dashboard-6febd-default-rtdb.firebaseio.com"
DATA_NODE = "database"          # dashboard isi node se data uthata hai
SHEET_NAME = ""                 # khali = pehli sheet; naam likho to wohi sheet
AUTO_CONFIRM = False            # True kar do to upload se pehle na puche
# ------------------------------------------------------------

EXPECTED_HEADERS = [
    "District", "Store name", "Date", "Order details", "Product description",
    "ESN number", "Tracking number", "Tracking status", "Cost", "Due date",
    "Payment due status", "Stock status", "Ext Price", "Expected Commission",
    "ER Exp Comm", "Rebate", "SP Exp Comm", "1st Month Spiff",
    "Rebate variance", "Spiff Variance", "Device missing status",
    "Device sale location", "Device sale date", "Device sold by",
    "External Order ID",
]

LINE = "-" * 58


def ensure_openpyxl():
    """xlsx support ke liye openpyxl (pehli dafa khud install ho jata hai)."""
    try:
        import openpyxl  # noqa
        return True
    except ImportError:
        print("[SETUP] openpyxl missing hai - install kar raha hoon (internet chahiye, ~10 sec)...")
        try:
            import subprocess
            subprocess.check_call([sys.executable, "-m", "pip", "install", "openpyxl"])
            import openpyxl  # noqa
            return True
        except Exception as e:
            print(f"[ERROR] openpyxl install nahi ho saka: {e}")
            print("        Manually: pip install openpyxl")
            return False


def cell_to_json(v):
    """Excel cell ko Firebase-friendly JSON value banata hai."""
    if v is None:
        return None
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%dT%H:%M:%S.000")
    if isinstance(v, datetime.date):
        return v.strftime("%Y-%m-%dT00:00:00.000")
    if isinstance(v, datetime.time):
        return v.strftime("%H:%M:%S")
    if isinstance(v, float):
        if v != v or v in (float("inf"), float("-inf")):   # NaN / inf
            return None
        return v
    if isinstance(v, str):
        s = v.strip()
        return s
    return v


def is_empty_row(row):
    return all(v is None or (isinstance(v, str) and v.strip() == "") for v in row)


def read_xlsx(path):
    if not ensure_openpyxl():
        sys.exit(1)
    from openpyxl import load_workbook
    print(f"[READ] Excel khol raha hoon: {os.path.basename(path)}")
    wb = load_workbook(path, data_only=True, read_only=True)
    if SHEET_NAME:
        if SHEET_NAME not in wb.sheetnames:
            print(f"[ERROR] Sheet '{SHEET_NAME}' nahi mili. Sheets: {wb.sheetnames}")
            sys.exit(1)
        ws = wb[SHEET_NAME]
    else:
        ws = wb.worksheets[0]
    rows = []
    for r in ws.iter_rows(values_only=True):
        rows.append([cell_to_json(v) for v in r])
    wb.close()
    return rows


def to_number(s):
    """CSV text value ko number banata hai agar number jaisa lage."""
    if s is None:
        return None
    t = str(s).strip()
    if not t:
        return ""
    try:
        f = float(t)
        if f.is_integer() and "." not in t and "e" not in t.lower():
            return int(t)
        return f
    except ValueError:
        return t


def read_csv(path):
    print(f"[READ] CSV khol raha hoon: {os.path.basename(path)}")
    rows = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        for raw in csv.reader(f):
            rows.append([cell_to_json(to_number(v)) for v in raw])
    return rows


def check_headers(header):
    """Column order verify - galat order par data dashboard mein ghalat jagah jata."""
    norm = lambda x: ("" if x is None else str(x).strip().lower())
    got = [norm(h) for h in header]
    want = [h.lower() for h in EXPECTED_HEADERS]
    if got[:len(want)] == want:
        return True
    print("\n[WARNING] Column order EXPECTED se match nahi kar raha!")
    print(f"    Expected columns: {len(want)} | File mein mile: {len(got)}")
    for i in range(max(len(want), len(got))):
        w = want[i] if i < len(want) else "(nahi)"
        g = got[i] if i < len(got) else "(nahi)"
        mark = "  <-- MISMATCH" if w != g else ""
        print(f"    col {i + 1:2d}: dashboard='{w}'  file='{g}'{mark}")
    print("\n    Agar order galat hai to pehle Excel theek karo (columns ka order")
    print("    upar wale se same karo), warna dashboard ghalat figures dikhayega.")
    if not AUTO_CONFIRM:
        ans = input("\n    Phir bhi upload karna hai? (yes / no): ").strip().lower()
        return ans == "yes"
    return False


def build_payload(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".csv":
        rows = read_csv(path)
    else:
        rows = read_xlsx(path)

    # Empty rows hatao
    rows = [r for r in rows if not is_empty_row(r)]
    if len(rows) < 2:
        print("[ERROR] File mein header + kam az kam 1 data row hone chahiye.")
        sys.exit(1)

    header, data = rows[0], rows[1:]
    # Trailing empty columns trim (agar header chhota ho)
    ncols = max(len(header), max((len(r) for r in data), default=0))
    if not check_headers(header):
        print("\n[CANCEL] Upload cancel kar diya. Excel column order theek karo.")
        sys.exit(1)

    # Sab rows ko same length par le aao (Firebase arrays ke liye safe)
    fixed = []
    for r in data:
        r = list(r[:ncols]) + [None] * (ncols - len(r))
        fixed.append(r)

    payload = [list(header[:ncols]) + [None] * (ncols - len(header))] + fixed
    return payload


def fb_request(url, method="GET", payload=None, timeout=600):
    """Firebase REST call with 3 retries."""
    import urllib.request
    import urllib.error
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    last_err = None
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                try:
                    return resp.status, json.loads(body) if body else None
                except Exception:
                    return resp.status, body
        except Exception as e:
            last_err = e
            if attempt < 3:
                print(f"    Network error ({e}) - retry {attempt}/3, 5 sec ruk kar...")
                time.sleep(5)
    raise RuntimeError(f"Firebase {method} fail ho gaya: {last_err}")


def upload(payload, dry_run=False):
    url = f"{FIREBASE_DB_URL}/{DATA_NODE}.json"
    size_mb = len(json.dumps(payload, ensure_ascii=False, separators=(",", ":"))) / 1024 / 1024
    n_rows = len(payload) - 1
    print(LINE)
    print(f"  File data   : {n_rows:,} data rows, {len(payload[0])} columns")
    print(f"  Upload size : {size_mb:.1f} MB")
    print(f"  Destination : {url}")
    print(LINE)

    if dry_run:
        print("[DRY-RUN] Upload NAHI hua - sirf preview. First data row:")
        print("  " + json.dumps(payload[1], ensure_ascii=False)[:500])
        return

    if not AUTO_CONFIRM:
        print("\n  YAAD RAHE: Upload poore dashboard ka data REPLACE kar dega.")
        input("  Upload shuru karne ke liye ENTER dabao (cancel = Ctrl+C): ")

    print("[UPLOAD] Data bhej raha hoon... (11 MB tak lag sakta hai, tab mat band karna)")
    t0 = time.time()
    status, resp = fb_request(url, method="PUT", payload=payload)
    dt = time.time() - t0

    if status == 200:
        got = len(resp) - 1 if isinstance(resp, list) else -1
        print(f"[OK] Upload ho gaya! HTTP 200, {dt:.0f} sec")
        if got >= 0:
            print(f"[OK] Firebase ne confirm kiya: {got:,} rows save hue.")
        print("\n  Dashboard kholo aur refresh karo:  https://gfhinventorydashboard.netlify.app")
    else:
        print(f"[ERROR] HTTP {status} - upload fail. Response: {str(resp)[:300]}")


def backup():
    url = f"{FIREBASE_DB_URL}/{DATA_NODE}.json"
    print("[BACKUP] Current dashboard data download kar raha hoon...")
    status, data = fb_request(url)
    if status != 200 or data is None:
        print(f"[ERROR] HTTP {status} - backup fail.")
        return
    rows = data if isinstance(data, list) else list(data.values())
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M")
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), f"GFH_backup_{ts}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[OK] Backup save hua: {os.path.basename(out)}  ({len(rows):,} rows)")
    print("     Ye file upload ke liye bhi use kar sakte ho (safety copy).")


def find_latest_file(folder):
    """Folder ki newest .xlsx / .csv (Excel temp ~$ files skip)."""
    cands = []
    for fn in os.listdir(folder):
        if fn.startswith("~$"):
            continue
        if fn.lower().endswith((".xlsx", ".csv")):
            p = os.path.join(folder, fn)
            cands.append((os.path.getmtime(p), p))
    if not cands:
        return None
    return sorted(cands)[-1][1]


def main():
    args = sys.argv[1:]
    print("=" * 58)
    print("   GFH INVENTORY DASHBOARD  -  FIREBASE UPLOADER")
    print("=" * 58)

    if "--backup" in args:
        backup()
        return

    dry = "--dry-run" in args
    files = [a for a in args if not a.startswith("--")]

    if not files:
        latest = find_latest_file(os.path.dirname(os.path.abspath(__file__)))
        if latest is None:
            print("\nIs folder mein koi .xlsx / .csv file nahi mili.")
            print("1) Upload karne ke liye apni Excel file YAHAN drag & drop karo aur ENTER:")
            p = input("   Path: ").strip().strip('"')
            if not p or not os.path.exists(p):
                print("[CANCEL] File nahi mili.")
                return
            files = [p]
        else:
            print(f"\n[FOUND] Sab se nayi file: {os.path.basename(latest)}")
            print("        (Backup ke liye RUN_UPLOAD_BACKUP.bat use karo)")
            files = [latest]

    path = files[0]
    if not os.path.exists(path):
        print(f"[ERROR] File nahi mili: {path}")
        return

    print(f"\n[STEP 1/2] File read + check kar raha hoon...")
    payload = build_payload(path)
    print("[STEP 2/2] Ready.")
    upload(payload, dry_run=dry)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[CANCEL] Band kar diya.")
