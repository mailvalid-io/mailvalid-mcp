import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.resolve(__dirname, "../dist/index.js");

/**
 * A minimal in-process Streamable HTTP MCP server, standing in for
 * https://mailvalid.io/mcp/ so the launcher's proxy behaviour can be tested
 * offline. Records the headers it was called with.
 */
function createStubServer() {
  const seen = { apiKeys: [], toolCalls: [] };

  const httpServer = http.createServer((req, res) => {
    if (req.headers["x-api-key"]) seen.apiKeys.push(req.headers["x-api-key"]);

    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      let body;
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      } catch {
        body = undefined;
      }

      const server = new Server(
        { name: "stub-mailvalid", version: "9.9.9" },
        { capabilities: { tools: {} } }
      );

      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "verify_email",
            description: "stub verify",
            inputSchema: {
              type: "object",
              properties: { email: { type: "string" } },
              required: ["email"],
            },
          },
        ],
      }));

      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        seen.toolCalls.push({
          name: request.params.name,
          arguments: request.params.arguments,
        });
        if (request.params.name !== "verify_email") {
          return { content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }], isError: true };
        }
        return {
          content: [
            { type: "text", text: JSON.stringify({ email: request.params.arguments?.email, status: "valid" }) },
          ],
        };
      });

      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    });
  });

  return { httpServer, seen };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

describe("stdio launcher", () => {
  let httpServer, seen, port, client;

  before(async () => {
    ({ httpServer, seen } = createStubServer());
    port = await listen(httpServer);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [LAUNCHER],
      env: {
        ...process.env,
        MAILVALID_API_KEY: "mv_live_stub_key",
        MAILVALID_MCP_URL: `http://127.0.0.1:${port}/mcp/`,
      },
      stderr: "pipe",
    });
    client = new Client({ name: "launcher-test", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
  });

  after(async () => {
    await client?.close().catch(() => {});
    httpServer?.close();
  });

  test("advertises itself and declares tool support", () => {
    assert.deepEqual(client.getServerVersion(), { name: "mailvalid-mcp", version: "0.1.0" });
    assert.ok(client.getServerCapabilities()?.tools);
  });

  test("proxies tools/list from the remote server", async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "verify_email");
    assert.deepEqual(tools[0].inputSchema.required, ["email"]);
  });

  test("forwards the API key to the remote server", () => {
    assert.ok(seen.apiKeys.length > 0, "remote server saw no X-API-Key header");
    assert.ok(seen.apiKeys.every((k) => k === "mv_live_stub_key"));
  });

  test("proxies tools/call with arguments intact", async () => {
    const r = await client.callTool({ name: "verify_email", arguments: { email: "a@b.com" } });
    assert.equal(r.isError, undefined);
    assert.deepEqual(JSON.parse(r.content[0].text), { email: "a@b.com", status: "valid" });

    const last = seen.toolCalls.at(-1);
    assert.equal(last.name, "verify_email");
    assert.deepEqual(last.arguments, { email: "a@b.com" });
  });

  test("relays tool errors without breaking the bridge", async () => {
    const bad = await client.callTool({ name: "nope", arguments: {} });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /Unknown tool/);

    // Bridge must still be usable afterwards.
    const ok = await client.callTool({ name: "verify_email", arguments: { email: "c@d.com" } });
    assert.equal(ok.isError, undefined);
  });
});

describe("startup validation", () => {
  test("exits non-zero with a helpful message when MAILVALID_API_KEY is missing", async () => {
    const env = { ...process.env };
    delete env.MAILVALID_API_KEY;

    const { code, stderr } = await new Promise((resolve) => {
      const child = spawn(process.execPath, [LAUNCHER], { env, stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => resolve({ code, stderr }));
    });

    assert.equal(code, 1);
    assert.match(stderr, /MAILVALID_API_KEY is not set/);
  });
});
