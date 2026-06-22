import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BSON } from "bson";
import { decodeHeader, encodeHeader, LOCO_HEADER_SIZE } from "./header.js";

const sample = {
  os: "win32",
  version: "3.0.0",
  mccmnc: "45005",
  device: "codex-a1-test",
};

const bsonBody = Buffer.from(BSON.serialize(sample));
assert.deepEqual(BSON.deserialize(bsonBody), sample);

const packet = encodeHeader(1, "GETCONF", 0, bsonBody);
const decoded = decodeHeader(packet);

assert.equal(packet.length, LOCO_HEADER_SIZE + bsonBody.length);
assert.equal(decoded.packetId, 1);
assert.equal(decoded.statusCode, 0);
assert.equal(decoded.method, "GETCONF");
assert.equal(decoded.bodyType, 0);
assert.equal(decoded.bodySize, bsonBody.length);
assert.deepEqual(BSON.deserialize(decoded.body), sample);

assert.throws(() => encodeHeader(1, "METHOD-TOO-LONG", 0, Buffer.alloc(0)), RangeError);
assert.throws(() => decodeHeader(packet.subarray(0, packet.length - 1)), /incomplete/);

const fixtureDirectory = fileURLToPath(new URL("../fixtures/", import.meta.url));
await mkdir(fixtureDirectory, { recursive: true });
await Promise.all([
  writeFile(
    `${fixtureDirectory}/a1-getconf-packet.json`,
    `${JSON.stringify({ header: { packetId: 1, statusCode: 0, method: "GETCONF", bodyType: 0, bodySize: bsonBody.length }, body: sample }, null, 2)}\n`,
  ),
  writeFile(`${fixtureDirectory}/a1-getconf-packet.hex`, `${packet.toString("hex")}\n`),
]);

console.log("Header roundtrip: OK");
console.log("BSON roundtrip: OK");
console.log("Integrated GETCONF packet: OK");
console.log(`GETCONF hex dump: ${packet.toString("hex")}`);
