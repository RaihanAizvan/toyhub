import Product from "../../models/product.models.js"
import Category from '../../models/categories.model.js'; 


//defineing funtions for passing to the controller and then the controller passes it it to the router
export async function getAddProduct(req, res) {
    if (!req.session.sAdminEmail) {
      return res.redirect("/admin")
    }
    try {
      // Fetch categories using async/await
      const categories = await Category.find({});
      
      // Render the template and pass the categories
      res.render("admin/addProduct", { categories });
  } catch (err) {
      console.error(err);
      res.status(500).send("Error fetching categories");
  }
  }
  //function for adding new product details
async function postAddProduct(req, res) {
  console.log(`entered addProduct`);
  const { title, description1, description2, category, warning, type, color, weight, discount, sku, stock_quantity, regular_price, sale_price } = req.body;
    try {
      // Fetch categories using async/await
      const categories = await Category.find({});
      
      // Render the template and pass the categories
      res.render("admin/addProduct", { categories });
    } catch (err) {
      console.error(err);
      res.status(500).send("Error fetching categories");
}
try {
  let errors = {};

  // Validate title
  if (!title || title.length < 5) {
    errors.titleError = 'Title is required and must be at least 5 characters long';
  }

  // Validate description1
  if (!description1 || description1.length < 10) {
    errors.description1Error = 'Description 1 is required and must be at least 10 characters long';
  }

  // Validate description2
  if (!description2 || description2.length < 10) {
    errors.description2Error = 'Description 2 is required and must be at least 10 characters long';
  }

  // Validate category
  if (!category) {
    errors.categoryError = 'Category is required';
  }

  // Validate warning
  if (!warning) {
    errors.warningError = 'Warning is required';
  }

  // Validate type
  if (!type) {
    errors.typeError = 'Type is required';
  }

  // Validate color using a basic regex (hex color code)
  const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/; // Allows HEX colors like #FFF or #FFFFFF
  if (!color || !colorRegex.test(color)) {
    errors.colorError = 'Color is required and must be a valid hex color code (e.g., #FFF or #FFFFFF)';
  }

  // Validate weight (must be a decimal)
  if (!weight || isNaN(weight) || parseFloat(weight) <= 0) {
    errors.weightError = 'Weight is required and must be a valid decimal greater than 0';
  }

  // Validate discount (must be a decimal between 0 and 100)
  if (!discount || isNaN(discount) || parseFloat(discount) < 0 || parseFloat(discount) > 100) {
    errors.discountError = 'Discount is required and must be a decimal between 0 and 100';
  }

  // Validate SKU
  if (!sku) {
    errors.skuError = 'SKU is required';
  }

  // Validate stock_quantity (must be an integer)
  if (!stock_quantity || isNaN(stock_quantity) || !Number.isInteger(parseFloat(stock_quantity)) || parseInt(stock_quantity) < 0) {
    errors.stock_quantityError = 'Stock Quantity is required and must be a non-negative integer';
  }

  // Validate regular_price (must be a decimal greater than 0)
  if (!regular_price || isNaN(regular_price) || parseFloat(regular_price) <= 0) {
    errors.regular_priceError = 'Regular Price is required and must be a decimal greater than 0';
  }

  // Validate sale_price (must be a decimal greater than 0)
  if (!sale_price || isNaN(sale_price) || parseFloat(sale_price) <= 0) {
    errors.sale_priceError = 'Sale Price is required and must be a decimal greater than 0';
  }

  // If there are validation errors, return with the errors
  if (Object.keys(errors).length > 0) {
    return res.status(404).render('admin/addProduct', errors);
  }

  // Continue with product creation logic if no validation errors
} catch (error) {
  res.status(500).render('admin/addProduct', { message: 'Error validating product details' });
}

  
  let imageUrls = [];
  if (req.files && req.files.length > 0) {
    imageUrls = req.files.map(file => file.path); // Get image URLs
  }

  try {
    // Ensure the category exists
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(404).render('admin/addProduct', { message: 'Category not found',categories });
    }

    // Create a new product
    const product = new Product({
      name: title,
      description1,
      description2,
      warning,
      type,
      color,
      weight,
      discount,
      SKU: sku,
      category, 
      price: regular_price,
      stock: stock_quantity,
      images: imageUrls,
      sold: 0
    });

    await product.save();

    // Update category to reference the new product
    await Category.findByIdAndUpdate(category, {
      $push: { products: product._id }
    });

    res.redirect('/admin/products'); // Redirect to the products list page
  } catch (error) {
    console.error('Error adding product:', error);
    res.status(500).render('admin/addProduct', { message: 'Error adding product details' });
  }
}



  export default {
    getAddProduct,
    postAddProduct,
  }

