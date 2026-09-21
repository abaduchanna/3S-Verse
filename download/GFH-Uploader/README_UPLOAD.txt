GFH INVENTORY DASHBOARD - FIREBASE UPLOADER (REBUILT)
=====================================================

Ye wo file hai jo lost ho gayi thi. Ye aap ki Excel/CSV data
padh kar dashboard (gfhinventorydashboard.netlify.app) par
upload kar deti hai.

ISTEMAL (2 tarike)
------------------
1) Apni inventory Excel file is folder mein rakho
   -> RUN_UPLOAD.bat par double-click karo
   -> ENTER dabao, upload shuru

2) Ya Excel file ko pakad kar RUN_UPLOAD.bat par DRAG & DROP karo

PEHLI DAFA
----------
- openpyxl khud install ho jayega (internet chahiye, 10 sec)
- Backup lena zaroori: RUN_BACKUP.bat double-click karo,
  ye current dashboard ka poora data JSON file mein save kar deta hai

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
