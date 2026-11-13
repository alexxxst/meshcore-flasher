import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('asset_version', HERE / 'asset_version.py')
asset_version = importlib.util.module_from_spec(spec)
spec.loader.exec_module(asset_version)

INDEX = '''<!doctype html>
<link href="./css/beer.css" rel="stylesheet">
<link href="./css/flasher.css" rel="stylesheet">
<link rel="icon" href="./img/logo.png">
<script type="module" src="./flasher.js"></script>
'''

FLASHER = '''import './lib/beer.min.js';
import { createApp } from './lib/vue.min.js';
import { createSetup } from './js/app.js';
const p = await import('./lib/polyfill/serial.js');
'''

APP = '''import { reactive } from '../lib/vue.min.js';
import { a } from './site.js';
import './util.js';
'''

FILES = {
    'index.html': INDEX,
    'flasher.js': FLASHER,
    'js/app.js': APP,
    'js/site.js': 'export const a = 1;\n',
    'js/util.js': 'export const b = 2;\n',
    'lib/vue.min.js': 'export const vue = 1;\n',
    'lib/polyfill/serial.js': 'export {};\n',
}


class AssetVersionTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        for name, text in FILES.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')

    def tearDown(self):
        shutil.rmtree(self.root)

    def read(self, name):
        return (self.root / name).read_text(encoding='utf-8')

    def test_rewrite_versions_css_and_js(self):
        asset_version.rewrite(self.root, '20261113.1')
        index = self.read('index.html')
        self.assertIn('./css/beer.css?v=20261113.1', index)
        self.assertIn('./css/flasher.css?v=20261113.1', index)
        self.assertIn('./flasher.js?v=20261113.1', index)
        self.assertIn('./img/logo.png', index)
        self.assertNotIn('logo.png?v=', index)
        self.assertIn("./lib/beer.min.js?v=20261113.1", self.read('flasher.js'))
        self.assertIn("./js/app.js?v=20261113.1", self.read('flasher.js'))
        self.assertIn("./lib/polyfill/serial.js?v=20261113.1", self.read('flasher.js'))
        self.assertIn("./site.js?v=20261113.1", self.read('js/app.js'))

    def test_rewrite_is_idempotent(self):
        asset_version.rewrite(self.root, '20261113.1')
        changed = asset_version.rewrite(self.root, '20261113.1')
        self.assertEqual(changed, [])
        self.assertNotIn('?v=20261113.1?v=', self.read('index.html'))

    def test_rewrite_replaces_old_token(self):
        asset_version.rewrite(self.root, 'old')
        asset_version.rewrite(self.root, 'new')
        index = self.read('index.html')
        self.assertNotIn('?v=old', index)
        self.assertEqual(index.count('?v=new'), 3)

    def test_content_token_ignores_current_version(self):
        asset_version.rewrite(self.root, 'one')
        first = asset_version.content_token(self.root)
        asset_version.rewrite(self.root, 'two')
        self.assertEqual(asset_version.content_token(self.root), first)

    def test_content_token_changes_with_content(self):
        first = asset_version.content_token(self.root)
        (self.root / 'js/site.js').write_text('export const a = 2;\n', encoding='utf-8')
        self.assertNotEqual(asset_version.content_token(self.root), first)

    def test_auto_installs_content_token(self):
        token = asset_version.content_token(self.root)
        asset_version.rewrite(self.root, token)
        ok, found, problems = asset_version.check(self.root, token)
        self.assertTrue(ok, problems)
        self.assertEqual(found, token)

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.root, check=True,
                              capture_output=True, text=True)

    def test_check_ref_uses_committed_tree(self):
        token = asset_version.content_token(self.root)
        asset_version.rewrite(self.root, token)
        self.git('init', '-q')
        self.git('config', 'user.email', 'test@example.com')
        self.git('config', 'user.name', 'test')
        self.git('add', '-A')
        self.git('commit', '-qm', 'init')

        # незакоммиченная правка не должна ломать проверку HEAD
        (self.root / 'js/site.js').write_text('export const a = 2;\n', encoding='utf-8')
        ok, found, problems = asset_version.check(self.root, ref='HEAD')
        self.assertTrue(ok, problems)
        self.assertEqual(found, token)

        ok, _found, _problems = asset_version.check(self.root)
        self.assertFalse(ok)

    def test_check_ok(self):
        token = asset_version.content_token(self.root)
        asset_version.rewrite(self.root, token)
        ok, found, problems = asset_version.check(self.root)
        self.assertTrue(ok, problems)
        self.assertEqual(found, token)

    def test_check_detects_mixed_tokens(self):
        asset_version.rewrite(self.root, '20261113.1')
        path = self.root / 'js/app.js'
        path.write_text(path.read_text(encoding='utf-8').replace('site.js?v=20261113.1', 'site.js?v=other'), encoding='utf-8')
        ok, _token, problems = asset_version.check(self.root)
        self.assertFalse(ok)
        self.assertTrue(any('разные версии' in p for p in problems), problems)

    def test_check_detects_unversioned_reference(self):
        asset_version.rewrite(self.root, '20261113.1')
        path = self.root / 'flasher.js'
        path.write_text(path.read_text(encoding='utf-8').replace("'./js/app.js?v=20261113.1'", "'./js/app.js'"), encoding='utf-8')
        ok, _token, problems = asset_version.check(self.root)
        self.assertFalse(ok)
        self.assertTrue(any('без версии' in p for p in problems), problems)

    def test_check_expected_token(self):
        asset_version.rewrite(self.root, '20261113.1')
        ok, _token, _problems = asset_version.check(self.root, '20261113.1')
        self.assertTrue(ok)
        ok, _token, problems = asset_version.check(self.root, '20261114.1')
        self.assertFalse(ok)
        self.assertTrue(any('ожидалась версия' in p for p in problems), problems)


if __name__ == '__main__':
    unittest.main()
