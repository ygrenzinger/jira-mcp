#!/usr/bin/env node

/**
 * CLI tool to get info about a specific Jira issue
 * Usage: node dist/cli-get-issue.js ISSUE-123 [--fields field1,field2] [--json]
 */

interface JiraCredentials {
  email: string;
  apiToken: string;
  baseUrl: string;
}

const DEFAULT_FIELDS = "summary,description,comment,customfield_10759,customfield_10510,customfield_10704,customfield_10858,creator,customfield_10701,customfield_10611,customfield_10509";

// Mapping from Jira field keys to human-readable names
const fieldKeyToName: Record<string, string> = {
  "summary": "Summary",
  "customfield_10611": "Product Area (CS)",
  "creator": "Creator",
  "customfield_10701": "CS Expertise Creator",
  "customfield_10759": "BO Link (URL)",
  "customfield_10704": "Absolute Month Concerned",
  "customfield_10858": "Run Payroll Date",
  "customfield_10509": "BO Company URL",
  "description": "Description",
  "comment": "Comment",
  "customfield_10510": "Employee Names & ID"
};

function getCredentials(): JiraCredentials {
  const apiToken = process.env.JIRA_API_TOKEN;
  const email = process.env.JIRA_EMAIL;
  const baseUrl = process.env.JIRA_BASE_URL;

  if (!apiToken || !email || !baseUrl) {
    console.error("Error: Missing required environment variables.");
    console.error("Please set: JIRA_API_TOKEN, JIRA_EMAIL, JIRA_BASE_URL");
    process.exit(1);
  }

  return {
    email,
    apiToken,
    baseUrl: baseUrl.replace(/\/$/, ""), // Remove trailing slash
  };
}

function parseArgs(): { issueKey: string } {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: node cli-get-issue.js ISSUE-KEY");
    process.exit(1);
  }

  const issueKey = args[0];

  return { issueKey };
}

async function getIssue(
  credentials: JiraCredentials,
  issueKey: string,
  fields?: string
): Promise<any> {
  const auth = Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString("base64");

  let url = `${credentials.baseUrl}/rest/api/3/issue/${issueKey}`;
  if (fields) {
    url += `?fields=${encodeURIComponent(fields)}`;
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

    try {
      const errorData = JSON.parse(errorText);
      if (errorData.errorMessages?.length > 0) {
        errorMessage = errorData.errorMessages.join(", ");
      }
    } catch {
      // Use default error message
    }

    if (response.status === 401) {
      throw new Error(`Authentication failed: ${errorMessage}`);
    } else if (response.status === 404) {
      throw new Error(`Issue not found: ${issueKey}`);
    } else {
      throw new Error(errorMessage);
    }
  }

  return response.json();
}

// ============================================
// Data cleaning functions (from utils.ts)
// ============================================

/**
 * Extracts plain text from ADF (Atlassian Document Format) content
 */
function extractTextFromADF(adfContent: any): string {
  if (!adfContent) return '';
  if (typeof adfContent === 'string') return adfContent;

  if (adfContent.type === 'doc' && Array.isArray(adfContent.content)) {
    return extractTextFromADFNodes(adfContent.content);
  }

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
        if (Array.isArray(node.content)) {
          const text = extractTextFromADFNodes(node.content);
          if (text) textParts.push(text);
        }
    }
  }

  return textParts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Cleans a field that contains a "name" property
 */
function cleanFieldWithName(field: any, fieldName?: string): any {
  if (!field || typeof field !== 'object') return field;

  if (fieldName === 'project' && 'name' in field) {
    const cleaned: any = { name: field.name };
    if (field.key) cleaned.key = field.key;
    return cleaned;
  }

  if ('name' in field) {
    return { name: field.name };
  }

  return field;
}

/**
 * Cleans a field that contains a "value" property
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
 * Cleans the comment field structure
 */
function cleanCommentField(commentField: any): any {
  if (!commentField || typeof commentField !== 'object') return commentField;

  if (Array.isArray(commentField.comments)) {
    return {
      comments: commentField.comments.map((comment: any) => ({
        authorEmail: comment.author?.emailAddress || '',
        body: extractTextFromADF(comment.body) || comment.body || ''
      }))
    };
  }

  return commentField;
}

/**
 * Generically cleans a field based on its structure
 */
function cleanFieldGeneric(field: any, fieldName?: string): any {
  if (!field || typeof field !== 'object') return field;

  if (fieldName === 'comment') {
    return cleanCommentField(field);
  }

  if (Array.isArray(field)) {
    return field.map(item => cleanFieldGeneric(item, fieldName));
  }

  if ('emailAddress' in field || 'displayName' in field) {
    return {
      emailAddress: field.emailAddress || '',
      displayName: field.displayName || ''
    };
  }

  if ('type' in field && field.type === 'doc') {
    return extractTextFromADF(field);
  }

  if ('name' in field) {
    return cleanFieldWithName(field, fieldName);
  }

  if ('value' in field) {
    return cleanFieldWithValue(field);
  }

  const cleanedObject: any = {};
  for (const [key, value] of Object.entries(field)) {
    cleanedObject[key] = cleanFieldGeneric(value, key);
  }
  return cleanedObject;
}

/**
 * Cleans a single Jira issue
 */
function cleanJiraIssue(issue: any): any {
  if (!issue) return issue;

  const cleanedIssue = { ...issue };

  if (cleanedIssue.fields) {
    for (const [fieldName, value] of Object.entries(cleanedIssue.fields)) {
      if (value === null || value === undefined) {
        continue;
      }
      cleanedIssue.fields[fieldName] = cleanFieldGeneric(value, fieldName);
    }
  }

  if (cleanedIssue.renderedFields) {
    if (cleanedIssue.renderedFields.description) {
      if (typeof cleanedIssue.renderedFields.description === 'object') {
        cleanedIssue.renderedFields.description = extractTextFromADF(cleanedIssue.renderedFields.description);
      }
    }
  }

  return cleanedIssue;
}

/**
 * Renames field keys to human-readable names
 */
function renameFieldKeys(fields: Record<string, any>): Record<string, any> {
  const renamed: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields)) {
    const newKey = fieldKeyToName[key] || key;
    renamed[newKey] = value;
  }
  return renamed;
}

// ============================================
// Main entry point
// ============================================

async function main() {
  const { issueKey } = parseArgs();
  const credentials = getCredentials();

  try {
    const issue = await getIssue(credentials, issueKey, DEFAULT_FIELDS);
    const cleanedIssue = cleanJiraIssue(issue);
    // Rename field keys to human-readable names
    cleanedIssue.fields = renameFieldKeys(cleanedIssue.fields);
    console.log(JSON.stringify(cleanedIssue, null, 2));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
