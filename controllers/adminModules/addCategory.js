import Category from "../../models/categories.model.js";
import mongoose from "mongoose";
import cloudinary from "../../utils/cloudinary.js";
import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';

// Function to render the add category page
export async function getAddCategory(req, res) {
    if (!req.session.sAdminEmail) {
        return res.redirect("/admin");
    }
    
    try {
        // Pagination parameters
        const page = parseInt(req.query.page) || 1; // Current page
        const pageSize = parseInt(req.query.limit) || 6; // Number of categories per page

        // Fetch the total number of categories
        const totalCategories = await Category.countDocuments();

        // Fetch the categories for the current page
        const categories = await Category.find({})
            .skip((page - 1) * pageSize) // Skip products for previous pages
            .limit(pageSize) // Limit the number of products per page
            .exec();

        res.set("Cache-Control", "no-store");
        res.render("admin/addCategory", {
            categories,
            title: 'Categories',
            currentPage: page,
            totalPages: Math.ceil(totalCategories / pageSize)
        });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).render('admin/addCategory', { message: 'Error fetching categories' });
    }
}

// Function to handle adding a new category
export async function postAddCategory(req, res) {
    const categories = await Category.find({});
    const { name } = req.body;
    try {
        // Validate: Check if name exists and has the required length
        if (!name  || name.length < 3 || name.trim()==='') {
            return res.status(400).render('admin/addCategory', { nameError: 'Category name is required',categories});
        }
        if (name.length < 3 || name.length > 30) {
            return res.status(400).render('admin/addCategory', { nameError: 'Name must be between 3 and 30 characters' ,categories});
        }

        // Validate: Check if category with the same name exists (case insensitive)
        const existingCategory = await Category.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
        if (existingCategory) {
            return res.status(400).render('admin/addCategory', { nameError: 'Category name already exists' ,categories});
        }

        // Proceed with saving the category if validation passed
        const imageUrl = req.file ? req.file.path : '';
        const category = new Category({
            name,
            image: imageUrl
        });
        await category.save();
        res.redirect('/admin/category');
    } catch (error) {
        console.error('Error adding category:', error);
        res.status(500).render('admin/addCategory', { message: 'Error adding category details',categories });
    }
}

export async function getEditCategory(req, res) {
    const categoryId = req.params.id;
    try {
        const category = await Category.findById(categoryId);
        if (!category) {
            return res.status(404).render('admin/error', { message: 'Category not found' });
        }
        res.render('admin/editCategory', { category });
    } catch (error) {
        console.error('Error fetching category for edit:', error);
        res.status(500).render('admin/error', { message: 'Error fetching category for editing' });
    }
}

export async function postEditCategory(req, res) {
    const { name } = req.body;
    const imageFile = req.file;

    // The form is the answer to every one of these. It reads the category it is
    // editing, so it has to be given that category every time — which it was not:
    // each of the branches below rendered it with a message and nothing else, and
    // the form asks for `category.name` in its very first field. So a name that
    // was too short, or already taken, or empty produced a page about a missing
    // variable rather than the message that was written to explain it.
    //
    // So the category is fetched first, and every refusal is answered through the
    // one place that knows how to render this form.
    let category = null;

    const refuse = (status, message) => {
        if (!category) {
            return res.status(status).render('admin/error', { message });
        }

        // `name` is what was typed, so the field comes back holding the words being
        // objected to rather than the words that were already saved. Sending someone
        // back to a form that has forgotten what they just wrote is a small way of
        // making a typo cost twice.
        return res.status(status).render('admin/editCategory', { category, name, message });
    };

    try {
        // An id that is not one asks for nothing, rather than for a server error:
        // `findById` with a malformed id throws, and that throw used to be caught
        // as though the database had failed.
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return refuse(404, 'That category is not in the shop.');
        }

        category = await Category.findById(req.params.id);
        if (!category) {
            return refuse(404, 'That category is not in the shop.');
        }

        // Validate: Check if name exists and has the required length
        if (!name) {
            return refuse(400, 'Category name is required');
        }
        if (name.length < 3 || name.length > 30) {
            return refuse(400, 'Name must be between 3 and 30 characters');
        }

        // Validate: Check if new name already exists (case insensitive), excluding the current category being edited
        const existingCategory = await Category.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') }, _id: { $ne: req.params.id } });
        if (existingCategory) {
            return refuse(400, 'Category name already exists');
        }

        // Update category details
        category.name = name;

        // No description is set here, though this function used to read one out of
        // the form. The form has never had a description field, and the schema has
        // never had a description to put it in, so the value was always undefined
        // and always discarded — a line that read as though descriptions were
        // editable here when nothing of the kind happens on this page.
        // eslint-disable-next-line no-warning-comments
        // (TODO: if categories are ever meant to have descriptions, that is a change
        // to the schema and to the form together, not to this function alone.)

        if (imageFile) {
            // Upload the new image to Cloudinary
            const uploadResult = await cloudinary.uploader.upload(imageFile.path);
            category.image = uploadResult.secure_url;
        }

        await category.save();
        res.redirect('/admin/category');
    } catch (error) {
        console.error('Error updating category:', error);
        refuse(500, 'The category could not be saved. Nothing has been changed.');
    }
}


// Function to handle deleting a category
export async function postDeleteCategory(req, res) {
    const categoryId = req.params.id;

    try {
        const category = await Category.findById(categoryId);
        if (!category) {
            return res.status(404).render('admin/error', { message: 'Category not found' });
        }
        if (category.isActive === undefined) {
            category.isActive = false;
        }
        category.isActive = !category.isActive;
        await category.save();
        res.redirect('/admin/category');
    } catch (error) {
        console.error('Error toggling category status:', error);
        res.status(500).render('admin/error', { message: 'Error toggling category status' });
    }
}

export default {
    getAddCategory,
    postAddCategory,
    postEditCategory,
    postDeleteCategory,
    getEditCategory
};