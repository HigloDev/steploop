"""Native interaction checks in the isolated UI lab; does not clear user data."""
import argparse
import importlib.util
import json
import re
import sqlite3
import time
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location('capture', Path(__file__).with_name('ui-qa-capture.py'))
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)
REPORT = q.OUT / 'runtime-checks.json'
results = json.loads(REPORT.read_text(encoding='utf-8')) if REPORT.exists() else []
resume_from = ''

def texts():
    return [n.get('content-desc') or n.get('text') for n in q.tree().iter('node') if n.get('content-desc') or n.get('text')]

def stored_workout(workout_id='uiqa-summary'):
    root = q.ROOT / '.expo-export-check' / 'qa-db' / uuid.uuid4().hex
    root.mkdir(parents=True)
    for name in q.adb('shell','run-as',q.PACKAGE,'ls','databases').split():
        if name in ['RKStorage','RKStorage-wal','RKStorage-shm','RKStorage-journal']:
            (root/name).write_bytes(q.adb('exec-out','run-as',q.PACKAGE,'cat','databases/'+name,binary=True))
    db = sqlite3.connect(root/'RKStorage')
    raw = db.execute("SELECT value FROM catalystLocalStorage WHERE key='palou.workouts.v1'").fetchone()[0]
    db.close()
    return next(item for item in json.loads(raw) if item['id']==workout_id)

def expect(part):
    values = texts()
    assert any(part in value for value in values), f'Missing {part!r}: {values}'

def scroll(up=True, distance=800):
    q.adb('shell', 'input', 'swipe', '600', '1400' if up else '600', '600', str(1400-distance) if up else str(600+distance), '500')
    time.sleep(1)

def fill(label, value):
    q.tap_label(label)
    q.adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END')
    q.adb('shell', 'input', 'keyevent', *(['KEYCODE_DEL'] * 32))
    q.adb('shell', 'input', 'text', value)
    time.sleep(1)
    q.adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    time.sleep(1)

def case(name, task):
    global resume_from
    if resume_from and resume_from not in name:
        return
    resume_from = ''
    start = time.time()
    try:
        task()
        result = {'case': name, 'result': 'passed', 'seconds': round(time.time()-start, 1)}
    except Exception as error:
        result = {'case': name, 'result': 'failed', 'error': str(error), 'seconds': round(time.time()-start, 1)}
    results.append(result)
    REPORT.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=True), flush=True)
    if result['result'] != 'passed':
        q.capture('interaction-failure')
        raise RuntimeError(result['error'])

def basic():
    def floor():
        q.launch('home')
        q.tap_label('起始楼层 1 楼，点按修改')
        q.tap_label('降低起始楼层')
        expect('-1')
        q.tap_label('提高起始楼层')
        expect('1')
        q.tap_label('好')
        expect('从 1 楼出发')
    case('start floor skips zero and confirms', floor)

    def rename():
        q.tap_label('管理 城市花园·A座')
        q.tap_label('重命名')
        q.tap_label('楼栋名称')
        q.capture('rename-keyboard')
        fill('楼栋名称', 'UI-QA-RENAMED')
        q.tap_label('保存')
        expect('UI-QA-RENAMED')
        q.launch('persist')
        expect('UI-QA-RENAMED')
        q.capture('rename-persisted')
        q.tap_label('管理 UI-QA-RENAMED')
        q.tap_label('重命名')
        fill('楼栋名称', 'UI-QA-CANCELLED')
        q.tap_label('取消')
        expect('UI-QA-RENAMED')
        assert not any('UI-QA-CANCELLED' in value for value in texts())
    case('rename keyboard save persistence and cancel', rename)

    def correction():
        q.launch('summary')
        q.tap_label('第1轮，15 层，点按修改')
        q.tap_label('加一层')
        q.tap_label('保存')
        expect('总爬升 93 米，31 层')
        expect('第1轮，16 层，已修改，点按修改')
        q.capture('round-corrected')
        q.tap_label('第1轮，16 层，已修改，点按修改')
        q.tap_label('减一层')
        q.tap_label('取消')
        expect('总爬升 93 米，31 层')
        q.launch('persist')
        q.tap_label('记录')
        expect('31 层')
        q.capture('correction-history-persisted')
    case('round correction recalculates totals persists and cancel', correction)

    def template():
        q.launch('template')
        fill('楼栋名称', 'UI-QA-TEMPLATE')
        q.tap_label('保存模板')
        expect('已保存「UI-QA-TEMPLATE」')
        q.tap_label('完成')
        if not any('UI-QA-TEMPLATE' in value for value in texts()):
            scroll(distance=500)
        expect('UI-QA-TEMPLATE')
        q.capture('template-saved-home')
    case('calibration template save appears on home', template)

    def hold():
        q.launch('calibrating')
        q.tap_label('到了一层，记为 6 楼')
        expect('已标定 5 层')
        q.tap_label('撤销上一次')
        expect('已标定 4 层')
        q.tap_label('到顶了，结束标定爬楼')
        expect('标定完成 · 共 4 层')
        q.tap_label('已回到楼下，开始下一轮')
        expect('准备第')
        q.tap_label('长按结束并保存，需要长按')
        expect('长按结束并保存')
        q.tap_label('长按结束并保存，需要长按', hold=True)
        expect('训练完成')
    case('manual mark undo next round short tap protected long hold finishes', hold)

    def retry():
        q.launch('save-failed')
        q.tap_label('稍后再存 · 返回首页')
        expect('开始爬楼')
        q.launch('save-failed')
        q.tap_label('重试保存')
        expect('训练完成')
    case('save failure later navigation and retry', retry)

    def settings():
        q.launch('settings')
        q.tap_label('85%')
        q.tap_label('稍慢')
        q.tap_label('精简')
        q.tap_label('体重加一千克')
        expect('66')
        q.launch('persist')
        q.tap_label('设置')
        expect('音量 85%')
        expect('66')
        q.capture('settings-persisted')
    case('voice volume speed mode and weight persist', settings)

    def history():
        q.launch('history')
        q.tap_label('中断')
        expect('没有符合筛选条件的记录')
        q.tap_label('完成')
        expect('城市花园·A座')
        q.tap_label('趋势与最佳成绩')
        expect('长期趋势')
        q.capture('history-trend-expanded')
    case('history filters and trend expansion', history)

def shots():
    q.launch('settings')
    scroll(distance=680)
    q.capture('settings-lower')
    q.launch('diagnostic')
    q.capture('diagnostic-idle')
    q.tap_label('开始本地传感器诊断采集')
    time.sleep(5)
    expect('采集中')
    q.tap_label('标记到达 2 层')
    q.tap_label('标记刚刚完成的转弯')
    q.capture('diagnostic')

def shares():
    def cancel_share():
        q.launch('share')
        assert not stored_workout().get('sharePosterCreatedAt')
        q.tap_label('立即分享海报')
        time.sleep(2)
        q.capture('share-system-sheet')
        q.adb('shell','input','keyevent','KEYCODE_BACK')
        time.sleep(2)
        expect('未确认分享结果')
        assert not stored_workout().get('sharePosterCreatedAt')
        q.capture('share-cancelled')
    case('system share cancellation does not mark success', cancel_share)

    def export_sizes():
        q.launch('share')
        for label in ['画报模板','数据模板']:
            q.tap_label(label)
            expect('成果海报')
        q.tap_label('简洁模板')
        q.tap_label('尺寸')
        (q.OUT/'exports').mkdir(exist_ok=True)
        for ratio,label,height in [('4x5','4:5 社交平台',1350),('1x1','1:1 方形图片',1080),('3x4','3:4 手机海报',1440)]:
            q.tap_label(label)
            q.capture('poster-size-'+ratio)
            q.tap_label('保存图片到相册')
            expect('海报已保存到相册')
            assert stored_workout().get('sharePosterCreatedAt')
            rows=q.adb('shell','content','query','--uri','content://media/external/images/media',
                '--projection','_id:_data:width:height:owner_package_name').splitlines()
            matches=[row for row in rows if 'owner_package_name='+q.PACKAGE in row]
            assert matches, rows
            row=max(matches,key=lambda item:int(re.search(r'_id=(\d+)',item).group(1)))
            path=re.search(r'_data=(.*?), width=',row).group(1)
            out=q.OUT/'exports'/f'poster-{ratio}.png'
            out.write_bytes(q.adb('exec-out','cat',path,binary=True))
            from PIL import Image
            assert Image.open(out).size==(1080,height), Image.open(out).size
            q.tap_label('OK')
    case('all poster templates prepare and three PNG ratios export at 1080px', export_sizes)

def diagnostic():
    def capture_sample():
        q.launch('diagnostic')
        q.capture('diagnostic-idle')
        q.tap_label('修改真实动作')
        handle=next(n for n in q.tree().iter('node') if n.get('content-desc')=='Drag handle')
        x1,y1,x2,y2=map(int,re.findall(r'\d+',handle.get('bounds')))
        q.adb('shell','input','swipe',str((x1+x2)//2),str((y1+y2)//2),str((x1+x2)//2),'210','600')
        time.sleep(2)
        for _ in range(4):
            if '设备品牌' in texts():
                break
            q.adb('shell','input','swipe','600','1560','600','650','600')
            time.sleep(2)
        fill('设备品牌','google')
        q.tap_label('Close sheet')
        q.tap_label('开始本地传感器诊断采集')
        time.sleep(5)
        expect('采集中')
        q.tap_label('标记到达 2 层')
        q.tap_label('标记刚刚完成的转弯')
        q.capture('diagnostic')
        q.tap_label('结束传感器诊断并导出本地文件')
        expect('确认样本真值')
        q.tap_label('标记无效并导出')
        time.sleep(2)
        q.capture('diagnostic-export-sheet')
        q.adb('shell','input','keyevent','KEYCODE_BACK')
        time.sleep(2)
        files=q.adb('shell','run-as',q.PACKAGE,'ls','-t','files').split()
        names=[name for name in files if name.startswith('palou-diagnostic-') and name.endswith('.json')]
        assert names, files
        data=json.loads(q.adb('exec-out','run-as',q.PACKAGE,'cat','files/'+names[0]))
        assert data['samples'] and len(data['annotations'])>=2
        assert data['sampleQuality']=='invalid'
        assert data['capture']['deviceBrand']=='google'
        assert 'marked_invalid_by_tester' in data['invalidReasons']
        assert '测试楼梯' not in json.dumps(data,ensure_ascii=False)
        (q.OUT/'exports').mkdir(exist_ok=True)
        (q.OUT/'exports'/'emulator-diagnostic-invalid.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
        q.capture('diagnostic-exported')
    case('real emulator sensor capture annotations sanitized invalid export', capture_sample)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('group', choices=['basic', 'shots', 'shares', 'diagnostic'])
    parser.add_argument('--from-case', default='')
    args = parser.parse_args()
    resume_from = args.from_case
    globals()[args.group]()
