
import Category from '../../models/categories.model.js';
import Product from '../../models/product.models.js';

async function getProductsByCategory(req,res){
    const categoryId = req.params.id;
  try {
    const categories = await Category.findById(categoryId).populate('products') ;
    const productInThisCategory = await Product.find({category:categoryId})
    console.log(productInThisCategory);
    if (!categories) {
        console.log(1);
        return res.status(404).redirect('/');
    }
    res.render('user/categoryProducts', { categories:productInThisCategory });
  } catch (error) {
    console.error('Error fetching products by category:', error);
    res.status(500).redirect('/');
  }
}

async function getCategoryList(req, res) {
  try {
    const categories = await Category.find().populate('products');
    res.render('user/categoryList', { categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).redirect('/');
  }
}

export default {
    getProductsByCategory,
    getCategoryList
}