"""Audit auxiliary native paths; the isolated emulator package alone is addressed."""
import ast
import importlib.util
import json
import re
import sqlite3
import sys
import time
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location('rt', Path(__file__).with_name('ui-qa-runtime.py'))
rt = importlib.util.module_from_spec(spec); spec.loader.exec_module(rt)
q = rt.q
q.OUT = q.ROOT / 'docs/qa/ui-audit-20261010/after'
rt.REPORT = q.ROOT / 'docs/qa/ui-audit-20261010/interaction-checks.json'
rt.results = json.loads(rt.REPORT.read_text(encoding='utf-8'))
rt.resume_from = sys.argv[1] if len(sys.argv) > 1 else ''
SAVE = '长按结束并保存，需要长按'
DISCARD = '长按放弃本次，需要长按'

def reveal(label):
    for _ in range(12):
        if any(label in [n.get('text'), n.get('content-desc')] for n in q.tree().iter('node')): return
        rt.scroll(distance=650)
    raise AssertionError('Unreachable: ' + label)

def functions(filename):
    # Reuse existing test functions without executing their historical output writers.
    source = ast.parse(Path(__file__).with_name(filename).read_text(encoding='utf-8'))
    definitions = ast.Module(body=[n for n in source.body if isinstance(n, ast.FunctionDef)], type_ignores=[])
    exec(compile(definitions, filename, 'exec'), globals())

q.adb('shell', 'wm', 'size', '780x1834')
q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
q.adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '0')
q.adb('shell', 'cmd', 'uimode', 'night', 'yes')

def policies():
    q.launch('privacy')
    for index, title in enumerate(['信息收集', '信息存储', '信息使用', '信息共享', '信息删除', '技术边界', '联系方式'], 1):
        label = title + '，查看完整协议'
        reveal(label); q.tap_label(label)
        node = next(n for n in q.tree().iter('node') if n.get('content-desc') == label)
        assert node.get('clickable') == 'true'
        q.capture('privacy-section-' + str(index))
        q.tap_label(label)
    rt.scroll(distance=1000); rt.expect('版本 1.0'); q.capture('privacy-footer')
rt.case('all seven full privacy sections expand and footer remains reachable', policies)

def legacy():
    q.launch('legacy')
    for label, name in [('修正最终楼层', 'correction'), ('单层用时', 'splits'), ('更多训练信息', 'details')]:
        reveal(label); q.tap_label(label); q.capture('legacy-' + name)
    rt.scroll(distance=600); q.capture('legacy-details-end')
rt.case('legacy record exposes correction, floor splits and complete original details', legacy)

functions('ui-qa-training-actions.py')
rt.case('back and short or cancelled holds preserve active training without an exit popup', back_and_short_press)
rt.case('failed save with and without recovery blocks unsafe exit and allows retry', failed_save)

functions('ui-qa-live-flow.py')
rt.case('native backup download, CSV and cancelled import preserve stored workouts', exports)
rt.case('copy editor changes preview and sanitized clipboard export succeeds', share_copy)
rt.diagnostic()
