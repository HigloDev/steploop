"""Native evidence in an isolated package at the connected Xiaomi 14's geometry."""
import argparse
import importlib
import json
import re
import sqlite3
import subprocess
import tarfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

qa = importlib.import_module('theme-pair-capture')
q = qa.q
OUT = q.ROOT / 'docs/qa/xiaomi14-improvements-20261010'
for folder in ['raw', 'actual']:
    (OUT / folder).mkdir(parents=True, exist_ok=True)
RESULTS = OUT / 'native-checks.json'
MODES = ['light', 'dark']
checks = json.loads(RESULTS.read_text(encoding='utf-8')) if RESULTS.exists() else {}


def visible(text):
    return [n for n in q.tree().iter('node') if n.get('package') == q.PACKAGE
            and text in (n.get('text', '') + n.get('content-desc', ''))]


def expect(text):
    qa.expect(text)


def capture(name, include_tree=True):
    ui = q.tree() if include_tree else None
    raw = OUT / 'raw' / (name + '.png')
    raw.write_bytes(q.adb('exec-out', 'screencap', '-p', binary=True))
    with Image.open(raw) as picture:
        picture.resize((400, round(picture.height * 400 / picture.width)), Image.Resampling.LANCZOS).save(OUT / 'actual' / (name + '.png'))
    if ui is not None:
        (OUT / 'actual' / (name + '.xml')).write_text(ET.tostring(ui, encoding='unicode'), encoding='utf-8')
    print(json.dumps({'capture': name}), flush=True)


def bounds(node):
    return list(map(int, re.findall(r'\d+', node.get('bounds', ''))))


def tap_prefix(prefix):
    matches = visible(prefix)
    candidates = [n for n in matches if n.get('clickable') == 'true'] or matches
    assert candidates, 'Missing control: ' + prefix
    x1, y1, x2, y2 = bounds(candidates[0])
    q.adb('shell', 'input', 'tap', str((x1 + x2)//2), str((y1 + y2)//2))
    time.sleep(0.8)


def geometry(size='1200x2670', density=480, font=1.25):
    q.adb('shell', 'wm', 'size', size)
    q.adb('shell', 'wm', 'density', str(density))
    q.adb('shell', 'settings', 'put', 'system', 'font_scale', str(font))
    time.sleep(0.5)


def save_check(name, value=True):
    checks[name] = value
    RESULTS.write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')


def lab_storage(stage):
    assert q.SERIAL == 'emulator-5582' and q.PACKAGE == 'com.zxn.palou.uiqa'
    folder = q.ROOT / '.expo-export-check/xiaomi14-improvements-20261010' / ('lab-db-' + stage)
    folder.mkdir(parents=True, exist_ok=True)
    archive_path = folder / 'data.tar'
    archive_path.write_bytes(q.adb('exec-out', 'su', '0', 'tar', '-cf', '-', '-C', '/data/user/0/' + q.PACKAGE, 'databases', binary=True))
    with tarfile.open(archive_path) as archive:
        for member in archive.getmembers():
            name = Path(member.name).name
            if member.isfile() and name in ['RKStorage', 'RKStorage-wal', 'RKStorage-shm', 'RKStorage-journal']:
                (folder / name).write_bytes(archive.extractfile(member).read())
    with sqlite3.connect(folder / 'RKStorage') as db:
        return dict(db.execute('SELECT key,value FROM catalystLocalStorage'))


def reveal(prefix):
    for _ in range(5):
        if visible(prefix): return
        q.adb('shell', 'input', 'swipe', '600', '2100', '600', '1100', '300')
        time.sleep(0.5)
    raise AssertionError('Unreachable control: ' + prefix)


def pages():
    geometry()
    for mode in MODES:
        qa.appearance(mode)
        qa.launch('home')
        assert not visible('查看 37 种高度参照')
        expect('分享本周成果')
        capture(mode + '-home')
        tap_prefix('本周累计爬升')
        expect('下一站')
        capture(mode + '-weekly-height')
        q.tap_label('关闭高度参照')
        q.tap_label('分享本周成果')
        expect('本周成果分享')
        capture(mode + '-weekly-share')
        q.tap_label('高度足迹')
        capture(mode + '-weekly-share-height')
        qa.launch('weekly-empty', '本周成果分享')
        expect('本周还没有训练')
        capture(mode + '-weekly-empty')
        save_check(mode + '-weekly-entry-and-empty')


def workouts():
    geometry()
    for mode in MODES:
        qa.appearance(mode)
        for state in ['calibrating', 'calibration_top', 'climbing', 'climbing-long', 'climbing-estimated', 'descending', 'waiting']:
            qa.launch(state, '长按结束并保存')
            for label in ['当前步数', '平均爬楼频率', '消耗热量', '累计爬升']:
                expect(label)
                nodes = visible(label)
                assert any(bounds(node)[1] >= 100 and bounds(node)[3] <= 2460 for node in nodes), 'Metric off screen: ' + label
            capture(mode + '-' + state)
        save_check(mode + '-live-metrics-visible-at-xiaomi-font')


def interactions():
    geometry()
    for mode in MODES:
        qa.appearance(mode)
        qa.launch('home')
        tap_prefix('起始楼层 1 楼')
        expect('从几楼出发？')
        q.tap_label('降低起始楼层')
        assert visible('-1') and not any(n.get('text') == '0' for n in q.tree().iter('node'))
        capture(mode + '-floor-basement')
        q.tap_label('提高起始楼层')
        assert visible('1') and not any(n.get('text') == '0' for n in q.tree().iter('node'))
        capture(mode + '-floor-positive')
        save_check(mode + '-picker-skips-zero-both-directions')
        qa.launch('weekly', '本周成果分享')
        q.tap_label('高度足迹')
        qa.appearance('dark' if mode == 'light' else 'light')
        expect('本周成果分享')
        qa.appearance(mode)
        reveal('保存海报')
        q.tap_label('保存海报')
        reveal('本周成果海报已保存到相册')
        expect('本周成果海报已保存到相册')
        capture(mode + '-weekly-saved')
        q.tap_label('复制本周分享文案')
        expect('本周分享文案已复制')
        q.tap_label('分享本周成果')
        time.sleep(1)
        capture(mode + '-weekly-native-share')
        q.adb('shell', 'input', 'keyevent', '4')
        time.sleep(1)
        expect('本周成果分享')
        save_check(mode + '-weekly-save-copy-share-and-theme-switch')


def preview():
    geometry()
    for mode in MODES:
        qa.appearance(mode)
        qa.launch('settings')
        for _ in range(4):
            if visible('预览盖楼结算'):
                break
            q.adb('shell', 'input', 'swipe', '600', '2080', '600', '1040', '280')
            time.sleep(0.5)
        expect('试一下楼层震动')
        capture(mode + '-settings-feedback')
        before = lab_storage(mode + '-before-preview')
        q.tap_label('试一下楼层震动')
        (OUT / 'video').mkdir(exist_ok=True)
        remote_clip = '/sdcard/steploop-uiqa-' + mode + '-completion.mp4'
        recorder = subprocess.Popen(['adb', '-s', q.SERIAL, 'shell', 'screenrecord', '--time-limit', '9', remote_clip], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        time.sleep(0.5)
        # Fast capture of actual animation stages; no q.tap_label's two-second wait.
        node = visible('预览盖楼结算')[0]
        x1, y1, x2, y2 = bounds(node)
        q.adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
        time.sleep(0.2)
        capture(mode + '-building-stage-1', include_tree=False)
        time.sleep(0.4)
        capture(mode + '-building-stage-2', include_tree=False)
        time.sleep(0.4)
        capture(mode + '-building-stage-3', include_tree=False)
        recorder.wait(timeout=15)
        assert recorder.returncode == 0, recorder.stderr.read().decode('utf-8', errors='replace')
        q.adb('pull', remote_clip, str(OUT / 'video' / (mode + '-completion.mp4')))
        expect('预览盖楼结算')
        assert lab_storage(mode + '-after-preview') == before, 'Preview changed saved data'
        pid = q.adb('shell', 'pidof', q.PACKAGE).strip().split()[0]
        logs = q.adb('logcat', '-d', '--pid=' + pid, '-s', 'ReactNativeJS:I', '*:S')
        assert '[completion-sound] loaded' in logs and '[completion-sound] finished' in logs, 'Native audio did not complete in ' + mode
        save_check(mode + '-native-chime-decoded-and-finished')
        save_check(mode + '-animation-preview-returns-without-new-record')
    logs = q.adb('logcat', '-d', '-s', 'ReactNativeJS:I', '*:S')
    assert '[completion-sound] finished' in logs, 'Native audio did not report completion'
    save_check('native-chime-decoded-and-finished')


def saved_flow():
    geometry(font=1)
    for mode in MODES:
        qa.appearance(mode)
        qa.launch('home')
        # Visual fixtures use a frozen example date. Native sensor timestamps
        # require the real wall clock, so reload without the date override.
        qa.launch('persist', '开始爬楼')
        before = lab_storage(mode + '-before-save')
        q.tap_label(next(label for label in qa.labels() if label.startswith('开始爬楼，从 ')))
        expect('长按结束并保存')
        for _ in range(3):
            q.tap_label(next(label for label in qa.labels() if label.startswith('到了一层，记为 ')))
        capture(mode + '-real-manual-training')
        node = visible('长按结束并保存')[0]
        x1, y1, x2, y2 = bounds(node)
        x, y = str((x1+x2)//2), str((y1+y2)//2)
        q.adb('shell', 'input', 'swipe', x, y, x, y, '1900')
        expect('成绩已保存')
        capture(mode + '-real-saved-celebration')
        time.sleep(3.5)
        expect('训练完成')
        capture(mode + '-real-saved-summary')
        after = lab_storage(mode + '-after-save')
        old = {workout['id']: workout for workout in json.loads(before.get('palou.workouts.v1', '[]'))}
        current = {workout['id']: workout for workout in json.loads(after.get('palou.workouts.v1', '[]'))}
        assert all(current.get(key) == workout for key, workout in old.items()), 'Existing lab records changed'
        inserted = [workout for key, workout in current.items() if key not in old]
        assert len(inserted) == 1 and inserted[0]['totalFloorsCompleted'] == 3
        assert after.get('steploop.fusionActive.v1') in [None, '', 'null']
        save_check(mode + '-real-save-precedes-celebration-and-retains-records')
    geometry()


def stress():
    for label, size, density, font in [('tall', '1200x3360', 480, 1), ('small-large-font', '720x1440', 320, 1.3)]:
        geometry(size, density, font)
        screen_width, screen_height = map(int, size.split('x'))
        for mode in MODES:
            qa.appearance(mode)
            for state in ['calibrating', 'climbing']:
                qa.launch(state, '长按结束并保存')
                capture(mode + '-' + label + '-' + state)
                end = visible('长按结束并保存')[0]
                x1, y1, x2, y2 = bounds(end)
                assert y1 > 0 and y2 < screen_height and (y2-y1) >= 48 * density/160
                if label == 'small-large-font':
                    q.adb('shell', 'input', 'swipe', str(screen_width//2), str(screen_height*2//3), str(screen_width//2), str(screen_height//3), '300')
                    time.sleep(0.6)
                    expect('消耗热量')
                    if state == 'calibrating': expect('到了一层')
                    capture(mode + '-' + label + '-' + state + '-scrolled')
        save_check(label + '-reachable-controls-and-metrics')
    geometry()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', choices=['pages', 'workouts', 'interactions', 'preview', 'stress', 'saved-flow'])
    parser.add_argument('--appearance', choices=['light', 'dark'])
    args = parser.parse_args()
    if args.appearance: MODES = [args.appearance]
    actions = {'pages': pages, 'workouts': workouts, 'interactions': interactions, 'preview': preview, 'stress': stress, 'saved-flow': saved_flow}
    for name, action in actions.items():
        if args.only and name != args.only: continue
        action()
    save_check('device', {'serial': q.SERIAL, 'package': q.PACKAGE, 'size': '1200x2670', 'density': 480, 'fontScale': 1.25})
