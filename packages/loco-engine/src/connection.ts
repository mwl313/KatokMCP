/**
 * Persistent LOCO connection — maintains a single TCP connection
 * for multiple commands (LOGINLIST, LCHATLIST, SYNCMSG, PING).
 * 
 * Without this, each command creates a new connection + handshake,
 * which causes -201 error ("unknown session").
 */

import net from "node:net";
import { once } from "node:events";
import { createHandshake } from "./crypto/handshake.js";
import { encryptLocoFrame, decryptLocoFrame, SECURE_FRAME_HEADER_SIZE } from "./crypto/aes.js";
import { connectSocket, MAX_FRAME_SIZE, DEFAULT_TIMEOUT_MS } from "./transport/socket.js";

export class LocoConnection {
  private socket: net.Socket | null = null;
  private sessionKey: Buffer;
  private handshakeDone = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly publicKey: string,
  ) {
    this.sessionKey = Buffer.alloc(0); // will be set on connect
  }

  /** Connect to LOCO server and perform RSA handshake */
  async connect(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<void> {
    this.socket = await connectSocket({ host: this.host, port: this.port, timeoutMs });
    this.sessionKey = this.sessionKey.length === 16 ? this.sessionKey : require("node:crypto").randomBytes(16);
    this.socket.write(createHandshake(this.publicKey, this.sessionKey));
    this.handshakeDone = true;
  }

  /** Send a LOCO command and receive the response (reuses the same connection) */
  async command(packet: Buffer): Promise<Buffer> {
    if (!this.socket || !this.handshakeDone) throw new Error("LocoConnection: connect() must be called first");

    const frame = encryptLocoFrame(packet, this.sessionKey);
    this.socket.write(frame);

    // Read response
    let receivedBytes = Buffer.alloc(0);
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.socket!.off("data", onData);
        this.socket!.off("end", onEnd);
        this.socket!.off("error", onError);
      };
      const fail = (e: Error) => { cleanup(); reject(e); };
      const onError = (e: Error) => fail(e);
      const onEnd = () => fail(new Error("TCP connection ended before response"));
      const onData = (chunk: Buffer) => {
        receivedBytes = Buffer.concat([receivedBytes, chunk]);
        if (receivedBytes.length < SECURE_FRAME_HEADER_SIZE) return;
        const ps = receivedBytes.readUInt32LE(0);
        if (ps < 16 || ps > MAX_FRAME_SIZE) { fail(new Error(`invalid frame size: ${ps}`)); return; }
        const fs = 4 + ps;
        if (receivedBytes.length >= fs) {
          cleanup();
          try { resolve(decryptLocoFrame(receivedBytes.subarray(0, fs), this.sessionKey)); }
          catch (e) { fail(e instanceof Error ? e : new Error("decryption failed")); }
        }
      };
      const timer = setTimeout(() => fail(new Error(`Response timeout`)), DEFAULT_TIMEOUT_MS);
      this.socket!.on("data", onData);
      this.socket!.once("end", onEnd);
      this.socket!.once("error", onError);
    });
  }

  /** Get the session key (for logging / debugging) */
  getSessionKey(): Buffer {
    return this.sessionKey;
  }

  /** Close the connection and zero out session key */
  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.sessionKey.fill(0);
    this.handshakeDone = false;
  }

  /** Check if connection is still alive */
  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }
}