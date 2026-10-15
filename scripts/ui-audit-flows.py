"""Audit interaction checks; never addresses a physical device or clears app data."""
import argparse
import importlib.util
import json
import re
import sqlite3
import time
import uuid
from pathlib import Path

spec=importlib.util.spec_from_file_location('rt',Path(__file__).with_name('ui-qa-runtime.py'))
rt=importlib.util.module_from_spec(spec);spec.loader.exec_module(rt)
q=rt.q;q.OUT=q.ROOT/'docs/qa/ui-audit-20261010/after'
rt.REPORT=q.ROOT/'docs/qa/ui-audit-20261010/interaction-checks.json'
rt.results=json.loads(rt.REPORT.read_text(encoding='utf-8')) if rt.REPORT.exists() else []
p=argparse.ArgumentParser();p.add_argument('group',choices=['stress','interactions','posters','posters-template']);args=p.parse_args()

def config(size='780x1834',font='1.0',keyboard='0'):
    q.adb('shell','wm','size',size);q.adb('shell','settings','put','system','font_scale',font)
    q.adb('shell','cmd','uimode','night','yes')
    q.adb('shell','settings','put','secure','show_ime_with_hard_keyboard',keyboard)

def custom(state,anchor):
    q.adb('shell','am','force-stop',q.PACKAGE)
    q.adb('shell','am','start','-n',q.PACKAGE+'/com.zxn.palou.MainActivity','-a','android.intent.action.VIEW','-d','palou-uiqa://preview?state='+state)
    for _ in range(25):
        time.sleep(2)
        try:
            if any(anchor in v for v in rt.texts()):time.sleep(2);return
        except RuntimeError:
            continue
    raise AssertionError('Not ready: '+state)

def storage():
    target=q.ROOT/'.expo-export-check/ui-audit-20261010/db'/uuid.uuid4().hex;target.mkdir(parents=True)
    for name in q.adb('shell','run-as',q.PACKAGE,'ls','databases').split():
        if name in ['RKStorage','RKStorage-wal','RKStorage-shm','RKStorage-journal']:
            (target/name).write_bytes(q.adb('exec-out','run-as',q.PACKAGE,'cat','databases/'+name,binary=True))
    with sqlite3.connect(target/'RKStorage') as db:return dict(db.execute('SELECT key,value FROM catalystLocalStorage'))

def visible(label,minimum=48):
    n=next(n for n in q.tree().iter('node') if label in [n.get('text'),n.get('content-desc')])
    x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
    size=re.findall(r'(\d+)x(\d+)',q.adb('shell','wm','size'))[-1];w,h=map(int,size)
    assert x1>=0 and x2<=w and y1>=98 and y2<=h-48,(label,n.get('bounds'))
    assert x2-x1>=minimum*2 and y2-y1>=minimum*2,(label,'small target',n.get('bounds'))

def reveal(label):
    for _ in range(8):
        if any(label in [n.get('text'),n.get('content-desc')] for n in q.tree().iter('node')):return
        w,h=map(int,re.findall(r'(\d+)x(\d+)',q.adb('shell','wm','size'))[-1])
        q.adb('shell','input','swipe',str(w-70),str(h-240),str(w-70),'380','600');time.sleep(1)
    raise AssertionError('Unreachable: '+label)

if args.group=='stress':
    def numbers():
        for prefix,size,font in [('normal','780x1834','1.0'),('font125','800x1780','1.25'),('small130','640x1282','1.3')]:
            config(size,font)
            custom('climbing-long','正在向上');rt.expect('101 楼');rt.expect('已完成 100 层')
            visible('长按结束并保存，需要长按');visible('长按放弃本次，需要长按');q.capture(prefix+'-climbing-101')
        custom('summary-long','训练完成');q.tap_label('第1轮，150 层，点按修改')
        q.capture('small130-edit-150');visible('加一层',minimum=72);visible('减一层',minimum=72);visible('保存');visible('取消')
    rt.case('three digit current floor, complete gauge count and editable 150 floors at small 130 percent',numbers)
    def keyboard():
        for prefix,size,font in [('font125','800x1780','1.25'),('small130','640x1282','1.3')]:
            config(size,font,'1');q.launch('home');reveal('管理 城市花园·A座');q.tap_label('管理 城市花园·A座');q.tap_label('重命名');time.sleep(3)
            q.capture(prefix+'-rename-keyboard');visible('保存');visible('取消')
            q.adb('shell','input','keyevent','KEYCODE_BACK');time.sleep(1);q.tap_label('取消')
    rt.case('rename native keyboard keeps save and cancel visible at phone and small large-text sizes',keyboard)
    def onboarding():
        for prefix,size,font in [('font125','800x1780','1.25'),('small130','640x1282','1.3')]:
            config(size,font);q.launch('onboarding')
            for i in range(1,4):
                q.capture(prefix+'-onboarding'+('' if i==1 else '-'+str(i)))
                visible('开始使用' if i==3 else '下一步')
                if i<3:q.tap_label('下一步')
            # Full hints can scroll; no text is removed in the compact layout.
            w,h=map(int,re.findall(r'(\d+)x(\d+)',q.adb('shell','wm','size'))[-1])
            q.adb('shell','input','swipe',str(w//2),str(h-350),str(w//2),'250','600');time.sleep(1)
            rt.expect('估算和采样中断仍需核对');q.capture(prefix+'-onboarding-full-hint');q.tap_label('开始使用');rt.expect('开始爬楼')
    rt.case('all three compact onboarding screens, full hints and finish remain reachable',onboarding)
    config()

if args.group=='interactions':
    config()
    def menu():
        q.launch('history');q.tap_label('更多操作 城市花园·A座');rt.expect('查看与修改');rt.expect('分享成绩');q.capture('history-more')
        q.tap_label('取消');rt.expect('训练记录')
        q.tap_label('更多操作 城市花园·A座');q.tap_label('查看与修改');rt.expect('训练详情');q.capture('history-more-detail')
        q.launch('history');q.tap_label('更多操作 城市花园·A座');q.tap_label('分享成绩');rt.expect('分享成绩');q.capture('history-more-share')
    rt.case('record more menu cancels, opens actual details and opens sharing',menu)
    def clear():
        q.launch('template');q.tap_label('清空楼栋名称');assert not any('清空楼栋名称'==v for v in rt.texts());q.capture('template-cleared')
        q.tap_label('保存模板');rt.expect('请给这栋楼起个名字');q.tap_label('OK')
        rt.fill('楼栋名称','UI-AUDIT-TEMPLATE');q.tap_label('保存模板');rt.expect('已保存「UI-AUDIT-TEMPLATE」')
    rt.case('template clear changes only draft, empty validation and real template save work',clear)
    def privacy():
        custom('privacy-first','隐私协议');assert 'palou.privacy.agreed.v1' not in storage()
        q.tap_label('不同意');q.capture('privacy-reject');visible('返回协议');visible('退出应用');q.tap_label('返回协议');rt.expect('你的记录，留在本机')
        q.tap_label('不同意');q.tap_label('退出应用');time.sleep(2)
        assert not any(n.get('package')==q.PACKAGE for n in q.tree().iter('node')),'Exit stayed in app'
        assert 'palou.privacy.agreed.v1' not in storage();q.capture('privacy-exited')
        custom('privacy-first','隐私协议');q.tap_label('同意并开始');rt.expect('把手机放稳');assert 'palou.privacy.agreed.v1' in storage()
        q.tap_label('下一步');q.tap_label('下一步');q.tap_label('开始使用');rt.expect('开始爬楼')
        q.launch('privacy');q.tap_label('不同意');q.tap_label('返回上一页');rt.expect('开始爬楼')
    rt.case('first privacy reject really exits without consent, agree enters onboarding, settings return is labeled correctly',privacy)
    rt.basic()

if args.group in ['posters','posters-template']:
    config()
    if args.group=='posters': rt.shares()
    def templates():
        q.launch('share')
        for label,name in [('简洁模板','hero'),('画报模板','editorial'),('数据模板','report'),('本周累计模板','streak')]:
            if name=='streak':
                # The fourth design is in a horizontal template strip.
                node=next(n for n in q.tree().iter('node') if n.get('content-desc')=='数据模板')
                x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds')))
                q.adb('shell','input','swipe','700',str((y1+y2)//2),'180',str((y1+y2)//2),'500');time.sleep(2)
            reveal(label);q.tap_label(label);rt.expect('成果海报');q.capture('poster-template-'+name)
        q.tap_label('文案');q.capture('share-copy-tab');q.tap_label('尺寸');q.capture('share-size-tab')
    rt.case('all four poster designs and copy or size editing tabs render',templates)
