"""Refresh all approved states from the real isolated Android UI."""
import importlib.util
import re
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('capture', Path(__file__).with_name('ui-qa-capture.py'))
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)

q.adb('shell', 'wm', 'size', '780x1834')
q.adb('shell', 'wm', 'density', '320')
q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
q.adb('shell', 'cmd', 'uimode', 'night', 'yes')
for state in ['home', 'history', 'settings', 'summary', 'share', 'privacy', 'legacy',
              'climbing', 'calibrating', 'calibration_top', 'descending', 'waiting',
              'template', 'save-failed']:
    q.launch(state)
    q.capture(state)

q.launch('onboarding')
for index in range(1, 4):
    q.capture('onboarding-' + str(index))
    if index < 3:
        q.tap_label('下一步')
q.launch('settings')
q.adb('shell', 'input', 'swipe', '600', '1450', '600', '350', '550')
time.sleep(2)
q.tap_label('备份与导出')
q.tap_label('帮助与关于')
time.sleep(1)
node = next(n for n in q.tree().iter('node') if n.get('text') == '锁屏与后台')
x1,y1,x2,y2 = map(int, re.findall(r'\d+', node.get('bounds')))
delta = y1 - 278
if abs(delta) > 8:
    start = 1400 if delta > 0 else 500
    q.adb('shell', 'input', 'swipe', '700', str(start), '700', str(start - delta), '650')
    time.sleep(2)
q.capture('settings-lower')

try:
    q.adb('shell', 'wm', 'size', '780x1540')
    q.launch('home')
    q.tap_label('起始楼层 1 楼，点按修改')
    q.capture('start-floor')
    q.tap_label('好')
    q.tap_label('管理 城市花园·A座')
    q.capture('manage')
    q.adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '0')
    q.tap_label('重命名')
    q.capture('rename')
    q.launch('summary')
    q.tap_label('第1轮，15 层，点按修改')
    q.capture('edit-round')
finally:
    q.adb('shell', 'wm', 'size', '780x1834')
    q.adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1')
