import mongoose from 'mongoose';

export const ADMIN_ROLES = ['admin', 'superadmin'];

const adminUserSchema = new mongoose.Schema({
    username: { type: String, trim: true },
    password: { type: String, required: true },
    role: { type: String, required: true, enum: ADMIN_ROLES, default: 'admin' },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date, default: Date.now }
}, {
    toJSON: {
        transform(doc, ret) {
            delete ret.password;
            delete ret.__v;
            return ret;
        }
    },
    toObject: {
        transform(doc, ret) {
            delete ret.password;
            delete ret.__v;
            return ret;
        }
    }
});

const AdminUser = mongoose.model('AdminUser', adminUserSchema);

export default AdminUser;
