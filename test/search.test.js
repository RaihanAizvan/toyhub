import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import express from "express";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import Product from "../models/product.models.js";
import searchRoutes from "../routes/homeRoute.js";
import { applyTestEnv } from "./helpers/test-env.js";
import { canReachTestDatabase, withTestDatabase } from "./helpers/test-db.js";
import { createCategory, createProduct } from "./helpers/fixtures.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

const buildApp = () => {
  const app = express();
  app.set("views", viewsDirectory);
  app.set("view engine", "ejs");
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({ name: "toyhub.sid", secret: "s".repeat(32), resave: false, saveUninitialized: true }));
  app.use(searchRoutes);
  return app;
};

let server;
let reachable = false;
let baseUrl;

const suggestions = async (query) => {
  const response = await fetch(`${baseUrl}/search?q=${encodeURIComponent(query)}`, {
    redirect: "manual",
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: response.status, data, text };
};

describe("product search suggestions", () => {
  before(async () => {
    reachable = await canReachTestDatabase();
    if (!reachable) {
      return;
    }
    server = buildApp().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => {
      if (!server) {
        return resolve();
      }
      server.close(resolve);
      server.closeAllConnections?.();
    });
  });

  const itWhenReachable = (name, fn) =>
    it(name, async (t) => {
      if (!reachable) {
        return t.skip("no MongoDB on the test URI");
      }
      return fn(t);
    });

  itWhenReachable("answers with the id and name, and nothing else", async () => {
    await withTestDatabase(async () => {
      const category = await createCategory({ name: "Robots" });
      await createProduct({ name: "Walking Robot", description1: "A robot for the shop.", category: category._id });

      const response = await suggestions("Walking");

      assert.equal(response.status, 200);
      assert.equal(response.data.length, 1);
      assert.deepEqual(
        Object.keys(response.data[0]).sort(),
        ["_id", "name"],
        "the suggestion carries the identifier the link needs and no more",
      );
      assert.equal(response.data[0].name, "Walking Robot");
    });
  });

  itWhenReachable("a query of one character asks nothing", async () => {
    await withTestDatabase(async () => {
      const category = await createCategory({ name: "Robots" });
      await createProduct({ name: "Walking Robot", description1: "A robot for the shop.", category: category._id });

      assert.deepEqual((await suggestions("a")).data, []);
      assert.deepEqual((await suggestions("")).data, []);
      assert.deepEqual((await suggestions("   ")).data, []);
    });
  });

  itWhenReachable("a long query is cut down to a term", async () => {
    await withTestDatabase(async () => {
      const category = await createCategory({ name: "Robots" });
      // The name holds a short run of the padding. A term long enough to need
      // all of it will not match, because the search only looks at the first
      // few characters of what was typed.
      await createProduct({
        name: `ZEBRAFISH${"A".repeat(20)}`,
        description1: "A robot for the shop.",
        sku: "LONG-1",
        category: category._id,
      });

      const cut = await suggestions(`ZEBRAFISH${"A".repeat(200)}`);
      assert.equal(cut.status, 200);
      assert.deepEqual(cut.data, [], "the tail past the cut was not searched for");

      // And a query that is merely over the limit still answers normally.
      const short = await suggestions(`ZEBRAFISH${"A".repeat(20)}`);
      assert.equal(short.data.length, 1);
    });
  });

  itWhenReachable("an enormous request line is refused before it is searched", async () => {
    const response = await suggestions("W".repeat(200000));

    assert.ok(
      response.status >= 400 && response.status < 500,
      `a 200KB query was answered with ${response.status}`,
    );
  });

  itWhenReachable("regex characters are matched as the characters they are", async () => {
    await withTestDatabase(async () => {
      const category = await createCategory({ name: "Robots" });
      await createProduct({ name: "Plain Robot", description1: "A robot for the shop.", category: category._id });
      await createProduct({ name: "A. B. C.", description1: "A robot for the shop.", sku: "DOT-1", category: category._id });
      await createProduct({ name: "AxB Robot", description1: "A robot for the shop.", sku: "DOT-2", category: category._id });

      // `.` used to go into the query as a wildcard, so this matched both.
      const wildcard = await suggestions("A.");
      assert.deepEqual(
        wildcard.data.map((item) => item.name),
        ["A. B. C."],
        "a dot matches a dot, so AxB is not a result",
      );

      // `.*` used to match every product in the shop.
      const everything = await suggestions(".*");
      assert.deepEqual(everything.data, [], "there is no product called .*");

      // A pattern that is not a valid regex used to be a 500 naming the driver.
      const broken = await suggestions("(a+)+");
      assert.equal(broken.status, 200, "an invalid pattern is text, not an error");
      assert.deepEqual(broken.data, []);
    });
  });

  itWhenReachable("the number of suggestions is bounded", async () => {
    await withTestDatabase(async () => {
      const category = await createCategory({ name: "Robots" });
      for (let index = 0; index < 25; index += 1) {
        await createProduct({
          name: `Robot number ${index}`,
          description1: "A robot for the shop.",
          sku: `BOUND-${index}`,
          category: category._id,
        });
      }

      const response = await suggestions("Robot");

      assert.equal(response.status, 200);
      assert.ok(
        response.data.length <= 8,
        `asked for 25 and was given ${response.data.length}, which is not a bound`,
      );
    });
  });

  itWhenReachable("a name that is markup comes back as data, not as instructions", async () => {
    await withTestDatabase(async () => {
      const category = await createCategory({ name: "Robots" });
      const hostile = `"><img src=x onerror=alert(1)> Robot`;
      await createProduct({ name: hostile, description1: "A robot for the shop.", category: category._id });

      const response = await suggestions("Robot");

      assert.equal(response.status, 200);
      assert.equal(response.data.length, 1);

      // The response is JSON, so the browser parses it as text. What matters is
      // that the name is a plain string and nothing else came back to smuggle.
      assert.equal(response.data[0].name, hostile);
      assert.deepEqual(Object.keys(response.data[0]).sort(), ["_id", "name"]);

      // And the two headers must not paste it into markup. This reads the
      // renderer rather than the network, because a script that runs is not
      // observable from a test otherwise.
      const header = await readFile(
        new URL("../views/user/header.ejs", import.meta.url),
        "utf8",
      );
      const landing = await readFile(
        new URL("../views/user/header-landing.ejs", import.meta.url),
        "utf8",
      );

      for (const source of [header, landing]) {
        assert.doesNotMatch(
          source,
          /innerHTML\s*=\s*`[^`]*\$\{\s*item\./,
          "a product name is not pasted into markup",
        );
        assert.doesNotMatch(
          source,
          /onclick="searchItem\('\$\{/,
          "a product name is not pasted into an event handler",
        );
        assert.match(source, /textContent/, "the name is written as text");
      }
    });
  });

  itWhenReachable("a blocked product is not suggested", async () => {
    await withTestDatabase(async () => {
      const category = await createCategory({ name: "Robots" });
      await createProduct({
        name: "Hidden Robot",
        description1: "A robot for the shop.",
        category: category._id,
        isBlocked: true,
      });

      assert.deepEqual((await suggestions("Hidden")).data, []);
    });
  });

  itWhenReachable("a database error does not explain itself to whoever asked", async () => {
    await withTestDatabase(async () => {
      const original = Product.find;
      Product.find = () => ({
        limit() {
          throw new Error("index scan on collection products failed");
        },
        lean() {
          return this;
        },
      });

      let response;
      try {
        response = await suggestions("Anything");
      } finally {
        Product.find = original;
      }

      assert.equal(response.status, 500);
      assert.doesNotMatch(
        response.text,
        /index scan|collection products/,
        "the reason names collection and index details and is not sent on",
      );
    });
  });

  // The two headers build their rows with DOM calls. Reading the source proves the
  // shape; running the shipped function proves it behaves. There is no DOM
  // library here, so this stands up the smallest one the function touches, and
  // makes writing innerHTML an error rather than something to inspect after.
  const buildStubDocument = () => {
    const markupWrites = [];
    const makeElement = (tagName) => {
      const element = {
        tagName,
        className: "",
        href: "",
        childNodes: [],
        text: null,
        set classList(_value) {},
        set textContent(value) {
          this.text = String(value);
        },
        get textContent() {
          return this.text;
        },
        appendChild(child) {
          this.childNodes.push(child);
          return child;
        },
        append(...children) {
          this.childNodes.push(...children);
        },
      };
      Object.defineProperty(element, "innerHTML", {
        set(value) {
          markupWrites.push(String(value));
        },
        get() {
          return "";
        },
      });
      return element;
    };
    return { document: { createElement: makeElement }, markupWrites };
  };

  const loadBuilder = (source) => {
    const start = source.indexOf("function buildSuggestion(");
    assert.notEqual(start, -1, "the header builds suggestions with a named function");

    let depth = 0;
    let end = start;
    for (let index = source.indexOf("{", start); index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }

    const body = source.slice(start, end);
    // eslint-disable-next-line no-new-func
    return new Function("document", "encodeURIComponent", `${body}; return buildSuggestion;`);
  };

  itWhenReachable("a product name is printed, never parsed", async () => {
    const hostile = `Robot" onmouseover="alert(1)`;

    for (const file of ["header.ejs", "header-landing.ejs"]) {
      const source = await readFile(
        new URL(`../views/user/${file}`, import.meta.url),
        "utf8",
      );
      const build = loadBuilder(source);

      const stub = buildStubDocument();
      const row = build(stub.document, encodeURIComponent)({
        _id: "abc123",
        name: hostile,
      });

      assert.deepEqual(stub.markupWrites, [], `${file} wrote markup`);
      assert.equal(row.tagName, "a");
      assert.equal(row.href, "/product/abc123", `${file} links to the canonical product`);
      assert.deepEqual(
        row.childNodes.map((child) => child.textContent).filter((text) => text !== null),
        [hostile],
        `${file} prints the name exactly as it was given`,
      );
    }
  });

  itWhenReachable("a suggestion still works when the row has no id or no name", async () => {
    const source = await readFile(new URL("../views/user/header.ejs", import.meta.url), "utf8");
    const build = loadBuilder(source);

    const nameless = buildStubDocument();
    const noId = build(nameless.document, encodeURIComponent)({ name: "Robot" });
    assert.equal(noId.href, "#", "with no id there is nowhere to link");
    assert.deepEqual(nameless.markupWrites, []);

    const noName = buildStubDocument();
    const unnamed = build(noName.document, encodeURIComponent)({ _id: "abc123" });
    assert.deepEqual(
      unnamed.childNodes.map((child) => child.textContent).filter((text) => text !== null),
      ["Unnamed Item"],
    );
    assert.deepEqual(noName.markupWrites, []);

    const empty = buildStubDocument();
    build(empty.document, encodeURIComponent)(null);
    assert.deepEqual(empty.markupWrites, [], "no item at all is not a crash");
  });

  itWhenReachable("an id that needs quoting still lands in one path segment", async () => {
    const source = await readFile(new URL("../views/user/header.ejs", import.meta.url), "utf8");
    const build = loadBuilder(source);
    const stub = buildStubDocument();

    const row = build(stub.document, encodeURIComponent)({
      _id: "../../account",
      name: "Robot",
    });

    assert.equal(row.href, "/product/..%2F..%2Faccount", "the id cannot climb out of the path");
  });
});
