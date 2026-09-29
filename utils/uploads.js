import cloudinary from "./cloudinary.js";

// Uploading happens before the request is checked, because the form sends the
// pictures with everything else. So a request that turns out to be a mistake has
// already left files on the image host, and they are only useful if the product
// is.
//
// This file is about which files that leaves, and how to give them back: nothing
// is kept unless the product was created, so a mistyped price does not cost a
// hundred uploads over time.

// The image host is reached through one function, so a test can answer for it
// without a network.
let uploader = cloudinary.uploader;

export const setUploader = (next) => {
  uploader = next;
};

export const resetUploader = () => {
  uploader = cloudinary.uploader;
};

const CLOUDINARY_FIELDS = ["files", "image"];

const filesIn = (files = {}) => {
  const groups = [];

  for (const [field, group] of Object.entries(files)) {
    if (field.startsWith("croppedImage_") || CLOUDINARY_FIELDS.includes(field)) {
      groups.push(...(Array.isArray(group) ? group : [group]));
    }
  }

  return groups.filter((file) => file?.path);
};

// The same picture can arrive twice: once as the file that was picked and once as
// the crop of it. The crop is the one the product shows, and the original is not
// stored anywhere, so it is given back rather than left on the host for nothing.
export const unusedImageIds = (files = {}, keep = []) => {
  const kept = new Set(keep);

  return filesIn(files)
    .filter((file) => !kept.has(file.path))
    .map((file) => ({ path: file.path, public_id: file.public_id ?? file.filename ?? null }));
};

export const uploadedImageIds = unusedImageIds;

// A stored image is a delivery address, not a name on this machine: it is
// `https://res.cloudinary.com/<cloud>/image/upload/v<version>/<public_id>`. The
// address is what a page can show, and the name is what the image host can
// remove, so the name is read back out of the address.
//
// An address this cannot read a name out of is one this shop did not put there,
// and is returned as null so nothing is asked of the image host on its behalf.
const CLOUDINARY_UPLOAD = /\/image\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i;

export const publicIdFor = (image) => {
  const value = String(image ?? "").trim();
  if (!value) {
    return null;
  }

  const match = CLOUDINARY_UPLOAD.exec(value);
  return match ? match[1] : null;
};

// Gives back images a product no longer shows.
//
// Called with the pictures an edit removed, and only after the product has been
// saved, because an image host cannot be un-deleted: removing these before the
// write would leave a product pointing at pictures that are gone if the write
// then failed. A failure here is reported and does not undo the edit, because
// the product is correct and only the storage is untidy.
export const destroyStoredImages = async (images = []) => {
  const list = Array.isArray(images) ? images : [images];
  const failed = [];
  let destroyed = 0;

  for (const image of list) {
    const publicId = publicIdFor(image);
    if (!publicId) {
      continue;
    }

    try {
      await uploader.destroy(publicId, { invalidate: true });
      destroyed += 1;
    } catch (error) {
      console.error("Could not remove the stored image:", error?.message ?? error);
      failed.push(publicId);
    }
  }

  return { destroyed, failed };
};

// Gives back the files a request uploaded that nothing is keeping.
//
// Called with nothing kept when the product was not created, and with the stored
// pictures when it was: either way the files no product points at are removed.
// The image host is asked one at a time and its answer is not allowed to replace
// the answer the administrator is waiting for, so a failure here is reported and
// the request carries on.
export const destroyUploadedImages = async (files = {}, { keep = [] } = {}) => {
  const ids = unusedImageIds(files, keep);
  if (ids.length === 0) {
    return { destroyed: 0, failed: [] };
  }

  const failed = [];
  let destroyed = 0;

  for (const image of ids) {
    try {
      await uploader.destroy(image.public_id ?? image.path, { invalidate: true });
      destroyed += 1;
    } catch (error) {
      console.error("Could not remove the uploaded image:", error?.message ?? error);
      failed.push(image.public_id ?? image.path);
    }
  }

  return { destroyed, failed };
};
