// The views still carry inline scripts and inline event handlers, and they load
// their libraries from a handful of CDNs. Both kinds of source belong to the
// *same* script-src directive: a semicolon before a source ends that directive,
// and everything after it is read as a directive name - which browsers ignore.
// Building the policy as one list per directive keeps that from happening again.
const scriptSources = [
  "'self'",
  "'unsafe-inline'",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://code.jquery.com",
  "https://cdnjs.cloudflare.com",
  "https://checkout.razorpay.com",
];

export const contentSecurityPolicy = [
  `script-src ${scriptSources.join(" ")}`,
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");
