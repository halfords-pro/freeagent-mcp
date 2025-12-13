# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that integrates with the FreeAgent API to manage timeslips and timers. The server exposes tools that allow Claude to interact with FreeAgent accounts for time tracking operations.

## FreeAgent API Reference

For detailed information about the FreeAgent API, including endpoint specifications, data formats, and authentication details, refer to the official documentation at: https://dev.freeagent.com/docs/

## Build and Development Commands

```bash
# Build the project (compiles TypeScript to build/)
npm run build

# Watch mode for development (auto-recompile on changes)
npm run watch

# Test the MCP server with the inspector
npm run inspector
```

## OAuth Token Setup

Before using the server, you need to obtain OAuth tokens from FreeAgent:

```bash
# Get OAuth tokens (interactive browser-based flow)
node scripts/get-oauth-tokens.js <client_id> <client_secret>
```

This script will:
1. Open a browser for FreeAgent authorization
2. Start a local server on port 3456 to receive the OAuth callback
3. Exchange the authorization code for access and refresh tokens
4. Output the tokens to console for use in environment variables

## Architecture

### Core Components

- **src/index.ts** - MCP server implementation that exposes tools via stdio transport
  - Defines 7 MCP tools (list_timeslips, get_timeslip, create_timeslip, update_timeslip, delete_timeslip, start_timer, stop_timer)
  - Handles tool request routing and validation
  - Uses environment variables for FreeAgent credentials

- **src/freeagent-client.ts** - FreeAgent API client wrapper
  - Manages HTTP requests to FreeAgent API (https://api.freeagent.com/v2)
  - Implements automatic OAuth token refresh via axios interceptor
  - Token refresh occurs transparently when API returns 401 status

- **src/types.ts** - TypeScript type definitions for FreeAgent entities

### Authentication Flow

1. Server initializes with OAuth credentials from environment variables
2. FreeAgentClient creates axios instance with Bearer token authorization
3. Response interceptor detects 401 errors and triggers token refresh
4. After refresh, failed request is automatically retried with new token
5. New tokens are stored in-memory (not persisted - must update env vars manually)

### MCP Tool Implementation Pattern

All tools follow this pattern in src/index.ts:
1. Tool schema defined in `ListToolsRequestSchema` handler
2. Tool execution handled in `CallToolRequestSchema` handler via switch statement
3. Arguments validated/typed before passing to FreeAgentClient
4. Results returned as JSON-stringified text content
5. Errors caught and returned with `isError: true`

### Validation

The `validateTimeslipAttributes` function (src/index.ts:22) ensures timeslip data has required fields:
- task, user, project: Must be FreeAgent API URLs (e.g., "https://api.freeagent.com/v2/tasks/123")
- dated_on: Date in YYYY-MM-DD format
- hours: String representation of decimal hours (e.g., "1.5")
- comment: Optional string field

## Environment Variables

Required for all operations:
- `FREEAGENT_CLIENT_ID` - OAuth client ID from FreeAgent Developer Dashboard
- `FREEAGENT_CLIENT_SECRET` - OAuth client secret
- `FREEAGENT_ACCESS_TOKEN` - OAuth access token (obtained via get-oauth-tokens.js)
- `FREEAGENT_REFRESH_TOKEN` - OAuth refresh token

## Docker Support

The Dockerfile uses a multi-stage build:
1. Builder stage: Installs dependencies, compiles TypeScript
2. Release stage: Creates minimal production image with only compiled code and production dependencies
3. Entry point: `node build/index.js`

Run with Docker:
```bash
# Build image
docker build -t freeagent-mcp .

# Run via MCP (stdio transport)
docker run -i --rm \
  -e FREEAGENT_CLIENT_ID \
  -e FREEAGENT_CLIENT_SECRET \
  -e FREEAGENT_ACCESS_TOKEN \
  -e FREEAGENT_REFRESH_TOKEN \
  freeagent-mcp
```

## Important Implementation Notes

- The server uses stdio transport for MCP communication (not HTTP/SSE)
- All FreeAgent API references use full URLs (not just IDs) for resources
- Timeslip hours are stored as strings to preserve decimal precision
- Console.error is used for logging (stdout is reserved for MCP protocol)
- Token refresh happens automatically but doesn't persist - users must manually update env vars with new tokens
- The `nested` parameter in list_timeslips controls whether FreeAgent includes related resource data
