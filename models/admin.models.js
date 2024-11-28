import mongoose from 'mongoose';

const adminUserSchema = new mongoose.Schema({
    username: { type: String },
    password: { type: String, required: true },
    role: { type: String, required: true },
    email: { type: String, required: true },
    lastLogin: { type: Date, default: Date.now }
});

const AdminUser = mongoose.model('AdminUser', adminUserSchema);

export default AdminUser;
