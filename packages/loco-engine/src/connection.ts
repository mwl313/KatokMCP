/**
 * Persistent LOCO connection — maintains a single TCP connection
 * for multiple commands (LOGINLIST, LCHATLIST, SYNCMSG, PING).
 * 
 * Without this, each command creates a new connection + handshake,
 * which causes -201 error ("unknown session").
 * 
 * Also buffers push data (MSG, KICKOUT, CHANGESVR) arriving when
 * no command() is active.
 */

import net from "node:net";
import { randomBytes } from "node:crypto";
import { createHandshake } from "./crypto/handshake.js";
import { encryptLocoFrame, decryptLocoFrame, SECURE_FRAME_HEADER_SIZE } from "./crypto/aes.js";
import { connectSocket, MAX_FRAME_SIZE, DEFAULT_TIMEOUT_MS } from "./transport/socket.js";

export class LocoConnection {
  private socket: net.Socket | null = null;
  private sessionKey: Buffer;
  private handshakeDone = false;
  /** Buffer for push data arriving when no command is active */
  private pushBuffer: Buffer[] = [];
  /** Buffer for in-progress command response */
  private responseBuffer = Buffer.alloc(0);
  /** Resolver for pending command response */
  private responseResolver: ((value: Buffer) => void) | null = null;
  /** Rejecter for pending command response */
  private responseRejecter: ((error: Error) => void) | null = null;
  /** Timeout timer for response waiting */
  private responseTimer: NodeJS.Timeout | null = null;
  /** Timeout for the connection */
  private timeoutMs: number;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly publicKey: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.sessionKey = Buffer.alloc(0);
    this.timeoutMs = timeoutMs;
  }

  /** Connect to LOCO server and perform RSA handshake */
  async connect(timeoutMs?: number): Promise<void> {
    this.timeoutMs = timeoutMs ?? this.timeoutMs;
    this.socket = await connectSocket({ host: this.host, port: this.port, timeoutMs: this.timeoutMs });
    this.sessionKey = randomBytes(16);
    this.socket.write(createHandshake(this.publicKey, this.sessionKey));
    this.handshakeDone = true;

    // Listen for data — route to response or push buffer
    this.socket.on("data", (chunk: Buffer) => this.onData(chunk));
    this.socket.on("end", () => {
      if (this.responseRejecter) {
        this.responseRejecter(new Error("Connection closed by server"));
        this.cleanupResponse();
      }
    });
    this.socket.on("error", (err) => {
      if (this.responseRejecter) {
        this.responseRejecter(err);
        this.cleanupResponse();
      }
    });
  }

  /** Handle incoming data — route to response resolver or push buffer */
  private onData(chunk: Buffer): void {
    if (this.responseResolver) {
      // We're waiting for a command response
      this.responseBuffer = Buffer.concat([this.responseBuffer, chunk]);
      this.tryResolveResponse();
    } else {
      // No pending command — this is a push event
      this.pushBuffer.push(chunk);
    }
  }

  /** Try to complete a pending command response */
  private tryResolveResponse(): void {
    if (this.responseBuffer.length < SECURE_FRAME_HEADER_SIZE) return;
    const payloadSize = this.responseBuffer.readUInt32LE(0);
    if (payloadSize < 16 || payloadSize > MAX_FRAME_SIZE) {
      this.failResponse(new Error(`invalid frame size: ${payloadSize}`));
      return;
    }
    const frameSize = 4 + payloadSize;
    if (this.responseBuffer.length >= frameSize) {
      const frame = this.responseBuffer.subarray(0, frameSize);
      // Move remaining data to push buffer (TCP frame boundary)
      const remainder = this.responseBuffer.subarray(frameSize);
      this.responseBuffer = Buffer.alloc(0);
      if (remainder.length > 0) {
        this.pushBuffer.push(remainder);
      }
      try {
        const plaintext = decryptLocoFrame(frame, this.sessionKey);
        this.resolveResponse(plaintext);
      } catch (error) {
        this.failResponse(error instanceof Error ? error : new Error("decryption failed"));
      }
    }
  }

  private resolveResponse(data: Buffer): void {
    const resolver = this.responseResolver;
    this.cleanupResponse();
    if (resolver) resolver(data);
  }

  private failResponse(error: Error): void {
    const rejecter = this.responseRejecter;
    this.cleanupResponse();
    if (rejecter) rejecter(error);
  }

  private cleanupResponse(): void {
    this.responseResolver = null;
    this.responseRejecter = null;
    this.responseBuffer = Buffer.alloc(0);
    if (this.responseTimer) {
      clearTimeout(this.responseTimer);
      this.responseTimer = null;
    }
  }

  /** Send a LOCO command and receive the response */
  async command(packet: Buffer): Promise<Buffer> {
    if (!this.socket || !this.handshakeDone) throw new Error("connect() must be called first");
    if (this.responseResolver) throw new Error("Another command is already in progress");

    return new Promise<Buffer>((resolve, reject) => {
      this.responseResolver = resolve;
      this.responseRejecter = reject;
      this.responseBuffer = Buffer.alloc(0);

      // Set timeout
      this.responseTimer = setTimeout(() => {
        this.failResponse(new Error(`Command timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      // Send encrypted frame
      const frame = encryptLocoFrame(packet, this.sessionKey);
      this.socket!.write(frame);
    });
  }

  /**
   * Read buffered push data.
   * Push data arrives when no command() is active.
   * Returns an array of decrypted frames.
   */
  readPushBuffer(): Buffer[] {
    const results: Buffer[] = [];
    const combined = Buffer.concat(this.pushBuffer);
    this.pushBuffer = [];

    let offset = 0;
    while (offset < combined.length) {
      if (combined.length - offset < SECURE_FRAME_HEADER_SIZE) {
        // Incomplete frame — put back
        this.pushBuffer.push(combined.subarray(offset));
        break;
      }
      const payloadSize = combined.readUInt32LE(offset);
      if (payloadSize < 16 || payloadSize > MAX_FRAME_SIZE) break;
      const frameSize = 4 + payloadSize;
      if (combined.length - offset < frameSize) {
        // Incomplete frame — put back
        this.pushBuffer.push(combined.subarray(offset));
        break;
      }
      const frame = combined.subarray(offset, offset + frameSize);
      try {
        const plaintext = decryptLocoFrame(frame, this.sessionKey);
        results.push(plaintext);
      } catch { /* skip corrupt push data */ }
      offset += frameSize;
    }
    return results;
  }

  /** Consume push data remaining in the in-progress response buffer after timeout as push */
  flushPendingAsPush(): void {
    if (this.responseBuffer.length > 0) {
      this.pushBuffer.push(this.responseBuffer);
      this.responseBuffer = Buffer.alloc(0);
    }
  }

  getSessionKey(): Buffer {
    return this.sessionKey;
  }

  close(): void {
    this.cleanupResponse();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.sessionKey.fill(0);
    this.handshakeDone = false;
    this.pushBuffer = [];
    this.responseBuffer = Buffer.alloc(0);
  }

  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }
}