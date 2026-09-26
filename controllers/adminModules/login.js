import bcrypt from "bcrypt";
import AdminUser from "../../models/admin.models.js";
import { readEnv } from "../../utils/config.js";

const isBcryptHash = (value) =>
  typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);

const getBootstrapAdmin = async (email) => {
  const bootstrapEmail = readEnv("ADMIN_EMAIL").toLowerCase();
  const bootstrapPassword = readEnv("ADMIN_PASSWORD");

  if (!bootstrapEmail || !bootstrapPassword || bootstrapEmail !== email) {
    return null;
  }

  const existingAdmin = await AdminUser.findOne({ email: bootstrapEmail });
  if (existingAdmin) {
    if (!isBcryptHash(existingAdmin.password)) {
      existingAdmin.password = await bcrypt.hash(bootstrapPassword, 12);
      await existingAdmin.save();
    }
    return existingAdmin;
  }

  const admin = new AdminUser({
    email: bootstrapEmail,
    password: await bcrypt.hash(bootstrapPassword, 12),
    role: "superadmin",
  });
  await admin.save();
  return admin;
};

const findAdmin = async (email) => {
  const admin = await AdminUser.findOne({ email });
  return admin || getBootstrapAdmin(email);
};

const renderLoginError = (res) => {
  res.set("Cache-Control", "no-store");
  return res
    .status(401)
    .render("admin/adminLogin", { error: "Invalid email or password" });
};

export function getLogin(req, res) {
  if (req.session.sAdminEmail) {
    return res.redirect("/admin");
  }
  res.set("Cache-Control", "no-store");
  return res.render("admin/adminLogin");
}

export async function postLogin(req, res) {
  const email =
    typeof req.body.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
  const password =
    typeof req.body.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return renderLoginError(res);
  }

  try {
    const admin = await findAdmin(email);
    if (!admin || !isBcryptHash(admin.password)) {
      return renderLoginError(res);
    }

    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) {
      return renderLoginError(res);
    }

    req.session.sAdminEmail = admin.email;
    return res.redirect("/admin");
  } catch (error) {
    console.error("Admin login failed:", error.message);
    return renderLoginError(res);
  }
}

export function postLogout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.redirect("/admin");
    }
    res.redirect("/admin/login");
  });
}

export default {
  getLogin,
  postLogin,
  postLogout,
};
