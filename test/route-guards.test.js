import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import adminRoutes from "../routes/adminRoute.js";
import cartRoutes from "../routes/cartRoute.js";
import checkoutRoutes from "../routes/checkoutRoute.js";
import profileRoutes from "../routes/profileRoutes.js";
import { injectCsrfFields } from "../utils/csrf.js";
import { applyTestEnv } from "./helpers/test-env.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

// The suites that prove one account cannot reach another's records all log in
// first. What none of them asks is the other end: that a route a later change
// adds under /account, /cart, /checkout or /admin is behind the guard at all.
// These mount the routers the server mounts, with no session, and ask each
// protected address. A guard that is dropped, or a route registered above the
// `router.use` that installs it, answers 200 here and fails.
//
// The guard is attached to the router, not repeated per route, so this is a
// statement about the routers as they are assembled - the same thing server.js
// mounts.
const protectedRoutes = [
  { mount: "/account", router: profileRoutes, paths: ["/", "/address", "/orders", "/wishlist", "/wallet"] },
  { mount: "/cart", router: cartRoutes, paths: ["/", "/addProduct", "/clear"] },
  {
    mount: "/checkout",
    router: checkoutRoutes,
    paths: ["/", "/create-razorpay-order", "/verify-payment", "/wallet"],
  },
  {
    mount: "/admin",
    router: adminRoutes,
    paths: ["/", "/product-list", "/addProduct", "/sales/weekly"],
  },
];

const buildApp = () => {
  const app = express();
  app.set("views", viewsDirectory);
  app.set("view engine", "ejs");
  app.set("layout", "./layouts/layout");
  app.use(expressLayouts);
  app.use(
    session({
      name: "toyhub.sid",
      secret: "g".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.locals.injectCsrfFields = injectCsrfFields;
  app.use((req, res, next) => {
    res.locals.toast = null;
    res.locals.flashMessage = null;
    res.locals.name = null;
    res.locals.csrfToken = "test-csrf-token";
    next();
  });

  for (const { mount, router } of protectedRoutes) {
    app.use(mount, router);
  }

  app.use((req, res) => res.status(599).send("reached no handler"));
  app.use((error, _req, res, _next) => {
    console.error("GUARD TEST ERROR:", error?.message);
    res.status(500).send("error");
  });

  return app;
};

let server;
let baseUrl;

before(async () => {
  server = buildApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
  }
});

// A request with no session. If a guard is missing, the controller behind it
// reaches for data that is not there; the timeout turns that hang into a fast,
// legible failure rather than a test run that never ends.
const anonymous = async (path, method = "GET") => {
  try {
    return await fetch(`${baseUrl}${path}`, {
      method,
      redirect: "manual",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    return { status: 0, headers: new Headers() };
  }
};

describe("every protected address turns an anonymous caller away", () => {
  for (const { mount, paths } of protectedRoutes) {
    for (const path of paths) {
      it(`GET ${mount}${path} is refused`, async () => {
        const response = await anonymous(`${mount}${path}`);

        assert.notEqual(
          response.status,
          200,
          `${mount}${path} answered an anonymous caller with a page`,
        );
        assert.notEqual(
          response.status,
          599,
          `${mount}${path} reached past the router with no guard`,
        );

        if (response.status === 302) {
          const location = response.headers.get("location") ?? "";
          assert.match(
            location,
            /\/login/,
            `${mount}${path} redirected to ${location || "nowhere"} rather than a login`,
          );
        } else {
          assert.ok(
            [401, 403].includes(response.status),
            `${mount}${path} answered ${response.status}, which is not a refusal`,
          );
        }
      });
    }
  }

  it("the admin login page itself is reachable without a session", async () => {
    // The negative control: the guard is on the router, so the routes registered
    // above it - the ones that get you a session - must still answer. If they
    // were guarded too, nobody could ever sign in.
    const response = await anonymous("/admin/login");

    assert.equal(response.status, 200, "the login page did not render");
  });
});