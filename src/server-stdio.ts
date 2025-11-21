import { loadEnvFile } from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  searchJiraIssuesUsingJql,
  getIssue,
  getIssueComments,
  getIssueTypes,
  listFieldSummaries,
  getProjects,
  normalizeError
} from "./jira_api_helper.js";

import {
  JiraGetFieldsRequestSchema,
  SEARCH_ISSUES_MAX_RESULTS
} from "./types.js";

import {
  makeInternalMCPServer,
  makeMCPToolJSONSuccess,
  makeMCPToolTextError,
  makeMCPToolDetailedError,
  handleResult,
  createTokenPaginationInfo,
  createPaginationInfo,
  formatDate,
  truncateText
} from "./utils.js";

// Create and configure the MCP server with all Jira tools
function createServer(): McpServer {
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
      console.error('🔧 [jira_get_connection_info] Args:', JSON.stringify(_args, null, 2));
      try {
        const result = await getConnectionInfo();
        console.error('📊 [jira_get_connection_info] Jira API result:', JSON.stringify(result, null, 2));

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

  // Tool 2: Get Issues Using JQL (Direct JQL Query - Dust-style)
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
      console.error('🔧 [jira_get_issues_using_jql] Args:', JSON.stringify(args, null, 2));
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

  // Tool 3: Get Issue Details
  server.registerTool(
    "jira_get_issue",
    {
      title: "Get Jira Issue Details",
      description: "Get detailed information about a specific Jira issue",
      inputSchema: {
        issueKey: z.string().describe("The issue key (e.g., 'PROJ-123')"),
        fields: z.array(z.string()).optional().describe("Optional list of Jira fields to retrieve")
      }
    },
    async (args: any) => {
      console.error('🔧 [jira_get_issue] Args:', JSON.stringify(args, null, 2));
      try {
        const { issueKey, fields } = args;
        console.error(`Fetching issue ${issueKey} with fields: ${fields ? fields.join(', ') : 'default fields'}`);
        const result = await getIssue(issueKey, fields);

        return handleResult(result, (issue) => {
          const issueDetails = {
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
          };

          return makeMCPToolJSONSuccess(issueDetails);
        });
      } catch (error) {
        return makeMCPToolDetailedError(
          normalizeError(error),
          "Failed to get issue details",
          [
            "Verify the issue key is correct",
            "Check that you have permission to view the issue"
          ]
        );
      }
    }
  );

  // Tool 4: Get Issue Comments
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
      console.error('🔧 [jira_get_comments] Args:', JSON.stringify(args, null, 2));
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

  // Tool 5: Get Projects
  server.registerTool(
    "jira_get_projects",
    {
      title: "Get Jira Projects",
      description: "Get all available Jira projects",
      inputSchema: {}
    },
    async (args) => {
      console.error('🔧 [jira_get_projects] Args:', JSON.stringify(args, null, 2));
      const result = await getProjects();
      console.error('📊 [jira_get_projects] Jira API result:', JSON.stringify(result, null, 2));
      return handleResult(result, (projects) => {
        const projectsInfo = projects.map(project => ({
          id: project.id,
          key: project.key,
          name: project.name,
          projectTypeKey: project.projectTypeKey,
          style: project.style,
          isPrivate: project.isPrivate
        }));

        return makeMCPToolJSONSuccess({
          projects: projectsInfo,
          count: projects.length
        });
      });
    }
  );

  // Tool 6: Get Issue Types
  server.registerTool(
    "jira_get_issue_types",
    {
      title: "Get Issue Types",
      description: "Get all available issue types in Jira",
      inputSchema: {}
    },
    async (args) => {
      console.error('🔧 [jira_get_issue_types] Args:', JSON.stringify(args, null, 2));
      const result = await getIssueTypes();
      console.error('📊 [jira_get_issue_types] Jira API result:', JSON.stringify(result, null, 2));
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

  // Tool 7: Get Fields
  server.registerTool(
    "jira_get_fields",
    {
      title: "Get Jira Fields",
      description: "Get all available Jira fields (system and custom)",
      inputSchema: JiraGetFieldsRequestSchema.shape
    },
    async (args: any) => {
      console.error('🔧 [jira_get_fields] Args:', JSON.stringify(args, null, 2));
      try {
        const params = JiraGetFieldsRequestSchema.parse(args);
        const result = await listFieldSummaries(
          params.maxResults,
          params.startAt,
          params.fieldTypes,
          params.searchTerm
        );
        console.error('📊 [jira_get_fields] Jira API result:', JSON.stringify(result, null, 2));

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

// Main function to start the stdio server
async function main() {
  console.error('🚀 Starting Jira MCP Server (stdio)...');

  // Validate environment variables
  console.error('🔐 Authentication: Using environment variables');
  console.error(`  - JIRA_API_TOKEN: ${process.env.JIRA_API_TOKEN ? '✅ Set' : '❌ Missing'}`);
  console.error(`  - JIRA_EMAIL: ${process.env.JIRA_EMAIL ? '✅ Set' : '❌ Missing'}`);
  console.error(`  - JIRA_BASE_URL: ${process.env.JIRA_BASE_URL ? '✅ Set' : '❌ Missing'}`);

  if (!process.env.JIRA_API_TOKEN || !process.env.JIRA_EMAIL || !process.env.JIRA_BASE_URL) {
    console.error('⚠️  Warning: Jira credentials not fully configured. See README.md for setup instructions.');
  }

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  console.error('✅ Jira MCP Server connected via stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
