#!/bin/bash
# Upload 3S Verse social kit to GitHub (repo + release) for external download links
set -euo pipefail

PAT=$(tr -d '[:space:]' < /home/z/my-project/secrets/pat.txt)
API=https://api.github.com
OWNER=abaduchanna
REPO=3sverse-social-kit
AUTH="Authorization: Bearer $PAT"

echo "== 1) verify token =="
LOGIN=$(curl -s -H "$AUTH" $API/user | python3 -c "import sys,json;print(json.load(sys.stdin).get('login',''))")
echo "login: $LOGIN"

echo "== 2) create repo (ok if already exists) =="
CODE=$(curl -s -o /tmp/repo_resp.json -w "%{http_code}" -X POST -H "$AUTH" -H "Accept: application/vnd.github+json" \
  $API/user/repos \
  -d "{\"name\":\"$REPO\",\"description\":\"3S Verse social media marketing kit (LinkedIn / Facebook / Instagram)\",\"private\":false,\"auto_init\":true}")
echo "repo create HTTP: $CODE"

echo "== 3) commit files =="
SRC=/home/z/my-project/download/3sverse-social
WORK=/home/z/my-project/repos/social-kit
mkdir -p "$WORK"
cp "$SRC"/*.png "$SRC"/captions.txt "$WORK"/
cd "$WORK"
[ -d .git ] || git init -b main -q
git add -A
git -c user.name="Abad Umair Channa" -c user.email="Connect@3SVerse.com" \
    commit -q -m "Social media kit: LinkedIn, Facebook, Instagram creatives + captions" || echo "nothing to commit"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$OWNER/$REPO.git"

export GH_PAT="$PAT"
cat > /tmp/askpass.sh <<'EOF'
#!/bin/bash
case "$1" in
  *Username*) echo "abaduchanna" ;;
  *Password*) echo "$GH_PAT" ;;
esac
EOF
chmod +x /tmp/askpass.sh
export GIT_ASKPASS=/tmp/askpass.sh
export GIT_TERMINAL_PROMPT=0
git push -uf origin main

echo "== 4) create release v1.0 =="
REL=$(curl -s -X POST -H "$AUTH" -H "Accept: application/vnd.github+json" \
  "$API/repos/$OWNER/$REPO/releases" \
  -d '{"tag_name":"v1.0","name":"v1.0 - Social Media Kit","body":"LinkedIn, Facebook, Instagram creatives + captions.txt. Hashtags in captions only, none in images.","draft":false,"prerelease":false}')
RELID=$(echo "$REL" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id','') or '')")
echo "release id: ${RELID:-FAILED}"
if [ -n "$RELID" ]; then
  echo "== 5) upload zip as release asset =="
  ACODE=$(curl -s -o /tmp/up.json -w "%{http_code}" -X POST \
    -H "$AUTH" -H "Content-Type: application/zip" \
    --data-binary @/home/z/my-project/download/3sverse-social.zip \
    "https://uploads.github.com/repos/$OWNER/$REPO/releases/$RELID/assets?name=3sverse-social.zip")
  echo "asset upload HTTP: $ACODE"
fi

echo "== 6) verify links =="
curl -sIL -o /dev/null -w "release zip final HTTP: %{http_code}\n" "https://github.com/$OWNER/$REPO/releases/latest/download/3sverse-social.zip"
for f in linkedin_1200x627.png facebook_1200x630.png instagram_1080x1350.png captions.txt; do
  curl -sI -o /dev/null -w "raw $f: %{http_code}\n" "https://raw.githubusercontent.com/$OWNER/$REPO/main/$f"
done
echo "DONE"
