import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Live integration tests against the hosted MailValid MCP server. These consume
 * credits, so they are not part of `npm test`.
 *
 *   MAILVALID_API_KEY=mv_live_... npm run test:live
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.resolve(__dirname, "../dist/index.js");
const API_KEY = process.env.MAILVALID_API_KEY;
const skip = API_KEY ? false : "MAILVALID_API_KEY is not set";

const DOCUMENTED_TOOLS = [
  "verify_email",
  "submit_bulk_verification",
  "get_bulk_job",
  "list_bulk_jobs",
  "cancel_bulk_job",
  "get_credit_balance",
  "verify_email_demo",
  "get_api_discovery",
];

const payload = (r) => JSON.parse(r.content.map((c) => c.text).join(""));

describe("live: hosted MCP server via the stdio launcher", { skip }, () => {
  let client;

  before(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [LAUNCHER],
      env: { ...process.env, MAILVALID_API_KEY: API_KEY },
      stderr: "pipe",
    });
    client = new Client({ name: "mailvalid-live-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
  });

  after(async () => {
    await client?.close().catch(() => {});
  });

  test("exposes exactly the documented tool set", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...DOCUMENTED_TOOLS].sort());
  });

  test("reports a credit balance", async () => {
    const r = await client.callTool({ name: "get_credit_balance", arguments: {} });
    const body = payload(r);
    assert.equal(typeof body.balance, "number");
    assert.equal(typeof body.lifetime_used, "number");
  });

  test("verifies a role-based address", async () => {
    const r = await client.callTool({
      name: "verify_email",
      arguments: { email: "support@github.com" },
    });
    const { result } = payload(r);
    assert.equal(result.status, "do_not_mail");
    assert.equal(result.is_role_based, true);
  });

  test("rejects a nonexistent domain", async () => {
    const r = await client.callTool({
      name: "verify_email",
      arguments: { email: "someone@thisdomaindoesnotexist12345xyz.com" },
    });
    const { result } = payload(r);
    assert.equal(result.status, "invalid");
    assert.equal(result.domain_valid, false);
  });

  test("surfaces an invalid API key as a tool error", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [LAUNCHER],
      env: { ...process.env, MAILVALID_API_KEY: "mv_live_bogus_key_000" },
      stderr: "pipe",
    });
    const c = new Client({ name: "bad-key-test", version: "1.0.0" }, { capabilities: {} });
    await c.connect(transport);
    const r = await c.callTool({ name: "verify_email", arguments: { email: "a@b.com" } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Invalid API key/i);
    await c.close();
  });

  test("runs the full bulk lifecycle", async () => {
    // Small batches finish in ~1.5s, which makes cancellation a race. Use a
    // batch big enough that the job is still processing when we cancel it.
    const emails = Array.from({ length: 40 }, (_, i) => `bulk-probe-${i}@example.com`);

    const submitted = payload(
      await client.callTool({ name: "submit_bulk_verification", arguments: { emails } })
    );
    assert.ok(submitted.job_id);
    assert.equal(submitted.total_emails, emails.length);
    assert.equal(submitted.status, "pending");

    const status = payload(
      await client.callTool({ name: "get_bulk_job", arguments: { job_id: submitted.job_id } })
    );
    assert.equal(status.job_id, submitted.job_id);
    assert.ok(["pending", "processing", "completed"].includes(status.status));

    const cancel = await client.callTool({
      name: "cancel_bulk_job",
      arguments: { job_id: submitted.job_id },
    });

    if (cancel.isError) {
      // Cancelling a job that already finished is a legitimate refusal.
      assert.match(cancel.content[0].text, /Cannot cancel job with status: (completed|failed|cancelled)/);
    } else {
      assert.equal(payload(cancel).success, true);
      const after = payload(
        await client.callTool({ name: "get_bulk_job", arguments: { job_id: submitted.job_id } })
      );
      assert.equal(after.status, "cancelled");
    }

    const list = payload(await client.callTool({ name: "list_bulk_jobs", arguments: {} }));
    assert.ok(Array.isArray(list.jobs));
    assert.ok(list.jobs.some((j) => j.job_id === submitted.job_id));
  });

  test("demo tool needs no key and flags disposable domains", async () => {
    const r = await client.callTool({
      name: "verify_email_demo",
      arguments: { email: "test@mailinator.com" },
    });
    const { result } = payload(r);
    assert.equal(result.is_disposable, true);
  });

  /**
   * Known server-side defect: verify_email_demo does not perform a DNS lookup.
   * It synthesises `mx.<domain>` and reports domain_valid/has_mx as true even
   * for domains that do not resolve. This test documents the bug; flip the
   * assertions once the server is fixed.
   */
  test("KNOWN BUG: demo tool fabricates MX data for a nonexistent domain", async () => {
    const r = await client.callTool({
      name: "verify_email_demo",
      arguments: { email: "someone@thisdomaindoesnotexist12345xyz.com" },
    });
    const { result } = payload(r);

    assert.equal(result.has_mx, true, "server behaviour changed - demo may now do real DNS");
    assert.equal(result.mx_records[0].host, "mx.thisdomaindoesnotexist12345xyz.com");
    assert.equal(result.domain_valid, true);
    assert.equal(result.status, "valid");
  });
});
