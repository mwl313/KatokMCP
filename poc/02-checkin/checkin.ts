import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { BSON, Long, type Document } from "bson";
import { decodeHeader, encodeHeader, LOCO_HEADER_SIZE } from "../01-booking/header.js";
import {
  createHandshake,
  decryptSecureFrame,
  encryptSecureFrame,
  SECURE_FRAME_HEADER_SIZE,
} from "./handshake.js";

const HOST = "ticket-loco.kakao.com";
const PORT = 995;
const APP_VERSION = process.env.KAKAO_APP_VERSION ?? "26.5.0";
const TIMEOUT_MS = 10_000;
const MAX_FRAME_SIZE = 16 * 1024 * 1024;
const fixtureDirectory = new URL("../fixtures/", import.meta.url);

if (!/^\d+\.\d+\.\d+$/.test(APP_VERSION)) {
  throw new Error("KAKAO_APP_VERSION must use the major.minor.patch format");
}

const publicKey = await readFile(new URL("./public-key.pem", import.meta.url), "utf8");
const sessionKey = randomBytes(16);
const handshake = createHandshake(publicKey, sessionKey);
const requestBody = Buffer.from(
  BSON.serialize({
    userId: Long.ONE,
    os: "win32",
    ntype: 0,
    appVer: APP_VERSION,
    MCCMNC: "999",
    lang: "ko",
    countryISO: "KR",
    useSub: true,
  }),
);
const requestPacket = encodeHeader(1, "CHECKIN", 0, requestBody);
const requestFrame = encryptSecureFrame(requestPacket, sessionKey);
let receivedBytes = Buffer.alloc(0);

function readSecureFrame(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onError = (error: Error): void => fail(error);
    const onEnd = (): void => fail(new Error("TCP connection ended before a complete CHECKIN response arrived"));
    const onData = (chunk: Buffer): void => {
      receivedBytes = Buffer.concat([receivedBytes, chunk]);
      if (receivedBytes.length < SECURE_FRAME_HEADER_SIZE) {
        return;
      }

      const payloadSize = receivedBytes.readUInt32LE(0);
      if (payloadSize < 16 || payloadSize > MAX_FRAME_SIZE) {
        fail(new Error(`invalid secure frame payload size: ${payloadSize}`));
        return;
      }

      const frameSize = 4 + payloadSize;
      if (receivedBytes.length >= frameSize) {
        cleanup();
        resolve(receivedBytes.subarray(0, frameSize));
      }
    };
    const timer = setTimeout(() => fail(new Error(`CHECKIN response timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);

    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
  });
}

function validateResponse(response: Document): void {
  if (response.status !== 0) {
    throw new Error(`CHECKIN response status is ${String(response.status)}`);
  }
  if (typeof response.host !== "string" || response.host.length === 0) {
    throw new Error("CHECKIN response does not contain a LOCO host");
  }
  if (typeof response.port !== "number" || !Number.isInteger(response.port) || response.port <= 0) {
    throw new Error("CHECKIN response does not contain a valid LOCO port");
  }
}

async function writeSuccessFixtures(response: Document, responseFrame: Buffer): Promise<void> {
  await mkdir(fixtureDirectory, { recursive: true });
  await Promise.all([
    writeFile(new URL("checkin-response.json", fixtureDirectory), `${JSON.stringify(response, null, 2)}\n`),
    writeFile(
      new URL("checkin-packets.hex", fixtureDirectory),
      [
        "HANDSHAKE (RSA-encrypted session key only)",
        handshake.toString("hex"),
        "",
        "REQUEST FRAME (encrypted)",
        requestFrame.toString("hex"),
        "",
        "RESPONSE FRAME (encrypted)",
        responseFrame.toString("hex"),
        "",
      ].join("\n"),
    ),
  ]);
}

async function writeFailureLog(error: unknown): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const log = [
    message,
    "",
    "HANDSHAKE HEX (RSA-encrypted session key only)",
    handshake.toString("hex"),
    "",
    "REQUEST FRAME HEX (encrypted)",
    requestFrame.toString("hex"),
    "",
    "RESPONSE FRAME HEX (encrypted)",
    receivedBytes.length > 0 ? receivedBytes.toString("hex") : "(none)",
    "",
  ].join("\n");
  await writeFile(new URL(`debug-${timestamp}.log`, import.meta.url), log);
}

async function main(): Promise<void> {
  const socket = net.createConnection({ host: HOST, port: PORT });
  socket.setNoDelay(true);
  socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error(`TCP socket timed out after ${TIMEOUT_MS}ms`)));

  try {
    await once(socket, "connect");
    const responsePromise = readSecureFrame(socket);
    socket.write(Buffer.concat([handshake, requestFrame]));
    const responseFrame = await responsePromise;
    const responsePacket = decryptSecureFrame(responseFrame, sessionKey);

    if (responsePacket.length < LOCO_HEADER_SIZE) {
      throw new Error("decrypted CHECKIN response is shorter than a LOCO header");
    }
    const decoded = decodeHeader(responsePacket);
    if (decoded.packetId !== 1 || decoded.method !== "CHECKIN") {
      throw new Error(`unexpected response header: packetId=${decoded.packetId}, method=${decoded.method}`);
    }
    if (decoded.statusCode !== 0) {
      throw new Error(`CHECKIN header status is ${decoded.statusCode}`);
    }

    const response = BSON.deserialize(decoded.body);
    validateResponse(response);
    await writeSuccessFixtures(response, responseFrame);

    console.log("TCP connection and secure handshake: OK");
    console.log(`CHECKIN response: OK (${decoded.bodySize} BSON bytes)`);
    console.log(`Assigned LOCO server: ${String(response.host)}:${String(response.port)}`);
  } finally {
    socket.destroy();
    sessionKey.fill(0);
  }
}

try {
  await main();
} catch (error) {
  await writeFailureLog(error);
  sessionKey.fill(0);
  throw error;
}
