import Cart from "../../models/cart.models.js";
import Product from "../../models/product.models.js";

export const postAddProductToCart = async (req, res) => {
    try {
        console.log('entered post add product');
        if (!req.session.user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const userId = req.session.user.id;
        const { productId, quantity } = req.body;

        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        let cart = await Cart.findOne({ user: userId });
        if (!cart) {
            cart = new Cart({ user: userId, items: [] });
        }

        const existingItemIndex = cart.items.findIndex(item => item.product.toString() === productId);
        
        if (existingItemIndex > -1) {
            cart.items[existingItemIndex].quantity += quantity;
        } else {
            cart.items.push({
                product: productId,
                quantity,
                price: product.price,
                discountPrice: product.discountPrice || product.price,
                image: product.images[0]
            });
        }

        await cart.save();

        res.status(200).json({ 
            message: 'Product added to cart successfully',
            cartItemCount: cart.items.length
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

export const updateQuantity = async (req, res) => {
    try {
        const { cartId, productId, quantity } = req.body;

        const cart = await Cart.findById(cartId);
        if (!cart) {
            return res.status(404).json({ message: 'Cart not found' });
        }

        const itemIndex = cart.items.findIndex(item => item.product.toString() === productId);
        if (itemIndex === -1) {
            return res.status(404).json({ message: 'Product not in cart' });
        }

        cart.items[itemIndex].quantity = parseInt(quantity);
        cart.calculateTotals();
        await cart.save();

        res.status(200).json({
            message: 'Cart updated successfully',
            subtotal: cart.subtotal,
            total: cart.total,
            discount: cart.discount || 0
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

export const postRemoveItemFromCartHandler = async (req, res) => {
    try {
        const { cartId, productId } = req.body;
        

        const cart = await Cart.findById(cartId);
        if (!cart) {
            return res.status(404).json({ message: 'Cart not found' });
        }

        cart.items = cart.items.filter(item => item.product.toString() !== productId);
        cart.calculateTotals();
        await cart.save();

        res.status(200).json({
            message: 'Item removed from cart successfully',
            subtotal: cart.subtotal,
            total: cart.total,
            discount: cart.discount || 0,
            cartItemCount: cart.items.length
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

export const getCart = async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).redirect('/user/login');
        }
        
        const cart = await Cart.findOne({ user: req.session.user.id }).populate('items.product');
        if (!cart) {
            return res.render('user/cart', {
                title: 'Cart',
                user: req.session.user,
                cart: { items: [] }
            });
        }
        
        const cartItemsWithDetails = cart.items.map(item => ({
            product: item.product,
            quantity: item.quantity,
            price: item.price,
            discountPrice: item.discountPrice
        }));

        res.render('user/cart', {
            title: 'Cart',
            user: req.session.user,
            cart: {
                ...cart.toObject(),
                items: cartItemsWithDetails
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
};



export default{
    getCart,
    postAddProductToCart,
    updateQuantity,
    postRemoveItemFromCartHandler
}