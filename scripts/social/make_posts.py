"""Screenshot 3 social post HTMLs to PNG at 2x scale."""
import os
from playwright.sync_api import sync_playwright

SRC = "/home/z/my-project/scripts/social"
OUT = "/home/z/my-project/download/social-posts"
os.makedirs(OUT, exist_ok=True)

JOBS = [
    ("insta", 1080, 1080),
    ("facebook", 1200, 630),
    ("linkedin", 1200, 627),
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, w, h in JOBS:
        page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
        page.goto(f"file://{SRC}/{name}.html")
        page.wait_for_timeout(500)
        path = f"{OUT}/3sverse_{name}.png"
        page.screenshot(path=path)
        page.close()
        print(f"OK {name}: {os.path.getsize(path):,} bytes")
    browser.close()
print("done")
