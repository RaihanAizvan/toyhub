import AdminUser, { ADMIN_ROLES } from "../../models/admin.models.js";
import { readEnv } from "../../utils/config.js";
import {
  burnPasswordCompare,
  hashPassword,
  isBcryptHash,
  verifyPassword,
} from "../../utils/auth-tokens.js";
import { clearSessionCookie, regenerateSession } from "../../utils/session.js";

const GENERIC_LOGIN_ERROR = "Invalid email or password";

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isAdminAccount = (admin) =>
  Boolean(admin && admin.isActive && ADMIN_ROLES.includes(admin.role));

export const ensureBootstrapAdmin = async () => {
  const email = normalizeEmail(readEnv("ADMIN_EMAIL"));
  const password = readEnv("ADMIN_PASSWORD");

  if (!email || !password) {
    return null;
  }

  const existingAdmin = await AdminUser.findOne({ email });
  if (existingAdmin) {
    if (!isBcryptHash(existingAdmin.password)) {
      existingAdmin.password = await hashPassword(password);
      await existingAdmin.save();
    }
    return existingAdmin;
  }

  const admin = new AdminUser({
    email,
    password: await hashPassword(password),
    role: "superadmin",
    isActive: true,
  });
  await admin.save();
  return admin;
};

const renderLoginError = (res) => {
  res.set("Cache-Control", "no-store");
  return res
    .status(401)
    .render("admin/adminLogin", { error: GENERIC_LOGIN_ERROR });
};

export function getLogin(req, res) {
  if (req.session?.sAdminEmail) {
    return res.redirect("/admin");
  }
  res.set("Cache-Control", "no-store");
  return res.render("admin/adminLogin");
}

export async function postLogin(req, res) {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    await burnPasswordCompare(password);
    return renderLoginError(res);
  }

  try {
    const admin = await AdminUser.findOne({ email });
    const storedHash = isBcryptHash(admin?.password) ? admin.password : null;

    // Always run a comparison so a missing account, a non-admin role and a
    // wrong password take the same amount of time and return the same message.
    const isValid = storedHash
      ? await verifyPassword(password, storedHash)
      : await burnPasswordCompare(password);

    if (!isValid || !isAdminAccount(admin)) {
      return renderLoginError(res);
    }

    admin.lastLogin = new Date();
    await admin.save();

    await regenerateSession(req);
    req.session.sAdminEmail = admin.email;
    return res.redirect("/admin");
  } catch (error) {
    console.error("Admin login failed:", error.message);
    return renderLoginError(res);
  }
}

export function postLogout(req, res) {
  req.session.destroy((err) => {
    clearSessionCookie(res);
    if (err) {
      return res.redirect("/admin");
    }
    res.redirect("/admin/login");
  });
}

export default {
  ensureBootstrapAdmin,
  getLogin,
  postLogin,
  postLogout,
};
