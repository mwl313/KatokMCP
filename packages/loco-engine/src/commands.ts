/**
 * LOCO Protocol Command Modules — LCHATLIST and SYNCMSG.
 * 
 * Based on KiwiTalk talk-loco-client source code analysis.
 */

import { BSON, Long, type Document } from "bson";
import { encodeHeader, LOCO_HEADER_SIZE } from "./protocol/header.js";
import { createHandshake } from "./crypto/handshake.js";
import { connectSocket, sendAndReceive } from "./transport/socket.js";
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

/** Send LCHATLIST to fetch more chat room data (paginated) */
export async function sendLchatList(
  session: LocoSession,
  req: LchatListRequest,
  publicKey: string,
  appVer: string,
): Promise<Document> {
  const socket = await connectSocket({ host: session.locoServer.host, port: session.locoServer.port });
  try {
    socket.write(createHandshake(publicKey, session.sessionKey));
    const body = Buffer.from(BSON.serialize({
      chatIds: req.chatIds.map((v) => Long.fromBigInt(v)),
      maxIds: req.maxIds.map((v) => Long.fromBigInt(v)),
      lastTokenId: Long.fromBigInt(BigInt(req.lastTokenId)),
      lastChatId: Long.fromBigInt(BigInt(req.lastChatId)),
    }));
    const packet = encodeHeader(1, "LCHATLIST", 0, body);
    const response = await sendAndReceive(socket, session.sessionKey, packet);
    if (response.length < LOCO_HEADER_SIZE) throw new Error("LCHATLIST response too short");
    return BSON.deserialize(response.subarray(LOCO_HEADER_SIZE)) as Document;
  } finally { socket.destroy(); }
}

/** Send SYNCMSG to fetch message logs from a specific chat room */
export async function sendSyncMsg(
  session: LocoSession,
  req: SyncMsgRequest,
  publicKey: string,
  appVer: string,
): Promise<Document> {
  const socket = await connectSocket({ host: session.locoServer.host, port: session.locoServer.port });
  try {
    socket.write(createHandshake(publicKey, session.sessionKey));
    const body = Buffer.from(BSON.serialize({
      chatId: Long.fromBigInt(req.chatId),
      cur: Long.fromBigInt(req.cur),
      max: Long.fromBigInt(req.max),
      cnt: req.cnt,
    }));
    const packet = encodeHeader(1, "SYNCMSG", 0, body);
    const response = await sendAndReceive(socket, session.sessionKey, packet);
    if (response.length < LOCO_HEADER_SIZE) throw new Error("SYNCMSG response too short");
    return BSON.deserialize(response.subarray(LOCO_HEADER_SIZE)) as Document;
  } finally { socket.destroy(); }
}

/** Send PING to keep connection alive */
export async function sendPing(
  session: LocoSession,
  publicKey: string,
): Promise<void> {
  const socket = await connectSocket({ host: session.locoServer.host, port: session.locoServer.port });
  try {
    socket.write(createHandshake(publicKey, session.sessionKey));
    const packet = encodeHeader(1, "PING", 0, Buffer.alloc(0));
    await sendAndReceive(socket, session.sessionKey, packet);
  } finally { socket.destroy(); }
}

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