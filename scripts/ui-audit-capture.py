"""Fresh native captures for the layout/icon audit; only the isolated QA app."""
import argparse
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location('capture', Path(__file__).with_name('ui-qa-capture.py'))
q = importlib.util.module_from_spec(spec)
spec.loader.exec_module(q)
parser = argparse.ArgumentParser()
parser.add_argument('stage', choices=['before', 'after', 'review'])
parser.add_argument('state', nargs='?')
parser.add_argument('--name')
parser.add_argument('--tap', action='append', default=[])
parser.add_argument('--capture-only', action='store_true')
args = parser.parse_args()
q.OUT = q.ROOT / 'docs/qa/ui-audit-20261010' / args.stage
name = args.name or args.state
if not args.capture_only:
    q.launch(args.state)
for label in args.tap:
    q.tap_label(label)
q.capture(name)
(q.OUT / 'metadata').mkdir(exist_ok=True)
(q.OUT / 'metadata' / (name + '.json')).write_text(json.dumps({
    'capturedAt': datetime.now(timezone.utc).isoformat(), 'device': q.SERIAL,
    'package': q.PACKAGE, 'stage': args.stage, 'state': args.state,
    'syntheticData': True, 'usesProductionPresentation': True,
    'realClimbingAccuracyTested': False,
}, indent=2), encoding='utf-8')
