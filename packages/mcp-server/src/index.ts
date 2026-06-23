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
  sendWrite,
  sendDeleteMsg,
  sendGetMem,
  getChatId,
  getMessageText,
  LocoError,
} from "@katok-mcp/loco-engine";
import type { SessionConfig } from "@katok-mcp/loco-engine";
import { CredentialStore, storeCredentialsInteractive, type StoredAuthResult } from "./credential-store.js";
import { globalRateLimiter, auditLogger, RateLimitError } from "./safety.js";

// ─── State ────────────────────────────────────────────────────────────────

let client: LocoClient | null = null;
const store = new CredentialStore();

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

  // 1. Try cached token first
  const savedAuth = await store.loadAuth();
  if (savedAuth) {
    console.error("Using cached access token...");
    try {
      client = await LocoClient.connect({
        auth: {
          userId: BigInt(savedAuth.userId),
          accessToken: savedAuth.accessToken,
          refreshToken: savedAuth.refreshToken,
          tokenType: savedAuth.tokenType,
        },
      });
      client.startKeepAlive();
      console.error("Session established (cached token)");
      return client;
    } catch (error) {
      console.error("Cached token invalid, re-authenticating...");
      await store.clearAuth().catch(() => {});
      // fall through to fresh auth
    }
  }

  // 2. Fresh authentication
  console.error("Authenticating...");
  const creds = readAndroidCredentialsFromEnvironment();
  const auth = await authenticateAndroid(creds.email, creds.password, creds.deviceUuid, creds.deviceName);
  console.error(`Auth OK: userId=${auth.userId}`);

  // 3. Cache token for next session
  await store.saveAuth({
    userId: String(auth.userId),
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    tokenType: auth.tokenType,
    savedAt: new Date().toISOString(),
  }).catch(() => {});
  console.error("Access token cached for next session");

  client = await LocoClient.connect({ auth });
  client.startKeepAlive();
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
  { name: "katok-mcp-server", version: "0.1.0" },
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
    {
      name: "kakao_send_chat",
      description: "Send a message to a KakaoTalk chat room. REQUIRES explicit opt-in via KAKAO_ALLOW_WRITE=YES.",
      inputSchema: {
        type: "object",
        properties: {
          chatId: { type: "string", description: "Chat room ID to send message to" },
          message: { type: "string", description: "Message text to send" },
        },
        required: ["chatId", "message"],
      },
    },
    {
      name: "kakao_list_members",
      description: "List members of a specific KakaoTalk chat room.",
      inputSchema: {
        type: "object",
        properties: {
          chatId: { type: "string", description: "Chat room ID" },
        },
        required: ["chatId"],
      },
    },
  ],
}));

// ─── Tool Handlers ────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  try {
    // Rate limiting
    globalRateLimiter.consume(1);

    let result: { content: { type: string; text: string }[] };

    switch (name) {
      case "kakao_list_chats": {
        const c = await ensureClient();
        const loginResp = c.getLoginListResponse();
        if (!loginResp) throw new Error("No login response available");
        const formatted = formatChatList(loginResp);
        result = { content: [{ type: "text", text: formatted }] };
        break;
      }

      case "kakao_send_chat": {
        if (process.env.KAKAO_ALLOW_WRITE !== "YES") {
          throw new Error("Message sending is opt-in. Set KAKAO_ALLOW_WRITE=YES to enable.");
        }
        const c = await ensureClient();
        const chatId = BigInt(String(args?.chatId ?? ""));
        const message = String(args?.message ?? "");
        if (!message.trim()) throw new Error("Message cannot be empty");
        if (message.length > 10000) throw new Error("Message too long (max 10000 chars)");

        const prefix = process.env.KAKAO_AI_PREFIX !== "false" ? "🤖 " : "";
        const sendResult = await sendWrite(c, {
          chatId,
          message: prefix + message,
        });
        const logId = sendResult.logId ?? "(unknown)";
        result = { content: [{ type: "text", text: `Message sent. (logId: ${logId})` }] };
        break;
      }

      case "kakao_list_members": {
        const c = await ensureClient();
        const chatId = BigInt(String(args?.chatId ?? ""));
        const members = await sendGetMem(c, chatId);
        const userIds = (members.memberIds ?? members.members ?? []).map((id: any) => String(decodeLong(id)));
        const displayMembers = members.displayMembers ?? [];
        const names = displayMembers.map((m: any) => `${m.nickname ?? "?"} (#${m.userId ?? "?"})`).join("\n");
        const text = names || `Members: ${userIds.join(", ")}`;
        result = { content: [{ type: "text", text }] };
        break;
      }

      case "kakao_read_chat": {
        const c = await ensureClient();
        const chatIdStr = String(args?.chatId ?? "");
        if (!chatIdStr) throw new Error("chatId is required");
        const chatId = BigInt(chatIdStr);
        const count = Math.min(Math.max(1, Number(args?.count ?? 30)), 200);

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
          result = { content: [{ type: "text", text: `Chat room #${chatIdStr} not found.` }] };
          break;
        }

        const syncResult = await sendSyncMsgOn(c, {
          chatId,
          cur: maxLogId - BigInt(count) * 10n,
          max: maxLogId,
          cnt: count,
        });
        const formatted = formatMessages(syncResult);
        result = { content: [{ type: "text", text: formatted || "No messages found." }] };
        break;
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    // Audit log
    await auditLogger.record({
      timestamp: new Date().toISOString(),
      tool: name,
      userId: client?.auth?.userId?.toString(),
      chatId: String(args?.chatId ?? ""),
      params: (args as Record<string, unknown>) ?? {},
      result: "success",
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (error instanceof McpError) throw error;
    if (error instanceof RateLimitError) {
      throw new McpError(ErrorCode.InvalidRequest, error.message);
    }

    const msg = error instanceof Error ? error.message : String(error);
    await auditLogger.record({
      timestamp: new Date().toISOString(),
      tool: name,
      userId: client?.auth?.userId?.toString(),
      chatId: String(args?.chatId ?? ""),
      params: (args as Record<string, unknown>) ?? {},
      result: "error",
      errorMessage: msg,
      durationMs,
    });
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

export async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("KakaoMCP server running on stdio");
}

// Allow running directly (node dist/index.js) or via CLI import
const isDirectRun = process.argv[1]?.endsWith("index.js");
if (isDirectRun) {
  main().catch((error) => {
    console.error("Fatal:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
