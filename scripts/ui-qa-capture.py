"""Capture native screenshots from the isolated com.zxn.palou.uiqa debug lab.

Requires its Metro bundle started with EXPO_PUBLIC_UI_QA=1. Never clears app data.
"""
import argparse
import json
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/qa/ui-redraw-20261010'
SERIAL = 'emulator-5582'
PACKAGE = 'com.zxn.palou.uiqa'
_ui_device = None

def adb(*args, binary=False):
    result = subprocess.check_output(['adb', '-s', SERIAL, *args], timeout=60)
    return result if binary else result.decode('utf-8', errors='replace')

def launch(state):
    adb('shell', 'am', 'force-stop', PACKAGE)
    adb('shell', 'am', 'start', '-n', PACKAGE+'/com.zxn.palou.MainActivity',
        '-a', 'android.intent.action.VIEW', '-d', 'palou-uiqa://preview?state='+state)
    anchor = {'history': '本周成果', 'settings': '运动播报', 'summary': '训练完成', 'template': '训练完成',
              'share': '分享成绩', 'onboarding': '开始之前', 'privacy': '隐私协议', 'legacy': '旧版单轮记录',
              'diagnostic': '传感器诊断', 'save-failed': '训练结束', 'save-failed-no-recovery': '训练结束'}.get(state,
              '长按结束并保存' if state in ['climbing', 'calibrating', 'calibration_top', 'descending', 'waiting'] else '开始爬楼')
    for _ in range(25):
        time.sleep(2)
        try:
            if any(n.get('package') == PACKAGE and anchor in (n.get('text', '') + n.get('content-desc', '')) for n in tree().iter('node')):
                time.sleep(3)
                return
        except RuntimeError:
            pass
    raise RuntimeError('App did not become ready: '+state)

def tree():
    global _ui_device
    runtime = ROOT / '.expo-export-check/uiautomator-runtime'
    if runtime.exists():
        if _ui_device is None:
            sys.path.insert(0, str(runtime))
            import uiautomator2 as u2
            _ui_device = u2.connect(SERIAL)
            _ui_device.jsonrpc.setConfigurator({'waitForIdleTimeout': 0, 'waitForSelectorTimeout': 0})
        for _ in range(4):
            ui = ET.fromstring(_ui_device.dump_hierarchy(compressed=False, root_in_active=True, max_depth=90))
            if any(n.get('text') or n.get('content-desc') for n in ui.iter('node')):
                return ui
            time.sleep(1)
        raise RuntimeError('No current native accessibility tree')
    for _ in range(4):
        try:
            adb('shell', 'rm', '-f', '/sdcard/uiqa.xml')
            adb('shell', 'uiautomator', 'dump', '/sdcard/uiqa.xml')
            ui = ET.fromstring(adb('shell', 'cat', '/sdcard/uiqa.xml'))
            if any(n.get('text') or n.get('content-desc') for n in ui.iter('node')):
                return ui
        except (subprocess.CalledProcessError, ET.ParseError):
            pass
        time.sleep(2)
    raise RuntimeError('No current native accessibility tree')

def tap_label(label, hold=False):
    candidates = [n for n in tree().iter('node') if n.get('package') == PACKAGE and label in [n.get('text'), n.get('content-desc')]]
    candidates.sort(key=lambda n: (n.get('class') != 'android.widget.EditText', n.get('content-desc') != label, n.get('clickable') != 'true'))
    for node in candidates:
        if label in [node.get('text'), node.get('content-desc')]:
            bounds = node.get('bounds').replace('][', ',').strip('[]').split(',')
            x1,y1,x2,y2 = map(int,bounds)
            x,y = str((x1+x2)//2),str((y1+y2)//2)
            if hold: adb('shell','input','swipe',x,y,x,y,'1900')
            else: adb('shell','input','tap',x,y)
            time.sleep(2)
            return
    raise RuntimeError('No visible control: '+label)

def capture(name):
    (OUT/'raw').mkdir(parents=True,exist_ok=True)
    (OUT/'actual').mkdir(parents=True,exist_ok=True)
    ui=tree()
    time.sleep(1)
    raw=OUT/'raw'/f'{name}.png'
    raw.write_bytes(adb('exec-out','screencap','-p',binary=True))
    im=Image.open(raw)
    # Emulator system bars: 49 dp top, 24 dp bottom at density 2.
    crop=im.crop((0,98,im.width,im.height-48))
    if len(crop.convert('RGB').getcolors(crop.width*crop.height) or []) < 20:
        raise RuntimeError('Blank capture; evidence rejected: '+name)
    crop.resize((390,round(crop.height*390/crop.width)),Image.Resampling.LANCZOS).save(OUT/'actual'/f'{name}.png')
    (OUT/'actual'/f'{name}.xml').write_text(ET.tostring(ui,encoding='unicode'),encoding='utf-8')
    reference=OUT/'reference'/f'{name}.png'
    if reference.exists():
        (OUT/'compare').mkdir(exist_ok=True)
        ref=Image.open(reference)
        canvas=Image.new('RGB',(800,max(ref.height,round(crop.height*390/crop.width))+40),'#343230')
        canvas.paste(ref,(0,40))
        canvas.paste(Image.open(OUT/'actual'/f'{name}.png'),(410,40))
        draw=ImageDraw.Draw(canvas)
        draw.text((12,10),'REFERENCE',fill='white')
        draw.text((422,10),'ANDROID',fill='white')
        canvas.save(OUT/'compare'/f'{name}.png')
    print(json.dumps({'capture':name,'raw':im.size,'content':crop.size},ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('state',nargs='?')
    p.add_argument('--name')
    p.add_argument('--tap',action='append',default=[])
    p.add_argument('--capture-only',action='store_true')
    a=p.parse_args()
    if not a.capture_only: launch(a.state)
    for label in a.tap: tap_label(label)
    capture(a.name or a.state)
