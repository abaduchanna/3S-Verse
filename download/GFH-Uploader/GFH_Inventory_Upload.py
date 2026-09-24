#!/usr/bin/env python3
# ============================================================
#  GFH INVENTORY DASHBOARD  -  FIREBASE UPLOADER v3.3 (AUTO-MAP + CLEAR + CHUNKED)
# ============================================================
#  Kya karta hai:
#    Aap ki Excel (.xlsx) ya CSV file ke SAARE rows read kar ke
#    dashboard (gfhinventorydashboard.netlify.app) ke Firebase
#    database par upload kar deta hai.
#
#  2 MODES (khud choose karta hai):
#    1) CREDENTIAL MODE (secure): Folder mein agar Firebase ki
#       service-account JSON mili (naam: credential.json - bas itna
#       hi naam kaafi hai, lamba naam ki zaroorat nahi)
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
#    - Columns ka ORDER ab farak nahi parta: script columns ko NAAM
#      se pehchan kar dashboard ke order mein khud set karti hai.
#      Missing columns khaali jati hain, extra drop (report ke sath).
#    - Upload pehle PURANA DATA CLEAR karta hai, phir naya data
#      chhote-chhote chunks mein charhta hai (badi files par bhi
#      size/timeout error nahi aata). Pehli baar RUN_BACKUP.bat
#      zaroor chalao.
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
CHUNK_ROWS = 400                # ek request mein itne rows jate hain (size-limit safe)
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


def map_columns(header, data):
    """File columns ko dashboard ke 25-column order mein NAAM se map karta hai.
    - Order kuch bhi ho, data sahi jagah jata hai (naam match hona chahiye).
    - Jo dashboard columns file mein nahi wo khaali (None) jate hain.
    - File ke extra columns drop hote hain (report mein dikhte hain).
    Returns: (payload, matched_count, missing, extra)"""
    norm = lambda x: ("" if x is None else str(x).strip().lower())
    got = [norm(h) for h in header]
    want = [h.lower() for h in EXPECTED_HEADERS]
    want_set = set(want)

    index_by_name = {}
    for i, g in enumerate(got):
        if g and g not in index_by_name:
            index_by_name[g] = i

    matched = [w for w in want if w in index_by_name]
    missing = [w for w in want if w not in index_by_name]
    extra, seen = [], set()
    for g in got:
        if g and g not in want_set and g not in seen:
            extra.append(g)
            seen.add(g)

    ncols = len(header)
    mapped = []
    for r in data:
        r = list(r[:ncols]) + [None] * (ncols - len(r))
        mapped.append([r[index_by_name[w]] if w in index_by_name else None for w in want])

    payload = [list(EXPECTED_HEADERS)] + mapped
    return payload, len(matched), missing, extra


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

    print("[MAP] Columns ko naam se dashboard ke order mein set kar raha hoon...")
    payload, nmatch, missing, extra = map_columns(header, data)

    if nmatch < 5:
        print(f"[ERROR] File ke headers dashboard se match nahi karte (sirf {nmatch}/25 mile).")
        print("        Ye shayad dashboard wali data file nahi hai.")
        fl = ", ".join(str(h) for h in header if h is not None)
        print(f"        File ke headers the: {fl[:300]}")
        sys.exit(1)

    print(f"[MAP] {nmatch}/25 columns file se map ho gaye.")
    if missing:
        ml = ", ".join(missing)
        print(f"      File mein nahi the ({len(missing)}) - khaali jayengi: {ml[:220]}{'...' if len(ml) > 220 else ''}")
    if extra:
        el = ", ".join(extra)
        print(f"      Extra drop hui ({len(extra)}): {el[:220]}{'...' if len(el) > 220 else ''}")
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


def fb_clear(node):
    """STEP A: purana data poora delete (node -> null)."""
    url = f"{FIREBASE_DB_URL}/{node}.json"
    status, resp = fb_request(url, method="DELETE")
    if status != 200:
        raise RuntimeError(f"Clear (DELETE) fail: HTTP {status} {str(resp)[:200]}")


def fb_put_chunks(payload, node):
    """STEP B: payload (header + rows) ko chhote chunks mein
    node/{start_index} par likhta hai. Keys 0..N contiguous hone se
    Firebase use wapis ARRAY ki tarah serve karta hai - dashboard
    ko farak nahi parta."""
    total = len(payload)
    n_chunks = (total + CHUNK_ROWS - 1) // CHUNK_ROWS
    t0 = time.time()
    for c in range(n_chunks):
        start = c * CHUNK_ROWS
        end = min(start + CHUNK_ROWS, total)
        url = f"{FIREBASE_DB_URL}/{node}/{start}.json"
        status, resp = fb_request(url, method="PUT", payload=payload[start:end])
        if status != 200:
            raise RuntimeError(
                f"Chunk {c + 1}/{n_chunks} (rows {start:,}-{end - 1:,}) fail: "
                f"HTTP {status} {str(resp)[:200]}")
        print(f"    [UPLOAD] {end:,}/{total:,} rows (chunk {c + 1}/{n_chunks})")
    print(f"    [UPLOAD] Sab chunks bhej diye ({time.time() - t0:.0f} sec)")


def fb_verify(node):
    """Shallow GET se sirf row-keys ginti hai (poora data download kiye bagair).
    Returns: (ok, count)"""
    url = f"{FIREBASE_DB_URL}/{node}.json?shallow=true"
    status, data = fb_request(url)
    if status != 200:
        return False, -1
    if isinstance(data, dict):
        return True, len(data)
    if data is None:
        return True, 0
    return False, -1


def find_credential():
    """Folder mein Firebase service-account JSON dhundta hai.
       STEP 1: credential.json (exact naam - chhota naam kaafi hai)
       STEP 2: baaki .json files (backup/temp files ignore)
       Notepad se save hui files (BOM / UTF-16 / ANSI) bhi read hoti hain.
       Returns: (path, data, issue)
         - path+data : credential mili
         - issue     : file mili thi par valid service-account key NAHI (wajah ke sath)
         - teeno None: folder mein koi credential nahi"""
    folder = os.path.dirname(os.path.abspath(__file__))

    def load_json(p):
        last_err = None
        for enc in ("utf-8-sig", "utf-16", "cp1252"):
            try:
                with open(p, "r", encoding=enc) as f:
                    return json.load(f), None
            except Exception as e:
                last_err = e
                continue
        return None, last_err

    def is_service_account(d):
        return (isinstance(d, dict)
                and str(d.get("private_key") or "").strip() != ""
                and str(d.get("client_email") or "").strip() != "")

    def check_file(p):
        data, err = load_json(p)
        if is_service_account(data):
            return data, None
        if isinstance(data, dict):
            missing = [k for k in ("private_key", "client_email")
                       if not str(data.get(k) or "").strip()]
            return None, (f"{os.path.basename(p)} mili thi lekin ye Firebase "
                          f"service-account key nahi lagti (missing/corrupt: "
                          f"{', '.join(missing) if missing else 'private_key khali hai'})")
        return None, (f"{os.path.basename(p)} mili thi lekin read nahi ho saki "
                      f"(sahi JSON nahi hai: {str(err)[:100]})")

    # STEP 1: user ka standard naam - credential.json
    p = os.path.join(folder, "credential.json")
    if os.path.isfile(p):
        data, issue = check_file(p)
        if data is not None:
            return p, data, None
        return None, None, issue

    # STEP 2: folder ki doosri .json files (alphabetical)
    for fn in sorted(os.listdir(folder)):
        if not fn.lower().endswith(".json") or fn.startswith("~$"):
            continue
        p2 = os.path.join(folder, fn)
        data, issue = check_file(p2)
        if data is not None:
            return p2, data, None
    return None, None, None


def try_admin_upload(node, payload):
    """Mode 1: service-account credential se secure upload.
       Returns: (True, None) kamyaab | (False, None) fail -> fallback
                | (None, issue) credential nahi mili (issue = wajah ya None)"""
    cred_path, cred, cred_issue = find_credential()
    if not cred_path:
        return None, cred_issue
    print(f"[MODE] Credential file mili: {os.path.basename(cred_path)}")
    pid = (cred.get("project_id") or "").strip()
    if pid and pid != PROJECT_ID:
        print(f"[WARN] Credential ka project '{pid}' hai, expected '{PROJECT_ID}' - phir bhi try karta hoon.")
    if not ensure_firebase_admin():
        print("[WARN] firebase-admin install nahi ho saka - direct mode use karunga.")
        return False, None
    try:
        import firebase_admin
        from firebase_admin import credentials as fbcred
        from firebase_admin import db as fdb
        if not firebase_admin._apps:
            firebase_admin.initialize_app(
                fbcred.Certificate(cred_path),
                {"databaseURL": FIREBASE_DB_URL},
            )
        print("[CLEAR] Purana data hata raha hoon (credential mode)...")
        fdb.reference(node).delete()
        print("[OK] Purana data clear ho gaya.")
        total = len(payload)
        n_chunks = (total + CHUNK_ROWS - 1) // CHUNK_ROWS
        t0 = time.time()
        for c in range(n_chunks):
            start = c * CHUNK_ROWS
            end = min(start + CHUNK_ROWS, total)
            fdb.reference(f"{node}/{start}").set(payload[start:end])
            print(f"    [UPLOAD] {end:,}/{total:,} rows (chunk {c + 1}/{n_chunks})")
        got = fdb.reference(node).get(shallow=True)
        count = len(got) if isinstance(got, dict) else -1
        if count == total:
            print(f"[OK] Upload ho gaya + verify: {count:,} rows (credential mode, {time.time() - t0:.0f} sec)")
            return True, None
        print(f"[WARN] Credential mode verify fail: expected {total:,}, mila {count:,}")
        print("       Direct method se dobara poora try karta hoon...")
        return False, None
    except Exception as e:
        print(f"[WARN] Credential se upload fail: {str(e)[:200]}")
        print("       Direct method se try karta hoon...")
        return False, None


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
        print("\n  YAAD RAHE: Purana data DELETE ho kar aap ki file ka data aayega.")
        input("  Upload shuru karne ke liye ENTER dabao (cancel = Ctrl+C): ")

    admin_ok, cred_issue = try_admin_upload(node, payload)
    if admin_ok is True:
        print("\n  Dashboard kholo aur refresh karo:  https://gfhinventorydashboard.netlify.app")
        return
    if admin_ok is None:
        if cred_issue:
            print(f"[MODE] {cred_issue}")
            print("[MODE] Direct method use kar raha hoon (bina login).")
        else:
            print("[MODE] Credential file nahi mili - direct method (bina login).")

    try:
        print(f"[STEP A] Purana data clear kar raha hoon ({node} node delete)...")
        fb_clear(node)
        print("[OK] Purana data clear ho gaya.")
        print(f"[STEP B] Naya data chunks mein charha raha hoon ({CHUNK_ROWS} rows/chunk)...")
        fb_put_chunks(payload, node)
    except RuntimeError as e:
        print(f"\n[ERROR] Upload beech mein fail hua: {str(e)[:300]}")
        print("        Dobara RUN_UPLOAD.bat chalao - wo pehle clear kar ke poora dobara charhega.")
        if "HTTP 401" in str(e) or "HTTP 403" in str(e):
            print("        Rules ne mana kiya: credential file folder mein rakho")
            print("        (Firebase Console > Project settings > Service accounts > Generate new private key)")
        return

    total = len(payload)
    vok, count = fb_verify(node)
    if vok and count == total:
        print(f"\n[OK] Upload complete + verify: {count:,} rows (header samet).")
        print("\n  Dashboard kholo aur refresh karo:  https://gfhinventorydashboard.netlify.app")
    elif vok:
        print(f"\n[WARN] Verify: expected {total:,} rows, Firebase par {count:,} mile.")
        print("       Dobara RUN_UPLOAD.bat chalao - pehle clear kar ke poora dobara charhega.")
    else:
        print("\n[WARN] Verify nahi ho saka (shallow GET fail). Dashboard refresh kar ke check karo.")


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
    print("   GFH INVENTORY DASHBOARD  -  FIREBASE UPLOADER v3.3")
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
