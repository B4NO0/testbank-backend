import mongoose from "mongoose";

const studentSchema = new mongoose.Schema({
  // Separated name fields only
  lastName: { type: String, required: true },
  firstName: { type: String, required: true },
  middleName: { type: String, required: true },
  
  studentID: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  course: { type: String, required: true },
  section: { type: String, required: true }, 
  yearLevel: { type: String, required: true },
  campus: { type: String, required: true },
  securityQuestion: { type: String, required: true },
  securityAnswer: { type: String, required: true },
  settings: {
    notifications: { type: Boolean, default: true },
    emailNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    darkMode: { type: Boolean, default: false },
    autoSync: { type: Boolean, default: true },
    soundEffects: { type: Boolean, default: true },
    vibration: { type: Boolean, default: true },
  },
}, { timestamps: true });

// Virtual for full name (computed property)
studentSchema.virtual('fullName').get(function() {
  return `${this.lastName}, ${this.firstName} ${this.middleName}`.trim();
});

export default mongoose.model("Student", studentSchema);