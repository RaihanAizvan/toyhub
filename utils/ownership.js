const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

// An id that is not the shape of an ObjectId is answered as "not found"
// before it ever reaches a query, so a hostile string cannot turn a scoped
// lookup into a database error.
export const isObjectId = (value) => OBJECT_ID_PATTERN.test(String(value ?? ""));
