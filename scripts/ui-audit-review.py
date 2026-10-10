"""Fresh native re-audit. Uses only the isolated debug lab and synthetic records."""
import argparse
import importlib.util
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

s = importlib.util.spec_from_file_location('q', Path(__file__).with_name('ui-qa-capture.py'))
q = importlib.util.module_from_spec(s)
s.loader.exec_module(q)
p = argparse.ArgumentParser()
p.add_argument('group', choices=['main', 'support', 'panels', 'adapt', 'adapt-touch', 'final-extras', 'summary-final'])
args = p.parse_args()
q.OUT = q.ROOT / 'docs/qa/ui-audit-20261010/after'

def capture(name, state=None):
    q.capture(name)
    (q.OUT / 'metadata').mkdir(exist_ok=True)
    (q.OUT / 'metadata' / (name+'.json')).write_text(json.dumps({
        'capturedAt': datetime.now(timezone.utc).isoformat(), 'device': q.SERIAL,
        'package': q.PACKAGE, 'state': state, 'syntheticData': True,
        'usesProductionPresentation': True, 'size': q.adb('shell','wm','size').strip(),
        'fontScale': q.adb('shell','settings','get','system','font_scale').strip(),
        'realClimbingAccuracyTested': False,
    }, indent=2), encoding='utf-8')

def config(size='780x1834', font='1.0', dark='yes'):
    q.adb('shell','wm','size',size)
    q.adb('shell','settings','put','system','font_scale',font)
    q.adb('shell','cmd','uimode','night',dark)
    q.adb('shell','settings','put','secure','show_ime_with_hard_keyboard','0')

if args.group == 'main':
    config()
    for state in ['home','history','settings','climbing','calibrating','summary','share']:
        q.launch(state); capture(state,state)
    q.launch('onboarding'); capture('onboarding-1','onboarding')
    q.tap_label('下一步'); capture('onboarding-2','onboarding')
    q.tap_label('下一步'); capture('onboarding-3','onboarding')
elif args.group == 'support':
    config()
    for state in ['privacy','legacy','diagnostic','calibration_top','descending','waiting','template','save-failed']:
        q.launch(state)
        if state == 'diagnostic': q.tap_label('开始诊断采集')
        capture(state,state)
if args.group in ['support', 'panels']:
    config()
    q.launch('settings')
    for label in ['备份与导出', '帮助与关于']:
        for _ in range(6):
            if any(label in [n.get('text'),n.get('content-desc')] for n in q.tree().iter('node')):
                q.tap_label(label);break
            q.adb('shell','input','swipe','700','1400','700','800','600');time.sleep(1)
        else: raise AssertionError('Cannot reach '+label)
    for _ in range(3):
        nodes=[n for n in q.tree().iter('node') if n.get('text')=='锁屏与后台']
        if nodes:
            delta=int(re.findall(r'\d+',nodes[0].get('bounds'))[1])-278
            if abs(delta)<8: break
            q.adb('shell','input','swipe','700','1400','700',str(1400-delta),'700');time.sleep(1)
        else: q.adb('shell','input','swipe','700','1400','700','900','700');time.sleep(1)
    capture('settings-lower','settings')
    config('780x1540')
    q.launch('home'); q.tap_label('起始楼层 1 楼，点按修改'); capture('start-floor','home')
    q.tap_label('好'); q.tap_label('管理 城市花园·A座'); capture('manage','home')
    q.tap_label('重命名'); capture('rename','home')
    q.launch('summary'); q.tap_label('第1轮，15 层，点按修改'); capture('edit-round','summary')
if args.group == 'adapt':
    config('800x1780','1.25')
    for state in ['home','history','settings','climbing','calibrating','calibration_top','descending','waiting','summary','template','share','privacy','onboarding']:
        q.launch(state); capture('font125-'+state,state)
    config('640x1282','1.3')
    for state in ['home','history','settings','climbing','calibrating','summary','template','share','privacy','onboarding']:
        q.launch(state); capture('small130-'+state,state)
    config(dark='no')
    for state in ['home','history','settings','summary','template','share','privacy','onboarding']:
        q.launch(state); capture('light-'+state,state)
    config()
    q.launch('empty'); capture('no-building-home','empty')
    q.tap_label('记录'); q.tap_label('中断'); capture('empty-filter-history','empty')
if args.group == 'adapt-touch':
    for prefix,size,font,dark in [('font125','800x1780','1.25','yes'),('small130','640x1282','1.3','yes'),('light','780x1834','1.0','no')]:
        config(size,font,dark)
        for state in ['home','history','settings','share']:
            q.launch(state);capture(prefix+'-'+state,state)
    config()
if args.group == 'final-extras':
    config()
    q.launch('legacy');capture('legacy','legacy')
    for _ in range(6):
        if any(n.get('text')=='单层用时' for n in q.tree().iter('node')):break
        q.adb('shell','input','swipe','700','1500','700','850','600');time.sleep(1)
    q.tap_label('单层用时')
    for _ in range(4):
        if any(n.get('text')=='这条旧版记录没有单层用时明细。' for n in q.tree().iter('node')):break
        q.adb('shell','input','swipe','700','1450','700','950','500');time.sleep(1)
    assert any(n.get('text')=='这条旧版记录没有单层用时明细。' for n in q.tree().iter('node'))
    capture('legacy-splits','legacy')
    q.launch('settings')
    for label in ['备份与导出', '帮助与关于']:
        for _ in range(8):
            if any(label in [n.get('text'),n.get('content-desc')] for n in q.tree().iter('node')):
                q.tap_label(label); break
            q.adb('shell','input','swipe','700','1400','700','800','600');time.sleep(1)
        else: raise AssertionError('Cannot reach '+label)
    q.adb('shell','input','swipe','700','1500','700','500','600');time.sleep(1)
    capture('settings-help-end','settings')
    q.launch('diagnostic');q.tap_label('修改真实动作')
    handle=next(n for n in q.tree().iter('node') if n.get('content-desc')=='Drag handle')
    x1,y1,x2,y2=map(int,re.findall(r'\d+',handle.get('bounds')))
    q.adb('shell','input','swipe',str((x1+x2)//2),str((y1+y2)//2),str((x1+x2)//2),'210','600');time.sleep(2)
    capture('diagnostic-config-top','diagnostic')
    for _ in range(4):
        if any(n.get('content-desc')=='设备品牌' for n in q.tree().iter('node')):break
        q.adb('shell','input','swipe','600','1560','600','650','600');time.sleep(1)
    capture('diagnostic-config-end','diagnostic')
    q.tap_label('Close sheet')
    q.launch('empty');capture('no-building-home','empty')
    q.tap_label('记录');q.tap_label('中断');capture('empty-filter-history','empty')
if args.group == 'summary-final':
    for prefix,size,font,dark in [('', '780x1834','1.0','yes'),('font125-','800x1780','1.25','yes'),('small130-','640x1282','1.3','yes'),('light-','780x1834','1.0','no')]:
        config(size,font,dark);q.launch('summary');capture(prefix+'summary','summary')
    config()
