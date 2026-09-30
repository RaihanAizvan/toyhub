// The rule a password has to follow, written down once.
//
// It used to live twice: as a check in the signup handler, and as a regular
// expression in the signup page. The two were not the same rule, and they were
// not the same rule in the way the message said either: the page's expression
// allowed letters and digits and nothing else, while its message promised only
// "at least 8 characters long, contain one letter and one number". So a password
// like `ryhua10@Toyhub` was refused by the browser before it was ever sent, and
// the message blamed a rule the reader had never heard of.
//
// The page asks about a password before it is sent, so it needs the rule as well
// as the server. It is handed this one through `passwordPolicyScript`, and
// test/user-auth.test.js asks both of them the same questions about the same
// passwords, so the two cannot drift apart again without a test noticing.

export const PASSWORD_MIN_LENGTH = 8;

// What a password has to have. Nothing says it may not have symbols, so nothing
// refuses one: `@`, `.`, `-`, `!` and a space are all allowed, and are most of
// what people actually type.
export const PASSWORD_RULE = Object.freeze({
  minLength: PASSWORD_MIN_LENGTH,
  requiresLetter: true,
  requiresNumber: true,
});

export const isStrongPassword = (value) =>
  typeof value === "string" &&
  value.length >= PASSWORD_RULE.minLength &&
  /[A-Za-z]/.test(value) &&
  /\d/.test(value);

// Says the rule it is describing, in the same words as the rule: a length, and a
// letter and a number, and nothing about which characters are allowed.
export const PASSWORD_POLICY_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters long and contain at least one letter and one number. Any other characters are allowed.`;

export const describePassword = (value) =>
  isStrongPassword(value) ? "" : PASSWORD_POLICY_MESSAGE;

// The rule, in the form the page can read it. The page is given this rather than
// keeping its own copy, and the page has no way to import a module from the
// server, so it arrives as a small script.
//
// `isStrong` is written out from the same constants as the check above, so the
// two are the same check rather than two checks that were meant to be the same.
export const passwordPolicyScript = () =>
  `window.toyhubPasswordPolicy = ${JSON.stringify({
    ...PASSWORD_RULE,
    message: PASSWORD_POLICY_MESSAGE,
  })};
window.toyhubPasswordPolicy.isStrong = function (value) {
  var rule = window.toyhubPasswordPolicy;
  return typeof value === "string"
    && value.length >= rule.minLength
    && (!rule.requiresLetter || /[A-Za-z]/.test(value))
    && (!rule.requiresNumber || /\\d/.test(value));
};`;

// The same rule, as the regular expression the page used to carry by hand. Kept
// so there is one expression to be wrong about, and so a test can compare it with
// what the server does.
export const PASSWORD_PATTERN = new RegExp(
  `^(?=.*[A-Za-z])(?=.*\\d).{${PASSWORD_RULE.minLength},}$`,
);
