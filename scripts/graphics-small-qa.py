"""320dp / 130% font acceptance for the shared graphical layouts and coach forms."""
import argparse
import importlib.util
import json
import re
from pathlib import Path
from skin_qa_source import source_fingerprint
from skins_native_qa_import import IDS

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('interaction_qa', Path(__file__).with_name('graphics-interaction-qa.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', default='emulator-5596')
    parser.add_argument('--skin', choices=IDS, default='eva-unit-01')
    parser.add_argument('--out', type=Path, default=ROOT / 'docs/skins/evidence/20261028-fidelity/small')
    parser.add_argument('--states', nargs='+')
    args = parser.parse_args()
    out = args.out
    lab = module.InteractionLab(args.serial, 'com.zxn.palou.uiqa', out)
    report_path = out / 'small-results.json'
    previous = json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else {}
    source = source_fingerprint()
    if previous.get('sourceFingerprint') != source:
        previous = {}
    checks = {c['state']: c for c in previous.get('checks', [])}
    passed = set(previous.get('passedStates', []))
    def checkpoint():
        frames = {f['name']: f for f in previous.get('frames', [])}
        frames.update({f['name']: f for f in lab.results})
        report_path.write_text(json.dumps({'sourceFingerprint': source, 'skin': args.skin, 'viewport': '320dp, 130% font', 'checks': list(checks.values()),
            'passedStates': sorted(passed), 'frames': list(frames.values())}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    try:
        lab.adb('shell', 'wm', 'size', '720x1600')
        lab.adb('shell', 'wm', 'density', '360')
        lab.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.3')
        lab.adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1')
        for state, control in [
            ('home', '开始爬楼'), ('coach', '设定我的体重目标'), ('coach-active', '记录体重 / 查看趋势'), ('history', None), ('settings', '皮肤与外观'),
            ('climbing', '长按结束并保存'), ('summary', '生成分享卡片'), ('appearance', '跟随系统'),
            ('coach-goal', '保存目标，生成课程安排'), ('coach-session', '开始这次课程'),
            ('coach-records', '更新这天的体重'), ('coach-review', '保存复盘与后续安排'),
            ('summary-coach', '回到教练，查看进度与复盘'), ('course-climbing', '长按结束并保存'),
        ]:
            if args.states and state not in args.states:
                continue
            lab.open(state, args.skin, 'dark')
            lab.screenshot(f'{args.skin}-dark-{state}-small', args.skin, 'dark')
            if state == 'coach-goal':
                field = lab.reveal('当前体重（公斤）', edit=True)
                x0, y0, x1, y1 = map(int, re.findall(r'\d+', field.get('bounds')))
                lab.adb('shell', 'input', 'tap', (x0+x1)//2, (y0+y1)//2)
                lab.screenshot(f'{args.skin}-dark-coach-goal-small-keyboard', args.skin, 'dark', check_paper=False)
                if re.search(r'(mInputShown|mIsInputViewShown)=true', lab.adb('shell', 'dumpsys', 'input_method')):
                    lab.adb('shell', 'input', 'keyevent', 4)
            if state == 'coach-session':
                lab.click('我已完成平地热身')
            if state == 'coach-review':
                lab.click('舒适')
            if control:
                for attempt in range(6):
                    node = lab.reveal(control, prefix=True)
                    # A visible label can still belong to a button clipped by
                    # the fixed tab bar. Reveal the whole clickable parent.
                    tree = lab.tree()
                    parents = {child: parent for parent in tree.iter() for child in parent}
                    target = next(n for n in tree.iter('node') if n.get('bounds') == node.get('bounds') and n.get('text') == node.get('text'))
                    while target.get('clickable') != 'true' and target in parents:
                        target = parents[target]
                    bounds = list(map(int, re.findall(r'\d+', target.get('bounds', ''))))
                    if len(bounds) == 4 and bounds[3] - bounds[1] >= 108:
                        break
                    lab.adb('shell', 'input', 'swipe', 568, 1152, 568, 960, 250)
                assert target.get('enabled') == 'true', (state, control)
                assert len(bounds) == 4 and bounds[3] - bounds[1] >= 108, (state, control, bounds)  # 48dp at 360dpi
                lab.screenshot(f'{args.skin}-dark-{state}-small-action', args.skin, 'dark')
                checks[state] = {'state': state, 'control': control, 'bounds': bounds, 'enabled': True}
            passed.add(state)
            checkpoint()
    finally:
        lab.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
        lab.adb('shell', 'wm', 'size', '1080x2400')
        lab.adb('shell', 'wm', 'density', '420')


if __name__ == '__main__':
    main()
