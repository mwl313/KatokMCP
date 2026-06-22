/**
 * LOCO session management — combines auth + CHECKIN + LOGINLIST + persistent connection.
 * 
 * Uses LocoConnection to maintain a single TCP connection for multiple commands.
 */

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sendPing } from "./commands.js";
import { BSON, Long, type Document } from "bson";
import { encodeHeader, LOCO_HEADER_SIZE } from "./protocol/header.js";
import { createHandshake } from "./crypto/handshake.js";
import { connectSocket, sendAndReceive } from "./transport/socket.js";
import { LocoConnection } from "./connection.js";
import type { AuthResult, LocoSession } from "./auth/types.js";

const TICKET_HOST = "ticket-loco.kakao.com";
const TICKET_PORT = 995;

export interface SessionConfig {
  auth: AuthResult;
  appVersion?: string;
  publicKeyPath?: string;
  publicKey?: string;
}

/** Perform CHECKIN to get LOCO server assignment (creates its own temp connection) */
export async function checkin(sessionKey: Buffer, auth: AuthResult, publicKey: string, appVer: string): Promise<{ host: string; port: number; csport: number }> {
  const socket = await connectSocket({ host: TICKET_HOST, port: TICKET_PORT });
  try {
    socket.write(createHandshake(publicKey, sessionKey));
    const body = Buffer.from(BSON.serialize({
      userId: Long.fromBigInt(auth.userId), os: "android", ntype: 0, appVer,
      MCCMNC: "999", lang: "ko", countryISO: "KR", useSub: true, deviceName: "SM-X930",
    }));
    const response = await sendAndReceive(socket, sessionKey, encodeHeader(1, "CHECKIN", 0, body));
    if (response.length < LOCO_HEADER_SIZE) throw new Error("CHECKIN response too short");
    const result = BSON.deserialize(response.subarray(LOCO_HEADER_SIZE)) as Document;
    if (result.status !== 0) throw new Error(`CHECKIN status ${String(result.status)}`);
    return { host: String(result.host ?? ""), port: Number(result.port ?? 0), csport: Number(result.csport ?? 0) };
  } finally { socket.destroy(); }
}

/** LocoSession with a persistent connection for multiple commands */
export class LocoClient {
  public readonly sessionKey: Buffer;
  public readonly auth: AuthResult;
  public readonly locoServer: { host: string; port: number; csport: number };
  public readonly appVer: string;
  private conn: LocoConnection;
  private _loginListResponse: Document | null = null;

  private constructor(
    auth: AuthResult,
    locoServer: { host: string; port: number; csport: number },
    sessionKey: Buffer,
    conn: LocoConnection,
    appVer: string,
  ) {
    this.auth = auth;
    this.locoServer = locoServer;
    this.sessionKey = sessionKey;
    this.conn = conn;
    this.appVer = appVer;
  }

  /** Establish a full session: auth → CHECKIN → LOGINLIST → persistent connection */
  static async connect(config: SessionConfig): Promise<LocoClient> {
    const appVer = config.appVersion ?? "25.9.2";
    const publicKey = config.publicKey ?? await readFile(
      config.publicKeyPath ?? new URL("../assets/public-key.pem", import.meta.url), "utf8",
    );
    const deviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID ?? "0000000000000000000000000000000000000000000000000000000000000000";

    // CHECKIN (ticket server — separate temp connection)
    const sessionKey = randomBytes(16);
    try {
      const locoServer = await checkin(sessionKey, config.auth, publicKey, appVer);

      // Persistent connection to LOCO server
      const conn = new LocoConnection(locoServer.host, locoServer.port, publicKey);
      await conn.connect();

      // LOGINLIST on the persistent connection
      const body = Buffer.from(BSON.serialize({
        os: "android", ntype: 0, appVer, MCCMNC: "999", prtVer: "1",
        duuid: deviceUuid, oauthToken: config.auth.accessToken, lang: "ko",
        dtype: 0, revision: 0, rp: Buffer.from([0x00, 0x00, 0xff, 0xff, 0x00, 0x00]),
        chatIds: [], maxIds: [], lastTokenId: 0, lastChatId: Long.ZERO, lbk: 0, bg: false,
      }));
      const packet = encodeHeader(1, "LOGINLIST", 0, body);
      const response = await conn.command(packet);
      if (response.length < LOCO_HEADER_SIZE) throw new Error("LOGINLIST response too short");
      const decoded = BSON.deserialize(response.subarray(LOCO_HEADER_SIZE)) as Document;
      if (decoded.status !== 0) throw new Error(`LOGINLIST status ${String(decoded.status)}`);

      const client = new LocoClient(config.auth, locoServer, sessionKey, conn, appVer);
      client._loginListResponse = decoded;
      return client;
    } catch (error) {
      sessionKey.fill(0);
      throw error;
    }
  }

  /** Get the LOGINLIST response (chat room data) */
  getLoginListResponse(): Document | null {
    return this._loginListResponse;
  }

  /** Get the underlying connection for direct command access */
  getConnection(): LocoConnection {
    return this.conn;
  }

  /** Send a raw LOCO command on the persistent connection (e.g. LCHATLIST, SYNCMSG) */
  async sendRaw(method: string, body: Buffer): Promise<Document> {
    const packet = encodeHeader(1, method, 0, body);
    const response = await this.conn.command(packet);
    if (response.length < LOCO_HEADER_SIZE) throw new Error(`${method} response too short`);
    const decoded = BSON.deserialize(response.subarray(LOCO_HEADER_SIZE)) as Document;
    if (decoded.status !== 0 && decoded.status !== undefined) {
      throw new Error(`${method} status ${String(decoded.status)}`);
    }
    return decoded;
  }

  /** Start Keep-Alive PING interval (default: 30s) */
  private pingInterval?: ReturnType<typeof setInterval>;

  startKeepAlive(intervalMs = 30_000): void {
    this.stopKeepAlive();
    this.pingInterval = setInterval(() => {
      sendPing(this).catch(() => { /* ignore ping failures */ });
    }, intervalMs);
  }

  stopKeepAlive(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  /** Close the persistent connection */
  close(): void {
    this.stopKeepAlive();
    this.conn.close();
    this.sessionKey.fill(0);
  }
}