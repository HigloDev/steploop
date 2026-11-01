"""Do not accept header-only evidence when a mounted logo is still absent."""
import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('hidpi_evidence', Path(__file__).with_name('verify-hidpi-skin-evidence.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MountedImageProofTest(unittest.TestCase):
    def setUp(self):
        self.proof = {'status': 'loaded', 'scope': 'current-process-visible-images',
                      'pid': '1024', 'session': 'current-boot', 'mountedCount': 1,
                      'deferredImages': [], 'pendingImages': [], 'observedAt': 2000,
                      'images': [{'instanceId': '1', 'identity': 'brand/classic/light', 'status': 'loaded'}]}

    def errors(self, proof=None, page='home'):
        return module.image_readiness_errors({'allImagesLoad': self.proof if proof is None else proof}, page)

    def test_header_only_cannot_approve_logo(self):
        self.assertTrue(module.image_readiness_errors({'headerLoad': {'status': 'loaded'}}, 'home'))

    def test_current_loaded_brand_is_accepted(self):
        self.assertEqual(self.errors(), [])

    def test_unloaded_or_failed_thumbnail_is_rejected(self):
        for status in ['loading', 'failed']:
            proof = copy.deepcopy(self.proof)
            proof['images'].append({'instanceId': '2', 'identity': 'course/beginner', 'status': status})
            proof['mountedCount'] = 2
            self.assertTrue(self.errors(proof))

    def test_empty_home_or_duplicate_instances_are_rejected(self):
        proof = copy.deepcopy(self.proof)
        proof.update(images=[], mountedCount=0)
        self.assertTrue(self.errors(proof))
        self.assertEqual(self.errors(proof, 'history'), [])
        proof = copy.deepcopy(self.proof)
        proof['images'] *= 2
        proof['mountedCount'] = 2
        self.assertTrue(self.errors(proof))

    def test_missing_session_or_wrong_process_scope_is_rejected(self):
        for key, value in [('pid', ''), ('session', ''), ('scope', 'previous-page'), ('mountedCount', 0)]:
            proof = copy.deepcopy(self.proof)
            proof[key] = value
            self.assertTrue(self.errors(proof))

    def test_only_fresh_fully_offscreen_pending_images_can_be_deferred(self):
        proof = copy.deepcopy(self.proof)
        deferred = {'instanceId': '2', 'identity': 'detail/building', 'status': 'pending',
                    'rect': {'x': 20, 'y': 850, 'width': 40, 'height': 40},
                    'viewport': {'width': 400, 'height': 800}, 'window': {'width': 400, 'height': 890},
                    'bottomTabBarHeight': 90, 'measuredAt': 1800, 'reason': 'outside-window'}
        proof.update(deferredImages=[deferred], mountedCount=2)
        self.assertEqual(self.errors(proof), [])
        deferred['rect']['y'] = 780
        self.assertTrue(self.errors(proof))
        deferred['rect']['y'] = 850
        deferred['measuredAt'] = 0
        self.assertTrue(self.errors(proof))

    def test_hidden_route_needs_explicit_recent_native_focus_evidence(self):
        proof = copy.deepcopy(self.proof)
        deferred = {'instanceId': '2', 'identity': 'header/home', 'status': 'pending',
                    'rect': {'x': 20, 'y': 200, 'width': 100, 'height': 100},
                    'viewport': {'width': 400, 'height': 800}, 'window': {'width': 400, 'height': 890},
                    'bottomTabBarHeight': 90, 'measuredAt': 1800, 'reason': 'inactive-navigation-route',
                    'navigationFocused': False, 'routeKey': 'home-123'}
        proof.update(deferredImages=[deferred], mountedCount=2)
        self.assertEqual(self.errors(proof), [])
        for key, value in [('navigationFocused', True), ('navigationFocused', None), ('routeKey', ''), ('measuredAt', 0)]:
            invalid = copy.deepcopy(proof)
            invalid['deferredImages'][0][key] = value
            self.assertTrue(self.errors(invalid))


if __name__ == '__main__':
    unittest.main()
