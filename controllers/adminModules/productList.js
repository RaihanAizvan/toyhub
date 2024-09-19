import Product from "../../models/product.models.js";   
import mongoose from "mongoose";  
// Function to render the product list page with pagination
export async function getProductList(req, res) {
  if (!req.session.sAdminEmail) {
      return res.redirect("/admin");
  }

  const page = parseInt(req.query.page) || 1; // Current page number
  const pageSize = parseInt(req.query.limit) || 10; // Number of products per page

  try {
      const totalProducts = await Product.countDocuments();
      const products = await Product.find({})
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

async function postEditProduct(req, res) {
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
  
      // Validation
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).render('products/editProduct', {
          product: req.body,
          categories: await Category.find(), // Fetch categories for the dropdown
          titleError: errors.array(),
        });
      }
  
      // Handle file uploads
      let imagePaths = [];
      if (req.files && req.files.images) {
        const images = req.files.images;
        if (Array.isArray(images)) {
          images.forEach((image) => {
            const uploadPath = path.join(__dirname, '..', 'public', 'images', image.name);
            image.mv(uploadPath, (err) => {
              if (err) throw err;
            });
            imagePaths.push(`/images/${image.name}`);
          });
        } else {
          const uploadPath = path.join(__dirname, '..', 'public', 'images', images.name);
          images.mv(uploadPath, (err) => {
            if (err) throw err;
          });
          imagePaths.push(`/images/${images.name}`);
        }
      }
  
      // Find and update the product
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).send('Product not found');
      }
  
      product.title = title || product.title;
      product.description1 = description1 || product.description1;
      product.description2 = description2 || product.description2;
      product.category = category || product.category;
      product.warning = warning || product.warning;
      product.type = type || product.type;
      product.color = color || product.color;
      product.weight = weight || product.weight;
      product.discount = discount || product.discount;
      product.sku = sku || product.sku;
      product.stock_quantity = stock_quantity || product.stock_quantity;
      product.regular_price = regular_price || product.regular_price;
      product.sale_price = sale_price || product.sale_price;
  
      // Update image paths if new images are uploaded
      if (imagePaths.length > 0) {
        product.images = imagePaths;
      }
  
      await product.save();
  
      // Redirect to product list or another page after successful update
      res.redirect('/admin/products');
    } catch (err) {
      console.error('Error updating product:', err);
      res.status(500).render('products/editProduct', {
        message: 'Error updating product.',
        product: req.body,
        categories: await Category.find(), // Fetch categories for the dropdown
      });
    }
  };
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