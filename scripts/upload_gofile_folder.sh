#!/bin/bash
# Upload fixed app builds to ONE named gofile folder (guest account flow).
# Usage: upload_gofile_folder.sh <folderName> <file1> [file2 ...]
# Gofile API (2024+): upload field = "file", createfolder = JSON body on api host.
set -u

DIRNAME="$1"; shift
FILES=("$@")

API="https://api.gofile.io"
jqpy() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

echo "[1/5] guest account..."
ACC=$(curl -s -X POST "$API/accounts")
TOKEN=$(echo "$ACC" | jqpy "d['data']['token']")
[ -z "$TOKEN" ] && { echo "FAIL: no token: $ACC"; exit 1; }
echo "  token ok"

echo "[2/5] server..."
SRV=$(curl -s "$API/servers" | jqpy "d['data']['servers'][0]['name']")
[ -z "$SRV" ] && { echo "FAIL: no server"; exit 1; }
echo "  server: $SRV"

echo "[3/5] detect guest root (dummy upload)..."
DUMMY=$(echo dummy | curl -s -X POST "https://${SRV}.gofile.io/contents/uploadfile" \
  -H "Authorization: Bearer $TOKEN" -F "file=@-" --max-time 60)
ROOT=$(echo "$DUMMY" | jqpy "d['data']['parentFolder']")
[ -z "$ROOT" ] && { echo "FAIL: no root: $DUMMY"; exit 1; }
echo "  root: $ROOT"

echo "[4/5] create folder '$DIRNAME'..."
FOLD=$(curl -s -X POST "$API/contents/createfolder" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"parentFolderId\":\"$ROOT\",\"folderName\":\"$DIRNAME\"}" --max-time 60)
FID=$(echo "$FOLD" | jqpy "d['data']['id']")
FCODE=$(echo "$FOLD" | jqpy "d['data']['code']")
[ -z "$FID" ] && { echo "FAIL: no folder: $FOLD"; exit 1; }
echo "  folder id: $FID  code: $FCODE"

echo "[5/5] uploading ${#FILES[@]} files..."
N=0
for f in "${FILES[@]}"; do
  N=$((N+1))
  SZ=$(stat -c%s "$f")
  echo "  ($N/${#FILES[@]}) $(basename "$f") ($((SZ/1048576)) MB)..."
  T0=$(date +%s)
  RES=$(curl -s -X POST "https://${SRV}.gofile.io/contents/uploadfile" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$f" \
    -F "parentFolderId=$FID" \
    --max-time 3600)
  T1=$(date +%s)
  ST=$(echo "$RES" | jqpy "d.get('status','PARSE_FAIL: '+repr(d)[:120])" 2>/dev/null || echo PARSE_FAIL)
  echo "    -> $ST  ($((T1-T0))s)"
done

echo ""
echo "FOLDER LINK: https://gofile.io/d/$FCODE"
