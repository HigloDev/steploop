"""Exercise the real sensor-connected workout, exports and copy controls in the QA app."""
import importlib.util
import json
import sqlite3
import sys
import time
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).with_name('ui-qa-runtime.py'))
rt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rt)
q = rt.q
rt.resume_from = sys.argv[1] if len(sys.argv) > 1 else ''

def workouts():
    root = q.ROOT / '.expo-export-check' / 'qa-db' / uuid.uuid4().hex
    root.mkdir(parents=True)
    for name in q.adb('shell', 'run-as', q.PACKAGE, 'ls', 'databases').split():
        if name in ['RKStorage', 'RKStorage-wal', 'RKStorage-shm', 'RKStorage-journal']:
            (root / name).write_bytes(q.adb('exec-out', 'run-as', q.PACKAGE, 'cat', 'databases/' + name, binary=True))
    db = sqlite3.connect(root/'RKStorage')
    raw = db.execute("SELECT value FROM catalystLocalStorage WHERE key='palou.workouts.v1'").fetchone()[0]
    db.close()
    return json.loads(raw)

def share_copy():
    q.launch('share')
    q.tap_label('文案')
    rt.scroll(distance=450)
    q.tap_label('一步一步，向上生活。')
    q.capture('share-copy-selected')
    rt.scroll(distance=900)
    q.tap_label('复制成绩数据')
    rt.scroll(distance=500)
    q.tap_label('复制数据')
    rt.expect('复制成功')
    q.tap_label('OK')
    q.capture('share-copy-confirmed')
rt.case('poster copy tab updates the actual preview and sanitized clipboard export succeeds', share_copy)

def exports():
    q.launch('settings')
    rt.scroll(distance=1100)
    q.tap_label('备份与导出')
    rt.scroll(distance=400)
    q.tap_label('保存备份到下载')
    time.sleep(2)
    rt.expect('Download')
    q.capture('backup-download-saved')
    q.tap_label('导出成绩表 Excel')
    time.sleep(2)
    q.capture('csv-system-export')
    q.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    time.sleep(2)
    before = workouts()
    q.tap_label('导入备份')
    rt.expect('合并导入')
    q.tap_label('合并导入')
    time.sleep(2)
    q.capture('backup-import-picker')
    q.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    time.sleep(2)
    assert workouts() == before
    q.capture('backup-import-cancelled')
rt.case('native backup download CSV export and cancelled import preserve stored workouts', exports)

def live_workout():
    # Only the explicitly isolated synthetic-data package receives test permissions.
    for permission in ['ACTIVITY_RECOGNITION', 'POST_NOTIFICATIONS']:
        q.adb('shell', 'pm', 'grant', q.PACKAGE, 'android.permission.' + permission)
    q.launch('persist')
    before = {w['id'] for w in workouts()}
    q.tap_label('开始爬楼，从 1 楼出发，第一轮标定')
    time.sleep(4)
    rt.expect('标定轮')
    q.tap_label('到了一层，记为 2 楼')
    q.tap_label('到了一层，记为 3 楼')
    q.tap_label('到顶了，结束标定爬楼')
    rt.expect('标定完成 · 共 2 层')
    q.capture('live-sensor-calibration-top')
    q.tap_label('长按结束并保存，需要长按', hold=True)
    rt.expect('训练完成')
    saved = [w for w in workouts() if w['id'] not in before]
    assert len(saved) == 1
    assert saved[0]['recognitionVersion'] == 'fusion-v1'
    assert saved[0]['totalFloorsCompleted'] == 2
    q.capture('live-sensor-workout-saved')
    q.tap_label('完成')
    q.tap_label('记录')
    rt.expect('2 层')
    q.capture('live-sensor-workout-history')
    q.launch('persist')
    assert any(w['id'] == saved[0]['id'] for w in workouts())
rt.case('real FusionWorkout hook native sampling manual calibration summary save and history persistence', live_workout)
