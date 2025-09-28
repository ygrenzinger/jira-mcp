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

// Load environment variables from .env file
loadEnvFile();

// Import our Jira functionality
import {
  getConnectionInfo,
  searchIssues,
  searchJiraIssuesUsingJql,
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
  JiraTransitionIssueRequestSchema,
  JiraAddCommentRequestSchema,
  JiraUploadAttachmentRequestSchema,
  JiraSearchUsersRequestSchema,
  SEARCH_USERS_MAX_RESULTS
} from "./types.js";

import {
  makeInternalMCPServer,
  makeMCPToolJSONSuccess,
  makeMCPToolTextSuccess,
  makeMCPToolTextError,
  makeMCPToolDetailedError,
  handleResult,
  createPaginationInfo,
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

  // Tool 2: Search Issues
  server.registerTool(
    "jira_search_issues",
    {
      title: "Search Jira Issues",
      description: "Search for Jira issues using various filters or JQL",
      inputSchema: JiraSearchIssuesRequestSchema.shape
    },
    async (args: any) => {
      console.log('🔧 [jira_search_issues] Args:', JSON.stringify(args, null, 2));
      try {
        const params = JiraSearchIssuesRequestSchema.parse(args);

        let result;
        if (params.jql) {
          // Use custom JQL
          result = await searchJiraIssuesUsingJql(params.jql, {
            maxResults: params.maxResults,
            startAt: params.startAt,
            expand: params.expand,
            fields: params.fields
          });
        } else {
          // Use field-based search
          result = await searchIssues({
            projectKey: params.projectKey,
            assignee: params.assignee,
            reporter: params.reporter,
            status: params.status,
            issueType: params.issueType,
            priority: params.priority,
            maxResults: params.maxResults,
            startAt: params.startAt,
            expand: params.expand
          });
        }

        return handleResult(result, (data) => {
          const pagination = createPaginationInfo(data.startAt, data.maxResults, data.total);

          const issuesInfo = data.issues.map(issue => ({
            key: issue.key,
            summary: issue.fields?.summary || 'No summary available',
            status: issue.fields?.status?.name || 'Unknown',
            assignee: issue.fields?.assignee?.displayName || 'Unassigned',
            priority: issue.fields?.priority?.name || 'None',
            created: issue.fields?.created ? formatDate(issue.fields.created) : 'Unknown',
            updated: issue.fields?.updated ? formatDate(issue.fields.updated) : 'Unknown',
            url: `${process.env.JIRA_BASE_URL}/browse/${issue.key}`
          }));

          return makeMCPToolJSONSuccess({
            pagination,
            issues: issuesInfo,
            total: data.total
          });
        });
      } catch (error) {
        return makeMCPToolTextError(normalizeError(error));
      }
    }
  );

  // Tool 3: Create Issue
  server.registerTool(
    "jira_create_issue",
    {
      title: "Create Jira Issue",
      description: "Create a new Jira issue with specified fields",
      inputSchema: JiraCreateIssueRequestSchema.shape
    },
  async (args: any) => {
      console.log('🔧 [jira_create_issue] Args:', JSON.stringify(args, null, 2));
      try {
        const params = JiraCreateIssueRequestSchema.parse(args);
        const result = await createIssue(params);
        console.log('📊 [jira_create_issue] Jira API result:', JSON.stringify(result, null, 2));

        return handleResult(result, (data) => {
          const issueUrl = `${process.env.JIRA_BASE_URL}/browse/${data.key}`;
          const successMessage = `✅ Issue created successfully!

**Issue:** ${data.key}
**Summary:** ${params.summary}
**Project:** ${params.projectKey}
**Type:** ${params.issueType}
**URL:** ${issueUrl}`;

          return makeMCPToolTextSuccess(successMessage);
        });
      } catch (error) {
        return makeMCPToolDetailedError(
          normalizeError(error),
          "Failed to create Jira issue",
          [
            "Verify the project key exists and you have permission to create issues",
            "Check that the issue type is valid for the project",
            "Ensure all required fields are provided"
          ]
        );
      }
    }
  );

  // Tool 4: Update Issue
  server.registerTool(
    "jira_update_issue",
    {
      title: "Update Jira Issue",
      description: "Update an existing Jira issue with new field values",
      inputSchema: JiraUpdateIssueRequestSchema.shape
    },
  async (args: any) => {
      console.log('🔧 [jira_update_issue] Args:', JSON.stringify(args, null, 2));
      try {
        const params = JiraUpdateIssueRequestSchema.parse(args);
        const { issueKey, ...updates } = params;

        const result = await updateIssue(issueKey, updates);
        console.log('📊 [jira_update_issue] Jira API result:', JSON.stringify(result, null, 2));

        return handleResult(result, () => {
          const issueUrl = `${process.env.JIRA_BASE_URL}/browse/${issueKey}`;
          const successMessage = `✅ Issue updated successfully!

**Issue:** ${issueKey}
**URL:** ${issueUrl}

**Updated fields:**
${Object.entries(updates)
  .filter(([_, value]) => value !== undefined)
  .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
  .join('\n')}`;

          return makeMCPToolTextSuccess(successMessage);
        });
      } catch (error) {
        return makeMCPToolDetailedError(
          normalizeError(error),
          "Failed to update Jira issue",
          [
            "Verify the issue key exists",
            "Check that you have permission to edit the issue",
            "Ensure field values are valid for the issue type"
          ]
        );
      }
    }
  );

  // Tool 5: Get Issue Details
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
      console.log('🔧 [jira_get_issue] Args:', JSON.stringify(args, null, 2));
      try {
        const { issueKey, fields } = args;
        const result = await getIssue(issueKey, fields);

        return handleResult(result, (issue) => {
          const description = issue.fields?.description?.content?.[0]?.content?.[0]?.text || 'No description';

          const issueDetails = {
            key: issue.key,
            summary: issue.fields?.summary || 'No summary available',
            description: truncateText(description, 300),
            status: {
              name: issue.fields?.status?.name || 'Unknown',
              category: issue.fields?.status?.statusCategory?.name || 'Unknown'
            },
            assignee: issue.fields?.assignee ? {
              displayName: issue.fields.assignee.displayName,
              emailAddress: issue.fields.assignee.emailAddress
            } : null,
            reporter: issue.fields?.reporter ? {
              displayName: issue.fields.reporter.displayName,
              emailAddress: issue.fields.reporter.emailAddress
            } : null,
            priority: issue.fields?.priority?.name || 'None',
            issueType: issue.fields?.issuetype ? {
              name: issue.fields.issuetype.name,
              iconUrl: issue.fields.issuetype.iconUrl
            } : null,
            project: issue.fields?.project ? {
              key: issue.fields.project.key,
              name: issue.fields.project.name
            } : null,
            created: issue.fields?.created ? formatDate(issue.fields.created) : 'Unknown',
            updated: issue.fields?.updated ? formatDate(issue.fields.updated) : 'Unknown',
            labels: issue.fields?.labels || [],
            components: issue.fields?.components?.map((c: any) => c.name) || [],
            fixVersions: issue.fields?.fixVersions?.map((v: any) => v.name) || [],
            url: `${process.env.JIRA_BASE_URL}/browse/${issue.key}`
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

  // Tool 6: Transition Issue
  server.registerTool(
    "jira_transition_issue",
    {
      title: "Transition Jira Issue",
      description: "Move a Jira issue through its workflow (change status)",
      inputSchema: JiraTransitionIssueRequestSchema.shape
    },
  async (args: any) => {
      console.log('🔧 [jira_transition_issue] Args:', JSON.stringify(args, null, 2));
      try {
        const params = JiraTransitionIssueRequestSchema.parse(args);
        const { issueKey, transitionId, comment, fields } = params;

        const result = await transitionIssue(issueKey, transitionId, comment, fields);
        console.log('📊 [jira_transition_issue] Jira API result:', JSON.stringify(result, null, 2));

        return handleResult(result, () => {
          const issueUrl = `${process.env.JIRA_BASE_URL}/browse/${issueKey}`;
          let successMessage = `✅ Issue transitioned successfully!

**Issue:** ${issueKey}
**Transition ID:** ${transitionId}
**URL:** ${issueUrl}`;

          if (comment) {
            successMessage += `\n**Comment added:** ${truncateText(comment, 100)}`;
          }

          return makeMCPToolTextSuccess(successMessage);
        });
      } catch (error) {
        return makeMCPToolDetailedError(
          normalizeError(error),
          "Failed to transition issue",
          [
            "Verify the issue key exists",
            "Check that the transition ID is valid for the current issue status",
            "Use jira_get_transitions to see available transitions"
          ]
        );
      }
    }
  );

  // Tool 7: Get Available Transitions
  server.registerTool(
    "jira_get_transitions",
    {
      title: "Get Available Transitions",
      description: "Get the available workflow transitions for a Jira issue",
      inputSchema: {
        issueKey: z.string().describe("The issue key to get transitions for")
      }
    },
  async (args: any) => {
      console.log('🔧 [jira_get_transitions] Args:', JSON.stringify(args, null, 2));
      try {
        const { issueKey } = args;
        const result = await getTransitions(issueKey);
        console.log('📊 [jira_get_transitions] Jira API result:', JSON.stringify(result, null, 2));

        return handleResult(result, (transitions) => {
          const transitionsInfo = transitions.map(transition => ({
            id: transition.id,
            name: transition.name,
            to: {
              id: transition.to.id,
              name: transition.to.name
            }
          }));

          return makeMCPToolJSONSuccess({
            issueKey,
            availableTransitions: transitionsInfo
          });
        });
      } catch (error) {
        return makeMCPToolTextError(normalizeError(error));
      }
    }
  );

  // Tool 8: Create Issue Link
  server.registerTool(
    "jira_create_issue_link",
    {
      title: "Create Issue Link",
      description: "Create a link between two Jira issues",
  inputSchema: JiraCreateIssueLinkRequestSchema.shape
    },
  async (args: any) => {
      console.log('🔧 [jira_create_issue_link] Args:', JSON.stringify(args, null, 2));
      try {
        const params = JiraCreateIssueLinkRequestSchema.parse(args);
        const { inwardIssueKey, outwardIssueKey, linkType, comment } = params;

        const result = await createIssueLink(inwardIssueKey, outwardIssueKey, linkType, comment);
        console.log('📊 [jira_create_issue_link] Jira API result:', JSON.stringify(result, null, 2));

        return handleResult(result, () => {
          let successMessage = `✅ Issue link created successfully!

**Link Type:** ${linkType}
**From:** ${outwardIssueKey}
**To:** ${inwardIssueKey}`;

          if (comment) {
            successMessage += `\n**Comment:** ${truncateText(comment, 100)}`;
          }

          return makeMCPToolTextSuccess(successMessage);
        });
      } catch (error) {
        return makeMCPToolDetailedError(
          normalizeError(error),
          "Failed to create issue link",
          [
            "Verify both issue keys exist",
            "Check that the link type is valid",
            "Use jira_get_issue_link_types to see available link types"
          ]
        );
      }
    }
  );

  // Tool 9: Delete Issue Link
  server.registerTool(
    "jira_delete_issue_link",
    {
      title: "Delete Issue Link",
      description: "Delete a link between Jira issues",
      inputSchema: {
        linkId: z.string().describe("The ID of the issue link to delete")
      }
    },
  async (args: any) => {
      console.log('🔧 [jira_delete_issue_link] Args:', JSON.stringify(args, null, 2));
      try {
        const { linkId } = args;
        const result = await deleteIssueLink(linkId);
        console.log('📊 [jira_delete_issue_link] Jira API result:', JSON.stringify(result, null, 2));

        return handleResult(result, () => {
          return makeMCPToolTextSuccess(`✅ Issue link deleted successfully!\n\n**Link ID:** ${linkId}`);
        });
      } catch (error) {
        return makeMCPToolTextError(normalizeError(error));
      }
    }
  );

  // Tool 10: Add Comment
  server.registerTool(
    "jira_add_comment",
    {
      title: "Add Comment to Issue",
      description: "Add a comment to a Jira issue",
  inputSchema: JiraAddCommentRequestSchema.shape
    },
  async (args: any) => {
      console.log('🔧 [jira_add_comment] Args:', JSON.stringify(args, null, 2));
      try {
        const params = JiraAddCommentRequestSchema.parse(args);
        const { issueKey, body, visibility } = params;

        const result = await createComment(issueKey, body, visibility);
        console.log('📊 [jira_add_comment] Jira API result:', JSON.stringify(result, null, 2));

        return handleResult(result, (comment) => {
          const issueUrl = `${process.env.JIRA_BASE_URL}/browse/${issueKey}`;
          let successMessage = `✅ Comment added successfully!

**Issue:** ${issueKey}
**Comment:** ${truncateText(body, 200)}
**URL:** ${issueUrl}`;

          if (visibility) {
            successMessage += `\n**Visibility:** ${visibility.type} - ${visibility.value}`;
          }

          return makeMCPToolTextSuccess(successMessage);
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

  // Tool 12: Upload Attachments
  server.registerTool(
    "jira_upload_attachments",
    {
      title: "Upload Attachments to Issue",
      description: "Upload files as attachments to a Jira issue",
  inputSchema: JiraUploadAttachmentRequestSchema.shape
    },
  async (args: any) => {
      console.log('🔧 [jira_upload_attachments] Args:', JSON.stringify(args, null, 2));
      try {
        const params = JiraUploadAttachmentRequestSchema.parse(args);
        const { issueKey, filename, content, contentType } = params;

        // Process the file based on content type
        let fileData;
        if (content.startsWith('http')) {
          // URL
          const urlResult = await fetchFileFromUrl(content);
          if (!urlResult.success) {
            return makeMCPToolTextError(urlResult.error);
          }
          fileData = urlResult.data;
        } else {
          // Assume base64
          const base64Result = processBase64File(content, filename, contentType);
          if (!base64Result.success) {
            return makeMCPToolTextError(base64Result.error);
          }
          fileData = base64Result.data;
        }

        const result = await uploadAttachmentsToJira(issueKey, [fileData]);
        console.log('📊 [jira_upload_attachments] Jira API result:', JSON.stringify(result, null, 2));

        return handleResult(result, (attachments) => {
          const issueUrl = `${process.env.JIRA_BASE_URL}/browse/${issueKey}`;
          return makeMCPToolTextSuccess(`✅ Attachment uploaded successfully!

**Issue:** ${issueKey}
**File:** ${filename}
**URL:** ${issueUrl}

${createAttachmentSummary([fileData])}`);
        });
      } catch (error) {
        return makeMCPToolDetailedError(
          normalizeError(error),
          "Failed to upload attachment",
          [
            "Verify the issue key exists",
            "Check file size (max 10MB for Jira)",
            "Ensure file format is supported"
          ]
        );
      }
    }
  );

  // Tool 13: Get Projects
  server.registerTool(
    "jira_get_projects",
    {
      title: "Get Jira Projects",
      description: "List all accessible Jira projects",
      inputSchema: {}
    },
    async (args) => {
      console.log('🔧 [jira_get_projects] Args:', JSON.stringify(args, null, 2));
      const result = await getProjects();
      console.log('📊 [jira_get_projects] Jira API result:', JSON.stringify(result, null, 2));
      return handleResult(result, (projects) => {
        const projectsInfo = projects.map(project => ({
          key: project.key,
          name: project.name,
          projectTypeKey: project.projectTypeKey,
          url: `${process.env.JIRA_BASE_URL}/browse/${project.key}`
        }));

        return makeMCPToolJSONSuccess({
          projects: projectsInfo,
          count: projects.length
        });
      });
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

  // Tool 15: Search Users
  server.registerTool(
    "jira_search_users",
    {
      title: "Search Jira Users",
      description: "Search for Jira users by name or email",
  inputSchema: JiraSearchUsersRequestSchema.shape
    },
    async (args) => {
      console.log('🔧 [jira_search_users] Args:', JSON.stringify(args, null, 2));
      try {
        const params = JiraSearchUsersRequestSchema.parse(args);

        let result;
        if (params.emailExact) {
          result = await searchUsersByEmailExact(params.emailExact);
        } else if (params.query) {
          result = await listUsers(params.query, params.maxResults);
        } else {
          result = await listUsers(undefined, params.maxResults);
        }
        console.log('📊 [jira_search_users] Jira API result:', JSON.stringify(result, null, 2));

        return handleResult(result, (users) => {
          const usersInfo = users
            .filter(user => params.includeInactive || user.active)
            .map(user => ({
              accountId: user.accountId,
              displayName: user.displayName,
              emailAddress: user.emailAddress,
              active: user.active
            }));

          return makeMCPToolJSONSuccess({
            users: usersInfo,
            count: usersInfo.length
          });
        });
      } catch (error) {
        return makeMCPToolTextError(normalizeError(error));
      }
    }
  );

  // Additional utility tools

  // Tool 16: Get Issue Link Types
  server.registerTool(
    "jira_get_issue_link_types",
    {
      title: "Get Issue Link Types",
      description: "Get all available issue link types",
      inputSchema: {}
    },
    async (args) => {
      console.log('🔧 [jira_get_issue_link_types] Args:', JSON.stringify(args, null, 2));
      const result = await getIssueLinkTypes();
      console.log('📊 [jira_get_issue_link_types] Jira API result:', JSON.stringify(result, null, 2));
      return handleResult(result, (linkTypes) => {
        const typesInfo = linkTypes.map(type => ({
          id: type.id,
          name: type.name,
          inward: type.inward,
          outward: type.outward
        }));

        return makeMCPToolJSONSuccess({
          linkTypes: typesInfo,
          count: linkTypes.length
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
      inputSchema: {}
    },
    async (args) => {
      console.log('🔧 [jira_get_fields] Args:', JSON.stringify(args, null, 2));
      const result = await listFieldSummaries();
      console.log('📊 [jira_get_fields] Jira API result:', JSON.stringify(result, null, 2));
      return handleResult(result, (fields) => {
        return makeMCPToolJSONSuccess({
          fields,
          count: fields.length
        });
      });
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
      'jira_search_issues',
      'jira_create_issue',
      'jira_update_issue',
      'jira_get_issue',
      'jira_transition_issue',
      'jira_get_transitions',
      'jira_create_issue_link',
      'jira_delete_issue_link',
      'jira_add_comment',
      'jira_get_comments',
      'jira_upload_attachments',
      'jira_get_projects',
      'jira_get_issue_types',
      'jira_search_users',
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