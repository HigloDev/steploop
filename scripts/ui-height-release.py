"""Data-preserving standalone APK verification on the emulator only."""
import hashlib
import importlib.util
import json
import re
import socket
import sqlite3
import subprocess
import tarfile
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/qa/height-references-20261010'
PRIVATE = ROOT / '.expo-export-check/height-references-20261010'
APK = ROOT / 'artifacts/height-references-1.1.2-20261010/steploop-1.1.2-height-references.apk'
TOOLS = Path('E:/VibeCoding/Android/Sdk/build-tools/37.0.0')
spec = importlib.util.spec_from_file_location('feature', ROOT / 'scripts/ui-height-references.py')
feature = importlib.util.module_from_spec(spec); spec.loader.exec_module(feature)
q = feature.q; q.PACKAGE = 'com.zxn.palou'

def storage(stage):
    dest = PRIVATE / ('release-db-' + stage); dest.mkdir(parents=True, exist_ok=True)
    archive_path = dest / 'data.tar'
    archive_path.write_bytes(q.adb('exec-out', 'su', '0', 'tar', '-cf', '-', '-C', '/data/user/0/' + q.PACKAGE, 'databases', binary=True))
    with tarfile.open(archive_path) as archive:
        for member in archive.getmembers():
            name = Path(member.name).name
            if member.isfile() and name in ['RKStorage', 'RKStorage-wal', 'RKStorage-shm', 'RKStorage-journal']:
                (dest / name).write_bytes(archive.extractfile(member).read())
    with sqlite3.connect(dest / 'RKStorage') as db:
        return dict(db.execute('SELECT key,value FROM catalystLocalStorage'))

before = storage('before')
for key in ['steploop.fusionActive.v1', 'palou.activeWorkout.v1']:
    assert before.get(key) in [None, 'null', ''], 'Existing training cannot be disturbed'
metadata = subprocess.check_output([str(TOOLS / 'aapt.exe'), 'dump', 'badging', str(APK)], encoding='utf-8', errors='replace')
assert "package: name='com.zxn.palou' versionCode='11' versionName='1.1.2'" in metadata
signer = subprocess.check_output([str(TOOLS / 'apksigner.bat'), 'verify', '--print-certs', str(APK)], encoding='utf-8', errors='replace')
certificate = re.search(r'certificate SHA-256 digest: (\w+)', signer).group(1)
old_signer = subprocess.check_output([str(TOOLS / 'apksigner.bat'), 'verify', '--print-certs', str(ROOT / 'artifacts/ui-audit-1.1.2-20261010/steploop-1.1.2-ui-audit.apk')], encoding='utf-8', errors='replace')
assert certificate in old_signer
with zipfile.ZipFile(APK) as archive:
    bundle = archive.read('assets/index.android.bundle')
    assert all(token not in bundle for token in [b'UiQaApp', b'uiqa-summary', b'uiqa-height', b'uiqa-building-a', b'index.uiqa'])
with socket.socket() as probe:
    probe.settimeout(1)
    assert probe.connect_ex(('127.0.0.1', 8087)) != 0, 'QA Metro must be stopped'
feature.config()
assert 'Success' in q.adb('install', '-r', str(APK))
q.adb('shell', 'am', 'force-stop', q.PACKAGE)
q.adb('logcat', '-c')
q.adb('shell', 'am', 'start', '-n', q.PACKAGE + '/com.zxn.palou.MainActivity')
feature.expect('开始爬楼'); feature.capture('release-home')
feature.expect('查看全部 37 种高度参照')
q.tap_label('查看全部 37 种高度参照'); feature.expect('37 种高度参照'); feature.capture('release-catalog')
q.tap_label('关闭高度参照'); feature.expect('开始爬楼')
q.tap_label('起始楼层 1 楼，点按修改'); feature.expect('从几楼出发'); q.tap_label('好')
q.tap_label('记录'); feature.expect('本周成果'); feature.capture('release-history')
after = storage('after')
assert before == after, 'Upgrade or browsing changed existing saved data'
q.adb('shell', 'am', 'force-stop', q.PACKAGE)
q.adb('shell', 'am', 'start', '-n', q.PACKAGE + '/com.zxn.palou.MainActivity')
feature.expect('查看全部 37 种高度参照')
assert before == storage('restart'), 'Restart changed existing saved data'
package_path = q.adb('shell', 'pm', 'path', q.PACKAGE).strip().split(':', 1)[1]
installed_hash = q.adb('shell', 'sha256sum', package_path).split()[0]
apk_hash = hashlib.sha256(APK.read_bytes()).hexdigest()
assert installed_hash == apk_hash
logs = q.adb('logcat', '-d', '-v', 'brief')
(PRIVATE / 'release-logcat.txt').write_text(logs, 'utf-8')
assert not any(token in logs for token in ['FATAL EXCEPTION', 'Unable to load script', 'ReferenceError:', 'TypeError:'])
report = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'package': q.PACKAGE, 'version': '1.1.2', 'versionCode': 11,
 'device': q.SERIAL, 'standaloneWithoutQaMetro': True, 'qaFixturesExcluded': True, 'sameCertificate': certificate,
 'savedKeysPreservedByteForByte': len(before), 'savedDataUnchanged': True, 'referenceEntranceWorks': True,
 'previousFloorPickerWorksAfterReferenceDismiss': True, 'restartPreservesFeatureAndData': True,
 'apkSha256': apk_hash, 'installedApkSha256': installed_hash, 'apkBytes': APK.stat().st_size,
 'phoneInstalled': False, 'runtimeErrors': 0}
(OUT / 'release-checks.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), 'utf-8')
q.adb('shell', 'wm', 'size', 'reset'); q.adb('shell', 'wm', 'density', 'reset')
q.adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0')
q.adb('shell', 'cmd', 'uimode', 'night', 'auto')
print(json.dumps(report, ensure_ascii=True), flush=True)
