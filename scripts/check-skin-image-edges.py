"""Read-only guard against a wide visible image edge at a blended header bottom.

This complements native inspection; transparency alone does not prove visual QA.
Sparse headers may omit only independently audited transparent canvas margins.
"""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
from skin_qa_source import source_fingerprint

ROOT = Path(__file__).resolve().parents[1]
WINDOWS = {
    'k-on/header-settings': (.07, .58), 'eva-unit-01/header-settings': (.10, .70),
    'eva-unit-02/header-settings': (0, .65), 'pikachu/header-settings': (.04, 484 / 1024),
    'pikachu/header-settings-dark': (.04, 435 / 1024), 'k-on/header-history': (.30, 1),
    'pikachu/header-history': (.46, 1), 'pikachu/header-history-dark': (.46, 1),
}


def longest_run(values):
    longest = current = 0
    for value in values:
        current = current + 1 if value else 0
        longest = max(current, longest)
    return longest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, default=ROOT / 'output/graphics-qa/edge-r2/image-edge-audit.json')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'docs/skins/assets.json').read_text(encoding='utf-8'))
    rows = []
    for skin in manifest['skins']:
        for item in skin.get('headers', []) + skin.get('headerOverrides', []):
            path = ROOT / item['path']
            with Image.open(path) as image:
                alpha = image.getchannel('A')
                bottom = list(alpha.crop((0, image.height - 1, image.width, image.height)).getdata())
                # A >6% alpha run is a visible cutoff; scattered faint watercolor
                # residue is reviewed natively, not promoted to a wide hard seam.
                run = longest_run([value > 16 for value in bottom])
                # K-On home is moved down by 17% only after ImageGen left this
                # lower strip empty. Fail if a later replacement paints into it.
                cropped_strip_max = 0
                if skin['id'] == 'k-on' and item['page'] == 'home':
                    cropped_strip_max = alpha.crop((0, int(image.height * .83), image.width, image.height)).getextrema()[1]
                window = WINDOWS.get(skin['id'] + '/' + path.stem)
                if window:
                    if window[0] > 0:
                        cropped_strip_max = max(cropped_strip_max, alpha.crop((0, 0, image.width, int(image.height * window[0]))).getextrema()[1])
                    if window[1] < 1:
                        cropped_strip_max = max(cropped_strip_max, alpha.crop((0, int(image.height * window[1]), image.width, image.height)).getextrema()[1])
                rows.append({'path': item['path'], 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                             'bottomVisiblePixels': sum(value > 16 for value in bottom), 'alphaThreshold': 16,
                             'bottomVisibleRun': run, 'width': image.width,
                             'croppedTransparentStripAlphaMax': cropped_strip_max,
                             'passed': run <= image.width * .02 and cropped_strip_max <= 2})
    result = {'passed': all(row['passed'] for row in rows), 'sourceFingerprint': source_fingerprint(),
              'scope': 'Wide source-image bottom seams only; native inspection remains required.', 'headers': rows}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'passed': result['passed'], 'headers': len(rows), 'failed': [row['path'] for row in rows if not row['passed']]}, ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)


if __name__ == '__main__':
    main()
