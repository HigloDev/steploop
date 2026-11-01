"""Native graphical-skin acceptance on the dedicated .uiqa emulator only."""
import argparse
import json
import re
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


def mounted_image_evidence(log, pid, now_ms=None):
    now_ms = time.time() * 1000 if now_ms is None else now_ms
    session, mounted, failures = None, {}, []
    for line in log.splitlines():
        match = re.search(r'\[art-image\].*?(\{.*\})', line)
        if not match:
            continue
        event = json.loads(match.group(1))
        if event.get('status') == 'session-start':
            session, mounted, failures = event['session'], {}, []
            continue
        if not session or event.get('session') != session:
            continue
        instance = event.get('instanceId')
        if event['status'] == 'unmount':
            mounted.pop(instance, None)
        elif event['status'] == 'visibility':
            if instance in mounted:
                mounted[instance]['visibility'] = {key: event.get(key) for key in ['rect', 'viewport', 'window', 'bottomTabBarHeight', 'navigationFocused', 'routeKey', 'measuredAt']}
        else:
            status = event.get('loadStatus', 'pending') if event['status'] == 'mount' else event['status']
            mounted[instance] = {**mounted.get(instance, {}), 'instanceId': instance, 'identity': event['identity'], 'status': status}
        if event['status'] == 'failed':
            failures.append(event)
    images, deferred, pending = [], [], []
    for item in sorted(mounted.values(), key=lambda item: item['instanceId']):
        visibility = item.get('visibility', {})
        plain = {key: item[key] for key in ['instanceId', 'identity', 'status']}
        if item['status'] == 'loaded':
            images.append(plain)
            continue
        rect, viewport, measured = visibility.get('rect') or {}, visibility.get('viewport') or {}, visibility.get('measuredAt')
        valid = (isinstance(measured, (float, int)) and 0 <= now_ms - measured <= 1500
                 and all(isinstance(rect.get(key), (float, int)) for key in ['x', 'y', 'width', 'height'])
                 and all(isinstance(viewport.get(key), (float, int)) for key in ['width', 'height'])
                 and rect['width'] > 0 and rect['height'] > 0 and viewport['width'] > 0 and viewport['height'] > 0)
        outside = valid and (rect['x'] >= viewport['width'] or rect['y'] >= viewport['height']
                            or rect['x'] + rect['width'] <= 0 or rect['y'] + rect['height'] <= 0)
        inactive = valid and visibility.get('navigationFocused') is False and bool(visibility.get('routeKey'))
        if inactive or outside:
            deferred.append({**plain, **visibility, 'reason': 'inactive-navigation-route' if inactive else 'outside-window'})
        else:
            pending.append({**plain, **visibility})
    status = 'failed' if failures else 'loaded' if session and not pending else 'pending'
    return {'status': status, 'scope': 'current-process-visible-images', 'pid': pid,
            'session': session, 'mountedCount': len(mounted), 'images': images,
            'deferredImages': deferred, 'pendingImages': pending, 'failures': failures, 'observedAt': now_ms}


def image_evidence_signature(evidence):
    if evidence is None:
        return None
    return {key: [{k: v for k, v in item.items() if k != 'measuredAt'} for item in value]
            if key in ['deferredImages', 'pendingImages'] else value
            for key, value in evidence.items() if key != 'observedAt'}


class GraphicLab(Lab):
    def all_images_status(self):
        pids = self.adb('shell', 'pidof', self.package).strip().split()
        assert pids, 'App process is not running'
        pid = pids[0]
        log = self.adb('logcat', '-d', '--pid=' + pid, '-s', 'ReactNativeJS:I', timeout=10)
        return mounted_image_evidence(log, pid)

    def wait_all_images(self):
        deadline, previous = time.monotonic() + 70, None
        while time.monotonic() < deadline:
            current = self.all_images_status()
            assert current['status'] != 'failed', f'Mounted image failed: {current["failures"]}'
            if current['status'] == 'loaded' and image_evidence_signature(current) == image_evidence_signature(previous):
                return current
            previous = current
            time.sleep(.25)
        raise AssertionError('Mounted images did not finish loading: ' + json.dumps(previous))

    def header_status(self, identity):
        # A previous launch's successful event must never approve a blank capture.
        pid = self.adb('shell', 'pidof', self.package).strip().split()[0]
        log = self.adb('logcat', '-d', '--pid=' + pid, '-s', 'ReactNativeJS:I', timeout=10)
        latest = None
        for line in log.splitlines():
            if '[skin-image]' not in line:
                continue
            match = re.search(r'\[skin-image\].*?(\{.*\})', line)
            if not match:
                continue
            event = json.loads(match.group(1))
            if event.get('identity') == identity:
                latest = event
        return latest

    def header_ready(self):
        if not self.required_header:
            return True
        event = self.header_status(self.required_header)
        assert not event or event['status'] != 'failed', f'Required header image failed: {event}'
        if not event or event['status'] != 'loaded':
            return False
        self.header_load_evidence = event
        return True

    def configure_display(self, name):
        profiles = json.loads((ROOT / 'docs/skins/qa-display-profiles.json').read_text(encoding='utf-8-sig'))['profiles']
        profile = profiles[name]
        width, height = profile['size']
        self.adb('shell', 'wm', 'size', f'{width}x{height}')
        self.adb('shell', 'wm', 'density', profile['densityDpi'])
        self.adb('shell', 'settings', 'put', 'system', 'font_scale', profile['fontScale'])
        size = self.adb('shell', 'wm', 'size')
        density = self.adb('shell', 'wm', 'density')
        font = float(self.adb('shell', 'settings', 'get', 'system', 'font_scale').strip())
        assert re.findall(r'(\d+x\d+)', size)[-1] == f'{width}x{height}', size
        assert int(re.findall(r'density: (\d+)', density)[-1]) == profile['densityDpi'], density
        assert abs(font - profile['fontScale']) < .001, font
        self.display_profile = {'id': name, **profile, 'readback': {'size': size.strip(), 'density': density.strip(), 'fontScale': font}}

    def screenshot(self, name, skin, mode, check_paper=True):
        deadline = time.monotonic() + 90
        while True:
            all_images = self.wait_all_images()
            super().screenshot(name, skin, mode, check_paper)
            # A mount/navigation/load event during capture invalidates that PNG.
            after = self.all_images_status()
            if image_evidence_signature(after) == image_evidence_signature(all_images):
                all_images = after
                break
            self.results.pop()
            assert time.monotonic() < deadline, 'Image mount set changed throughout capture'
        self.results[-1]['sourceFingerprint'] = source_fingerprint()
        self.results[-1]['allImagesLoad'] = all_images
        # Page markers and background checks do not prove that decorative art loaded.
        self.results[-1]['visualAcceptance'] = 'pending-review'
        self.results[-1]['headerLoad'] = getattr(self, 'header_load_evidence', None)
        if hasattr(self, 'display_profile'):
            assert self.results[-1]['size'] == self.display_profile['size'], 'Screenshot pixel size differs from profile'
            self.results[-1]['displayProfile'] = self.display_profile

    def open(self, state, skin=None, mode=None):
        header_page = state if state in ['home', 'coach', 'history', 'settings'] else 'coach' if state == 'coach-active' else None
        self.required_header = f'{skin}/{mode}/{header_page}' if header_page and skin and skin != 'classic' and mode else None
        self.header_load_evidence = None
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
            # Once route text is confirmed, readiness polling only needs the
            # native event log; repeated UI hierarchy dumps are unnecessary.
            while not self.header_ready() and time.monotonic() < deadline:
                time.sleep(.2)
            if not self.header_ready():
                break
            # Native onLoad is required above; this short frame settle is not
            # used as a substitute for resource readiness.
            time.sleep(.3)
            return tree
        raise AssertionError('Page or required header not ready: ' + state + ' / ' + str(self.required_header))

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
    profiles = json.loads((ROOT / 'docs/skins/qa-display-profiles.json').read_text(encoding='utf-8-sig'))
    parser.add_argument('--profile', choices=profiles['profiles'])
    parser.add_argument('--small', action='store_true')
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    if args.small and args.profile:
        parser.error('--small and --profile are mutually exclusive')
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
    profile = 'small-130' if args.small else args.profile or profiles['defaultProfile']
    lab.configure_display(profile)
    try:
        if args.small:
            lab.adb('shell', 'wm', 'size', '720x1600')
            lab.adb('shell', 'wm', 'density', '360')
            lab.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3')
        for skin in args.skins:
            for mode in args.modes:
                for state in args.states:
                    name = f'{skin}-{mode}-{state}' + ('-small' if args.small else '')
                    if args.resume and (args.out / (name + '.png')).exists() and combined.get(name, {}).get('sourceFingerprint') == source and combined.get(name, {}).get('displayProfile') == lab.display_profile:
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
