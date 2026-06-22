import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  KeyObject,
  publicEncrypt,
  randomBytes,
} from "node:crypto";

export const SESSION_KEY_SIZE = 16;
export const RSA_ENCRYPTED_KEY_SIZE = 256;
export const HANDSHAKE_SIZE = 268;
export const KEY_ENCRYPT_TYPE = 15;
export const ENCRYPT_TYPE = 2;
export const SECURE_FRAME_HEADER_SIZE = 20;

function requireSessionKey(sessionKey: Buffer): void {
  if (!Buffer.isBuffer(sessionKey) || sessionKey.length !== SESSION_KEY_SIZE) {
    throw new RangeError(`sessionKey must be a ${SESSION_KEY_SIZE}-byte Buffer`);
  }
}

export function createHandshake(publicKey: string | Buffer | KeyObject, sessionKey: Buffer): Buffer {
  requireSessionKey(sessionKey);
  const keyObject = publicKey instanceof KeyObject ? publicKey : createPublicKey(publicKey);
  const encryptedKey = publicEncrypt(
    {
      key: keyObject,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha1",
    },
    sessionKey,
  );
  if (encryptedKey.length !== RSA_ENCRYPTED_KEY_SIZE) {
    throw new Error(`expected a ${RSA_ENCRYPTED_KEY_SIZE}-byte RSA ciphertext`);
  }

  const handshake = Buffer.allocUnsafe(HANDSHAKE_SIZE);
  handshake.writeUInt32LE(encryptedKey.length, 0);
  handshake.writeUInt32LE(KEY_ENCRYPT_TYPE, 4);
  handshake.writeUInt32LE(ENCRYPT_TYPE, 8);
  encryptedKey.copy(handshake, 12);
  return handshake;
}

export function encryptSecureFrame(
  plaintext: Buffer,
  sessionKey: Buffer,
  iv: Buffer = randomBytes(16),
): Buffer {
  requireSessionKey(sessionKey);
  if (!Buffer.isBuffer(plaintext)) {
    throw new TypeError("plaintext must be a Buffer");
  }
  if (!Buffer.isBuffer(iv) || iv.length !== 16) {
    throw new RangeError("iv must be a 16-byte Buffer");
  }

  const cipher = createCipheriv("aes-128-cfb", sessionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const frame = Buffer.allocUnsafe(SECURE_FRAME_HEADER_SIZE + ciphertext.length);
  frame.writeUInt32LE(iv.length + ciphertext.length, 0);
  iv.copy(frame, 4);
  ciphertext.copy(frame, SECURE_FRAME_HEADER_SIZE);
  return frame;
}

export function decryptSecureFrame(frame: Buffer, sessionKey: Buffer): Buffer {
  requireSessionKey(sessionKey);
  if (!Buffer.isBuffer(frame) || frame.length < SECURE_FRAME_HEADER_SIZE) {
    throw new RangeError(`frame must contain at least ${SECURE_FRAME_HEADER_SIZE} bytes`);
  }

  const payloadSize = frame.readUInt32LE(0);
  if (payloadSize < 16) {
    throw new RangeError("secure frame payload size cannot be smaller than its IV");
  }
  if (frame.length !== 4 + payloadSize) {
    throw new RangeError(`secure frame length mismatch: expected ${4 + payloadSize} bytes`);
  }

  const iv = frame.subarray(4, SECURE_FRAME_HEADER_SIZE);
  const ciphertext = frame.subarray(SECURE_FRAME_HEADER_SIZE);
  const decipher = createDecipheriv("aes-128-cfb", sessionKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
