"""Match the approved keyboard-hidden sheet state and verify visible actions."""
import importlib.util
import re
from pathlib import Path

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).with_name('ui-qa-runtime.py'))
rt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rt)
q = rt.q


def visible(label):
    node = next(n for n in q.tree().iter('node') if label in [n.get('text'), n.get('content-desc')])
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
    assert x1 >= 0 and x2 <= 780 and y1 >= 98 and y2 <= 1492, (label, node.get('bounds'))


def sheets():
    try:
        q.adb('shell', 'wm', 'size', '780x1540')
        q.adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '0')
        q.launch('home')
        q.tap_label('起始楼层 1 楼，点按修改')
        visible('好')
        q.capture('start-floor')
        q.tap_label('好')
        q.tap_label('管理 城市花园·A座')
        visible('完成')
        q.capture('manage')
        q.tap_label('重命名')
        visible('取消')
        visible('保存')
        q.capture('rename')
        q.tap_label('取消')
        rt.expect('开始爬楼')
        q.launch('summary')
        q.tap_label('第1轮，15 层，点按修改')
        visible('取消')
        visible('保存')
        q.capture('edit-round')
        q.tap_label('加一层')
        rt.expect('从 1 楼爬到 17 楼，共爬升 16 层。')
        q.tap_label('保存')
        rt.expect('总爬升 93 米，31 层')
    finally:
        q.adb('shell', 'wm', 'size', '780x1834')
        q.adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1')


rt.case('post-fix four keyboard-hidden native sheets keep all final actions visible and correction accurate', sheets)
