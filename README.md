# mailvalid-mcp

MailValid runs a hosted MCP server at **`https://mailvalid.io/mcp/`** (Streamable HTTP transport). Most current MCP clients can connect to it directly — you don't need to install or run anything from this repo in that case.

This repo exists for two reasons:
1. **Documentation** for connecting each major client.
2. **A stdio launcher** (`@mailvalid/mcp`) for clients that only support local stdio servers.

## Tools available on the server

Per [mailvalid.io/docs](https://mailvalid.io/docs):

| Tool | Cost |
|---|---|
| `verify_email` | 1 credit |
| `submit_bulk_verification` | reserves N credits |
| `get_bulk_job` | free |
| `list_bulk_jobs` | free |
| `cancel_bulk_job` | free |
| `get_credit_balance` | free |
| `verify_email_demo` | free, no auth, rate-limited per IP |
| `get_api_discovery` | free, no auth |

Get an API key at [mailvalid.io/signup](https://mailvalid.io/signup) — 100 free credits, no card.

## Connect directly (recommended)

**Claude Code**

```bash
claude mcp add --transport http mailvalid https://mailvalid.io/mcp/ --header "X-API-Key: mv_live_your_key_here"
```

**Cursor / VS Code / Windsurf**

Add an MCP server entry pointing at the URL with your API key as a header:

```json
{
  "mcpServers": {
    "mailvalid": {
      "url": "https://mailvalid.io/mcp/",
      "headers": {
        "X-API-Key": "mv_live_your_key_here"
      }
    }
  }
}
```

## Connect via this launcher (stdio-only clients)

```bash
npm install -g @mailvalid/mcp
```

```json
{
  "mcpServers": {
    "mailvalid": {
      "command": "mailvalid-mcp",
      "env": {
        "MAILVALID_API_KEY": "mv_live_your_key_here"
      }
    }
  }
}
```

The launcher bridges stdio to the remote Streamable HTTP endpoint — it does not implement verification logic itself, so tool behavior always matches the hosted server.

## Local development

```bash
npm install
npm run build
MAILVALID_API_KEY=mv_live_your_key node dist/index.js
```

## License

MIT
