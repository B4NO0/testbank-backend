import express from "express";
import bcrypt from "bcryptjs";
import Student from "../models/Student.js";

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
      securityQuestion,
      securityAnswer,
    } = req.body;

    if (!firstName|| !lastName || !email || !password|| !studentID|| !course|| !section|| !yearLevel|| !campus || !securityQuestion || !securityAnswer) {
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

    // Hash password and security answer
    const hashedPassword = await bcrypt.hash(password, 12);
    const hashedSecurityAnswer = await bcrypt.hash(securityAnswer.toLowerCase().trim(), 12);

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
      securityQuestion,
      securityAnswer: hashedSecurityAnswer,
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

// POST /api/forgot-password - Verify security question
router.post("/forgot-password", async (req, res) => {
  try {
    const { studentID, email, securityQuestion, securityAnswer } = req.body;

    if (!studentID || !email || !securityQuestion || !securityAnswer) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const student = await Student.findOne({ studentID, email });
    if (!student) {
      return res.status(404).json({ message: "No account found with this Student ID and email" });
    }

    // Verify security question matches
    if (student.securityQuestion !== securityQuestion) {
      return res.status(400).json({ message: "Security question does not match" });
    }

    // Verify security answer
    const answerMatches = await bcrypt.compare(securityAnswer.toLowerCase().trim(), student.securityAnswer);
    if (!answerMatches) {
      return res.status(401).json({ message: "Incorrect security answer" });
    }

    res.status(200).json({ 
      message: "Security verification successful",
      verified: true 
    });
  } catch (err) {
    console.error("Error verifying security question:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/reset-password - Reset password after verification
router.post("/reset-password", async (req, res) => {
  try {
    const { studentID, email, securityQuestion, securityAnswer, newPassword } = req.body;

    if (!studentID || !email || !securityQuestion || !securityAnswer || !newPassword) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const student = await Student.findOne({ studentID, email });
    if (!student) {
      return res.status(404).json({ message: "No account found with this Student ID and email" });
    }

    // Verify security question matches
    if (student.securityQuestion !== securityQuestion) {
      return res.status(400).json({ message: "Security question does not match" });
    }

    // Verify security answer
    const answerMatches = await bcrypt.compare(securityAnswer.toLowerCase().trim(), student.securityAnswer);
    if (!answerMatches) {
      return res.status(401).json({ message: "Incorrect security answer" });
    }

    // Hash and update password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    student.password = hashedPassword;
    await student.save();

    console.log(`✅ Password reset successfully for student: ${studentID}`);

    res.status(200).json({ message: "Password reset successfully" });
  } catch (err) {
    console.error("Error resetting password:", err);
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
