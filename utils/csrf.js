import crypto from "crypto";
import { safeEqual } from "./auth-tokens.js";

export const CSRF_FIELD_NAME = "_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";
export const CSRF_META_NAME = "csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TOKEN_BYTES = 32;

export const createCsrfToken = () =>
  crypto.randomBytes(TOKEN_BYTES).toString("hex");

// The token lives in the session, so it dies with the session: logging out,
// rotating the identifier or changing the password all invalidate it.
export const ensureCsrfToken = (req) => {
  if (!req.session) {
    return null;
  }
  if (!req.session.csrfToken) {
    req.session.csrfToken = createCsrfToken();
  }
  return req.session.csrfToken;
};

const originOf = (value) => {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const expectedOrigin = (req) => {
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : null;
};

// Browsers send Origin on cross-site state changing requests and Referer on
// older ones, so either header is enough to detect a foreign origin.
const submittedOrigin = (req) => {
  const origin = req.get("origin");
  if (origin && origin !== "null") {
    return origin;
  }
  return originOf(req.get("referer"));
};

export const readSubmittedToken = (req) => {
  const header = req.get(CSRF_HEADER_NAME);
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  const field = req.body?.[CSRF_FIELD_NAME];
  const value = Array.isArray(field) ? field[0] : field;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

export const isOriginTrusted = (req) => {
  const submitted = submittedOrigin(req);
  if (!submitted) {
    return true;
  }
  return submitted === expectedOrigin(req);
};

const wantsJson = (req) =>
  req.xhr === true ||
  req.get(CSRF_HEADER_NAME) !== undefined ||
  (req.get("accept") ?? "").includes("application/json");

const rejectRequest = (req, res) => {
  if (wantsJson(req)) {
    return res.status(403).json({
      success: false,
      error: "Invalid or missing CSRF token.",
    });
  }
  return res.status(403).render("403", {
    title: "Request blocked",
    status: 403,
  });
};

export const verifyCsrfRequest = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  if (!isOriginTrusted(req)) {
    return rejectRequest(req, res);
  }

  const sessionToken = req.session?.csrfToken;
  const submittedToken = readSubmittedToken(req);

  if (!sessionToken || !submittedToken || !safeEqual(sessionToken, submittedToken)) {
    return rejectRequest(req, res);
  }

  return next();
};

export const exposeCsrfToken = (req, res, next) => {
  res.locals.csrfToken = ensureCsrfToken(req);
  res.locals.csrfFieldName = CSRF_FIELD_NAME;
  res.locals.csrfHeaderName = CSRF_HEADER_NAME;
  next();
};

// Server rendered forms get the token without touching 40+ templates.
export const injectCsrfFields = (html, token) => {
  if (typeof html !== "string" || !token || !/<form\b/i.test(html)) {
    return html;
  }
  const field = `<input type="hidden" name="${CSRF_FIELD_NAME}" value="${token}">`;
  return html.replace(/<form\b[^>]*>/gi, (tag) => `${tag}${field}`);
};
