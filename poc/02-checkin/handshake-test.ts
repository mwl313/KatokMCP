import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  createHandshake,
  decryptSecureFrame,
  ENCRYPT_TYPE,
  encryptSecureFrame,
  HANDSHAKE_SIZE,
  KEY_ENCRYPT_TYPE,
  RSA_ENCRYPTED_KEY_SIZE,
} from "./handshake.js";

const publicKey = await readFile(new URL("./public-key.pem", import.meta.url), "utf8");
const sessionKey = randomBytes(16);
const handshake = createHandshake(publicKey, sessionKey);

assert.equal(handshake.length, HANDSHAKE_SIZE);
assert.equal(handshake.readUInt32LE(0), RSA_ENCRYPTED_KEY_SIZE);
assert.equal(handshake.readUInt32LE(4), KEY_ENCRYPT_TYPE);
assert.equal(handshake.readUInt32LE(8), ENCRYPT_TYPE);

const plaintext = randomBytes(257);
const frame = encryptSecureFrame(plaintext, sessionKey);
assert.deepEqual(decryptSecureFrame(frame, sessionKey), plaintext);
assert.throws(() => decryptSecureFrame(frame.subarray(0, frame.length - 1), sessionKey), /length mismatch/);

console.log("Handshake layout: OK (268 bytes, key type 15, encrypt type 2)");
console.log("AES-128-CFB secure frame roundtrip: OK");
