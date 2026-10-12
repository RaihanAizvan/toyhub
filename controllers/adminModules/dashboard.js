import Order, { normaliseOrderStatus } from "../../models/orders.models.js"
import Product from "../../models/product.models.js"
import Category from "../../models/categories.model.js"
import User from "../../models/users.models.js"
import {
  addDays,
  dayWindow,
  inWindow,
  isActiveOrder,
  isRevenueOrder,
  revenueOf,
  weekWindow,
  yearWindow,
} from "../../utils/reports.js"

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export async function getHome(req, res) {
  if (!req.session.sAdminEmail) {
    return res.redirect("/admin/login");
  }
  const now = new Date();

  const [recentOrderDocs, fullOrders, bestSellingProducts] = await Promise.all([
    Order.find({})
      .sort({ orderDate: -1 })
      .limit(10)
      .populate("items.product")
      .populate("user", "name")
      .lean(),
    Order.find({}).lean(),
    Product.find({}).sort({ sold: -1 }).limit(5).lean(),
  ]);

  const recentOrders = recentOrderDocs.map((order) => ({
    ...order,
    status: normaliseOrderStatus(order.status),
  }));

  const revenueOrders = fullOrders.filter(isRevenueOrder);
  const totalRevenue = revenueOf(fullOrders);
  const todaysRevenue = revenueOf(
    revenueOrders.filter((order) => inWindow(order.orderDate, dayWindow(now))),
  );
  const activeOrders = fullOrders.filter(isActiveOrder).length;

  // Best selling locations: where delivered orders were actually sent.
  const locations = new Map();
  revenueOrders.forEach((order) => {
    const city = order.address?.city || "Unknown location";
    const entry = locations.get(city) || { city, orders: 0, revenue: 0 };
    entry.orders += 1;
    entry.revenue += Number(order.totalAmount) || 0;
    locations.set(city, entry);
  });
  const bestSellingLocations = [...locations.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // Best selling categories: delivered lines grouped by their product's
  // category. A deleted product sells under "Unknown category" rather than
  // pulling the report down with it.
  const soldProductIds = new Set();
  revenueOrders.forEach((order) => {
    order.items.forEach((item) => soldProductIds.add(String(item.product)));
  });
  const productsById = new Map(
    (
      await Product.find({ _id: { $in: [...soldProductIds] } })
        .select("category")
        .lean()
    ).map((product) => [String(product._id), product]),
  );
  const categorySales = new Map();
  revenueOrders.forEach((order) => {
    order.items.forEach((item) => {
      const categoryId = productsById.get(String(item.product))?.category
        ? String(productsById.get(String(item.product)).category)
        : "unknown";
      const entry = categorySales.get(categoryId) || { categoryId, sold: 0 };
      entry.sold += Number(item.quantity) || 0;
      categorySales.set(categoryId, entry);
    });
  });
  const categoryIds = [...categorySales.keys()].filter(
    (id) => id !== "unknown",
  );
  const categoryNames = new Map(
    (
      await Category.find({ _id: { $in: categoryIds } })
        .select("name")
        .lean()
    ).map((category) => [String(category._id), category.name]),
  );
  const bestSellingCategories = [...categorySales.values()]
    .map((entry) => ({
      name:
        entry.categoryId === "unknown"
          ? "Unknown category"
          : categoryNames.get(entry.categoryId) || "Deleted category",
      sold: entry.sold,
    }))
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5);

  // Best selling users: delivered revenue per buyer.
  const buyerSpending = new Map();
  revenueOrders.forEach((order) => {
    const userId = String(order.user);
    const entry = buyerSpending.get(userId) || { userId, totalAmount: 0 };
    entry.totalAmount += Number(order.totalAmount) || 0;
    buyerSpending.set(userId, entry);
  });
  const buyerNames = new Map(
    (
      await User.find({ _id: { $in: [...buyerSpending.keys()] } })
        .select("name")
        .lean()
    ).map((user) => [String(user._id), user.name]),
  );
  const bestSellingUsers = [...buyerSpending.values()]
    .map((entry) => ({
      name: buyerNames.get(entry.userId) || "A deleted account",
      totalAmount: entry.totalAmount,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 5);

  res.set("Cache-Control", "no-store");
  res.render("admin/adminHome", {
    orders: recentOrders,
    bestSellingCategories,
    bestSellingProducts,
    bestSellingUsers,
    bestSellingLocations,
    totalRevenue,
    todaysRevenue,
    activeOrders,
  });
}

// A chart is the delivered revenue inside a row of day, week or month windows,
// oldest first, with a label for each window. The windows come from the same
// helpers the report uses, so a day that starts on the report is the same day
// on the graph.
const bucketedRevenue = (orders, buckets) =>
  buckets.map(({ label, start, end }) => ({
    label,
    amount: revenueOf(
      orders.filter((order) => inWindow(order.orderDate, { start, end })),
    ),
  }));

async function loadRevenueOrders(now) {
  return Order.find({ orderDate: { $lt: yearWindow(now).end } })
    .select("totalAmount status orderDate")
    .lean();
}

export async function getWeeklySales(req, res) {
  const now = new Date();
  const week = weekWindow(now);
  const orders = await loadRevenueOrders(now);
  const buckets = [];
  for (let day = 0; day < 7; day += 1) {
    const start = addDays(week.start, day);
    buckets.push({ label: WEEKDAY_LABELS[day], start, end: addDays(start, 1) });
  }
  const sales = bucketedRevenue(orders, buckets);
  res.json({ labels: sales.map((entry) => entry.label), salesData: sales.map((entry) => entry.amount) });
}

export async function getMonthlySales(req, res) {
  const now = new Date();
  const orders = await loadRevenueOrders(now);
  const week = weekWindow(now);
  const buckets = [];
  for (let back = 3; back >= 0; back -= 1) {
    const start = addDays(week.start, -back * 7);
    buckets.push({ label: `Week ${4 - back}`, start, end: addDays(start, 7) });
  }
  const sales = bucketedRevenue(orders, buckets);
  res.json({ labels: sales.map((entry) => entry.label), salesData: sales.map((entry) => entry.amount) });
}

export async function getYearlySales(req, res) {
  const now = new Date();
  const orders = await loadRevenueOrders(now);
  const year = yearWindow(now);
  const sales = bucketedRevenue(
    orders,
    MONTH_LABELS.map((label, month) => ({
      label,
      start: new Date(year.start.getFullYear(), month, 1),
      end: new Date(year.start.getFullYear(), month + 1, 1),
    })),
  );
  res.json({ labels: sales.map((entry) => entry.label), salesData: sales.map((entry) => entry.amount) });
}

export default {
  getHome,
  getWeeklySales,
  getMonthlySales,
  getYearlySales,
};