/**
 * A-9: SYNCMSG — 특정 채팅방 메시지 내역 읽기
 * 
 * KiwiTalk 기준 BSON 구조:
 *   chatId: long, cur: long (watermark), max: long (max log id), cnt: int (count)
 * 
 * Response: { chatLogs: [{ logId, chatId, type, authorId, message, sendAt, ... }], isOK: bool }
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
  if (!Buffer.isBuffer(sessionKey) || sessionKey.length !== 16) throw new RangeError("sessionKey must be 16-byte Buffer");
}
function createHandshake(publicKeyPem: string, sessionKey: Buffer): Buffer {
  requireSessionKey(sessionKey);
  const keyObject = createPublicKey(publicKeyPem);
  const encryptedKey = publicEncrypt({ key: keyObject, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" }, sessionKey);
  if (encryptedKey.length !== RSA_ENCRYPTED_KEY_SIZE) throw new Error("expected 256-byte RSA ciphertext");
  const h = Buffer.allocUnsafe(HANDSHAKE_SIZE);
  h.writeUInt32LE(encryptedKey.length, 0); h.writeUInt32LE(15, 4); h.writeUInt32LE(2, 8);
  encryptedKey.copy(h, 12); return h;
}
function readSecureFrame(socket: net.Socket, sessionKey: Buffer): Promise<Buffer> {
  requireSessionKey(sessionKey);
  let b = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(t); socket.off("data", onData); socket.off("end", onEnd); socket.off("error", onError); };
    const fail = (e: Error) => { cleanup(); reject(e); };
    const onError = (e: Error) => fail(e);
    const onEnd = () => fail(new Error("TCP ended"));
    const onData = (chunk: Buffer) => {
      b = Buffer.concat([b, chunk]);
      if (b.length < SECURE_FRAME_HEADER_SIZE) return;
      const ps = b.readUInt32LE(0);
      if (ps < 16 || ps > MAX_FRAME_SIZE) { fail(new Error(`invalid size ${ps}`)); return; }
      const fs = 4 + ps;
      if (b.length >= fs) { cleanup(); try { resolve(decryptLocoFrame(b.subarray(0, fs), sessionKey)); } catch (e) { fail(e instanceof Error ? e : new Error("decrypt failed")); } }
    };
    const t = setTimeout(() => fail(new Error(`Timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    socket.on("data", onData); socket.once("end", onEnd); socket.once("error", onError);
  });
}
async function sendRecv(socket: net.Socket, sk: Buffer, pt: Buffer): Promise<Buffer> {
  requireSessionKey(sk);
  const f = encryptLocoFrame(pt, sk);
  const p = readSecureFrame(socket, sk);
  socket.write(f); return await p;
}
function decodeLong(v: any): bigint {
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  if (v && typeof v.high === "number") return (BigInt(v.high) << 32n) + BigInt(v.low >>> 0);
  return 0n;
}

async function main(): Promise<void> {
  const sessionKey = randomBytes(16);
  try {
    console.log("Auth..."); const creds = readAndroidCredentialsFromEnvironment();
    const auth = await loginAndroid(creds, { appVersion: process.env.KAKAO_ANDROID_APP_VERSION });
    console.log(`OK userId=${auth.userId}`);
    const publicKey = await readFile(new URL("../02-checkin/public-key.pem", import.meta.url), "utf8");
    const deviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID ?? "0";

    // CHECKIN
    console.log("CHECKIN...");
    const ts = net.createConnection({ host: TICKET_HOST, port: TICKET_PORT });
    ts.setNoDelay(true); ts.setTimeout(TIMEOUT_MS, () => ts.destroy(new Error("timeout")));
    let locoHost = "", locoPort = 0;
    try {
      await once(ts, "connect"); ts.write(createHandshake(publicKey, sessionKey));
      const resp = await sendRecv(ts, sessionKey, encodeHeader(1, "CHECKIN", 0, Buffer.from(BSON.serialize({
        userId: Long.fromBigInt(auth.userId), os: "android", ntype: 0, appVer: ANDROID_APP_VER,
        MCCMNC: "999", lang: "ko", countryISO: "KR", useSub: true, deviceName: "SM-X930",
      }))));
      const r = BSON.deserialize(resp.subarray(LOCO_HEADER_SIZE)) as Document;
      if (r.status !== 0) throw new Error(`CHECKIN status ${String(r.status)}`);
      locoHost = String(r.host ?? ""); locoPort = Number(r.port ?? 0);
      console.log(`CHECKIN OK: ${locoHost}:${locoPort}`);
    } finally { ts.destroy(); }

    // LOGINLIST
    console.log("LOGINLIST...");
    const lsk = randomBytes(16);
    const ls = net.createConnection({ host: locoHost, port: locoPort });
    ls.setNoDelay(true); ls.setTimeout(TIMEOUT_MS, () => ls.destroy(new Error("timeout")));
    let chatId = 0n, lastLogId = 0n;
    try {
      await once(ls, "connect"); ls.write(createHandshake(publicKey, lsk));
      const resp = await sendRecv(ls, lsk, encodeHeader(1, "LOGINLIST", 0, Buffer.from(BSON.serialize({
        os: "android", ntype: 0, appVer: ANDROID_APP_VER, MCCMNC: "999", prtVer: "1",
        duuid: deviceUuid, oauthToken: auth.accessToken, lang: "ko", dtype: 0, revision: 0,
        rp: Buffer.from([0x00, 0x00, 0xff, 0xff, 0x00, 0x00]),
        chatIds: [], maxIds: [], lastTokenId: 0, lastChatId: Long.ZERO, lbk: 0, bg: false,
      }))));
      const r = BSON.deserialize(resp.subarray(LOCO_HEADER_SIZE)) as Document;
      if (r.status !== 0) throw new Error(`LOGINLIST status ${String(r.status)}`);
      console.log("LOGINLIST OK");
      if (Array.isArray(r.chatDatas) && r.chatDatas.length > 0) {
        chatId = decodeLong(r.chatDatas[0].c ?? r.chatDatas[0].chatId ?? 0);
        lastLogId = decodeLong(r.chatDatas[0].ll ?? 0);
        console.log(`First chat: id=${chatId}, lastLogId=${lastLogId}`);
      }
    } finally { ls.destroy(); lsk.fill(0); }

    if (chatId === 0n) { console.log("No chat rooms found — SYNCMSG skipped"); return; }

    // SYNCMSG — fetch recent 30 messages from the first chat room
    console.log("\nSYNCMSG...");
    const ssk = randomBytes(16);
    const ss = net.createConnection({ host: locoHost, port: locoPort });
    ss.setNoDelay(true); ss.setTimeout(TIMEOUT_MS, () => ss.destroy(new Error("timeout")));
    try {
      await once(ss, "connect"); ss.write(createHandshake(publicKey, ssk));
      const body = Buffer.from(BSON.serialize({
        chatId: Long.fromBigInt(chatId),
        cur: Long.fromBigInt(0n),        // from beginning (or use lastLogId - N)
        max: Long.fromBigInt(lastLogId > 0n ? lastLogId : Long.MAX_UNSIGNED_VALUE.toBigInt()),
        cnt: 30,
      }));
      const pkt = encodeHeader(1, "SYNCMSG", 0, body);
      const resp = await sendRecv(ss, ssk, pkt);
      const r = BSON.deserialize(resp.subarray(LOCO_HEADER_SIZE)) as Document;
      console.log(`SYNCMSG status: ${String(r.status)}`);
      console.log(`isOK: ${r.isOK}`);

      if (Array.isArray(r.chatLogs)) {
        console.log(`Messages received: ${r.chatLogs.length}`);
        for (const log of r.chatLogs.slice(0, 5)) {
          const msg = (log.message ?? "").substring(0, 80);
          console.log(`  [${log.logId}] author=${log.authorId}: "${msg}"`);
        }
        if (r.chatLogs.length > 5) console.log(`  ... and ${r.chatLogs.length - 5} more`);
      }

      // Save fixture (masked)
      await mkdir(fixtureDirectory, { recursive: true });
      await writeFile(
        new URL("syncmsg-response.json", fixtureDirectory),
        JSON.stringify(r, (key, value) =>
          typeof value === "string" && (key.toLowerCase().includes("token") || key.toLowerCase().includes("session")) ? "***" : value, 2) + "\n"
      );
      console.log("A-9 SYNCMSG: ✅ PASSED");
    } finally { ss.destroy(); ssk.fill(0); }

  } catch (error) {
    console.error(error instanceof Error ? error.message : "SYNCMSG failed");
    process.exitCode = 1;
  } finally { sessionKey.fill(0); }
}
try { await main(); } catch (e) { console.error(String(e)); process.exitCode = 1; }