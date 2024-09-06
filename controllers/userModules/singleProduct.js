import Product from "../../models/product.models.js"
export const getSingleProduct = async (req, res) => {
    try {
        // Get the product ID from the URL params
        const productId = req.params.id;

        // Fetch the product from the database
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).redirect('/');
        }

        // Render the product page with dynamic data
        res.render('user/singleProduct', {
            title: product.name,
            product,
        });
    } catch (error) {
        console.error("Error fetching product:", error);
        res.status(500).send("Server error");
    }
};

export default {getSingleProduct}