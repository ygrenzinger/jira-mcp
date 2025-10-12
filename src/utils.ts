import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Result, TransformedCommentsResponse, ADFDocumentSchema } from "./types.js";
import { z } from "zod";

// MCP server factory function
export function makeInternalMCPServer(options: {
  name: string;
  version: string;
}): McpServer {
  return new McpServer({
    name: options.name,
    version: options.version
  });
}

// ADF type inference
type ADFDocument = z.infer<typeof ADFDocumentSchema>;

/**
 * Extracts plain text from ADF (Atlassian Document Format) content
 * Handles various node types including paragraphs, text, hardBreaks, and nested content
 * Ignores media elements and preserves text flow
 */
export function extractTextFromADF(adfContent: any): string {
  if (!adfContent) return '';

  // If it's already a string, return it
  if (typeof adfContent === 'string') return adfContent;

  // Handle ADF document structure
  if (adfContent.type === 'doc' && Array.isArray(adfContent.content)) {
    return extractTextFromADFNodes(adfContent.content);
  }

  // Handle if content is passed directly as an array
  if (Array.isArray(adfContent)) {
    return extractTextFromADFNodes(adfContent);
  }

  return '';
}

/**
 * Recursively extracts text from ADF nodes
 */
function extractTextFromADFNodes(nodes: any[]): string {
  const textParts: string[] = [];

  for (const node of nodes) {
    if (!node) continue;

    switch (node.type) {
      case 'paragraph':
      case 'heading':
      case 'listItem':
        if (Array.isArray(node.content)) {
          const text = extractTextFromADFNodes(node.content);
          if (text) textParts.push(text);
        }
        break;

      case 'text':
        if (node.text) {
          textParts.push(node.text);
        }
        break;

      case 'hardBreak':
        textParts.push(' ');
        break;

      case 'bulletList':
      case 'orderedList':
      case 'blockquote':
        if (Array.isArray(node.content)) {
          const text = extractTextFromADFNodes(node.content);
          if (text) textParts.push(text);
        }
        break;

      case 'mediaSingle':
      case 'media':
      case 'emoji':
        // Skip media elements
        break;

      default:
        // For unknown types, try to extract content if it exists
        if (Array.isArray(node.content)) {
          const text = extractTextFromADFNodes(node.content);
          if (text) textParts.push(text);
        }
    }
  }

  // Join text parts with space and clean up multiple spaces
  return textParts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Cleans a field that contains a "name" property by keeping only the name
 * Special case for project: also keeps the "key" property
 */
function cleanFieldWithName(field: any, fieldName?: string): any {
  if (!field || typeof field !== 'object') return field;

  // Special handling for project field - keep both name and key
  if (fieldName === 'project' && 'name' in field) {
    const cleaned: any = { name: field.name };
    if (field.key) cleaned.key = field.key;
    return cleaned;
  }

  // For all other fields with "name", keep only name
  if ('name' in field) {
    return { name: field.name };
  }

  return field;
}

/**
 * Cleans a field that contains a "value" property by keeping only value and id
 * Removes nested child objects and other metadata
 */
function cleanFieldWithValue(field: any): any {
  if (!field || typeof field !== 'object') return field;

  if ('value' in field) {
    const cleaned: any = { value: field.value };
    if (field.id) cleaned.id = field.id;
    return cleaned;
  }

  return field;
}

/**
 * Generically cleans a field based on its structure
 * Applies appropriate cleaning based on field content
 */
function cleanFieldGeneric(field: any, fieldName?: string): any {
  if (!field || typeof field !== 'object') return field;

  // Handle arrays recursively
  if (Array.isArray(field)) {
    return field.map(item => cleanFieldGeneric(item, fieldName));
  }

  // Check if it's a user field (has emailAddress or displayName)
  if ('emailAddress' in field || 'displayName' in field) {
    return {
      emailAddress: field.emailAddress || '',
      displayName: field.displayName || ''
    };
  }

  // Check if it's an ADF document
  if ('type' in field && field.type === 'doc') {
    return extractTextFromADF(field);
  }

  // Check for "name" property
  if ('name' in field) {
    return cleanFieldWithName(field, fieldName);
  }

  // Check for "value" property
  if ('value' in field) {
    return cleanFieldWithValue(field);
  }

  return field;
}

/**
 * Cleans a single Jira issue by converting ADF fields to plain text
 * and simplifying user fields to only include emailAddress and displayName
 */
export function cleanJiraIssue(issue: any): any {
  if (!issue) return issue;

  const cleanedIssue = { ...issue };

  // Clean fields if they exist
  if (cleanedIssue.fields) {
    // Process all fields generically
    for (const [fieldName, value] of Object.entries(cleanedIssue.fields)) {
      if (value === null || value === undefined) {
        continue; // Keep null/undefined as-is
      }

      // Apply generic cleaning to all fields
      cleanedIssue.fields[fieldName] = cleanFieldGeneric(value, fieldName);
    }
  }

  // Clean renderedFields if they exist
  if (cleanedIssue.renderedFields) {
    if (cleanedIssue.renderedFields.description) {
      // renderedFields are usually HTML, but if it's ADF, clean it
      if (typeof cleanedIssue.renderedFields.description === 'object') {
        cleanedIssue.renderedFields.description = extractTextFromADF(cleanedIssue.renderedFields.description);
      }
    }
  }

  return cleanedIssue;
}

/**
 * Cleans Jira search response by converting all ADF fields to plain text
 */
export function cleanJiraSearchResponse(searchResponse: any): any {
  if (!searchResponse) return searchResponse;

  const cleanedResponse = { ...searchResponse };

  // Clean issues array
  if (Array.isArray(cleanedResponse.issues)) {
    cleanedResponse.issues = cleanedResponse.issues.map(cleanJiraIssue);
  }

  return cleanedResponse;
}

/**
 * Converts a plain text string or ADF document to ADF format
 * If input is already an ADF document, returns it as-is
 * If input is a string, wraps it in a basic paragraph structure
 */
export function convertToADF(input: string | ADFDocument): ADFDocument {
  // If already ADF document, validate and return
  if (typeof input === "object" && input !== null) {
    const result = ADFDocumentSchema.safeParse(input);
    if (result.success) {
      return result.data;
    }
  }

  // Convert plain string to ADF
  const text = typeof input === "string" ? input : String(input);
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: text
          }
        ]
      }
    ]
  };
}

// Success response formatter for MCP tools
export function makeMCPToolJSONSuccess(data: any) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

// Text success response formatter for MCP tools
export function makeMCPToolTextSuccess(text: string) {
  return {
    content: [
      {
        type: "text",
        text
      }
    ]
  };
}

// Error response formatter for MCP tools
export function makeMCPToolTextError(error: Error | string) {
  const errorMessage = error instanceof Error ? error.message : error;

  return {
    content: [
      {
        type: "text",
        text: `Error: ${errorMessage}`
      }
    ],
    isError: true
  };
}

// Enhanced error formatter with details
export function makeMCPToolDetailedError(
  error: Error | string,
  context?: string,
  suggestions?: string[]
) {
  const errorMessage = error instanceof Error ? error.message : error;

  let fullMessage = `Error: ${errorMessage}`;

  if (context) {
    fullMessage += `\n\nContext: ${context}`;
  }

  if (suggestions && suggestions.length > 0) {
    fullMessage += `\n\nSuggestions:\n${suggestions.map(s => `• ${s}`).join('\n')}`;
  }

  return {
    content: [
      {
        type: "text",
        text: fullMessage
      }
    ],
    isError: true
  };
}

// Result handler utility
export function handleResult<T>(
  result: Result<T, Error>,
  successFormatter?: (data: T) => any,
  errorFormatter?: (error: Error) => any
) {
  if (result.success) {
    if (successFormatter) {
      return successFormatter(result.data);
    }
    return makeMCPToolJSONSuccess(result.data);
  } else {
    if (errorFormatter) {
      return errorFormatter(result.error);
    }
    return makeMCPToolTextError(result.error);
  }
}

// Array result handler for multiple operations
export function handleResults<T>(
  results: Result<T, Error>[],
  successFormatter?: (data: T[]) => any,
  errorFormatter?: (errors: Error[]) => any
) {
  const successes: T[] = [];
  const errors: Error[] = [];

  results.forEach(result => {
    if (result.success) {
      successes.push(result.data);
    } else {
      errors.push(result.error);
    }
  });

  if (errors.length === 0) {
    if (successFormatter) {
      return successFormatter(successes);
    }
    return makeMCPToolJSONSuccess(successes);
  } else if (successes.length === 0) {
    if (errorFormatter) {
      return errorFormatter(errors);
    }
    return makeMCPToolTextError(`Multiple errors occurred: ${errors.map(e => e.message).join(', ')}`);
  } else {
    // Mixed results
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            successes,
            errors: errors.map(e => e.message)
          }, null, 2)
        }
      ]
    };
  }
}

// Normalize error utility
export function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'string') {
    return new Error(error);
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return new Error(String(error.message));
  }

  return new Error('Unknown error occurred');
}

// Pagination helper (offset-based for legacy endpoints)
export function createPaginationInfo(
  startAt: number,
  maxResults: number,
  total: number
): {
  startAt: number;
  maxResults: number;
  total: number;
  hasMore: boolean;
  nextStartAt?: number;
} {
  const hasMore = startAt + maxResults < total;
  const nextStartAt = hasMore ? startAt + maxResults : undefined;

  return {
    startAt,
    maxResults,
    total,
    hasMore,
    nextStartAt
  };
}

// Token-based pagination helper (for new /rest/api/3/search/jql endpoint)
export function createTokenPaginationInfo(
  maxResults: number,
  isLast: boolean,
  nextPageToken?: string
): {
  maxResults: number;
  hasMore: boolean;
  isLast: boolean;
  nextPageToken?: string;
} {
  return {
    maxResults,
    hasMore: !isLast,
    isLast,
    nextPageToken
  };
}

// Safe JSON parse utility
export function safeJsonParse<T>(jsonString: string, defaultValue: T): T {
  try {
    return JSON.parse(jsonString) as T;
  } catch {
    return defaultValue;
  }
}

// Truncate text utility for display
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - 3) + '...';
}

// Format date utility
export function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleString();
  } catch {
    return dateString;
  }
}

// Validate email utility
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Escape JQL string utility
export function escapeJqlString(value: string): string {
  // Escape quotes and special characters for JQL
  return value.replace(/(['"\\])/g, '\\$1');
}

// Build JQL query helper
export function buildJqlQuery(filters: Record<string, string | string[]>): string {
  const conditions: string[] = [];

  Object.entries(filters).forEach(([field, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        const escapedValues = value.map(v => `"${escapeJqlString(v)}"`).join(', ');
        conditions.push(`${field} IN (${escapedValues})`);
      }
    } else if (value) {
      conditions.push(`${field} = "${escapeJqlString(value)}"`);
    }
  });

  return conditions.length > 0 ? conditions.join(' AND ') : '';
}

// Retry helper for API calls
export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = normalizeError(error);

      if (attempt === maxRetries) {
        throw lastError;
      }

      // Exponential backoff
      const delay = delayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

// Cache utility for simple in-memory caching
class SimpleCache<T> {
  private cache = new Map<string, { data: T; expiry: number }>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs: number = 5 * 60 * 1000) { // 5 minutes default
    this.defaultTtlMs = defaultTtlMs;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const expiry = Date.now() + (ttlMs || this.defaultTtlMs);
    this.cache.set(key, { data: value, expiry });
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  clear(): void {
    this.cache.clear();
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

// Export cache instance for use across the application
export const jiraCache = new SimpleCache();

// Cleanup interval for cache (run every 10 minutes)
setInterval(() => {
  jiraCache.cleanup();
}, 10 * 60 * 1000);

// Comment transformation utility
export function transformJiraComments(comments: any[]): TransformedCommentsResponse {
  const transformedComments = comments.map(comment => ({
    author: {
      displayName: comment.author?.displayName || '',
      emailAddress: comment.author?.emailAddress || ''
    },
    body: comment.renderedBody || '',
    created: comment.created ? formatDate(comment.created) : 'Unknown',
    updated: comment.updated ? formatDate(comment.updated) : 'Unknown'
  }));

  return {
    success: true,
    data: transformedComments
  };
}