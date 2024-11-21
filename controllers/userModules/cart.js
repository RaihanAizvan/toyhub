import Cart from "../../models/cart.models.js";
import Product from "../../models/product.models.js";
import Offer from "../../models/offers.models.js";
import User from "../../models/users.models.js";


// Function to add products to cart
export const postAddProductToCart = async (req, res) => {
    try {
        
        if (!req.session.user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const { products } = req.body; // products is an array of { productId, quantity }
        const userId = req.session.user.id;

        let cart = await Cart.findOne({ user: userId }) || new Cart({ user: userId, items: [] });

        for (const { productId, quantity } of products) {
            const product = await Product.findById(productId); // Fetch the product directly
            if (!product) {
                return res.status(404).json({ message: `Product with ID ${productId} not found` });
            }

            const existingItemIndex = cart.items.findIndex(item => item.product.toString() === productId);
            if (existingItemIndex > -1) {
                cart.items[existingItemIndex].quantity += quantity;
            } else {
                cart.items.push({
                    product: productId,
                    quantity,
                    price: product.price,
                    priceAfterDiscount: product.priceAfterDiscount || product.price,
                    discountPrice: product.discount,
                    image: product.images[0]
                });
            }
        }

        // Calculate total discount based on quantity and product discounts
        cart.discount = cart.items.reduce((acc, item) => {
            const productDiscount = (item.price * item.quantity * item.discountPrice) / 100;
            return acc + productDiscount;
        }, 0);

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

// Function to update product quantity in cart and recalculate the total
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

        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Update quantity and prices
        cart.items[itemIndex].quantity = parseInt(quantity);
        cart.items[itemIndex].price = product.price;

        // Recalculate subtotal and discounts
        cart.subtotal = cart.items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        cart.discount = cart.items.reduce((acc, item) => {
            const discountAmount = (item.price * item.quantity * item.discountPrice) / 100;
            return acc + discountAmount;
        }, 0);

        // Calculate offerDiscount if available
        cart.offerDiscount = cart.items.reduce((acc, item) => {
            const offerAmount = item.price * item.offerDiscount || 0;
            return acc + offerAmount;
        }, 0);

        // Calculate final total
        cart.total = cart.subtotal - cart.discount - cart.offerDiscount;

        // Apply cutoff
        const minimumTotal = cart.subtotal * 0.20;
        if (cart.total < minimumTotal) {
            cart.cutoffAmount = minimumTotal - cart.total;
            cart.total = minimumTotal;
        } else {
            cart.cutoffAmount = 0;
        }
        console.log(cart.total)

        await cart.save();

        res.status(200).json({
            message: 'Cart updated successfully',
            subtotal: cart.subtotal,
            total: cart.total,
            discount: cart.discount,
            offerDiscount: cart.offerDiscount,
            cutoffAmount: cart.cutoffAmount
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

        // Find the item to be removed
        const itemToRemove = cart.items.find(item => item.product.toString() === productId);
        if (!itemToRemove) {
            return res.status(404).json({ message: 'Product not in cart' });
        }

        // Calculate and reduce the discount for the removed item
        const discountReduction = (itemToRemove.price * itemToRemove.quantity * itemToRemove.discountPrice) / 100;
        cart.discount = (cart.discount || 0) - discountReduction;

        // Remove the item from the cart
        cart.items = cart.items.filter(item => item.product.toString() !== productId);

        await cart.save();

        res.status(200).json({
            message: 'Item removed from cart successfully',
            subtotal: cart.subtotal,
            total: cart.total,
            discount: cart.discount,
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
            name: req.session.user?.name,
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

export const postUpdateTotal = async (req, res) => {
    try {   
        const { totalAmount, discount } = req.body;
       
        const cart = await Cart.findOneAndUpdate({ user: req.session.user.id }, { total: totalAmount, discount });
    
        res.status(200).json({ message: 'Total amount updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

export default {
    getCart,
    postAddProductToCart,
    updateQuantity,
    postRemoveItemFromCartHandler,
    postUpdateTotal
}