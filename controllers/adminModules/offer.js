/**
 * @file offer.js   
 * @description This file contains the controller functions for managing offers in the admin panel.
 * @author Raihan
 */


import mongoose from "mongoose";
import Offer from "../../models/offers.models.js";
import Product from "../../models/product.models.js";
import Category from "../../models/categories.model.js";
import { isObjectId } from "../../utils/ownership.js";
import { OFFER_TYPES } from "../../utils/offer-rules.js";

// An offer is a rule the shop writes down, so what the admin form sent is read
// as a rule and checked as one. The form checks the same things in the browser
// and a browser check is a suggestion: a percentage of 140, an end date before
// the start, and an id that is not a product all used to be stored, and the
// first two were then applied to a price.
const readOffer = (body) => {
  const name = String(body.name || '').trim();
  if (!name) {
    throw new Error('An offer needs a name.');
  }

  if (!OFFER_TYPES.includes(body.offerType)) {
    throw new Error('An offer is for a product, a category, or the whole shop.');
  }

  const offerPercentage = Number(body.offerPercentage);
  if (!Number.isFinite(offerPercentage) || offerPercentage <= 0) {
    throw new Error('The discount has to be a number greater than zero.');
  }
  if (offerPercentage > 100) {
    throw new Error('A discount cannot be more than 100%.');
  }

  const startDate = new Date(body.startDate);
  const endDate = new Date(body.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('An offer needs a start date and an end date.');
  }
  if (endDate <= startDate) {
    throw new Error('The end date has to be after the start date.');
  }

  // A reference that is not an id is not a product, and an offer that names
  // nothing is a whole-shop offer, which is written with empty lists.
  const readIds = (value) => {
    const raw = Array.isArray(value) ? value : value ? [value] : [];
    return raw
      .map((entry) => String(entry ?? '').trim())
      .filter((entry) => isObjectId(entry));
  };

  return {
    name,
    description: String(body.description || '').trim(),
    offerPercentage,
    startDate,
    endDate,
    offerType: body.offerType,
    applicableProducts: readIds(body.applicableProducts),
    applicableCategories: readIds(body.applicableCategories),
  };
};

// A reference to something that does not exist would quietly apply to nothing,
// which is an offer the shop believes is running and no shopper can use.
const checkReferencesExist = async ({ applicableProducts, applicableCategories }) => {
  if (applicableProducts.length) {
    const found = await Product.countDocuments({ _id: { $in: applicableProducts } });
    if (found !== applicableProducts.length) {
      throw new Error('One of the products this offer is limited to does not exist.');
    }
  }

  if (applicableCategories.length) {
    const found = await Category.countDocuments({ _id: { $in: applicableCategories } });
    if (found !== applicableCategories.length) {
      throw new Error('One of the categories this offer is limited to does not exist.');
    }
  }
};

// A product carries a denormalised list of the offers it takes part in, used by
// the pages that list offer products. It is rewritten rather than added to, so
// narrowing an offer cannot leave a product claiming an offer it no longer gets.
const syncProductOfferLists = async (offer) => {
  await Product.updateMany({}, { $pull: { availableOffers: offer._id } });

  const everywhere = offer.offerType === 'all';
  if (everywhere || offer.applicableProducts.length) {
    const filter = everywhere ? {} : { _id: { $in: offer.applicableProducts } };
    await Product.updateMany(filter, { $addToSet: { availableOffers: offer._id } });
  }
};


//* **************************************************************************************************************************
/**
 * @function getOffers
 * @description Retrieves all offers from the database and renders the offers page.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
*/
//* **************************************************************************************************************************

// Function to retrieve all offers and render the offers page
const getOffers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1; // Get the current page number from query params, default to 1
        const limit = 10; // Number of offers per page
        const skip = (page - 1) * limit; // Calculate the number of offers to skip

        const totalOffers = await Offer.countDocuments(); // Get the total number of offers
        const totalPages = Math.ceil(totalOffers / limit); // Calculate the total number of pages

        const offers = await Offer.find().skip(skip).limit(limit); // Fetch offers with pagination

        res.render("admin/offers", {
            offers,
            title: "Offers",
            currentPage: page,
            totalPages: totalPages
        });
    } catch (error) {
        console.error(error.message); // Log error message
        res.status(500).render("admin/offers", {
            title: "Offers",
            message: "Internal server error"
        });
    }
}


//* **************************************************************************************************************************
/**
 * @function getAddOffer
 * @description Renders the add offer page.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
*/
//* **************************************************************************************************************************

const getAddOffer = async (req, res) => {
    const products = await Product.find();
    const categories = await Category.find({isActive:true});
    res.render("admin/addOffer", {
        title: "Add An Offer",
        products,
        categories
    });
}

//* **************************************************************************************************************************
/**
 * @function postAddOffer
 * @description Adds a new offer to the database. 
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
*/
//* **************************************************************************************************************************

// Function to add a new offer to the database
const postAddOffer = async (req, res) => {
    try {
        // A rule the shop got wrong is refused in words, not swallowed into a
        // 500, so the form can say what to change.
        let rule;
        try {
            rule = readOffer(req.body);
            await checkReferencesExist(rule);
        } catch (error) {
            return res.status(400).render("admin/addOffer", {
                title: "Add An Offer",
                message: error.message,
                products: await Product.find({ isBlocked: false }),
                categories: await Category.find({ isActive: true }),
                form: req.body,
            });
        }

        const existingOffer = await Offer.findOne({ name: rule.name });
        if (existingOffer) {
            return res.status(400).render("admin/addOffer", {
                title: "Add An Offer",
                message: "Offer with this name already exists",
                products: await Product.find({ isBlocked: false }),
                categories: await Category.find({ isActive: true }),
                form: req.body,
            });
        }

        const newOffer = new Offer(rule);
        await newOffer.save();
        await syncProductOfferLists(newOffer);

        res.redirect("/admin/offers");
    } catch (error) {
        console.error("Error adding offer:", error.message);
        res.status(500).render("admin/addOffer", {
            title: "Add An Offer",
            message: "Failed to add offer due to server error"
        });
    }
}

//* **************************************************************************************************************************
/**
 * @function getEditOffer
 * @description Retrieves a specific offer by ID and renders the edit offer page.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
*/
//* **************************************************************************************************************************

// The edit form needs the offer plus the products and categories it can name.
// The list is the same on a refused save as on a first visit, so the fields the
// admin already filled in are still there.
const getEditForm = async (id) => {
    const offer = await Offer.findById(id);
    if (!offer || !mongoose.isValidObjectId(id)) {
        return null;
    }

    return {
        offer,
        products: await Product.find({ isBlocked: false }),
        categories: await Category.find({ isActive: true }),
    };
};

// Function to retrieve a specific offer by ID and render the edit offer page
const getEditOffer = async (req, res) => {
    const id = req.params.id;
    try {
        const form = await getEditForm(id);
        if (!form) {
            return res.status(404).render("admin/offers", {
                title: "Offers",
                message: "Offer not found"
            });
        }

        res.render("admin/editOffer", {
            title: "Edit Offer",
            ...form
        });
    } catch (err) {
        console.error(err.message); // Log error message
        res.status(500).render("admin/offers", {
            title: "Offers",
            message: "Internal server error"
        });
    }
}

//* **************************************************************************************************************************
/**
 * @function postEditOffer
 * @description Updates an existing offer in the database.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
*/
//* **************************************************************************************************************************

// Function to update an existing offer in the database

const postEditOffer = async (req, res) => {
    const id = req.params.id;
    const form = await getEditForm(id);
    if (!form) {
        return res.status(404).render("admin/offers", {
            title: "Offers",
            message: "Offer not found"
        });
    }

    let rule;
    try {
        rule = readOffer(req.body);
        await checkReferencesExist(rule);
    } catch (error) {
        return res.status(400).render("admin/editOffer", {
            ...form,
            title: "Edit Offer",
            message: error.message,
            offer: form.offer,
            form: req.body,
        });
    }

    try {
        const offer = form.offer;
        Object.assign(offer, rule);
        await offer.save();
        await syncProductOfferLists(offer);

        res.redirect("/admin/offers");
    } catch (error) {
        console.error(error.message); // Log error message
        res.status(500).render("admin/editOffer", {
            ...form,
            title: "Edit Offer",
            message: "Internal server error"
        });
    }
}

//* **************************************************************************************************************************
/**
 * @function postBlockOffer
 * @description Toggles the block status of a specific offer.
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
*/
//* **************************************************************************************************************************

// Function to toggle the block status of a specific offer
const postBlockOffer = async (req, res) => {
    const id = req.params.id;
    try {
        const offer = await Offer.findById(id); // Fetch offer by ID
        if (!offer) {
            return res.status(404).render("admin/offers", {
                title: "Offers",
                message: "Offer not found"
            });
        }

        // Toggle the isBlocked status of the offer
        offer.isBlocked = !offer.isBlocked;
        await offer.save();
        res.redirect("/admin/offers");
    } catch (error) {
        console.error(error.message); // Log error message
        res.status(500).render("admin/offers", {
            title: "Offers",
            message: "Internal server error"
        });
    }
}

//* **************************************************************************************************************************
/**
 * @function deleteOffer
 * @description Deletes a specific offer from the database. Using the Delete method
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 */
//* **************************************************************************************************************************

// Function to delete a specific offer from the database
const deleteOffer = async (req, res) => {
    const id = req.params.id;
    try {
        const offer = await Offer.findByIdAndDelete(id); // Delete offer by ID
        if (!offer) {
            return res.status(404).render("admin/offers", {
                title: "Offers",
                message: "Offer not found"
            });
        }

        // A product that still lists the deleted offer is a product whose page
        // renders an offer that does not exist.
        await Product.updateMany({}, { $pull: { availableOffers: offer._id } });
        res.redirect("/admin/offers");
    } catch (error) {
        console.error(error.message); // Log error message
        res.status(500).render("admin/offers", {
            title: "Offers",
            message: "Internal server error"
        });
    }
}

export default {
    getOffers,
    getAddOffer,
    postAddOffer,
    getEditOffer,
    postEditOffer,
    postBlockOffer,
    deleteOffer
}