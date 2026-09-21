#!/usr/bin/env python3
# ============================================================
#  GFH INVENTORY DASHBOARD  -  FIREBASE UPLOADER v3 (SHEET-AWARE)
# ============================================================
#  Kya karta hai:
#    Aap ki Excel (.xlsx) ya CSV file ke SAARE rows read kar ke
#    dashboard (gfhinventorydashboard.netlify.app) ke Firebase
#    database par upload kar deta hai.
#
#  2 MODES (khud choose karta hai):
#    1) CREDENTIAL MODE (secure): Folder mein agar Firebase ki
#       service-account JSON mili (jaise firebase-credentials.json)
#       to usi se login kar ke upload karta hai.
#       -> Is mode mein chahe Firebase rules lock hon, chalega.
#       -> Credential file SIRF apne paas rakho, kisi ko na do,
#          kabhi chat/email pe paste na karo.
#    2) DIRECT MODE (fallback): Credential na miley to bina login
#       ke upload karta hai (tab tak jab tak rules khule hain).
#
#  Zaroori:
#    - Data 'database' naam ke TAB mein hona chahiye (ya jis sheet ke
#      headers dashboard se match karein - script khud dhoond leti hai).
#    - Us sheet mein 25 columns BILKUL isi order mein hone chahiye.
#    - Upload poora database REPLACE karta hai. Pehli baar
#      RUN_BACKUP.bat zaroor chalao.
#
#  Use:
#    RUN_UPLOAD.bat double-click karo
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
PROJECT_ID = "gfh-inventory-dashboard-6febd"
DATA_NODE = "database"          # dashboard isi node se data uthata hai
SHEET_NAME = "database"         # data isi tab se uthaya jayega; na miley to headers se khud dhoondega
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


def ensure_package(modname, pipname):
    try:
        __import__(modname)
        return True
    except ImportError:
        print(f"[SETUP] {modname} missing hai - install kar raha hoon (internet chahiye, ~20 sec)...")
        try:
            import subprocess
            subprocess.check_call([sys.executable, "-m", "pip", "install", pipname])
            __import__(modname)
            return True
        except Exception as e:
            print(f"[ERROR] {modname} install nahi ho saka: {e}")
            print(f"        Manually: pip install {pipname}")
            return False


def ensure_openpyxl():
    return ensure_package("openpyxl", "openpyxl")


def ensure_firebase_admin():
    return ensure_package("firebase_admin", "firebase-admin")


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
        return v.strip()
    return v


def is_empty_row(row):
    return all(v is None or (isinstance(v, str) and v.strip() == "") for v in row)


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


def norm_first_row(ws, limit=300):
    """Sheet ki pehli row ke normalized (lower/strip) cell values."""
    try:
        for row in ws.iter_rows(min_row=1, max_row=1, max_col=limit, values_only=True):
            return [("" if v is None else str(v).strip().lower()) for v in row]
    except Exception:
        pass
    return []


def pick_sheet(wb):
    """Har sheet ke header row ko EXPECTED_HEADERS se score kar ke
    sab se matching sheet chunta hai. Returns (sheet_title, score)."""
    want_set = {h.lower() for h in EXPECTED_HEADERS}
    best, best_score = None, -1
    for ws in wb.worksheets:
        got = norm_first_row(ws)
        score = sum(1 for c in got if c in want_set)
        if score > best_score:
            best, best_score = ws.title, score
    return best, best_score


def read_xlsx(path):
    if not ensure_openpyxl():
        sys.exit(1)
    from openpyxl import load_workbook
    print(f"[READ] Excel khol raha hoon: {os.path.basename(path)}")
    wb = load_workbook(path, data_only=True, read_only=True)
    sheet_used = None
    if SHEET_NAME:
        for name in wb.sheetnames:
            if name.strip().lower() == SHEET_NAME.strip().lower():
                ws = wb[name]
                sheet_used = name
                break
        if sheet_used is None:
            print(f"[WARN] Sheet '{SHEET_NAME}' nahi mili (Sheets: {wb.sheetnames})")
            print("       Headers se match kar ke khud dhoond raha hoon...")
    if sheet_used is None:
        best, score = pick_sheet(wb)
        if best is None or score < 5:
            print("[ERROR] Koi sheet aisi nahi mili jis ke headers dashboard se match karein.")
            for ws in wb.worksheets:
                sc = sum(1 for c in norm_first_row(ws) if c in {h.lower() for h in EXPECTED_HEADERS})
                print(f"        - '{ws.title}': {sc}/25 headers match")
            wb.close()
            sys.exit(1)
        ws = wb[best]
        sheet_used = best
    print(f"[SHEET] '{sheet_used}' tab se data uthaya jayega.")
    rows = []
    for r in ws.iter_rows(values_only=True):
        rows.append([cell_to_json(v) for v in r])
    wb.close()
    return rows


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
    shown = 0
    for i in range(max(len(want), len(got))):
        w = want[i] if i < len(want) else "(nahi)"
        g = got[i] if i < len(got) else "(nahi)"
        if w != g:
            if shown < 30:
                print(f"    col {i + 1:2d}: dashboard='{w}'  file='{g}'  <-- MISMATCH")
            shown += 1
    if shown > 30:
        print(f"    ... aur {shown - 30} columns mismatch (sirf pehle 30 dikhaye)")
    print("\n    Agar order galat hai to pehle Excel theek karo (columns ka order")
    print("    upar wale se same karo), warna dashboard ghalat figures dikhayega.")
    if not AUTO_CONFIRM:
        ans = input("\n    Phir bhi upload karna hai? (yes / no): ").strip().lower()
        return ans in ("y", "yes")
    return False


def build_payload(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".csv":
        rows = read_csv(path)
    else:
        rows = read_xlsx(path)

    rows = [r for r in rows if not is_empty_row(r)]
    if len(rows) < 2:
        print("[ERROR] File mein header + kam az kam 1 data row hone chahiye.")
        sys.exit(1)

    header, data = rows[0], rows[1:]
    ncols = max(len(header), max((len(r) for r in data), default=0))
    if not check_headers(header):
        print("\n[CANCEL] Upload cancel kar diya. Excel column order theek karo.")
        sys.exit(1)

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


def find_credential():
    """Folder mein Firebase service-account JSON dhundta hai.
       (backup files aur bina private_key wali files ignore)"""
    folder = os.path.dirname(os.path.abspath(__file__))
    for fn in sorted(os.listdir(folder)):
        if not fn.lower().endswith(".json") or fn.startswith("~$"):
            continue
        p = os.path.join(folder, fn)
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "private_key" in data and "client_email" in data:
                return p, data
        except Exception:
            continue
    return None, None


def try_admin_upload(node, payload):
    """Mode 1: service-account credential se secure upload.
       Returns: True (kamyaab), False (fail - fallback banta hai), None (credential nahi mili)"""
    cred_path, cred = find_credential()
    if not cred_path:
        return None
    print(f"[MODE] Credential file mili: {os.path.basename(cred_path)}")
    pid = (cred.get("project_id") or "").strip()
    if pid and pid != PROJECT_ID:
        print(f"[WARN] Credential ka project '{pid}' hai, expected '{PROJECT_ID}' - phir bhi try karta hoon.")
    if not ensure_firebase_admin():
        print("[WARN] firebase-admin install nahi ho saka - direct mode use karunga.")
        return False
    try:
        import firebase_admin
        from firebase_admin import credentials as fbcred
        from firebase_admin import db as fdb
        if not firebase_admin._apps:
            firebase_admin.initialize_app(
                fbcred.Certificate(cred_path),
                {"databaseURL": FIREBASE_DB_URL},
            )
        print("[UPLOAD] Credential se bhej raha hoon... (11 MB tak lag sakta hai, tab mat band karna)")
        t0 = time.time()
        fdb.reference(node).set(payload)
        print(f"[OK] Upload ho gaya! (credential mode, {time.time() - t0:.0f} sec)")
        return True
    except Exception as e:
        print(f"[WARN] Credential se upload fail: {str(e)[:200]}")
        print("       Direct method se try karta hoon...")
        return False


def upload(payload, dry_run=False, node=DATA_NODE):
    url = f"{FIREBASE_DB_URL}/{node}.json"
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

    admin_ok = try_admin_upload(node, payload)
    if admin_ok is True:
        print("\n  Dashboard kholo aur refresh karo:  https://gfhinventorydashboard.netlify.app")
        return
    if admin_ok is None:
        print("[MODE] Credential file nahi mili - direct method (bina login).")

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
        if status in (401, 403):
            print("        Rules ne mana kiya: credential file folder mein rakho")
            print("        (Firebase Console > Project settings > Service accounts > Generate new private key)")


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
    global AUTO_CONFIRM
    args = sys.argv[1:]
    print("=" * 58)
    print("   GFH INVENTORY DASHBOARD  -  FIREBASE UPLOADER v3")
    print("=" * 58)

    if "--backup" in args:
        backup()
        return

    node = DATA_NODE
    if "--node" in args:                       # hidden: testing only
        i = args.index("--node")
        node = args[i + 1]
        args = args[:i] + args[i + 2:]

    dry = "--dry-run" in args
    if "--yes" in args:
        AUTO_CONFIRM = True

    files = [a for a in args if not a.startswith("--")]

    if not files:
        latest = find_latest_file(os.path.dirname(os.path.abspath(__file__)))
        if latest is None:
            print("\nIs folder mein koi .xlsx / .csv file nahi mili.")
            print("Upload karne ke liye apni Excel file ka path likho:")
            p = input("   Path: ").strip().strip('"')
            if not p or not os.path.exists(p):
                print("[CANCEL] File nahi mili.")
                return
            files = [p]
        else:
            print(f"\n[FOUND] Sab se nayi file: {os.path.basename(latest)}")
            print("        (Backup ke liye RUN_BACKUP.bat use karo)")
            files = [latest]

    path = files[0]
    if not os.path.exists(path):
        print(f"[ERROR] File nahi mili: {path}")
        return

    print(f"\n[STEP 1/2] File read + check kar raha hoon...")
    payload = build_payload(path)
    print("[STEP 2/2] Ready.")
    upload(payload, dry_run=dry, node=node)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[CANCEL] Band kar diya.")
