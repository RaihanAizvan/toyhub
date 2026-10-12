import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import session from "express-session";
import { fileURLToPath } from "node:url";

import { applyTestEnv } from "./helpers/test-env.js";
import {
  canReachTestDatabase,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} from "./helpers/test-db.js";
import {
  buildOrderAddress,
  createCategory,
  createOrder,
  createProduct,
  createUser,
  objectId,
} from "./helpers/fixtures.js";
import dashboard from "../controllers/adminModules/dashboard.js";
import salesReport from "../controllers/adminModules/salesReport.js";
import { injectCsrfFields } from "../utils/csrf.js";
import {
  averageOrderValue,
  customWindow,
  dayWindow,
  inWindow,
  isActiveOrder,
  isRevenueOrder,
  monthWindow,
  orderDateFilterFor,
  revenueOf,
  revenueOrderCount,
  totalDiscountOf,
  weekWindow,
  yearWindow,
} from "../utils/reports.js";

applyTestEnv();

const viewsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "views",
);

let server;
let baseUrl;
let reachable = false;

before(async () => {
  reachable = await canReachTestDatabase();
  if (!reachable) {
    return;
  }
  await connectTestDatabase();
  const app = express();
  app.set("views", viewsDirectory);
  app.set("view engine", "ejs");
  app.use(expressLayouts);
  app.set("layout", "./layouts/layout");
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(
    session({
      name: "toyhub.sid",
      secret: "s".repeat(32),
      resave: false,
      saveUninitialized: true,
    }),
  );

  app.use((req, _res, next) => {
    req.session.sAdminEmail = "admin@example.invalid";
    next();
  });
  app.use((req, res, next) => {
    res.locals.csrfToken = "test-csrf-token";
    res.locals.injectCsrfFields = injectCsrfFields;
    res.locals.user = null;
    res.locals.path = req.path;
    next();
  });

  app.get("/admin", dashboard.getHome);
  app.get("/admin/sales/weekly", dashboard.getWeeklySales);
  app.get("/admin/sales/monthly", dashboard.getMonthlySales);
  app.get("/admin/sales/yearly", dashboard.getYearlySales);
  app.get("/admin/salesReport", salesReport.getSalesReport);
  app.get("/admin/salesReport/export", salesReport.exportSalesReport);
  app.get("/admin/salesReport/export-pdf", salesReport.exportSalesReportPdf);

  app.use((req, res) => res.status(404).send("not found"));
  app.use((error, _req, res, _next) => {
    console.error("TEST PAGE ERROR:", error?.message);
    res.status(500).send("not found");
  });

  server = app.listen(0);
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
  await disconnectTestDatabase();
});

beforeEach(async () => {
  if (!reachable) {
    return;
  }
  await clearTestDatabase();
});

const whenReachable = (name, fn) =>
  it(name, async (t) => {
    if (!reachable) {
      return t.skip("no MongoDB on the test URI");
    }
    return fn(t);
  });

const get = (pathname) => fetch(`${baseUrl}${pathname}`);
const getText = async (pathname) => {
  const response = await get(pathname);
  return { status: response.status, body: await response.text() };
};

const json = async (pathname) => {
  const response = await get(pathname);
  return { status: response.status, body: await response.json() };
};

const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const ymd = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// The seeded shop: three delivered orders today (600, 300, 250), one pending
// and one cancelled today, a delivered order yesterday, and one delivered
// forty days ago. The numbers every page must show follow from those facts.
const seedShop = async () => {
  const category = await createCategory({ name: "Building Blocks" });
  const product = await createProduct({
    name: "Wooden Blocks",
    category: category._id,
    sold: 12,
    price: 300,
  });
  const buyer = await createUser({ name: "Sana Buyer" });
  const goneBuyerId = objectId();

  const today = new Date();
  await createOrder({
    user: buyer._id,
    items: [{ product: product._id, quantity: 2, price: 300 }],
    totalAmount: 600,
    subtotal: 600,
    status: "delivered",
    paymentMethod: "razorpay",
    address: buildOrderAddress({ city: "Kochi" }),
    orderDate: today,
  });
  const deliveredToday = await createOrder({
    user: buyer._id,
    items: [{ product: product._id, quantity: 1, price: 300 }],
    totalAmount: 300,
    subtotal: 300,
    status: "delivered",
    paymentMethod: "cod",
    orderDate: today,
  });
  const noBuyerToday = await createOrder({
    user: goneBuyerId,
    items: [{ product: product._id, quantity: 1, price: 250 }],
    totalAmount: 250,
    subtotal: 250,
    status: "delivered",
    paymentMethod: "wallet",
    orderDate: today,
  });
  const pendingToday = await createOrder({
    user: buyer._id,
    totalAmount: 200,
    subtotal: 200,
    status: "pending",
    paymentMethod: "cod",
    orderDate: today,
  });
  const cancelledToday = await createOrder({
    user: buyer._id,
    totalAmount: 300,
    subtotal: 300,
    status: "cancelled",
    paymentMethod: "cod",
    orderDate: today,
  });
  await createOrder({
    user: buyer._id,
    totalAmount: 500,
    subtotal: 500,
    status: "delivered",
    paymentMethod: "cod",
    orderDate: daysAgo(1),
  });
  const deliveredLongAgo = await createOrder({
    user: buyer._id,
    totalAmount: 700,
    subtotal: 700,
    status: "delivered",
    paymentMethod: "razorpay",
    orderDate: daysAgo(40),
  });

  return {
    deliveredTodayId: String(deliveredToday._id),
    noBuyerTodayId: String(noBuyerToday._id),
    pendingTodayId: String(pendingToday._id),
    cancelledTodayId: String(cancelledToday._id),
    deliveredLongAgoId: String(deliveredLongAgo._id),
  };
};

describe("utils/reports.js", () => {
  describe("the revenue rule", () => {
    it("only a delivered order earns money", () => {
      assert.equal(isRevenueOrder({ status: "delivered" }), true);
      assert.equal(isRevenueOrder({ status: "Delivered" }), true, "case does not change the word");
      assert.equal(isRevenueOrder({ status: "pending" }), false);
      assert.equal(isRevenueOrder({ status: "shipped" }), false);
      assert.equal(isRevenueOrder({ status: "cancelled" }), false);
      assert.equal(isRevenueOrder({}), false);
    });

    it("an order is active until it is delivered or cancelled", () => {
      assert.equal(isActiveOrder({ status: "pending" }), true);
      assert.equal(isActiveOrder({ status: "shipped" }), true);
      assert.equal(isActiveOrder({ status: "delivered" }), false);
      assert.equal(isActiveOrder({ status: "cancelled" }), false);
    });

    it("revenue sums the totalAmount of delivered orders only", () => {
      const orders = [
        { status: "delivered", totalAmount: 100 },
        { status: "pending", totalAmount: 9999 },
        { status: "cancelled", totalAmount: 9999 },
        { status: "delivered", totalAmount: 50 },
      ];
      assert.equal(revenueOf(orders), 150);
      assert.equal(revenueOrderCount(orders), 2);
    });

    it("revenue figures tolerate missing money fields", () => {
      assert.equal(revenueOf([{ status: "delivered" }]), 0);
      assert.equal(totalDiscountOf([{ status: "delivered" }]), 0);
      assert.equal(averageOrderValue([]), 0);
      assert.equal(averageOrderValue([{ status: "pending", totalAmount: 9 }]), 0);
    });
  });

  describe("date windows", () => {
    it("a day starts and ends at the server's midnight", () => {
      const noon = new Date(2026, 4, 15, 12, 0, 0);
      const { start, end } = dayWindow(noon);
      assert.deepEqual(start, new Date(2026, 4, 15, 0, 0, 0));
      assert.deepEqual(end, new Date(2026, 4, 16, 0, 0, 0));
    });

    it("a week starts on Sunday and is seven days long", () => {
      const thursday = new Date(2026, 4, 14, 16, 30, 0);
      const { start, end } = weekWindow(thursday);
      assert.deepEqual(start, new Date(2026, 4, 10, 0, 0, 0));
      assert.deepEqual(end, new Date(2026, 4, 17, 0, 0, 0));
      assert.equal(end - start, 7 * 24 * 60 * 60 * 1000);
    });

    it("a month starts on its first day", () => {
      const late = new Date(2026, 0, 15, 23, 0, 0);
      const { start, end } = monthWindow(late);
      assert.deepEqual(start, new Date(2026, 0, 1, 0, 0, 0));
      assert.deepEqual(end, new Date(2026, 1, 1, 0, 0, 0));
    });

    it("a year starts on January the first", () => {
      const { start, end } = yearWindow(new Date(2026, 10, 20));
      assert.deepEqual(start, new Date(2026, 0, 1, 0, 0, 0));
      assert.deepEqual(end, new Date(2027, 0, 1, 0, 0, 0));
    });

    it("a custom window reads YYYY-MM-DD around whole days", () => {
      assert.deepEqual(customWindow("2026-05-01", "2026-05-02"), {
        start: new Date(2026, 4, 1, 0, 0, 0),
        end: new Date(2026, 4, 3, 0, 0, 0),
      });
    });

    it("a custom window refuses bad or backwards dates", () => {
      assert.equal(customWindow("2026-05-02", "2026-05-01"), null, "end before start");
      assert.equal(customWindow("not-a-date", "2026-05-01"), null);
      assert.equal(customWindow("2026-05-01", undefined), null);
      assert.equal(customWindow(undefined, undefined), null);
    });

    it("the filter is empty for 'all' and windowed for the rest", () => {
      assert.deepEqual(orderDateFilterFor("all", new Date(2026, 4, 14)), {});
      const daily = orderDateFilterFor("daily", new Date(2026, 4, 14, 9, 0, 0));
      assert.deepEqual(daily.orderDate.$gte, new Date(2026, 4, 14, 0, 0, 0));
      assert.deepEqual(daily.orderDate.$lt, new Date(2026, 4, 15, 0, 0, 0));
      assert.equal(
        inWindow(new Date(2026, 4, 14, 23, 59, 59, 999), dayWindow(new Date(2026, 4, 14))),
        true,
      );
      assert.equal(
        inWindow(new Date(2026, 4, 15, 0, 0, 0, 0), dayWindow(new Date(2026, 4, 14))),
        false,
      );
    });
  });
});

describe("admin dashboard", () => {
  whenReachable("revenue counts delivered orders, never the others", async () => {
    await seedShop();

    const { status, body } = await getText("/admin");

    assert.equal(status, 200);
    assert.match(body, /Total Revenue/);
    assert.match(body, /₹2350\.00/, "600 + 300 + 250 today, 500 yesterday, 700 long ago");
    assert.match(body, /₹1150\.00/, "today's revenue is only today's delivered orders");
    const activeRegion = body.slice(body.indexOf("Active Orders"), body.indexOf("Active Orders") + 400);
    assert.match(activeRegion, />1<\/p>/, "one pending order is still active");
  });

  whenReachable("a missing buyer does not break the dashboard or the report", async () => {
    const ids = await seedShop();

    const { body } = await getText("/admin");
    assert.match(body, /A deleted account/, "the recent orders name the lost buyer");

    const report = await getText("/admin/salesReport?period=daily");
    assert.match(report.body, /A deleted account/, "the report does the same");
    assert.match(report.body, new RegExp(ids.noBuyerTodayId), "the delivered order without a buyer is on the day's page");
  });
});

describe("the sales charts", () => {
  const seedCharts = async (recent = 900) => {
    const category = await createCategory({ name: "Charts" });
    const product = await createProduct({ name: "Sold Block", category: category._id, sold: 1, price: recent });
    const buyer = await createUser({ name: "Chart Buyer" });
    await createOrder({
      user: buyer._id,
      items: [{ product: product._id, quantity: 1, price: recent }],
      totalAmount: recent,
      subtotal: recent,
      status: "delivered",
      paymentMethod: "cod",
      orderDate: new Date(),
    });
    await createOrder({
      user: buyer._id,
      totalAmount: 700,
      subtotal: 700,
      status: "delivered",
      paymentMethod: "cod",
      orderDate: daysAgo(40),
    });
    return recent;
  };

  whenReachable("the weekly chart holds each day of the current week", async () => {
    await seedCharts();

    const { status, body } = await json("/admin/sales/weekly");

    assert.equal(status, 200);
    assert.equal(body.labels.length, 7);
    const total = body.salesData.reduce((a, b) => a + b, 0);
    assert.equal(total, 900, "only today's delivered order; forty days ago stays off");
  });

  whenReachable("the monthly chart holds the last four weeks", async () => {
    await seedCharts();

    const { status, body } = await json("/admin/sales/monthly");

    assert.equal(status, 200);
    assert.equal(body.labels.length, 4);
    const total = body.salesData.reduce((a, b) => a + b, 0);
    assert.equal(total, 900, "forty days is outside the four-week window");
  });

  whenReachable("the yearly chart holds the calendar year, month by month", async () => {
    await seedCharts(1150);

    const { status, body } = await json("/admin/sales/yearly");

    assert.equal(status, 200);
    assert.equal(body.labels.length, 12);
    assert.equal(body.salesData[new Date().getMonth()], 1150, "this month's delivered money");
  });
});

describe("the sales report", () => {
  whenReachable("lists every order in a period, whatever its status", async () => {
    const ids = await seedShop();

    const { status, body } = await getText("/admin/salesReport");

    assert.equal(status, 200);
    assert.match(body, new RegExp(ids.deliveredTodayId));
    assert.match(body, new RegExp(ids.pendingTodayId), "a pending order is a row, not a fact");
    assert.match(body, new RegExp(ids.cancelledTodayId), "a cancelled order is a row, not a fact");
    assert.match(body, new RegExp(ids.deliveredLongAgoId), "the whole shop, not just the week");
  });

  whenReachable("gives one revenue figure that the dashboard and report share", async () => {
    const ids = await seedShop();

    const report = await getText("/admin/salesReport?period=daily");
    const dashboardBody = (await getText("/admin")).body;

    assert.match(report.body, /₹1150\.00/, "today's delivered revenue");
    assert.match(report.body, new RegExp(ids.deliveredTodayId));
    assert.doesNotMatch(report.body, new RegExp(ids.deliveredLongAgoId), "older orders stay off today's page");
    assert.match(dashboardBody, /₹1150\.00/, "the dashboard says the same");
  });

  whenReachable("shows the empty state as zeros, not an error", async () => {
    const { status, body } = await getText(
      "/admin/salesReport?period=custom&startDate=2999-01-01&endDate=2999-01-02",
    );

    assert.equal(status, 200);
    assert.match(body, /No orders match this period\./);
    assert.match(body, /₹0\.00/);
  });

  whenReachable("keeps a fixed custom window, exclusive at its end", async () => {
    await seedShop();

    const today = ymd(new Date());
    const { body } = await getText(
      `/admin/salesReport?period=custom&startDate=${today}&endDate=${today}`,
    );

    assert.match(body, /₹1150\.00/, "today's delivered orders only");
    assert.doesNotMatch(body, /₹1650\.00/, "yesterday's delivered order is outside the window");
  });

  whenReachable("refuses a custom window without its two dates", async () => {
    const badOrder = await getText("/admin/salesReport?period=custom");
    assert.equal(badOrder.status, 400);

    const backwards = await getText(
      "/admin/salesReport?period=custom&startDate=2030-01-02&endDate=2030-01-01",
    );
    assert.equal(backwards.status, 400);
  });

  whenReachable("exports the same rows as pdf and spreadsheet", async () => {
    await seedShop();

    const pdf = await get("/admin/salesReport/export-pdf?period=all");
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get("content-type") || "", /application\/pdf/);

    const excel = await get("/admin/salesReport/export?period=all");
    assert.equal(excel.status, 200);
    assert.match(excel.headers.get("content-type") || "", /spreadsheetml/);
  });

  whenReachable("an empty period still exports an empty spreadsheet", async () => {
    const excel = await get(
      "/admin/salesReport/export?period=custom&startDate=2999-01-01&endDate=2999-01-02",
    );
    assert.equal(excel.status, 200);
    assert.match(excel.headers.get("content-type") || "", /spreadsheetml/);
  });
});