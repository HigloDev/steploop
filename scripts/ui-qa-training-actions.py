"""Verify the visible workout actions only in the isolated Android QA app."""
import importlib.util
import json
import sqlite3
import time
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location('capture', Path(__file__).with_name('ui-qa-capture.py'))
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)
q.OUT = q.ROOT / 'docs/qa/workout-actions-20261010'
q.OUT.mkdir(parents=True, exist_ok=True)
results = []
SAVE = '长按结束并保存，需要长按'
DISCARD = '长按放弃本次，需要长按'


def nodes():
    return list(q.tree().iter('node'))


def has(text):
    return any(text in (n.get('text', '') + n.get('content-desc', '')) for n in nodes())


def visible(label):
    node = next(n for n in nodes() if label in [n.get('text'), n.get('content-desc')])
    x1, y1, x2, y2 = map(int, node.get('bounds').replace('][', ',').strip('[]').split(','))
    assert x2 > x1 and y2 > y1 and y1 >= 0, 'Control is clipped: ' + label
    return (x1 + x2) // 2, (y1 + y2) // 2


def prefix_label(prefix):
    return next(n.get('content-desc') for n in nodes() if n.get('content-desc', '').startswith(prefix))


def record(name, action):
    action()
    results.append({'case': name, 'result': 'passed'})
    (q.OUT / 'checks.json').write_text(json.dumps({'device': q.SERIAL, 'package': q.PACKAGE,
        'realPhoneTrainingTested': False, 'checks': results}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(results[-1], ensure_ascii=False), flush=True)


def phase_layouts():
    for phase in ['calibrating', 'calibration_top', 'climbing', 'descending', 'waiting']:
        q.launch(phase)
        visible(SAVE)
        visible(DISCARD)
        if phase == 'calibrating':
            visible('到顶了，结束标定爬楼')
        q.capture('inline-' + phase)
record('all five workout phases show save and discard on the page', phase_layouts)


def back_and_short_press():
    q.launch('calibrating')
    q.tap_label(SAVE)
    assert has(SAVE)
    q.tap_label(DISCARD)
    assert has(SAVE)
    x, y = visible(SAVE)
    q.adb('shell', 'input', 'swipe', str(x), str(y), str(x), str(y), '500')
    time.sleep(2)
    assert has(SAVE)
    q.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    time.sleep(2)
    assert has('训练仍在进行，请使用下方按钮')
    assert not has('要结束这次训练吗？')
    visible(SAVE)
    visible(DISCARD)
    q.capture('inline-back-hint')
record('back stays in training without an Alert and short or cancelled holds do not exit', back_and_short_press)


def large_text():
    for name, size, font in [('phone-font125', '800x1780', '1.25'), ('small-font130', '640x1282', '1.3')]:
        q.adb('shell', 'wm', 'size', size)
        q.adb('shell', 'settings', 'put', 'system', 'font_scale', font)
        q.launch('calibrating')
        visible(SAVE)
        visible(DISCARD)
        visible('到顶了，结束标定爬楼')
        q.capture('inline-' + name)
    q.adb('shell', 'wm', 'size', '780x1834')
    q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
record('phone 125 percent text and small screen 130 percent text keep actions reachable', large_text)


def failed_save():
    for state in ['save-failed', 'save-failed-no-recovery']:
        q.launch(state)
        q.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
        time.sleep(2)
        assert has('成绩还没有保存完成')
        assert not has('请先保存成绩')
        assert has('稍后再存 · 返回首页') == (state == 'save-failed')
        q.capture('inline-' + state)
        q.tap_label('重试保存')
        assert has('训练完成')
record('failed save blocks unsafe exit and retry remains available', failed_save)


def workouts():
    directory = q.ROOT / '.expo-export-check/inline-training-actions-20261010' / uuid.uuid4().hex
    directory.mkdir(parents=True)
    for name in q.adb('shell', 'run-as', q.PACKAGE, 'ls', 'databases').split():
        if name in ['RKStorage', 'RKStorage-wal', 'RKStorage-shm', 'RKStorage-journal']:
            (directory / name).write_bytes(q.adb('exec-out', 'run-as', q.PACKAGE, 'cat', 'databases/' + name, binary=True))
    with sqlite3.connect(directory / 'RKStorage') as db:
        row = db.execute("SELECT value FROM catalystLocalStorage WHERE key='palou.workouts.v1'").fetchone()
    return json.loads(row[0]) if row else []


def live_save():
    q.launch('persist')
    before = {w['id'] for w in workouts()}
    q.tap_label(prefix_label('开始爬楼，从'))
    time.sleep(3)
    for _ in range(2):
        q.tap_label(prefix_label('到了一层，记为'))
    q.tap_label('到顶了，结束标定爬楼')
    q.tap_label(SAVE)
    assert has(SAVE)
    q.tap_label(SAVE, hold=True)
    assert has('训练完成')
    saved = [w for w in workouts() if w['id'] not in before]
    assert len(saved) == 1 and saved[0]['totalFloorsCompleted'] == 2
    q.capture('inline-live-saved')
    q.launch('persist')
    assert any(w['id'] == saved[0]['id'] for w in workouts())
record('real workout hook saves two marked floors exactly once and survives relaunch', live_save)


def live_discard():
    q.launch('persist')
    before = workouts()
    q.tap_label(prefix_label('开始爬楼，从'))
    time.sleep(3)
    q.tap_label(prefix_label('到了一层，记为'))
    q.tap_label(DISCARD)
    assert has(SAVE) and workouts() == before
    q.tap_label(DISCARD, hold=True)
    assert has('开始爬楼') and workouts() == before
    q.capture('inline-live-discarded')
record('real workout hook short discard keeps training and long discard preserves existing records', live_discard)
