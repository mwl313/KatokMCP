/**
 * Raw TCP socket utilities for LOCO protocol communication.
 */

import { once } from "node:events";
import net from "node:net";
import { decryptLocoFrame, encryptLocoFrame, SECURE_FRAME_HEADER_SIZE } from "../crypto/aes.js";

export const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_FRAME_SIZE = 16 * 1024 * 1024;

export interface SocketConfig {
  host: string;
  port: number;
  timeoutMs?: number;
}

/** Create a TCP connection with standard LOCO settings */
export async function connectSocket(config: SocketConfig): Promise<net.Socket> {
  const socket = net.createConnection({ host: config.host, port: config.port });
  socket.setNoDelay(true);
  const timeout = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  socket.setTimeout(timeout, () => socket.destroy(new Error(`TCP socket timed out after ${timeout}ms`)));
  await once(socket, "connect");
  return socket;
}

/** Read a complete AES-encrypted LOCO frame from socket */
export function readSecureFrame(socket: net.Socket, sessionKey: Buffer): Promise<Buffer> {
  let receivedBytes = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    };
    const fail = (error: Error): void => { cleanup(); reject(error); };
    const onError = (error: Error): void => fail(error);
    const onEnd = (): void => fail(new Error("TCP connection ended before a complete response arrived"));
    const onData = (chunk: Buffer): void => {
      receivedBytes = Buffer.concat([receivedBytes, chunk]);
      if (receivedBytes.length < SECURE_FRAME_HEADER_SIZE) return;
      const payloadSize = receivedBytes.readUInt32LE(0);
      if (payloadSize < 16 || payloadSize > MAX_FRAME_SIZE) {
        fail(new Error(`invalid secure frame payload size: ${payloadSize}`));
        return;
      }
      const frameSize = 4 + payloadSize;
      if (receivedBytes.length >= frameSize) {
        cleanup();
        const frame = receivedBytes.subarray(0, frameSize);
        try { resolve(decryptLocoFrame(frame, sessionKey)); }
        catch (error) { fail(error instanceof Error ? error : new Error("decryption failed")); }
      }
    };
    const timer = setTimeout(() => fail(new Error(`Response timed out`)), DEFAULT_TIMEOUT_MS);
    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("error", onError);
  });
}

/** Send a plaintext LOCO packet encrypted as AES frame, then read response */
export async function sendAndReceive(
  socket: net.Socket,
  sessionKey: Buffer,
  plaintext: Buffer,
): Promise<Buffer> {
  const frame = encryptLocoFrame(plaintext, sessionKey);
  const responsePromise = readSecureFrame(socket, sessionKey);
  socket.write(frame);
  return await responsePromise;
}