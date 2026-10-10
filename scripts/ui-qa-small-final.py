"""Recheck the two short-screen problems after the native layout fixes."""
import importlib.util
import re
from pathlib import Path

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).with_name('ui-qa-runtime.py'))
rt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rt)
q = rt.q


def visible(label):
    nodes = [n for n in q.tree().iter('node') if label in [n.get('text'), n.get('content-desc')]]
    assert nodes, 'Missing ' + label
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', nodes[0].get('bounds')))
    assert x1 >= 0 and x2 <= 640 and y1 >= 98 and y2 <= 1234, (label, (x1, y1, x2, y2))


def small():
    try:
        q.adb('shell', 'wm', 'size', '640x1282')
        q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3')
        q.launch('home')
        visible('开始爬楼，从 1 楼出发，第一轮标定')
        q.capture('small-font130-home')
        q.launch('calibrating')
        visible('到了一层，记为 6 楼')
        visible('到顶了，结束标定爬楼')
        visible('长按结束并保存，需要长按')
        q.capture('small-font130-calibrating')
        q.tap_label('到了一层，记为 6 楼')
        rt.expect('已标定 5 层')
        q.tap_label('撤销上一次')
        rt.expect('已标定 4 层')
        q.tap_label('到顶了，结束标定爬楼')
        visible('已回到楼下，开始下一轮')
        q.capture('small-font130-calibration-top')
        q.tap_label('已回到楼下，开始下一轮')
        rt.expect('准备第')
        visible('长按结束并保存，需要长按')
        q.capture('small-font130-waiting')
        q.launch('home')
        q.adb('shell', 'input', 'swipe', '500', '1000', '500', '350', '600')
        q.tap_label('管理 城市花园·A座')
        q.tap_label('重命名')
        rt.fill('楼栋名称', 'UI-QA-LONG-BUILDING-123456')
        q.capture('small-long-name-sheet')
        q.tap_label('保存')
        rt.expect('UI-QA-LONG-BUILDING')
    finally:
        q.adb('shell', 'wm', 'size', '780x1834')
        q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')


rt.case('post-fix 320x568dp 130 percent text keeps calibration actions visible and long-name form usable', small)
