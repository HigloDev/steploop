"""Verify that short-screen long text can actually scroll above fixed actions."""
import importlib.util
import re
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).with_name('ui-qa-runtime.py'))
rt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rt)
q = rt.q


def swipe():
    # Start inside the text viewport, above the fixed footer on the short device.
    q.adb('shell', 'input', 'swipe', '500', '800', '500', '340', '600')
    time.sleep(2)


def text_visible(part):
    tree = q.tree()
    scrolls = [n for n in tree.iter('node') if n.get('class') == 'android.widget.ScrollView' and n.get('scrollable') == 'true']
    assert len(scrolls) == 1, 'Ambiguous text scroll viewport'
    sx1, sy1, sx2, sy2 = map(int, re.findall(r'\d+', scrolls[0].get('bounds')))
    for node in tree.iter('node'):
        if part in (node.get('text', '') + node.get('content-desc', '')):
            x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
            # A node may remain in accessibility output when clipped. Require
            # a margin from the scroll boundary, then confirm in the PNG.
            if sx1 <= x1 < x2 <= sx2 and sy1 <= y1 < y2 < sy2 - 8:
                return True
    return False


def small_scroll():
    try:
        q.adb('shell', 'wm', 'size', '640x1282')
        q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3')
        q.launch('onboarding')
        for index, part in enumerate(['手持晃动会影响识别', '下次选它就能自动计层', '估算和采样中断仍需核对'], 1):
            for _ in range(3):
                swipe()
            assert text_visible(part), 'Text remains behind the fixed footer: ' + part
            q.capture('small-font130-onboarding-' + str(index) + '-text')
            if index < 3:
                q.tap_label('下一步')
        q.tap_label('开始使用')
        rt.expect('开始爬楼')
        q.launch('privacy')
        for _ in range(5):
            if text_visible('联系方式'):
                break
            swipe()
        assert text_visible('联系方式')
        q.capture('small-font130-privacy-scrolled')
        q.tap_label('联系方式，查看完整协议')
        rt.expect('联系方式')
        q.capture('small-font130-privacy-full-text')
    finally:
        q.adb('shell', 'wm', 'size', '780x1834')
        q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')


rt.case('short screen fixed footer leaves all three onboarding hints and privacy contact text scrollable', small_scroll)
