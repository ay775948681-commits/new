import importlib.util
from pathlib import Path
import unittest
from datetime import datetime, timezone
spec = importlib.util.spec_from_file_location('daily', Path(__file__).resolve().parents[1] / 'scripts/ai_daily.py')
daily = importlib.util.module_from_spec(spec)
spec.loader.exec_module(daily)

class DailyTests(unittest.TestCase):
    def test_rss_date_window(self):
        xml = b'<rss><channel><item><title>New</title><link>https://example.com/new</link><pubDate>Mon, 19 Oct 2026 00:00:00 GMT</pubDate></item><item><title>Old</title><link>https://example.com/old</link><pubDate>Mon, 12 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>'
        rows = daily.parse_feed(xml, 'RSS', datetime(2026,10,19,1,tzinfo=timezone.utc))
        self.assertEqual([r[2] for r in rows], ['New'])

    def test_atom_and_html_escaping(self):
        xml = b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>&lt;script&gt;</title><link href="https://example.com/a"/><updated>2026-10-19T00:00:00Z</updated></entry></feed>'
        now = datetime(2026,10,19,1,tzinfo=timezone.utc)
        rows = daily.parse_feed(xml, 'Atom', now)
        self.assertEqual(len(rows), 1)
        title, content = daily.render(rows, ['Failed source'], now)
        self.assertIn('&lt;script&gt;', content)
        self.assertNotIn('<script>', content)
        self.assertIn('Failed source', content)
        self.assertIn('2026-10-19', title)

    def test_no_recent_items_does_not_invent_news(self):
        _, content = daily.render([], [], datetime.now(timezone.utc))
        self.assertIn('暂无新动态', content)

if __name__ == '__main__': unittest.main()
