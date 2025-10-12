import { z } from "zod";

// Constants
export const SEARCH_USERS_MAX_RESULTS = 50;
export const SEARCH_ISSUES_MAX_RESULTS = 20;

// Search filter constants
export const SUPPORTED_OPERATORS = ["=", "<", ">", "<=", ">=", "!="] as const;
export type SupportedOperator = (typeof SUPPORTED_OPERATORS)[number];

export const SORT_DIRECTIONS = ["ASC", "DESC"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

// Field mappings for JQL conversion
export const FIELD_MAPPINGS = {
  assignee: { jqlField: "assignee" },
  created: { jqlField: "created", supportsOperators: true },
  dueDate: { jqlField: "dueDate", supportsOperators: true },
  fixVersion: { jqlField: "fixVersion" },
  issueType: { jqlField: "issueType" },
  labels: { jqlField: "labels" },
  priority: { jqlField: "priority" },
  parentIssueKey: { jqlField: "parent" },
  project: { jqlField: "project" },
  reporter: { jqlField: "reporter" },
  resolved: { jqlField: "resolved", supportsOperators: true },
  status: { jqlField: "status" },
  summary: { jqlField: "summary", supportsFuzzy: true },
  customField: {
    jqlField: "customField",
    isCustomField: true,
    supportsFuzzy: true,
  },
} as const;

export const SEARCH_FILTER_FIELDS = Object.keys(
  FIELD_MAPPINGS
) as (keyof typeof FIELD_MAPPINGS)[];

export type SearchFilterField = (typeof SEARCH_FILTER_FIELDS)[number];

export interface SearchFilter {
  field: string;
  value: string;
  fuzzy?: boolean;
  customFieldName?: string;
  operator?: SupportedOperator;
}

// Basic Jira types
export interface JiraCredentials {
  email: string;
  apiToken: string;
  baseUrl: string;
}

export interface JiraUser {
  accountId: string;
  emailAddress: string;
  displayName: string;
  active: boolean;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  subtask: boolean;
}

export interface JiraIssue {
  id: string;
  key: string;
  renderedFields?: {
    description?: string;
    [key: string]: any;
  };
  fields: {
    summary: string;
    description?: any;
    status: {
      id: string;
      name: string;
      statusCategory: {
        id: number;
        name: string;
        colorName: string;
      };
    };
    assignee?: JiraUser;
    reporter: JiraUser;
    priority: {
      id: string;
      name: string;
    };
    issuetype: JiraIssueType;
    project: JiraProject;
    created: string;
    updated: string;
    [key: string]: any;
  };
}

export interface JiraTransition {
  id: string;
  name: string;
  to: {
    id: string;
    name: string;
  };
}

export interface JiraIssueLink {
  id: string;
  type: {
    id: string;
    name: string;
    inward: string;
    outward: string;
  };
  inwardIssue?: JiraIssue;
  outwardIssue?: JiraIssue;
}

// Atlassian Document Format (ADF) Schema
export const ADFDocumentSchema = z.object({
  version: z.number().default(1),
  type: z.literal("doc"),
  content: z.array(z.object({
    type: z.string(),
    content: z.array(z.any()).optional(),
    text: z.string().optional(),
    marks: z.array(z.any()).optional(),
    attrs: z.record(z.any()).optional(),
  })),
});

// Search filter schemas
// Get regular field names (excluding customField)
const regularFieldNames = SEARCH_FILTER_FIELDS.filter(
  (field) => field !== "customField"
) as [string, ...string[]];

const baseFilterSchema = z.object({
  value: z.string().describe("The value to search for"),
  operator: z
    .enum(SUPPORTED_OPERATORS)
    .optional()
    .describe(
      `Operator for comparison. Supported operators: ${SUPPORTED_OPERATORS.join(", ")}. Only supported for date fields like 'dueDate', 'created', 'resolved'. For dates, use format '2023-07-03' or relative format like '-25d', '7d', '2w', '1M', etc.`
    ),
  fuzzy: z
    .boolean()
    .optional()
    .describe(
      "Use fuzzy search (~) for partial/similar matches instead of exact match (=). Only supported for 'summary' field. Use fuzzy when: searching for partial text, handling typos, finding related terms. Use exact when: looking for specific titles, precise matching needed."
    ),
});

const customFieldFilterSchema = baseFilterSchema.extend({
  field: z.literal("customField"),
  customFieldName: z
    .string()
    .describe(
      "The name of the custom field to search (e.g., 'Story Points', 'Epic Link')."
    ),
});

const regularFieldFilterSchema = baseFilterSchema.extend({
  field: z
    .enum(regularFieldNames)
    .describe(
      `The field to filter by. Must be one of: ${regularFieldNames.join(", ")}.`
    ),
});

export const JiraSearchFilterSchema = z.discriminatedUnion("field", [
  customFieldFilterSchema,
  regularFieldFilterSchema,
]);

// Sort schema using existing FIELD_MAPPINGS
export const JiraSortSchema = z.object({
  field: z
    .enum(SEARCH_FILTER_FIELDS as [SearchFilterField, ...SearchFilterField[]])
    .describe(
      `The field to sort by. Must be one of: ${SEARCH_FILTER_FIELDS.join(", ")}.`
    ),
  direction: z
    .enum(SORT_DIRECTIONS)
    .describe(`Sort direction. Must be one of: ${SORT_DIRECTIONS.join(", ")}.`),
});

// Issue creation schema
export const JiraCreateIssueRequestSchema = z.object({
  projectKey: z.string().describe("The project key where the issue will be created"),
  issueType: z.string().describe("The type of issue to create (e.g., 'Bug', 'Task', 'Story')"),
  summary: z.string().describe("Brief description of the issue"),
  description: z.union([z.string(), ADFDocumentSchema]).optional().describe("Detailed description - either plain text string or ADF document object for rich formatting"),
  priority: z.string().optional().describe("Priority level (e.g., 'High', 'Medium', 'Low')"),
  assignee: z.string().optional().describe("Account ID of the assignee"),
  reporter: z.string().optional().describe("Account ID of the reporter"),
  labels: z.array(z.string()).optional().describe("List of labels to add to the issue"),
  components: z.array(z.string()).optional().describe("List of component names"),
  fixVersions: z.array(z.string()).optional().describe("List of fix version names"),
  customFields: z.record(z.any()).optional().describe("Custom field values as key-value pairs"),
  parentKey: z.string().optional().describe("Parent issue key for subtasks"),
});

// Issue update schema
export const JiraUpdateIssueRequestSchema = z.object({
  issueKey: z.string().describe("The issue key to update"),
  summary: z.string().optional().describe("New summary for the issue"),
  description: z.union([z.string(), ADFDocumentSchema]).optional().describe("New description - either plain text string or ADF document object for rich formatting"),
  priority: z.string().optional().describe("New priority level"),
  assignee: z.string().optional().describe("New assignee account ID"),
  labels: z.array(z.string()).optional().describe("New labels list"),
  components: z.array(z.string()).optional().describe("New components list"),
  fixVersions: z.array(z.string()).optional().describe("New fix versions list"),
  customFields: z.record(z.any()).optional().describe("Custom field updates"),
});

// Issue link creation schema
export const JiraCreateIssueLinkRequestSchema = z.object({
  inwardIssueKey: z.string().describe("The key of the inward issue"),
  outwardIssueKey: z.string().describe("The key of the outward issue"),
  linkType: z.string().describe("The name of the link type (e.g., 'Blocks', 'Relates')"),
  comment: z.string().optional().describe("Optional comment for the link"),
});

// Search issues schema
export const JiraSearchIssuesRequestSchema = z.object({
  projectKey: z.string().optional().describe("Filter by project key"),
  assignee: z.string().optional().describe("Filter by assignee account ID"),
  reporter: z.string().optional().describe("Filter by reporter account ID"),
  status: z.string().optional().describe("Filter by status name"),
  issueType: z.string().optional().describe("Filter by issue type"),
  priority: z.string().optional().describe("Filter by priority"),
  jql: z.string().optional().describe("Custom JQL query"),
  maxResults: z.number().min(1).max(500).default(50).describe("Maximum number of results"),
  startAt: z.number().min(0).default(0).describe("Starting index for pagination"),
  filters: z.array(JiraSearchFilterSchema).optional().describe("Advanced filters"),
  sort: z.array(JiraSortSchema).optional().describe("Sort criteria"),
  fields: z.array(z.string()).optional().describe("Fields specifically asked by the user to include in the response"),
  expand: z.array(z.string()).optional().describe("expand options, named renderedFields, names, schema,operations, editmeta, changelog, versionedRepresentations, it must be explicitly asked for by the user"),
});

// Transition issue schema
export const JiraTransitionIssueRequestSchema = z.object({
  issueKey: z.string().describe("The issue key to transition"),
  transitionId: z.string().describe("The ID of the transition to execute"),
  comment: z.string().optional().describe("Optional comment to add during transition"),
  fields: z.record(z.any()).optional().describe("Field updates during transition"),
});

// Add comment schema
export const JiraAddCommentRequestSchema = z.object({
  issueKey: z.string().describe("The issue key to comment on"),
  body: z.union([z.string(), ADFDocumentSchema]).describe("The comment content - either plain text string or ADF document object for rich formatting"),
  visibility: z.object({
    type: z.enum(["group", "role"]),
    value: z.string(),
  }).optional().describe("Comment visibility restrictions"),
});

// Upload attachment schema
export const JiraUploadAttachmentRequestSchema = z.object({
  issueKey: z.string().describe("The issue key to attach files to"),
  filename: z.string().describe("Name of the file to upload"),
  content: z.string().describe("Base64 encoded file content or URL"),
  contentType: z.string().optional().describe("MIME type of the file"),
});

// User search schema
export const JiraSearchUsersRequestSchema = z.object({
  query: z.string().optional().describe("Search query for user display name or email"),
  emailExact: z.string().optional().describe("Exact email address to search for"),
  accountId: z.string().optional().describe("Specific account ID to get"),
  maxResults: z.number().min(1).max(SEARCH_USERS_MAX_RESULTS).default(10).describe("Maximum results"),
  includeInactive: z.boolean().default(false).describe("Include inactive users"),
});

// Get fields schema with pagination
export const JiraGetFieldsRequestSchema = z.object({
  maxResults: z.number().min(1).max(200).default(50).describe("Maximum number of fields to return"),
  startAt: z.number().min(0).default(0).describe("Starting index for pagination"),
  fieldTypes: z.array(z.enum(["system", "custom"])).optional().describe("Filter by field types"),
  searchTerm: z.string().optional().describe("Search term to filter fields by name or ID"),
});

// Result type for error handling
export type Result<T, E = Error> = {
  success: true;
  data: T;
} | {
  success: false;
  error: E;
};

// MCP Tool response types
export interface MCPToolResponse {
  content: Array<{
    type: "text";
    text: string;
  } | {
    type: "image";
    data: string;
    mimeType: string;
  } | {
    type: "resource";
    resource: {
      uri: string;
      text?: string;
      mimeType?: string;
    } | {
      uri: string;
      blob: string;
      mimeType?: string;
    };
  }>;
  isError?: boolean;
}

// File attachment types
export interface ConversationAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  url?: string;
}

// Jira API response types
export interface JiraSearchResponse {
  expand: string;
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

// New token-based pagination response for /rest/api/3/search/jql
export interface JiraSearchResponseWithToken {
  expand?: string;
  maxResults: number;
  issues: JiraIssue[];
  nextPageToken?: string; // Optional - not present on last page
  isLast: boolean;
  // Note: total is not available with token-based pagination
}

export interface JiraField {
  id: string;
  name: string;
  custom: boolean;
  orderable: boolean;
  navigable: boolean;
  searchable: boolean;
  clauseNames: string[];
  schema?: {
    type: string;
    system?: string;
    custom?: string;
    customId?: number;
  };
}

export interface JiraProjectVersion {
  id: string;
  name: string;
  description?: string;
  archived: boolean;
  released: boolean;
  releaseDate?: string;
}

export interface JiraComponent {
  id: string;
  name: string;
  description?: string;
  lead?: JiraUser;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  author: JiraUser;
  created: string;
  size: number;
  mimeType: string;
  content: string;
  thumbnail?: string;
}

// Error types
export class JiraApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: any
  ) {
    super(message);
    this.name = "JiraApiError";
  }
}

export class JiraAuthenticationError extends Error {
  constructor(message: string = "Jira authentication failed") {
    super(message);
    this.name = "JiraAuthenticationError";
  }
}

export class JiraNotFoundError extends Error {
  constructor(resource: string, identifier: string) {
    super(`${resource} not found: ${identifier}`);
    this.name = "JiraNotFoundError";
  }
}

export class JiraValidationError extends Error {
  constructor(message: string, public details?: any) {
    super(message);
    this.name = "JiraValidationError";
  }
}

// Transformed comment types
export interface TransformedJiraComment {
  author: {
    displayName: string;
    emailAddress: string;
  };
  body: string; // from renderedBody
}

export interface TransformedCommentsResponse {
  success: true;
  data: TransformedJiraComment[];
}