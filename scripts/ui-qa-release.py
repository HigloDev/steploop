"""Verify the actual standalone APK and preservation of the emulator's old app data.

Private database snapshots stay in the ignored .expo-export-check directory.
"""
import hashlib
import importlib.util
import json
import re
import sqlite3
import socket
import subprocess
import tarfile
import time
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('capture', Path(__file__).with_name('ui-qa-capture.py'))
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)
ROOT = q.ROOT
OUT = q.OUT
SCRATCH = ROOT / '.expo-export-check'
APK = Path('G:/pui112/android/app/build/outputs/apk/release/app-release.apk')
TOOLS = Path('E:/VibeCoding/Android/Sdk/build-tools/37.0.0')

metadata = subprocess.check_output([str(TOOLS/'aapt.exe'), 'dump', 'badging', str(APK)], encoding='utf-8', errors='replace')
assert "package: name='com.zxn.palou' versionCode='11' versionName='1.1.2'" in metadata
signer = subprocess.check_output([str(TOOLS/'apksigner.bat'), 'verify', '--print-certs', str(APK)], encoding='utf-8', errors='replace')
certificate = re.search(r'certificate SHA-256 digest: (\w+)', signer).group(1)
old_signer = subprocess.check_output([str(TOOLS/'apksigner.bat'), 'verify', '--print-certs', str(SCRATCH/'ui-normal-app-before.apk')], encoding='utf-8', errors='replace')
assert certificate in old_signer
with zipfile.ZipFile(APK) as archive:
    bundle = archive.read('assets/index.android.bundle')
    assert all(token not in bundle for token in [b'UiQaApp', b'uiqa-summary', b'index.uiqa', b'uiqa-building-a'])

print(json.dumps({'apkMetadata': '1.1.2 / 11', 'sameCertificate': True, 'fixtureCodeExcluded': True}), flush=True)
with socket.socket() as probe:
    probe.settimeout(1)
    assert probe.connect_ex(('127.0.0.1', 8087)) != 0, 'Stop the QA Metro before standalone acceptance'
q.adb('install', '-r', str(APK))
q.adb('shell', 'am', 'force-stop', q.PACKAGE)
q.adb('reverse', '--remove', 'tcp:8081')
q.PACKAGE = 'com.zxn.palou'
q.OUT = SCRATCH / 'release-native'
q.adb('shell', 'am', 'force-stop', q.PACKAGE)
q.adb('shell', 'am', 'start', '-n', q.PACKAGE+'/com.zxn.palou.MainActivity')
for _ in range(20):
    time.sleep(1)
    values = [n.get('text', '') + n.get('content-desc', '') for n in q.tree().iter('node') if n.get('package') == q.PACKAGE]
    if any('开始爬楼' in value for value in values):
        break
else:
    q.capture('release-start-unexpected')
    raise RuntimeError('Standalone home did not load')
q.capture('release-home')
q.tap_label('记录')
q.capture('release-history')
q.tap_label('设置')
q.capture('release-settings')
pid = q.adb('shell', 'pidof', q.PACKAGE).strip().split()[0]
log = q.adb('logcat', '-d', '--pid', pid)
(SCRATCH/'ui-release-runtime.log').write_text(log, encoding='utf-8')
assert not re.search(r'FATAL EXCEPTION|Unable to load script|ReferenceError:|TypeError:', log), 'Native runtime error'

after = SCRATCH/'ui-normal-app-after-launch.tar'
after.write_bytes(q.adb('exec-out', 'su', '0', 'tar', '-cf', '-', '-C', '/data/user/0/'+q.PACKAGE, '.', binary=True))

def snapshot(archive_path, stage):
    target = SCRATCH / ('normal-db-' + stage)
    target.mkdir(exist_ok=True)
    with tarfile.open(archive_path) as archive:
        for member in archive.getmembers():
            name = Path(member.name).name
            if member.isfile() and '/databases/' in '/'+member.name and name in ['RKStorage', 'RKStorage-wal', 'RKStorage-shm', 'RKStorage-journal']:
                (target/name).write_bytes(archive.extractfile(member).read())
    db = sqlite3.connect(target/'RKStorage')
    values = dict(db.execute('SELECT key,value FROM catalystLocalStorage'))
    db.close()
    canonical = json.dumps(values, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    return values, {'stage':stage, 'keys':len(values), 'storageSha256':hashlib.sha256(canonical).hexdigest()}

before_values, before_info = snapshot(SCRATCH/'ui-normal-app-before.tar', 'before')
after_values, after_info = snapshot(after, 'after-launch')
changed = [key for key,value in before_values.items() if after_values.get(key) != value]
assert not changed, 'Old stored values changed: ' + str(changed)
report = {'package':q.PACKAGE, 'version':'1.1.2', 'versionCode':11, 'device':q.SERIAL,
          'independentColdStart':True, 'qaMetroStopped':True, 'metroReverse8081Removed':True, 'homeHistorySettingsOpened':True,
          'oldStoredValuesUnchanged':True, 'changedOldKeys':changed,
          'addedKeys':sorted(set(after_values)-set(before_values)), 'snapshots':[before_info,after_info],
          'sameUpgradeCertificate':True, 'certificateSha256':certificate, 'signingType':'Android Debug internal',
          'releaseFixtureCodeExcluded':True, 'nativeRuntimeErrors':0,
          'apkBytes':APK.stat().st_size, 'apkSha256':hashlib.sha256(APK.read_bytes()).hexdigest(),
          'abis':['arm64-v8a','x86_64'], 'physicalDeviceConnected':False}
(OUT/'release-checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=True), flush=True)
