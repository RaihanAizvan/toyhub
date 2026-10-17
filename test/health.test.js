import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";

import { createHealthRouter } from "../utils/health.js";

// A deployment asks two questions of a running shop: is the process still
// serving, and would a real request work. The first must not touch the
// database, or a brief outage restarts every instance; the second must, or a
// load balancer keeps sending traffic to an instance that cannot read it. These
// tests mount the router the server mounts, once for each answer.
const start = async (isReady) => {
  const app = express();
  app.use(createHealthRouter({ isReady }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      }),
  };
};

describe("deployment probes", () => {
  let ready;
  let notReady;

  before(async () => {
    ready = await start(() => true);
    notReady = await start(() => false);
  });

  after(async () => {
    await ready?.close();
    await notReady?.close();
  });

  it("liveness is ok whether or not the database is there", async () => {
    const up = await fetch(`${ready.baseUrl}/health`);
    assert.equal(up.status, 200);
    assert.deepEqual(await up.json(), { status: "ok" });

    const down = await fetch(`${notReady.baseUrl}/health`);
    assert.equal(down.status, 200);
    assert.deepEqual(await down.json(), { status: "ok" });
  });

  it("readiness is 200 once the database answers", async () => {
    const response = await fetch(`${ready.baseUrl}/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ready" });
  });

  it("readiness is 503, with a defined body, while the database is away", async () => {
    const response = await fetch(`${notReady.baseUrl}/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "unavailable" });
  });
});