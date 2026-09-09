import { getPreferredAdapter } from "../src/cryptoAdapter";
import { encryptVote, decryptVote, generateToken } from "../src/crypto";

const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const adapter = getPreferredAdapter();

console.log("Preferred adapter loaded:", adapter.constructor.name);

const token = generateToken();
console.log("Generated token:", token);

const payload = encryptVote("Option A", key);
console.log("Encrypted payload:", payload);

const decrypted = decryptVote(payload, key);
console.log("Decrypted vote:", decrypted);
