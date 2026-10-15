"""Paired native light/dark screenshots, using only the isolated visual lab."""
import argparse
import importlib
import json
import time
from pathlib import Path

from PIL import Image

q = importlib.import_module('ui-qa-capture')
q.OUT = q.ROOT / 'docs/qa/theme-pair-20261010/after'
q.OUT.mkdir(parents=True, exist_ok=True)
RESULTS = q.OUT / 'native-checks.json'

PAGES = {
    'home': '开始爬楼', 'history': '本周成果', 'settings': '运动播报',
    'summary': '训练完成', 'template': '训练完成', 'share': '分享成绩',
    'onboarding': '开始之前', 'privacy': '隐私协议', 'privacy-first': '隐私协议',
    'legacy': '旧版单轮记录', 'diagnostic': '传感器诊断', 'empty': '开始爬楼',
    'history-heights': '本周成果', 'references-everest': '开始爬楼',
}
WORKOUTS = {
    **{state: '长按结束并保存' for state in ['calibrating', 'calibration_top', 'climbing',
       'descending', 'waiting', 'climbing-estimated']},
    'starting': '正在启动传感器', 'start-error': '暂时无法开始训练',
    'finishing': '正在保存成绩', 'save-failed': '成绩还没有保存完成',
    'save-failed-no-recovery': '成绩还没有保存完成',
}


def labels():
    return [n.get('text', '') + n.get('content-desc', '') for n in q.tree().iter('node')
            if n.get('package') == q.PACKAGE]


def expect(text):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        current = labels()
        if any(text in label for label in current):
            return
        time.sleep(0.3)
    raise AssertionError('Missing visible content: ' + text)


def launch(state, anchor=None):
    q.adb('shell', 'am', 'force-stop', q.PACKAGE)
    q.adb('shell', 'am', 'start', '-n', q.PACKAGE + '/com.zxn.palou.MainActivity',
          '-a', 'android.intent.action.VIEW', '-d', 'palou-uiqa://preview?state=' + state)
    expected = anchor or PAGES.get(state) or WORKOUTS.get(state)
    deadline = time.monotonic() + 65
    while time.monotonic() < deadline:
        time.sleep(0.5)
        try:
            if any(expected in label for label in labels()):
                time.sleep(1.2)
                return
        except RuntimeError:
            pass
    raise RuntimeError('App did not become ready: ' + state)


def appearance(mode):
    q.adb('shell', 'cmd', 'uimode', 'night', 'yes' if mode == 'dark' else 'no')
    time.sleep(0.8)


def capture(mode, name, workout=False, check_root=True):
    q.capture(mode + '-' + name)
    root = Image.open(q.OUT / 'actual' / (mode + '-' + name + '.png')).convert('RGB').getpixel((2, 2))
    if check_root:
        expected = (11, 11, 12) if mode == 'dark' and workout else (18, 17, 16) if mode == 'dark' else (247, 245, 242)
        assert max(abs(a - b) for a, b in zip(root, expected)) <= 3, (name, mode, root, expected)
    data = json.loads(RESULTS.read_text(encoding='utf-8')) if RESULTS.exists() else {}
    data[mode + '-' + name] = {'appearance': mode, 'rootRGB': root, 'rootChecked': check_root,
                              'package': q.PACKAGE, 'nativeScreenshot': True}
    RESULTS.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def sheets(mode):
    launch('home')
    q.tap_label('起始楼层 1 楼，点按修改')
    expect('从几楼出发？')
    capture(mode, 'floor-picker', check_root=False)
    q.adb('shell', 'input', 'keyevent', '4')
    expect('开始爬楼')
    q.tap_label('管理 城市花园·A座')
    capture(mode, 'building-actions', check_root=False)
    q.tap_label('重命名')
    expect('楼栋名称')
    capture(mode, 'building-rename', check_root=False)
    launch('home')
    q.tap_label('查看全部 37 种高度参照')
    expect('37 种高度参照')
    capture(mode, 'height-references', check_root=False)
    for _ in range(6):
        if any('珠穆朗玛峰' in label for label in labels()):
            break
        q.adb('shell', 'input', 'swipe', '400', '1510', '400', '420', '300')
        time.sleep(0.5)
    expect('珠穆朗玛峰')
    capture(mode, 'height-references-bottom', check_root=False)
    launch('history')
    # Label comes from the live tree, so dates and metric text are not hardcoded.
    more = next(label for label in labels() if label.startswith('更多操作 '))
    q.tap_label(more)
    expect('查看与修改')
    capture(mode, 'history-actions', check_root=False)
    launch('summary')
    edit = next(label for label in labels() if '点按修改' in label)
    q.tap_label(edit)
    expect('修改层数')
    capture(mode, 'round-edit', check_root=False)


def interactions(mode):
    launch('start-error')
    q.tap_label('重试')
    expect('长按结束并保存')
    capture(mode, 'sensor-retry', workout=True)
    launch('calibrating')
    q.tap_label('到了一层，记为 6 楼')
    expect('到了一层，记为 7 楼')
    q.tap_label('撤销上一次')
    expect('到了一层，记为 6 楼')
    q.tap_label('到顶了，结束标定爬楼')
    expect('标定完成')
    q.tap_label('已回到楼下，开始下一轮')
    expect('准备第 3 轮')
    q.adb('shell', 'input', 'keyevent', '4')
    expect('训练仍在进行')
    capture(mode, 'back-guard', workout=True)
    q.tap_label('长按结束并保存，需要长按', hold=True)
    expect('训练完成')
    capture(mode, 'finish-result')
    launch('save-failed')
    q.tap_label('重试保存')
    expect('训练完成')
    capture(mode, 'save-retry-result')
    launch('save-failed')
    q.tap_label('稍后再存 · 返回首页')
    expect('开始爬楼')
    capture(mode, 'save-later-home')


def switching():
    appearance('light')
    launch('calibrating')
    q.tap_label('到了一层，记为 6 楼')
    for mode in ['light', 'dark', 'light']:
        appearance(mode)
        expect('到了一层，记为 7 楼')
        expect('楼层刻度，已完成 5 层')
        capture(mode, 'switch-in-place', workout=True)


def share_switch(expect_old_error=False):
    appearance('light')
    launch('share')
    for mode in ['dark', 'light']:
        appearance(mode)
        expect('分享成绩')
        capture(mode, 'share-switch')
        q.tap_label('保存图片到相册')
        if expect_old_error:
            expect('海报正在准备，请稍后再试')
            previous = q.OUT
            q.OUT = q.ROOT / 'docs/qa/theme-pair-20261010/before'
            q.capture('dark-share-switch-save-error')
            q.OUT = previous
            return
        expect('海报已保存到相册')
        capture(mode, 'share-switch-saved', check_root=False)
        rows = q.adb('shell', 'content', 'query', '--uri', 'content://media/external/images/media',
                     '--projection', '_id:_data:width:height:owner_package_name').splitlines()
        import re
        own = [row for row in rows if 'owner_package_name=' + q.PACKAGE in row]
        row = max(own, key=lambda item: int(re.search(r'_id=(\d+)', item).group(1)))
        image_path = re.search(r'_data=(.*?), width=', row).group(1)
        exported = q.OUT / 'exports' / (mode + '-poster.png')
        exported.parent.mkdir(exist_ok=True)
        exported.write_bytes(q.adb('exec-out', 'cat', image_path, binary=True))
        assert Image.open(exported).size == (1080, 1350), 'Incorrect poster export dimensions'
        q.tap_label('OK')


def stress(mode):
    import re
    q.adb('shell', 'wm', 'size', '720x1440')
    q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3')
    try:
        for state, anchor in [('climbing-long', '长按结束并保存'), ('calibrating', '长按结束并保存'),
                              ('save-failed', '重试保存'), ('template', '训练完成')]:
            launch(state, anchor)
            # Preserve full raw native screenshot; normalized content retains the short viewport.
            capture(mode, 'large-text-' + state, workout=state != 'template')
            if state in ['climbing-long', 'calibrating']:
                button = next(n for n in q.tree().iter('node') if n.get('content-desc') == '长按结束并保存，需要长按')
                x1, y1, x2, y2 = map(int, re.findall(r'\d+', button.get('bounds')))
                assert y1 >= 98 and y2 <= 1392 and y2 - y1 >= 96, 'Save action is clipped or smaller than 48dp'
            if state == 'save-failed':
                q.adb('shell', 'input', 'swipe', '400', '1200', '400', '500', '350')
                time.sleep(0.7)
                expect('重试保存')
                capture(mode, 'large-text-save-failed-actions', workout=True)
                q.tap_label('重试保存')
                expect('训练完成')
    finally:
        q.adb('shell', 'wm', 'size', '780x1834')
        q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('group', choices=['pages', 'workouts', 'screens', 'sheets', 'interactions', 'switching', 'share-switch', 'stress'])
    parser.add_argument('--mode', choices=['light', 'dark'], default='light')
    parser.add_argument('--only', nargs='+', help='Capture selected states from the chosen group')
    parser.add_argument('--expect-old-save-error', action='store_true', help='Reproduce the historical poster preparation defect')
    args = parser.parse_args()
    appearance(args.mode)
    if args.group in ['pages', 'workouts', 'screens']:
        states = PAGES if args.group == 'pages' else WORKOUTS if args.group == 'workouts' else {**PAGES, **WORKOUTS}
        for state in args.only or states:
            launch(state)
            capture(args.mode, state, workout=state in WORKOUTS)
    elif args.group == 'switching':
        switching()
    elif args.group == 'share-switch':
        share_switch(args.expect_old_save_error)
    else:
        globals()[args.group](args.mode)
