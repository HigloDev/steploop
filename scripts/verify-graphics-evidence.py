"""Fail closed unless final skin evidence covers the current runtime fingerprint."""
import hashlib
import json
from pathlib import Path
from PIL import Image
from skin_qa_source import source_fingerprint

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / 'docs/skins'
EVIDENCE = DOC / 'evidence/20261028-fidelity'
SKINS = ['classic', 'night-run', 'woodland', 'eva-unit-01', 'eva-unit-02', 'pikachu', 'k-on']
MAIN = ['home', 'coach', 'history', 'settings']
FLOW = ['coach-active', 'coach-course', 'coach-goal', 'coach-session', 'coach-records', 'coach-review',
        'summary-coach', 'course-climbing', 'appearance', 'calibrating', 'descending', 'waiting', 'save-failed', 'share', 'weekly']
SMALL = ['home', 'coach', 'coach-active', 'history', 'settings', 'climbing', 'summary', 'appearance',
         'coach-goal', 'coach-session', 'coach-records', 'coach-review', 'summary-coach', 'course-climbing']


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def main():
    source = source_fingerprint()
    automated = read(EVIDENCE / 'automated-results.json')
    assert automated['sourceFingerprint'] == source
    assert all(automated[key]['exitCode'] == 0 for key in ['typecheck', 'regression', 'androidExport'])
    assert automated['regression']['fail'] == 0
    inventory = read(EVIDENCE / 'inventory.json')
    assert inventory['sourceFingerprint'] == source
    frames = inventory['frames']
    assert len(frames) == 160, 'Final acceptance requires the complete 160-frame matrix'
    by_name = {Path(frame['file']).stem: frame for frame in frames}
    assert len(frames) == len(by_name), 'Duplicate final names would obscure the current screenshot'
    for frame in frames:
        path = DOC / frame['file']
        assert frame['sourceFingerprint'] == source
        assert hashlib.sha256(path.read_bytes()).hexdigest() == frame['sha256'], path
        with Image.open(path) as bitmap:
            img = bitmap.convert('RGB')
            assert not any(all(img.getpixel((x, y)) == (37, 132, 232)
                for x in [int(img.width * .02), int(img.width * .5), int(img.width * .98)])
                for y in range(40, min(360, img.height // 4), 2)), 'Developer refresh strip: ' + str(path)
    for skin in SKINS:
        for mode in ['light', 'dark']:
            for state in MAIN + ['climbing', 'summary']:
                assert f'{skin}-{mode}-{state}' in by_name, (skin, mode, state)
    comparisons = read(EVIDENCE / 'round-7/captures.json')
    assert len(comparisons) == 48
    for frame in comparisons:
        assert frame['density'] == 320 and frame['logicalWidthDp'] == 360 and frame['fontScale'] == 1
        assert abs(frame['sourceRect'][3] / frame['sourceRect'][2] - frame['nativeRect'][3] / frame['nativeRect'][2]) < .003
    for mode in ['light', 'dark']:
        for state in FLOW:
            assert f'eva-unit-01-{mode}-{state}' in by_name, (mode, state)
    small = read(EVIDENCE / 'small/small-results.json')
    assert small['sourceFingerprint'] == source and sorted(small['passedStates']) == sorted(SMALL)
    assert len(small['frames']) == 28
    assert all(check['enabled'] and check['bounds'][3] - check['bounds'][1] >= 108 for check in small['checks'])
    for skin in ['pikachu', 'k-on']:
        custom = read(EVIDENCE / f'small-{skin}/small-results.json')
        assert custom['sourceFingerprint'] == source and custom['passedStates'] == ['home']
        assert len(custom['frames']) == 2
        assert custom['checks'][0]['enabled'] and custom['checks'][0]['bounds'][3] - custom['checks'][0]['bounds'][1] >= 108
    interaction = read(EVIDENCE / 'interaction/interaction-results.json')
    assert interaction['sourceFingerprint'] == source and interaction['allPassed']
    assert set(interaction['phases']) == {'appearance', 'coach', 'feedback', 'training'}
    assert all(phase['passed'] and phase['sourceFingerprint'] == source for phase in interaction['phases'].values())
    assert len(interaction['frames']) == 14
    assets = read(DOC / 'assets.json')
    edges = read(EVIDENCE / 'image-edge-audit.json')
    assert edges['passed'] and edges['sourceFingerprint'] == source
    listed = [item for skin in assets['skins'] for key in ['assets', 'headers', 'headerOverrides', 'details'] for item in skin.get(key, [])]
    assert assets['shippedPngCount'] == len(listed)
    assert {item['path'] for item in listed} == {path.relative_to(ROOT).as_posix() for path in (ROOT / 'assets/skins').rglob('*.png')}
    for item in listed:
        assert hashlib.sha256((ROOT / item['path']).read_bytes()).hexdigest() == item['sha256'], item['path']
    assert {item['path'] for item in edges['headers']} == {item['path'] for skin in assets['skins'] for key in ['headers', 'headerOverrides'] for item in skin.get(key, [])}
    report = {'passed': True, 'sourceFingerprint': source, 'baseVersion': '1.1.7', 'publicVersion': '1.1.5',
              'syntheticNativePackage': 'com.zxn.palou.uiqa', 'coreScreens': 84, 'sourceComparisons': 48,
              'sharedFlowScreens': 30, 'smallScreens': 32, 'smallStates': 14, 'additionalSmallHomeSkins': ['pikachu', 'k-on'],
              'interactionPhases': 4, 'interactionChecks': interaction['checks'],
              'nativeScreenshots': len(frames), 'shippedPngs': len(listed), 'shippedPngBytes': assets['shippedPngBytes'],
              'scope': 'Native visual and UI acceptance with synthetic data; no real-device motion or public release claim.'}
    (EVIDENCE / 'validation-summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
