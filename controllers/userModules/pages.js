import Category from "../../models/categories.model.js";

// The header offers the live categories as search filters, so these pages fill
// the same list instead of showing only "All Categories". A shop without a
// database should still be able to explain itself, hence the empty fallback.
const renderPage = async (req, res, view, title) => {
    let categories = [];
    try {
        categories = await Category.find({ isActive: true }).lean();
    } catch (error) {
        console.error(`Could not load categories for ${view}:`, error.message);
    }

    return res.render(`user/${view}`, {
        title,
        categories,
        name: req.session?.user?.name,
    });
};

export const getAbout = (req, res) => renderPage(req, res, "about", "About ToyHub");

export const getContact = (req, res) => renderPage(req, res, "contact", "Contact ToyHub");

export const getPrivacy = (req, res) => renderPage(req, res, "privacy", "Privacy at ToyHub");

export default {
    getAbout,
    getContact,
    getPrivacy,
};
