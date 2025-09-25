# Jira MCP Server

A comprehensive Model Context Protocol (MCP) server for Jira integration, reproducing the exact functionality from the Dust repository. This server provides 16 powerful tools for complete Jira project management through AI assistants.

## 🚀 Features

### 📊 Connection & Information
- **Connection validation** and detailed server info
- **Real-time status** monitoring with health checks

### 🔍 Advanced Search & Retrieval
- **Flexible issue search** with JQL support and filters
- **Detailed issue information** with full field expansion
- **Pagination support** for large result sets

### 📝 Complete Issue Management
- **Create issues** with full field support (custom fields, components, versions)
- **Update existing issues** with field validation
- **Workflow transitions** with comment support
- **Issue linking** with relationship management

### 💬 Communication & Attachments
- **Comment management** with visibility controls
- **File attachment support** (URLs, base64, conversation files)
- **Attachment validation** and size limits

### 🏗️ Metadata & Administration
- **Project discovery** and management
- **Issue type** and **field** introspection
- **User search** and management
- **Link type** configuration

## 📦 Installation

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd mcp-jira
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your Jira credentials
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

## 🔐 Authentication Setup

### 1. Generate Jira API Token
1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a label (e.g., "MCP Server")
4. Copy the generated token

### 2. Configure Environment Variables
Create a `.env` file in the project root:

```env
# Required: Your Jira API token
JIRA_API_TOKEN=your_api_token_here

# Required: Your Jira account email
JIRA_EMAIL=your-email@company.com

# Required: Your Jira instance URL (no trailing slash)
JIRA_BASE_URL=https://yourcompany.atlassian.net

# Optional: Server port (default: 3000)
PORT=3000
```

## 🏃 Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

The server will start on port 3000 (or your configured PORT).

## 🛠️ Available MCP Tools (16 Total)

### 📊 Connection & Info
- **`jira_get_connection_info`** - Validate connection and show server details

### 🔍 Search & Retrieval
- **`jira_search_issues`** - Advanced issue search with JQL and filters
- **`jira_get_issue`** - Get detailed issue information

### 📝 Issue Management
- **`jira_create_issue`** - Create issues with full field support
- **`jira_update_issue`** - Update existing issue fields
- **`jira_transition_issue`** - Move issues through workflow
- **`jira_get_transitions`** - Get available workflow transitions

### 🔗 Issue Linking
- **`jira_create_issue_link`** - Link related issues
- **`jira_delete_issue_link`** - Remove issue links
- **`jira_get_issue_link_types`** - Get available link types

### 💬 Comments & Attachments
- **`jira_add_comment`** - Add comments to issues
- **`jira_upload_attachments`** - Upload files to issues

### 🏗️ Metadata & Administration
- **`jira_get_projects`** - List accessible projects
- **`jira_get_issue_types`** - Get available issue types
- **`jira_get_fields`** - Get system and custom fields
- **`jira_search_users`** - Find users by name/email

## 🔍 API Endpoints

- **POST /mcp** - Main MCP communication endpoint
- **GET /mcp** - Server-to-client notifications via SSE
- **DELETE /mcp** - Session termination
- **GET /health** - Health check with Jira connection status

## 🧪 Testing the Server

### 1. Health Check
```bash
curl http://localhost:3000/health
```

### 2. Using MCP Client
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({
  name: 'jira-test-client',
  version: '1.0.0'
});

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3000/mcp')
);

await client.connect(transport);

// Test connection
const connectionInfo = await client.callTool('jira_get_connection_info', {});
console.log('Connection:', connectionInfo);

// Search for issues
const issues = await client.callTool('jira_search_issues', {
  projectKey: 'PROJ',
  maxResults: 10
});
console.log('Issues:', issues);

// Create an issue
const newIssue = await client.callTool('jira_create_issue', {
  projectKey: 'PROJ',
  issueType: 'Task',
  summary: 'Test issue from MCP',
  description: 'Created via MCP server'
});
console.log('New issue:', newIssue);
```

### 3. Claude Code Integration
Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "jira": {
      "command": "node",
      "args": ["/path/to/mcp-jira/dist/server.js"],
      "env": {
        "JIRA_API_TOKEN": "your_token",
        "JIRA_EMAIL": "your-email@company.com",
        "JIRA_BASE_URL": "https://yourcompany.atlassian.net"
      }
    }
  }
}
```

## 📁 Project Structure

```
mcp-jira/
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── .env.example              # Environment variable template
├── src/
│   ├── server.ts             # Main MCP server with 16 tools
│   ├── jira_api_helper.ts    # Jira API integration functions
│   ├── types.ts              # Zod schemas and TypeScript types
│   ├── utils.ts              # MCP utilities and helpers
│   └── file_utils.ts         # File handling utilities
├── dist/                     # Compiled JavaScript (after build)
└── README.md                 # This documentation
```

## ⚙️ Development

### Scripts
- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run in development mode with hot reload
- `npm start` - Run the compiled server
- `npm run clean` - Remove compiled files

### Architecture
- **Result-based error handling** - All operations return `Result<T, Error>`
- **Comprehensive validation** - Zod schemas for all inputs
- **Session management** - Persistent MCP connections
- **Type safety** - Full TypeScript coverage
- **Modular design** - Separated concerns across files

### Key Features
- **Authentication wrapper** - Centralized Jira API auth
- **File processing** - Support for URLs, base64, conversation attachments
- **Pagination support** - Handle large datasets efficiently
- **Caching layer** - Simple in-memory caching for performance
- **Error context** - Detailed error messages with suggestions

## 🔒 Security

- **Token-based authentication** - Uses Jira API tokens
- **Input validation** - All inputs validated with Zod schemas
- **File size limits** - 10MB limit for attachments
- **Safe file types** - Blocks potentially dangerous file extensions
- **Environment isolation** - Credentials stored in environment variables

## 🐛 Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Verify your API token is correct
   - Check that your email matches your Jira account
   - Ensure JIRA_BASE_URL doesn't have a trailing slash

2. **Permission Denied**
   - Verify you have the required Jira permissions
   - Check project access rights
   - Ensure issue type is available in the project

3. **Connection Issues**
   - Verify JIRA_BASE_URL is accessible
   - Check firewall/network restrictions
   - Test connection with `/health` endpoint

4. **Tool Errors**
   - Check the MCP tool response for detailed error messages
   - Verify input parameters match the expected schema
   - Use `jira_get_connection_info` to test basic connectivity

### Debug Mode
Set environment variable for detailed logging:
```bash
DEBUG=mcp-jira npm run dev
```

## 📄 License

MIT License

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📚 References

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Jira REST API Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/)
- [Atlassian Document Format (ADF)](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)