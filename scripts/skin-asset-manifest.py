"""Refresh exact hashes/provenance for shipped skin bitmaps; never edits images."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'docs/skins/assets.json'
PAGES = ['home', 'coach', 'history', 'settings']
PROVENANCE = ROOT / 'docs/skins/asset-provenance/edge-r2.json'
GROUPS = ['assets', 'headers', 'headerOverrides', 'details']
GENERATED = {
    'night-run': ['44b7d194-44d1-4e0a-8a39-ebfc9172e2b4', 'a8df31d0-aed9-4f26-9da3-3cef7e880cdd', '32ef8661-222f-4ba9-a8c3-984a40c327bc', 'a3f74aae-0893-4faf-b5ed-c35c45c179f4'],
    'woodland': ['96132ac6-70df-4f8d-bc7e-4119e44601f0', 'de4262a1-79e6-4d7b-8562-9d44dc3f9782', 'b569bafb-fc23-43bf-b8cc-9e3143816abf', '4d7d23c0-ee1d-4e66-9499-4c60f1f79a52'],
    'eva-unit-01': ['50ef61ba-ac48-4bb0-bb34-ecf3d65ebeea', '240d0c5a-867a-49c4-b15d-bfa4721425e9', '80c580b9-9172-4acc-b0ee-3d74354edc6e', 'b7269f33-d5e7-4401-aec6-b51ed8f26c77'],
    'eva-unit-02': ['d146cfc6-04f4-43a7-92ed-a45abf1240e2', 'c9b7da85-42d5-4826-8307-e37cd24e2260', 'd4aa3322-6ddb-4ccd-bda3-aa33f40c571e', '36033233-6181-472d-b3db-09de785044f0'],
    'k-on': ['854b7792-f762-4402-ab0f-1a00fd1a227b', '32cc9475-169d-4218-a422-8639f2843b81', 'e36f295d-8f16-40a4-9864-64b5e8fcf4a7', '9c5d2b02-dc9b-487a-a43f-b86bbe76ab42'],
}


def bitmap(path):
    data = path.read_bytes()
    with Image.open(path) as img:
        assert img.mode == 'RGBA', path
        width, height = img.size
        alpha = list(img.getchannel('A').getextrema())
    return {'path': path.relative_to(ROOT).as_posix(), 'width': width, 'height': height,
            'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'alphaRange': alpha}


def main():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    revisions = {item['path']: item for item in json.loads(PROVENANCE.read_text(encoding='utf-8'))} if PROVENANCE.exists() else {}
    manifest.update({'schemaVersion': 3, 'headerPages': PAGES,
                     'referencePolicy': 'Five skins use ImageGen reference edits. Pikachu alone uses the explicitly approved local extraction of existing artwork.'})
    for skin in manifest['skins']:
        previous_headers = {item['page']: item for item in skin.get('headers', [])}
        previous_overrides = {(item['page'], item['mode']): item for item in skin.get('headerOverrides', [])}
        skin['headers'] = []
        skin['headerOverrides'] = []
        for item in skin['assets']:
            item.update(bitmap(ROOT / item['path']))
            if skin['id'] == 'pikachu' and item['role'] == 'achievement':
                provenance_file = ROOT / 'output/graphics-qa/pikachu-extraction/mark-achievement-provenance.json'
                if provenance_file.exists():
                    records = json.loads(provenance_file.read_text(encoding='utf-8'))
                    cleanup = next(record for record in records if record['role'] == 'achievement').get('alphaCleanup', {})
                    item['alphaCleanup'] = {key: cleanup[key] for key in ['reason', 'previousSha256', 'regions', 'method', 'changedAlphaPixels', 'allRgbUnchanged', 'pixelsOutsideSelectedGapsUnchanged', 'eyeAndHighlightsUnchanged'] if key in cleanup}
        if skin['id'] == 'pikachu':
            skin['userApproval'] = 'User explicitly approved local extraction of existing Pikachu artwork from the confirmed concept boards.'
        if skin['id'] == 'classic':
            continue
        for index, page in enumerate(PAGES):
            path = ROOT / 'assets/skins' / skin['id'] / f'header-{page}.png'
            item = {'page': page, **bitmap(path), 'reference': f'docs/skins/design-references/{skin["id"]}-four-tabs.png'}
            if skin['id'] == 'pikachu':
                provenance_file = ROOT / f'output/graphics-qa/pikachu-header-{page}-source.json'
                provenance = json.loads(provenance_file.read_text(encoding='utf-8')) if provenance_file.exists() else previous_headers[page]
                item['method'] = provenance['method']
                for key in ['sourceSha256', 'sourceDimensions', 'sourceSelection', 'cropBoxExclusive', 'sourceCropPixels', 'sourceLimitations']:
                    if key in provenance:
                        item[key] = provenance[key]
            else:
                item.update({'method': 'image_gen reference edit; no local extraction of the concept board',
                             'sourceOutput': 'exec-' + GENERATED[skin['id']][index] + '.png'})
            skin['headers'].append(item)
            override = path.with_name(f'header-{page}-dark.png')
            if override.exists():
                provenance_file = ROOT / f'output/graphics-qa/{skin["id"]}-header-{page}-dark-source.json'
                provenance = json.loads(provenance_file.read_text(encoding='utf-8')) if provenance_file.exists() else previous_overrides.get((page, 'dark'), {})
                detail = {'page': page, 'mode': 'dark', **bitmap(override), 'reference': item['reference']}
                for key in ['method', 'sourceSha256', 'sourceDimensions', 'sourceSelection', 'cropBoxExclusive', 'sourceCropPixels', 'sourceLimitations', 'sourceOutput', 'prompt']:
                    if key in provenance:
                        detail[key] = provenance[key]
                if 'sourceOutput' in detail:
                    detail['sourceOutput'] = detail['sourceOutput'].replace('\\', '/').rsplit('/', 1)[-1]
                skin['headerOverrides'].append(detail)
        previous_details = {item['path']: item for item in skin.get('details', [])}
        known = {item['path'] for key in ['assets', 'headers', 'headerOverrides'] for item in skin.get(key, [])}
        skin['details'] = []
        for path in sorted((ROOT / 'assets/skins' / skin['id']).glob('*.png')):
            if path.relative_to(ROOT).as_posix() not in known:
                item = {**previous_details.get(path.relative_to(ROOT).as_posix(), {}), 'role': path.stem, **bitmap(path)}
                skin['details'].append(item)
        for key in GROUPS:
            for item in skin.get(key, []):
                revision = revisions.get(item['path'])
                if revision:
                    assert revision['sha256'] == item['sha256'], item['path']
                    for field in ['method', 'sourceOutput', 'reference', 'sourceSha256', 'sourceDimensions', 'sourceSelection', 'cropBoxExclusive', 'sourceCropPixels', 'sourceLimitations', 'revisionReason', 'provenance']:
                        if field in revision:
                            item[field] = revision[field]
    manifest['shippedPngCount'] = sum(len(s.get(key, [])) for s in manifest['skins'] for key in GROUPS)
    manifest['shippedPngBytes'] = sum(a['bytes'] for s in manifest['skins'] for key in GROUPS for a in s.get(key, []))
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'{manifest["shippedPngCount"]} PNGs documented with exact hashes')


if __name__ == '__main__':
    main()
