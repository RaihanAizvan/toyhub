import { requiredEnvironmentVariables } from "../../utils/config.js";

export const TEST_MONGO_URI_KEY = "TEST_MONGO_URI";

export const defaultTestMongoUri =
  "mongodb://127.0.0.1:27017/toyhub-test";

const baseTestEnv = {
  NODE_ENV: "test",
  SESSION_SECRET: "test-session-secret-not-used-in-production-0123456789",
  CLIENT_ID: "test-google-client-id",
  CLIENT_SECRET: "test-google-client-secret",
  CALLBACK_URL: "http://localhost:3000/auth/google/callback",
  MAIL_USER: "test-mail-user@example.invalid",
  MAIL_PASSWORD: "test-mail-password",
  MAIL_FROM: "test-mail-user@example.invalid",
  CLOUDINARY_CLOUD_NAME: "test-cloud",
  CLOUDINARY_API_KEY: "test-cloudinary-key",
  CLOUDINARY_API_SECRET: "test-cloudinary-secret",
  RAZOR_KEY_ID: "test-razor-key-id",
  RAZOR_SECRET_ID: "test-razor-secret-id",
};

export const buildTestEnv = (overrides = {}, env = process.env) => ({
  ...baseTestEnv,
  MONGO_URI: env[TEST_MONGO_URI_KEY] || defaultTestMongoUri,
  ...overrides,
});

export const applyTestEnv = (overrides = {}) => {
  const env = buildTestEnv(overrides);
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) {
      process.env[name] = String(value);
    }
  }
  return env;
};

export const spawnEnv = (overrides = {}, base = process.env) => ({
  ...base,
  ...buildTestEnv(overrides, base),
});

export const resolveTestMongoUri = (env = process.env) =>
  env[TEST_MONGO_URI_KEY] || defaultTestMongoUri;

export const databaseNameFromUri = (uri) => {
  const withoutQuery = String(uri).split("?")[0];
  const afterHost = withoutQuery.slice(withoutQuery.indexOf("//") + 2);
  const segments = afterHost.split("/");
  return segments.length > 1 ? decodeURIComponent(segments.slice(1).join("/")) : "";
};

export const assertIsolatedTestUri = (uri) => {
  const name = databaseNameFromUri(uri);
  if (!name) {
    throw new Error(
      `Refusing to use a MongoDB URI without a database name: ${uri}`,
    );
  }
  if (!/(^|[-_])test([-_]|$)/i.test(name)) {
    throw new Error(
      `Refusing to run tests against database "${name}". ` +
        "The database name must contain \"test\" so production data is never touched.",
    );
  }
  return name;
};

export const missingTestEnv = (env = process.env) => {
  applyTestEnv();
  return requiredEnvironmentVariables.filter((name) => !env[name]);
};
