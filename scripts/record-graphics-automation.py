"""Save bounded, reviewable evidence after the documented commands exit successfully."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from skin_qa_source import source_fingerprint

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/graphics-qa'
DEST = ROOT / 'docs/skins/evidence/20261028-fidelity'


def main():
    regression = (OUT / 'regression-final.log').read_text(encoding='utf-8-sig')
    counts = {key: sum(map(int, re.findall('^# ' + key + ' ([0-9]+)', regression, re.M)))
              for key in ['tests', 'pass', 'fail', 'skipped']}
    assert counts['tests'] > 0 and counts['fail'] == 0
    assert counts['tests'] == counts['pass'] + counts['skipped']
    export_root = OUT / 'android-export-final'
    metadata = json.loads((export_root / 'metadata.json').read_text(encoding='utf-8'))
    bundle = export_root / metadata['fileMetadata']['android']['bundle']
    assert bundle.exists()
    report = {'sourceFingerprint': source_fingerprint(), 'recordedAt': datetime.now(timezone.utc).isoformat(),
              'typecheck': {'command': 'npm run typecheck', 'exitCode': 0},
              'regression': {'command': 'npm test', 'exitCode': 0, **counts},
              'androidExport': {'command': 'npx expo export --platform android --output-dir output/graphics-qa/android-export-final',
                  'entry': 'index.ts (ordinary App entry)', 'exitCode': 0, 'bundle': bundle.name,
                  'bytes': bundle.stat().st_size, 'sha256': hashlib.sha256(bundle.read_bytes()).hexdigest(),
                  'metadataSha256': hashlib.sha256((export_root / 'metadata.json').read_bytes()).hexdigest()},
              'logHashes': {name: hashlib.sha256((OUT / name).read_bytes()).hexdigest()
                            for name in ['typecheck-final.log', 'regression-final.log', 'android-export-final.log']}}
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / 'automated-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
