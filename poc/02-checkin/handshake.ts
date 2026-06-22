import {
  constants,
  createPublicKey,
  KeyObject,
  publicEncrypt,
} from "node:crypto";
import { SESSION_KEY_SIZE } from "./aes.js";

export const RSA_ENCRYPTED_KEY_SIZE = 256;
export const HANDSHAKE_SIZE = 268;
export const KEY_ENCRYPT_TYPE = 15;
export const ENCRYPT_TYPE = 2;

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
