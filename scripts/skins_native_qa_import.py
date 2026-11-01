"""Load the existing hyphenated native QA module without duplicating its guards."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('skins_native_qa', Path(__file__).with_name('skins-native-qa.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Lab, IDS, ROOT = module.Lab, module.IDS, module.ROOT
