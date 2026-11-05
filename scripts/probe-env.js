// Puts the hand-run probe and walkthrough scripts on their own database.
//
// These scripts boot the real application and then seed it: a probe signs up,
// adds categories and products, and deletes and renames them to reach the states
// it wants to ask about. They used to do that against whatever database the
// environment named, which is the same database the developer's own server uses
// and, on a machine with a cloud `MONGO_URI`, the deployed one. Running a probe
// then quietly wrote "Probe Category ..." rows and test products into real data.
//
// So the database is chosen here, before any model is imported, and it is never
// the configured one: a `TEST_MONGO_URI` is used as given (a test run expects the
// name to say `test`), and otherwise the configured `MONGO_URI` is reread as a
// sibling named after it plus `-probe`. The guard below refuses anything whose
// name does not say test or probe, so a future edit cannot point these back at a
// real database without failing loudly first.
import { readEnv } from "../utils/config.js";

const databaseNameOf = (uri) => {
  const withoutQuery = uri.split("?")[0];
  const match = withoutQuery.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/]+)$/);
  return match ? match[1] : "";
};

const withDatabaseName = (uri, name) => {
  const [withoutQuery, query] = uri.split("?");
  const match = withoutQuery.match(/^(mongodb(?:\+srv)?:\/\/[^/]+\/)[^/]+$/);
  if (!match) {
    throw new Error(
      `Cannot choose a probe database: MONGO_URI has no database name to replace.`,
    );
  }
  return `${match[1]}${name}${query ? `?${query}` : ""}`;
};

const isScratchDatabase = (name) => /(?:^|[-_.])test|probe/i.test(name);

const configured = readEnv("TEST_MONGO_URI") || readEnv("MONGO_URI");
if (!configured) {
  throw new Error(
    "No database to run against: set TEST_MONGO_URI, or MONGO_URI in .env.",
  );
}

const configuredName = databaseNameOf(configured);
if (!configuredName) {
  throw new Error(
    "Cannot choose a probe database: the configured MONGO_URI names no database.",
  );
}

const probeName = isScratchDatabase(configuredName)
  ? configuredName
  : `${configuredName}-probe`;
const probeUri = withDatabaseName(configured, probeName);
const finalName = databaseNameOf(probeUri);

if (!isScratchDatabase(finalName)) {
  throw new Error(
    `Refusing to run probes against "${finalName}": the database name must say test or probe.`,
  );
}

// Set before server.js is imported, so the connection reads it. `.env` is still
// loaded through utils/config.js, and dotenv does not overwrite a variable that
// is already set, so this value is the one the app connects with.
process.env.MONGO_URI = probeUri;

export { probeUri, finalName as probeName };
