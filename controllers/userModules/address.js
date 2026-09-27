import { isObjectId } from "../../utils/ownership.js";
import Users from "../../models/users.models.js";
import Address from "../../models/address.models.js";
import bcrypt from "bcrypt";
import {
  clearSessionCookie,
  invalidateUserSessions,
} from "../../utils/session.js";

const ADDRESS_FIELDS = {
  name: 60,
  street: 160,
  city: 60,
  state: 60,
  zip: 12,
};

const requireUserId = (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) {
    res.status(401).send("User not authenticated");
    return null;
  }
  return String(userId);
};

// Every address lookup is scoped to the session user, so an id that belongs to
// somebody else is indistinguishable from an id that does not exist.
const findOwnAddress = (userId, addressId) =>
  isObjectId(addressId)
    ? Address.findOne({ _id: addressId, user: userId })
    : null;

const readAddressInput = (body) => {
  const errors = [];
  const value = {};

  for (const [field, maxlength] of Object.entries(ADDRESS_FIELDS)) {
    const raw = typeof body?.[field] === "string" ? body[field].trim() : "";
    const normalized = raw.replace(/\s+/g, " ");

    if (!normalized) {
      errors.push(`${field} is required`);
    } else if (normalized.length > maxlength) {
      errors.push(`${field} must be at most ${maxlength} characters`);
    }

    value[field] = normalized;
  }

  const phone = typeof body?.phone === "string" ? body.phone.replace(/[\s+()-]/g, "") : "";
  if (!/^[0-9]{7,15}$/.test(phone)) {
    errors.push("phone must be 7 to 15 digits");
  }
  value.phone = phone;

  return { value, errors };
};

const listOwnAddresses = (userId) =>
  Address.find({ user: userId }).sort({ isDefault: -1, date: 1 });

// One account has one default address, so switching it is always a clear of the
// old flag followed by the new one inside the same request.
const makeDefault = async (userId, addressId) => {
  await Address.updateMany({ user: userId, isDefault: true }, { isDefault: false });
  await Address.updateOne({ _id: addressId, user: userId }, { isDefault: true });
};

const renderAddressList = async (req, res, { error = null, status = 200 } = {}) => {
  const userId = requireUserId(req, res);
  if (!userId) {
    return;
  }

  const [user, addresses] = await Promise.all([
    Users.findById(userId),
    listOwnAddresses(userId),
  ]);

  if (!user) {
    return res.status(404).send("User not found");
  }

  return res.status(status).render("user/profile-address", {
    title: "Manage Addresses",
    user,
    name: user.name,
    addresses,
    error,
  });
};

const getAddress = async (req, res) => {
  try {
    await renderAddressList(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
};

const postAddAddress = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const { value, errors } = readAddressInput(req.body);
    if (errors.length > 0) {
      return await renderAddressList(req, res, { error: errors.join(", "), status: 400 });
    }

    const existing = await listOwnAddresses(userId);
    const wantsDefault = req.body?.isDefault === "on" || req.body?.isDefault === "true";
    // The first address an account saves is its default without being asked.
    const isDefault = wantsDefault || existing.length === 0;

    const newAddress = new Address({
      user: userId,
      ...value,
      isDefault,
    });

    await newAddress.save();
    await Users.findByIdAndUpdate(userId, { $push: { addresses: newAddress._id } });

    if (isDefault && existing.some((address) => address.isDefault)) {
      await makeDefault(userId, newAddress._id);
    }

    req.session.toastrMessage = "Address added successfully";

    return res.redirect("/account/address");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
};

// GET: Show the edit address form
const getEditAddress = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const address = await findOwnAddress(userId, req.params.id);
    if (!address) {
      return res.status(404).send("Address not found");
    }

    return res.render("user/profile-editAddress", {
      title: "Edit Address",
      address,
      error: null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
};

// POST: Update address details
const postEditAddress = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const address = await findOwnAddress(userId, req.params.id);
    if (!address) {
      return res.status(404).send("Address not found");
    }

    const { value, errors } = readAddressInput(req.body);
    if (errors.length > 0) {
      return res.status(400).render("user/profile-editAddress", {
        title: "Edit Address",
        address: { ...address.toObject(), ...value },
        error: errors.join(", "),
      });
    }

    address.set(value);
    await address.save();

    req.session.toastrMessage = "Address updated successfully";

    return res.redirect("/account/address");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
};

// POST: Delete address
const postDeleteAddress = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const address = await findOwnAddress(userId, req.params.id);
    if (!address) {
      return res.status(404).send("Address not found");
    }

    await Address.deleteOne({ _id: address._id, user: userId });
    await Users.findByIdAndUpdate(userId, { $pull: { addresses: address._id } });

    // A deleted default hands the flag to the oldest address that is left.
    if (address.isDefault) {
      const remaining = await listOwnAddresses(userId);
      if (remaining.length > 0) {
        await makeDefault(userId, remaining[0]._id);
      }
    }

    req.session.toastrMessage = "Address deleted successfully";

    return res.redirect("/account/address");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
};

// POST: Make one of the session user's addresses the default
const postSetDefaultAddress = async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) {
      return;
    }

    const address = await findOwnAddress(userId, req.params.id);
    if (!address) {
      return res.status(404).send("Address not found");
    }

    await makeDefault(userId, address._id);

    req.session.toastrMessage = "Default address updated";

    return res.redirect("/account/address");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
};

const getChangePassword = (req, res) => {
  if (req.session.user.googleId) {
    console.log(1);
    return res.render("user/profile-changePasssword", {
      user: req.session.user,
      error: "Google users cannot change their password here. Please use Google account settings.",
      title: "Change Password",
      name: req.session.user?.name,
    });
  }
  res.render("user/profile-changePasssword", {
    user: req.session.user,
    error: null,
    title: "Change Password",
    name: req.session.user?.name,
    googleId: req.session.user?.googleId,
  });
};

// Handle the password change logic
const postChangePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.session.user.id; // Get the user ID from the logged-in session
    // Find the user by ID
    const user = await Users.findById(userId);

    // Check if current password matches
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.render("user/profile-changePasssword", {
        user: req.session.user,
        error: "Current password is incorrect",
        title: "Change Password",
        name: req.session.user?.name,
      });
    }

    // Check if new password and confirm password match
    if (newPassword !== confirmPassword) {
      return res.render("user/profile-changePasssword", {
        user: req.user,
        error: "Passwords do not match",
      });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update the user's password in the database
    user.password = hashedPassword;
    await user.save();

    // A password change invalidates every existing session for this account
    await invalidateUserSessions(user._id);
    clearSessionCookie(res);

    res.redirect("/user/login");
  } catch (error) {
    console.error(error);
    res.render("user/profile-changePasssword", {
      user: req.session.user,
      error: "An error occurred. Please try again later.",
      title: "Change Password",
    });
  }
};

export default {
  getAddress,
  postAddAddress,
  getEditAddress,
  postEditAddress,
  postDeleteAddress,
  postSetDefaultAddress,
  getChangePassword,
  postChangePassword,
};
