/**
 * Phase E-1: LOCO Stream — 서버 푸시 메시지 처리
 * 
 * LOGINLIST 이후 LOCO 서버는 요청 없이도 다양한 이벤트를 푸시합니다:
 * - "MSG": 새 메시지 도착
 * - "KICKOUT": 중복 로그인
 * - "CHANGESVR": 서버 변경
 * - "DECUNREAD": 읽음 처리
 * - "LEFT", "NEWMEM", "DELMEM": 채팅방 멤버 변동
 * - "SYNCDLMSG": 메시지 삭제
 * 
 * 구현 방식:
 * - LocoConnection의 raw socket에서 data 이벤트를 리스닝
 * - command()가 응답을 기다리는 동안 도착한 데이터는 command()가 소비
 * - command()가 대기 중이 아닐 때 도착한 데이터 = push 이벤트 → 버퍼링
 * - pollLoop()가 버퍼를 주기적으로 읽어서 push 이벤트로 변환
 */

import { BSON, type Document } from "bson";
import { LocoConnection } from "./connection.js";
import { SECURE_FRAME_HEADER_SIZE, decryptLocoFrame } from "./crypto/aes.js";
import type { LocoServerInfo } from "./auth/types.js";

// ─── Stream Event Types ──────────────────────────────────────────────────

export interface NewMessageEvent {
  type: "MSG";
  chatLog: Document;
  chatId: bigint;
  authorId: bigint;
  message: string;
  logId: bigint;
}

export interface KickoutEvent {
  type: "KICKOUT";
}

export interface ServerChangeEvent {
  type: "CHANGESVR";
  newServer: LocoServerInfo;
}

export interface MemberUpdateEvent {
  type: "NEWMEM" | "DELMEM" | "LEFT";
  chatId: bigint;
  userIds: bigint[];
}

export interface UnknownEvent {
  type: "UNKNOWN";
  method: string;
  data: Document;
}

export type StreamEvent = NewMessageEvent | KickoutEvent | ServerChangeEvent | MemberUpdateEvent | UnknownEvent;
export type StreamCallback = (event: StreamEvent) => void;

// ─── Stream Reader ────────────────────────────────────────────────────────

/**
 * Reads push messages from a LOCO connection.
 * Must be started after LOGINLIST, on the same connection.
 * 
 * The LocoConnection stores push data that arrives when no command() is active.
 * StreamReader polls this buffer and dispatches events to callbacks.
 */
export class StreamReader {
  private conn: LocoConnection;
  private running = false;
  private callbacks: StreamCallback[] = [];

  constructor(conn: LocoConnection) {
    this.conn = conn;
  }

  onEvent(callback: StreamCallback): void {
    this.callbacks.push(callback);
  }

  offEvent(callback: StreamCallback): void {
    this.callbacks = this.callbacks.filter((cb) => cb !== callback);
  }

  /** Start polling for push data */
  start(intervalMs = 1000): void {
    if (this.running) return;
    this.running = true;
    this.pollLoop(intervalMs);
  }

  stop(): void {
    this.running = false;
  }

  private async pollLoop(intervalMs: number): Promise<void> {
    while (this.running) {
      try {
        const pushData = this.conn.readPushBuffer();
        if (pushData && pushData.length > 0) {
          for (const packet of pushData) {
            const event = this.parsePacket(packet);
            if (event) {
              for (const cb of this.callbacks) {
                try { cb(event); } catch { /* ignore */ }
              }
            }
          }
        }
      } catch { /* ignore polling errors */ }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

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
    } catch {
      return null;
    }
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