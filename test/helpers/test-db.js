import mongoose from "mongoose";
import {
  applyTestEnv,
  assertIsolatedTestUri,
  resolveTestMongoUri,
} from "./test-env.js";

applyTestEnv();

const serverSelectionTimeoutMS = 1500;

export const canReachTestDatabase = async (uri = resolveTestMongoUri()) => {
  assertIsolatedTestUri(uri);
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS,
      connectTimeoutMS: serverSelectionTimeoutMS,
    });
    await mongoose.connection.db?.admin().ping();
    return true;
  } catch {
    return false;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
};

// `node --test` runs test files in parallel, so every process gets its own
// database inside the configured test database name.
export const databaseNameForProcess = (uri = resolveTestMongoUri()) =>
  `${assertIsolatedTestUri(uri)}-p${process.pid}`;

export const connectTestDatabase = async ({
  uri = resolveTestMongoUri(),
  dbName = databaseNameForProcess(uri),
} = {}) => {
  const target = uri.replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`);
  const name = assertIsolatedTestUri(target);

  await mongoose.connect(target, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });
  await mongoose.connection.db?.admin().ping();

  return { uri: target, name, connection: mongoose.connection };
};

export const clearTestDatabase = async () => {
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  const collections = await mongoose.connection.db.collections();
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
};

export const disconnectTestDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

export const withTestDatabase = async (run, options) => {
  const connection = await connectTestDatabase(options);
  try {
    await clearTestDatabase();
    return await run(connection);
  } finally {
    await disconnectTestDatabase();
  }
};
