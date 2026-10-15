import { isObjectId } from "./ownership.js";

// Checks for the values a request carries, in one place so that a page and the
// query behind it cannot disagree about what is allowed. Each returns a value
// the caller can use directly, falling back to a safe default rather than
// passing a hostile value through to the database.

export { isObjectId };

const first = (value) => (Array.isArray(value) ? value[0] : value);

// A page is a whole number of at least one and at most a ceiling, so a negative
// or absent value reads as the first page instead of a negative offset.
export const parsePage = (value, { fallback = 1, max = 100000 } = {}) => {
  const raw = first(value);
  if (raw === undefined || raw === null || raw === "") return fallback;

  const page = Number(raw);
  if (!Number.isInteger(page) || page < 1) return fallback;
  return Math.min(page, max);
};

// A page size is a whole number between one and a ceiling. An unbounded limit
// would let a caller ask for the whole collection in one request.
export const parseLimit = (value, { fallback = 10, min = 1, max = 100 } = {}) => {
  const raw = first(value);
  if (raw === undefined || raw === null || raw === "") return fallback;

  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < min) return fallback;
  return Math.min(limit, max);
};

export const parsePagination = (
  query = {},
  { defaultLimit = 10, minLimit = 1, maxLimit = 100, maxPage = 100000 } = {},
) => {
  const page = parsePage(query.page, { max: maxPage });
  const limit = parseLimit(query.limit, { fallback: defaultLimit, min: minLimit, max: maxLimit });
  return { page, limit, skip: (page - 1) * limit };
};

// A quantity is a whole number in a known range. Anything else, including a
// fraction, a word or an array, is refused rather than quietly rounded.
export const parseQuantity = (value, { min = 1, max = 10 } = {}) => {
  if (typeof value !== "number" && typeof value !== "string") return null;

  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < min || quantity > max) return null;
  return quantity;
};
