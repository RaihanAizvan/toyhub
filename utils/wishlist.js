// A wishlist is stored as a list of ObjectIds, but it arrives from a browser
// and is compared in EJS as text. An ObjectId and a string are never equal to
// `Array.includes`, which is why the heart never looked filled and the same
// product could be added again and again. Every comparison here is as text.
export const wishlistContains = (wishlist, productId) =>
  Array.isArray(wishlist) &&
  wishlist.some((entry) => String(entry) === String(productId));

export const wishlistIdStrings = (wishlist) =>
  Array.isArray(wishlist) ? wishlist.map((entry) => String(entry)) : [];
