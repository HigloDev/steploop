"""Verify the current 112-frame high-density matrix, never historical evidence.

Exit 0: coverage and every independent visual review pass.
Exit 1: missing, stale or invalid capture evidence (coverage failure).
Exit 2: coverage passes, but visual review is pending, failed or source-limited.

visual-review.json: {sourceFingerprint, reviewer, reviewedAt, frames: [
  {file: "final-1p5k/classic-light-home.png", sha256, status: "pass", notes}
]}. A review is bound to the exact PNG hash. A capture's pending-review field
is not approval; only a matching independent review may complete it. Explicit
failed captures cannot be overridden by review and must be recaptured.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

from PIL import Image
from skin_qa_source import source_fingerprint

ROOT = Path(__file__).resolve().parents[1]
SKINS = ['classic', 'night-run', 'woodland', 'eva-unit-01', 'eva-unit-02', 'pikachu', 'k-on']
MODES = ['light', 'dark']
PAGES = ['home', 'coach', 'history', 'settings']
GROUPS = {'final-1p5k': 'phone-1p5k-125', 'final-2k': 'phone-2k-same-layout-125'}
REVIEW_STATUSES = {'pass', 'failed', 'known-source-limitation', 'pending-review'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def profile_errors(actual, profile_id, expected):
    errors = []
    if not isinstance(actual, dict):
        return ['missing displayProfile']
    if actual.get('id') != profile_id:
        errors.append('wrong display profile ID')
    for key, value in expected.items():
        if actual.get(key) != value:
            errors.append('display profile differs at ' + key)
    readback = actual.get('readback', {})
    if not isinstance(readback, dict):
        return errors + ['missing/invalid display readback']
    size = re.findall(r'\d+x\d+', str(readback.get('size', '')))
    density = re.findall(r'density:\s*(\d+)', str(readback.get('density', '')))
    if not size or size[-1] != 'x'.join(map(str, expected['size'])):
        errors.append('size readback absent or different')
    if not density or int(density[-1]) != expected['densityDpi']:
        errors.append('density readback absent or different')
    if not isinstance(readback.get('fontScale'), (int, float)) or abs(readback['fontScale'] - expected['fontScale']) > .001:
        errors.append('font-scale readback absent or different')
    return errors


def image_readiness_errors(record, page):
    """Visible images must load; deferred images require fresh offscreen proof."""
    proof = record.get('allImagesLoad')
    if not isinstance(proof, dict):
        return ['missing mounted-image readiness evidence']
    errors = []
    if proof.get('status') != 'loaded' or proof.get('scope') != 'current-process-visible-images':
        errors.append('visible-image readiness is not loaded/current-process')
    if not str(proof.get('pid', '')).isdigit() or not proof.get('session'):
        errors.append('missing current process/session identity')
    if proof.get('failures'):
        errors.append('native image failure remains in the current session')
    if proof.get('pendingImages'):
        errors.append('visible or unmeasured images remain pending')
    images = proof.get('images')
    if not isinstance(images, list):
        return errors + ['invalid mounted-image inventory']
    deferred = proof.get('deferredImages')
    if not isinstance(deferred, list):
        return errors + ['missing deferred-image inventory']
    if proof.get('mountedCount') != len(images) + len(deferred):
        errors.append('mounted-image count differs from inventory')
    instances = set()
    for item in images:
        if not isinstance(item, dict):
            errors.append('invalid mounted-image entry')
            continue
        instance = item.get('instanceId')
        if not instance or instance in instances:
            errors.append('missing/duplicate mounted-image instance')
        instances.add(instance)
        if not item.get('identity') or item.get('status') != 'loaded':
            errors.append('mounted image is not loaded')
    for item in deferred:
        if not isinstance(item, dict):
            errors.append('invalid deferred-image entry')
            continue
        instance = item.get('instanceId')
        if not instance or instance in instances:
            errors.append('missing/duplicate deferred-image instance')
        instances.add(instance)
        rect, viewport = item.get('rect') or {}, item.get('viewport') or {}
        window, tab_height = item.get('window') or {}, item.get('bottomTabBarHeight')
        measured, observed = item.get('measuredAt'), proof.get('observedAt')
        valid = (isinstance(measured, (int, float)) and isinstance(observed, (int, float))
                 and 0 <= observed - measured <= 1500
                 and all(isinstance(rect.get(key), (int, float)) for key in ['x', 'y', 'width', 'height'])
                 and all(isinstance(viewport.get(key), (int, float)) for key in ['width', 'height'])
                 and rect['width'] > 0 and rect['height'] > 0 and viewport['width'] > 0 and viewport['height'] > 0)
        outside = valid and (rect['x'] >= viewport['width'] or rect['y'] >= viewport['height']
                            or rect['x'] + rect['width'] <= 0 or rect['y'] + rect['height'] <= 0)
        viewport_valid = (valid and isinstance(tab_height, (int, float)) and tab_height >= 0
                          and all(isinstance(window.get(key), (int, float)) for key in ['width', 'height'])
                          and abs(window['width'] - viewport['width']) < .01
                          and abs(window['height'] - tab_height - viewport['height']) < .01)
        inactive = valid and item.get('navigationFocused') is False and bool(item.get('routeKey'))
        reason_valid = (item.get('reason') == 'outside-window' and outside
                        or item.get('reason') == 'inactive-navigation-route' and inactive)
        if not reason_valid or not viewport_valid or item.get('status') not in ['pending', 'loading']:
            errors.append('deferred image lacks fresh geometry/navigation proof')
    if page == 'home' and not any(isinstance(item, dict) and str(item.get('identity', '')).startswith('brand/') and item.get('status') == 'loaded' for item in images):
        errors.append('home brand mark load is not verified')
    return errors


def verify(root, source, profiles):
    coverage_errors, visual_issues, inventory = [], [], []
    expected_files = set()
    for folder, profile_id in GROUPS.items():
        expected_profile = profiles[profile_id]
        names = {f'{skin}-{mode}-{page}': (skin, mode, page) for skin in SKINS for mode in MODES for page in PAGES}
        by_name = {}
        try:
            records = read_json(root / folder / 'capture-results.json')
            if not isinstance(records, list):
                raise ValueError('capture-results must be an array')
            for record in records:
                name = record.get('name') if isinstance(record, dict) else None
                if name not in names:
                    coverage_errors.append(f'{folder}: unexpected capture {name}')
                    continue
                if name in by_name:
                    coverage_errors.append(f'{folder}: duplicate capture {name}')
                by_name[name] = record
        except (OSError, ValueError, TypeError) as error:
            coverage_errors.append(f'{folder}: cannot read capture results: {error}')
        for name, (skin, mode, page) in names.items():
            relative = f'{folder}/{name}.png'
            expected_files.add(relative)
            record = by_name.get(name)
            if record is None:
                coverage_errors.append(relative + ': missing capture metadata')
                continue
            if record.get('sourceFingerprint') != source:
                coverage_errors.append(relative + ': stale source fingerprint')
            if record.get('skin') != skin or record.get('mode') != mode:
                coverage_errors.append(relative + ': skin/mode metadata mismatch')
            if record.get('size') != expected_profile['size']:
                coverage_errors.append(relative + ': capture pixel-size metadata mismatch')
            coverage_errors.extend(relative + ': ' + error for error in profile_errors(record.get('displayProfile'), profile_id, expected_profile))
            coverage_errors.extend(relative + ': ' + error for error in image_readiness_errors(record, page))
            if skin != 'classic':
                load = record.get('headerLoad') or {}
                if not isinstance(load, dict):
                    load = {}
                if load.get('identity') != f'{skin}/{mode}/{page}' or load.get('status') != 'loaded':
                    coverage_errors.append(relative + ': required native header load is not verified')
            capture_status = record.get('visualAcceptance')
            if capture_status not in ['pending-review', 'passed', 'pass', 'failed', 'known-source-limitation']:
                coverage_errors.append(relative + ': missing/unknown capture visualAcceptance')
            if capture_status in ['failed', 'known-source-limitation']:
                visual_issues.append({'file': relative, 'status': capture_status, 'reason': 'Capture itself is not visually accepted; retain its blocker or recapture.'})
            try:
                path = root / relative
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                with Image.open(path) as bitmap:
                    if bitmap.format != 'PNG' or list(bitmap.size) != expected_profile['size']:
                        raise ValueError('original PNG dimensions/format mismatch')
                    bitmap.verify()
                inventory.append({'file': relative, 'sha256': digest, 'size': expected_profile['size'], 'profileId': profile_id})
            except (OSError, ValueError, SyntaxError) as error:
                coverage_errors.append(relative + ': invalid screenshot: ' + str(error))

    reviews = {}
    review_header_valid = False
    try:
        review = read_json(root / 'visual-review.json')
        review_header_valid = (review.get('sourceFingerprint') == source
                               and bool(str(review.get('reviewer', '')).strip())
                               and bool(str(review.get('reviewedAt', '')).strip()))
        if not review_header_valid:
            visual_issues.append({'file': 'visual-review.json', 'status': 'pending-review', 'reason': 'Review requires current fingerprint, reviewer and reviewedAt.'})
        if not isinstance(review.get('frames'), list):
            raise ValueError('visual review frames must be an array')
        for item in review['frames']:
            file = item.get('file') if isinstance(item, dict) else None
            if file not in expected_files or file in reviews:
                visual_issues.append({'file': str(file), 'status': 'pending-review', 'reason': 'Unknown or duplicate visual review entry.'})
                continue
            reviews[file] = item
    except (OSError, ValueError, TypeError, AttributeError) as error:
        visual_issues.append({'file': 'visual-review.json', 'status': 'pending-review', 'reason': 'Cannot read independent reviews: ' + str(error)})

    review_counts = {status: 0 for status in sorted(REVIEW_STATUSES)}
    for frame in inventory:
        item = reviews.get(frame['file']) or {}
        valid = (review_header_valid and item.get('sha256') == frame['sha256']
                 and item.get('status') in REVIEW_STATUSES and bool(str(item.get('notes', '')).strip()))
        if not valid:
            visual_issues.append({'file': frame['file'], 'status': 'pending-review', 'reason': 'Missing, stale or incomplete per-image review.'})
            review_counts['pending-review'] += 1
            continue
        status = item['status']
        review_counts[status] += 1
        if status != 'pass':
            visual_issues.append({'file': frame['file'], 'status': status, 'reason': item['notes']})

    coverage_passed = not coverage_errors and len(inventory) == 112
    visual_passed = coverage_passed and not visual_issues and review_counts['pass'] == 112
    exit_code = 0 if visual_passed else 2 if coverage_passed else 1
    return {'schemaVersion': 1, 'scope': '112 high-density primary-page combinations only; excludes deep-flow, physical-device and motion acceptance',
            'sourceFingerprint': source, 'expectedFrames': 112, 'verifiedFrames': len(inventory),
            'coveragePassed': coverage_passed, 'visualPassed': visual_passed,
            'overallStatus': 'passed' if visual_passed else 'blocked', 'exitCode': exit_code,
            'exitPolicy': {'0': 'Coverage and independent visual review passed', '1': 'Capture coverage/evidence invalid', '2': 'Coverage passed; visual pending, failed or source-limited'},
            'reviewCounts': review_counts, 'coverageErrors': coverage_errors, 'visualIssues': visual_issues,
            'frames': inventory}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--output', type=Path, help='Default: <root>/hidpi-validation-summary.json')
    args = parser.parse_args()
    root = args.root.resolve()
    profiles = read_json(ROOT / 'docs/skins/qa-display-profiles.json')['profiles']
    source = source_fingerprint()
    report = verify(root, source, profiles)
    if source_fingerprint() != source:
        report.update(coveragePassed=False, visualPassed=False, overallStatus='blocked', exitCode=1)
        report['coverageErrors'].append('Runtime/assets changed while verifying; freeze and rerun.')
    output = args.output or root / 'hidpi-validation-summary.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'frames'}, ensure_ascii=False, indent=2))
    raise SystemExit(report['exitCode'])


if __name__ == '__main__':
    main()
