import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import express from "express";
import session from "express-session";
import adminMiddleware from "../middlewares/adminMiddleware.js";
import userMiddleware from "../middlewares/userMiddleware.js";

const createApp = () => {
  const app = express();

  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
    }),
  );

  app.get(
    "/account",
    userMiddleware.redirectToLoginIfNotAUser,
    (req, res) => res.status(200).send("account"),
  );
  app.get(
    "/admin",
    adminMiddleware.isAdmin,
    (req, res) => res.status(200).send("admin"),
  );

  return app;
};

describe("anonymous access protection", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = createApp().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("redirects anonymous user requests to login", async () => {
    const response = await fetch(`${baseUrl}/account`, {
      redirect: "manual",
      headers: { accept: "text/html" },
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/user/login");
  });

  it("returns a JSON 403 for Axios-style user requests", async () => {
    const response = await fetch(`${baseUrl}/account`, {
      redirect: "manual",
      headers: { accept: "application/json" },
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { message: "Unauthorized" });
  });

  it("redirects anonymous admin requests to admin login", async () => {
    const response = await fetch(`${baseUrl}/admin`, {
      redirect: "manual",
      headers: { accept: "text/html" },
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/admin/login");
  });
});

describe("server session bootstrap", () => {
  it("does not assign request sessions in server.js", async () => {
    const source = await readFile(
      new URL("../server.js", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(source, /req\.session\.(?:user|sAdminEmail)\s*=/);
  });
});
