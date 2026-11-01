"""Capture the same app-owned aspect ratio as each selected concept frame.

Only operates the guarded synthetic .uiqa emulator. Android system insets remain
real; the comparison viewer excludes them without editing any screenshot bytes.
"""
import argparse
import re
import importlib.util
import json
from pathlib import Path
from skin_qa_source import source_fingerprint

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('graphics_qa', Path(__file__).with_name('graphics-native-qa.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--skins', nargs='+', required=True)
    p.add_argument('--states', nargs='+', default=['home', 'coach', 'history', 'settings'])
    p.add_argument('--modes', nargs='+', default=['light', 'dark'])
    p.add_argument('--round', default='round-7')
    p.add_argument('--width', type=int, default=720)
    p.add_argument('--density', type=int, default=320)
    p.add_argument('--serial', default='emulator-5596')
    p.add_argument('--resume', action='store_true', help='Reuse only captures for the unchanged runtime fingerprint')
    args = p.parse_args()
    out = ROOT / 'docs/skins/evidence/20261028-fidelity' / args.round
    targets = json.loads((ROOT / 'docs/skins/fidelity-targets.json').read_text(encoding='utf-8'))
    lab = module.GraphicLab(args.serial, 'com.zxn.palou.uiqa', out)
    record_file = out / 'captures.json'
    records = json.loads(record_file.read_text(encoding='utf-8')) if record_file.exists() else []
    def insets():
        info = lab.adb('shell', 'dumpsys', 'window', 'displays')
        top = re.search(r'type=statusBars frame=\[0,0\]\[\d+,(\d+)\]', info)
        bottom = re.search(r'type=navigationBars frame=\[0,(\d+)\]\[\d+,(\d+)\]', info)
        assert top and bottom, 'Real system inset bounds are required'
        return int(top[1]), int(bottom[2]) - int(bottom[1])

    source = source_fingerprint()
    try:
        lab.adb('shell', 'wm', 'size', f'{args.width}x1600')
        lab.adb('shell', 'wm', 'density', args.density)
        top, bottom = insets()
        lab.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
        for skin in args.skins:
            for mode in args.modes:
                for state in args.states:
                    assert source_fingerprint() == source, 'Runtime changed during capture; restart this batch'
                    frame = targets[skin]['frames'][mode][state]
                    x, y, w, h = frame
                    name = f'{skin}-{mode}-{state}'
                    if args.resume and (out / (name + '.png')).exists() and any(
                        r['name'] == name and r.get('sourceFingerprint') == source
                        and r.get('density') == args.density and r.get('nativeRect', [0, 0, 0])[2] == args.width
                        for r in records
                    ):
                        print('RESUME ' + name, flush=True)
                        continue
                    target_height = round(h / w * args.width)
                    height = target_height + top + bottom
                    # Insets settle after the density/window reconfiguration.
                    # Measure the real app window and correct its total height.
                    for attempt in range(4):
                        lab.adb('shell', 'wm', 'size', f'{args.width}x{height}')
                        lab.open(state, skin, mode)
                        actual_top, actual_bottom = insets()
                        content_height = height - actual_top - actual_bottom
                        if abs(content_height - target_height) < 2:
                            break
                        print(f'INSETS {name}: correcting {height} using {actual_top}+{actual_bottom}', flush=True)
                        height = target_height + actual_top + actual_bottom
                    else:
                        raise AssertionError(f'Unstable content viewport: {name}, {height}, {actual_top}, {actual_bottom}')
                    top, bottom = actual_top, actual_bottom
                    lab.screenshot(name, skin, mode)
                    assert source_fingerprint() == source, 'Runtime changed before evidence was recorded'
                    records = [r for r in records if r['name'] != name]
                    records.append({**lab.results[-1], 'reference': targets[skin]['file'], 'sourceRect': frame,
                                    'nativeRect': [0, actual_top, args.width, content_height], 'fontScale': 1, 'density': args.density,
                                    'logicalWidthDp': args.width * 160 / args.density, 'sourceFingerprint': source})
                    (out / 'captures.json').write_text(json.dumps(records, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    finally:
        lab.adb('shell', 'wm', 'size', '1080x2400')
        lab.adb('shell', 'wm', 'density', 420)


if __name__ == '__main__':
    main()
