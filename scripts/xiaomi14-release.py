"""Data-preserving standalone release checks on the existing emulator only."""
import argparse
import hashlib
import importlib
import json
import re
import socket
import subprocess
import time
import zipfile

base = importlib.import_module('theme-pair-release')
qa, q = base.qa, base.q
base.PRIVATE = q.ROOT / '.expo-export-check/xiaomi14-improvements-20261010'
base.OUT = q.ROOT / 'docs/qa/xiaomi14-improvements-20261010'
base.APK = q.ROOT / 'artifacts/xiaomi14-1.1.3-20261010/steploop-1.1.3-xiaomi14.apk'
q.OUT = base.PRIVATE / 'release-screens'
qa.RESULTS = base.PRIVATE / 'release-native-checks.json'


def preflight():
    assert q.SERIAL == 'emulator-5582'
    before = base.storage('before')
    for key in ['steploop.fusionActive.v1', 'palou.activeWorkout.v1']:
        assert before.get(key) in [None, 'null', ''], 'Existing workout must not be disturbed'
    installed = q.adb('shell', 'pm', 'path', q.PACKAGE).strip().split(':', 1)[1]
    previous = base.PRIVATE / 'installed-before.apk'
    q.adb('pull', installed, str(previous))
    assert base.certificate(base.APK) == base.certificate(previous), 'Signing mismatch; installation stopped'
    metadata = subprocess.check_output([str(base.TOOLS / 'aapt.exe'), 'dump', 'badging', str(base.APK)], encoding='utf-8', errors='replace')
    assert "package: name='com.zxn.palou' versionCode='12' versionName='1.1.3'" in metadata
    with zipfile.ZipFile(base.APK) as archive:
        bundle = archive.read('assets/index.android.bundle')
        assert all(token not in bundle for token in [b'UiQaApp', b'uiqa-summary', b'uiqa-height', b'index.uiqa'])
    print(json.dumps({'preflight': 'passed', 'savedKeys': len(before), 'sameCertificate': True, 'qaFixturesExcluded': True}), flush=True)
    return before


def verify():
    before = preflight()
    with socket.socket() as probe:
        probe.settimeout(1)
        assert probe.connect_ex(('127.0.0.1', 8087)) != 0, 'Stop QA Metro before standalone verification'
    assert 'Success' in q.adb('install', '-r', str(base.APK))
    q.adb('logcat', '-c')
    for mode in ['light', 'dark']:
        qa.appearance(mode)
        base.start()
        qa.capture(mode, 'release-home')
        share = next(label for label in qa.labels() if label == '分享本周成果')
        q.tap_label(share)
        qa.expect('本周成果分享')
        qa.capture(mode, 'release-weekly-share')
        q.adb('shell', 'input', 'keyevent', '4')
        q.tap_label('记录')
        qa.expect('本周成果')
        qa.capture(mode, 'release-history')
        q.tap_label('设置')
        qa.expect('运动播报')
        qa.capture(mode, 'release-settings')
        for _ in range(6):
            if any('预览盖楼结算' in label for label in qa.labels()): break
            q.adb('shell', 'input', 'swipe', '600', '2100', '600', '1100', '300')
            time.sleep(0.5)
        q.tap_label('预览盖楼结算')
        time.sleep(7)
        qa.expect('预览盖楼结算')
        pid = q.adb('shell', 'pidof', q.PACKAGE).strip().split()[0]
        audio_log = q.adb('logcat', '-d', '--pid=' + pid, '-s', 'ReactNativeJS:I', '*:S')
        assert '[completion-sound] finished' in audio_log, 'Bundled chime did not finish in ' + mode
        print(json.dumps({'bundledChimeFinished': mode}), flush=True)
    assert base.storage('after-browsing') == before, 'Browsing or upgrade changed saved data'
    qa.appearance('light')
    base.start()
    q.tap_label(next(label for label in qa.labels() if label.startswith('开始爬楼，从 ')))
    qa.expect('长按结束并保存')
    mark = next(label for label in qa.labels() if label.startswith('到了一层，记为 '))
    q.tap_label(mark)
    qa.expect('当前步数')
    qa.expect('消耗热量')
    checkpoint = json.loads(base.storage('live-before-switch')['steploop.fusionActive.v1'])
    for mode in ['dark', 'light']:
        qa.appearance(mode)
        qa.expect('长按结束并保存')
        live = json.loads(base.storage('live-' + mode)['steploop.fusionActive.v1'])
        assert (live['workoutId'], live['startedAt']) == (checkpoint['workoutId'], checkpoint['startedAt'])
    q.tap_label('长按放弃本次，需要长按', hold=True)
    qa.expect('开始爬楼')
    assert base.storage('after-discard') == before, 'Discard changed existing data'
    base.start()
    assert base.storage('after-restart') == before
    installed = q.adb('shell', 'pm', 'path', q.PACKAGE).strip().split(':', 1)[1]
    installed_hash = q.adb('shell', 'sha256sum', installed).split()[0]
    apk_hash = hashlib.sha256(base.APK.read_bytes()).hexdigest()
    assert installed_hash == apk_hash
    logs = q.adb('logcat', '-d', '-v', 'brief')
    (base.PRIVATE / 'release-logcat.txt').write_text(logs, encoding='utf-8')
    assert not any(token in logs for token in ['FATAL EXCEPTION', 'Unable to load script', 'ReferenceError:', 'TypeError:'])
    result = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'version': '1.1.3', 'versionCode': 12,
              'package': q.PACKAGE, 'device': q.SERIAL, 'standaloneWithoutMetro': True,
              'qaFixturesExcluded': True, 'savedKeysPreservedByteForByte': len(before), 'savedDataUnchanged': True,
              'bundledChimeCompletedInBothThemes': True,
              'checkpointPreservedAcrossThemes': True, 'restartPreservesData': True, 'runtimeErrors': 0,
              'apkSha256': apk_hash, 'installedApkSha256': installed_hash,
              'certificateSha256': base.certificate(base.APK), 'apkBytes': base.APK.stat().st_size}
    (base.OUT / 'release-checks.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preflight-only', action='store_true')
    args = parser.parse_args()
    try:
        if args.preflight_only: preflight()
        else: verify()
    finally:
        if not args.preflight_only:
            q.adb('shell', 'wm', 'size', 'reset')
            q.adb('shell', 'wm', 'density', 'reset')
            q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
            q.adb('shell', 'cmd', 'uimode', 'night', 'auto')
