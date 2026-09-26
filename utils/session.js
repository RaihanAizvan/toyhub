import session from "express-session";
import MongoStore from "connect-mongo";

const ALLOWED_NODE_ENVS = ["development", "test", "staging", "production"];
const SECURE_NODE_ENVS = new Set(["staging", "production"]);
const ALLOWED_SAME_SITE = ["lax", "strict", "none"];
const DEFAULT_COOKIE_NAME = "toyhub.sid";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MIN_PRODUCTION_SECRET_LENGTH = 32;

const readValue = (env, name) => {
  const value = env?.[name];
  return typeof value === "string" ? value.trim() : "";
};

const readPositiveInteger = (env, name, fallback) => {
  const raw = readValue(env, name);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
};

const readTrustProxy = (env, secureEnvironment) => {
  const raw = readValue(env, "TRUST_PROXY").toLowerCase();
  if (!raw) {
    return secureEnvironment ? 1 : false;
  }
  if (raw === "true") {
    return 1;
  }
  if (raw === "false") {
    return false;
  }
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error("TRUST_PROXY must be a boolean or a non-negative integer");
  }
  return hops;
};

const readSameSite = (env) => {
  const raw = readValue(env, "SESSION_COOKIE_SAME_SITE").toLowerCase();
  if (!raw) {
    return "lax";
  }
  if (!ALLOWED_SAME_SITE.includes(raw)) {
    throw new Error(
      `SESSION_COOKIE_SAME_SITE must be one of: ${ALLOWED_SAME_SITE.join(", ")}`,
    );
  }
  return raw;
};

const readSecureOverride = (env) =>
  readValue(env, "SESSION_COOKIE_SECURE").toLowerCase() === "true";

const resolveSessionSettings = (env = process.env) => {
  const nodeEnv = readValue(env, "NODE_ENV").toLowerCase();
  if (!nodeEnv) {
    throw new Error("Missing required environment variable: NODE_ENV");
  }
  if (!ALLOWED_NODE_ENVS.includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be one of: ${ALLOWED_NODE_ENVS.join(", ")}`);
  }

  const secureEnvironment = SECURE_NODE_ENVS.has(nodeEnv);
  const secret = readValue(env, "SESSION_SECRET");
  if (!secret) {
    throw new Error("Missing required environment variable: SESSION_SECRET");
  }
  if (secureEnvironment && secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in ${nodeEnv}`,
    );
  }

  const sameSite = readSameSite(env);
  const secure = secureEnvironment || sameSite === "none" || readSecureOverride(env);

  return {
    nodeEnv,
    secureEnvironment,
    name: readValue(env, "SESSION_COOKIE_NAME") || DEFAULT_COOKIE_NAME,
    secret,
    sameSite,
    secure,
    maxAge: readPositiveInteger(env, "SESSION_MAX_AGE_MS", DEFAULT_MAX_AGE_MS),
    trustProxy: readTrustProxy(env, secureEnvironment),
  };
};

const buildSessionOptions = (settings, store) => ({
  name: settings.name,
  secret: settings.secret,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    secure: settings.secure,
    sameSite: settings.sameSite,
    maxAge: settings.maxAge,
    path: "/",
  },
});

const buildClearCookieOptions = (settings) => ({
  httpOnly: true,
  secure: settings.secure,
  sameSite: settings.sameSite,
  path: "/",
});

const createSessionStore = (settings, env = process.env) => {
  const mongoUrl = readValue(env, "MONGO_URI");
  if (!mongoUrl) {
    throw new Error("Missing required environment variable: MONGO_URI");
  }
  const store = new MongoStore({
    mongoUrl,
    collectionName: readValue(env, "SESSION_STORE_COLLECTION") || "sessions",
    ttl: Math.max(1, Math.floor(settings.maxAge / 1000)),
    autoRemove: "native",
  });
  store.collectionP?.catch?.((error) => {
    console.error(`Session store unavailable: ${error.message}`);
  });
  return store;
};

let storeInstance = null;

const getSessionStore = (env = process.env, settings = resolveSessionSettings(env)) => {
  if (!storeInstance) {
    storeInstance = createSessionStore(settings, env);
  }
  return storeInstance;
};

const createSessionMiddleware = (settings = resolveSessionSettings()) =>
  session(buildSessionOptions(settings, getSessionStore(process.env, settings)));

const clearSessionCookie = (res, settings = resolveSessionSettings()) => {
  res.clearCookie(settings.name, buildClearCookieOptions(settings));
  return settings.name;
};

const regenerateSession = (req) =>
  new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const destroyUserSessions = (store, userId) =>
  new Promise((resolve, reject) => {
    if (!store || typeof store.all !== "function" || !userId) {
      resolve(0);
      return;
    }
    const targetId = String(userId);
    store.all((error, sessions) => {
      if (error) {
        reject(error);
        return;
      }
      const sessionIds = Object.entries(sessions || {})
        .filter(([, value]) => {
          const owner = value?.user?.id;
          return owner !== undefined && owner !== null && String(owner) === targetId;
        })
        .map(([sessionId]) => sessionId);
      if (sessionIds.length === 0) {
        resolve(0);
        return;
      }
      Promise.all(
        sessionIds.map(
          (sessionId) =>
            new Promise((done, fail) => {
              store.destroy(sessionId, (destroyError) => {
                if (destroyError) {
                  fail(destroyError);
                  return;
                }
                done();
              });
            }),
        ),
      )
        .then(() => resolve(sessionIds.length))
        .catch(reject);
    });
  });

const invalidateUserSessions = async (userId, store = getSessionStore()) => {
  try {
    return await destroyUserSessions(store, userId);
  } catch (error) {
    console.error(`Failed to invalidate sessions for user ${userId}:`, error.message);
    return 0;
  }
};

export {
  DEFAULT_COOKIE_NAME,
  DEFAULT_MAX_AGE_MS,
  MIN_PRODUCTION_SECRET_LENGTH,
  buildClearCookieOptions,
  buildSessionOptions,
  clearSessionCookie,
  createSessionMiddleware,
  createSessionStore,
  destroyUserSessions,
  getSessionStore,
  invalidateUserSessions,
  regenerateSession,
  resolveSessionSettings,
};
