import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/mongodb.js";
import { startMongoToFirestoreSync } from "./sync/mongoToFirestore.js";
import { startFirestoreToMongoSync } from "./sync/firestoreToMongo.js";

// ===== ROUTES =====
import authRoutes from "./routes/auth.js";
import testRoutes from "./routes/TestRoutes.js";
import quizAttemptRoutes from "./routes/QuizAttemptRoutes.js"; // ✅ new import

dotenv.config();

const app = express();

// ===== MIDDLEWARE =====
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));
app.use(express.json());

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ===== API ROUTES =====
app.use("/api", authRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/quiz-attempts", quizAttemptRoutes); // ✅ new route

// ===== DEFAULT ROUTE =====
app.get("/", (req, res) => {
  res.send("✅ Firebase & Mongo backend is running!");
});

// ===== DATABASE CONNECTION =====
await connectDB();

// ===== FIREBASE SYNC =====
try {
  console.log("🔄 Starting sync services...");
  await startMongoToFirestoreSync();   // Mongo → Firestore
  await startFirestoreToMongoSync();   // Firestore → Mongo
  console.log("✅ Sync services are running");
} catch (err) {
  console.error("⚠️ Failed to start sync services:", err);
}

// ===== SERVER START =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
