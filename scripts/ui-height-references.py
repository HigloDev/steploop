"""Native feature QA on the isolated package. No real-phone data is read or edited."""
import argparse
import hashlib
import importlib.util
import json
import re
import sqlite3
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/qa/height-references-20261010'
PRIVATE = ROOT / '.expo-export-check/height-references-20261010'
spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/ui-qa-capture.py')
q = importlib.util.module_from_spec(spec); spec.loader.exec_module(q)
q.OUT = OUT
REPORT = OUT / 'interaction-checks.json'
OUT.mkdir(parents=True, exist_ok=True)
results = json.loads(REPORT.read_text('utf-8')) if REPORT.exists() else []
names = re.findall(r"name: '([^']+)'", (ROOT / 'src/core/landmarks.ts').read_text('utf-8'))

def config(width=780, height=1834, font='1.0', night='yes'):
    q.adb('shell', 'wm', 'size', f'{width}x{height}')
    q.adb('shell', 'wm', 'density', '320')
    q.adb('shell', 'settings', 'put', 'system', 'font_scale', font)
    q.adb('shell', 'cmd', 'uimode', 'night', night)
    time.sleep(2)

def texts():
    return [n.get('text', '') + n.get('content-desc', '') for n in q.tree().iter('node') if n.get('package') == q.PACKAGE]

def expect(text):
    for _ in range(10):
        try:
            if any(text in item for item in texts()): return
        except RuntimeError:
            pass
        time.sleep(0.5)
    raise AssertionError(f'Missing native text: {text}')

def launch(state):
    q.adb('shell', 'am', 'force-stop', q.PACKAGE)
    q.adb('shell', 'am', 'start', '-n', q.PACKAGE + '/com.zxn.palou.MainActivity',
          '-a', 'android.intent.action.VIEW', '-d', 'palou-uiqa://preview?state=' + state)
    anchor = '本周成果' if state.startswith('history') else '开始爬楼'
    for _ in range(35):
        time.sleep(1)
        try:
            if any(anchor in item for item in texts()):
                time.sleep(2)
                return
        except RuntimeError:
            pass
    raise RuntimeError('Preview did not load: ' + state)

def capture(name):
    q.capture(name)
    raw = OUT / 'raw' / (name + '.png')
    metadata = { 'capturedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'package': q.PACKAGE, 'device': q.SERIAL,
      'source': 'native Android screencap, ' + ('isolated synthetic fixtures' if q.PACKAGE.endswith('.uiqa') else 'standalone release, pre-existing emulator data'),
      'rawSha256': hashlib.sha256(raw.read_bytes()).hexdigest(),
      'wmSize': q.adb('shell', 'wm', 'size').strip(), 'fontScale': q.adb('shell', 'settings', 'get', 'system', 'font_scale').strip() }
    (OUT / 'actual' / (name + '.json')).write_text(json.dumps(metadata, ensure_ascii=False, indent=2), 'utf-8')

def scroll(start=0.84, end=0.40):
    size = q.adb('shell', 'wm', 'size').strip().splitlines()[-1].split(':')[-1].strip()
    width, height = map(int, size.split('x'))
    q.adb('shell', 'input', 'swipe', str(width // 2), str(int(height * start)), str(width // 2), str(int(height * end)), '450')
    time.sleep(1)

def visible_control(label):
    height = int(q.adb('shell', 'wm', 'size').strip().splitlines()[-1].split('x')[-1])
    for node in q.tree().iter('node'):
        if label not in [node.get('text'), node.get('content-desc')]: continue
        bounds = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
        if len(bounds) == 4 and bounds[2] > bounds[0] and bounds[3] > bounds[1] and 98 < (bounds[1] + bounds[3]) / 2 < height - 260:
            return True
    return False

def storage(stage):
    private = PRIVATE / ('qa-db-' + stage); private.mkdir(parents=True, exist_ok=True)
    archive_path = private / 'data.tar'
    archive_path.write_bytes(q.adb('exec-out', 'su', '0', 'tar', '-cf', '-', '-C', '/data/user/0/' + q.PACKAGE, 'databases', binary=True))
    with tarfile.open(archive_path) as archive:
        for member in archive.getmembers():
            name = Path(member.name).name
            if member.isfile() and name in ['RKStorage', 'RKStorage-wal', 'RKStorage-shm', 'RKStorage-journal']:
                (private / name).write_bytes(archive.extractfile(member).read())
    with sqlite3.connect(private / 'RKStorage') as db:
        return dict(db.execute('SELECT key,value FROM catalystLocalStorage'))

def case(name, fn):
    start = time.time()
    result = {'case': name}
    try:
        evidence = fn()
        result.update(result='passed', evidence=evidence)
    except Exception as error:
        result.update(result='failed', error=str(error))
        try: capture('failure-' + str(len(results)))
        except Exception: pass
    result['seconds'] = round(time.time() - start, 1)
    results.append(result)
    REPORT.write_text(json.dumps(results, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(result, ensure_ascii=True), flush=True)
    assert result['result'] == 'passed', result

def catalog():
    config(); launch('home'); capture('home')
    before = storage('before-catalog')
    q.tap_label('查看全部 37 种高度参照'); expect('37 种高度参照'); capture('catalog-top')
    seen = set()
    for index in range(15):
        ui = q.tree()
        for node in ui.iter('node'):
            desc = node.get('content-desc', '')
            bounds = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
            if len(bounds) == 4 and bounds[3] > 98 and bounds[1] < 1786:
                seen.update(name for name in names if desc.startswith(name + '，'))
        if index == 4: capture('catalog-city')
        if any('珠穆朗玛峰' in item for item in texts()) and '珠穆朗玛峰' in seen:
            break
        scroll()
    capture('catalog-everest'); assert set(names) == seen, {'unseen': sorted(set(names) - seen)}
    q.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); time.sleep(2); expect('开始爬楼')
    q.tap_label('查看全部 37 种高度参照'); q.tap_label('关闭高度参照'); expect('开始爬楼')
    after = storage('after-catalog')
    assert before == after, 'Browsing reference catalog changed saved data'
    return {'visibleReferenceCount': len(seen), 'savedDataUnchanged': True, 'closeAndBack': True}

def heights():
    for state, text in [('references-low', '已达到故宫城墙高度'), ('references-mid', '已达到上海中心大厦高度'),
      ('references-everest', '高度相当于珠穆朗玛峰'), ('references-beyond', '≈ 2.0 座珠穆朗玛峰'), ('references-zero', '还没开始爬')]:
        launch(state); expect(text); capture(state)
        q.tap_label('查看全部 37 种高度参照')
        expect('已达到珠峰相当高度' if state in ['references-everest', 'references-beyond'] else '下一站')
        capture(state + '-catalog')
        q.tap_label('关闭高度参照')
    return {'heightsM': [0, 12, 632, 8848.86, 18000]}

def history():
    config(); launch('history-heights'); capture('history-low')
    seen = set()
    for index in range(8):
        ui = q.tree()
        for node in ui.iter('node'):
            desc = node.get('content-desc', '')
            match = re.match(r'(2|10|30|60|100|200|300) 层训练，', desc)
            if match:
                seen.add(int(match.group(1)))
        if index == 1: capture('history-middle')
        if index == 3: capture('history-high')
        scroll()
    assert seen == {2, 10, 30, 60, 100, 200, 300}, seen
    capture('history-bottom')
    # Change the synthetic 30-floor record across a visual tier boundary through real UI.
    launch('history-heights')
    for _ in range(5):
        if any('更多操作 30 层训练' in item for item in texts()): break
        scroll()
    q.tap_label('更多操作 30 层训练'); expect('查看与修改'); q.tap_label('查看与修改')
    expect('训练详情'); q.tap_label('第1轮，30 层，点按修改'); q.tap_label('加一层'); q.tap_label('保存')
    expect('总层数 31层'); q.tap_label('返回'); time.sleep(2)
    expect('31 层'); capture('history-corrected-31')
    q.adb('shell', 'am', 'force-stop', q.PACKAGE)
    q.adb('shell', 'am', 'start', '-n', q.PACKAGE + '/com.zxn.palou.MainActivity',
      '-a', 'android.intent.action.VIEW', '-d', 'palou-uiqa://preview?state=persist')
    time.sleep(5); q.tap_label('记录'); expect('31 层'); capture('history-corrected-persisted')
    q.tap_label('中断'); expect('没有符合筛选条件的记录'); q.tap_label('全部'); expect('31 层')
    return {'sevenCounts': sorted(seen), 'correction': '30 to 31, persisted after restart', 'filter': 'interrupted and all'}

def adaptation():
    for prefix, width, height, font, night in [('small-130', 640, 1282, '1.3', 'yes'), ('font-125', 800, 1780, '1.25', 'yes'),
      ('light', 780, 1834, '1.0', 'no')]:
        config(width, height, font, night)
        launch('references-everest'); expect('高度相当于珠穆朗玛峰'); capture(prefix + '-everest')
        # The entrance remains reachable even if large text pushes it beneath the fold.
        for _ in range(4):
            if visible_control('查看全部 37 种高度参照'): break
            scroll(0.70, 0.30)
        assert visible_control('查看全部 37 种高度参照'), 'Reference entrance cannot be reached'
        capture(prefix + '-everest-scroll')
        q.tap_label('查看全部 37 种高度参照')
        expect('37 种高度参照'); capture(prefix + '-catalog')
        q.tap_label('关闭高度参照'); launch('history-heights'); capture(prefix + '-history')
        for _ in range(4):
            if visible_control('更多操作 30 层训练'): break
            scroll(0.70, 0.30)
        assert visible_control('更多操作 30 层训练'), 'History row cannot be reached'
        capture(prefix + '-history-scroll')
        q.tap_label('更多操作 30 层训练'); expect('查看与修改'); q.tap_label('取消'); expect('30 层训练')
    config()
    return {'viewports': ['320x568, font 130%', '400x817, font 125%', '390x844, light']}

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('group', choices=['catalog', 'heights', 'history', 'adaptation'])
    args = p.parse_args()
    case(args.group, globals()[args.group])
