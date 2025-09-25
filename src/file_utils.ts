import fetch from "node-fetch";
import { lookup } from "mime-types";
import { ConversationAttachment, Result } from "./types.js";

// File data interface
export interface FileData {
  filename: string;
  content: Buffer;
  contentType: string;
  size: number;
}

// Mock conversation attachment interface (placeholder for Dust integration)
interface ConversationAttachmentInternal {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  url?: string;
  data?: string; // Base64 encoded data
}

// Get file from conversation attachment (reproducing Dust functionality)
export async function getFileFromConversationAttachment(
  attachmentId: string,
  agentLoopContext?: any // AgentLoopContextType placeholder
): Promise<Result<FileData, Error>> {
  try {
    // In the Dust implementation, this would fetch from their conversation system
    // For our standalone implementation, we'll handle different attachment sources

    // Try to get attachment from context if available
    if (agentLoopContext?.attachments) {
      const attachment = agentLoopContext.attachments.find(
        (att: ConversationAttachmentInternal) => att.id === attachmentId
      );

      if (attachment) {
        return processAttachment(attachment);
      }
    }

    // If not found in context, return error
    return {
      success: false,
      error: new Error(`Attachment not found: ${attachmentId}`)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

// Process attachment based on its type
async function processAttachment(
  attachment: ConversationAttachmentInternal
): Promise<Result<FileData, Error>> {
  try {
    let content: Buffer;

    if (attachment.data) {
      // Handle base64 encoded data
      content = Buffer.from(attachment.data, 'base64');
    } else if (attachment.url) {
      // Handle URL-based attachments
      const urlResult = await fetchFileFromUrl(attachment.url);
      if (!urlResult.success) {
        return urlResult;
      }
      content = urlResult.data.content;
    } else {
      return {
        success: false,
        error: new Error("Attachment has no data or URL")
      };
    }

    // Determine content type
    const contentType = attachment.contentType ||
                       lookup(attachment.filename) ||
                       'application/octet-stream';

    return {
      success: true,
      data: {
        filename: attachment.filename,
        content,
        contentType,
        size: content.length
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

// Fetch file from URL
export async function fetchFileFromUrl(url: string): Promise<Result<FileData, Error>> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      return {
        success: false,
        error: new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
      };
    }

    const content = Buffer.from(await response.arrayBuffer());

    // Extract filename from URL or Content-Disposition header
    const filename = extractFilenameFromUrl(url) ||
                    extractFilenameFromHeaders(response.headers) ||
                    'attachment';

    // Determine content type
    const contentType = response.headers.get('content-type') ||
                       lookup(filename) ||
                       'application/octet-stream';

    return {
      success: true,
      data: {
        filename,
        content,
        contentType,
        size: content.length
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

// Extract filename from URL
function extractFilenameFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    return filename && filename.length > 0 ? filename : null;
  } catch {
    return null;
  }
}

// Extract filename from response headers
function extractFilenameFromHeaders(headers: any): string | null {
  const contentDisposition = headers.get('content-disposition');
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (filenameMatch) {
      return filenameMatch[1].replace(/['"]/g, '');
    }
  }
  return null;
}

// Handle file from base64 string
export function processBase64File(
  base64Data: string,
  filename: string,
  contentType?: string
): Result<FileData, Error> {
  try {
    // Remove data URL prefix if present
    const base64Content = base64Data.replace(/^data:[^;]*;base64,/, '');

    const content = Buffer.from(base64Content, 'base64');

    const finalContentType = contentType ||
                            lookup(filename) ||
                            'application/octet-stream';

    return {
      success: true,
      data: {
        filename,
        content,
        contentType: finalContentType,
        size: content.length
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Invalid base64 data')
    };
  }
}

// Validate file for Jira upload
export function validateFileForJira(fileData: FileData): Result<void, Error> {
  const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit for Jira attachments

  if (fileData.size > maxSizeBytes) {
    return {
      success: false,
      error: new Error(`File size (${formatFileSize(fileData.size)}) exceeds Jira's 10MB limit`)
    };
  }

  // Check for potentially dangerous file types
  const dangerousExtensions = ['.exe', '.bat', '.cmd', '.com', '.scr', '.vbs', '.js'];
  const extension = fileData.filename.toLowerCase().split('.').pop();

  if (extension && dangerousExtensions.includes(`.${extension}`)) {
    return {
      success: false,
      error: new Error(`File type .${extension} is not allowed for security reasons`)
    };
  }

  return { success: true, data: undefined };
}

// Format file size for display
export function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// Get file extension
export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

// Check if file is an image
export function isImageFile(contentType: string): boolean {
  return contentType.startsWith('image/');
}

// Check if file is a document
export function isDocumentFile(contentType: string): boolean {
  const documentTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv'
  ];

  return documentTypes.includes(contentType);
}

// Process multiple files for upload
export async function processMultipleFiles(
  fileInputs: Array<{
    source: 'attachment' | 'url' | 'base64';
    data: string;
    filename?: string;
    contentType?: string;
  }>,
  agentLoopContext?: any
): Promise<Result<FileData[], Error>> {
  const results: Result<FileData, Error>[] = [];

  for (const input of fileInputs) {
    let result: Result<FileData, Error>;

    switch (input.source) {
      case 'attachment':
        result = await getFileFromConversationAttachment(input.data, agentLoopContext);
        break;

      case 'url':
        result = await fetchFileFromUrl(input.data);
        break;

      case 'base64':
        if (!input.filename) {
          result = {
            success: false,
            error: new Error('Filename is required for base64 files')
          };
        } else {
          result = processBase64File(input.data, input.filename, input.contentType);
        }
        break;

      default:
        result = {
          success: false,
          error: new Error(`Unknown file source: ${(input as any).source}`)
        };
    }

    results.push(result);
  }

  // Check if any failed
  const errors = results.filter(r => !r.success);
  if (errors.length > 0) {
    const errorMessages = errors.map(e => (e as any).error.message).join(', ');
    return {
      success: false,
      error: new Error(`File processing failed: ${errorMessages}`)
    };
  }

  // Extract successful data
  const fileData = results.map(r => (r as any).data);

  // Validate all files for Jira
  for (const file of fileData) {
    const validation = validateFileForJira(file);
    if (!validation.success) {
      return {
        success: false,
        error: validation.error
      };
    }
  }

  return {
    success: true,
    data: fileData
  };
}

// Create attachment summary for display
export function createAttachmentSummary(files: FileData[]): string {
  if (files.length === 0) {
    return 'No attachments';
  }

  if (files.length === 1) {
    const file = files[0];
    return `1 attachment: ${file.filename} (${formatFileSize(file.size)})`;
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  return `${files.length} attachments (${formatFileSize(totalSize)} total)`;
}