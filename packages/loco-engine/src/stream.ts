/**
 * Phase E-1: LOCO Stream — 서버 푸시 메시지 처리 (Event 기반)
 *
 * LOGINLIST 이후 LOCO 서버는 요청 없이도 다양한 이벤트를 푸시합니다:
 * - "MSG": 새 메시지 도착
 * - "KICKOUT": 중복 로그인
 * - "CHANGESVR": 서버 변경
 * - "LEFT", "NEWMEM", "DELMEM": 채팅방 멤버 변동
 *
 * v3 개선: Polling → Event 기반 (connection.ts onPushData 사용)
 */

import { BSON, type Document } from "bson";
import { LocoConnection } from "./connection.js";
import type { LocoServerInfo } from "./auth/types.js";

export interface NewMessageEvent {
  type: "MSG";
  chatLog: Document;
  chatId: bigint;
  authorId: bigint;
  message: string;
  logId: bigint;
}
export interface KickoutEvent { type: "KICKOUT"; }
export interface ServerChangeEvent { type: "CHANGESVR"; newServer: LocoServerInfo; }
export interface MemberUpdateEvent { type: "NEWMEM" | "DELMEM" | "LEFT"; chatId: bigint; userIds: bigint[]; }
export interface UnknownEvent { type: "UNKNOWN"; method: string; data: Document; }
export type StreamEvent = NewMessageEvent | KickoutEvent | ServerChangeEvent | MemberUpdateEvent | UnknownEvent;
export type StreamCallback = (event: StreamEvent) => void;

/** Event-driven StreamReader — fires callbacks immediately when push data arrives */
export class StreamReader {
  private conn: LocoConnection;
  private running = false;
  private callbacks: StreamCallback[] = [];

  constructor(conn: LocoConnection) { this.conn = conn; }

  onEvent(callback: StreamCallback): void { this.callbacks.push(callback); }
  offEvent(callback: StreamCallback): void { this.callbacks = this.callbacks.filter((cb) => cb !== callback); }

  /** Start listening — registers event-driven callback on connection */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.conn.onPushData((frames: Buffer[]) => {
      if (!this.running) return;
      for (const plaintext of frames) {
        const event = this.parsePacket(plaintext);
        if (event) {
          for (const cb of this.callbacks) { try { cb(event); } catch { /* ignore */ } }
        }
      }
    });
  }

  stop(): void { this.running = false; }

  private parsePacket(packet: Buffer): StreamEvent | null {
    try {
      if (packet.length < 4) return null;
      const payloadSize = packet.readUInt32LE(0);
      if (payloadSize < 22) return null;
      const fullSize = 4 + payloadSize;
      if (packet.length < fullSize) return null;
      const header = packet.subarray(4, 4 + 22);
      const method = header.subarray(6, 17).toString("ascii").replace(/\0.*$/, "");
      const body = packet.subarray(4 + 22, fullSize);
      const data = BSON.deserialize(body) as Document;
      return this.parseCommand(method, data);
    } catch { return null; }
  }

  private parseCommand(method: string, data: Document): StreamEvent {
    switch (method) {
      case "MSG": {
        const chatLog = data.chatLog ?? data;
        return { type: "MSG", chatLog, chatId: toBigInt(chatLog.chatId ?? data.chatId ?? 0), authorId: toBigInt(chatLog.authorId ?? 0), message: String(chatLog.message ?? ""), logId: toBigInt(chatLog.logId ?? 0) };
      }
      case "KICKOUT": return { type: "KICKOUT" };
      case "CHANGESVR": return { type: "CHANGESVR", newServer: { host: String(data.host ?? ""), port: Number(data.port ?? 0), csport: Number(data.csport ?? 0) } };
      case "NEWMEM": case "DELMEM": case "LEFT": return { type: method as MemberUpdateEvent["type"], chatId: toBigInt(data.chatId ?? 0), userIds: (data.memberIds ?? data.userIds ?? []).map((id: any) => toBigInt(id)) };
      default: return { type: "UNKNOWN", method, data };
    }
  }
}

function toBigInt(value: any): bigint {
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value.high === "number") return (BigInt(value.high) << 32n) + BigInt(value.low >>> 0);
  return 0n;
}