import Category from '../../models/categories.model.js';
import Product from '../../models/product.models.js';
import { isObjectId } from '../../utils/ownership.js';
import { withProductCounts } from '../../utils/categories.js';


async function getProductsByCategory(req, res){
    const categoryId = req.params.id;
    // An id that is not one asks for nothing rather than a database error,
    // and a category that is hidden sells no products on the storefront.
    if (!isObjectId(categoryId)) {
        return res.status(404).redirect('/');
    }
  try {
    const category = await Category.findById(categoryId).lean();
    if (!category || !category.isActive) {
        return res.status(404).redirect('/');
    }

    // Only what the shop is actually selling. A product in a category, but
    // blocked, is not for sale here.
    const products = await Product.find({
        category: categoryId,
        isBlocked: false,
    }).lean();

    res.render('user/categoryProducts', { categories: products, category, title: category.name, name: req.session?.user?.name });
  } catch (error) {
    console.error('Error fetching products by category:', error);
    res.status(500).redirect('/');
  }
}

async function getCategoryList(req, res) {
  try {
    // Hiding a category on the admin page has to hide it here too. Two of the
    // three storefront queries already only looked at live categories; this
    // was the one that showed everything, blocked categories included.
    const categories = await withProductCounts(
        await Category.find({ isActive: true }).sort({ createdAt: -1 }).lean(),
    );
    res.render('user/categoryList', { categories, title: 'Categories' });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).redirect('/');
  }
}

async function viewAllCategories(req, res) {
  try {
      const categories = await withProductCounts(
          await Category.find({ isActive: true }).sort({ createdAt: -1 }).lean(),
      );
      res.render('user/allCategories', { categories, title: 'All Categories' });
  } catch (error) {
      console.error('Error fetching all categories:', error);
      res.status(500).redirect('/');
  }
}




// Add this line to export the new function
export default {
  getProductsByCategory,
  getCategoryList,
  viewAllCategories,
}