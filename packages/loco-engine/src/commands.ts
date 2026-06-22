/**
 * LOCO Protocol Command Modules — LCHATLIST, SYNCMSG, WRITE, DELETEMSG, PING.
 * 
 * Based on KiwiTalk talk-loco-client source code analysis.
 * Uses LocoConnection (persistent connection) to avoid -201 errors.
 */

import { BSON, Long, type Document } from "bson";
import { encodeHeader, LOCO_HEADER_SIZE } from "./protocol/header.js";
import { LocoConnection } from "./connection.js";
import type { LocoClient } from "./session.js";
import type { LocoSession } from "./auth/types.js";

export interface LchatListRequest {
  chatIds: bigint[];
  maxIds: bigint[];
  lastTokenId: number;
  lastChatId: number;
}

export interface SyncMsgRequest {
  chatId: bigint;
  cur: bigint;
  max: bigint;
  cnt: number;
}

export interface WriteRequest {
  chatId: bigint;
  message: string;
  /** Message type: 1=text, etc */
  type?: number;
  /** JSON attachment string */
  attachment?: string;
}

export interface DeleteMsgRequest {
  chatId: bigint;
  logId: bigint;
}

/** Send LCHATLIST on a persistent connection (via LocoClient) */
export async function sendLchatListOn(
  client: LocoClient,
  req: LchatListRequest,
): Promise<Document> {
  const body = Buffer.from(BSON.serialize({
    chatIds: req.chatIds.map((v) => Long.fromBigInt(v)),
    maxIds: req.maxIds.map((v) => Long.fromBigInt(v)),
    lastTokenId: Long.fromBigInt(BigInt(req.lastTokenId)),
    lastChatId: Long.fromBigInt(BigInt(req.lastChatId)),
  }));
  return client.sendRaw("LCHATLIST", body);
}

/** Send SYNCMSG on a persistent connection (via LocoClient) */
export async function sendSyncMsgOn(
  client: LocoClient,
  req: SyncMsgRequest,
): Promise<Document> {
  const body = Buffer.from(BSON.serialize({
    chatId: Long.fromBigInt(req.chatId),
    cur: Long.fromBigInt(req.cur),
    max: Long.fromBigInt(req.max),
    cnt: req.cnt,
  }));
  return client.sendRaw("SYNCMSG", body);
}

// ─── Phase C: Message Send / Delete ──────────────────────────────────────

/** Send a text message to a chat room (WRITE) */
export async function sendWrite(
  client: LocoClient,
  req: WriteRequest,
): Promise<Document> {
  const msgId = Date.now(); // Client-generated unique message ID
  const body = Buffer.from(BSON.serialize({
    chatId: Long.fromBigInt(req.chatId),
    type: req.type ?? 1,
    msgId,
    msg: req.message,
    noSeen: false,
    extra: req.attachment ?? "{}",
  }));
  return client.sendRaw("WRITE", body);
}

/** Delete a message from a chat room (DELETEMSG) — opt-in only */
export async function sendDeleteMsg(
  client: LocoClient,
  req: DeleteMsgRequest,
): Promise<Document> {
  const body = Buffer.from(BSON.serialize({
    chatId: Long.fromBigInt(req.chatId),
    logId: Long.fromBigInt(req.logId),
  }));
  return client.sendRaw("DELETEMSG", body);
}

/** Send PING on a persistent connection (via LocoClient) */
export async function sendPing(
  client: LocoClient,
): Promise<void> {
  await client.sendRaw("PING", Buffer.alloc(0));
}

// ─── Legacy functions (create new connection each time — may cause -201) ───

/** @deprecated Use sendLchatListOn instead */
export async function sendLchatList(
  session: LocoSession, req: LchatListRequest, publicKey: string, appVer: string,
): Promise<Document> {
  const conn = new LocoConnection(session.locoServer.host, session.locoServer.port, publicKey);
  await conn.connect();
  try {
    const body = Buffer.from(BSON.serialize({
      chatIds: req.chatIds.map((v) => Long.fromBigInt(v)),
      maxIds: req.maxIds.map((v) => Long.fromBigInt(v)),
      lastTokenId: Long.fromBigInt(BigInt(req.lastTokenId)),
      lastChatId: Long.fromBigInt(BigInt(req.lastChatId)),
    }));
    const packet = encodeHeader(1, "LCHATLIST", 0, body);
    const response = await conn.command(packet);
    if (response.length < LOCO_HEADER_SIZE) throw new Error("LCHATLIST response too short");
    return BSON.deserialize(response.subarray(LOCO_HEADER_SIZE)) as Document;
  } finally { conn.close(); }
}

/** @deprecated Use sendSyncMsgOn instead */
export async function sendSyncMsg(
  session: LocoSession, req: SyncMsgRequest, publicKey: string, appVer: string,
): Promise<Document> {
  const conn = new LocoConnection(session.locoServer.host, session.locoServer.port, publicKey);
  await conn.connect();
  try {
    const body = Buffer.from(BSON.serialize({
      chatId: Long.fromBigInt(req.chatId), cur: Long.fromBigInt(req.cur),
      max: Long.fromBigInt(req.max), cnt: req.cnt,
    }));
    const packet = encodeHeader(1, "SYNCMSG", 0, body);
    const response = await conn.command(packet);
    if (response.length < LOCO_HEADER_SIZE) throw new Error("SYNCMSG response too short");
    return BSON.deserialize(response.subarray(LOCO_HEADER_SIZE)) as Document;
  } finally { conn.close(); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Extract chat room ID from a LOCO chat data document */
export function getChatId(data: Document): bigint {
  const id = data.c ?? data.chatId;
  if (typeof id === "number") return BigInt(id);
  if (typeof id?.high === "number" && typeof id?.low === "number") {
    return (BigInt(id.high) << 32n) + BigInt(id.low >>> 0);
  }
  return BigInt(String(id));
}

/** Extract message text from a LOCO chatlog document */
export function getMessageText(log: Document): string {
  return String(log.message ?? log.msg ?? "");
}