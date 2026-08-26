#!/usr/bin/env node
/**
 * Stdio launcher for MailValid's hosted MCP server.
 *
 * MailValid runs its MCP server remotely at https://mailvalid.io/mcp/ over
 * Streamable HTTP — most current MCP clients (Claude Code, Cursor, VS Code,
 * Windsurf) can connect to that URL directly and don't need this package.
 * This launcher exists only for clients that still require a local stdio
 * server (e.g. older Claude Desktop configs): it bridges stdio <-> the
 * remote Streamable HTTP endpoint.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_KEY = process.env.MAILVALID_API_KEY;
const REMOTE_URL = process.env.MAILVALID_MCP_URL ?? "https://mailvalid.io/mcp/";

if (!API_KEY) {
  console.error("MAILVALID_API_KEY is not set. Add it to your MCP client config.");
  process.exit(1);
}

const remoteClient = new Client({ name: "mailvalid-mcp-launcher", version: "0.1.0" }, { capabilities: {} });
const remoteTransport = new StreamableHTTPClientTransport(new URL(REMOTE_URL), {
  requestInit: {
    headers: { "X-API-Key": API_KEY },
  },
});
await remoteClient.connect(remoteTransport);

const server = new Server(
  { name: "mailvalid-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return remoteClient.listTools();
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return remoteClient.callTool({
    name: request.params.name,
    arguments: request.params.arguments,
  });
});

const localTransport = new StdioServerTransport();
await server.connect(localTransport);
