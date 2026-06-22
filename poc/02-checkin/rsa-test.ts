import assert from "node:assert/strict";
import { constants, createHash, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

const SOURCE_COMMIT = "7e8bcc34d6c2d994ff32b482bc649e8b51382255";
const publicKeyPem = await readFile(new URL("./public-key.pem", import.meta.url), "utf8");
const publicKey = createPublicKey(publicKeyPem);
const details = publicKey.asymmetricKeyDetails;
const publicKeyDer = publicKey.export({ format: "der", type: "spki" });
const fingerprint = createHash("sha256").update(publicKeyDer).digest("hex");

assert.equal(publicKey.asymmetricKeyType, "rsa");
assert.equal(details?.modulusLength, 2048);
assert.equal(details?.publicExponent, 3n);
assert.equal(fingerprint, "3257fd9e3e544be46090b16aea6aac39a00cdba1078a3ba1cf040b1f3ebdad97");

const sessionKey = randomBytes(16);
const encryptedKey = publicEncrypt(
  {
    key: publicKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha1",
  },
  sessionKey,
);

assert.equal(encryptedKey.length, 256);
assert.notDeepEqual(encryptedKey.subarray(0, sessionKey.length), sessionKey);

console.log("RSA public key: 2048-bit, e=3");
console.log("RSA-OAEP SHA-1 encryption: OK (256-byte ciphertext)");
console.log(`Key source: KiwiTalk commit ${SOURCE_COMMIT}`);
