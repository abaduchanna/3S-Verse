GFH INVENTORY DASHBOARD - FIREBASE UPLOADER v3 (SHEET-AWARE + CREDENTIAL)
=========================================================================

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

2 MODES (script khud choose karta hai)
--------------------------------------
1) CREDENTIAL MODE (secure):
   Apni Firebase credential JSON file isi folder mein rakho
   (koi bhi naam chalega, jaise firebase-credentials.json).
   Script khud dhundh kar usi se login kar ke upload karegi.
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
1) Apni inventory Excel file is folder mein rakho
   -> RUN_UPLOAD.bat par double-click karo
   -> ENTER dabao, upload shuru

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
- Excel ke 25 columns ka ORDER same rehna chahiye:
  District | Store name | Date | Order details | Product description |
  ESN number | Tracking number | Tracking status | Cost | Due date |
  Payment due status | Stock status | Ext Price | Expected Commission |
  ER Exp Comm | Rebate | SP Exp Comm | 1st Month Spiff | Rebate variance |
  Spiff Variance | Device missing status | Device sale location |
  Device sale date | Device sold by | External Order ID
- Agar order different hua to script khud warn karega aur
  yes/no puchega. Jab tak pakka nahi, "no" likh kar cancel karo.
- Sab se nayi .xlsx/.csv file khud pakdi jati hai folder se
  (Excel ki temporary ~$ files ignore hoti hain).
- Upload ke baad dashboard kholo aur refresh karo.

TEST (bina upload ke)
---------------------
python GFH_Inventory_Upload.py meri-file.xlsx --dry-run
Ye sirf preview dikhata hai, kuch upload nahi hota.
