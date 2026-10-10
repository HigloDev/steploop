"""Additional native theme, empty-state, accessibility and short-screen checks."""
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

def preferences():
    root = q.ROOT / '.expo-export-check' / 'qa-db' / uuid.uuid4().hex
    root.mkdir(parents=True)
    for name in q.adb('shell', 'run-as', q.PACKAGE, 'ls', 'databases').split():
        if name in ['RKStorage', 'RKStorage-wal', 'RKStorage-shm', 'RKStorage-journal']:
            (root / name).write_bytes(q.adb('exec-out', 'run-as', q.PACKAGE, 'cat', 'databases/' + name, binary=True))
    db = sqlite3.connect(root / 'RKStorage')
    raw = db.execute("SELECT value FROM catalystLocalStorage WHERE key='palou.prefs.v1'").fetchone()[0]
    db.close()
    return json.loads(raw)

def onboarding_privacy():
    q.launch('onboarding')
    rt.expect('把手机放稳')
    q.tap_label('下一步')
    rt.expect('第一轮，认识这栋楼')
    q.tap_label('上一步')
    rt.expect('把手机放稳')
    q.tap_label('下一步')
    q.tap_label('下一步')
    rt.expect('结束后，核对每一轮')
    q.tap_label('开始使用')
    rt.expect('开始爬楼')
    q.launch('privacy')
    q.tap_label('信息收集，查看完整协议')
    rt.expect('1.1.2 以楼栋模板标定与训练为主')
    q.capture('privacy-full-policy')
    q.tap_label('信息收集，查看完整协议')
    q.tap_label('不同意')
    rt.expect('未同意隐私协议')
    q.tap_label('返回协议')
    rt.expect('你的记录，留在本机')
    q.tap_label('同意并开始')
    rt.expect('开始爬楼')
rt.case('three onboarding steps back finish and complete privacy text consent flow', onboarding_privacy)

def haptic():
    q.launch('settings')
    assert preferences()['hapticFeedback'] is True
    q.tap_label('震动反馈')
    assert preferences()['hapticFeedback'] is False
    q.launch('persist')
    q.tap_label('设置')
    assert preferences()['hapticFeedback'] is False
    q.capture('haptic-disabled-persisted')
    q.tap_label('震动反馈')
    assert preferences()['hapticFeedback'] is True
rt.case('native labeled haptic switch changes and persists its actual preference', haptic)

def light():
    q.adb('shell', 'cmd', 'uimode', 'night', 'no')
    for state in ['home', 'history', 'settings', 'summary', 'share', 'privacy']:
        q.launch(state)
        q.capture('light-' + state)
    q.adb('shell', 'cmd', 'uimode', 'night', 'yes')
rt.case('six native pages render in light theme', light)

def empty():
    q.launch('empty')
    rt.expect('开始爬楼')
    q.capture('empty-home')
    q.tap_label('记录')
    rt.expect('还没有爬楼记录')
    q.capture('empty-history')
rt.case('empty home and history retain usable primary navigation', empty)

def small():
    try:
        q.adb('shell', 'wm', 'size', '640x1282')
        q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3')
        for state in ['home', 'settings', 'summary', 'share', 'calibrating', 'onboarding', 'privacy']:
            q.launch(state)
            q.capture('small-font130-' + state)
            if state in ['settings', 'summary', 'share', 'onboarding', 'privacy']:
                q.adb('shell', 'input', 'swipe', '500', '1020', '500', '350', '600')
                time.sleep(2)
                q.capture('small-font130-' + state + '-scrolled')
        q.launch('home')
        q.adb('shell', 'input', 'swipe', '500', '1000', '500', '350', '600')
        time.sleep(2)
        q.tap_label('管理 城市花园·A座')
        q.tap_label('重命名')
        rt.fill('楼栋名称', 'UI-QA-LONG-BUILDING-123456')
        q.capture('small-long-name-sheet')
        q.tap_label('保存')
        rt.expect('UI-QA-LONG-BUILDING')
    finally:
        q.adb('shell', 'wm', 'size', '780x1834')
        q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
rt.case('320x568dp with 130 percent text supports scrolling and long-name form save', small)
