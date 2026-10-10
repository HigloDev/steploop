"""Verify the standalone theme APK without changing existing emulator records."""
import argparse
import hashlib
import importlib
import json
import re
import socket
import sqlite3
import subprocess
import tarfile
import time
import zipfile
from pathlib import Path

qa = importlib.import_module('theme-pair-capture')
q = qa.q
q.PACKAGE = 'com.zxn.palou'
PRIVATE = q.ROOT / '.expo-export-check/theme-pair-20261010'
OUT = q.ROOT / 'docs/qa/theme-pair-20261010'
APK = q.ROOT / 'artifacts/theme-pair-1.1.2-20261010/steploop-1.1.2-light-dark.apk'
TOOLS = Path('E:/VibeCoding/Android/Sdk/build-tools/37.0.0')
q.OUT = PRIVATE / 'release-screens'
qa.RESULTS = PRIVATE / 'release-native-checks.json'


def storage(stage):
    folder = PRIVATE / ('release-db-' + stage)
    folder.mkdir(parents=True, exist_ok=True)
    archive_path = folder / 'data.tar'
    archive_path.write_bytes(q.adb('exec-out', 'su', '0', 'tar', '-cf', '-', '-C',
                                 '/data/user/0/' + q.PACKAGE, 'databases', binary=True))
    with tarfile.open(archive_path) as archive:
        for member in archive.getmembers():
            name = Path(member.name).name
            if member.isfile() and name in ['RKStorage', 'RKStorage-wal', 'RKStorage-shm', 'RKStorage-journal']:
                (folder / name).write_bytes(archive.extractfile(member).read())
    with sqlite3.connect(folder / 'RKStorage') as db:
        return dict(db.execute('SELECT key,value FROM catalystLocalStorage'))


def certificate(apk):
    result = subprocess.check_output([str(TOOLS / 'apksigner.bat'), 'verify', '--print-certs', str(apk)],
                                     encoding='utf-8', errors='replace')
    return re.search(r'certificate SHA-256 digest: (\w+)', result).group(1)


def preflight():
    assert q.SERIAL == 'emulator-5582', 'This check is for the isolated emulator only'
    before = storage('before')
    for key in ['steploop.fusionActive.v1', 'palou.activeWorkout.v1']:
        assert before.get(key) in [None, 'null', ''], 'An existing training must not be disturbed'
    installed_path = q.adb('shell', 'pm', 'path', q.PACKAGE).strip().split(':', 1)[1]
    previous = PRIVATE / 'installed-before.apk'
    previous.write_bytes(q.adb('exec-out', 'cat', installed_path, binary=True))
    assert certificate(APK) == certificate(previous), 'Certificate mismatch; do not uninstall'
    metadata = subprocess.check_output([str(TOOLS / 'aapt.exe'), 'dump', 'badging', str(APK)],
                                      encoding='utf-8', errors='replace')
    assert "package: name='com.zxn.palou' versionCode='11' versionName='1.1.2'" in metadata
    with zipfile.ZipFile(APK) as archive:
        bundle = archive.read('assets/index.android.bundle')
        assert all(token not in bundle for token in [b'UiQaApp', b'uiqa-summary', b'uiqa-height', b'index.uiqa'])
    print(json.dumps({'preflight': 'passed', 'savedKeys': len(before), 'sameCertificate': True,
                      'qaFixturesExcluded': True}), flush=True)
    return before


def start():
    q.adb('shell', 'am', 'force-stop', q.PACKAGE)
    q.adb('shell', 'am', 'start', '-n', q.PACKAGE + '/com.zxn.palou.MainActivity')
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        time.sleep(0.5)
        try:
            qa.expect('开始爬楼')
            return
        except (AssertionError, RuntimeError):
            pass
    raise RuntimeError('Standalone app did not start')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preflight-only', action='store_true')
    args = parser.parse_args()
    before = preflight()
    if not args.preflight_only:
        with socket.socket() as probe:
            probe.settimeout(1)
            assert probe.connect_ex(('127.0.0.1', 8087)) != 0, 'Stop the QA Metro before standalone checks'
        assert 'Success' in q.adb('install', '-r', str(APK))
        q.adb('logcat', '-c')
        for mode in ['light', 'dark']:
            qa.appearance(mode)
            start()
            qa.capture(mode, 'release-home')
            q.tap_label('记录')
            qa.expect('本周成果')
            qa.capture(mode, 'release-history')
            q.tap_label('设置')
            qa.expect('运动播报')
            qa.capture(mode, 'release-settings')
        assert storage('after-browsing') == before, 'Upgrade or theme browsing changed saved data'
        # Exercise a real session, keeping the existing records untouched.
        qa.appearance('light')
        start()
        start_button = next(label for label in qa.labels() if label.startswith('开始爬楼，从 '))
        q.tap_label(start_button)
        qa.expect('长按结束并保存')
        mark = next(label for label in qa.labels() if label.startswith('到了一层，记为 '))
        next_floor = int(re.search(r'记为 (\d+)', mark).group(1)) + 1
        q.tap_label(mark)
        retained_mark = f'到了一层，记为 {next_floor} 楼'
        qa.expect(retained_mark)
        checkpoint = json.loads(storage('live-before-switch')['steploop.fusionActive.v1'])
        for mode in ['light', 'dark', 'light']:
            qa.appearance(mode)
            qa.expect('长按结束并保存')
            qa.expect(retained_mark)
            qa.capture(mode, 'release-workout', workout=True)
            live = json.loads(storage('live-' + mode)['steploop.fusionActive.v1'])
            assert (live['workoutId'], live['startedAt']) == (checkpoint['workoutId'], checkpoint['startedAt'])
        q.tap_label('长按放弃本次，需要长按', hold=True)
        qa.expect('开始爬楼')
        assert storage('after-discard') == before, 'Test-session discard changed existing records'
        start()
        assert storage('restart') == before, 'Restart changed saved data'
        installed_path = q.adb('shell', 'pm', 'path', q.PACKAGE).strip().split(':', 1)[1]
        installed_hash = q.adb('shell', 'sha256sum', installed_path).split()[0]
        apk_hash = hashlib.sha256(APK.read_bytes()).hexdigest()
        assert installed_hash == apk_hash
        logs = q.adb('logcat', '-d', '-v', 'brief')
        (PRIVATE / 'release-logcat.txt').write_text(logs, encoding='utf-8')
        assert not any(token in logs for token in ['FATAL EXCEPTION', 'Unable to load script', 'ReferenceError:', 'TypeError:'])
        report = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'package': q.PACKAGE,
                  'version': '1.1.2', 'versionCode': 11, 'device': q.SERIAL,
                  'standaloneWithoutQaMetro': True, 'qaFixturesExcluded': True,
                  'sameCertificate': certificate(APK), 'savedKeysPreservedByteForByte': len(before),
                  'savedDataUnchanged': True, 'realWorkoutSwitchesAppearanceInPlace': True,
                  'markedFloorRetainedAcrossThemes': True, 'checkpointIdentityRetained': True,
                  'restartPreservesData': True, 'apkSha256': apk_hash,
                  'installedApkSha256': installed_hash, 'apkBytes': APK.stat().st_size,
                  'phoneInstalled': False, 'runtimeErrors': 0}
        (OUT / 'release-checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        q.adb('shell', 'wm', 'size', 'reset')
        q.adb('shell', 'wm', 'density', 'reset')
        q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
        q.adb('shell', 'cmd', 'uimode', 'night', 'auto')
        print(json.dumps(report, ensure_ascii=True), flush=True)
