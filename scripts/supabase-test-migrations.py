"""Manual TEST-only migration runner. Never emit CLI/SQL output or credentials."""
import argparse
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

TEST_REF = "ovtahpbcpifsrlrpapkx"
PRODUCTION_REF = "psftlbjupejzgnvqqcpp"


def validate_uri(raw):
    if not raw or any(c.isspace() for c in raw):
        raise ValueError("Missing or invalid TEST database secret.")
    if PRODUCTION_REF in unquote(raw).lower():
        raise ValueError("Production project explicitly rejected.")
    try:
        uri = urlsplit(raw)
        user = unquote(uri.username or "")
        pairs = parse_qsl(uri.query, strict_parsing=True, keep_blank_values=True)
        valid_query = pairs in ([], [("sslmode", "require")], [("sslmode", "verify-full")])
        direct = uri.hostname == f"db.{TEST_REF}.supabase.co" and user == "postgres"
        pooler = bool(re.fullmatch(r"aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com", uri.hostname or "")) and user == f"postgres.{TEST_REF}"
        valid = (uri.scheme in ("postgres", "postgresql") and uri.port in (None, 5432)
                 and uri.path == "/postgres" and bool(uri.password) and not uri.fragment
                 and valid_query and (direct or pooler))
    except (ValueError, UnicodeError):
        raise ValueError("Invalid TEST connection format.") from None
    if not valid:
        raise ValueError("Connection must identify TEST using its direct host or session-pooler user; port 5432 only.")
    return uri


def summary(message):
    print(message, flush=True)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf8") as out:
            out.write(message + "\n\n")


def run(label, args, env, sql=None):
    # All tool output stays in memory: errors may repeat passwords, rows or URIs.
    try:
        result = subprocess.run(args, input=sql, text=True, capture_output=True,
                                env=env, timeout=180, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError(f"{label}: could not complete; raw diagnostics suppressed.") from None
    if result.returncode:
        raise RuntimeError(f"{label}: failed; raw diagnostics suppressed.")
    summary(f"PASS: {label}")
    return result.stdout + result.stderr


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    raw = os.environ.get("SUPABASE_TEST_DB_URL", "")
    uri = validate_uri(raw)
    summary(f"Validated destination: TEST {TEST_REF}; Production rejected by policy.")
    if args.validate_only:
        return
    # Reconstruct credentials as libpq environment, not shell commands or files.
    env = {k: v for k, v in os.environ.items()
           if not k.startswith("PG") and k not in ("SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD")}
    env.update(PGHOST=uri.hostname, PGPORT="5432", PGUSER=unquote(uri.username),
               PGPASSWORD=unquote(uri.password), PGDATABASE="postgres", PGSSLMODE="require",
               PGCONNECT_TIMEOUT="15", PGOPTIONS="-c default_transaction_read_only=on")
    if dict(parse_qsl(uri.query)).get("sslmode") == "verify-full":
        env["PGSSLMODE"] = "verify-full"
    psql = ["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1"]
    # Existing pgTAP fixtures assume no real users or business rows. Stop before
    # migration rather than skip tests or modify real test users and records.
    preflight = r"""
SELECT CASE WHEN count(*) = 0 THEN 'EMPTY_AUTH' ELSE 'HAS_USERS' END FROM auth.users;
SELECT format('SELECT CASE WHEN count(*) = 0 THEN %L ELSE %L END FROM public.%I;',
              'EMPTY_BUSINESS', 'HAS_ROWS', tablename)
 FROM pg_tables WHERE schemaname='public' AND tablename IN
 ('clients','projects','invoices','invoice_allocations','project_collections',
  'project_expenses','general_expenses','credit_notes','credit_note_projects')
\gexec
"""
    output = run("Read-only empty-test preflight", psql, env, preflight)
    if "HAS_USERS" in output or "HAS_ROWS" in output:
        raise RuntimeError("TEST contains users or business records; stop and use a fresh empty test project.")
    cli = ["supabase"]
    version = run("Pinned CLI version", cli + ["--version"], env).strip()
    if not re.search(r"(?m)^2\.54\.11\s*$", version):
        raise RuntimeError("Unexpected Supabase CLI version.")
    # Ensure TLS even when the supplied URI omitted sslmode. No link/default target.
    target = raw if uri.query else raw + "?sslmode=require"
    run("Pending migration history", cli + ["migration", "list", "--db-url", target], env)
    dry_run = run("Migration dry run", cli + ["db", "push", "--db-url", target, "--dry-run"], env)
    files = sorted(Path("supabase/migrations").glob("*.sql"))
    pending = [p.name for p in files if p.name in dry_run]
    summary("Pending migrations from dry run: " + (", ".join(pending) or "none"))
    env.pop("PGOPTIONS")
    run("Apply pending TEST migrations", cli + ["db", "push", "--db-url", target, "--yes"], env)
    env["PGOPTIONS"] = "-c default_transaction_read_only=on"
    run("Post-migration history", cli + ["migration", "list", "--db-url", target], env)
    applied = run("Verify applied versions", psql, env,
                  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;")
    if not {p.name.split("_")[0] for p in files}.issubset(set(applied.splitlines())):
        raise RuntimeError("Expected migrations are missing from TEST history.")
    env.pop("PGOPTIONS")
    run("Database lint", cli + ["db", "lint", "--db-url", target, "--fail-on", "error"], env)
    for path in sorted(Path("supabase/tests/database").glob("*.sql")):
        tap = run(f"SQL suite {path.name}", psql, env, path.read_text())
        plan = re.search(r"^1\.\.(\d+)\s*$", tap, re.M)
        ok = re.findall(r"^ok \d+\b", tap, re.M)
        if not plan or len(ok) != int(plan[1]) or re.search(r"^not ok\b|Looks like", tap, re.M):
            raise RuntimeError(f"SQL suite {path.name}: TAP assertions failed.")
        summary(f"Validated TAP: {path.name}: {len(ok)} assertions.")
    summary("Completed TEST migrations and SQL validation. Auth/Storage HTTP and Preview tests remain manual. No Production connection was used.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError) as error:
        # Exception text is deliberately generic; never expose tool diagnostics.
        summary("FAILED: " + str(error) + " Credentials and raw output were suppressed.")
        sys.exit(1)
