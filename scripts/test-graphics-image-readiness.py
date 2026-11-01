"""Regression checks: a page marker must not approve unfinished/failed header art."""
import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('graphics_native_qa', Path(__file__).with_name('graphics-native-qa.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HeaderReadinessTest(unittest.TestCase):
    def setUp(self):
        self.lab = module.GraphicLab.__new__(module.GraphicLab)
        self.lab.package = 'com.zxn.palou.uiqa'
        self.lab.required_header = 'k-on/dark/home'
        self.lab.header_load_evidence = None
        self.calls = []
        self.log = ''

        def adb(*args, **kwargs):
            self.calls.append(args)
            return '7345\n' if args[0] == 'shell' else self.log

        self.lab.adb = adb

    def test_page_without_load_event_is_not_ready(self):
        self.assertFalse(self.lab.header_ready())
        self.assertIn('--pid=7345', self.calls[-1])

    def test_other_skin_and_ongoing_load_do_not_approve(self):
        self.log = '[skin-image] {"identity":"pikachu/dark/home","status":"loaded"}\n[skin-image] {"identity":"k-on/dark/home","status":"loading"}'
        self.assertFalse(self.lab.header_ready())

    def test_failure_is_reported_instead_of_screenshot_success(self):
        self.log = '[skin-image] {"identity":"k-on/dark/home","status":"failed","detail":"decode failed"}'
        with self.assertRaisesRegex(AssertionError, 'decode failed'):
            self.lab.header_ready()

    def test_latest_event_wins_after_reload(self):
        self.log = '[skin-image] {"identity":"k-on/dark/home","status":"loaded"}\n[skin-image] {"identity":"k-on/dark/home","status":"loading"}'
        self.assertFalse(self.lab.header_ready())

    def test_native_load_approves_only_matching_header(self):
        self.log = "I ReactNativeJS: '[skin-image]', '{\"identity\":\"k-on/dark/home\",\"status\":\"loaded\"}'"
        self.assertTrue(self.lab.header_ready())
        self.assertEqual(self.lab.header_load_evidence['identity'], self.lab.required_header)


class MountedReadinessTest(unittest.TestCase):
    def evidence(self, *events):
        start = {'session': 'test', 'status': 'session-start'}
        log = '\n'.join('[art-image] ' + json.dumps({'session': 'test', **event}) for event in [start, *events])
        return module.mounted_image_evidence(log, '7345')

    def test_logo_pending_blocks_even_when_header_loaded(self):
        result = self.evidence(
            {'instanceId': '1', 'identity': 'header/k-on/light/home', 'status': 'loaded'},
            {'instanceId': '2', 'identity': 'brand/classic/light/fallback', 'status': 'mount', 'loadStatus': 'pending'})
        self.assertEqual(result['status'], 'pending')
        self.assertEqual(result['mountedCount'], 2)

    def test_unmount_removes_pending_but_cannot_hide_failed_asset(self):
        pending = {'instanceId': '1', 'identity': 'art/old', 'status': 'loading'}
        unmount = {**pending, 'status': 'unmount'}
        self.assertEqual(self.evidence(pending, unmount)['status'], 'loaded')
        self.assertEqual(self.evidence({**pending, 'status': 'failed'}, unmount)['status'], 'failed')

    def test_effect_remount_preserves_load_and_source_change_waits(self):
        loaded = {'instanceId': '1', 'identity': 'brand/classic/light/fallback', 'status': 'loaded'}
        self.assertEqual(self.evidence(loaded, {**loaded, 'status': 'mount', 'loadStatus': 'loaded'})['status'], 'loaded')
        changed = {'instanceId': '2', 'identity': loaded['identity'], 'status': 'mount', 'loadStatus': 'pending'}
        self.assertEqual(self.evidence(loaded, changed)['status'], 'pending')

    def test_no_session_cannot_approve_empty_image_set(self):
        self.assertEqual(module.mounted_image_evidence('', '7345')['status'], 'pending')

    def test_only_fresh_positive_size_offscreen_measurement_can_defer(self):
        start = {'session': 'test', 'status': 'session-start'}
        mount = {'session': 'test', 'instanceId': '1', 'identity': 'detail/list', 'status': 'mount', 'loadStatus': 'pending'}
        visible = {**mount, 'status': 'visibility', 'rect': {'x': 0, 'y': 950, 'width': 40, 'height': 40},
                   'viewport': {'width': 400, 'height': 890}, 'measuredAt': 10000}
        def result(event, now=11000):
            return module.mounted_image_evidence('\n'.join('[art-image] ' + json.dumps(v) for v in [start, mount, event]), '7345', now)
        deferred = result(visible)
        self.assertEqual(deferred['status'], 'loaded')
        self.assertEqual(deferred['images'], [])
        self.assertEqual(deferred['deferredImages'][0]['status'], 'pending')
        self.assertEqual(result(visible, 12000)['status'], 'pending')
        self.assertEqual(result({**visible, 'rect': {**visible['rect'], 'y': 880}})['status'], 'pending')
        self.assertEqual(result({**visible, 'rect': {**visible['rect'], 'width': 0}})['status'], 'pending')
        covered = {**visible, 'rect': {**visible['rect'], 'y': 200}, 'navigationFocused': False, 'routeKey': 'home-key'}
        self.assertEqual(result(covered)['deferredImages'][0]['reason'], 'inactive-navigation-route')
        self.assertEqual(result({**covered, 'navigationFocused': True})['status'], 'pending')
        self.assertEqual(result({**covered, 'navigationFocused': None})['status'], 'pending')
        self.assertEqual(result({**covered, 'routeKey': None})['status'], 'pending')
        self.assertEqual(result(covered, 12000)['status'], 'pending')


if __name__ == '__main__':
    unittest.main()
