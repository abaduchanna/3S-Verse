GFH INVENTORY DASHBOARD - FIREBASE UPLOADER v3.8 (MULTI-CREDENTIAL AUTH + ZERO-PROMPT)
======================================================================================

NAYA (v3.8): AAP KI WAALI FILE AB CHALTI HAI (Google OAuth CLIENT FILE)
------------------------------------------------------------------------
- Wo credential.json jo Google Cloud Console se milti hai
  ({"installed": {client_id, client_secret, auth_uri, ...}} - OAuth 2.0
  Client ID / gcloud client-secret) ab SUPPORTED hai.
- Pehli baar: browser khulega -> Google account chuno -> 'Allow' dabao
  (SIRF EK DAFA). Token credential_user.json me save ho jata hai.
- Agli baar: browser NAHI khulega - seedha upload.
- Agar OAuth login me issue aaye to BEST option wahi hai:
  Firebase Console > gear > Project settings > Service accounts >
  Generate new private key -> credential.json (2 min, kabhi expire
  nahi hoti, browser login ki zaroorat nahi).

NAYA (v3.7b): CREDENTIAL GHAR DHUND LIYA - DATABASE WALA FOLDER SHAMIL
----------------------------------------------------------------------
- credential.json ab us folder me bhi dhundta hai JAHAN 'gfh
  database.xlsx' padi hai (Desktop / Downloads / Documents ke andar,
  2 level tak). Aap ka setup - credential file database ke sath -
  ab directly chalta hai. Drag & drop par file jis folder me ho,
  wo folder bhi check hota hai.
- Na mili to ERROR me print hota hai ke KAHAN KAHAN dekha.
- RUN_UPLOAD.bat / RUN_BACKUP.bat ab English me hain.

KOI AUR FILE NAHI CHAHIYE
-------------------------
- Sirf EK file chahiye: credential.json (service-account key).
- Koi OAuth file nahi, client_secret nahi, token.json nahi,
  gcloud login nahi - kuch nahi. Service-account key ke andar
  private_key hoti hai, token khud banta hai.
- Firebase Console > Project settings > Service accounts >
  Generate new private key > JSON download = wahi credential.json.

NAYA (v3.7): CREDENTIAL KA TYPE KHUD PEHCHANTA HAI + 401 KA PAKKA ILAAJ
-----------------------------------------------------------------------
- Ab TEEN credential types support hain. Jo bhi file mile, us ke
  andar ki keys se type detect hota hai (aur print bhi hota hai):
    1. Firebase SERVICE-ACCOUNT key (private_key + client_email)
       -> RSA JWT se Google access token. PURE Python - koi extra
       install NAHI (sirf openpyxl pehle jaisa hi).
    2. Google ADC / gcloud credential (refresh_token + client_id +
       client_secret) -> refresh flow se access token.
    3. Firebase WEB CONFIG (apiKey) -> anonymous sign-in.
       Ye tab chalega jab Firebase Console > Authentication >
       Sign-in method > Anonymous ON ho.
  credentials.json / credential.json / .txt variants / Notepad wali
  (BOM/UTF-16/ANSI) - sab chalti hain. Desktop/Downloads/Documents
  + subfolders (2 level) bhi dhoondta hai. Milti hai to copy isi
  folder mein credential.json naam se bana deta hai.
- 401/403 par 3 dafa bekaar retry KAHTAM - ab foran saaf wajah +
  FIX print hota hai (seconds bachte hain, circus nahi).
- Upload ab SINGLE PUT hai (poora array ek saath) - dashboard isi
  shape ko parhta hai (header + rows wala array). Purane chunked
  shape ka masla khatam.
- Pehli baar chalao to RUN_BACKUP.bat zaroor chalao (safety copy).

NAYA (v3.6): CREDENTIAL PAKKA MILEGI + SCAN CIRCUS KHATAM
---------------------------------------------------------
- credential.json 5 jagah dhoondti hai: is folder, Desktop,
  Downloads, Documents (+ .txt variants). Mili to copy isi folder
  mein bhi bana deta hai (agle run instant).
- File pick: pichli baar jo file upload hui thi, agli baar WAHI
  file seedha uthayega (LAST_UPLOAD.txt) - 23 files ka score-circus
  khatam. Pehli baar 'gfh database.xlsx' seedha pick hogi.

NAYA (v3.5): KOI SAWAL HI NAHI
------------------------------
- ENTER / yes-no / confirm ka sawal poori tarah hata diya gaya hai.
- File mili -> foran purana data clear -> naya upload. Bas.
- Auto-pick sakht hai: sirf wo file jis ke headers 25 mein se 15+
  match karte hain. Ghalat file kabhi auto-upload nahi hogi.

SHEET (TAB) KA RULE
-------------------
- Data 'database' NAAM ke tab mein hona chahiye.
- Tab ka naam kuch aur ho to bhi script headers se sahi tab khud
  dhoond legi.

COLUMNS KA ORDER FARAK NAHI PARTA
---------------------------------
Script columns ko NAAM se pehchanti hai: file mein order kuch bhi ho,
data dashboard ke sahi column mein jata hai.
  - Jo dashboard columns file mein nahi hote: khaali jate hain
  - File ke extra columns: drop (report print hoti hai)
  - Header ke naam sahi hon, bas (spacing/capital farak nahi parta)

2 MODES (v3.7 mein ek hi engine)
--------------------------------
CREDENTIAL MODE: koi bhi supported credential file mili to
authenticated upload (DELETE + PUT with token). Rules LOCK hon tab
bhi chalta hai (service-account key owner access deti hai).

Agar koi supported credential NAHI mili to script UPLOAD ROAK deta
hai - bina auth 401 hi aata, data corrupt nahi hota, aur saaf FIX
instructions print hoti hain:
  FIX (2 min): Firebase Console > gear icon > Project settings >
  Service accounts > Generate new private key > JSON download >
  'credential.json' naam se is folder mein save karo.

CREDENTIAL FILE KA KHYAL RAKHNA (BOHAT ZAROORI)
-----------------------------------------------
- Ye file aap ke Firebase project ki MASTER KEY hai.
- Kisi ko na do, email/chat/WhatsApp pe paste na karo,
  GitHub ya kisi aur jagah upload NAHI karna.
- Sirf apne PC par is folder mein rakhi ho, bas.
- Agar kabhi leak ho jaye: Firebase Console > Project settings >
  Service accounts > purani key delete kar do, nayi bana lo.

ISTEMAL (2 tarike)
------------------
1) 'gfh database.xlsx' is folder mein rakho -> RUN_UPLOAD.bat par
   double-click karo -> bas (koi ENTER / sawal nahi)
2) Ya Excel file ko pakad kar RUN_UPLOAD.bat par DRAG & DROP karo

PEHLI DAFA
----------
- openpyxl khud install ho jayega (internet chahiye, ~20 sec, sirf
  pehli dafa). firebase-admin ki AB ZAROORAT NAHI (v3.7 pure REST +
  pure-Python RSA use karta hai).
- Backup: RUN_BACKUP.bat double-click karo - current dashboard ka
  poora data JSON file mein save hota hai (authenticated download).

ZAROORI BAATEIN
---------------
- Upload POORA database REPLACE karta hai. Purana data hat kar
  aap ki file ka data aa jata hai. File mein HAMESHA poora data
  hona chahiye (purana + naya sab).
- Upload ke baad dashboard kholo aur refresh karo.

TEST (bina upload ke)
---------------------
python GFH_Inventory_Upload.py meri-file.xlsx --dry-run
Ye sirf preview dikhata hai, kuch upload nahi hota.
