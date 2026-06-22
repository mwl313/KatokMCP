import { once } from "node:events";
import { randomBytes, createPublicKey, publicEncrypt, constants } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { BSON, Long, type Document } from "bson";
import { decodeHeader, encodeHeader, LOCO_HEADER_SIZE } from "../01-booking/header.js";
import { decryptLocoFrame, encryptLocoFrame, SECURE_FRAME_HEADER_SIZE } from "../02-checkin/aes.js";
import { loginAndroid, readAndroidCredentialsFromEnvironment } from "./android-auth.js";
import type { AuthResult } from "./auth.js";

const TICKET_HOST = "ticket-loco.kakao.com";
const TICKET_PORT = 995;
const TIMEOUT_MS = 15_000;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;
const HANDSHAKE_SIZE = 268;
const RSA_ENCRYPTED_KEY_SIZE = 256;
const ANDROID_APP_VER = process.env.KAKAO_ANDROID_APP_VERSION ?? "25.9.2";

const fixtureDirectory = new URL("../fixtures/", import.meta.url);

if (!/^\d+\.\d+\.\d+$/.test(ANDROID_APP_VER)) {
  throw new Error("KAKAO_ANDROID_APP_VERSION must use the major.minor.patch format");
}

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
    const onEnd = (): void => fail(new Error("TCP connection ended before a complete response arrived"));
    const onData = (chunk: Buffer): void => {
      receivedBytes = Buffer.concat([receivedBytes, chunk]);
      if (receivedBytes.length < SECURE_FRAME_HEADER_SIZE) return;
      const payloadSize = receivedBytes.readUInt32LE(0);
      if (payloadSize < 16 || payloadSize > MAX_FRAME_SIZE) { fail(new Error(`invalid secure frame payload size: ${payloadSize}`)); return; }
      const frameSize = 4 + payloadSize;
      if (receivedBytes.length >= frameSize) {
        cleanup();
        const frame = receivedBytes.subarray(0, frameSize);
        try { resolve(decryptLocoFrame(frame, sessionKey)); } catch (error) { fail(error instanceof Error ? error : new Error("decryption failed")); }
      }
    };
    const timer = setTimeout(() => fail(new Error(`Response timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    socket.on("data", onData); socket.once("end", onEnd); socket.once("error", onError);
  });
}

async function sendAndReceiveSecure(socket: net.Socket, sessionKey: Buffer, plaintext: Buffer): Promise<Buffer> {
  requireSessionKey(sessionKey);
  const frame = encryptLocoFrame(plaintext, sessionKey);
  const responsePromise = readSecureFrame(socket, sessionKey);
  socket.write(frame);
  return await responsePromise;
}

function buildLoginListBody(auth: AuthResult): Buffer {
  const deviceUuid = process.env.KAKAO_ANDROID_DEVICE_UUID ?? "0000000000000000000000000000000000000000000000000000000000000000";
  return Buffer.from(BSON.serialize({
    os: "android",
    ntype: 0,
    appVer: ANDROID_APP_VER,
    MCCMNC: "999",
    prtVer: "1",
    duuid: deviceUuid,
    oauthToken: auth.accessToken,
    lang: "ko",
    dtype: 0,            // 2=pc, 0=mobile
    revision: 0,
    rp: Buffer.from([0x00, 0x00, 0xff, 0xff, 0x00, 0x00]),
    pcst: null,
    chatIds: [],
    maxIds: [],
    lastTokenId: 0,
    lastChatId: Long.ZERO,
    lbk: 0,
    bg: false,
  }));
}

function validateLoginListResponse(response: Document): void {
  if (response.status !== 0) {
    const safe = JSON.stringify(response, (key, value) =>
      typeof value === "string" && (key.toLowerCase().includes("token") || key.toLowerCase().includes("session")) ? "***" : value
    );
    throw new Error(`LOGINLIST response: ${safe}`);
  }
}

async function writeSuccessFixtures(response: Document, requestHex: string, responseDump: string): Promise<void> {
  await mkdir(fixtureDirectory, { recursive: true });
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response)) {
    if (typeof value === "string" && (key.toLowerCase().includes("token") || key.toLowerCase().includes("session"))) { masked[key] = "***"; } else { masked[key] = value; }
  }
  await Promise.all([
    writeFile(new URL("loginlist-response.json", fixtureDirectory), JSON.stringify(masked, null, 2) + "\n"),
    writeFile(new URL("loginlist-packets.hex", fixtureDirectory), ["REQUEST_HEX", requestHex, "", "RESPONSE_DUMP", responseDump, ""].join("\n")),
  ]);
}

async function writeFailureLog(error: unknown, requestHex: string, responseDump: string): Promise<void> {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  await writeFile(new URL(`debug-${ts}.log`, import.meta.url), [msg, "", "REQUEST_HEX", requestHex, "", "RESPONSE_DUMP", responseDump, ""].join("\n"));
}

async function doCheckin(socket: net.Socket, sessionKey: Buffer, auth: AuthResult): Promise<{ host: string; port: number; csport: number }> {
  const body = Buffer.from(BSON.serialize({
    userId: Long.fromBigInt(auth.userId),
    os: "android",
    ntype: 0,
    appVer: ANDROID_APP_VER,
    MCCMNC: "999",
    lang: "ko",
    countryISO: "KR",
    useSub: true,
    deviceName: "SM-X930",
  }));
  const packet = encodeHeader(1, "CHECKIN", 0, body);
  const resp = await sendAndReceiveSecure(socket, sessionKey, packet);
  if (resp.length < LOCO_HEADER_SIZE) throw new Error("CHECKIN response too short");
  const d = decodeHeader(resp);
  if (d.statusCode !== 0) throw new Error(`CHECKIN header status ${d.statusCode}`);
  const r = BSON.deserialize(d.body);
  if (r.status !== 0) throw new Error(`CHECKIN status ${String(r.status)}`);
  return { host: String(r.host ?? ""), port: Number(r.port ?? 0), csport: Number(r.csport ?? 0) };
}

async function doLoginList(socket: net.Socket, sessionKey: Buffer, auth: AuthResult): Promise<{ response: Document; respHex: string }> {
  const body = buildLoginListBody(auth);
  const packet = encodeHeader(1, "LOGINLIST", 0, body);
  const resp = await sendAndReceiveSecure(socket, sessionKey, packet);
  if (resp.length < LOCO_HEADER_SIZE) throw new Error("LOGINLIST response too short");
  const d = decodeHeader(resp);
  if (d.packetId !== 1 || d.method !== "LOGINLIST") throw new Error(`unexpected header: packetId=${d.packetId}, method=${d.method}`);
  if (d.statusCode !== 0) throw new Error(`LOGINLIST header status ${d.statusCode}`);
  return { response: BSON.deserialize(d.body), respHex: resp.toString("hex") };
}

async function tryLoginList(host: string, port: number, desc: string, publicKey: string, auth: AuthResult): Promise<Document | null> {
  const sk = randomBytes(16);
  const socket = net.createConnection({ host, port });
  socket.setNoDelay(true);
  socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("LOCO socket timed out")));
  try {
    await once(socket, "connect");
    console.log(`Connected to ${desc} (${host}:${port})`);
    socket.write(createHandshake(publicKey, sk));
    const pkt = encodeHeader(1, "LOGINLIST", 0, buildLoginListBody(auth));
    const reqHex = pkt.toString("hex");
    const { response, respHex } = await doLoginList(socket, sk, auth);
    console.log(`${desc}: OK, fields=${Object.keys(response).join(",")}`);
    await writeSuccessFixtures(response, reqHex, respHex);
    return response;
  } catch (error) {
    console.log(`${desc}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally { socket.destroy(); sk.fill(0); }
}

async function main(): Promise<void> {
  const sessionKey = randomBytes(16);
  try {
    console.log("Authenticating (Android)...");
    const creds = readAndroidCredentialsFromEnvironment();
    const auth = await loginAndroid(creds, { appVersion: process.env.KAKAO_ANDROID_APP_VERSION });
    console.log(`Auth OK: userId=${auth.userId}`);

    const publicKey = await readFile(new URL("../02-checkin/public-key.pem", import.meta.url), "utf8");

    console.log(`CHECKIN via ${TICKET_HOST}:${TICKET_PORT}...`);
    const ts = net.createConnection({ host: TICKET_HOST, port: TICKET_PORT });
    ts.setNoDelay(true);
    ts.setTimeout(TIMEOUT_MS, () => ts.destroy(new Error("TCP socket timed out")));
    let locoHost = "", locoPort = 0, locoCsPort = 0;
    try {
      await once(ts, "connect");
      ts.write(createHandshake(publicKey, sessionKey));
      const info = await doCheckin(ts, sessionKey, auth);
      locoHost = info.host; locoPort = info.port; locoCsPort = info.csport;
      console.log(`CHECKIN: host=${locoHost}:${locoPort}, csport=${locoCsPort}`);
    } finally { ts.destroy(); }

    const portsToTry: { port: number; desc: string }[] = [];
    if (locoPort > 0) portsToTry.push({ port: locoPort, desc: "LOCO main port" });
    if (locoCsPort > 0) portsToTry.push({ port: locoCsPort, desc: "LOCO CS port" });

    for (const { port, desc } of portsToTry) {
      const result = await tryLoginList(locoHost, port, desc, publicKey, auth);
      if (result !== null && result.status === 0) {
        const st = result.sessionToken ?? result.session ?? result.session_key;
        if (typeof st === "string") { process.env.KAKAO_SESSION_TOKEN = st; console.log("Session token stored"); }
        console.log("Phase A Go/No-Go gate: ✅ PASSED");
        return;
      }
    }
    throw new Error("LOGINLIST failed on all ports");
  } catch (error) {
    await writeFailureLog(error, "(see above)", "(see above)");
    throw error;
  } finally { sessionKey.fill(0); }
}

try { await main(); } catch (error) { console.error(error instanceof Error ? error.message : "LOGINLIST failed"); process.exitCode = 1; }