"""Render the approved Steploop flight into offline transparent native images."""
import argparse
import base64
import hashlib
import io
import json
import subprocess
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SCENE = ROOT / "scripts" / "glacier-flight"
WIDTH, HEIGHT, FPS = 576, 490, 50
DURATION = 2.24

FRAME_BATCH = """({rows, tone, times}) => times.map(time => {
  drawBuilding(ctx, canvas.width, canvas.height, sampleFlight(time), tone, rows);
  return canvas.toDataURL('image/png').split(',')[1];
})"""

def check_bounds(png_bytes, tone, floors):
    with Image.open(io.BytesIO(png_bytes)) as image:
        bounds = image.getchannel("A").point(lambda value: 255 if value > 210 else 0).getbbox()
        if bounds is None or bounds[0] < 4 or bounds[1] < 4 or bounds[2] > WIDTH - 4 or bounds[3] > HEIGHT - 4:
            raise ValueError(f"Artwork clips for {tone}/{floors}: {bounds}")

def render(page, output, tone, floors):
    stem = output / f"{tone}-{floors}"
    motion = stem.with_suffix(".webp")
    temp = output / (stem.name + "-partial.webp")
    still = output / (stem.name + "-still.webp")
    times = [index / FPS for index in range(round(DURATION * FPS) + 1)]
    with subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "image2pipe", "-vcodec", "png",
         "-framerate", str(FPS), "-i", "-", "-an", "-c:v", "libwebp_anim",
         "-lossless", "0", "-quality", "87", "-compression_level", "2",
         "-pix_fmt", "yuva420p", "-loop", "1", str(temp)],
        stdin=subprocess.PIPE,
    ) as encoder:
        for offset in range(0, len(times), 12):
            batch = times[offset:offset + 12]
            images = page.evaluate(FRAME_BATCH, {"rows": floors, "tone": tone, "times": batch})
            for time, item in zip(batch, images):
                frame = base64.b64decode(item)
                if time in (0, 1.5, DURATION):
                    check_bounds(frame, tone, floors)
                encoder.stdin.write(frame)
        encoder.stdin.close()
        if encoder.wait(timeout=45) != 0:
            raise RuntimeError(f"FFmpeg failed for {tone}/{floors}")
    temp.replace(motion)
    with Image.open(io.BytesIO(frame)) as image:
        image.save(still, format="WEBP", lossless=True, method=4)
    with Image.open(motion) as image:
        if not image.is_animated or image.n_frames < 45 or image.info.get("loop") != 1:
            raise ValueError(f"Expected a one-play animation for {tone}/{floors}")
    return [
        {"file": path.name, "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        for path in (motion, still)
    ]

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--browser", required=True, help="Installed Chromium-based browser executable")
parser.add_argument("--report", type=Path, required=True, help="Output receipt JSON")
args = parser.parse_args()
output = ROOT / "assets" / "skins" / "glacier-glass" / "completion"
output.mkdir(parents=True, exist_ok=True)
artifacts = []
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=args.browser, args=["--disable-background-networking"])
    page = browser.new_page()
    page.set_content(f'<canvas id="scene" width="{WIDTH}" height="{HEIGHT}"></canvas>')
    for file in ("flight.js", "building.js"):
        page.add_script_tag(path=SCENE / file)
    page.evaluate("window.canvas = document.querySelector('#scene'); window.ctx = canvas.getContext('2d')")
    for floors in (6, 3, 4, 5, 7, 8, 9, 10):
        for tone in ("light", "dark"):
            artifacts.extend(render(page, output, tone, floors))
            print(f"Rendered {tone}/{floors}", flush=True)
    browser.close()

args.report.parent.mkdir(parents=True, exist_ok=True)
args.report.write_text(json.dumps({
    "width": WIDTH, "height": HEIGHT, "fps": FPS, "flightMs": round(DURATION * 1000),
    "artifacts": artifacts,
}, indent=2), encoding="utf-8")
