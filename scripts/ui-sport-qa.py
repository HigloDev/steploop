"""Read native screenshots from our isolated synthetic Android visual lab."""
import argparse
import json
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'com.zxn.palou.uiqa'
SERIAL = os.environ.get('ANDROID_SERIAL')
OUT = ROOT / 'docs/qa/ascent-sport-20261018/actual'

def adb(*args):
    if not SERIAL:
        raise RuntimeError('Select the authorized device with --serial or ANDROID_SERIAL')
    return subprocess.check_output(['adb', '-s', SERIAL, *args], timeout=25)

def tree():
    adb('shell', 'uiautomator', 'dump', '/sdcard/steploop-uiqa.xml')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/steploop-uiqa.xml'))

def capture(name):
    ui = tree()
    nodes = [n for n in ui.iter('node') if n.get('package') == PACKAGE]
    labels = [n.get('content-desc') or n.get('text') for n in nodes if n.get('content-desc') or n.get('text')]
    if len(labels) < 3:
        raise RuntimeError('No rendered lab content; screenshot rejected')
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f'{name}.xml').write_text(ET.tostring(ui, encoding='unicode'), encoding='utf-8')
    (OUT / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    print(json.dumps({'capture': name, 'package': PACKAGE, 'labels': labels[:9]}, ensure_ascii=False), flush=True)

def launch(state, theme):
    adb('shell', 'am', 'force-stop', PACKAGE)
    url = f'palou-uiqa://preview?state={state}&theme={theme}'
    adb('shell', f"am start -n {PACKAGE}/com.zxn.palou.MainActivity -a android.intent.action.VIEW -d '{url}'")
    time.sleep(4 if state.startswith('summary') or state == 'template' else 2)
    anchor = '训练完成' if state.startswith('summary') or state == 'template' else '向上训练' if state in ['climbing', 'calibrating', 'calibration_top', 'descending', 'waiting', 'climbing-long', 'climbing-estimated'] else '成绩还没有保存完成' if state.startswith('save-failed') else '暂时无法开始训练' if state == 'start-error' else '正在启动传感器' if state == 'starting' else '找到自己的节奏' if state == 'settings' else '搜索训练记录' if state.startswith('history') else '本周成果分享' if state.startswith('weekly') else '分享成绩' if state == 'share' else '开始爬楼'
    for _ in range(7):
        ui = tree()
        if any(anchor in (n.get('text', '') + n.get('content-desc', '')) for n in ui.iter('node') if n.get('package') == PACKAGE):
            time.sleep(0.8)
            return
        time.sleep(1)
    raise RuntimeError(f'Expected lab state not visible: {state}')

def activate(label):
    # Xiaomi disallows injected touch on this device; keyboard focus is observable.
    for _ in range(20):
        ui = tree()
        if not any(n.get('package') == PACKAGE for n in ui.iter('node')):
            raise RuntimeError('The lab is no longer in the foreground; no key sent')
        focused = [n for n in ui.iter('node') if n.get('package') == PACKAGE and n.get('focused') == 'true']
        if any(label == (n.get('content-desc') or n.get('text')) for n in focused):
            adb('shell', 'input', 'keyevent', 'KEYCODE_ENTER')
            time.sleep(0.7)
            return
        adb('shell', 'input', 'keyevent', 'KEYCODE_TAB')
    raise RuntimeError(f'Could not focus target; no activation sent: {label}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default=SERIAL, help='ADB device serial; defaults to ANDROID_SERIAL')
    parser.add_argument('states', nargs='*')
    parser.add_argument('--theme', choices=['light', 'dark'], default='light')
    parser.add_argument('--capture-only')
    parser.add_argument('--activate')
    parser.add_argument('--type-text')
    args = parser.parse_args()
    if not args.serial:
        parser.error('Set --serial or ANDROID_SERIAL to select the authorized device')
    SERIAL = args.serial
    if args.activate:
        activate(args.activate)
    if args.type_text is not None:
        focused = [n for n in tree().iter('node') if n.get('package') == PACKAGE and n.get('focused') == 'true' and n.get('class') == 'android.widget.EditText']
        if len(focused) != 1:
            raise RuntimeError('No uniquely focused lab text field; no typing sent')
        if not args.type_text.isascii() or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_' for c in args.type_text):
            raise RuntimeError('This fixture helper accepts plain ASCII search terms only')
        adb('shell', 'input', 'text', args.type_text)
        time.sleep(0.7)
    if args.capture_only:
        capture(args.capture_only)
    for state in args.states:
        launch(state, args.theme)
        capture(f'{state}-{args.theme}')
