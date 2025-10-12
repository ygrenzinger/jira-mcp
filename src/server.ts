import { loadEnvFile } from "node:process";
import express from "express";
import https from "https";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Load environment variables from .env file if it exists
try {
  loadEnvFile();
} catch (error) {
  // .env file is optional - environment variables can be passed via MCP config
}

// Import our Jira functionality
import {
  getConnectionInfo,
  searchIssues,
  searchJiraIssuesUsingJql,
  searchIssuesWithFilters,
  createIssue,
  updateIssue,
  getIssue,
  transitionIssue,
  getTransitions,
  createIssueLink,
  deleteIssueLink,
  getIssueLinkTypes,
  createComment,
  getIssueComments,
  uploadAttachmentsToJira,
  getProjects,
  getIssueTypes,
  getIssueFields,
  listFieldSummaries,
  listUsers,
  searchUsersByEmailExact,
  normalizeError
} from "./jira_api_helper.js";

import {
  JiraCreateIssueRequestSchema,
  JiraUpdateIssueRequestSchema,
  JiraCreateIssueLinkRequestSchema,
  JiraSearchIssuesRequestSchema,
  JiraSearchFilterSchema,
  JiraSortSchema,
  JiraTransitionIssueRequestSchema,
  JiraAddCommentRequestSchema,
  JiraUploadAttachmentRequestSchema,
  JiraSearchUsersRequestSchema,
  JiraGetFieldsRequestSchema,
  SEARCH_USERS_MAX_RESULTS,
  SEARCH_ISSUES_MAX_RESULTS
} from "./types.js";

import {
  makeInternalMCPServer,
  makeMCPToolJSONSuccess,
  makeMCPToolTextSuccess,
  makeMCPToolTextError,
  makeMCPToolDetailedError,
  handleResult,
  createPaginationInfo,
  createTokenPaginationInfo,
  formatDate,
  truncateText
} from "./utils.js";

import {
  getFileFromConversationAttachment,
  fetchFileFromUrl,
  processBase64File,
  processMultipleFiles,
  createAttachmentSummary
} from "./file_utils.js";

const app = express();
app.use(express.json());

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// Create and configure the MCP server with all Jira tools
function createServer(auth?: any, agentLoopContext?: any): McpServer {
  const server = makeInternalMCPServer({
    name: "jira-mcp-server",
    version: "1.0.0"
  });

  // Tool 1: Get Connection Info
  server.registerTool(
    "jira_get_connection_info",
    {
      title: "Get Jira Connection Info",
      description: "Get information about the current Jira connection and user",
      inputSchema: {}
    },
    async (_args, _extra) => {
      console.log('🔧 [jira_get_connection_info] Args:', JSON.stringify(_args, null, 2));
      try {
        const result = await getConnectionInfo();
        console.log('📊 [jira_get_connection_info] Jira API result:', JSON.stringify(result, null, 2));

        if (result.success) {
          const data = result.data;
          const info = `🔗 Jira Connection Status

**Server Info:**
- Base URL: ${data.baseUrl}
- Server Title: ${data.serverInfo.serverTitle || 'N/A'}
- Version: ${data.serverInfo.version || 'N/A'}

**Current User:**
- Display Name: ${data.currentUser.displayName}
- Email: ${data.currentUser.emailAddress}
- Account ID: ${data.currentUser.accountId}
- Active: ${data.currentUser.active}

**Connection:** ✅ Connected`;

          return {
            content: [
              {
                type: "text",
                text: info
              }
            ]
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${result.error.message}`
              }
            ],
            isError: true
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`
            }
          ],
          isError: true
        };
      }
    }
  );

  // Tool 2b: Get Issues Using JQL (Direct JQL Query - Dust-style)
  server.registerTool(
    "jira_get_issues_using_jql",
    {
      title: "Get Jira Issues Using JQL",
      description: "Search JIRA issues using a custom JQL (Jira Query Language) query. This tool allows for advanced search capabilities beyond the filtered search. Examples: 'project = PROJ AND status = Open', 'assignee = currentUser() AND priority = High', 'created >= -30d AND labels = bug'.",
      inputSchema: {
        jql: z.string().describe("The JQL (Jira Query Language) query string"),
        maxResults: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .default(SEARCH_ISSUES_MAX_RESULTS)
          .describe(`Maximum number of results to return (default: ${SEARCH_ISSUES_MAX_RESULTS}, max: 100)`),
        fields: z
          .array(z.string())
          .optional()
          .describe(
            "Optional list of additional fields to include in the response. Always include ['summary', 'status', 'assignee', 'priority', 'created', 'updated']"
          ),
        nextPageToken: z
          .string()
          .optional()
          .describe("Token for retrieving the next page of results (from previous response)"),
      }
    },
    async (args: any) => {
      console.log('🔧 [jira_get_issues_using_jql] Args:', JSON.stringify(args, null, 2));
      try {
        const { jql, maxResults, fields, nextPageToken } = args;

        const result = await searchJiraIssuesUsingJql(jql, {
          maxResults,
          fields,
          nextPageToken,
          expand: ['renderedFields']
        });

        return handleResult(result, (data) => {
          const pagination = createTokenPaginationInfo(data.maxResults, data.isLast, data.nextPageToken);

          const message =
            data.issues.length === 0
              ? "No issues found matching the JQL query"
              : "Issues retrieved successfully using JQL";

          return makeMCPToolJSONSuccess({
            message,
            pagination,
            issues: data.issues.map(issue => ({
              ...issue,
              key: issue.key,
              summary: issue.fields?.summary || 'No summary available',
              status: issue.fields?.status?.name || 'Unknown',
              assignee: issue.fields?.assignee?.displayName || 'Unknown',
              priority: issue.fields?.priority?.name || 'None',
              created: issue.fields?.created ? formatDate(issue.fields.created) : 'Unknown',
              updated: issue.fields?.updated ? formatDate(issue.fields.updated) : 'Unknown',
              url: `${process.env.JIRA_BASE_URL}/browse/${issue.key}`,
              description: issue.renderedFields?.description ? truncateText(issue.renderedFields.description, 500) : 'No description available'
            })),
            jql,
            isLast: data.isLast,
            nextPageToken: data.nextPageToken
          });
        });
      } catch (error) {
        return makeMCPToolTextError(normalizeError(error));
      }
    }
  );

  // Tool 11: Get Issue Comments
  server.registerTool(
    "jira_get_comments",
    {
      title: "Get Jira Issue Comments",
      description: "Get all comments about a specific Jira issue",
      inputSchema: {
        issueKey: z.string().describe("The issue key (e.g., 'PROJ-123')")
      }
    },
    async (args: any) => {
      console.log('🔧 [jira_get_comments] Args:', JSON.stringify(args, null, 2));
      try {
        const { issueKey } = args;
        const result = await getIssueComments(issueKey);

        return handleResult(result, (comments) => {
          return makeMCPToolJSONSuccess({
            issueKey,
            comments,
            total: comments.length
          });
        });
      } catch (error) {
        return makeMCPToolDetailedError(
          normalizeError(error),
          "Failed to get issue comments",
          [
            "Verify the issue key is correct",
            "Check that you have permission to view the issue and its comments"
          ]
        );
      }
    }
  );

  // Tool 14: Get Issue Types
  server.registerTool(
    "jira_get_issue_types",
    {
      title: "Get Issue Types",
      description: "Get all available issue types in Jira",
      inputSchema: {}
    },
    async (args) => {
      console.log('🔧 [jira_get_issue_types] Args:', JSON.stringify(args, null, 2));
      const result = await getIssueTypes();
      console.log('📊 [jira_get_issue_types] Jira API result:', JSON.stringify(result, null, 2));
      return handleResult(result, (issueTypes) => {
        const typesInfo = issueTypes.map(type => ({
          id: type.id,
          name: type.name,
          description: type.description || '',
          subtask: type.subtask,
          iconUrl: type.iconUrl
        }));

        return makeMCPToolJSONSuccess({
          issueTypes: typesInfo,
          count: issueTypes.length
        });
      });
    }
  );

  // Tool 17: Get Fields
  server.registerTool(
    "jira_get_fields",
    {
      title: "Get Jira Fields",
      description: "Get all available Jira fields (system and custom)",
      inputSchema: JiraGetFieldsRequestSchema.shape
    },
    async (args: any) => {
      console.log('🔧 [jira_get_fields] Args:', JSON.stringify(args, null, 2));
      try {
        const params = JiraGetFieldsRequestSchema.parse(args);
        const result = await listFieldSummaries(
          params.maxResults,
          params.startAt,
          params.fieldTypes,
          params.searchTerm
        );
        console.log('📊 [jira_get_fields] Jira API result:', JSON.stringify(result, null, 2));

        return handleResult(result, (data) => {
          const pagination = createPaginationInfo(data.startAt, data.maxResults, data.total);

          return makeMCPToolJSONSuccess({
            pagination,
            fields: data.fields,
            total: data.total
          });
        });
      } catch (error) {
        return makeMCPToolTextError(normalizeError(error));
      }
    }
  );

  return server;
}

// Handle POST requests for client-to-server communication
app.post('/mcp', async (req, res) => {
  try {
    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          // Store the transport by session ID
          transports[sessionId] = transport;
          console.log(`🔗 New Jira MCP session initialized: ${sessionId}`);
        },
        enableDnsRebindingProtection: false,
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          console.log(`🔌 Jira MCP session closed: ${transport.sessionId}`);
          delete transports[transport.sessionId];
        }
      };

      const server = createServer();
      await server.connect(transport);
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req: express.Request, res: express.Response) => {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling session request:', error);
    res.status(500).send('Internal server error');
  }
};

// Handle GET requests for server-to-client notifications via SSE
app.get('/mcp', handleSessionRequest);

// Handle DELETE requests for session termination
app.delete('/mcp', handleSessionRequest);

// Health check endpoint with Jira connection status
app.get('/health', async (req, res) => {
  const connectionResult = await getConnectionInfo();

  res.json({
    status: 'ok',
    server: 'jira-mcp-server',
    version: '1.0.0',
    activeSessions: Object.keys(transports).length,
    jiraConnection: {
      configured: !!(process.env.JIRA_API_TOKEN && process.env.JIRA_EMAIL && process.env.JIRA_BASE_URL),
      connected: connectionResult.success,
      baseUrl: process.env.JIRA_BASE_URL || 'not configured'
    },
    tools: [
      'jira_get_connection_info',
      'jira_get_issues_using_jql',
      'jira_get_comments',
      'jira_get_issue_link_types',
      'jira_get_fields'
    ]
  });
});

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const USE_HTTPS = process.env.USE_HTTPS === 'true';

if (USE_HTTPS) {
  try {
    const httpsOptions = {
      key: fs.readFileSync(path.join(process.cwd(), 'key.pem')),
      cert: fs.readFileSync(path.join(process.cwd(), 'cert.pem'))
    };

    https.createServer(httpsOptions, app).listen(HTTPS_PORT, () => {
      console.log(`🚀 Jira MCP Server running on HTTPS port ${HTTPS_PORT}`);
      console.log(`📍 Health check: https://localhost:${HTTPS_PORT}/health`);
      console.log(`🔗 MCP endpoint: https://localhost:${HTTPS_PORT}/mcp`);

      console.log(`\n🔐 Authentication: Using environment variables`);
      console.log(`  - JIRA_API_TOKEN: ${process.env.JIRA_API_TOKEN ? '✅ Set' : '❌ Missing'}`);
      console.log(`  - JIRA_EMAIL: ${process.env.JIRA_EMAIL ? '✅ Set' : '❌ Missing'}`);
      console.log(`  - JIRA_BASE_URL: ${process.env.JIRA_BASE_URL ? '✅ Set' : '❌ Missing'}`);

      if (!process.env.JIRA_API_TOKEN || !process.env.JIRA_EMAIL || !process.env.JIRA_BASE_URL) {
        console.log(`\n⚠️  Warning: Jira credentials not fully configured. See README.md for setup instructions.`);
      }
    });
  } catch (error) {
    console.error("Failed to start HTTPS server:", error);
    console.log("Falling back to HTTP...");
  }
} else {
  app.listen(PORT, () => {
    console.log(`🚀 Jira MCP Server running on HTTP port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`🔗 MCP endpoint: http://localhost:${PORT}/mcp`);

    console.log(`\n🔐 Authentication: Using environment variables`);
    console.log(`  - JIRA_API_TOKEN: ${process.env.JIRA_API_TOKEN ? '✅ Set' : '❌ Missing'}`);
    console.log(`  - JIRA_EMAIL: ${process.env.JIRA_EMAIL ? '✅ Set' : '❌ Missing'}`);
    console.log(`  - JIRA_BASE_URL: ${process.env.JIRA_BASE_URL ? '✅ Set' : '❌ Missing'}`);

    if (!process.env.JIRA_API_TOKEN || !process.env.JIRA_EMAIL || !process.env.JIRA_BASE_URL) {
      console.log(`\n⚠️  Warning: Jira credentials not fully configured. See README.md for setup instructions.`);
    }
  });
}