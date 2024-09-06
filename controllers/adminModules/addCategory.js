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
        // Fetch the list of categories from the database
        const categories = await Category.find({});
        res.set("Cache-Control", "no-store");
        res.render("admin/addCategory", { categories,title:'Categories' });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).render('admin/addCategory', { message: 'Error fetching categories' });
    }
}

// Function to handle adding a new category
export async function postAddCategory(req, res) {
    const { name } = req.body;
    try {
      if (!name) {
        return res.status(400).render('admin/addCategory', { nameError: 'Name is required' });
      }
      const imageUrl = req.file ? req.file.path : '';
      const category = new Category({
        name,
        image: imageUrl
      });
      await category.save();
      res.redirect('/admin/category');
    } catch (error) {
      console.error('Error adding category:', error);
      res.status(500).render('admin/addCategory', { message: 'Error adding category details' });
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

    const { name, description } = req.body;  // Extract text fields
    const imageFile = req.file;              // Extract uploaded file

    try {
        if (!name) {
            console.log('No name provided');
            return res.status(400).render('admin/editCategory', { message: 'Name is required' });
        }

        // Find the category by ID
        const category = await Category.findById(req.params.id);
        if (!category) {
            console.log('Category not found');
            return res.status(404).render('admin/editCategory', { message: 'Category not found' });
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
        console.log('Category updated successfully');
        res.redirect('/admin/category');  // Redirect to the categories list page
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).render('admin/editCategory', { message: 'Error updating category' });
    }
}

// Function to handle deleting a category
export async function postDeleteCategory(req, res) {
    const categoryId = req.params.id;

    try {
        await Category.findByIdAndDelete(categoryId);
        res.redirect('/admin/category');
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).render('admin/error', { message: 'Error deleting category' });
    }
}

export default {
    getAddCategory,
    postAddCategory,
    postEditCategory,
    postDeleteCategory,
    getEditCategory
};