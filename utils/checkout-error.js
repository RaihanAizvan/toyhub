// A checkout problem the shopper can act on. Anything that is not one of these
// is a bug, and a bug must never be reported as a stock problem.
//
// It lives on its own so the coupon rules and the checkout can both use it
// without importing each other.
export class CheckoutError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = "CheckoutError";
    this.status = status;
    this.details = details;
  }
}
