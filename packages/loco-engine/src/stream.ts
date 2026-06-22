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
 */

import { BSON, type Document } from "bson";
import { LocoConnection } from "./connection.js";
import { LocoError } from "./error.js";
import type { LocoServerInfo } from "./auth/types.js";

// ─── Stream Event Types ──────────────────────────────────────────────────

export interface NewMessageEvent {
  type: "MSG";
  /** Chat log data */
  chatLog: Document;
  /** Chatroom ID */
  chatId: bigint;
  /** Author ID */
  authorId: bigint;
  /** Message text */
  message: string;
  /** Log ID */
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

// ─── Stream Reader ────────────────────────────────────────────────────────

export type StreamCallback = (event: StreamEvent) => void;

/**
 * Reads push messages from a LOCO connection.
 * Must be started after LOGINLIST, on the same connection.
 */
export class StreamReader {
  private conn: LocoConnection;
  private running = false;
  private abortController: AbortController | null = null;
  private callbacks: StreamCallback[] = [];

  constructor(conn: LocoConnection) {
    this.conn = conn;
  }

  /** Register a callback for stream events */
  onEvent(callback: StreamCallback): void {
    this.callbacks.push(callback);
  }

  /** Remove a callback */
  offEvent(callback: StreamCallback): void {
    this.callbacks = this.callbacks.filter((cb) => cb !== callback);
  }

  /** Start listening for push events (reads from connection in background) */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();
    this.pollLoop().catch(() => { this.running = false; });
  }

  /** Stop listening */
  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        // Read raw packet from connection (non-request/response)
        // This uses the connection's underlying socket data events
        const packet = await this.readNextPush();
        if (!packet) continue;

        const event = this.parsePacket(packet);
        if (event) {
          for (const cb of this.callbacks) {
            try { cb(event); } catch { /* ignore callback errors */ }
          }
        }
      } catch (error) {
        if (!this.running) break;
        const ev: UnknownEvent = {
          type: "UNKNOWN",
          method: "ERROR",
          data: { error: String(error) },
        };
        for (const cb of this.callbacks) {
          try { cb(ev); } catch { /* ignore */ }
        }
        break;
      }
    }
  }

  private async readNextPush(): Promise<Buffer | null> {
    // Push packets come as LOCO header + BSON body on the same connection
    // They don't have the AES frame format — the connection is already authenticated
    // Actually, all data on the connection IS AES-encrypted frames
    // So we use the same frame reading but without the request/response pairing
    
    // This is simplified — real implementation needs to interleave
    // with request/response. For now, we poll by sending PING first,
    // then reading any pending push data.
    
    // In the actual implementation, we'd use the connection's raw socket
    // with an async iterator pattern.
    return null; // Placeholder — needs full event loop integration
  }

  private parsePacket(packet: Buffer): StreamEvent | null {
    try {
      if (packet.length < 4) return null;
      const payloadSize = packet.readUInt32LE(0);
      if (payloadSize < 22) return null;
      const fullSize = 4 + payloadSize;
      if (packet.length < fullSize) return null;

      // The payload starts with a LOCO header (22 bytes) + BSON body
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
        return {
          type: "MSG",
          chatLog,
          chatId: toBigInt(chatLog.chatId ?? data.chatId ?? 0),
          authorId: toBigInt(chatLog.authorId ?? 0),
          message: String(chatLog.message ?? ""),
          logId: toBigInt(chatLog.logId ?? 0),
        };
      }
      case "KICKOUT": {
        return { type: "KICKOUT" };
      }
      case "CHANGESVR": {
        return {
          type: "CHANGESVR",
          newServer: {
            host: String(data.host ?? ""),
            port: Number(data.port ?? 0),
            csport: Number(data.csport ?? 0),
          },
        };
      }
      case "NEWMEM":
      case "DELMEM":
      case "LEFT": {
        return {
          type: method as MemberUpdateEvent["type"],
          chatId: toBigInt(data.chatId ?? 0),
          userIds: (data.memberIds ?? data.userIds ?? []).map((id: any) => toBigInt(id)),
        };
      }
      default:
        return { type: "UNKNOWN", method, data };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function toBigInt(value: any): bigint {
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value.high === "number") {
    return (BigInt(value.high) << 32n) + BigInt(value.low >>> 0);
  }
  return 0n;
}