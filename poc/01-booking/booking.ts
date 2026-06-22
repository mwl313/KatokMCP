import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import tls from "node:tls";
import { BSON, type Document } from "bson";
import { decodeHeader, encodeHeader, LOCO_HEADER_SIZE } from "./header.js";

const HOST = "booking-loco.kakao.com";
const PORT = 443;
const TIMEOUT_MS = 10_000;
const MAX_BODY_SIZE = 10 * 1024 * 1024;
const fixtureDirectory = new URL("../fixtures/", import.meta.url);

const requestBody = Buffer.from(
  BSON.serialize({
    MCCMNC: "999",
    os: "win32",
    model: "",
  }),
);
const requestPacket = encodeHeader(1, "GETCONF", 0, requestBody);
let receivedBytes = Buffer.alloc(0);

function readPacket(socket: tls.TLSSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`GETCONF response timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", finish);
    };
    const finish = (error: Error, packet?: Buffer): void => {
      cleanup();
      if (packet) {
        resolve(packet);
      } else {
        reject(error);
      }
    };
    const onEnd = (): void => finish(new Error("TLS connection ended before a complete GETCONF response arrived"));
    const onData = (chunk: Buffer): void => {
      receivedBytes = Buffer.concat([receivedBytes, chunk]);
      if (receivedBytes.length < LOCO_HEADER_SIZE) {
        return;
      }

      const bodySize = receivedBytes.readUInt32LE(18);
      if (bodySize > MAX_BODY_SIZE) {
        finish(new Error(`GETCONF body exceeds ${MAX_BODY_SIZE} bytes`));
        return;
      }

      const packetSize = LOCO_HEADER_SIZE + bodySize;
      if (receivedBytes.length >= packetSize) {
        finish(new Error("unreachable"), receivedBytes.subarray(0, packetSize));
      }
    };

    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", finish);
  });
}

function requireTicketHosts(response: Document): string[] {
  const ticket = response.ticket;
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)) {
    throw new Error("GETCONF response does not contain a ticket document");
  }

  const ticketDocument = ticket as Document;
  const hostGroups = [ticketDocument.ssl, ticketDocument.v2sl, ticketDocument.lsl, ticketDocument.lsl6];
  const hosts = hostGroups.flatMap((group) =>
    Array.isArray(group) ? group.filter((host): host is string => typeof host === "string") : [],
  );
  if (hosts.length === 0) {
    throw new Error("GETCONF response ticket document has no server hosts");
  }
  return hosts;
}

async function writeSuccessFixtures(response: Document, responsePacket: Buffer): Promise<void> {
  await mkdir(fixtureDirectory, { recursive: true });
  await Promise.all([
    writeFile(new URL("getconf-response.json", fixtureDirectory), `${JSON.stringify(response, null, 2)}\n`),
    writeFile(
      new URL("getconf-packets.hex", fixtureDirectory),
      `REQUEST\n${requestPacket.toString("hex")}\n\nRESPONSE\n${responsePacket.toString("hex")}\n`,
    ),
  ]);
}

async function writeFailureLog(error: unknown): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const log = [
    message,
    "",
    "REQUEST HEX",
    requestPacket.toString("hex"),
    "",
    "RESPONSE HEX",
    receivedBytes.length > 0 ? receivedBytes.toString("hex") : "(none)",
    "",
  ].join("\n");
  await writeFile(new URL(`debug-${timestamp}.log`, import.meta.url), log);
}

async function main(): Promise<void> {
  const socket = tls.connect({ host: HOST, port: PORT, servername: HOST, rejectUnauthorized: true });
  socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error(`TLS socket timed out after ${TIMEOUT_MS}ms`)));

  try {
    await once(socket, "secureConnect");
    const responsePromise = readPacket(socket);
    socket.write(requestPacket);
    const responsePacket = await responsePromise;
    const decoded = decodeHeader(responsePacket);

    if (decoded.packetId !== 1 || decoded.method !== "GETCONF") {
      throw new Error(`unexpected response header: packetId=${decoded.packetId}, method=${decoded.method}`);
    }
    if (decoded.statusCode !== 0) {
      throw new Error(`GETCONF failed with status ${decoded.statusCode}`);
    }

    const response = BSON.deserialize(decoded.body);
    const ticketHosts = requireTicketHosts(response);
    await writeSuccessFixtures(response, responsePacket);

    console.log("TLS connection: OK");
    console.log(`GETCONF response: OK (${decoded.bodySize} BSON bytes)`);
    console.log(`Ticket hosts: ${ticketHosts.join(", ")}`);
  } finally {
    socket.end();
  }
}

try {
  await main();
} catch (error) {
  await writeFailureLog(error);
  throw error;
}
