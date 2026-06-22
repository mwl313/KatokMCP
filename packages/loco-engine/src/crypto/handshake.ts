/**
 * RSA-2048 OAEP SHA-1 handshake packet creation for LOCO CHECKIN.
 * 
 * Packet format (268 bytes fixed):
 *   [key_size: 4 LE = 256]
 *   [key_encrypt_type: 4 LE = 15 (0x0F)]
 *   [encrypt_type: 4 LE = 2 (AES-128-CFB)]
 *   [encrypted_key: 256 bytes]
 */

import { constants, createPublicKey, KeyObject, publicEncrypt } from "node:crypto";
import { SESSION_KEY_SIZE } from "./aes.js";

export const RSA_ENCRYPTED_KEY_SIZE = 256;
export const HANDSHAKE_SIZE = 268;
export const KEY_ENCRYPT_TYPE = 15;
export const ENCRYPT_TYPE = 2;

/** Create a 268-byte RSA handshake packet for LOCO CHECKIN */
export function createHandshake(publicKey: string | Buffer | KeyObject, sessionKey: Buffer): Buffer {
  requireSessionKey(sessionKey);
  const keyObject = publicKey instanceof KeyObject ? publicKey : createPublicKey(publicKey);
  const encryptedKey = publicEncrypt(
    { key: keyObject, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
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

function requireSessionKey(sessionKey: Buffer): void {
  if (!Buffer.isBuffer(sessionKey) || sessionKey.length !== SESSION_KEY_SIZE) {
    throw new RangeError(`sessionKey must be a ${SESSION_KEY_SIZE}-byte Buffer`);
  }
}