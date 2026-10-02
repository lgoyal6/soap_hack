// Owner: Laksh. Provider access codes: shown to the firm once, stored only as a salted hash.
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

// No 0/O, 1/I/L: the firm reads these out over the phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newCode(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/** Codes are typed by people: ignore case, spaces and dashes. */
export const normCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function hashCode(code: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(normCode(code), salt, 32).toString("hex")}`;
}

export function checkCode(code: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const got = scryptSync(normCode(code), salt, 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
