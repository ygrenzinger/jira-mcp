import fetch from "node-fetch";
import FormData from "form-data";
import { z } from "zod";
import {
  JiraCredentials,
  JiraUser,
  JiraProject,
  JiraIssue,
  JiraIssueType,
  JiraTransition,
  JiraField,
  JiraProjectVersion,
  JiraComponent,
  JiraAttachment,
  JiraSearchResponse,
  JiraApiError,
  JiraAuthenticationError,
  JiraNotFoundError,
  JiraValidationError,
  Result,
  SEARCH_USERS_MAX_RESULTS
} from "./types.js";

// Environment-based authentication
export function getJiraCredentials(): Result<JiraCredentials, Error> {
  const apiToken = process.env.JIRA_API_TOKEN;
  const email = process.env.JIRA_EMAIL;
  const baseUrl = process.env.JIRA_BASE_URL;

  if (!apiToken) {
    return {
      success: false,
      error: new JiraAuthenticationError("JIRA_API_TOKEN environment variable is required")
    };
  }

  if (!email) {
    return {
      success: false,
      error: new JiraAuthenticationError("JIRA_EMAIL environment variable is required")
    };
  }

  if (!baseUrl) {
    return {
      success: false,
      error: new JiraAuthenticationError("JIRA_BASE_URL environment variable is required (e.g., https://yourcompany.atlassian.net)")
    };
  }

  return {
    success: true,
    data: { email, apiToken, baseUrl: baseUrl.replace(/\/$/, '') }
  };
}

// Authentication wrapper
export async function withAuth<T>(
  operation: (credentials: JiraCredentials) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  const credentialsResult = getJiraCredentials();
  if (!credentialsResult.success) {
    return credentialsResult;
  }

  try {
    return await operation(credentialsResult.data);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

// Generic API call helper
async function jiraApiCall<T>(
  credentials: JiraCredentials,
  endpoint: string,
  options: {
    method?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {}
): Promise<Result<T, Error>> {
  const { method = "GET", body, headers = {} } = options;

  const auth = Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64');

  const defaultHeaders = {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...headers
  };

  const url = `${credentials.baseUrl}/rest/api/3${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: defaultHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

      try {
        const errorData = JSON.parse(errorText);
        if (errorData.errorMessages?.length > 0) {
          errorMessage = errorData.errorMessages.join(', ');
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch {
        // Use default error message if JSON parsing fails
      }

      if (response.status === 401) {
        return {
          success: false,
          error: new JiraAuthenticationError(`Authentication failed: ${errorMessage}`)
        };
      } else if (response.status === 404) {
        return {
          success: false,
          error: new JiraNotFoundError("Resource", endpoint)
        };
      } else {
        return {
          success: false,
          error: new JiraApiError(errorMessage, response.status, errorText)
        };
      }
    }

    const text = await response.text();
    if (!text) {
      return { success: true, data: null as T };
    }

    const data = JSON.parse(text);
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

// Connection info
export async function getConnectionInfo(): Promise<Result<any, Error>> {
  return withAuth(async (credentials) => {
    const serverInfoResult = await jiraApiCall(credentials, "/serverInfo");
    if (!serverInfoResult.success) {
      return serverInfoResult;
    }

    const myselfResult = await jiraApiCall(credentials, "/myself");
    if (!myselfResult.success) {
      return myselfResult;
    }

    return {
      success: true,
      data: {
        serverInfo: serverInfoResult.data,
        currentUser: myselfResult.data,
        baseUrl: credentials.baseUrl,
        connected: true
      }
    };
  });
}

// Project operations
export async function getProjects(): Promise<Result<JiraProject[], Error>> {
  return withAuth(async (credentials) => {
    return jiraApiCall<JiraProject[]>(credentials, "/project");
  });
}

export async function getProject(projectKey: string): Promise<Result<JiraProject, Error>> {
  return withAuth(async (credentials) => {
    return jiraApiCall<JiraProject>(credentials, `/project/${projectKey}`);
  });
}

export async function getProjectVersions(projectKey: string): Promise<Result<JiraProjectVersion[], Error>> {
  return withAuth(async (credentials) => {
    return jiraApiCall<JiraProjectVersion[]>(credentials, `/project/${projectKey}/version`);
  });
}

// Issue type operations
export async function getIssueTypes(): Promise<Result<JiraIssueType[], Error>> {
  return withAuth(async (credentials) => {
    return jiraApiCall<JiraIssueType[]>(credentials, "/issuetype");
  });
}

// Field operations
export async function getIssueFields(): Promise<Result<JiraField[], Error>> {
  return withAuth(async (credentials) => {
    return jiraApiCall<JiraField[]>(credentials, "/field");
  });
}

export async function listFieldSummaries(): Promise<Result<any[], Error>> {
  return withAuth(async (credentials) => {
    const result = await jiraApiCall<any>(credentials, "/field");
    if (!result.success) return result;

    const summaries = result.data.map((field: any) => ({
      id: field.id,
      name: field.name,
      custom: field.custom,
      schema: field.schema
    }));

    return { success: true, data: summaries };
  });
}

// User operations
export async function listUsers(query?: string, maxResults = 10): Promise<Result<JiraUser[], Error>> {
  return withAuth(async (credentials) => {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    params.set('maxResults', Math.min(maxResults, SEARCH_USERS_MAX_RESULTS).toString());

    const endpoint = `/user/search?${params.toString()}`;
    return jiraApiCall<JiraUser[]>(credentials, endpoint);
  });
}

export async function searchUsersByEmailExact(email: string): Promise<Result<JiraUser[], Error>> {
  return withAuth(async (credentials) => {
    const endpoint = `/user/search?query=${encodeURIComponent(email)}`;
    const result = await jiraApiCall<JiraUser[]>(credentials, endpoint);

    if (!result.success) return result;

    // Filter for exact email match
    const exactMatches = result.data.filter(user =>
      user.emailAddress?.toLowerCase() === email.toLowerCase()
    );

    return { success: true, data: exactMatches };
  });
}

// Issue operations
export async function searchIssues(params: {
  projectKey?: string;
  assignee?: string;
  reporter?: string;
  status?: string;
  issueType?: string;
  priority?: string;
  maxResults?: number;
  startAt?: number;
  expand?: string[];
}): Promise<Result<JiraSearchResponse, Error>> {
  return withAuth(async (credentials) => {
    const jqlParts: string[] = [];

    if (params.projectKey) jqlParts.push(`project = "${params.projectKey}"`);
    if (params.assignee) jqlParts.push(`assignee = "${params.assignee}"`);
    if (params.reporter) jqlParts.push(`reporter = "${params.reporter}"`);
    if (params.status) jqlParts.push(`status = "${params.status}"`);
    if (params.issueType) jqlParts.push(`issuetype = "${params.issueType}"`);
    if (params.priority) jqlParts.push(`priority = "${params.priority}"`);

    const jql = jqlParts.length > 0 ? jqlParts.join(' AND ') : 'order by updated DESC';

    return searchJiraIssuesUsingJql(jql, {
      maxResults: params.maxResults,
      startAt: params.startAt,
      expand: params.expand,
      fields: ['summary', 'status', 'assignee', 'priority', 'created', 'updated']
    });
  });
}

export async function searchJiraIssuesUsingJql(
  jql: string,
  options: {
    maxResults?: number;
    startAt?: number;
    expand?: string[];
    fields?: string[];
  } = {}
): Promise<Result<JiraSearchResponse, Error>> {
  return withAuth(async (credentials) => {
    // Use the new /search/jql endpoint as per Jira API migration guidance
    const params = new URLSearchParams();
    params.set('jql', jql);
    params.set('maxResults', (options.maxResults || 50).toString());

    if (options.startAt !== undefined) {
      params.set('startAt', options.startAt.toString());
    }

    if (options.expand && options.expand.length > 0) {
      params.set('expand', options.expand.join(','));
    }

    // Include essential fields for issue display
    const defaultFields = ['summary', 'status', 'assignee', 'priority', 'created', 'updated'];
    const fields = options.fields || defaultFields;
    if (fields.length > 0) {
      params.set('fields', fields.join(','));
    }

    return jiraApiCall<JiraSearchResponse>(credentials, `/search/jql?${params.toString()}`, {
      method: "GET"
    });
  });
}

export async function getIssue(issueKey: string): Promise<Result<JiraIssue, Error>> {
  return withAuth(async (credentials) => {
    const expand = 'names,schema,operations,editmeta,changelog,transitions';
    return jiraApiCall<JiraIssue>(credentials, `/issue/${issueKey}?expand=${expand}`);
  });
}

export async function createIssue(issueData: {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  labels?: string[];
  components?: string[];
  fixVersions?: string[];
  customFields?: Record<string, any>;
  parentKey?: string;
}): Promise<Result<JiraIssue, Error>> {
  return withAuth(async (credentials) => {
    const fields: any = {
      project: { key: issueData.projectKey },
      issuetype: { name: issueData.issueType },
      summary: issueData.summary,
    };

    if (issueData.description) {
      fields.description = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: issueData.description
              }
            ]
          }
        ]
      };
    }

    if (issueData.priority) {
      fields.priority = { name: issueData.priority };
    }

    if (issueData.assignee) {
      fields.assignee = { accountId: issueData.assignee };
    }

    if (issueData.reporter) {
      fields.reporter = { accountId: issueData.reporter };
    }

    if (issueData.labels?.length) {
      fields.labels = issueData.labels;
    }

    if (issueData.components?.length) {
      fields.components = issueData.components.map(name => ({ name }));
    }

    if (issueData.fixVersions?.length) {
      fields.fixVersions = issueData.fixVersions.map(name => ({ name }));
    }

    if (issueData.parentKey) {
      fields.parent = { key: issueData.parentKey };
    }

    // Add custom fields
    if (issueData.customFields) {
      Object.assign(fields, issueData.customFields);
    }

    const body = { fields };

    return jiraApiCall<JiraIssue>(credentials, "/issue", {
      method: "POST",
      body
    });
  });
}

export async function updateIssue(issueKey: string, updates: {
  summary?: string;
  description?: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  components?: string[];
  fixVersions?: string[];
  customFields?: Record<string, any>;
}): Promise<Result<void, Error>> {
  return withAuth(async (credentials) => {
    const fields: any = {};

    if (updates.summary) {
      fields.summary = updates.summary;
    }

    if (updates.description) {
      fields.description = {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: updates.description
              }
            ]
          }
        ]
      };
    }

    if (updates.priority) {
      fields.priority = { name: updates.priority };
    }

    if (updates.assignee) {
      fields.assignee = { accountId: updates.assignee };
    }

    if (updates.labels) {
      fields.labels = updates.labels;
    }

    if (updates.components) {
      fields.components = updates.components.map(name => ({ name }));
    }

    if (updates.fixVersions) {
      fields.fixVersions = updates.fixVersions.map(name => ({ name }));
    }

    // Add custom fields
    if (updates.customFields) {
      Object.assign(fields, updates.customFields);
    }

    const body = { fields };

    return jiraApiCall<void>(credentials, `/issue/${issueKey}`, {
      method: "PUT",
      body
    });
  });
}

// Transition operations
export async function getTransitions(issueKey: string): Promise<Result<JiraTransition[], Error>> {
  return withAuth(async (credentials) => {
    const result = await jiraApiCall<{ transitions: JiraTransition[] }>(
      credentials,
      `/issue/${issueKey}/transitions`
    );

    if (!result.success) return result;

    return { success: true, data: result.data.transitions };
  });
}

export async function transitionIssue(
  issueKey: string,
  transitionId: string,
  comment?: string,
  fields?: Record<string, any>
): Promise<Result<void, Error>> {
  return withAuth(async (credentials) => {
    const body: any = {
      transition: { id: transitionId }
    };

    if (fields) {
      body.fields = fields;
    }

    if (comment) {
      body.update = {
        comment: [
          {
            add: {
              body: {
                type: "doc",
                version: 1,
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: comment
                      }
                    ]
                  }
                ]
              }
            }
          }
        ]
      };
    }

    return jiraApiCall<void>(credentials, `/issue/${issueKey}/transitions`, {
      method: "POST",
      body
    });
  });
}

// Comment operations
export async function createComment(
  issueKey: string,
  body: string,
  visibility?: { type: "group" | "role"; value: string }
): Promise<Result<any, Error>> {
  return withAuth(async (credentials) => {
    const commentBody: any = {
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: body
              }
            ]
          }
        ]
      }
    };

    if (visibility) {
      commentBody.visibility = visibility;
    }

    return jiraApiCall<any>(credentials, `/issue/${issueKey}/comment`, {
      method: "POST",
      body: commentBody
    });
  });
}

// Link operations
export async function getIssueLinkTypes(): Promise<Result<any[], Error>> {
  return withAuth(async (credentials) => {
    const result = await jiraApiCall<{ issueLinkTypes: any[] }>(credentials, "/issueLinkType");
    if (!result.success) return result;

    return { success: true, data: result.data.issueLinkTypes };
  });
}

export async function createIssueLink(
  inwardIssueKey: string,
  outwardIssueKey: string,
  linkType: string,
  comment?: string
): Promise<Result<void, Error>> {
  return withAuth(async (credentials) => {
    const body: any = {
      type: { name: linkType },
      inwardIssue: { key: inwardIssueKey },
      outwardIssue: { key: outwardIssueKey }
    };

    if (comment) {
      body.comment = {
        body: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: comment
                }
              ]
            }
          ]
        }
      };
    }

    return jiraApiCall<void>(credentials, "/issueLink", {
      method: "POST",
      body
    });
  });
}

export async function deleteIssueLink(linkId: string): Promise<Result<void, Error>> {
  return withAuth(async (credentials) => {
    return jiraApiCall<void>(credentials, `/issueLink/${linkId}`, {
      method: "DELETE"
    });
  });
}

// Attachment operations
export async function getIssueAttachments(issueKey: string): Promise<Result<JiraAttachment[], Error>> {
  return withAuth(async (credentials) => {
    const result = await jiraApiCall<JiraIssue>(credentials, `/issue/${issueKey}?fields=attachment`);
    if (!result.success) return result;

    return { success: true, data: result.data.fields.attachment || [] };
  });
}

export async function uploadAttachmentsToJira(
  issueKey: string,
  files: Array<{ filename: string; content: Buffer; contentType?: string }>
): Promise<Result<JiraAttachment[], Error>> {
  return withAuth(async (credentials): Promise<Result<JiraAttachment[], Error>> => {
    const form = new FormData();

    files.forEach(file => {
      form.append('file', file.content, {
        filename: file.filename,
        contentType: file.contentType || 'application/octet-stream'
      });
    });

    const auth = Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString('base64');

    const url = `${credentials.baseUrl}/rest/api/3/issue/${issueKey}/attachments`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'X-Atlassian-Token': 'no-check',
          ...form.getHeaders()
        },
        body: form
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: new JiraApiError(`Upload failed: ${response.statusText}`, response.status, errorText)
        };
      }

      const data = await response.json() as JiraAttachment[];
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  });
}

// Error handling utility
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string') {
    return new Error(error);
  }

  return new Error('Unknown error occurred');
}