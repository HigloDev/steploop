"""Verify the preserved business baseline and the independent build's inputs."""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT.parent / 'palou-ui-baselines/20261010-002242'
BUILD = Path('G:/pui112')
OUT = ROOT / 'docs/qa/ui-redraw-20261010'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

baseline = json.loads((BASE / 'manifest.json').read_text(encoding='utf-8-sig'))
domain = [entry for entry in baseline if entry['path'].startswith(('src/core/', 'src/hooks/', 'src/services/', 'native/'))]
changed = [entry['path'] for entry in domain if not (ROOT / entry['path']).exists() or digest(ROOT / entry['path']) != entry['sha256']]
assert not changed, 'Business baseline changed: ' + str(changed)

inputs = []
for folder in ['src', 'native', 'plugins', 'assets']:
    inputs += [file for file in (ROOT / folder).rglob('*') if file.is_file()]
inputs += [ROOT / name for name in ['App.tsx', 'index.ts', 'app.json', 'package.json', 'package-lock.json', 'babel.config.js', 'metro.config.js', 'tsconfig.json'] if (ROOT / name).exists()]
manifest = []
for file in sorted(inputs):
    relative = file.relative_to(ROOT).as_posix()
    built = BUILD / relative
    assert built.exists() and digest(file) == digest(built), 'Build/source mismatch: ' + relative
    manifest.append({'path': relative, 'sha256': digest(file), 'bytes': file.stat().st_size})
(OUT / 'build-source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')

def failures(log):
    return set(re.findall(r'^not ok \d+ - (.+)$', log.read_text(encoding='utf-8-sig', errors='replace'), re.M))

scratch = ROOT / '.expo-export-check'
old_training = failures(scratch / 'ui-baseline-training-test.log')
new_training = failures(scratch / 'ui-npm-test.log')
old_prd = failures(scratch / 'ui-baseline-prd-test.log')
new_prd = failures(scratch / 'ui-prd-test.log')
assert new_training == old_training
assert not (new_prd - old_prd)
report = {'baseline': str(BASE), 'businessFilesCompared': len(domain), 'businessFilesChanged': changed,
          'buildInputFilesCompared': len(manifest), 'buildInputsIdentical': True,
          'existingTestFailures': {'trainingBaseline': len(old_training), 'trainingCurrent': len(new_training),
            'prdBaseline': len(old_prd), 'prdCurrent': len(new_prd), 'newFailingTestNames': []}}
(OUT / 'source-integrity.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=True))
