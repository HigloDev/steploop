"""Verify legacy correction and refresh the granted-permission reference state."""
import importlib.util
import re
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location('runtime', Path(__file__).with_name('ui-qa-runtime.py'))
rt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rt)
q = rt.q


def legacy():
    q.launch('legacy')
    q.tap_label('修正最终楼层')
    rt.scroll(distance=650)
    rt.fill('实际到达楼层', '18')
    q.capture('legacy-correction-entry')
    q.tap_label('保存修正')
    rt.expect('修正已保存')
    q.tap_label('OK')
    result = rt.stored_workout('uiqa-legacy')
    assert result['rounds'][0]['finalFloor'] == 18
    assert result['userCorrectionCount'] == 1
    assert result['trustQuality'] == 'degraded'
    assert result['personalBestEligible'] is False
    q.capture('legacy-correction-saved')
    q.launch('persist')
    assert rt.stored_workout('uiqa-legacy')['rounds'][0]['finalFloor'] == 18


rt.case('legacy correction entry saves manual provenance and persists without raising trust', legacy)


def lower():
    q.launch('settings')
    rt.scroll(distance=1100)
    q.tap_label('备份与导出')
    q.tap_label('帮助与关于')
    time.sleep(1)
    node = next(n for n in q.tree().iter('node') if n.get('text') == '锁屏与后台')
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
    delta = y1 - 278
    if abs(delta) > 8:
        start = 1400 if delta > 0 else 500
        q.adb('shell', 'input', 'swipe', '700', str(start), '700', str(start - delta), '650')
        time.sleep(2)
    rt.expect('已允许')
    rt.expect('如何判断爬楼')
    q.capture('settings-lower')


rt.case('settings lower shows actual granted permissions backup help and version together', lower)
