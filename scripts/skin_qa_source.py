"""Fingerprint the actual skin runtime and shipped bitmaps for native evidence."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def source_fingerprint():
    manifest = json.loads((ROOT / 'docs/skins/assets.json').read_text(encoding='utf-8'))
    files = [*ROOT.glob('src/**/*.ts'), *ROOT.glob('src/**/*.tsx'), ROOT / 'package.json']
    for skin in manifest['skins']:
        files += [ROOT / item['path'] for key in ['assets', 'headers', 'headerOverrides'] for item in skin.get(key, [])]
    digest = hashlib.sha256()
    for file in sorted(set(files)):
        digest.update(file.relative_to(ROOT).as_posix().encode())
        digest.update(file.read_bytes())
    return digest.hexdigest()
