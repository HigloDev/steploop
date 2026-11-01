"""Navigation must not reuse a cold-opened page's image proof as current proof."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('graphics_interaction_qa', Path(__file__).with_name('graphics-interaction-qa.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InteractionEvidenceTest(unittest.TestCase):
    def setUp(self):
        self.lab = module.InteractionLab.__new__(module.InteractionLab)
        self.lab.results = []
        self.opened = {'identity': 'k-on/dark/coach', 'status': 'loaded'}
        self.lab.header_load_evidence = self.opened

    def test_navigation_does_not_claim_previous_header_loaded_on_new_page(self):
        def capture(lab, name, skin, mode, check_paper):
            lab.results.append({'name': name, 'headerLoad': lab.header_load_evidence})

        with patch.object(module.module.GraphicLab, 'screenshot', capture):
            self.lab.screenshot('k-on-dark-weight-saved', 'k-on', 'dark')
        frame = self.lab.results[-1]
        self.assertIsNone(frame['headerLoad'])
        self.assertEqual(frame['lastOpenedHeader'], self.opened)
        self.assertIn('diagnostic only', frame['headerLoadScope'])
        self.assertIs(self.lab.header_load_evidence, self.opened)

    def test_capture_failure_restores_open_readiness_state(self):
        with patch.object(module.module.GraphicLab, 'screenshot', side_effect=AssertionError('capture failed')):
            with self.assertRaisesRegex(AssertionError, 'capture failed'):
                self.lab.screenshot('failed', 'k-on', 'dark')
        self.assertIs(self.lab.header_load_evidence, self.opened)
        self.assertEqual(self.lab.results, [])


if __name__ == '__main__':
    unittest.main()
