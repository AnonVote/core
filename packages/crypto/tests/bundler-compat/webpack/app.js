const {
  hashIdentifier,
  generateToken,
  hashToken,
  encryptVote,
  decryptVote,
} = require("@anonvote/crypto");

const id = "Voter@Example.com";
const idHash = hashIdentifier(id);
console.log("hashIdentifier:", idHash);

const token = generateToken();
console.log("generateToken length:", token.length);

const tokenHash = hashToken(token);
console.log("hashToken:", tokenHash);

const key = "a".repeat(64);
const encrypted = encryptVote("Yes", key);
console.log("encryptVote:", encrypted);

const decrypted = decryptVote(encrypted, key);
console.log("decryptVote:", decrypted);

if (decrypted !== "Yes") {
  console.error("MISMATCH: decrypted value does not match original vote");
  process.exit(1);
}

if (idHash.length !== 64 || tokenHash.length !== 64) {
  console.error("MISMATCH: hash length is not 64 hex chars (sha256)");
  process.exit(1);
}

console.log("WEBPACK BUNDLE TEST: ALL CHECKS PASSED");