"""Assemble a hash-checked internal APK handoff from verified native evidence."""
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
QA = ROOT / 'docs/qa/ui-redraw-20261010'
SCRATCH = ROOT / '.expo-export-check'
OUT = ROOT / 'artifacts/ui-redraw-1.1.2-20261010'
APK = Path('G:/pui112/android/app/build/outputs/apk/release/app-release.apk')


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


assert 'final result: passed' in (ROOT / 'design-qa.md').read_text(encoding='utf-8')
screens = read(QA / 'manifest.json')
assert len(screens['states']) == 23
for state in screens['states']:
    assert digest(QA / state['actual']) == state['actualSha256']
    assert Image.open(QA / state['actual']).size == tuple(state['viewport'])

latest = {entry['case']: entry for entry in read(QA / 'runtime-checks.json')}
assert len(latest) == 24 and all(entry['result'] == 'passed' for entry in latest.values())
integrity = read(QA / 'source-integrity.json')
assert not integrity['businessFilesChanged'] and integrity['buildInputsIdentical']
release = read(QA / 'release-checks.json')
assert all(release[key] for key in ['independentColdStart', 'qaMetroStopped', 'oldStoredValuesUnchanged',
                                  'sameUpgradeCertificate', 'releaseFixtureCodeExcluded'])
assert digest(APK) == release['apkSha256']

metadata = subprocess.check_output(['E:/VibeCoding/Android/Sdk/build-tools/37.0.0/aapt.exe',
                                   'dump', 'badging', str(APK)], encoding='utf-8', errors='replace')
sdk = int(re.search(r"sdkVersion:'(\d+)'", metadata).group(1))
target_sdk = int(re.search(r"targetSdkVersion:'(\d+)'", metadata).group(1))

def suite_counts(path):
    log = path.read_text(encoding='utf-8-sig', errors='replace')
    tests = list(map(int, re.findall(r'^# tests (\d+)$', log, re.M)))
    passes = list(map(int, re.findall(r'^# pass (\d+)$', log, re.M)))
    fails = list(map(int, re.findall(r'^# fail (\d+)$', log, re.M)))
    assert len(tests) == len(passes) == len(fails)
    return [dict(total=t, passed=p, failed=f) for t, p, f in zip(tests, passes, fails)]


names = ['core', 'fusion-flow', 'data', 'progress', 'd03', 'gates', 'dataset-kit', 'device-matrix',
         'recovery-drill', 'dependencies', 'signing', 'training-automation']
counts = suite_counts(SCRATCH / 'ui-npm-test.log')
assert len(counts) == len(names)
build_log = (SCRATCH / 'ui-short-release-final.log').read_text(encoding='utf-8-sig', errors='replace')
assert 'BUILD SUCCESSFUL' in build_log
doctor_log = (SCRATCH / 'ui-expo-doctor-final-proxy.log').read_text(encoding='utf-8-sig', errors='replace')
assert '21/21 checks passed' in doctor_log

exports = []
for name, expected in [('poster-4x5.png', (1080, 1350)), ('poster-1x1.png', (1080, 1080)), ('poster-3x4.png', (1080, 1440))]:
    file = QA / 'exports' / name
    assert Image.open(file).size == expected
    exports.append({'file': 'exports/' + name, 'pixels': list(expected), 'sha256': digest(file)})

summary = {'scopedUiStatus': 'passed', 'exactPixelEqualityClaimed': False,
           'pages': 10, 'representativeStates': 23, 'focusedComparisons': 8,
           'extraScreenshots': len(read(QA / 'extras.json')), 'nativeChecksLatest': list(latest.values()),
           'typeScriptExitCode': 0, 'expoDoctor': '21/21', 'uiQaIsolationTests': '2/2',
           'unitSuites': dict(zip(names, counts)), 'voice': suite_counts(SCRATCH / 'ui-voice-test.log')[0],
           'prd': suite_counts(SCRATCH / 'ui-prd-test.log')[0],
           'fullLegacyNpmTestStatus': 'failed_existing_baseline',
           'newFailingTestNames': integrity['existingTestFailures']['newFailingTestNames'],
           'build': 'Android Release variant / embedded JS / BUILD SUCCESSFUL',
           'exports': exports, 'galleryBrowserChecked': True, 'galleryConsoleErrors': 0,
           'physicalPhoneFieldAcceptance': 'not_run', 'iosAcceptance': 'not_run'}
(QA / 'verification-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

OUT.mkdir(parents=True, exist_ok=True)
destination = OUT / 'steploop-1.1.2-ui-internal.apk'
shutil.copyfile(APK, destination)
assert digest(destination) == release['apkSha256']

evidence_files = ['design-qa.md', 'docs/UI_IMPLEMENTATION_1.1.2_20261010.md',
                  'docs/qa/ui-redraw-20261010/manifest.json', 'docs/qa/ui-redraw-20261010/runtime-checks.json',
                  'docs/qa/ui-redraw-20261010/release-checks.json', 'docs/qa/ui-redraw-20261010/source-integrity.json',
                  'docs/qa/ui-redraw-20261010/build-source-manifest.json', 'docs/qa/ui-redraw-20261010/verification-summary.json']
manifest = {'product': '循阶', 'version': '1.1.2', 'versionCode': 11, 'package': 'com.zxn.palou',
            'sourceWorkspace': str(ROOT), 'sourceBranch': 'codex/continue-fusion-20261009',
            'apk': destination.name, 'apkBytes': destination.stat().st_size, 'apkSha256': digest(destination),
            'minSdk': sdk, 'targetSdk': target_sdk, 'abis': release['abis'],
            'signing': release['signingType'], 'certificateSha256': release['certificateSha256'],
            'embeddedBundle': True, 'developmentFixtureExcluded': True, 'designQaResult': 'passed',
            'oldEmulatorDataPreserved': True, 'phoneTouched': False, 'formalStoreRelease': False,
            'exactPixelEqualityClaimed': False,
            'evidence': [{'path': name, 'bytes': (ROOT / name).stat().st_size, 'sha256': digest(ROOT / name)} for name in evidence_files]}
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
(OUT / (destination.name + '.sha256')).write_text(digest(destination) + '  ' + destination.name + '\n', encoding='ascii')
print(json.dumps({'apk': str(destination), 'sha256': digest(destination), 'bytes': destination.stat().st_size,
                  'nativeCasesPassed': len(latest), 'screens': len(screens['states']), 'minSdk': sdk, 'targetSdk': target_sdk}, ensure_ascii=True))
