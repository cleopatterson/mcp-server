# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that provides painting job matching services via HubSpot integration. It's designed to work with AI assistants (Voiceflow, ChatGPT) to help users find qualified painters based on postcode and service type.

The project consists of:
- **MCP Server** (`index.js`): Express-based HTTP server implementing JSONRPC 2.0 MCP protocol
- **Web Component** (`web/src/PainterCarousel.jsx`): React carousel UI for displaying painter results (integrates with ChatGPT custom actions)

## Commands

### Running the Server
```bash
npm start                    # Start the MCP server (runs on port 3000 by default)
npm run build               # Install dependencies
```

### Web Component Build
```bash
cd web
npm run build              # Build React component with esbuild (outputs to web/dist/component.js)
```

## Environment Configuration

Required environment variable in `.env`:
- `HUBSPOT_TOKEN`: HubSpot API token for CRM access
- `PORT`: (optional) Server port, defaults to 3000

The server runs on Replit and uses Replit-specific environment variables (`REPL_SLUG`, `REPL_OWNER`) for URL construction.

## Architecture

### MCP Server Protocol (index.js)

The server implements the MCP protocol via JSONRPC 2.0 over HTTP at the `/mcp` endpoint:

**MCP Methods:**
- `initialize`: Returns protocol version and server capabilities
- `tools/list`: Lists available tools (only `get_top_painters`)
- `resources/list`: Lists available resources (valid service types)
- `resources/read`: Returns valid painting services list
- `tools/call`: Executes the `get_top_painters` tool

**Tool: get_top_painters**
1. Takes postcode (4-digit Australian) and service type (must match `VALID_SERVICES` enum)
2. Fetches region/area mapping from GitHub JSON file
3. Queries HubSpot CRM with paginated search (filters by region, service, active status)
4. Applies region expansion mapping (e.g., "Western Sydney" → ["Western Sydney"])
5. Sorts painters by HubSpot `quality_score` field (descending)
6. Returns top 3 painters with structured data for AI verbalization

**Key Data Structures:**
- `VALID_SERVICES`: Hardcoded array of 10 painting service types (exact match required)
- `REGION_MAPPING`: Expands certain regions to include neighboring areas for broader search
- HubSpot properties queried: company name, region, area, services, owner, phone, ratings, reviews, jobs won, quality score

**Painter Ranking Logic:**
- Primary sort: HubSpot `quality_score` (descending)
- Secondary sort: `number_of_reviews` (descending)
- Returns top 3 results

### Web Component (PainterCarousel.jsx)

React component designed for ChatGPT custom actions:
- Receives painter data via `window.openai.toolOutput`
- Displays painters in responsive carousel with cards
- Supports inline and fullscreen display modes
- Integrates with ChatGPT via `window.openai.sendFollowupTurn()` for follow-up actions

**Data Flow:**
- Input: `toolOutput` object with `{ type: 'painter_list', painters: [...], location: {...}, total: N }`
- Painter object structure: id, name, owner, rating, reviews, jobs_won, location (suburb/area/region), score, whatsapp, profile_url, engagement_rate

## Key Integration Points

1. **HubSpot CRM**: Server queries companies with "painter" industry, filters by region/service/status
2. **Postcode Mapping**: External JSON file maps Australian postcodes to region/area
3. **ChatGPT Custom Actions**: Web component uses OpenAI SDK globals for interactivity
4. **Voiceflow**: MCP endpoint designed for Voiceflow's tool calling (expects postcode from context variable)

## Important Constraints

- Service type parameter must EXACTLY match one of the 10 `VALID_SERVICES` values (case-sensitive)
- Postcode must be 4-digit Australian postcode format
- HubSpot token is required for all searches (from env or tool parameter)
- Region mapping is hardcoded for Sydney regions only
- Quality score sorting depends on HubSpot field being populated correctly
