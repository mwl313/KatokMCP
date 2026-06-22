/**
 * LOCO Protocol Command Modules — All LOCO commands.
 * 
 * Based on KiwiTalk talk-loco-client source code analysis.
 * Uses LocoConnection (persistent connection) to avoid -201 errors.
 */

import { BSON, Long, type Document } from "bson";
import type { LocoClient } from "./session.js";

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
  type?: number;
  attachment?: string;
}

export interface DeleteMsgRequest {
  chatId: bigint;
  logId: bigint;
}

/** Send LCHATLIST */
export async function sendLchatListOn(client: LocoClient, req: LchatListRequest): Promise<Document> {
  const body = Buffer.from(BSON.serialize({
    chatIds: req.chatIds.map((v) => Long.fromBigInt(v)),
    maxIds: req.maxIds.map((v) => Long.fromBigInt(v)),
    lastTokenId: Long.fromBigInt(BigInt(req.lastTokenId)),
    lastChatId: Long.fromBigInt(BigInt(req.lastChatId)),
  }));
  return client.sendRaw("LCHATLIST", body);
}

/** Send SYNCMSG */
export async function sendSyncMsgOn(client: LocoClient, req: SyncMsgRequest): Promise<Document> {
  const body = Buffer.from(BSON.serialize({
    chatId: Long.fromBigInt(req.chatId), cur: Long.fromBigInt(req.cur),
    max: Long.fromBigInt(req.max), cnt: req.cnt,
  }));
  return client.sendRaw("SYNCMSG", body);
}

/** Send WRITE */
export async function sendWrite(client: LocoClient, req: WriteRequest): Promise<Document> {
  const msgId = Date.now();
  return client.sendRaw("WRITE", Buffer.from(BSON.serialize({
    chatId: Long.fromBigInt(req.chatId), type: req.type ?? 1, msgId,
    msg: req.message, noSeen: false, extra: req.attachment ?? "{}",
  })));
}

/** Send DELETEMSG */
export async function sendDeleteMsg(client: LocoClient, req: DeleteMsgRequest): Promise<Document> {
  return client.sendRaw("DELETEMSG", Buffer.from(BSON.serialize({
    chatId: Long.fromBigInt(req.chatId), logId: Long.fromBigInt(req.logId),
  })));
}

/** GETMEM — get all members of a chat room */
export async function sendGetMem(client: LocoClient, chatId: bigint): Promise<Document> {
  return client.sendRaw("GETMEM", Buffer.from(BSON.serialize({ chatId: Long.fromBigInt(chatId) })));
}

/** MEMBER — get specific members by IDs */
export async function sendMember(client: LocoClient, chatId: bigint, memberIds: bigint[]): Promise<Document> {
  return client.sendRaw("MEMBER", Buffer.from(BSON.serialize({
    chatId: Long.fromBigInt(chatId), memberIds: memberIds.map((v) => Long.fromBigInt(v)),
  })));
}

/** PING */
export async function sendPing(client: LocoClient): Promise<void> {
  await client.sendRaw("PING", Buffer.alloc(0));
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function getChatId(data: Document): bigint {
  const id = data.c ?? data.chatId;
  if (typeof id === "number") return BigInt(id);
  if (typeof id?.high === "number" && typeof id?.low === "number") return (BigInt(id.high) << 32n) + BigInt(id.low >>> 0);
  return BigInt(String(id));
}

export function getMessageText(log: Document): string {
  return String(log.message ?? log.msg ?? "");
}