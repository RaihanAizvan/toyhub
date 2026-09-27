import users from "../../models/users.models.js"
import validator from "validator"
import { readEnv } from "../../utils/config.js"
import { sendMail } from "../../utils/mailer.js"
import {
    DEFAULT_TOKEN_TTL_MS,
    burnPasswordCompare,
    hashPassword,
    hashToken,
    isTokenUsable,
    randomNumericOtp,
    randomToken,
    safeEqual,
    verifyPassword,
} from "../../utils/auth-tokens.js"
import {
    clearSessionCookie,
    invalidateUserSessions,
    regenerateSession,
} from "../../utils/session.js"

// Authentication policy, applied identically on every route:
//
// * Every failure answers with one generic message and the same status, so a
//   caller cannot learn whether an account exists, is blocked or is unverified.
// * OTPs are stored hashed, expire after OTP_TTL_MS, are single use, and accept
//   at most OTP_MAX_ATTEMPTS guesses per issued code.
// * OTP resends are rate limited per account by OTP_RESEND_COOLDOWN_MS and
//   OTP_MAX_RESENDS_PER_HOUR.
// * Logins are rate limited per account by LOGIN_MAX_ATTEMPTS /
//   LOGIN_LOCK_MS.
// * A successful login always rotates the session identifier.
// * An unverified account may sign in (verification happens during signup);
//   a blocked account is rejected with the generic failure response.

const GENERIC_AUTH_ERROR = "Invalid email or password";
const GENERIC_OTP_ERROR = "That code is not valid. Request a new one and try again.";
const GENERIC_RESET_ERROR = "This reset link is invalid or has expired.";

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_RESENDS_PER_HOUR = 3;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const RESET_REQUEST_COOLDOWN_MS = 60 * 1000;
const PASSWORD_SALT_ROUNDS = 12;

const renderLogin = (res, status, message) =>
    res.status(status).render("user/login", { title: 'Login', message });

const renderOtp = (res, status, message, extra = {}) =>
    res.status(status).render('user/otp', {
        title: 'OTP Verification',
        message,
        remainingTime: 0,
        ...extra,
    });

const renderReset = (res, message, token) =>
    res.status(200).render("user/resend-otp", {
        title: "Reset Password",
        message,
        token: token ?? null,
    });

const normalizeEmail = (value) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';

const isStrongPassword = (value) =>
    typeof value === 'string' &&
    value.length >= 8 &&
    /[A-Za-z]/.test(value) &&
    /\d/.test(value);

const issueOtp = (user) => {
    const otp = randomNumericOtp();
    user.otpHash = hashToken(otp);
    user.otpExpires = new Date(Date.now() + OTP_TTL_MS);
    user.otpIssuedAt = new Date();
    user.otpAttempts = 0;
    return otp;
};

const sendOtpMail = async (otp, target) => {
    try {
        await sendMail({
            to: target,
            subject: 'Your OTP for Signup',
            text: `Your OTP is ${otp}. It will expire in 5 minutes.`,
        });
    } catch (error) {
        console.error('Mail delivery failed:', error.message);
    }
};

const sendResetMail = async ({ token, target }) => {
    const link = `${readEnv('CALLBACK_URL').replace(/\/auth\/google\/callback\/?$/, '')}/user/reset-password?token=${token}`;
    try {
        await sendMail({
            to: target,
            subject: 'Reset your ToyHub password',
            text: `Use this link to choose a new password: ${link}\n\nThe link expires in ${Math.round(DEFAULT_TOKEN_TTL_MS / 60000)} minutes and can be used once. If you did not request it, ignore this email.`,
            html: `<p>Use this link to choose a new password:</p><p><a href="${link}">${link}</a></p><p>The link expires in ${Math.round(DEFAULT_TOKEN_TTL_MS / 60000)} minutes and can be used once. If you did not request it, ignore this email.</p>`,
        });
    } catch (error) {
        console.error('Mail delivery failed:', error.message);
    }
};

//! signup and OTP verification

function getSignup(req, res) {
    res.render('user/signup', { title: 'Signup' })
}

async function postSignup(req, res) {
    const { name, email, phone_number, password, confirmPassword } = req.body;
    try {
        if (!name || !email || !phone_number || !password) {
            return res.status(400).render("user/signup", {
                title: 'Sign Up',
                message: "All fields are required",
                name, email, phone_number
            });
        }

        if (!validator.isEmail(email)) {
            return res.status(400).render("user/signup", {
                title: 'Sign Up',
                message: 'Enter a valid email address',
                name, email, phone_number
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).render("user/signup", {
                title: 'Sign Up',
                message: "Passwords do not match",
                name, email, phone_number
            });
        }

        if (!isStrongPassword(password)) {
            return res.status(400).render("user/signup", {
                title: 'Sign Up',
                message: "Password must be at least 8 characters long and contain letters and numbers",
                name, email, phone_number
            });
        }

        const normalizedEmail = normalizeEmail(email);
        const existingUser = await users.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(400).render('user/signup', {
                title: 'Sign Up',
                message: 'Email already exists',
                name, email, phone_number
            });
        }

        const newUser = new users({
            name,
            email: normalizedEmail,
            phone_number,
            password: await hashPassword(password, PASSWORD_SALT_ROUNDS),
            walletBalance: 0
        });
        const otp = issueOtp(newUser);
        await newUser.save();

        await sendOtpMail(otp, normalizedEmail);

        req.session.email = normalizedEmail;
        return res.status(200).redirect('/user/otp');
    } catch (error) {
        console.error('Signup failed:', error.message);
        return res.status(500).render('user/signup', {
            title: 'Sign Up',
            message: "Internal Server Error",
            name, email, phone_number
        });
    }
}

async function getOtp(req, res) {
    const email = req.session?.email;
    if (!email) {
        return res.redirect('/user/signup');
    }

    try {
        const user = await users.findOne({ email });
        if (!user) {
            delete req.session.email;
            return res.redirect('/user/signup');
        }
        const remainingTime = Math.max(
            0,
            Math.floor(((user.otpExpires?.getTime() ?? 0) - Date.now()) / 1000),
        );
        res.render('user/otp', { remainingTime, title: 'OTP Verification' });
    } catch (error) {
        console.error('OTP page failed:', error.message);
        res.status(500).render('user/otp', { message: 'An error occurred while fetching the user', title: 'OTP Verification' });
    }
}

async function postOtp(req, res) {
    const email = req.session?.email;
    if (!email) {
        return res.redirect('/user/signup');
    }

    const enteredOtp = [
        req.body.otp1, req.body.otp2, req.body.otp3,
        req.body.otp4, req.body.otp5, req.body.otp6,
    ].join('');

    try {
        const user = await users.findOne({ email });
        if (!user) {
            delete req.session.email;
            return res.redirect('/user/signup');
        }

        if (user.verified) {
            return res.redirect('/user/login');
        }

        if (!isTokenUsable({ tokenHash: user.otpHash, expiresAt: user.otpExpires })) {
            return renderOtp(res, 400, GENERIC_OTP_ERROR);
        }

        if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
            return renderOtp(res, 429, GENERIC_OTP_ERROR);
        }

        const matches = safeEqual(user.otpHash, hashToken(enteredOtp));
        if (!matches) {
            user.otpAttempts = (user.otpAttempts ?? 0) + 1;
            await user.save();
            return renderOtp(res, 400, GENERIC_OTP_ERROR);
        }

        user.verified = true;
        user.otpHash = null;
        user.otpExpires = null;
        user.otpIssuedAt = null;
        user.otpAttempts = 0;
        await user.save();

        delete req.session.email;
        return res.status(200).redirect('/user/login');
    } catch (error) {
        console.error('OTP verification failed:', error.message);
        res.status(500).render('user/otp', { message: 'An error occurred while validating OTP', title: 'OTP Verification' });
    }
}

async function postResendOtp(req, res) {
    const email = req.session?.email;
    if (!email) {
        return res.redirect("/user/signup");
    }

    try {
        const user = await users.findOne({ email });
        if (!user) {
            delete req.session.email;
            return res.redirect("/user/signup");
        }

        const now = Date.now();
        const windowStart = user.otpResendWindowStart?.getTime() ?? 0;
        const resendsThisHour = now - windowStart < 60 * 60 * 1000
            ? (user.otpResendCount ?? 0)
            : 0;
        const lastIssuedAt = user.otpIssuedAt?.getTime() ?? 0;

        if (lastIssuedAt && now - lastIssuedAt < OTP_RESEND_COOLDOWN_MS) {
            return renderOtp(res, 429, 'Please wait before requesting another code.');
        }

        if (resendsThisHour >= OTP_MAX_RESENDS_PER_HOUR) {
            return renderOtp(res, 429, 'Too many codes requested. Try again later.');
        }

        const otp = issueOtp(user);
        user.otpResendCount = resendsThisHour + 1;
        user.otpResendWindowStart = windowStart === 0 || resendsThisHour === 0
            ? new Date(now)
            : user.otpResendWindowStart;
        await user.save();

        await sendOtpMail(otp, email);
        return renderOtp(res, 200, 'A new code is on its way.', { remainingTime: OTP_TTL_MS / 1000 });
    } catch (error) {
        console.error('OTP resend failed:', error.message);
        renderOtp(res, 500, 'An error occurred while resending the code');
    }
}

//! login and logout

function getLogin(req, res) {
    const blocked = req.query.blocked;
    if (req.session?.user) {
        return res.redirect("/")
    }
    res.render("user/login", { title: 'Login', message: blocked ? "Sorry You are Blocked" : "" })
}

async function postLogin(req, res) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            await burnPasswordCompare(password);
            return renderLogin(res, 400, "Email and password are required");
        }

        if (!validator.isEmail(email)) {
            await burnPasswordCompare(password);
            return renderLogin(res, 400, "Invalid email format");
        }

        const user = await users.findOne({ email: normalizeEmail(email) });
        const locked = Boolean(user?.loginLockedUntil && user.loginLockedUntil.getTime() > Date.now());

        if (locked || !user) {
            await burnPasswordCompare(password);
            if (user && !locked) {
                user.loginAttempts = (user.loginAttempts ?? 0) + 1;
                if (user.loginAttempts >= LOGIN_MAX_ATTEMPTS) {
                    user.loginLockedUntil = new Date(Date.now() + LOGIN_LOCK_MS);
                    user.loginAttempts = 0;
                }
                await user.save();
            }
            return renderLogin(res, 401, GENERIC_AUTH_ERROR);
        }

        const isMatch = await verifyPassword(password, user.password);
        if (!isMatch) {
            user.loginAttempts = (user.loginAttempts ?? 0) + 1;
            if (user.loginAttempts >= LOGIN_MAX_ATTEMPTS) {
                user.loginLockedUntil = new Date(Date.now() + LOGIN_LOCK_MS);
                user.loginAttempts = 0;
            }
            await user.save();
            return renderLogin(res, 401, GENERIC_AUTH_ERROR);
        }

        if (user.isBlocked) {
            return renderLogin(res, 401, GENERIC_AUTH_ERROR);
        }

        user.loginAttempts = 0;
        user.loginLockedUntil = null;
        user.lastLoginAt = new Date();
        await user.save();

        // Rotate the session identifier to prevent session fixation.
        await regenerateSession(req);
        req.session.user = {
            id: user._id,
            name: user.name
        };

        res.redirect("/");
    } catch (error) {
        console.error('Login failed:', error.message);
        renderLogin(res, 500, "Internal Server Error");
    }
}

async function getLogout(req, res) {
    try {
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err.message);
                return res.redirect('/');
            }
            clearSessionCookie(res);
            res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.redirect('/user/login');
        });
    } catch (error) {
        console.error('Logout failed:', error.message);
    }
}

//! password reset with a single-use, expiring, hashed token

function getForgotPassword(req, res) {
    res.render("user/forgot-password", { title: "Forgot Password" })
}

async function postForgotPassword(req, res) {
    const email = normalizeEmail(req.body?.email);
    const alwaysConfirm = {
        title: "Forgot Password",
        message: "If an account exists for that address, a reset link is on its way."
    };

    if (!email || !validator.isEmail(email)) {
        return res.status(200).render("user/forgot-password", alwaysConfirm);
    }

    try {
        const user = await users.findOne({ email });
        if (!user) {
            return res.status(200).render("user/forgot-password", alwaysConfirm);
        }

        const lastRequest = user.resetPasswordRequestedAt?.getTime() ?? 0;
        if (Date.now() - lastRequest < RESET_REQUEST_COOLDOWN_MS) {
            return res.status(200).render("user/forgot-password", alwaysConfirm);
        }

        const token = randomToken();
        user.resetPasswordTokenHash = hashToken(token);
        user.resetPasswordExpires = new Date(Date.now() + DEFAULT_TOKEN_TTL_MS);
        user.resetPasswordUsedAt = null;
        user.resetPasswordRequestedAt = new Date();
        await user.save();

        await sendResetMail({ token, target: email });
        return res.status(200).render("user/forgot-password", alwaysConfirm);
    } catch (error) {
        console.error('Password reset request failed:', error.message);
        return res.status(200).render("user/forgot-password", alwaysConfirm);
    }
}

function getResetPassword(req, res) {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) {
        return res.redirect('/user/forgot-password');
    }
    return renderReset(res, null, token);
}

async function postResetPassword(req, res) {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const { newPassword, confirmPassword } = req.body ?? {};

    if (!token) {
        return renderReset(res, GENERIC_RESET_ERROR);
    }

    if (newPassword !== confirmPassword) {
        return renderReset(res, "Passwords do not match", token);
    }

    if (!isStrongPassword(newPassword)) {
        return renderReset(
            res,
            "Password must be at least 8 characters long and contain letters and numbers",
            token,
        );
    }

    try {
        const user = await users.findOne({ resetPasswordTokenHash: hashToken(token) });
        const usable = isTokenUsable({
            tokenHash: user?.resetPasswordTokenHash,
            expiresAt: user?.resetPasswordExpires,
            usedAt: user?.resetPasswordUsedAt,
        });

        if (!user || !usable) {
            return renderReset(res, GENERIC_RESET_ERROR);
        }

        user.password = await hashPassword(newPassword, PASSWORD_SALT_ROUNDS);
        user.resetPasswordTokenHash = null;
        user.resetPasswordExpires = null;
        user.resetPasswordUsedAt = new Date();
        user.resetPasswordRequestedAt = null;
        user.loginAttempts = 0;
        user.loginLockedUntil = null;
        await user.save();

        // A reset invalidates every session that existed before it.
        await invalidateUserSessions(user._id);

        return res.redirect('/user/login?reset=1');
    } catch (error) {
        console.error('Password reset failed:', error.message);
        return renderReset(res, "Error resetting password. Please try again.");
    }
}

export default {
    postSignup,
    getSignup,
    getOtp,
    postOtp,
    getLogin,
    postLogin,
    postResendOtp,
    getLogout,
    getForgotPassword,
    postForgotPassword,
    getResetPassword,
    postResetPassword
}
