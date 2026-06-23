#!/usr/bin/env node
/**
 * @katok-mcp/mcp-server — HTTP Transport (Streamable HTTP)
 *
 * Provides MCP Streamable HTTP Transport for web-based AI clients
 * (ChatGPT Web, Claude Web, OpenClaw Web, etc.).
 *
 * Usage:
 *   katok-mcp server --http --port 3000
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CredentialStore } from "./credential-store.js";

// ─── State ────────────────────────────────────────────────────────────────

const store = new CredentialStore();
let mcpServer: Server | null = null;

// ─── Auth Middleware ───────────────────────────────────────────────────────

function authMiddleware(req: IncomingMessage, res: ServerResponse): boolean {
  const apiKey = process.env.KATOK_API_KEY;
  if (!apiKey) return true; // No key configured = no auth

  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized: missing or invalid Bearer token" }));
    return false;
  }

  const token = authHeader.slice(7);
  if (token !== apiKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized: invalid API key" }));
    return false;
  }

  return true;
}

// ─── Session Manager ───────────────────────────────────────────────────────

let sessionInitialized = false;

/**
 * Ensure the LOCO session is initialized. Uses credential-store fallback.
 * This is called once when the first MCP request arrives.
 */
async function ensureMcpSession(): Promise<void> {
  if (sessionInitialized) return;

  // Try cached auth, env vars, then credential store
  const savedAuth = await store.loadAuth();
  if (savedAuth) {
    console.error("HTTP: Using cached access token...");
    // Token is cached — MCP server will use it via ensureClient() in index
    sessionInitialized = true;
    return;
  }

  const envEmail = process.env.KAKAO_EMAIL;
  const envPassword = process.env.KAKAO_PASSWORD;
  const envDeviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID;

  let email: string;
  let password: string;
  let deviceUuid: string;
  let deviceName: string | undefined;

  if (envEmail && envPassword && envDeviceUuid) {
    console.error("HTTP: Authenticating (from environment variables)...");
    email = envEmail;
    password = envPassword;
    deviceUuid = envDeviceUuid;
    deviceName = process.env.KAKAO_ANDROID_DEVICE_NAME;
  } else if (await store.exists()) {
    console.error("HTTP: Authenticating (from credential store)...");
    const creds = await store.load();
    email = creds.email;
    password = creds.password;
    deviceUuid = creds.deviceUuid;
    deviceName = creds.deviceName;
  } else {
    throw new Error("No credentials found for HTTP server. Run 'katok-mcp setup' first.");
  }

  // Initialize the LOCO session by calling authenticateAndroid
  const { authenticateAndroid } = await import("@katok-mcp/loco-engine");
  const auth = await authenticateAndroid(email, password, deviceUuid, deviceName);
  console.error(`HTTP: Auth OK: userId=${auth.userId}`);

  await store.saveAuth({
    userId: String(auth.userId),
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    tokenType: auth.tokenType,
    savedAt: new Date().toISOString(),
  }).catch(() => {});

  console.error("HTTP: Access token cached");
  sessionInitialized = true;
}

// ─── MCP Server Setup ─────────────────────────────────────────────────────

function getMcpServer(): Server {
  if (mcpServer) return mcpServer;

  mcpServer = new Server(
    { name: "katok-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  // Dynamically import the tool/resource handlers from index.ts
  // We reuse the same handler setup by importing and using the main function
  // But for HTTP we need to set up handlers directly on our Server instance
  // by delegating to the same logic from index.ts

  return mcpServer;
}

// ─── HTTP Server ───────────────────────────────────────────────────────────

export interface HttpServerOptions {
  port: number;
}

export async function startHttpServer(options: HttpServerOptions): Promise<void> {
  const { port } = options;

  // Initialize session
  try {
    await ensureMcpSession();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`HTTP: Session init failed: ${msg}`);
    throw error;
  }

  // Create MCP Server with Streamable HTTP Transport
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomBytes(16).toString("hex"),
  });

  // Reconstruct the same server setup as index.ts but with HTTP transport
  const server = new Server(
    { name: "katok-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  // Register tools directly on our HTTP server instance
  const {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ErrorCode,
    McpError,
  } = await import("@modelcontextprotocol/sdk/types.js");

  // Tool definitions
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "kakao_list_chats",
        description: "List all KakaoTalk chat rooms with unread counts, member info, and last message.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "kakao_read_chat",
        description: "Read recent messages from a specific KakaoTalk chat room by chat ID.",
        inputSchema: {
          type: "object",
          properties: {
            chatId: { type: "string", description: "Chat room ID" },
            count: { type: "number", description: "Number of recent messages (default: 30, max: 200)", default: 30 },
          },
          required: ["chatId"],
        },
      },
      {
        name: "kakao_send_chat",
        description: "Send a message to a KakaoTalk chat room. REQUIRES explicit opt-in via KAKAO_ALLOW_WRITE=YES.",
        inputSchema: {
          type: "object",
          properties: {
            chatId: { type: "string", description: "Chat room ID" },
            message: { type: "string", description: "Message text" },
          },
          required: ["chatId", "message"],
        },
      },
      {
        name: "kakao_list_members",
        description: "List members of a specific KakaoTalk chat room.",
        inputSchema: {
          type: "object",
          properties: { chatId: { type: "string", description: "Chat room ID" } },
          required: ["chatId"],
        },
      },
    ],
  }));

  // Tool call handler — delegates to the same ensureClient() logic
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Reuse the ensureClient logic from index by dynamically importing
      // and using the LocoClient
      const {
        LocoClient,
        sendSyncMsgOn,
        sendWrite,
        sendGetMem,
        getMessageText,
      } = await import("@katok-mcp/loco-engine");

      // Build client using same credential flow
      let client;
      const cachedAuth = await store.loadAuth();
      if (cachedAuth) {
        client = await LocoClient.connect({
          auth: {
            userId: BigInt(cachedAuth.userId),
            accessToken: cachedAuth.accessToken,
            refreshToken: cachedAuth.refreshToken,
            tokenType: cachedAuth.tokenType,
          },
        });
      } else {
        // Full auth flow through ensureMcpSession
        const creds = await store.load();
        const { authenticateAndroid } = await import("@katok-mcp/loco-engine");
        const auth = await authenticateAndroid(creds.email, creds.password, creds.deviceUuid, creds.deviceName || "SM-X930");
        client = await LocoClient.connect({ auth });
        await store.saveAuth({
          userId: String(auth.userId),
          accessToken: auth.accessToken,
          refreshToken: auth.refreshToken,
          tokenType: auth.tokenType,
          savedAt: new Date().toISOString(),
        }).catch(() => {});
      }
      client.startKeepAlive();

      let result: { content: { type: string; text: string }[] };

      switch (name) {
        case "kakao_list_chats": {
          const loginResp = client.getLoginListResponse();
          if (!loginResp) throw new Error("No login response available");
          // Format chat list — simplified
          const chatDatas = loginResp.chatDatas ?? [];
          const text = Array.isArray(chatDatas) ? chatDatas.map((chat: any) => {
            const id = chat.c ?? 0;
            const unread = chat.n ?? 0;
            const lastMsg = chat.l?.message ?? "(no messages)";
            return `- Chat #${id} ${unread} unread: "${String(lastMsg).slice(0, 100)}"`;
          }).join("\n") : "No chat rooms found.";
          result = { content: [{ type: "text", text }] };
          break;
        }

        case "kakao_send_chat": {
          if (process.env.KAKAO_ALLOW_WRITE !== "YES") {
            throw new Error("Message sending is opt-in. Set KAKAO_ALLOW_WRITE=YES to enable.");
          }
          const chatId = BigInt(String(args?.chatId ?? ""));
          const message = String(args?.message ?? "");
          if (!message.trim()) throw new Error("Message cannot be empty");
          const prefix = process.env.KAKAO_AI_PREFIX !== "false" ? "🤖 " : "";
          const sendResult = await sendWrite(client, { chatId, message: prefix + message });
          const logId = sendResult.logId ?? "(unknown)";
          result = { content: [{ type: "text", text: `Message sent. (logId: ${logId})` }] };
          break;
        }

        case "kakao_list_members": {
          const chatId = BigInt(String(args?.chatId ?? ""));
          const members = await sendGetMem(client, chatId);
          const displayMembers = members.displayMembers ?? [];
          const text = displayMembers.map((m: any) => `${m.nickname ?? "?"} (#${m.userId ?? "?"})`).join("\n");
          result = { content: [{ type: "text", text: text || "No members found." }] };
          break;
        }

        case "kakao_read_chat": {
          const chatIdStr = String(args?.chatId ?? "");
          if (!chatIdStr) throw new Error("chatId is required");
          const chatId = BigInt(chatIdStr);
          const count = Math.min(Math.max(1, Number(args?.count ?? 30)), 200);

          const loginResp = client.getLoginListResponse();
          let maxLogId = 0n;
          if (loginResp?.chatDatas) {
            for (const chat of loginResp.chatDatas) {
              if (BigInt(chat.c ?? 0) === chatId) {
                maxLogId = BigInt(chat.ll ?? 0);
                break;
              }
            }
          }
          if (maxLogId === 0n) {
            result = { content: [{ type: "text", text: `Chat room #${chatIdStr} not found.` }] };
            break;
          }

          const syncResult = await sendSyncMsgOn(client, {
            chatId,
            cur: maxLogId - BigInt(count) * 10n,
            max: maxLogId,
            cnt: count,
          });
          const logs = syncResult.chatLogs ?? [];
          const text = Array.isArray(logs) ? logs.map((log: any) => {
            const msg = getMessageText(log);
            const time = log.sendAt ? new Date(Number(log.sendAt) * 1000).toISOString() : "unknown";
            return `[${time}] "${msg}"`;
          }).join("\n") : "No messages found.";
          result = { content: [{ type: "text", text: text || "No messages found." }] };
          break;
        }

        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, msg);
    }
  });

  // Connect transport to server
  await server.connect(transport);

  // Create HTTP server
  const httpServer = createServer(async (req, res) => {
    // CORS headers for web clients
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "katok-mcp" }));
      return;
    }

    // Auth middleware
    if (!authMiddleware(req, res)) return;

    // MCP endpoint — only POST is supported for MCP requests
    if (req.url === "/mcp") {
      // Collect body
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", async () => {
        try {
          const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : undefined;
          await transport.handleRequest(req, res, body);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Invalid request: ${msg}` }));
        }
      });
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found. Use POST /mcp for MCP requests." }));
  });

  return new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      console.error(`KatokMCP HTTP server running on port ${port}`);
      console.error(`  MCP endpoint: http://localhost:${port}/mcp`);
      console.error(`  Health check: http://localhost:${port}/health`);
      if (process.env.KATOK_API_KEY) {
        console.error(`  API Key authentication: enabled`);
      } else {
        console.error(`  API Key authentication: disabled (set KATOK_API_KEY env to enable)`);
      }
      resolve();
    });
  });
}