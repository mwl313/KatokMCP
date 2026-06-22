import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  createHandshake,
  ENCRYPT_TYPE,
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

console.log("Handshake layout: OK (268 bytes, key type 15, encrypt type 2)");
