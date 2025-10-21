import Category from "../../models/categories.model.js";
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
    const { name, description } = req.body;
    const imageFile = req.file;

    try {
        // Validate: Check if name exists and has the required length
        if (!name) {
            return res.status(400).render('admin/editCategory', { message: 'Category name is required' });
        }
        if (name.length < 3 || name.length > 30) {
            return res.status(400).render('admin/editCategory', { message: 'Name must be between 3 and 30 characters' });
        }

        // Find the category by ID
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).render('admin/editCategory', { message: 'Category not found' });
        }

        // Validate: Check if new name already exists (case insensitive), excluding the current category being edited
        const existingCategory = await Category.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') }, _id: { $ne: req.params.id } });
        if (existingCategory) {
            return res.status(400).render('admin/editCategory', { message: 'Category name already exists' });
        }

        // Update category details
        category.name = name;
        category.description = description;

        if (imageFile) {
            // Upload the new image to Cloudinary
            const uploadResult = await cloudinary.uploader.upload(imageFile.path);
            category.image = uploadResult.secure_url;
        }

        await category.save();
        res.redirect('/admin/category');
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).render('admin/editCategory', { message: 'Error updating category' });
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