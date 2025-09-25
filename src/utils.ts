import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Result } from "./types.js";

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

// Pagination helper
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