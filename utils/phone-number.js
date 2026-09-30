// The rule a mobile number has to follow, written down once, for the same reason
// `utils/password-policy.js` exists: the signup page and the signup handler were
// answering this question separately, and the page's answer refused a number
// written the way people write numbers.
//
// "98765 43210" and "98765-43210" and "+91 98765 43210" are all the same number.
// The page refused every one of them, so the number had to be typed as ten
// unbroken digits or not at all, and nothing said why. The handler, which is the
// one that actually stores the number, checked nothing.

// Spacing and punctuation people type into a phone field, and the country code
// the field already shows on screen. All of it is dropped before the number is
// looked at.
const FORMATTING = /[\s\-().]/g;
const COUNTRY_CODE = /^\+?91/;

export const normalizePhoneNumber = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  const digits = value.trim().replace(FORMATTING, "");
  return digits.replace(COUNTRY_CODE, "");
};

// Ten digits is an Indian mobile number; the rest of the range is what the field
// has always accepted, so it is not narrowed here.
export const PHONE_DIGITS = 10;
export const PHONE_MAX_DIGITS = 15;

export const isValidPhoneNumber = (value) => {
  const digits = normalizePhoneNumber(value);
  return /^\d+$/.test(digits) && digits.length >= PHONE_DIGITS && digits.length <= PHONE_MAX_DIGITS;
};

export const PHONE_POLICY_MESSAGE = `Enter a mobile number of ${PHONE_DIGITS} digits. Spaces, dashes and brackets are fine.`;

export const describePhoneNumber = (value) =>
  isValidPhoneNumber(value) ? "" : PHONE_POLICY_MESSAGE;

// Given to the page rather than kept in it, so the page and the handler cannot
// come to different answers about the same number.
export const phonePolicyScript = () =>
  `window.toyhubPhonePolicy = ${JSON.stringify({
    minDigits: PHONE_DIGITS,
    maxDigits: PHONE_MAX_DIGITS,
    message: PHONE_POLICY_MESSAGE,
  })};
window.toyhubPhonePolicy.normalize = function (value) {
  return String(value == null ? "" : value)
    .replace(/[\\s\\-().]/g, "")
    .replace(/^\\+?91/, "");
};
window.toyhubPhonePolicy.isValid = function (value) {
  var digits = window.toyhubPhonePolicy.normalize(value);
  return /^\\d+$/.test(digits)
    && digits.length >= this.minDigits
    && digits.length <= this.maxDigits;
};`;
