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
    try {
        const product = await Product.findById(productId).populate('category');
        const categories = await Category.find({isActive:true});
        
        res.render('admin/editProduct', { 
            product, 
            categories, 
            existingCategory: product.category,
            flashMessage: req.session.flashMessage || null
        });
        
        // Clear flash message after use
        delete req.session.flashMessage;
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
            price,
            deletedImages
        } = req.body;
        
        // Validate required fields
        if (!title || !category || !price) {
            req.session.flashMessage = {
                type: 'error',
                message: 'Required fields are missing'
            };
            return res.redirect(`/admin/editProduct/${productId}`);
        }

        // Get existing product
        const existingProduct = await Product.findById(productId);
        if (!existingProduct) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Handle deleted images
        let remainingImages = existingProduct.images;
        if (deletedImages) {
            const deletedImagesList = Array.isArray(deletedImages) ? deletedImages : [deletedImages];
            
            // Remove deleted images from storage
            for (const imagePath of deletedImagesList) {
                const fullPath = path.join(process.cwd(), 'public', imagePath);
                await fs.unlink(fullPath).catch(err => console.log('Error deleting file:', err));
            }
            
            // Update remaining images array
            remainingImages = existingProduct.images.filter(img => !deletedImagesList.includes(img));
        }

        // Handle new images
        let newImagePaths = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const filename = `product-${Date.now()}-${Math.round(Math.random() * 1E9)}.webp`;
                const imagePath = path.join('uploads', 'products', filename);
                const fullPath = path.join(process.cwd(), 'public', imagePath);

                // Process and save image
                await sharp(file.buffer)
                    .resize(800, 800, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
                    .webp({ quality: 80 })
                    .toFile(fullPath);

                newImagePaths.push(imagePath);
            }
        }

        // Update product data
        const updatedProductData = {
            title,
            description1,
            description2,
            category: new mongoose.Types.ObjectId(category),
            warning,
            type,
            color,
            weight,
            discount,
            priceAfterDiscount: Math.ceil(price * (1 - discount / 100)),
            sku,
            stock: stock_quantity,
            price,
            images: [...remainingImages, ...newImagePaths]
        };
        // Update the product
        await Product.findByIdAndUpdate(
            productId,
            updatedProductData,
            { new: true, runValidators: true }
        );

        req.session.flashMessage = {
            type: 'success',
            message: 'Product updated successfully'
        };
        
        res.redirect('/admin/products');
    } catch (error) {
        console.error('Error updating product:', error);
        req.session.flashMessage = {
            type: 'error',
            message: 'Error updating product'
        };
        res.redirect(`/admin/editProduct/${req.params.id}`);
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