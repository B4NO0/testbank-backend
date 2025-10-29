import express from "express";
import bcrypt from "bcryptjs";
import Student from "../models/Student.js";
import PendingRegistration from "../models/PendingRegistration.js";
import { sendOtpEmail } from "../config/mailer.js";

const router = express.Router();

// POST /api/register
router.post("/register", async (req, res) => {
  try {
    const {
      lastName,
      firstName,
      middleName,
      studentID,
      email,
      password,
      course,
      section,
      yearLevel,
      campus,
    } = req.body;

    if (!firstName|| !lastName || !email || !password|| !studentID|| !course|| !section|| !yearLevel|| !campus) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Validate email domain
    if (!email.includes("@phinmaed.com")) {
      return res.status(400).json({ message: "Email must be a valid PHINMA Education email (@phinmaed.com)" });
    }

    // Validate yearLevel
    if (!["1", "2", "3", "4"].includes(yearLevel)) {
      return res.status(400).json({ message: "Year level must be 1, 2, 3, or 4" });
    }

    // Validate campus
    const validCampuses = ["Main", "South", "San Jose"];
    if (!validCampuses.includes(campus)) {
      return res.status(400).json({ message: "Campus must be Main, South, or San Jose" });
    }

    // Check if student ID already exists
    const existingStudentByID = await Student.findOne({ studentID });
    if (existingStudentByID) {
      return res.status(400).json({ message: "Student ID already exists" });
    }

    // Check if email already exists
    const existingStudentByEmail = await Student.findOne({ email });
    if (existingStudentByEmail) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create student in MongoDB first (source of truth)
    const newStudent = await Student.create({
      lastName,
      firstName,
      middleName: middleName || "",
      studentID,
      email,
      password: hashedPassword,
      course,
      section,
      yearLevel,
      campus,
    });

    // Note: Student will be synced to Firestore automatically via the MongoDB change stream
    // We'll skip Firebase Auth since we're using MongoDB as primary auth
    
    console.log(`✅ Student registered in MongoDB with ID: ${newStudent._id}`);

    res.status(200).json({ 
      message: "User registered successfully", 
      user: {
        _id: newStudent._id,
        studentID: newStudent.studentID,
        email: newStudent.email,
      },
    });

  } catch (error) {
    console.error("Error adding user:", error);
    
    // Provide more specific error messages
    if (error.code === 11000) {
      return res.status(400).json({ message: "Student ID or email already exists" });
    }
    
    res.status(500).json({ 
      message: "Internal server error",
      error: error.message 
    });
  }
});

// POST /api/register-init
router.post("/register-init", async (req, res) => {
  try {
    const {
      lastName,
      firstName,
      middleName,
      studentID,
      email,
      password,
      course,
      section,
      yearLevel,
      campus,
    } = req.body;

    if (!firstName || !lastName || !email || !password || !studentID || !course || !section || !yearLevel || !campus) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (!email.includes("@phinmaed.com")) {
      return res.status(400).json({ message: "Email must be a valid PHINMA Education email (@phinmaed.com)" });
    }

    if (!["1", "2", "3", "4"].includes(yearLevel)) {
      return res.status(400).json({ message: "Year level must be 1, 2, 3, or 4" });
    }

    const validCampuses = ["Main", "South", "San Jose"];
    if (!validCampuses.includes(campus)) {
      return res.status(400).json({ message: "Campus must be Main, South, or San Jose" });
    }

    // Ensure uniqueness against confirmed users
    const existingStudent = await Student.findOne({ $or: [{ email }, { studentID }] });
    if (existingStudent) {
      return res.status(400).json({ message: "Student ID or email already exists" });
    }

    // Also ensure there isn't an active pending registration for same email/studentID
    await PendingRegistration.deleteMany({ $or: [{ email }, { studentID }], otpExpiresAt: { $lt: new Date() } }); // cleanup expired for same identifiers
    const activePending = await PendingRegistration.findOne({ $or: [{ email }, { studentID }], otpExpiresAt: { $gt: new Date() } });
    if (activePending) {
      return res.status(429).json({ message: "An OTP was already sent recently. Please check your email or wait before trying again." });
    }

    // Hash password now; OTP will be compared separately
    const hashedPassword = await bcrypt.hash(password, 12);

    // Generate 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otpCode, 12);
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const pending = await PendingRegistration.create({
      lastName,
      firstName,
      middleName: middleName || "",
      studentID,
      email,
      password: hashedPassword,
      course,
      section,
      yearLevel,
      campus,
      otpHash,
      otpExpiresAt,
      resendCount: 0,
      lastSentAt: new Date(),
    });

    try {
      await sendOtpEmail(email, otpCode);
    } catch (mailErr) {
      // If email fails, remove pending doc to avoid blocking
      await PendingRegistration.findByIdAndDelete(pending._id).catch(() => {});
      console.error("Failed to send OTP email:", mailErr);
      return res.status(500).json({ message: "Failed to send OTP email. Please try again later." });
    }

    return res.status(200).json({ message: "OTP sent to your email", pendingId: pending._id });
  } catch (error) {
    console.error("register-init error:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// POST /api/register-verify
router.post("/register-verify", async (req, res) => {
  try {
    const { pendingId, otp } = req.body;
    if (!pendingId || !otp) {
      return res.status(400).json({ message: "Missing pendingId or otp" });
    }

    const pending = await PendingRegistration.findById(pendingId);
    if (!pending) {
      return res.status(404).json({ message: "Pending registration not found or expired" });
    }

    if (pending.otpExpiresAt < new Date()) {
      await PendingRegistration.findByIdAndDelete(pendingId).catch(() => {});
      return res.status(410).json({ message: "OTP expired. Please start over." });
    }

    const otpMatches = await bcrypt.compare(otp, pending.otpHash);
    if (!otpMatches) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // Ensure duplicates not created in the meantime
    const existingStudent = await Student.findOne({ $or: [{ email: pending.email }, { studentID: pending.studentID }] });
    if (existingStudent) {
      await PendingRegistration.findByIdAndDelete(pendingId).catch(() => {});
      return res.status(409).json({ message: "An account with this email or student ID already exists" });
    }

    const newStudent = await Student.create({
      lastName: pending.lastName,
      firstName: pending.firstName,
      middleName: pending.middleName || "",
      studentID: pending.studentID,
      email: pending.email,
      password: pending.password,
      course: pending.course,
      section: pending.section,
      yearLevel: pending.yearLevel,
      campus: pending.campus,
    });

    await PendingRegistration.findByIdAndDelete(pendingId).catch(() => {});

    return res.status(200).json({ message: "Registration verified successfully", user: { _id: newStudent._id, studentID: newStudent.studentID, email: newStudent.email } });
  } catch (error) {
    console.error("register-verify error:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// POST /api/register-resend-otp
router.post("/register-resend-otp", async (req, res) => {
  try {
    const { pendingId } = req.body;
    if (!pendingId) {
      return res.status(400).json({ message: "Missing pendingId" });
    }

    const pending = await PendingRegistration.findById(pendingId);
    if (!pending) {
      return res.status(404).json({ message: "Pending registration not found or expired" });
    }

    if (pending.otpExpiresAt < new Date()) {
      await PendingRegistration.findByIdAndDelete(pendingId).catch(() => {});
      return res.status(410).json({ message: "OTP expired. Please start over." });
    }

    // Simple rate limit: at least 60 seconds between sends, max 3 resends
    const now = Date.now();
    if (pending.lastSentAt && now - new Date(pending.lastSentAt).getTime() < 60 * 1000) {
      return res.status(429).json({ message: "Please wait a minute before requesting a new code" });
    }
    if (pending.resendCount >= 3) {
      return res.status(429).json({ message: "Maximum resend attempts reached" });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    pending.otpHash = await bcrypt.hash(otpCode, 12);
    pending.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    pending.resendCount += 1;
    pending.lastSentAt = new Date();
    await pending.save();

    await sendOtpEmail(pending.email, otpCode);
    return res.status(200).json({ message: "A new OTP has been sent" });
  } catch (error) {
    console.error("register-resend-otp error:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// POST /api/login
router.post("/login", async (req, res) => {
  try {
    const { studentID, password } = req.body;

    if (!studentID || !password) {
      return res.status(400).json({ message: "Student ID and password are required." });
    }

    // Find student in MongoDB
    const student = await Student.findOne({ studentID });
    if (!student) {
      return res.status(404).json({ message: "No account found for this student ID." });
    }

    // Verify password
    const isPasswordMatch = await bcrypt.compare(password, student.password);
    if (!isPasswordMatch) {
      return res.status(401).json({ message: "Incorrect password." });
    }

    // Convert to object and remove password
    const studentData = student.toObject();
    delete studentData.password;

    console.log(`✅ Login successful for student: ${studentID}`);

    res.status(200).json({
      message: "Login successful!",
      user: studentData,
    });

  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ 
      message: "Internal server error.",
      error: error.message 
    });
  }
});

// ✅ Update student profile
router.put("/update-profile", async (req, res) => {
  try {
    const { studentID, firstName, lastName, course, section, yearLevel } = req.body;

    const student = await Student.findOneAndUpdate(
      { studentID },
      { firstName, lastName, course, section, yearLevel },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const { password: _, ...studentData } = student.toObject();
    res.json({ message: "Profile updated successfully", user: studentData });
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Change password
router.put("/change-password", async (req, res) => {
  try {
    console.log("🔐 Change password request received:", {
      studentID: req.body.studentID,
      hasCurrentPassword: !!req.body.currentPassword,
      hasNewPassword: !!req.body.newPassword,
      bodyKeys: Object.keys(req.body)
    });

    const { studentID, currentPassword, newPassword } = req.body;

    if (!studentID || !currentPassword || !newPassword) {
      console.log("❌ Missing required fields:", { studentID: !!studentID, currentPassword: !!currentPassword, newPassword: !!newPassword });
      return res.status(400).json({ message: "Student ID, current password, and new password are required" });
    }

    const student = await Student.findOne({ studentID });
    if (!student) {
      console.log("❌ Student not found:", studentID);
      return res.status(404).json({ message: "Student not found" });
    }

    console.log("✅ Student found:", student.studentID);

    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, student.password);
    if (!isMatch) {
      console.log("❌ Current password incorrect for student:", studentID);
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    console.log("✅ Current password verified for student:", studentID);

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    student.password = hashedPassword;
    await student.save();

    console.log("✅ Password updated successfully for student:", studentID);

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    console.error("❌ Error changing password:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Get user statistics
router.get("/stats/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    
    // Import StudentTestAttempt here to avoid circular imports
    const StudentTestAttempt = (await import("../models/StudentTestAttempt.js")).default;
    
    const attempts = await StudentTestAttempt.find({ student: studentId }).lean();
    
    const stats = {
      totalTests: attempts.length,
      passedTests: attempts.filter(a => a.passed).length,
      averageScore: attempts.length > 0 
        ? Math.round(attempts.reduce((sum, a) => sum + a.percentage, 0) / attempts.length)
        : 0,
      totalPoints: attempts.reduce((sum, a) => sum + a.score, 0),
      bestScore: attempts.length > 0 ? Math.max(...attempts.map(a => a.percentage)) : 0,
      worstScore: attempts.length > 0 ? Math.min(...attempts.map(a => a.percentage)) : 0,
    };

    res.json(stats);
  } catch (err) {
    console.error("Error fetching user stats:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Get test history
router.get("/test-history/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    
    // Import StudentTestAttempt here to avoid circular imports
    const StudentTestAttempt = (await import("../models/StudentTestAttempt.js")).default;
    const Test = (await import("../models/Test.js")).default;
    
    const attempts = await StudentTestAttempt.find({ student: studentId })
      .populate('test', 'title subjectCode')
      .sort({ submittedAt: -1 })
      .lean();
    
    const history = attempts.map(attempt => ({
      id: attempt._id,
      testTitle: attempt.test?.title || 'Unknown Test',
      subject: attempt.test?.subjectCode || 'Unknown Subject',
      score: attempt.score,
      totalPoints: attempt.totalPoints,
      percentage: attempt.percentage,
      passed: attempt.passed,
      submittedAt: attempt.submittedAt,
      timeSpent: attempt.timeSpent || 'Unknown',
      questionsAnswered: attempt.questionResults?.length || 0,
      totalQuestions: attempt.questionResults?.length || 0,
    }));

    const stats = {
      totalTests: attempts.length,
      passedTests: attempts.filter(a => a.passed).length,
      averageScore: attempts.length > 0 
        ? Math.round(attempts.reduce((sum, a) => sum + a.percentage, 0) / attempts.length)
        : 0,
      totalPoints: attempts.reduce((sum, a) => sum + a.score, 0),
      bestScore: attempts.length > 0 ? Math.max(...attempts.map(a => a.percentage)) : 0,
      worstScore: attempts.length > 0 ? Math.min(...attempts.map(a => a.percentage)) : 0,
    };

    res.json({ history, stats });
  } catch (err) {
    console.error("Error fetching test history:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Get user profile data
router.get("/profile/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const student = await Student.findOne({ studentID: studentId }).lean();
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const { password: _, ...studentData } = student;
    res.json(studentData);
  } catch (err) {
    console.error("Error fetching user profile:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Save user settings
router.put("/settings/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const settings = req.body;
    
    const student = await Student.findOneAndUpdate(
      { studentID: studentId },
      { settings },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.json({ message: "Settings saved successfully", settings });
  } catch (err) {
    console.error("Error saving settings:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Get user settings
router.get("/settings/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    
    const student = await Student.findOne({ studentID: studentId }).lean();
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.json(student.settings || {});
  } catch (err) {
    console.error("Error fetching settings:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
