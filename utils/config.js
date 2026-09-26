import dotenv from "dotenv";

dotenv.config();

const requiredEnvironmentVariables = [
  "NODE_ENV",
  "MONGO_URI",
  "SESSION_SECRET",
  "CLIENT_ID",
  "CLIENT_SECRET",
  "CALLBACK_URL",
  "MAIL_USER",
  "MAIL_PASSWORD",
  "MAIL_FROM",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "RAZOR_KEY_ID",
  "RAZOR_SECRET_ID",
];

const readEnv = (name) => {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
};

const requireEnv = (name) => {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const assertRequiredEnv = () => {
  const missing = requiredEnvironmentVariables.filter(
    (name) => !readEnv(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
};

export {
  assertRequiredEnv,
  readEnv,
  requireEnv,
  requiredEnvironmentVariables,
};
