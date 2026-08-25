import importlib.util
from pathlib import Path
import sys
import unittest


class Scb500AiPromptTests(unittest.TestCase):
    def load_module(self):
        module_path = Path("03-Queue/scb-500-AI.py")
        spec = importlib.util.spec_from_file_location("scb_500_ai", module_path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        module = importlib.util.module_from_spec(spec)
        sys.modules["scb_500_ai"] = module
        spec.loader.exec_module(module)
        return module

    def test_prompt_template_formats_without_unescaped_example_placeholders(self):
        module = self.load_module()

        prompt = module.PROMPT_TEMPLATE.format(
            source_id="akersberga",
            venue_name="Akersberga",
            orig_domain="akersberga.se",
            city="Akersberga",
            ts="2026-04-26 19:00 UTC",
            raw_sources="/tmp/raw",
            out_q="/tmp/out.jsonl",
            done_marker="/tmp/done.marker",
            retry_attempts=3,
        )

        self.assertIn("Källa: akersberga", prompt)
        self.assertIn("[REJECT] {url}", prompt)

    def test_remove_source_from_man_queue_removes_processed_source(self):
        module = self.load_module()
        with self.subTest("removes one matching source and keeps other rows"):
            from tempfile import TemporaryDirectory

            with TemporaryDirectory() as tmp:
                queue_path = Path(tmp) / "postTestC-error500.jsonl"
                module.MAN_Q = queue_path
                queue_path.write_text(
                    "\n".join(
                        [
                            '{"sourceId":"keep-one","queueName":"postTestC-error500"}',
                            '{"sourceId":"remove-me","queueName":"postTestC-error500"}',
                            '{"sourceId":"keep-two","queueName":"postTestC-error500"}',
                        ]
                    )
                    + "\n",
                    encoding="utf-8",
                )

                removed = module.remove_source_from_man_queue("remove-me")

                self.assertEqual(1, removed)
                self.assertNotIn("remove-me", queue_path.read_text(encoding="utf-8"))

    def test_parse_done_marker_preserves_https_url(self):
        module = self.load_module()

        parsed = module.parse_done_marker(
            "DONE:akersberga:https://example.se/events:200:3.5:2:true",
            "akersberga",
        )

        self.assertEqual("https://example.se/events", parsed["verified_url"])
        self.assertEqual(200, parsed["status_code"])
        self.assertEqual(3.5, parsed["combined_score"])
        self.assertEqual(2, parsed["events_found"])
        self.assertTrue(parsed["phase2"])


if __name__ == "__main__":
    unittest.main()
