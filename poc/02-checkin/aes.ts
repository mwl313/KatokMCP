import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const SESSION_KEY_SIZE = 16;
export const SECURE_FRAME_IV_SIZE = 16;
export const SECURE_FRAME_HEADER_SIZE = 4 + SECURE_FRAME_IV_SIZE;
export const MAX_SECURE_PLAINTEXT_SIZE = 16 * 1024 * 1024;

function requireSessionKey(sessionKey: Buffer): void {
  if (!Buffer.isBuffer(sessionKey) || sessionKey.length !== SESSION_KEY_SIZE) {
    throw new RangeError(`sessionKey must be a ${SESSION_KEY_SIZE}-byte Buffer`);
  }
}

export function encryptLocoFrame(
  plaintext: Buffer,
  sessionKey: Buffer,
  iv: Buffer = randomBytes(SECURE_FRAME_IV_SIZE),
): Buffer {
  requireSessionKey(sessionKey);
  if (!Buffer.isBuffer(plaintext)) {
    throw new TypeError("plaintext must be a Buffer");
  }
  if (plaintext.length > MAX_SECURE_PLAINTEXT_SIZE) {
    throw new RangeError(`plaintext cannot exceed ${MAX_SECURE_PLAINTEXT_SIZE} bytes`);
  }
  if (!Buffer.isBuffer(iv) || iv.length !== SECURE_FRAME_IV_SIZE) {
    throw new RangeError(`iv must be a ${SECURE_FRAME_IV_SIZE}-byte Buffer`);
  }

  const cipher = createCipheriv("aes-128-cfb", sessionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const frame = Buffer.allocUnsafe(SECURE_FRAME_HEADER_SIZE + ciphertext.length);
  frame.writeUInt32LE(SECURE_FRAME_IV_SIZE + ciphertext.length, 0);
  iv.copy(frame, 4);
  ciphertext.copy(frame, SECURE_FRAME_HEADER_SIZE);
  return frame;
}

export function decryptLocoFrame(frame: Buffer, sessionKey: Buffer): Buffer {
  requireSessionKey(sessionKey);
  if (!Buffer.isBuffer(frame) || frame.length < SECURE_FRAME_HEADER_SIZE) {
    throw new RangeError(`frame must contain at least ${SECURE_FRAME_HEADER_SIZE} bytes`);
  }

  const payloadSize = frame.readUInt32LE(0);
  if (payloadSize < SECURE_FRAME_IV_SIZE) {
    throw new RangeError("secure frame payload size cannot be smaller than its IV");
  }
  if (payloadSize > SECURE_FRAME_IV_SIZE + MAX_SECURE_PLAINTEXT_SIZE) {
    throw new RangeError("secure frame payload exceeds the maximum size");
  }
  if (frame.length !== 4 + payloadSize) {
    throw new RangeError(`secure frame length mismatch: expected ${4 + payloadSize} bytes`);
  }

  const iv = frame.subarray(4, SECURE_FRAME_HEADER_SIZE);
  const ciphertext = frame.subarray(SECURE_FRAME_HEADER_SIZE);
  const decipher = createDecipheriv("aes-128-cfb", sessionKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
