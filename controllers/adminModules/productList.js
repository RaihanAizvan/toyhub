import Product from "../../models/product.models.js";
import mongoose from "mongoose";
import Category from "../../models/categories.model.js";
import {
    isObjectIdLike,
    postedProductValues,
    readProductEditForm,
} from "../../utils/product-form.js";
import { destroyStoredImages, destroyUploadedImages } from "../../utils/uploads.js";

// The form's names, the schema's names and the discount arithmetic live in
// utils/product-form.js, and the image host is reached only through
// utils/uploads.js. This file is the request: check it, write it once, and say
// what happened.

// The form posts with fetch and reads the answer as json, because the cropped
// pictures are built in the browser. A request that arrives any other way is
// answered with the page it would have shown.
const wantsJson = (req) =>
    req.xhr === true || String(req.get?.("accept") ?? "").includes("application/json");

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

    // A product is found by its id, and an id that is not one asks for nothing
    // rather than for a server error. Both were caught by the same catch as a
    // database failure and sent back to the list without saying why.
    if (!isObjectIdLike(productId)) {
        return notFound(req, res);
    }

    try {
        const product = await Product.findById(productId).populate('category');

        if (!product) {
            return notFound(req, res);
        }

        // The category the product is in is offered even when the list of active
        // categories does not contain it: a product is not moved out of its
        // category by that category being hidden, and a form that does not offer
        // the answer it is currently showing saves whichever category happens to
        // be first in the list.
        const categories = await Category.find({ isActive: true });
        addCurrentCategory(categories, product.category);

        res.render('admin/editProduct', {
            product,
            categories,
            existingCategory: product.category,
            errors: {},
            flashMessage: req.session.flashMessage || null
        });

        // Clear flash message after use
        delete req.session.flashMessage;
    } catch (err) {
        console.error('Error loading product for edit:', err);
        res.status(500).redirect('/admin/products');
    }
}

const addCurrentCategory = (categories, current) => {
    if (current && !categories.some((category) => String(category._id) === String(current._id))) {
        categories.unshift(current);
    }
    return categories;
};

const notFound = (req, res) => {
    const message = 'That product is not in the shop.';

    if (wantsJson(req)) {
        return res.status(404).json({ success: false, errors: { formError: message } });
    }

    req.session.flashMessage = { type: 'error', message };
    return res.redirect('/admin/products');
};

// The one place a refused edit is answered, so every refusal looks the same: what
// was wrong, beside which field, and the values that were typed so they are not
// typed again.
const refuse = async (req, res, errors, { status = 400, product = null } = {}) => {
    if (wantsJson(req)) {
        return res.status(status).json({ success: false, errors, values: postedProductValues(req.body) });
    }

    if (!product) {
        return res.status(status).redirect(`/admin/editProduct/${req.params.id}`);
    }

    const categories = await Category.find({ isActive: true }).catch(() => []);
    addCurrentCategory(categories, product.category);

    return res.status(status).render('admin/editProduct', {
        product,
        categories,
        existingCategory: product.category,
        errors,
        values: postedProductValues(req.body),
    });
};

export async function postEditProduct(req, res) {
    const productId = req.params.id;

    if (!isObjectIdLike(productId)) {
        await destroyUploadedImages(req.files);
        return notFound(req, res);
    }

    const existing = await Product.findById(productId).populate('category').catch((error) => {
        console.error('Error loading product to edit:', error);
        return null;
    });

    if (!existing) {
        await destroyUploadedImages(req.files);
        return notFound(req, res);
    }

    const currentImages = Array.isArray(existing.images) ? existing.images : [];

    // The product's own pictures are the only ones a request can keep or remove,
    // so an edit cannot point a product at somebody else's picture, and cannot
    // take a picture off a product that is not this one. A path that arrives
    // from the request and is not one of this product's is ignored and said so.
    const { ok, values, errors, images, removed, unknown } = readProductEditForm(
        req.body,
        req.files,
        currentImages,
    );

    if (unknown.length > 0) {
        errors.imageError = "One of the pictures to keep is not one of this product's, and has been ignored.";
    }

    if (!ok) {
        await destroyUploadedImages(req.files);
        return refuse(req, res, errors, { product: existing });
    }

    // The two questions a form cannot answer for itself, asked before anything is
    // written: does the category exist, and has this name been used by a product
    // other than this one. A product keeping its own name is not a duplicate.
    const [category, duplicate] = await Promise.all([
        Category.findById(values.category).catch(() => null),
        Product.findOne({ name: values.name, _id: { $ne: existing._id } }).catch(() => null),
    ]);

    if (!category) {
        await destroyUploadedImages(req.files);
        return refuse(req, res, { ...errors, categoryError: 'Choose a category from the list' }, { product: existing });
    }

    if (duplicate) {
        await destroyUploadedImages(req.files);
        return refuse(req, res, { ...errors, titleError: 'A product with this title already exists' }, { product: existing });
    }

    // Only the fields the form owns are written. What the shopper's pages read
    // about the product — how much has sold, how it is rated, which offers are on
    // it — is not something an edit form may set, and writing the whole document
    // from the form is how that was lost.
    //
    // A description and a colour that were emptied are emptied here rather than
    // left behind: clearing a field in the form is a decision, and keeping the old
    // words would be the form refusing to do what it was told.
    const update = {
        name: values.name,
        description1: values.description1,
        description2: values.description2 ?? '',
        warnings: values.warnings,
        type: values.type,
        color: values.color ?? '',
        weight: values.weight,
        discount: values.discount,
        price: values.price,
        priceAfterDiscount: values.priceAfterDiscount,
        SKU: values.SKU,
        stock: values.stock,
        category: values.category,
        images,
    };

    let saved;
    try {
        saved = await Product.findByIdAndUpdate(productId, update, { new: true, runValidators: true });
    } catch (error) {
        console.error('Error updating product:', error);
        await destroyUploadedImages(req.files);
        return refuse(req, res, { ...errors, formError: 'The product could not be saved. Nothing has been changed.' }, { status: 500, product: existing });
    }

    // The product now holds the new pictures. The originals it does not show are
    // given back, and the pictures it no longer holds are removed from the image
    // host. Both happen after the save, because neither can be taken back: an
    // image host will not un-delete a picture, so removing them first would leave
    // a product pointing at pictures that are gone if the write then failed.
    await destroyUploadedImages(req.files, { keep: images });
    await destroyStoredImages(removed);

    req.session.toast = { message: 'Product updated successfully!', type: 'success' };
    delete req.session.flashMessage;

    // Straight to the product, which is the answer to "did it save what I typed?".
    const target = `/admin/products?updated=${saved._id}`;

    if (wantsJson(req)) {
        return res.json({ success: true, product: { _id: saved._id, name: saved.name }, redirect: target });
    }

    return res.redirect(target);
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
