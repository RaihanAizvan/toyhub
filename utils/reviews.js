import mongoose from "mongoose";

// A review is one person's note about one product. These are the limits the
// pages and the form agree on, written down once so the controller, the model
// and the tests cannot drift apart.
export const RATING_MIN = 1;
export const RATING_MAX = 5;
export const REVIEW_TITLE_MAX = 120;
export const REVIEW_COMMENT_MAX = 2000;

// A rating must be a whole number in range. `Number("4")` is 4, which is what a
// form sends, but `Number("")` is 0, `Number(" 4 ")` is 4 and `Number(null)` is
// 0, so the value is checked rather than trusted.
export const parseRating = (raw) => {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= RATING_MIN && raw <= RATING_MAX ? raw : null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value >= RATING_MIN && value <= RATING_MAX ? value : null;
};

// Text is trimmed and cut to its limit rather than refused, so a long comment is
// shortened instead of losing the review. Non-strings become empty.
export const cleanReviewText = (raw, max) => {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim().slice(0, max);
};

// A review has to belong to a product that exists, and the id in the URL has to
// be one a database would recognise.
export const isReviewableProductId = (raw) =>
  typeof raw === "string" && mongoose.Types.ObjectId.isValid(raw);

// An order only makes someone an eligible reviewer once it has been sent or
// delivered. A pending order can still be cancelled, and a cancelled one says
// nothing about whether they ever got the thing.
export const ELIGIBLE_ORDER_STATUSES = new Set(["shipped", "delivered"]);

export const isEligibleOrderStatus = (status) =>
  ELIGIBLE_ORDER_STATUSES.has(String(status ?? "").trim().toLowerCase());

// The numbers shown on a product page. Reviews an admin has rejected are left
// out; pending ones are counted, so a review is visible as soon as it is written
// rather than waiting on moderation that may never come.
//
// The averages come from an aggregation over the reviews themselves, so this is
// a plain sum rather than a running total kept on the document.
export const summariseRatings = (ratings) => {
  const counted = ratings.filter((rating) => String(rating.status ?? "pending") !== "rejected");

  const ratingStats = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let ratingSum = 0;
  let ratingCount = 0;
  for (const rating of counted) {
    const value = Number(rating.rating);
    if (!Number.isInteger(value) || value < RATING_MIN || value > RATING_MAX) {
      continue;
    }
    ratingSum += value;
    ratingStats[value] += 1;
    ratingCount += 1;
  }

  return {
    averageRating: ratingCount === 0 ? 0 : Number((ratingSum / ratingCount).toFixed(2)),
    ratingCount,
    ratingStats,
  };
};