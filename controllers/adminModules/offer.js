/**
 * @file offer.js   
 * @description This file contains the controller functions for managing offers in the admin panel.
 * @author Raihan
 */


import Offer from "../../models/offers.models.js";
import Product from "../../models/product.models.js";
import Category from "../../models/categories.model.js";


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
        const { name, description, offerPercentage, startDate, endDate, offerType, applicableProducts, applicableCategories } = req.body;

        // Validate required fields
        if (!name || !offerPercentage || !startDate || !endDate || !offerType) {
            return res.status(400).render("admin/addOffer", {
                title: "Add An Offer",
                message: "All fields are required"
            });
        }

        // Check if the offer already exists
        const existingOffer = await Offer.findOne({ name });
        if (existingOffer) {
            return res.status(400).render("admin/addOffer", {
                title: "Add An Offer",
                message: "Offer with this name already exists"
            });
        }

        

        // Check if the offer applies to all products
        if (offerType === "all") {
            const allProducts = await Product.find();
            if (allProducts.length === 0) {
                return res.status(400).render("admin/addOffer", {
                    title: "Add An Offer",
                    message: "No products available to apply the offer"
                });
            }
        }

        // Create and save the new offer
        const newOffer = new Offer({
            name,
            description,
            offerPercentage,
            startDate,
            endDate,
            offerType,
            applicableProducts: applicableProducts || [],
            applicableCategories: applicableCategories || []
        });
        await newOffer.save();

        // Update products with the new offer
        if (applicableProducts && applicableProducts.length > 0) {
            await Product.updateMany(
                { _id: { $in: applicableProducts } },
                { $addToSet: { availableOffers: newOffer._id } }
            );
        }

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

// Function to retrieve a specific offer by ID and render the edit offer page
const getEditOffer = async (req, res) => {
    const id = req.params.id;
    try {
        const offer = await Offer.findById(id); // Fetch offer by ID
        const products = await Product.find();
        const categories = await Category.find();
        res.render("admin/editOffer", {
            title: "Edit Offer",
            offer,
            products,
            categories
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
    const { name, description, offerPercentage, startDate, endDate, offerType, applicableProducts, applicableCategories } = req.body;

    try {
        const offer = await Offer.findById(id); // Fetch offer by ID
        if (!offer) {
            return res.status(404).render("admin/offers", {
                title: "Offers",
                message: "Offer not found"
            });
        }

        // Update offer details
        offer.name = name;
        offer.description = description;
        offer.offerPercentage = offerPercentage;
        offer.startDate = startDate;
        offer.endDate = endDate;
        offer.offerType = offerType;
        offer.applicableProducts = applicableProducts || [];
        offer.applicableCategories = applicableCategories || [];
        await offer.save();

        // Update products with the edited offer
        if (offerType === "all") {
            await Product.updateMany(
                {},
                { $addToSet: { availableOffers: offer._id } }
            );
        } else {
            if (applicableProducts && applicableProducts.length > 0) {
                await Product.updateMany(
                    { _id: { $in: applicableProducts } },
                    { $addToSet: { availableOffers: offer._id } }
                );
            }
        }

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