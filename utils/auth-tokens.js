import bcrypt from "bcrypt";
import crypto from "node:crypto";

export const TOKEN_BYTES = 32;
export const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;

export const randomToken = (bytes = TOKEN_BYTES) =>
  crypto.randomBytes(bytes).toString("hex");

export const randomNumericOtp = () =>
  crypto.randomInt(100000, 1000000).toString();

export const hashToken = (token) =>
  crypto
    .createHash("sha256")
    .update(String(token ?? ""), "utf8")
    .digest("hex");

export const safeEqual = (left, right) => {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
};

export const isTokenUsable = ({
  tokenHash,
  expiresAt,
  usedAt,
  now = Date.now(),
}) =>
  Boolean(
    tokenHash &&
      !usedAt &&
      expiresAt instanceof Date &&
      expiresAt.getTime() > now,
  );

const DUMMY_PASSWORD_HASH =
  "$2b$12$C6UzMDM.H6dfI/f/IKcEeO1s2SJx1n5Aq0PmYy2vHqXwZlF1pUuF9S";

export const hashPassword = (password, rounds = 12) =>
  bcrypt.hash(String(password), rounds);

export const verifyPassword = (password, hash) =>
  bcrypt.compare(String(password ?? ""), String(hash ?? ""));

export const burnPasswordCompare = async (password) => {
  try {
    await bcrypt.compare(String(password ?? ""), DUMMY_PASSWORD_HASH);
  } catch {
    // A dummy comparison must never surface an error to the caller.
  }
  return false;
};

export const isBcryptHash = (value) =>
  typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);
