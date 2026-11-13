// Only an explicitly selected, disposable local Docker database is supported.
// Run after applying migrations to an empty "app" database in that container.
import { spawn, execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const container = process.env.CREDIT_NOTES_TEST_CONTAINER;
if (!container)
  throw new Error("Set CREDIT_NOTES_TEST_CONTAINER to a disposable local PostgreSQL container.");
const database = "credit_note_concurrency_" + Date.now();
const args = [
  "exec",
  "-i",
  container,
  "psql",
  "-X",
  "-v",
  "ON_ERROR_STOP=1",
  "-U",
  "postgres",
  "-d",
];
const sql = (statement, db = database) =>
  execFileSync("docker", [...args, db, "-At", "-c", statement], { encoding: "utf8" });
sql("CREATE DATABASE " + database + " TEMPLATE app", "app");
const user = "77777777-7777-7777-7777-777777777777";
const client = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa71";
const project = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb71";
const invoice = "dddddddd-dddd-dddd-dddd-dddddddddd71";
const note = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeee71";
sql(`
  INSERT INTO auth.users(id,email) VALUES ('${user}','concurrency@example.test');
  INSERT INTO public.user_roles(user_id,role) VALUES ('${user}','admin') ON CONFLICT DO NOTHING;
  SET ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub','${user}',false);
  INSERT INTO public.clients(id,name,code) VALUES ('${client}','Concurrency','CT');
  INSERT INTO public.projects(id,client_id,name,code,project_number,contracted_amount,currency)
    VALUES ('${project}','${client}','Local test','CT-01',1,5000,'ARS');
  INSERT INTO public.invoices(id,client_id,project_id,document_type,point_of_sale,invoice_number,issue_date,concept,total_amount,currency)
    VALUES ('${invoice}','${client}','${project}','C','7','1','2026-11-10','Local test',1000,'ARS');
`);
const auth = `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false);`;
const save = (id, number, amount) => `SELECT public.save_credit_note_with_projects(
  '${JSON.stringify({ id, invoice_id: invoice, document_type: "C", point_of_sale: "7", credit_note_number: number, issue_date: "2026-11-10", amount, reason: "Concurrency test" })}',
  '[{"project_id":"${project}","amount":${amount}}]');`;
sql(auth + save(note, "1", 200));

function session(statement) {
  const child = spawn("docker", [...args, database, "-At", "-c", statement]);
  let output = "",
    error = "";
  let signal;
  const locked = new Promise((resolve) => {
    signal = resolve;
  });
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("LOCKED")) signal();
  });
  child.stderr.on("data", (chunk) => {
    error += chunk;
  });
  const timer = setTimeout(() => child.kill(), 15000);
  const done = new Promise((resolve) =>
    child.on("close", (code) => {
      clearTimeout(timer);
      signal();
      resolve({ code, output, error });
    }),
  );
  return { locked, done };
}

const editor = session(
  auth +
    "BEGIN; SET LOCAL lock_timeout='5s';" +
    save(note, "1", 400) +
    "SELECT 'LOCKED'; SELECT pg_sleep(1); SET CONSTRAINTS ALL IMMEDIATE; COMMIT;",
);
await editor.locked;
const cancellation = session(
  auth +
    `BEGIN; SET LOCAL lock_timeout='5s'; SELECT public.cancel_credit_note('${note}'); SET CONSTRAINTS ALL IMMEDIATE; COMMIT;`,
);
const editResult = await editor.done,
  cancelResult = await cancellation.done;
assert.equal(editResult.code, 0, editResult.error);
assert.equal(cancelResult.code, 0, cancelResult.error);
assert.equal(sql(`SELECT status FROM public.credit_notes WHERE id='${note}'`).trim(), "cancelled");
console.log("PASS: two connections edit/cancel without deadlock");

const first = session(
  auth +
    "BEGIN;" +
    save("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee72", "2", 600) +
    "SELECT 'LOCKED'; SELECT pg_sleep(1); SET CONSTRAINTS ALL IMMEDIATE; COMMIT;",
);
await first.locked;
const second = session(
  auth +
    "BEGIN; SET LOCAL lock_timeout='5s';" +
    save("eeeeeeee-eeee-eeee-eeee-eeeeeeeeee73", "3", 600) +
    "SET CONSTRAINTS ALL IMMEDIATE; COMMIT;",
);
const firstResult = await first.done,
  secondResult = await second.done;
assert.equal(firstResult.code, 0, firstResult.error);
assert.notEqual(secondResult.code, 0);
assert.match(secondResult.error, /supera el importe original/);
assert.equal(
  sql(`SELECT credit_note_amount FROM public.invoice_balances WHERE id='${invoice}'`).trim(),
  "600.00",
);
console.log("PASS: concurrent credits cannot exceed the original amount");
console.log("Disposable local database retained:", database);
