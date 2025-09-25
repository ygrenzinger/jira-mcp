import { loadEnvFile } from "node:process";
import express from "express";
import https from "https";
import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Load environment variables from .env file
loadEnvFile();

// Import Jira functions
import { getConnectionInfo } from "./jira_api_helper.js";

// Create MCP server
const server = new McpServer({
  name: "jira-mcp-server",
  version: "1.0.0"
});

// Tool 1: Get Connection Info
server.registerTool(
  "jira_get_connection_info",
  {
    title: "Get Jira Connection Info",
    description: "Validate connection and get server information"
  },
  async () => {
    try {
      const result = await getConnectionInfo();

      if (result.success) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2)
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

// Start server
async function main() {
  try {
    console.log("Starting Jira MCP Server...");

    // Create MCP transport
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID()
    });

    // Connect server to transport
    await server.connect(transport);

    // Create Express app for health check
    const app = express();
    app.use(express.json());

    // Health check endpoint
    app.get("/health", async (req, res) => {
      try {
        const result = await getConnectionInfo();
        res.json({
          status: "ok",
          jiraConnection: result.success ? "connected" : "failed",
          message: result.success ? "Jira connection successful" : result.error.message
        });
      } catch (error) {
        res.status(500).json({
          status: "error",
          jiraConnection: "failed",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // MCP endpoints handled by transport

    const port = process.env.PORT || 3000;
    const httpsPort = process.env.HTTPS_PORT || 3443;
    const useHttps = process.env.USE_HTTPS === 'true';

    if (useHttps) {
      try {
        const httpsOptions = {
          key: fs.readFileSync(path.join(process.cwd(), 'key.pem')),
          cert: fs.readFileSync(path.join(process.cwd(), 'cert.pem'))
        };

        https.createServer(httpsOptions, app).listen(httpsPort, () => {
          console.log(`🚀 Jira MCP Server running on HTTPS port ${httpsPort}`);
          console.log(`📊 Health check: https://localhost:${httpsPort}/health`);
        });
      } catch (error) {
        console.error("Failed to start HTTPS server:", error);
        console.log("Falling back to HTTP...");
        app.listen(port, () => {
          console.log(`🚀 Jira MCP Server running on HTTP port ${port}`);
          console.log(`📊 Health check: http://localhost:${port}/health`);
        });
      }
    } else {
      app.listen(port, () => {
        console.log(`🚀 Jira MCP Server running on HTTP port ${port}`);
        console.log(`📊 Health check: http://localhost:${port}/health`);
      });
    }
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

main().catch(console.error);