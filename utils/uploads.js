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
