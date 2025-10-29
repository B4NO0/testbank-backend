import mongoose from "mongoose";

const pendingRegistrationSchema = new mongoose.Schema(
  {
    // Registration form fields (store password already hashed)
    lastName: { type: String, required: true },
    firstName: { type: String, required: true },
    middleName: { type: String, default: "" },
    studentID: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    course: { type: String, required: true },
    section: { type: String, required: true },
    yearLevel: { type: String, required: true },
    campus: { type: String, required: true },

    // OTP fields
    otpHash: { type: String, required: true },
    otpExpiresAt: { type: Date, required: true },
    resendCount: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Ensure we don't allow many pending records for same email/studentID
pendingRegistrationSchema.index({ email: 1 });
pendingRegistrationSchema.index({ studentID: 1 });
pendingRegistrationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 }); // auto-clean after 24h

export default mongoose.model("PendingRegistration", pendingRegistrationSchema);


