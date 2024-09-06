import Product from "../../models/product.models.js";   
import mongoose from "mongoose";  
export async function getProductList(req, res) {
    try {
        // Fetch all products from the database
        const products = await Product.find({});
        
        // Render the template and pass the products data
        res.render("admin/productList", { products });
    } catch (err) {
        console.error(err);
        res.status(500).redirect("/admin/products");
    }
}
export async function getEditProduct(req, res) {
        const productId = req.params.id;
        console.log(1);
        // Fetch product by ID from the database
        try {
            const product = await Product.findById(productId);
            // Render the edit product page, passing the product data
            res.render('admin/editProduct', { product });
        } catch (err) {
            console.log(err);
            res.redirect('/admin/products');
        }
}

export async function postEditProduct(req, res) {
    try {
        const productId = req.params.id;
        const updatedData = req.body; // Form data from the edit product form

        // Find the product by ID and update it with the new data
        await Product.findByIdAndUpdate(productId, updatedData);

        // Redirect back to the product listing page
        res.redirect('/admin/products');
    } catch (err) {
        console.log(err);
        res.redirect('/admin/products');
    }
}

async function postBlockProduct(req, res) {
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

export default { getProductList, getEditProduct, postEditProduct ,postBlockProduct}