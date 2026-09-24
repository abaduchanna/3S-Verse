GFH INVENTORY DASHBOARD - FIREBASE UPLOADER v3.5 (ZERO-PROMPT + AUTO-PICK + AUTO-MAP + CHUNKED)
=================================================================================

NAYA (v3.5): KOI SAWAL HI NAHI
------------------------------
- ENTER / yes-no / confirm ka sawal poori tarah hata diya gaya hai.
- File mili -> foran purana data clear -> naya upload. Bas.
- 'gfh database.xlsx' (tab: database, 25 columns) bilkul seedha
  chalti hai - isi file ke liye ye script bani hai.
- Auto-pick ab sakht hai: sirf wo file uthati hai jis ke headers
  25 mein se kam az kam 15 match karte hain. Rebate filing jaisi
  report (~13 match) jaan boojh kar REFUSE hoti hai - ghalat file
  kabhi auto-upload nahi hogi.

Ye wo file hai jo lost ho gayi thi. Ye aap ki Excel/CSV data
padh kar dashboard (gfhinventorydashboard.netlify.app) par
upload kar deti hai.

SHEET (TAB) KA RULE (v3 naya)
-----------------------------
- Data 'database' NAAM ke tab mein hona chahiye.
- Agar tab ka naam kuch aur hai, to bhi ghabrao nahi: script har
  sheet ke headers dashboard se match kar ke sahi tab khud dhoond
  legi (chuney par [SHEET] line mein naam dikha degi).
- Jo sheet aap khol kar dikhti hai (Dashboard/Summary wali) us se
  data NAHI uthaya jayega - sirf data wala tab.

NAYA (v3.3): COLUMNS KA ORDER AB FARAK NAHI PARTA
-------------------------------------------------
Script columns ko NAAM se pehchanti hai: file mein order kuch bhi ho,
data dashboard ke sahi column mein jata hai.
  - Jo dashboard columns file mein nahi hote: khaali jate hain
  - File ke extra columns: drop (report print hoti hai)
  - Header ke naam sahi hon, bas (spacing/capital farak nahi parta)

NAYA (v3.2): UPLOAD KA TARIKA
-----------------------------
Pehle script poora data EK saath bhejta tha - badi files (~11 MB)
par Firebase error de deta tha.

Ab flow ye hai:
  MAP    : Columns naam se dashboard ke order mein set
  STEP A : Purana data poora CLEAR (delete) hota hai
  STEP B : Naya data chhote-chhote CHUNKS mein (400 rows per
           request) charhta hai - size/timeout error khatam
  VERIFY : Aakhir mein Firebase se rows count check hota hai

Is liye ab badi Excel files par bhi upload error nahi aayega.
Agar beech mein network fail bhi ho jaye to dobara RUN_UPLOAD.bat
chalao - wo pehle clear kar ke poora dobara charh dega.

2 MODES (script khud choose karta hai)
--------------------------------------
1) CREDENTIAL MODE (secure):
   Firebase credential JSON file isi folder mein rakho.
   NAAM: credential.json - bas itna hi naam kaafi hai,
   lamba naam banane ki zaroorat nahi.
   Script khud dhundh kar usi se login kar ke upload karegi.
   (Notepad se save hui file bhi chalegi - BOM/encoding khud
   handle ho jata hai.)
   Agar file mili par valid nahi (koi cheez missing hai), to
   script saaf bata degi ki masla kya hai - chup-chaap skip
   nahi karegi.
   Fayda: Firebase rules LOCK hon tab bhi chalega.

2) DIRECT MODE (fallback):
   Credential file na miley to bina login upload karega
   (tab tak chalega jab tak database rules khule hain).

CREDENTIAL FILE KA KHYAL RAKHNA (BOHAT ZAROORI)
----------------------------------------------
- Ye file aap ke Firebase project ki MASTER KEY hai.
- Kisi ko na do, email/chat/WhatsApp pe paste na karo,
  GitHub ya kisi aur jagah upload NAHI karna.
- Sirf apne PC par is folder mein rakhi ho, bas.
- Agar kabhi leak ho jaye: Firebase Console > Project settings >
  Service accounts > purani key delete kar do, nayi bana lo.

ISTEMAL (2 tarike)
------------------
1) Apni inventory Excel file ('gfh database.xlsx') is folder mein
   rakho -> RUN_UPLOAD.bat par double-click karo -> bas, upload shuru
   (koi ENTER / sawal nahi)

2) Ya Excel file ko pakad kar RUN_UPLOAD.bat par DRAG & DROP karo

PEHLI DAFA
----------
- openpyxl / firebase-admin khud install ho jayenge (internet
  chahiye, ~20 sec, sirf pehli dafa)
- Backup lena zaroori: RUN_BACKUP.bat double-click karo,
  ye current dashboard ka poora data JSON file mein save kar deta hai

ADVANCED (optional): RULES LOCK
-------------------------------
Jab credential mode 1 dafa chal jaye, to Firebase Console >
Realtime Database > Rules mein ye laga do taake koi aur aap ka
data badal na sake (dashboard ko READ sab ke liye chahiye):

  { "rules": { ".read": true, ".write": false } }

Iske baad upload SIRF credential file wale mode se hoga.

ZAROORI BAATEIN
---------------
- Upload POORA database REPLACE karta hai. Purana data hat kar
  aap ki file ka data aa jata hai. Is liye file mein HAMESHA
  poora data hona chahiye (purana + naya sab).
- Columns ka order zaroori NAHI hai (v3.3) - script naam se
  khud map karti hai. Sirf header ke naam dashboard jaise hone
  chahiye (District, Store name, ESN number, Rebate, ...).
  Jo dashboard columns aap ki file mein nahi hain wo dashboard
  par khaali dikhenge - data oocha nahi jayega.
- Bina drag-drop chalao to script folder ki saari Excel/CSV files ko
  headers se check kar ke SAB SE ZYADA MATCH wali inventory file
  uthati hai (sab se nayi nahi!) - poori list print hoti hai.
  Agar best file bhi 15/25 se kam match ho (jaise sirf Rebate filing
  jaisi report) to auto-pick REFUSE kar deta hai - us soorat mein
  apni 'gfh database' file folder mein rakho ya drag-drop karo.
- Best tareeqa: inventory file ko RUN_UPLOAD.bat par DRAG & DROP karo
  - phir koi guessing hi nahi hoti.
- Upload ke baad dashboard kholo aur refresh karo.

TEST (bina upload ke)
---------------------
python GFH_Inventory_Upload.py meri-file.xlsx --dry-run
Ye sirf preview dikhata hai, kuch upload nahi hota.
