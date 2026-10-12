// One shop has one set of sales figures, so the numbers the dashboard, the
// chart, and the sales report show all start here.
//
// What counts as a sale is written down once: an order earns its money when it
// is delivered. Pending, shipped, cancelled and refunded orders are not
// revenue; "Active Orders" are the orders that are still in play, which is every
// order that is neither delivered nor cancelled. The sales report table lists
// every order in a period whatever its status, because the status is read from
// the row; the revenue figures above it use the delivery rule.
//
// A day begins and ends at the server's midnight. Every window is half-open:
// it starts at midnight and ends just before the next one starts, so the last
// millisecond of a day belongs to that day and to no other.
export const REVENUE_STATUS = "delivered";

const TERMINAL_STATUSES = new Set(["delivered", "cancelled"]);

const lowerStatus = (status) => String(status ?? "").trim().toLowerCase();

export const isRevenueOrder = (order) =>
  Boolean(order) && lowerStatus(order.status) === REVENUE_STATUS;

export const isActiveOrder = (order) =>
  Boolean(order) && !TERMINAL_STATUSES.has(lowerStatus(order.status));

// The money an order actually took: totalAmount. The four discount figures are
// how that amount was reached, not revenue of their own.
export const orderMoney = (order) => Number(order?.totalAmount) || 0;

export const revenueOf = (orders) =>
  (Array.isArray(orders) ? orders : []).reduce(
    (sum, order) => (isRevenueOrder(order) ? sum + orderMoney(order) : sum),
    0,
  );

export const revenueOrderCount = (orders) =>
  (Array.isArray(orders) ? orders : []).filter(isRevenueOrder).length;

export const totalDiscountOf = (orders) =>
  (Array.isArray(orders) ? orders : []).reduce(
    (sum, order) =>
      isRevenueOrder(order)
        ? sum +
          (Number(order.discount) || 0) +
          (Number(order.offerDiscount) || 0) +
          (Number(order.couponDiscount) || 0)
        : sum,
    0,
  );

export const averageOrderValue = (orders) => {
  const count = revenueOrderCount(orders);
  return count === 0 ? 0 : revenueOf(orders) / count;
};

// The sales report accepts these period names.
export const SALES_REPORT_PERIODS = [
  "all",
  "daily",
  "weekly",
  "monthly",
  "annual",
  "custom",
];

export const isSalesReportPeriod = (period) =>
  SALES_REPORT_PERIODS.includes(period);

// A day starts at the server's local midnight. addDays starts from the same
// midnight, never from the time of day the original carried.
export const startOfDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const addDays = (date, days) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const dayWindow = (now = new Date()) => {
  const start = startOfDay(now);
  return { start, end: addDays(start, 1) };
};

// Weeks start on Sunday, because they always have here. The window decided
// first where the week starts, which also fixes the month window's idea of
// where a month ends.
export const weekWindow = (now = new Date()) => {
  const start = addDays(startOfDay(now), -now.getDay());
  return { start, end: addDays(start, 7) };
};

export const monthWindow = (now = new Date()) => ({
  start: new Date(now.getFullYear(), now.getMonth(), 1),
  end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
});

export const yearWindow = (now = new Date()) => ({
  start: new Date(now.getFullYear(), 0, 1),
  end: new Date(now.getFullYear() + 1, 0, 1),
});

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// A custom range travels as YYYY-MM-DD and is read as the server's midnight.
export const parseDateInput = (value) => {
  if (typeof value !== "string" || !DATE_INPUT_PATTERN.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const customWindow = (startValue, endValue) => {
  const start = parseDateInput(startValue);
  const end = parseDateInput(endValue);
  if (!start || !end || start > end) {
    return null;
  }
  return { start, end: addDays(end, 1) };
};

export const inWindow = (date, window) =>
  Boolean(date && window) && date >= window.start && date < window.end;

// A mongoose filter for the orders inside a period. "all" has no filter and
// covers every order ever written.
export const orderDateFilterFor = (period, now = new Date()) => {
  switch (period) {
    case "daily": {
      const window = dayWindow(now);
      return { orderDate: { $gte: window.start, $lt: window.end } };
    }
    case "weekly": {
      const window = weekWindow(now);
      return { orderDate: { $gte: window.start, $lt: window.end } };
    }
    case "monthly": {
      const window = monthWindow(now);
      return { orderDate: { $gte: window.start, $lt: window.end } };
    }
    case "annual": {
      const window = yearWindow(now);
      return { orderDate: { $gte: window.start, $lt: window.end } };
    }
    default:
      return {};
  }
};