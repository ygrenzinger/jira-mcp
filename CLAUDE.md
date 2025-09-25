# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

always use context7

## Project Overview

This is a comprehensive Model Context Protocol (MCP) server for Jira integration, reproducing functionality from the Dust repository. The server provides AI assistants with programmatic access to Jira through 16 specialized tools for complete project management.

## Build and Development Commands

### Basic Commands
```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to JavaScript
npm run clean        # Remove compiled files
```

### Server Variants
```bash
npm start            # Start simple server (1 tool: connection test)
npm run start-full   # Start full server (16 tools: complete Jira integration)
npm run dev          # Development mode with hot reload (simple server)

# HTTPS variants
npm run start-https       # Start simple server with HTTPS
npm run start-full-https  # Start full server with HTTPS
npm run dev-https         # Development mode with HTTPS
```

### Environment Setup
```bash
cp .env.example .env # Copy environment template
# Edit .env with your Jira credentials:
# - JIRA_API_TOKEN (from https://id.atlassian.com/manage-profile/security/api-tokens)
# - JIRA_EMAIL (your Jira account email)
# - JIRA_BASE_URL (https://yourcompany.atlassian.net)
# - USE_HTTPS=true (optional: enable HTTPS, default: false)
# - HTTPS_PORT=3443 (optional: HTTPS port, default: 3443)
```

### HTTPS Setup
```bash
# SSL certificates are already generated (key.pem, cert.pem)
# To enable HTTPS, set environment variable:
USE_HTTPS=true

# Or use HTTPS-specific npm scripts:
npm run start-https        # Simple server with HTTPS on port 3443
npm run start-full-https   # Full server with HTTPS on port 3443
npm run dev-https          # Development mode with HTTPS

# Health check for HTTPS (use -k to ignore self-signed certificate warnings):
curl -k https://localhost:3443/health
```

### Health Check
```bash
curl http://localhost:3000/health   # Test HTTP server and Jira connection
curl -k https://localhost:3443/health  # Test HTTPS server and Jira connection
```

## Architecture

### Two Server Implementations

**Simple Server** (`src/simple-server.ts` - 108 lines)
- Single tool: `jira_get_connection_info`
- Minimal MCP implementation for basic connection testing
- Uses simplified transport setup without custom Express integration

**Full Server** (`src/server.ts` - 873 lines)
- 16 comprehensive Jira tools covering all operations
- Complete MCP tool registration with schema validation
- Advanced Express integration with session management
- **Note**: Currently has TypeScript compilation issues with MCP SDK type compatibility

### Core Architecture Layers

**1. Type System** (`src/types.ts` - 338 lines)
- Comprehensive Zod schemas for all Jira operations and MCP responses
- TypeScript interfaces for Jira entities (JiraIssue, JiraProject, JiraUser, etc.)
- Custom error classes: JiraApiError, JiraAuthenticationError, JiraNotFoundError
- Result<T, Error> pattern for consistent error handling

**2. Jira API Layer** (`src/jira_api_helper.ts` - 692 lines)
- 25+ exported functions for Jira REST API v3 integration
- Authentication via `getJiraCredentials()` using environment variables
- Core functions: createIssue, updateIssue, searchIssues, transitionIssue
- File upload support with `uploadAttachmentsToJira`
- `withAuth()` wrapper for centralized authentication

**3. MCP Utilities** (`src/utils.ts` - 316 lines)
- MCP response formatters: `makeMCPToolJSONSuccess`, `makeMCPToolTextError`
- Result handling utilities and pagination helpers
- Simple in-memory caching with automatic cleanup
- JQL query building and text formatting utilities

**4. File Processing** (`src/file_utils.ts` - 354 lines)
- File handling for attachments (URLs, base64, conversation files)
- Jira file validation (10MB limit, security checks for dangerous extensions)
- Support for `fetchFileFromUrl` and `processBase64File`
- Reproduces Dust conversation attachment functionality

### Key Design Patterns

**Result-Based Error Handling**
All operations return `Result<T, Error>` for consistent error handling without exceptions.

**Centralized Authentication**
`withAuth()` wrapper in jira_api_helper.ts centralizes Jira API authentication and error handling.

**MCP Tool Pattern**
Each tool follows: schema validation → API call → response formatting → error handling.

**Modular File Structure**
Separated concerns: types, API layer, utilities, file handling, and server implementations.

## MCP Integration

### Claude Code Configuration
Add to your Claude Code MCP settings:
```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/mcp-jira/dist/simple-server.js"],
      "env": {
        "JIRA_API_TOKEN": "your_token",
        "JIRA_EMAIL": "your-email@company.com",
        "JIRA_BASE_URL": "https://yourcompany.atlassian.net"
      }
    }
  }
}
```

### Available Tools (Full Server)
The full server provides 16 tools organized by function:
- **Connection**: jira_get_connection_info
- **Search**: jira_search_issues, jira_get_issue
- **Management**: jira_create_issue, jira_update_issue, jira_transition_issue, jira_get_transitions
- **Linking**: jira_create_issue_link, jira_delete_issue_link, jira_get_issue_link_types
- **Communication**: jira_add_comment, jira_upload_attachments
- **Metadata**: jira_get_projects, jira_get_issue_types, jira_get_fields, jira_search_users

## Development Notes

### TypeScript Configuration
- Uses ES2022 target with ESNext modules
- Strict mode enabled with comprehensive type checking
- Source maps and declarations generated in `dist/`

### Current Issues
- The full server (`src/server.ts`) has type compatibility issues with MCP SDK
- Simple server works correctly for basic functionality
- MCP tool response types may need alignment with SDK expectations

### Environment Variables
All Jira credentials are loaded from environment variables, never hardcoded:
- `JIRA_API_TOKEN`: Required for API authentication
- `JIRA_EMAIL`: Required for basic auth header
- `JIRA_BASE_URL`: Required Jira instance URL (no trailing slash)
- `PORT`: Optional server port (default: 3000)

### File Organization
- `src/simple-server.ts`: Working minimal MCP server
- `src/server.ts`: Full-featured server (compilation issues)
- `src/jira_api_helper.ts`: Complete Jira API integration
- `src/types.ts`: Comprehensive type definitions and schemas
- `src/utils.ts`: MCP utilities and response formatting
- `src/file_utils.ts`: File attachment processing