import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
import io
import subprocess

spec = importlib.util.spec_from_file_location("runner", Path(__file__).with_name("supabase-test-migrations.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class DestinationGuardTests(unittest.TestCase):
    def test_failed_tool_diagnostics_never_reach_logs(self):
        output = io.StringIO()
        result = subprocess.CompletedProcess([], 1, "sensitive-uri", "sensitive-password")
        with patch.object(runner.subprocess, "run", return_value=result), redirect_stdout(output):
            with self.assertRaises(RuntimeError) as raised:
                runner.run("Safe stage", ["supabase"], {})
        self.assertNotIn("sensitive", output.getvalue() + str(raised.exception))

    def test_accepts_only_expected_project(self):
        for uri in [
            "postgresql://postgres:dummy@db.ovtahbpcpifsrlrpapkx.supabase.co:5432/postgres",
            "postgres://postgres.ovtahbpcpifsrlrpapkx:dummy@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require",
        ]:
            runner.validate_uri(uri)

    def test_rejects_unsafe_destinations_and_overrides(self):
        base = "postgresql://postgres:dummy@db.ovtahbpcpifsrlrpapkx.supabase.co:5432/postgres"
        invalid = [
            "", base.replace("ovtahbpcpifsrlrpapkx", "psftlbjupejzgnvqqcpp"),
            base.replace("ovtahbpcpifsrlrpapkx", "anotherproject"),
            base.replace(".supabase.co", ".supabase.co.attacker.test"),
            base + "?sslmode=disable", base + "?host=other.example", base + "#fragment",
            base + "?host=", base + "?sslmode=", base + "?sslmode=require&host=",
            base.replace(":5432", ":6543"), base.replace("postgres:dummy", "postgres"),
            base + "?sslmode=require&sslmode=disable",
            base.replace("dummy", "psftlbjupejzgnvqqcpp"),
            base.replace("postgres:dummy", "postgres%2epsftlbjupejzgnvqqcpp:dummy"),
            base.replace("/postgres", "/another_database"),
        ]
        for uri in invalid:
            with self.subTest(case=invalid.index(uri)):
                with self.assertRaises(ValueError):
                    runner.validate_uri(uri)


if __name__ == "__main__":
    unittest.main()
