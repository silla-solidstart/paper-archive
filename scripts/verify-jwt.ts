/**
 * Proves the Web Crypto JWT path works, using a throwaway RSA key.
 * The real service-account key is never needed — or touched — to run this.
 *
 *   node scripts/verify-jwt.ts
 */
import { generateKeyPairSync, createVerify } from "node:crypto";
import { base64url, pemToPkcs8 } from "../src/google-auth.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

// Simulate how the key actually arrives from an env var: literal \n, not newlines.
const envStylePem = privateKey.replace(/\n/g, "\\n");

const header = { alg: "RS256", typ: "JWT" };
const claims = {
  iss: "paper-archive-worker@solidstart-paper-archive.iam.gserviceaccount.com",
  scope: "https://www.googleapis.com/auth/cloud-platform",
  aud: "https://oauth2.googleapis.com/token",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

const key = await crypto.subtle.importKey(
  "pkcs8",
  pemToPkcs8(envStylePem),
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  false,
  ["sign"],
);

const sigBuf = await crypto.subtle.sign(
  "RSASSA-PKCS1-v1_5",
  key,
  new TextEncoder().encode(signingInput),
);

const jwt = `${signingInput}.${base64url(sigBuf)}`;

// Verify independently with Node's crypto, i.e. not with the code under test.
const sig = Buffer.from(
  jwt.split(".")[2].replace(/-/g, "+").replace(/_/g, "/"),
  "base64",
);
const ok = createVerify("RSA-SHA256").update(signingInput).end().verify(publicKey, sig);

// Round-trip the claims to confirm base64url encoding is not lossy.
const decoded = JSON.parse(
  Buffer.from(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
);

console.log("literal-\\n PEM parsed :", "ok");
console.log("signature verifies    :", ok);
console.log("claims round-trip     :", decoded.iss === claims.iss && decoded.aud === claims.aud);
console.log("segments              :", jwt.split(".").length);

if (!ok || decoded.iss !== claims.iss) process.exit(1);
console.log("\nJWT signing path verified.");
