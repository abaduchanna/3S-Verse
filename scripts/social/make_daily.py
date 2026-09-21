"""Render 7-day square post pack (1080x1080 @2x) to PNG."""
import os
import shutil
from playwright.sync_api import sync_playwright

SRC = "/home/z/my-project/scripts/social"
OUT = "/home/z/my-project/download/social-posts/daily-pack"
os.makedirs(OUT, exist_ok=True)

DAYS = [
    ("day1", "day1_autopilot.png"),
    ("day2", "day2_incentives.png"),
    ("day3", "day3_orders.png"),
    ("day4", "day4_rebates.png"),
    ("day5", "day5_gfh_uploader.png"),
    ("day6", "day6_evenings.png"),
    ("day7", "day7_trial.png"),
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, out in DAYS:
        page = browser.new_page(viewport={"width": 1080, "height": 1080}, device_scale_factor=2)
        page.goto(f"file://{SRC}/{name}.html")
        page.wait_for_timeout(500)
        path = f"{OUT}/{out}"
        page.screenshot(path=path)
        page.close()
        print(f"OK {out}: {os.path.getsize(path):,} bytes")
    browser.close()
print("done")
