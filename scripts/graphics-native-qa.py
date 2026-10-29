"""Native graphical-skin acceptance on the dedicated .uiqa emulator only."""
import argparse
import json
import subprocess
import time
import xml.etree.ElementTree as ET
from urllib.request import urlopen
from pathlib import Path

from skins_native_qa_import import Lab, IDS, ROOT
from skin_qa_source import source_fingerprint


MARKERS = {
    'home': '本周累计爬升', 'coach': '设定我的体重目标', 'history': '向上的轨迹',
    'settings': '运动播报', 'climbing': '正在向上', 'summary': '训练完成',
    'appearance': '皮肤与外观', 'coach-active': '记录体重 / 查看趋势',
    'coach-course': '目标体重管理', 'coach-goal': '安排我的目标体重管理',
    'coach-session': '每一步都留有余地', 'coach-records': '记录一次体重',
    'coach-review': '本周复盘', 'summary-coach': '训练完成', 'course-climbing': '本次有效上爬',
    'calibrating': '到了一层', 'descending': '下行中', 'waiting': '在楼下准备',
    'save-failed': '重试保存', 'share': '成果预览', 'weekly': '本周成果分享',
}


class GraphicLab(Lab):
    def screenshot(self, name, skin, mode, check_paper=True):
        super().screenshot(name, skin, mode, check_paper)
        self.results[-1]['sourceFingerprint'] = source_fingerprint()

    def open(self, state, skin=None, mode=None):
        url = 'steploop://uiqa?state=' + state
        if skin:
            url += '&skin=' + skin
        if mode:
            url += '&mode=' + mode
        self.adb('shell', 'am', 'force-stop', self.package)
        self.adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-n',
                 self.package + '/com.zxn.palou.MainActivity', '-d', "'" + url + "'")
        deadline = time.monotonic() + 70
        marker = MARKERS.get(state, '')
        while time.monotonic() < deadline:
            try:
                tree = self.tree()
            except AssertionError as error:
                # A newly resized emulator may not expose accessibility yet.
                # Retry inside the same deadline; never swallow app/redbox errors.
                if str(error) != 'Could not obtain a fresh UI hierarchy':
                    raise
                continue
            if marker and not any(marker in n.get('text', '') + n.get('content-desc', '') for n in tree.iter('node')):
                time.sleep(.3)
                continue
            if state.startswith('summary') and any(n.get('content-desc') == '查看本次成绩' for n in tree.iter('node')):
                time.sleep(.3)
                continue
            time.sleep(.4)
            return tree
        raise AssertionError('Page not ready: ' + state)

    def configure(self, port):
        # Check IPv4 reachability before launching a batch; ::1-only Metro is
        # invisible to adb reverse and otherwise causes repeated native redboxes.
        with urlopen(f'http://127.0.0.1:{port}/status', timeout=5) as response:
            assert response.read().strip() == b'packager-status:running', 'Metro is not ready on IPv4'
        self.adb('shell', 'am', 'force-stop', self.package)
        self.adb('reverse', f'tcp:{port}', f'tcp:{port}')
        self.adb('reverse', 'tcp:8081', f'tcp:{port}')
        prefs = f'shared_prefs/{self.package}_preferences.xml'
        existing = subprocess.run([str(self.adb_path), '-s', self.serial, 'shell', 'run-as', self.package, 'cat', prefs], capture_output=True)
        root = ET.fromstring(existing.stdout) if existing.returncode == 0 else ET.Element('map')
        host = next((node for node in root if node.get('name') == 'debug_http_host'), None)
        if host is None:
            host = ET.SubElement(root, 'string', {'name': 'debug_http_host'})
        host.text = f'127.0.0.1:{port}'
        payload = ET.tostring(root, encoding='utf-8', xml_declaration=True)
        subprocess.run([str(self.adb_path), '-s', self.serial, 'shell', 'run-as', self.package,
                        'sh', '-c', f"'mkdir -p shared_prefs; cat > {prefs}'"],
                       input=payload, check=True, timeout=20)
        self.adb('shell', 'wm', 'size', '1080x2400')
        self.adb('shell', 'wm', 'density', '420')
        self.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default='emulator-5596')
    parser.add_argument('--out', type=Path, default=ROOT / 'output/graphics-qa/screens')
    parser.add_argument('--skins', nargs='+', default=IDS)
    parser.add_argument('--states', nargs='+', default=['home', 'coach', 'history', 'settings', 'climbing', 'summary'])
    parser.add_argument('--modes', nargs='+', default=['light', 'dark'])
    parser.add_argument('--configure', type=int)
    parser.add_argument('--small', action='store_true')
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    assert all(s in IDS for s in args.skins)
    assert all(m in ['light', 'dark'] for m in args.modes)
    lab = GraphicLab(args.serial, 'com.zxn.palou.uiqa', args.out)
    result_file = args.out / ('small-results.json' if args.small else 'capture-results.json')
    previous = json.loads(result_file.read_text(encoding='utf-8')) if result_file.exists() else []
    combined = {item['name']: item for item in previous}
    source = source_fingerprint()
    def checkpoint():
        combined.update({item['name']: item for item in lab.results})
        result_file.write_text(json.dumps(list(combined.values()), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if args.configure:
        lab.configure(args.configure)
    try:
        if args.small:
            lab.adb('shell', 'wm', 'size', '720x1600')
            lab.adb('shell', 'wm', 'density', '360')
            lab.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3')
        for skin in args.skins:
            for mode in args.modes:
                for state in args.states:
                    name = f'{skin}-{mode}-{state}' + ('-small' if args.small else '')
                    if args.resume and (args.out / (name + '.png')).exists() and combined.get(name, {}).get('sourceFingerprint') == source:
                        continue
                    lab.open(state, skin, mode)
                    lab.screenshot(name, skin, mode)
                    checkpoint()
                    if args.small and state in ['home', 'coach', 'appearance', 'coach-records', 'coach-review', 'summary-coach']:
                        for _ in range(3):
                            lab.swipe()
                        lab.screenshot(name + '-bottom', skin, mode)
                        checkpoint()
    finally:
        if args.small:
            lab.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
            lab.adb('shell', 'wm', 'size', '1080x2400')
            lab.adb('shell', 'wm', 'density', '420')


if __name__ == '__main__':
    main()
