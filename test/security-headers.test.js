import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contentSecurityPolicy } from "../utils/security-headers.js";

// The coupon and offer pages wire their Delete/Block buttons through inline
// handlers and an inline script; the libraries they call live on CDNs. A policy
// that separates those sources from script-src with a semicolon leaves the
// browser enforcing `script-src 'self'`, so the buttons appear dead. These
// tests describe the policy a browser actually parses, not the string we wish
// it were.
const directives = (policy) =>
  policy
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...sources] = part.split(/\s+/);
      return { name, sources };
    });

describe("content security policy", () => {
  it("keeps inline handlers and the CDN bundles inside script-src", () => {
    const scriptSrc = directives(contentSecurityPolicy).find(
      ({ name }) => name === "script-src",
    );

    assert.ok(scriptSrc, "script-src directive is missing");

    for (const source of [
      "'self'",
      "'unsafe-inline'",
      "https://cdn.jsdelivr.net",
      "https://unpkg.com",
      "https://code.jquery.com",
      "https://cdnjs.cloudflare.com",
      "https://checkout.razorpay.com",
    ]) {
      assert.ok(
        scriptSrc.sources.includes(source),
        `script-src does not allow ${source}: ${contentSecurityPolicy}`,
      );
    }
  });

  it("does not turn sources into directives of their own", () => {
    for (const { name } of directives(contentSecurityPolicy)) {
      assert.match(
        name,
        /^[a-z-]+$/,
        `"${name}" is a source, not a CSP directive: ${contentSecurityPolicy}`,
      );
    }
  });
});
