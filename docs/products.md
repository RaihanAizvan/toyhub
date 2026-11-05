# Products

## Adding a product

The add-product form and the Product schema use different words for the same
thing, and the translation between them is written down in
`utils/product-form.js` rather than spread through the request handler. A field
read under the name the form gives it and written under a name the schema does
not have is dropped by the database rather than saved, which is how warnings,
prices and pictures went missing.

| The form asks for | The product stores |
| --- | --- |
| `title` | `name` |
| `warning` | `warnings` |
| `sku` | `SKU` |
| `stock_quantity` | `stock` |
| `regular_price` | `price` |
| `description1`, `description2`, `type`, `color` | the same names |
| the files, and the crops of them | `images` |

`priceAfterDiscount` is worked out from the price and the discount in that one
file, so the shopper's pages, the product list and this form cannot each decide
what a discount means. The form used to also ask for a sale price, which nothing
read and which contradicted the discount; the page now shows the price the
product will be listed at instead.

**What is refused, and what it leaves behind.** A request is checked in full
before anything is written, so a refused one leaves no product and no category
changed. Each refusal is reported against the field that caused it, and the
values that were typed are handed back so the product is not typed twice. A
category that is not one of the shop's own is a mistake rather than a server
error, and a name already in use is said to be the name's problem.

**Pictures.** The form sends what was picked under `files` and the crops under
`croppedImage_0` to `croppedImage_4`, and the crops are what the product shows.
A file that was not cropped stands in for its own position rather than leaving a
hole. Uploads happen before the request can be checked, so `utils/uploads.js`
gives back the files no product points at: everything when the product was not
created, and the uncropped originals when it was. A refused upload is answered
by the upload itself, in the words of the field it belongs to.

## Editing a product

The edit form is the same form, and it is read by the same
`utils/product-form.js`, so a field cannot mean one thing when a product is added
and another when it is changed. Two things the edit form used to do are now
written down rather than implied.

*What the shopper knows about a product is not the edit form's to set.* How much
has sold, how it is rated and which offers are on it belong to the shop's own
pages. An edit writes only the fields the form owns, so editing a price cannot
quietly reset a product's ratings.

**Which pictures an edit keeps.** The page shows the pictures the product holds,
each with a box ticked. The ticked ones are sent as `keepImages`, the whole list
it was showing as `knownImages`, and new pictures as `files` and `croppedImage_n`
exactly as the add form sends them. A picture nobody kept is removed, so removal
is something an administrator does on purpose rather than something that happens
when a field is missing. A request that names no pictures at all keeps all of
them, because it was a request about something else.

Only paths the product already holds can be kept: a path that arrives in a
request and is not one of this product's pictures is ignored and said so, so an
edit cannot point a product at somebody else's picture, nor take a picture off a
product that is not this one.

The two lists are both sent because one is not enough. An unticked checkbox is
posted as nothing at all, so without `knownImages`, unticking the only picture of
a product would be indistinguishable from a request that said nothing about
pictures, and the removal would be silently ignored.

**When a picture is removed from the image host.** Only after the product has
been saved. An image host cannot un-delete a picture, so removing one before the
write would leave a product pointing at a picture that is gone if the write then
failed. A stored picture is a delivery address; the name the host can remove is
read back out of it, and an address this shop did not put there is left alone
rather than asked about.
