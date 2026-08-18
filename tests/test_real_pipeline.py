import importlib.util
import json
import sys
import tempfile
from pathlib import Path
import unittest


class RealPipelineTests(unittest.TestCase):
    def load_module(self):
        module_path = Path("Alltools-E2E/core/real_pipeline.py")
        spec = importlib.util.spec_from_file_location("real_pipeline", module_path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        real_pipeline = importlib.util.module_from_spec(spec)
        sys.modules["real_pipeline"] = real_pipeline
        spec.loader.exec_module(real_pipeline)
        return real_pipeline

    def test_tool10_does_not_synthesize_missing_output_rows(self):
        real_pipeline = self.load_module()

        with tempfile.TemporaryDirectory() as tmp:
            project_root = Path(tmp)
            runtime = project_root / "runtime"
            runtime.mkdir()
            source_id = "missing-tool10-output"
            (runtime / real_pipeline.RUNTIME_POSTTESTC_MAN).write_text(
                json.dumps(
                    {
                        "sourceId": source_id,
                        "queueName": "postTestC-man",
                        "queueOrigin": "postTestC-man",
                        "queueReason": "real upstream row",
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            result = real_pipeline.run_real_abcd(project_root, [source_id], dry_run=True)

            post10_man = runtime / real_pipeline.RUNTIME_POST10_MAN
            rows = [
                json.loads(line)
                for line in post10_man.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            self.assertEqual([], rows)
            self.assertTrue(
                any("skipped synthetic post10-man rows" in note for note in result.stage_notes)
            )

    def test_recovery_tools_are_skipped_by_default_and_keep_terminal_queues(self):
        real_pipeline = self.load_module()

        with tempfile.TemporaryDirectory() as tmp:
            project_root = Path(tmp)
            runtime = project_root / "runtime"
            runtime.mkdir()
            source_id = "recovery-source"
            for queue_file in (
                real_pipeline.RUNTIME_POSTTESTC_ERROR500,
                real_pipeline.RUNTIME_POSTTESTC_404,
                real_pipeline.RUNTIME_POSTTESTC_SERVERDOWN,
            ):
                (runtime / queue_file).write_text(
                    json.dumps({"sourceId": source_id, "queueName": queue_file}) + "\n",
                    encoding="utf-8",
                )

            result = real_pipeline.run_real_abcd(project_root, [source_id], dry_run=True)

            flat_commands = [" ".join(cmd) for cmd in result.commands_run]
            self.assertFalse(any("scb-500-AI.py" in cmd for cmd in flat_commands))
            self.assertFalse(any("gl-fix-404.py" in cmd for cmd in flat_commands))
            self.assertTrue(any("recovery skipped" in note for note in result.stage_notes))
            for queue_file in (
                real_pipeline.RUNTIME_POSTTESTC_ERROR500,
                real_pipeline.RUNTIME_POSTTESTC_404,
                real_pipeline.RUNTIME_POSTTESTC_SERVERDOWN,
            ):
                self.assertIn(source_id, (runtime / queue_file).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
