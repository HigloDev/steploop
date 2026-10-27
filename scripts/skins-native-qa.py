"""Capture real RN pages and exercise appearance lifecycle in a dedicated synthetic lab.

Requires the explicit .uiqa debug build and its Metro connection. Never installs,
clears, uninstalls or operates a physical device or the published application.
"""
import argparse
import io
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IDS = ['classic', 'night-run', 'woodland', 'eva-unit-01', 'eva-unit-02', 'pikachu', 'k-on']
PAPER = {
    'classic': ['#F7F9FC', '#0E192B'], 'night-run': ['#F7F9F2', '#101411'],
    'woodland': ['#F5F3EB', '#101C16'], 'eva-unit-01': ['#F7F4FC', '#16111F'],
    'eva-unit-02': ['#FFF6F1', '#201315'], 'pikachu': ['#FFFBEF', '#201A10'],
    'k-on': ['#FFF9F1', '#21191F'],
}


class Lab:
    def __init__(self, serial, package, out):
        assert serial.startswith('emulator-'), 'Physical devices are excluded'
        assert package == 'com.zxn.palou.uiqa', 'Published and other-task packages are excluded'
        self.serial, self.package, self.out = serial, package, out
        self.adb_path = Path(__import__('os').environ['ANDROID_SDK_ROOT']) / 'platform-tools/adb.exe'
        assert 'steploop_skins_20261028' in self.adb('emu', 'avd', 'name'), 'Use the dedicated skin emulator'
        assert self.package in self.adb('shell', 'pm', 'list', 'packages', self.package)
        out.mkdir(parents=True, exist_ok=True)
        self.results = []

    def adb(self, *args, binary=False, timeout=35):
        result = subprocess.check_output([str(self.adb_path), '-s', self.serial, *map(str, args)], timeout=timeout)
        return result if binary else result.decode('utf-8', errors='replace')

    def tree(self):
        for _ in range(5):
            result = self.adb('shell', 'uiautomator', 'dump', '--compressed', '/sdcard/steploop-skins-qa.xml')
            if 'dumped to:' not in result:
                time.sleep(.3)
                continue  # A failed dump must never reuse the previous screen's XML.
            text = self.adb('shell', 'cat', '/sdcard/steploop-skins-qa.xml')
            assert not any(error in text for error in ['rn_redbox', 'catalyst_redbox', 'Unable to load script', '应用遇到问题']), text[:500]
            return ET.fromstring(text)
        raise AssertionError('Could not obtain a fresh UI hierarchy')

    def open(self, state, skin=None, mode=None):
        url = f'steploop://uiqa?state={state}'
        if skin: url += '&skin=' + skin
        if mode: url += '&mode=' + mode
        self.adb('shell', 'am', 'force-stop', self.package)
        self.adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-n', self.package + '/com.zxn.palou.MainActivity', '-d', "'" + url + "'")
        # Wait for the requested route; fixtures use real pages and synthetic records.
        marker = {'home': '本周累计爬升', 'climbing': '正在向上', 'summary': '训练完成',
                  'appearance': '皮肤与外观', 'settings': '运动播报', 'share': '成果预览',
                  'weekly': '本周成果分享', 'history': '向上的轨迹'}.get(state)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            tree = self.tree()
            if not marker or any(marker in n.get('text', '') + n.get('content-desc', '') for n in tree.iter('node')):
                if state == 'summary':
                    # The comparison is the saved result, after the real celebration ends.
                    while any(n.get('content-desc') == '查看本次成绩' for n in tree.iter('node')):
                        assert time.monotonic() < deadline, 'Completion celebration did not finish'
                        time.sleep(.3)
                        tree = self.tree()
                return tree
            time.sleep(.4)
        raise AssertionError('Route not ready: ' + state)

    def screenshot(self, name, skin, mode, check_paper=True):
        expected = tuple(bytes.fromhex(PAPER[skin][mode == 'dark'][1:]))
        deadline = time.monotonic() + 12
        while True:
            data = self.adb('exec-out', 'screencap', '-p', binary=True)
            img = Image.open(io.BytesIO(data)).convert('RGB')
            if not check_paper or img.getpixel((10, 300)) == expected: break
            assert time.monotonic() < deadline, f'{name}: unexpected page color {img.getpixel((10, 300))}, expected {expected}'
            time.sleep(.2)
        (self.out / (name + '.png')).write_bytes(data)
        self.results.append({'name': name, 'skin': skin, 'mode': mode, 'size': list(img.size), 'paper': PAPER[skin][mode == 'dark']})
        print(json.dumps(self.results[-1], ensure_ascii=False), flush=True)

    def tap(self, label, prefix=False):
        tree = self.tree()
        for node in tree.iter('node'):
            values = [node.get('text', ''), node.get('content-desc', '')]
            if any(value.startswith(label) if prefix else value == label for value in values):
                coords = list(map(int, re.findall(r'\d+', node.get('bounds'))))
                self.adb('shell', 'input', 'tap', (coords[0] + coords[2]) // 2, (coords[1] + coords[3]) // 2)
                time.sleep(.3)
                return
        raise AssertionError('Control not visible: ' + label)

    def swipe(self, up=True):
        width, height = map(int, re.findall(r'(\d+)x(\d+)', self.adb('shell', 'wm', 'size'))[-1])
        self.adb('shell', 'input', 'swipe', int(width * .79), int(height * (.78 if up else .27)), int(width * .79), int(height * (.27 if up else .78)), 400)
        time.sleep(.2)

    def selected(self, label):
        return any((node.get('text') == label or node.get('content-desc') == label)
                   and (node.get('selected') == 'true' or node.get('checked') == 'true') for node in self.tree().iter('node'))

    def lifecycle(self):
        self.open('settings', 'classic', 'light')
        self.tap('皮肤与外观', prefix=True)
        self.tap('暗色')
        for _ in range(3): self.swipe()
        self.tap('皮卡丘')
        # A cold start has no skin/mode fixture override: only actual saved settings apply.
        self.open('appearance')
        assert self.selected('暗色'), 'Manual dark mode did not survive restart'
        self.screenshot('picker-persist-dark', 'pikachu', 'dark')
        for _ in range(3): self.swipe()
        assert self.selected('皮卡丘'), 'Selected skin did not survive restart'
        for _ in range(4): self.swipe(False)
        self.tap('跟随系统')
        self.adb('shell', 'cmd', 'uimode', 'night', 'no')
        self.screenshot('system-light', 'pikachu', 'light')
        self.adb('shell', 'cmd', 'uimode', 'night', 'yes')
        self.screenshot('system-dark', 'pikachu', 'dark')
        self.tap('浅色')
        self.screenshot('manual-light-on-dark-system', 'pikachu', 'light')
        self.open('appearance')
        assert self.selected('浅色'), 'Manual mode did not survive a second cold start'
        self.screenshot('picker-persist-light', 'pikachu', 'light')

    def ensure_control(self, label):
        for _ in range(5):
            tree = self.tree()
            parents = {child: parent for parent in tree.iter() for child in parent}
            for node in tree.iter('node'):
                if not any(value.startswith(label) for value in [node.get('text', ''), node.get('content-desc', '')]): continue
                target = node
                while target.get('clickable') != 'true' and target in parents: target = parents[target]
                coords = list(map(int, re.findall(r'\d+', target.get('bounds', ''))))
                if len(coords) == 4 and target.get('enabled') == 'true' and coords[3] - coords[1] >= 100:
                    return
            self.swipe()
        raise AssertionError('Primary control is not accessible at the small large-font size: ' + label)

    def small(self):
        try:
            self.adb('shell', 'wm', 'size', '720x1600')
            self.adb('shell', 'wm', 'density', '360')
            self.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3')
            for state, label in [('home', '开始爬楼'), ('climbing', '长按结束并保存'), ('summary', '生成分享卡片'), ('appearance', '跟随系统')]:
                self.open(state, 'eva-unit-01', 'dark')
                self.screenshot('small-320dp-130-' + state + '-top', 'eva-unit-01', 'dark')
                self.ensure_control(label)
                self.screenshot('small-320dp-130-' + state + '-action', 'eva-unit-01', 'dark')
        finally:
            self.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
            self.adb('shell', 'wm', 'size', 'reset')
            self.adb('shell', 'wm', 'density', 'reset')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', required=True)
    parser.add_argument('--package', default='com.zxn.palou.uiqa')
    parser.add_argument('--out', type=Path, default=ROOT / 'docs/skins/evidence/20261028')
    parser.add_argument('--phase', choices=['matrix', 'summaries', 'progress', 'lifecycle', 'extra', 'small', 'all'], default='all')
    parser.add_argument('--resume', action='store_true', help='Reuse already captured frames from this same run')
    args = parser.parse_args()
    lab = Lab(args.serial, args.package, args.out)
    if args.phase in ['matrix', 'all']:
        for skin in IDS:
            for mode in ['light', 'dark']:
                for state in ['home', 'climbing', 'summary']:
                    name = f'{skin}-{mode}-{state}'
                    if args.resume and (args.out / (name + '.png')).exists():
                        image = Image.open(args.out / (name + '.png')).convert('RGB')
                        expected = tuple(bytes.fromhex(PAPER[skin][mode == 'dark'][1:]))
                        assert image.getpixel((10, 300)) == expected, name
                        lab.results.append({'name': name, 'skin': skin, 'mode': mode, 'size': list(image.size), 'paper': PAPER[skin][mode == 'dark'], 'reused': True})
                        continue
                    lab.open(state, skin, mode)
                    lab.screenshot(name, skin, mode)
    if args.phase in ['lifecycle', 'all']: lab.lifecycle()
    if args.phase in ['small', 'all']: lab.small()
    if args.phase == 'summaries':
        for skin in IDS:
            for mode in ['light', 'dark']:
                lab.open('summary', skin, mode)
                lab.screenshot(f'{skin}-{mode}-summary', skin, mode)
    if args.phase == 'progress':
        for skin in IDS[1:]:
            for mode in ['light', 'dark']:
                for state in ['climbing', 'summary']:
                    lab.open(state, skin, mode)
                    lab.screenshot(f'{skin}-{mode}-{state}', skin, mode)
    if args.phase in ['extra', 'all']:
        for mode in ['light', 'dark']:
            for state in ['appearance', 'settings', 'history', 'share', 'weekly']:
                lab.open(state, 'eva-unit-01', mode)
                lab.screenshot(f'extra-{mode}-{state}', 'eva-unit-01', mode)
            lab.open('home', 'eva-unit-01', mode)
            lab.tap('选择楼栋', prefix=True)
            assert any('选择今天的楼栋' in n.get('text', '') + n.get('content-desc', '') for n in lab.tree().iter('node'))
            lab.screenshot(f'extra-{mode}-sheet', 'eva-unit-01', mode, check_paper=False)
    (args.out / f'{args.phase}-results.json').write_text(json.dumps(lab.results, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
