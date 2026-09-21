#!/bin/bash
# Upload social post files to litterbox (72h) and print links
set -u
DIR="/home/z/my-project/download/social-posts"
FILES=(3sverse_insta.png 3sverse_facebook.png 3sverse_linkedin.png CAPTIONS.txt)
for f in "${FILES[@]}"; do
  echo -n "$f -> "
  curl -s -F "reqtype=fileupload" -F "time=72h" -F "fileToUpload=@$DIR/$f" --max-time 120 https://litter.catbox.moe/resource/internals/api/upload/endpoints/litter.php
  echo ""
done
