"""Exercise real controls in the dedicated synthetic .uiqa app."""
import argparse
import importlib.util
import json
import re
import time
from pathlib import Path
from skin_qa_source import source_fingerprint

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('graphics_qa', Path(__file__).with_name('graphics-native-qa.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InteractionLab(module.GraphicLab):
    def screenshot(self, name, skin, mode, check_paper=True):
        # Interaction steps can navigate without open(). Its successful load
        # belongs to the last cold-opened page, not necessarily this screenshot.
        last_opened_header = getattr(self, 'header_load_evidence', None)
        self.header_load_evidence = None
        try:
            super().screenshot(name, skin, mode, check_paper)
            self.results[-1]['lastOpenedHeader'] = last_opened_header
            self.results[-1]['headerLoadScope'] = 'Current page load unverified after interaction navigation; lastOpenedHeader is diagnostic only.'
        finally:
            self.header_load_evidence = last_opened_header

    def find(self, label, edit=False, prefix=False):
        for node in self.tree().iter('node'):
            if edit and node.get('class') != 'android.widget.EditText':
                continue
            if any(value.startswith(label) if prefix else value == label for value in [node.get('text', ''), node.get('content-desc', '')]):
                return node

    def wait_text(self, text):
        deadline = time.monotonic() + 35
        while time.monotonic() < deadline:
            tree = self.tree()
            if any(text in n.get('text', '') + n.get('content-desc', '') for n in tree.iter('node')):
                return tree
            time.sleep(.3)
        raise AssertionError('Text not visible: ' + text)

    def reveal(self, label, edit=False, upwards=False, prefix=False):
        _, height = map(int, re.findall(r'(\d+)x(\d+)', self.adb('shell', 'wm', 'size'))[-1])
        for _ in range(12):
            node = self.find(label, edit, prefix)
            if node is not None:
                coords = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
                if len(coords) == 4 and coords[3] - coords[1] >= 40:
                    center = (coords[1] + coords[3]) / 2
                    # Persistent tabs do not move with the scroll content. They
                    # sit below the content cutoff and must be tapped directly.
                    fixed_tab = label in ['训练', '教练', '记录', '设置'] and node.get('clickable') == 'true'
                    if height * .12 < center < height * (.98 if fixed_tab else .94):
                        return node
            self.swipe(not upwards)
        raise AssertionError('Cannot reveal control: ' + label)

    def click(self, label, upwards=False, prefix=False):
        self.reveal(label, upwards=upwards, prefix=prefix)
        self.tap(label, prefix)

    def fill(self, label, value):
        node = self.reveal(label, edit=True)
        coords = list(map(int, re.findall(r'\d+', node.get('bounds'))))
        self.adb('shell', 'input', 'tap', (coords[0] + coords[2]) // 2, (coords[1] + coords[3]) // 2)
        self.adb('shell', 'input', 'keyevent', 123)
        self.adb('shell', 'input', 'keyevent', *([67] * 16))
        self.adb('shell', 'input', 'text', value)
        ime = self.adb('shell', 'dumpsys', 'input_method')
        if re.search(r'(mInputShown|mIsInputViewShown)=true', ime):
            self.adb('shell', 'input', 'keyevent', 4)

    def top(self):
        for _ in range(8):
            self.swipe(False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=['all', 'appearance', 'coach', 'feedback', 'training'], default='all')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--serial', default='emulator-5596')
    parser.add_argument('--out', type=Path, default=ROOT / 'docs/skins/evidence/20261028-fidelity/interaction')
    profiles = json.loads((ROOT / 'docs/skins/qa-display-profiles.json').read_text(encoding='utf-8-sig'))
    parser.add_argument('--profile', choices=profiles['profiles'], default=profiles['defaultProfile'])
    args = parser.parse_args()
    out = args.out
    lab = InteractionLab(args.serial, 'com.zxn.palou.uiqa', out)
    lab.configure_display(args.profile)
    result_file = out / 'interaction-results.json'
    previous = json.loads(result_file.read_text(encoding='utf-8')) if result_file.exists() else {}
    # Different display settings are a different acceptance run; never merge
    # historical 1080p/100% phases or frames into a high-density report.
    if previous.get('displayProfile') != lab.display_profile:
        previous = {}
    phases = previous.get('phases', {})
    source = source_fingerprint()
    checks = []

    def checkpoint():
        frames = {f['name']: f for f in previous.get('frames', [])}
        frames.update({f['name']: f for f in lab.results})
        report = {'sourceFingerprint': source, 'displayProfile': lab.display_profile, 'phases': phases,
                  'checks': [check for phase in phases.values() if phase['passed'] for check in phase['checks']],
                  'frames': list(frames.values())}
        report['allPassed'] = all(phases.get(name, {}).get('passed') and phases[name]['sourceFingerprint'] == source and phases[name].get('displayProfile') == lab.display_profile
                                  for name in ['appearance', 'coach', 'feedback', 'training'])
        result_file.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

    def appearance_phase():
        lab.open('home', 'eva-unit-02', 'dark')
        for tab, marker in [('教练', '设定我的体重目标'), ('记录', '向上的轨迹'), ('设置', '运动播报'), ('训练', '本周累计爬升')]:
            lab.tap(tab)
            lab.wait_text(marker)
        lab.screenshot('eva-unit-02-dark-tab-roundtrip', 'eva-unit-02', 'dark')
        checks.append('Four actual bottom tabs navigate and keep the selected graphic skin')

        lab.open('appearance', 'classic', 'light')
        for name in ['钴蓝晴空', '荧光夜行', '松风山岚', '紫电幽光', '绯焰流光', '晴金跃动', '樱粉和弦']:
            lab.click(name)
            assert lab.selected(name), 'Native skin radio did not activate: ' + name
        checks.append('All seven actual skin radios activate in the appearance screen')
        lab.top()
        lab.tap('暗色')
        lab.click('松风山岚')
        assert lab.selected('松风山岚'), 'Skin tap must take effect before testing restart'
        lab.open('appearance')
        assert lab.selected('暗色')
        lab.reveal('松风山岚')
        assert lab.selected('松风山岚')
        lab.screenshot('woodland-dark-cold-start', 'woodland', 'dark')
        lab.top()
        lab.tap('跟随系统')
        lab.adb('shell', 'cmd', 'uimode', 'night', 'no')
        lab.screenshot('woodland-light-system', 'woodland', 'light')
        lab.adb('shell', 'cmd', 'uimode', 'night', 'yes')
        lab.screenshot('woodland-dark-system', 'woodland', 'dark')
        lab.tap('浅色')
        lab.screenshot('woodland-light-manual-on-dark-system', 'woodland', 'light')
        lab.open('appearance')
        assert lab.selected('浅色')
        checks.append('Skin/mode persist across cold starts; system follows live changes; manual mode wins')

    def coach_phase():
        lab.open('coach', 'k-on', 'dark')
        lab.tap('设定我的体重目标')
        lab.wait_text('课程会陪你做什么')
        lab.click('设定目标，开始体重管理')
        lab.wait_text('先定一个能坚持的目标')
        lab.fill('当前体重（公斤）', '80')
        lab.fill('身高（厘米）', '175')
        lab.fill('阶段目标体重（公斤）', '76')
        lab.click('我已满18岁')
        lab.click('目前适合自行运动')
        lab.click('保存目标，生成课程安排')
        lab.wait_text('记录体重 / 查看趋势')
        lab.screenshot('k-on-dark-goal-saved', 'k-on', 'dark')
        lab.click('记录体重 / 查看趋势')
        lab.wait_text('记录一次体重')
        lab.fill('体重（公斤，精确到0.1）', '79.8')
        lab.click('更新这天的体重')
        lab.wait_text('已保存 2026-10-18 的体重')
        lab.screenshot('k-on-dark-weight-saved', 'k-on', 'dark')
        lab.adb('shell', 'input', 'keyevent', 4)
        lab.wait_text('79.8')
        lab.click('做一次本周复盘')
        lab.wait_text('本周复盘')
        lab.click('舒适')
        lab.click('保存复盘与后续安排')
        lab.wait_text('已保存的周复盘')
        lab.screenshot('k-on-dark-review-saved', 'k-on', 'dark')
        lab.open('persist')  # Deliberately skips all fixture writes for the cold-start check.
        lab.click('教练')
        lab.wait_text('79.8')
        lab.screenshot('k-on-dark-coach-cold-start', 'k-on', 'dark')
        checks.append('Real course detail/goal form saves an enrollment; weight and weekly review save; latest weight survives cold start')

    def feedback_phase():
        lab.open('summary-coach', 'eva-unit-01', 'light')
        lab.reveal('已保留确认的楼层', prefix=True)
        lab.click('舒适')
        lab.wait_text('感受已保存，会用于每周复盘')
        lab.screenshot('eva-unit-01-light-course-feedback-saved', 'eva-unit-01', 'light')
        checks.append('Incomplete course result keeps its confirmed floors; effort feedback saves without marking course completed')

        lab.open('settings', 'k-on', 'light')
        lab.click('反馈预览', prefix=True)
        lab.click('试一下楼层震动')
        lab.click('预览盖楼结算')
        preview = lab.wait_text('盖楼结算预览，不生成训练记录')
        lab.screenshot('k-on-light-feedback-preview', 'k-on', 'light')
        exit_preview = next(n for n in preview.iter('node') if n.get('content-desc') == '结束结算预览')
        x0, y0, x1, y1 = map(int, re.findall(r'\d+', exit_preview.get('bounds')))
        lab.adb('shell', 'input', 'tap', (x0+x1)//2, (y0+y1)//2)
        lab.wait_text('反馈预览')  # The settings scroll position stays at the expanded group.
        lab.tap('记录')
        lab.wait_text('4 条')
        lab.screenshot('k-on-light-feedback-preview-keeps-record-count', 'k-on', 'light')
        checks.append('Collapsed feedback previews expand; haptic control stays reachable; completion preview closes without generating a workout')

    def training_phase():
        lab.open('climbing', 'eva-unit-02', 'dark')
        lab.tap('长按结束并保存')
        lab.wait_text('正在向上')
        lab.screenshot('eva-unit-02-dark-short-tap-keeps-training', 'eva-unit-02', 'dark')
        node = lab.reveal('长按结束并保存')
        x0, y0, x1, y1 = map(int, re.findall(r'\d+', node.get('bounds')))
        x, y = (x0 + x1) // 2, (y0 + y1) // 2
        lab.adb('shell', 'input', 'swipe', x, y, x, y, 1600)
        lab.wait_text('训练完成')
        deadline = time.monotonic() + 15
        while any(node.get('content-desc') == '查看本次成绩' for node in lab.tree().iter('node')):
            assert time.monotonic() < deadline, 'Completion celebration did not return to result'
        lab.screenshot('eva-unit-02-dark-long-hold-result', 'eva-unit-02', 'dark')
        checks.append('Training short tap does not finish; deliberate 1.6-second hold reaches saved-result UI in synthetic fixture')

    for name, action in [('appearance', appearance_phase), ('coach', coach_phase), ('feedback', feedback_phase), ('training', training_phase)]:
        if args.phase != 'all' and args.phase != name:
            continue
        if args.resume and phases.get(name, {}).get('passed') and phases[name]['sourceFingerprint'] == source and phases[name].get('displayProfile') == lab.display_profile:
            print('RESUME: already passed ' + name, flush=True)
            continue
        print('START ' + name, flush=True)
        start = len(checks)
        try:
            action()
            phases[name] = {'passed': True, 'sourceFingerprint': source, 'displayProfile': lab.display_profile, 'checks': checks[start:]}
        except Exception as error:
            phases[name] = {'passed': False, 'sourceFingerprint': source, 'displayProfile': lab.display_profile, 'checks': [], 'error': str(error)}
            checkpoint()
            raise
        checkpoint()
        print('PASS ' + name, flush=True)


if __name__ == '__main__':
    main()
