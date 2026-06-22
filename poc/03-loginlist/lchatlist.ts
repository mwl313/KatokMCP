/**
 * A-8: LCHATLIST — 채팅방 목록 상세 조회
 * 
 * LOGINLIST에서 받은 lastTokenId를 사용하여 paginated chat list 요청.
 * KiwiTalk 기준 BSON 구조:
 *   chatIds: [long, ...], maxIds: [long, ...], lastTokenId: long, lastChatId: long
 */

import { once } from "node:events";
import { randomBytes, createPublicKey, publicEncrypt, constants } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { BSON, Long, type Document } from "bson";
import { decodeHeader, encodeHeader, LOCO_HEADER_SIZE } from "../01-booking/header.js";
import { decryptLocoFrame, encryptLocoFrame, SECURE_FRAME_HEADER_SIZE } from "../02-checkin/aes.js";
import { loginAndroid, readAndroidCredentialsFromEnvironment } from "./android-auth.js";

const TICKET_HOST = "ticket-loco.kakao.com";
const TICKET_PORT = 995;
const TIMEOUT_MS = 15_000;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;
const HANDSHAKE_SIZE = 268;
const RSA_ENCRYPTED_KEY_SIZE = 256;
const ANDROID_APP_VER = process.env.KAKAO_ANDROID_APP_VERSION ?? "25.9.2";

const fixtureDirectory = new URL("../fixtures/", import.meta.url);

function requireSessionKey(sessionKey: Buffer): void {
  if (!Buffer.isBuffer(sessionKey) || sessionKey.length !== 16) {
    throw new RangeError("sessionKey must be a 16-byte Buffer");
  }
}

function createHandshake(publicKeyPem: string, sessionKey: Buffer): Buffer {
  requireSessionKey(sessionKey);
  const keyObject = createPublicKey(publicKeyPem);
  const encryptedKey = publicEncrypt(
    { key: keyObject, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    sessionKey,
  );
  if (encryptedKey.length !== RSA_ENCRYPTED_KEY_SIZE) {
    throw new Error(`expected a ${RSA_ENCRYPTED_KEY_SIZE}-byte RSA ciphertext`);
  }
  const handshake = Buffer.allocUnsafe(HANDSHAKE_SIZE);
  handshake.writeUInt32LE(encryptedKey.length, 0);
  handshake.writeUInt32LE(15, 4);
  handshake.writeUInt32LE(2, 8);
  encryptedKey.copy(handshake, 12);
  return handshake;
}

function readSecureFrame(socket: net.Socket, sessionKey: Buffer): Promise<Buffer> {
  requireSessionKey(sessionKey);
  let receivedBytes = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { clearTimeout(timer); socket.off("data", onData); socket.off("end", onEnd); socket.off("error", onError); };
    const fail = (error: Error): void => { cleanup(); reject(error); };
    const onError = (error: Error): void => fail(error);
    const onEnd = (): void => fail(new Error("TCP connection ended before response"));
    const onData = (chunk: Buffer): void => {
      receivedBytes = Buffer.concat([receivedBytes, chunk]);
      if (receivedBytes.length < SECURE_FRAME_HEADER_SIZE) return;
      const payloadSize = receivedBytes.readUInt32LE(0);
      if (payloadSize < 16 || payloadSize > MAX_FRAME_SIZE) { fail(new Error(`invalid size: ${payloadSize}`)); return; }
      const frameSize = 4 + payloadSize;
      if (receivedBytes.length >= frameSize) {
        cleanup();
        try { resolve(decryptLocoFrame(receivedBytes.subarray(0, frameSize), sessionKey)); }
        catch (error) { fail(error instanceof Error ? error : new Error("decryption failed")); }
      }
    };
    const timer = setTimeout(() => fail(new Error(`Timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    socket.on("data", onData); socket.once("end", onEnd); socket.once("error", onError);
  });
}

async function sendAndReceiveSecure(socket: net.Socket, sessionKey: Buffer, plaintext: Buffer): Promise<Buffer> {
  requireSessionKey(sessionKey);
  const frame = encryptLocoFrame(plaintext, sessionKey);
  const p = readSecureFrame(socket, sessionKey);
  socket.write(frame);
  return await p;
}

function decodeTwoLong(value: { high: number; low: number; unsigned?: boolean } | number | string): bigint {
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (value && typeof value.high === "number") {
    return (BigInt(value.high) << 32n) + BigInt(value.low >>> 0);
  }
  return 0n;
}

async function main(): Promise<void> {
  const sessionKey = randomBytes(16);
  let requestHex = "";
  let responseHex = "";

  try {
    // 1. Auth
    console.log("Authenticating...");
    const creds = readAndroidCredentialsFromEnvironment();
    const auth = await loginAndroid(creds, { appVersion: process.env.KAKAO_ANDROID_APP_VERSION });
    console.log(`Auth OK: userId=${auth.userId}`);

    // 2. Load public key
    const publicKey = await readFile(new URL("../02-checkin/public-key.pem", import.meta.url), "utf8");

    // 3. CHECKIN via ticket server
    console.log("CHECKIN...");
    const ticketSocket = net.createConnection({ host: TICKET_HOST, port: TICKET_PORT });
    ticketSocket.setNoDelay(true);
    ticketSocket.setTimeout(TIMEOUT_MS, () => ticketSocket.destroy(new Error("timeout")));
    let locoHost = "", locoPort = 0;
    try {
      await once(ticketSocket, "connect");
      ticketSocket.write(createHandshake(publicKey, sessionKey));
      const checkinBody = Buffer.from(BSON.serialize({
        userId: Long.fromBigInt(auth.userId), os: "android", ntype: 0, appVer: ANDROID_APP_VER,
        MCCMNC: "999", lang: "ko", countryISO: "KR", useSub: true, deviceName: "SM-X930",
      }));
      const checkinPkt = encodeHeader(1, "CHECKIN", 0, checkinBody);
      const checkinResp = await sendAndReceiveSecure(ticketSocket, sessionKey, checkinPkt);
      const checkinResult = BSON.deserialize(checkinResp.subarray(LOCO_HEADER_SIZE)) as Document;
      if (checkinResult.status !== 0) throw new Error(`CHECKIN status ${String(checkinResult.status)}`);
      locoHost = String(checkinResult.host ?? "");
      locoPort = Number(checkinResult.port ?? 0);
      console.log(`CHECKIN OK: ${locoHost}:${locoPort}`);
    } finally { ticketSocket.destroy(); }

    // 4. LOGINLIST to get initial chat list + pagination token
    console.log("LOGINLIST...");
    const locoSessionKey = randomBytes(16);
    const locoSocket = net.createConnection({ host: locoHost, port: locoPort });
    locoSocket.setNoDelay(true);
    locoSocket.setTimeout(TIMEOUT_MS, () => locoSocket.destroy(new Error("timeout")));
    let lastTokenId = 0n;
    let lastChatId = 0n;
    let chatIds: bigint[] = [];
    let maxIds: bigint[] = [];
    const deviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID ?? "0000000000000000000000000000000000000000000000000000000000000000";

    try {
      await once(locoSocket, "connect");
      locoSocket.write(createHandshake(publicKey, locoSessionKey));
      const loginBody = Buffer.from(BSON.serialize({
        os: "android", ntype: 0, appVer: ANDROID_APP_VER, MCCMNC: "999",
        prtVer: "1", duuid: deviceUuid, oauthToken: auth.accessToken, lang: "ko",
        dtype: 0, revision: 0, rp: Buffer.from([0x00, 0x00, 0xff, 0xff, 0x00, 0x00]),
        chatIds: [], maxIds: [], lastTokenId: 0, lastChatId: Long.ZERO, lbk: 0, bg: false,
      }));
      const loginPkt = encodeHeader(1, "LOGINLIST", 0, loginBody);
      const loginResp = await sendAndReceiveSecure(locoSocket, locoSessionKey, loginPkt);
      const loginResult = BSON.deserialize(loginResp.subarray(LOCO_HEADER_SIZE)) as Document;
      if (loginResult.status !== 0) throw new Error(`LOGINLIST status ${String(loginResult.status)}`);
      console.log("LOGINLIST OK");

      // Extract pagination data + chat info for LCHATLIST
      if (loginResult.lastTokenId) lastTokenId = decodeTwoLong(loginResult.lastTokenId);
      if (loginResult.lastChatId !== undefined) lastChatId = BigInt(loginResult.lastChatId);
      if (Array.isArray(loginResult.chatDatas)) {
        chatIds = loginResult.chatDatas.map((d: Document) => {
          const id = d.c ?? 0;
          return typeof id === "object" ? decodeTwoLong(id) : BigInt(id);
        });
        maxIds = loginResult.chatDatas.map((d: Document) => {
          const ll = d.ll ?? 0;
          return typeof ll === "object" ? decodeTwoLong(ll) : BigInt(ll as number);
        });
      }
      console.log(`Chats: ${chatIds.length}, lastTokenId=${lastTokenId}, eof=${loginResult.eof}`);

      // LOGINLIST had eof=true, meaning no more pages. But we can still test LCHATLIST
      // with the pagination token as a validation exercise.
      if (loginResult.eof) {
        console.log("LOGINLIST eof=true — no additional LCHATLIST pages needed");
        console.log("All chat rooms received in initial LOGINLIST response.");
      }

    } finally { locoSocket.destroy(); locoSessionKey.fill(0); }

    // 5. LCHATLIST test (page 2 — with pagination token)
    if (lastTokenId > 0n && !chatIds.every((id) => id === 0n)) {
      console.log("\nSending LCHATLIST (page 2)...");
      const lchatSessionKey = randomBytes(16);
      const lchatSocket = net.createConnection({ host: locoHost, port: locoPort });
      lchatSocket.setNoDelay(true);
      lchatSocket.setTimeout(TIMEOUT_MS, () => lchatSocket.destroy(new Error("timeout")));
      try {
        await once(lchatSocket, "connect");
        lchatSocket.write(createHandshake(publicKey, lchatSessionKey));
        const lchatBody = Buffer.from(BSON.serialize({
          chatIds: chatIds.map((v) => Long.fromBigInt(v)),
          maxIds: maxIds.map((v) => Long.fromBigInt(v)),
          lastTokenId: Long.fromBigInt(lastTokenId),
          lastChatId: Long.fromBigInt(lastChatId),
        }));
        const lchatPkt = encodeHeader(1, "LCHATLIST", 0, lchatBody);
        requestHex = lchatPkt.toString("hex");
        const lchatResp = await sendAndReceiveSecure(lchatSocket, lchatSessionKey, lchatPkt);
        const lchatResult = BSON.deserialize(lchatResp.subarray(LOCO_HEADER_SIZE)) as Document;
        responseHex = JSON.stringify(lchatResult, null, 2);

        console.log(`LCHATLIST status: ${String(lchatResult.status)}`);
        console.log(`ChatDatas in response: ${Array.isArray(lchatResult.chatDatas) ? lchatResult.chatDatas.length : 0}`);

        await mkdir(fixtureDirectory, { recursive: true });
        await writeFile(
          new URL("lchatlist-response.json", fixtureDirectory),
          JSON.stringify(lchatResult, (key, value) =>
            typeof value === "string" && (key.toLowerCase().includes("token") || key.toLowerCase().includes("session")) ? "***" : value, 2) + "\n"
        );

        if (lchatResult.status === 0) {
          console.log("A-8 LCHATLIST: ✅ PASSED");
        } else {
          console.log(`A-8 LCHATLIST status: ${String(lchatResult.status)}`);
        }
      } finally { lchatSocket.destroy(); lchatSessionKey.fill(0); }
    } else {
      console.log("No pagination token available — LCHATLIST test skipped (expected: LOGINLIST eof=true)");
    }

  } catch (error) {
    console.error(error instanceof Error ? error.message : "LCHATLIST failed");
    process.exitCode = 1;
  } finally { sessionKey.fill(0); }
}

try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "Fatal"); process.exitCode = 1; }