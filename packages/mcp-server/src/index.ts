#!/usr/bin/env node
/**
 * @kakao-mcp/mcp-server — KakaoTalk MCP Server
 * 
 * Provides AI agents with tools to interact with KakaoTalk via the LOCO protocol.
 * 
 * Tools:
 *   - kakao_list_chats: List all chat rooms with unread counts and last messages
 *   - kakao_read_chat: Read messages from a specific chat room
 * 
 * Resources:
 *   - kakao://chats: Chat room list
 *   - kakao://chat/{chatId}: Chat room messages
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import {
  LocoClient,
  authenticateAndroid,
  readAndroidCredentialsFromEnvironment,
  sendSyncMsgOn,
  sendLchatListOn,
  getChatId,
  getMessageText,
  LocoError,
} from "@kakao-mcp/loco-engine";
import type { SessionConfig } from "@kakao-mcp/loco-engine";
import { CredentialStore, storeCredentialsInteractive } from "./credential-store.js";

// ─── State ────────────────────────────────────────────────────────────────

let client: LocoClient | null = null;

// ─── Helper Functions ─────────────────────────────────────────────────────

function decodeLong(value: any): bigint {
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value.high === "number") {
    return (BigInt(value.high) << 32n) + BigInt(value.low >>> 0);
  }
  return 0n;
}

async function ensureClient(): Promise<LocoClient> {
  if (client && client.getConnection().isConnected()) return client;

  console.error("Authenticating...");
  const creds = readAndroidCredentialsFromEnvironment();
  const auth = await authenticateAndroid(creds.email, creds.password, creds.deviceUuid, creds.deviceName);
  console.error(`Auth OK: userId=${auth.userId}`);

  client = await LocoClient.connect({ auth });
  console.error("Session established");
  return client;
}

function formatChatList(loginResponse: Record<string, any>): string {
  const chatDatas = loginResponse.chatDatas ?? [];
  if (!Array.isArray(chatDatas) || chatDatas.length === 0) {
    return "No chat rooms found.";
  }
  return chatDatas.map((chat: any) => {
    const id = decodeLong(chat.c ?? 0);
    const type = chat.t ?? "Unknown";
    const memberCount = chat.a ?? 0;
    const unread = chat.n ?? 0;
    const lastMsg = chat.l?.message ?? "(no messages)";
    const lastMsgTrunc = String(lastMsg).slice(0, 100);
    const lastLogId = chat.ll ? decodeLong(chat.ll) : 0n;
    const lastSeen = chat.s ? decodeLong(chat.s) : 0n;
    const iconNames = Array.isArray(chat.k) ? chat.k.join(", ") : "";
    return `- Chat #${id} [${type}] ${iconNames ? `("${iconNames}")` : ""} ${memberCount} members, ${unread} unread\n  Last: "${lastMsgTrunc}" (logId: ${lastLogId})`;
  }).join("\n");
}

function formatMessages(syncResponse: Record<string, any>): string {
  const logs = syncResponse.chatLogs ?? [];
  if (!Array.isArray(logs) || logs.length === 0) {
    return "No messages found.";
  }
  return logs.map((log: any) => {
    const logId = decodeLong(log.logId ?? 0);
    const authorId = log.authorId ?? 0;
    const msg = getMessageText(log);
    const time = log.sendAt ? new Date(Number(log.sendAt) * 1000).toISOString() : "unknown";
    const type = log.type ?? 0;
    return `[${time}] User #${authorId} (type:${type}): "${msg}"`;
  }).join("\n");
}

// ─── MCP Server ───────────────────────────────────────────────────────────

const server = new Server(
  { name: "kakao-mcp-server", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } },
);

// ─── Tool Definitions ─────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "kakao_list_chats",
      description: "List all KakaoTalk chat rooms with unread counts, member info, and last message.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "kakao_read_chat",
      description: "Read recent messages from a specific KakaoTalk chat room by chat ID.",
      inputSchema: {
        type: "object",
        properties: {
          chatId: {
            type: "string",
            description: "Chat room ID (can be obtained from kakao_list_chats)",
          },
          count: {
            type: "number",
            description: "Number of recent messages to read (default: 30, max: 200)",
            default: 30,
          },
        },
        required: ["chatId"],
      },
    },
  ],
}));

// ─── Tool Handlers ────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "kakao_list_chats": {
        const c = await ensureClient();
        const loginResp = c.getLoginListResponse();
        if (!loginResp) throw new Error("No login response available");
        const formatted = formatChatList(loginResp);
        return {
          content: [{ type: "text", text: formatted }],
        };
      }

      case "kakao_read_chat": {
        const c = await ensureClient();
        const chatIdStr = String(args?.chatId ?? "");
        if (!chatIdStr) throw new Error("chatId is required");
        const chatId = BigInt(chatIdStr);
        const count = Math.min(Math.max(1, Number(args?.count ?? 30)), 200);

        // Get chat room info from login response to find max log id
        const loginResp = c.getLoginListResponse();
        let maxLogId = 0n;
        if (loginResp?.chatDatas) {
          for (const chat of loginResp.chatDatas) {
            if (decodeLong(chat.c ?? 0) === chatId) {
              maxLogId = decodeLong(chat.ll ?? 0);
              break;
            }
          }
        }
        if (maxLogId === 0n) {
          return {
            content: [{ type: "text", text: `Chat room #${chatIdStr} not found.` }],
          };
        }

        const result = await sendSyncMsgOn(c, {
          chatId,
          cur: maxLogId - BigInt(count) * 10n, // Fetch a window
          max: maxLogId,
          cnt: count,
        });
        const formatted = formatMessages(result);
        return {
          content: [{ type: "text", text: formatted || "No messages found." }],
        };
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    const msg = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, msg);
  }
});

// ─── Resource Definitions ─────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "kakao://chats",
      name: "Chat Room List",
      description: "List of all KakaoTalk chat rooms",
      mimeType: "text/plain",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  if (uri === "kakao://chats") {
    const c = await ensureClient();
    const loginResp = c.getLoginListResponse();
    if (!loginResp) throw new Error("No login response available");
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: formatChatList(loginResp),
      }],
    };
  }

  // kakao://chat/{chatId}
  const chatMatch = uri.match(/^kakao:\/\/chat\/(\d+)$/);
  if (chatMatch) {
    const chatId = BigInt(chatMatch[1]);
    const c = await ensureClient();
    const loginResp = c.getLoginListResponse();
    let maxLogId = 0n;
    if (loginResp?.chatDatas) {
      for (const chat of loginResp.chatDatas) {
        if (decodeLong(chat.c ?? 0) === chatId) {
          maxLogId = decodeLong(chat.ll ?? 0);
          break;
        }
      }
    }
    if (maxLogId === 0n) {
      throw new McpError(ErrorCode.InvalidRequest, `Chat room #${chatId} not found`);
    }
    const result = await sendSyncMsgOn(c, { chatId, cur: maxLogId - 300n, max: maxLogId, cnt: 30 });
    return {
      contents: [{ uri, mimeType: "text/plain", text: formatMessages(result) }],
    };
  }

  throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
});

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("KakaoMCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
