import importlib.util
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("check_site", Path(__file__).with_name("check-site.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class RenderedLinksTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.write("index.html", '<a href="/guide#中文">guide</a><img src="/assets/a.svg?v=1">')
        self.write("guide.html", '<h2 id="中文">Title</h2>')
        self.write("assets/a.svg", '<svg/>')

    def write(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def test_clean_routes_relative_links_unicode_queries_and_external_urls(self):
        self.write("nested/index.html", '<a href="../guide?group=x#%E4%B8%AD%E6%96%87">ok</a><a href="./#local">self</a><i id="local"></i><a href="https://example.invalid/missing">external</a>')
        self.assertEqual([], checker.check_site(self.root)[1])

    def test_missing_anchor_fails_even_when_the_page_exists(self):
        self.write("guide.html", '<h2 id="renamed">Title</h2>')
        self.assertIn("missing HTML anchor", "\n".join(checker.check_site(self.root)[1]))

    def test_missing_asset_and_page_fail(self):
        (self.root / "assets/a.svg").unlink()
        (self.root / "guide.html").unlink()
        self.assertEqual(2, len(checker.check_site(self.root)[1]))

    def test_encoded_paths_and_legacy_named_anchor(self):
        self.write("a b.html", '<a name="old"></a>')
        self.write("index.html", '<a href="a%20b.html#old">ok</a>')
        self.assertEqual([], checker.check_site(self.root)[1])

    def test_no_spa_fallback_and_no_files_outside_site(self):
        self.write("index.html", '<a href="/missing">bad</a><img src="../outside.png">')
        failures = "\n".join(checker.check_site(self.root)[1])
        self.assertIn("missing page or asset", failures)
        self.assertIn("escapes built site", failures)


if __name__ == "__main__":
    unittest.main()
