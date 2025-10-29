import mongoose from "mongoose";

const feedbackSchema = new mongoose.Schema({
  text: { type: String, default: "" },
  file: { type: String, default: "" } // URL path to file, e.g. /CorrectFile/xxx.png
}, { _id: false });

const questionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  type: { type: String, enum: ["multiple", "truefalse", "enumeration", "identification", "essay"], required: true },
  points: { type: Number, default: 0 },
  choices: [String],            // for multiple choice
  // Allow correctAnswer to be string or array (multiple correct choices)
  correctAnswer: { type: mongoose.Schema.Types.Mixed, default: undefined },
  answer: String,               // for identification / essay expected answer
  answers: [String],            // for enumeration / identification alternatives
  files: [String],              // question attached files -> URLs placed inside public/QuestionFile/
  feedbackWhenCorrect: feedbackSchema,
  feedbackWhenIncorrect: feedbackSchema
});

const testSchema = new mongoose.Schema({
  title: { type: String, required: true },
  subjectCode: { type: String, required: true },
  description: { type: String, default: "" },
  timeLimit: Number,
  deadline: Date,
  access: { type: String, enum: ["Private", "Public"], default: "Private" },
  howManyQuestions: { type: Number, required: true },
  passingPoints: { type: Number, default: 0 },
  assignedSections: [String],
  prerequisites: [String],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  questions: [questionSchema]
});

// Virtual: total questions, total points across all questions
testSchema.virtual("totalQuestions").get(function() {
  return (this.questions && this.questions.length) || 0;
});

testSchema.virtual("totalPoints").get(function() {
  return (this.questions || []).reduce((s, q) => s + (q.points || 0), 0);
});

// Export model
export default mongoose.model("Test", testSchema);