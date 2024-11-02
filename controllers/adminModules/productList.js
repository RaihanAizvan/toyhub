import Product from "../../models/product.models.js";
import mongoose from "mongoose";
import Category from "../../models/categories.model.js";





// Function to render the product list page with pagination
export async function getProductList(req, res) {
    if (!req.session.sAdminEmail) {
        return res.redirect("/admin");
    }
    const page = parseInt(req.query.page) || 1; // Current page number
    const pageSize = parseInt(req.query.limit) || 10; // Number of products per page
    try {
        const totalProducts = await Product.countDocuments();
        const products = await Product.find({}).populate('category')
            .skip((page - 1) * pageSize) // Skip products for previous pages
            .limit(pageSize) // Limit the number of products per page
            .exec();

        res.set("Cache-Control", "no-store");
        console.log(products);
        res.render("admin/productList", {
            products,
            title: 'Product List',
            currentPage: page,
            totalPages: Math.ceil(totalProducts / pageSize)
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).render('admin/error', { message: 'Error fetching products' });
    }
}

export async function getEditProduct(req, res) {
    const productId = req.params.id;
    // Fetch product by ID from the database
    try {
        const product = await Product.findById(productId).populate('category');
        // Fetch all categories
        const categories = await Category.find({});
        // Render the edit product page, passing the product, category data, and existing category
        res.render('admin/editProduct', { product, categories, existingCategory: product.category });
    } catch (err) {
        console.log(err);
        res.redirect('/admin/products');
    }
}

export async function postEditProduct(req, res) {
    try {
        const productId = req.params.id;
        const {
            title,
            description1,
            description2,
            category,
            warning,
            type,
            color,
            weight,
            discount,
            sku,
            stock_quantity,
            regular_price,
            sale_price
        } = req.body;

        console.log('Received category:', category);
        console.log('Title is:', title);
        console.log('Body is:', req.body);

        // Check if all necessary fields are present
        if (!title || !category || !regular_price) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        // Validate category ObjectId
        if (!mongoose.Types.ObjectId.isValid(category)) {
            return res.status(400).json({ message: 'Invalid category ID' });
        }

        // Ensure product exists
        const existingProduct = await Product.findById(productId);
        if (!existingProduct) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Update product data
        const updatedProductData = {
            title,
            description1,
            description2,
            category: new mongoose.Types.ObjectId(category), // Use 'new' keyword
            warning,
            type,
            color,
            weight,
            discount,
            sku,
            stock:stock_quantity,
            regular_price,
            sale_price
        };

        // Update the product in the database
        const updatedProduct = await Product.findByIdAndUpdate(
            productId,
            updatedProductData,
            { new: true, runValidators: true }
        );

        res.status(200).json({
            message: 'Product updated successfully',
            product: updatedProduct
        });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ message: 'Error updating product' });
    }
}


export async function postBlockProduct(req, res) {
    const productId = req.params.id; // Assuming product ID is passed as a URL parameter

    try {
        // Check if productId is a valid ObjectId
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).send({ message: 'Invalid product ID' });
        }

        // Find the product by ID
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).send({ message: 'Product not found' });
        }

        // Toggle the `isBlocked` field: if true, set to false; if false, set to true
        product.isBlocked = !product.isBlocked;

        // Save the updated product
        await product.save();

        res.status(200).redirect('/admin/products');
    } catch (error) {
        console.error('Error toggling product block status:', error);
        res.status(500).send({ message: 'Internal server error' });
    }
}


export default {
    getProductList,
    getEditProduct,
    postEditProduct,
    postBlockProduct
}