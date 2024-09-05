import Product from "../../models/product.models.js"


//defineing funtions for passing to the controller and then the controller passes it it to the router
export function getAddProduct(req, res) {
    if (!req.session.sAdminEmail) {
      return res.redirect("/admin")
    }
    res.set("Cache-Control", "no-store")
   res.render("admin/addProduct")
  }


  //function for adding new product details
 
async function postAddProduct(req, res) {
  console.log(`entered addProduct`);
  const { title, description1, description2, category, warning, type, color, weight, discount, sku, stock_quantity, regular_price, sale_price } = req.body;
  try {

        //validating product details
        if (!title) {
          let titleError = 'Title is required';
          return res.status(404).render('admin/addProduct',{titleError})
        }
        if (!description1) {
          let description1Error = 'Description 1 is required';
          return res.status(404).render('admin/addProduct',{description1Error})
        }
        if (!description2) {
          let description2Error = 'Description 2 is required';
          return res.status(404).render('admin/addProduct',{description2Error})
        }
        if (!category) {
          let categoryError = 'Category is required';
          return res.status(404).render('admin/addProduct',{categoryError})
        }
        if (!warning) {
          let  warningError = 'Warning is required';
          return res.status(404).render('admin/addProduct',{warningError})
        }
        if (!type) {
          let typeError = 'Type is required';
          return res.status(404).render('admin/addProduct',{typeError})
        }
        if (!color) {
          let colorError = 'Color is required';
          return res.status(404).render('admin/addProduct',{colorError})
        }
        if (!weight) {
          let weightError = 'Weight is required';
          return res.status(404).render('admin/addProduct',{weightError})
        }
        if (!discount) {
          let  discountError = 'Discount is required';
          return res.status(404).render('admin/addProduct',{discountError})
        }
        if (!sku) {
          let  skuError = 'SKU is required';
          return res.status(404).render('admin/addProduct',{skuError})
        }
        if (!stock_quantity) {
          let stock_quantityError = 'Stock Quantity is required';
          return res.status(404).render('admin/addProduct',{stock_quantityError})
        }
        if (!regular_price) {
          let regular_priceError = 'Regular Price is required';
          return res.status(404).render('admin/addProduct',{regular_priceError})
        }
        if (!sale_price) {
          let sale_priceError = 'Sale Price is required';
          return res.status(404).render('admin/addProduct',{sale_priceError})
        }
    
  } catch (error) {
    res.status(404).render('admin/addProduct',{message : 'error validating product details'})
  }
  
  let imageUrls = [];
    if (req.files && req.files.length > 0) {
      console.log(`entered the condition`);
      imageUrls = req.files.map(file => file.path); // Get image URLs
    }
    console.log(`images are ${imageUrls}`);


  // Create a new product
  try {
    const product = new Product({
      name: title,
      decp1: description1,
      desp2: description2,
      warnings: warning,
      type: type,
      color: color,
      weight: weight,
      discount: discount,
      SKU: sku,
      category: category,
      price: regular_price,
      stock: stock_quantity,
      images: imageUrls,
      sold: 0
    });
    await product.save();
    console.log(`product added`);
    res.send('Product added');
  } catch (error) {
    res.status(404).render('admin/addProduct', { message: 'Error adding product details' });
  }
}

  export default {
    getAddProduct,
    postAddProduct,
  }

