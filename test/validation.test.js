import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isObjectId,
  parseLimit,
  parsePage,
  parsePagination,
  parseQuantity,
} from "../utils/validation.js";

// Each validator is asked the same three questions: does it keep a value that
// is already right, does it replace a value that is wrong with a safe default
// rather than a hostile number, and does it treat a value that arrives twice
// (as a query string sometimes does) as the first one.
describe("parsePage", () => {
  it("keeps a whole page of at least one", () => {
    assert.equal(parsePage("1"), 1);
    assert.equal(parsePage("7"), 7);
    assert.equal(parsePage(3), 3);
  });

  it("falls back to the first page for anything that is not one", () => {
    for (const value of ["0", "-4", "2.5", "abc", "", "  ", null, undefined, {}, ["a"]]) {
      assert.equal(parsePage(value), 1, `${JSON.stringify(value)} should read as page 1`);
    }
  });

  it("reads the first value when the query repeats the parameter", () => {
    assert.equal(parsePage(["5", "9"]), 5);
  });

  it("will not go past its ceiling", () => {
    assert.equal(parsePage("100000000", { max: 1000 }), 1000);
  });
});

describe("parseLimit", () => {
  it("keeps a whole page size within range", () => {
    assert.equal(parseLimit("10"), 10);
    assert.equal(parseLimit("100"), 100);
  });

  it("falls back when the size is absent or not a positive whole number", () => {
    for (const value of ["0", "-3", "1.5", "lots", "", null, undefined]) {
      assert.equal(parseLimit(value), 10, `${JSON.stringify(value)} should read as 10`);
    }
  });

  it("will not let a caller ask for the whole collection", () => {
    assert.equal(parseLimit("999999"), 100);
    assert.equal(parseLimit("999999", { max: 50 }), 50);
  });

  it("honours a different default for pages that show fewer", () => {
    assert.equal(parseLimit(undefined, { fallback: 6 }), 6);
  });
});

describe("parsePagination", () => {
  it("turns a page and size into the offset a query needs", () => {
    assert.deepEqual(parsePagination({ page: "3", limit: "10" }), {
      page: 3,
      limit: 10,
      skip: 20,
    });
  });

  it("uses safe defaults when the query says nothing usable", () => {
    assert.deepEqual(parsePagination({}), { page: 1, limit: 10, skip: 0 });
    assert.deepEqual(parsePagination({ page: "-1", limit: "0" }), {
      page: 1,
      limit: 10,
      skip: 0,
    });
  });

  it("never produces a negative or fractional offset", () => {
    const { skip } = parsePagination({ page: "-9", limit: "-9" });
    assert.equal(skip, 0);
    assert.ok(Number.isInteger(skip));
  });
});

describe("parseQuantity", () => {
  it("keeps a whole number of items within range", () => {
    assert.equal(parseQuantity("1"), 1);
    assert.equal(parseQuantity(5), 5);
    assert.equal(parseQuantity("10"), 10);
  });

  it("refuses anything that is not a whole number in range", () => {
    for (const value of ["0", "-2", "1.5", "two", "", null, undefined, {}, [], true]) {
      assert.equal(parseQuantity(value), null, `${JSON.stringify(value)} should be refused`);
    }
  });

  it("keeps to the ceiling it is given", () => {
    assert.equal(parseQuantity("11"), null);
    assert.equal(parseQuantity("11", { max: 20 }), 11);
  });
});

describe("isObjectId", () => {
  it("accepts the twenty-four hex characters an ObjectId is", () => {
    assert.equal(isObjectId("507f1f77bcf86cd799439011"), true);
  });

  it("refuses anything a query should not be asked to interpret", () => {
    for (const value of ["", "not-an-id", "507f1f77bcf86cd79943901", "507f1f77bcf86cd7994390112", null, undefined, { $gt: "" }]) {
      assert.equal(isObjectId(value), false, `${JSON.stringify(value)} should be refused`);
    }
  });
});