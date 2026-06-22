/**
 * LOCO session management — combines auth + CHECKIN + LOGINLIST to establish a session.
 */

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BSON, Long, type Document } from "bson";
import { encodeHeader, LOCO_HEADER_SIZE } from "./protocol/header.js";
import { createHandshake } from "./crypto/handshake.js";
import { connectSocket, sendAndReceive } from "./transport/socket.js";
import type { AuthResult, LocoSession } from "./auth/types.js";

const TICKET_HOST = "ticket-loco.kakao.com";
const TICKET_PORT = 995;

export interface SessionConfig {
  auth: AuthResult;
  appVersion?: string;
  publicKeyPath?: string;
  publicKey?: string;
}

/** Perform CHECKIN to get LOCO server assignment */
export async function checkin(sessionKey: Buffer, auth: AuthResult, publicKey: string, appVer: string): Promise<{ host: string; port: number; csport: number }> {
  const socket = await connectSocket({ host: TICKET_HOST, port: TICKET_PORT });
  try {
    socket.write(createHandshake(publicKey, sessionKey));
    const body = Buffer.from(BSON.serialize({
      userId: Long.fromBigInt(auth.userId),
      os: "android",
      ntype: 0,
      appVer,
      MCCMNC: "999",
      lang: "ko",
      countryISO: "KR",
      useSub: true,
      deviceName: "SM-X930",
    }));
    const packet = encodeHeader(1, "CHECKIN", 0, body);
    const response = await sendAndReceive(socket, sessionKey, packet);
    if (response.length < LOCO_HEADER_SIZE) throw new Error("CHECKIN response too short");
    const result = BSON.deserialize(response.subarray(LOCO_HEADER_SIZE)) as Document;
    if (result.status !== 0) throw new Error(`CHECKIN status ${String(result.status)}`);
    return {
      host: String(result.host ?? ""),
      port: Number(result.port ?? 0),
      csport: Number(result.csport ?? 0),
    };
  } finally { socket.destroy(); }
}

/** Send LOGINLIST to establish a LOCO session and get chat room list */
export async function loginList(sessionKey: Buffer, auth: AuthResult, host: string, port: number, appVer: string, deviceUuid: string): Promise<Document> {
  const socket = await connectSocket({ host, port });
  try {
    socket.write(createHandshake(sessionKey, sessionKey)); // LOCO server needs its own handshake
    const body = Buffer.from(BSON.serialize({
      os: "android",
      ntype: 0,
      appVer,
      MCCMNC: "999",
      prtVer: "1",
      duuid: deviceUuid,
      oauthToken: auth.accessToken,
      lang: "ko",
      dtype: 0,
      revision: 0,
      rp: Buffer.from([0x00, 0x00, 0xff, 0xff, 0x00, 0x00]),
      chatIds: [],
      maxIds: [],
      lastTokenId: 0,
      lastChatId: Long.ZERO,
      lbk: 0,
      bg: false,
    }));
    const packet = encodeHeader(1, "LOGINLIST", 0, body);
    const response = await sendAndReceive(socket, sessionKey, packet);
    if (response.length < LOCO_HEADER_SIZE) throw new Error("LOGINLIST response too short");
    const decoded = BSON.deserialize(response.subarray(LOCO_HEADER_SIZE)) as Document;
    if (decoded.status !== 0) throw new Error(`LOGINLIST status ${String(decoded.status)}`);
    return decoded;
  } finally { socket.destroy(); }
}

/** Full authentication & session: auth → CHECKIN → LOGINLIST */
export async function establishSession(config: SessionConfig): Promise<LocoSession> {
  const appVer = config.appVersion ?? "25.9.2";
  const publicKey = config.publicKey ?? await readFile(config.publicKeyPath ?? new URL("../../poc/02-checkin/public-key.pem", import.meta.url), "utf8");
  const deviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID ?? "0000000000000000000000000000000000000000000000000000000000000000";

  const sessionKey = randomBytes(16);
  try {
    const locoServer = await checkin(sessionKey, config.auth, publicKey, appVer);
    await loginList(sessionKey, config.auth, locoServer.host, locoServer.port, appVer, deviceUuid);
    return { userId: config.auth.userId, auth: config.auth, sessionKey, locoServer };
  } catch (error) {
    sessionKey.fill(0);
    throw error;
  }
}