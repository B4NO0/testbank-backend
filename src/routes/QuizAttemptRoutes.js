import express from "express";
import StudentTestAttempt from "../models/StudentTestAttempt.js";
import Test from "../models/Test.js";

const router = express.Router();

/**
 * 🟢 Submit quiz attempt
 * Calculates score, correctness, and stores in MongoDB.
 */
router.post("/", async (req, res) => {
  try {
    const { studentId, testId, answers } = req.body;

    // Convert string studentId to ObjectId if needed
    const studentObjectId = typeof studentId === 'string' 
      ? new mongoose.Types.ObjectId(studentId) 
      : studentId;

    // Check if student already attempted this test
    const existingAttempt = await StudentTestAttempt.findOne({
      student: studentObjectId,
      test: testId
    });

    if (existingAttempt) {
      return res.status(400).json({ 
        success: false, 
        message: "Test already attempted" 
      });
    }

    const test = await Test.findById(testId).lean();
    if (!test) return res.status(404).json({ message: "Test not found" });

    console.log(`📝 Processing quiz attempt for test: ${test.title}`);
    console.log(`👤 Student ID: ${studentObjectId}`);
    console.log(`📊 Received ${answers.length} answers`);

    // Use the same comprehensive scoring function
    const result = processQuizSubmissionWithStudentTestAttempt(test, answers, studentObjectId);
    
    const attempt = new StudentTestAttempt({
      student: studentObjectId,
      test: testId,
      questionResults: result.questionResults,
      score: result.score,
      totalPoints: result.totalPoints,
      percentage: result.percentage,
      passed: result.passed,
      submittedAt: new Date(),
    });

    await attempt.save();
    
    console.log(`✅ Quiz attempt saved successfully:`, {
      score: result.score,
      totalPoints: result.totalPoints,
      percentage: result.percentage.toFixed(2),
      passed: result.passed
    });

    res.status(201).json(attempt);
  } catch (error) {
    console.error("❌ Error saving quiz attempt:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * 🎯 Comprehensive Quiz Submission Processing Function for StudentTestAttempt
 * Handles all question types and scoring logic based on Test.js and StudentTestAttempt.js models
 */
function processQuizSubmissionWithStudentTestAttempt(test, studentAnswers, studentId) {
  console.log(`🔄 Processing quiz submission for test: ${test.title}`);
  
  let totalPoints = 0;
  let score = 0;
  let correctAnswers = 0;
  const questionResults = [];

  // Process each question in the test
  for (const question of test.questions) {
    console.log(`\n🔍 Processing Question: ${question.text.substring(0, 50)}...`);
    console.log(`   Type: ${question.type}, Points: ${question.points}`);
    
    // Find the student's answer for this question
    const studentAnswer = studentAnswers.find(a => 
      a.questionId && a.questionId.toString() === question._id.toString()
    );
    
    const result = evaluateQuestion(question, studentAnswer);
    
    console.log(`   Student Answer: ${JSON.stringify(studentAnswer ? studentAnswer.answer : 'No answer')}`);
    console.log(`   Correct Answer: ${JSON.stringify(question.correctAnswer)}`);
    console.log(`   Is Correct: ${result.isCorrect}, Points Earned: ${result.pointsEarned}`);
    
    // Update totals
    totalPoints += question.points || 0;
    score += result.pointsEarned;
    if (result.isCorrect) correctAnswers++;
    
    // Store detailed answer information for StudentTestAttempt
    questionResults.push({
      questionId: question._id,
      questionText: question.text,
      questionType: question.type,
      studentAnswer: studentAnswer ? studentAnswer.answer : null,
      correctAnswer: question.correctAnswer || null, // Store the actual correct answer from the question, default to null if undefined
      isCorrect: result.isCorrect,
      pointsEarned: result.pointsEarned,
      maxPoints: question.points || 0,
      feedback: {
        text: result.isCorrect ? (question.feedbackWhenCorrect?.text || "") : (question.feedbackWhenIncorrect?.text || ""),
        file: result.isCorrect ? (question.feedbackWhenCorrect?.file || "") : (question.feedbackWhenIncorrect?.file || "")
      }
    });
  }

  // Calculate final results
  const percentage = totalPoints > 0 ? (score / totalPoints) * 100 : 0;
  const passed = percentage >= (test.passingPoints || 50);

  console.log(`\n📊 Final Results:`);
  console.log(`   Correct Answers: ${correctAnswers}/${test.questions.length}`);
  console.log(`   Score: ${score}/${totalPoints}`);
  console.log(`   Percentage: ${percentage.toFixed(2)}%`);
  console.log(`   Passed: ${passed}`);

  return {
    questionResults,
    score,
    totalPoints,
    percentage,
    passed,
    correctAnswers,
    totalQuestions: test.questions.length
  };
}

/**
 * 🎯 Question Evaluation Function
 * Evaluates a single question based on its type and returns scoring information
 */
function evaluateQuestion(question, studentAnswer) {
  let isCorrect = false;
  let pointsEarned = 0;

  // If no student answer provided, question is incorrect
  if (!studentAnswer || studentAnswer.answer === null || studentAnswer.answer === undefined) {
    return { isCorrect: false, pointsEarned: 0 };
  }

  const studentAns = studentAnswer.answer;
  const correctAns = question.correctAnswer;

  switch (question.type) {
    case 'multiple':
      // Multiple choice: handle different correctAnswer formats
      if (Array.isArray(correctAns) && correctAns.length > 0) {
        // If correctAnswer is an array like ["B"], convert to index
        const correctChoice = correctAns[0]; // Get the first (and usually only) correct choice
        const choiceIndex = question.choices ? question.choices.indexOf(correctChoice) : -1;
        isCorrect = studentAns === choiceIndex;
      } else if (typeof correctAns === 'number') {
        // If correctAnswer is already an index
        isCorrect = studentAns === correctAns;
      } else {
        isCorrect = false;
      }
      break;

    case 'truefalse':
      // True/False: convert student answer (0/1) to boolean, and correct answer to boolean
      const studentBool = studentAns === 1;
      let correctBool;
      
      if (typeof correctAns === 'string') {
        correctBool = correctAns.toLowerCase() === 'true';
      } else if (typeof correctAns === 'boolean') {
        correctBool = correctAns;
      } else {
        correctBool = false;
      }
      
      isCorrect = studentBool === correctBool;
      break;

    case 'enumeration':
      // Enumeration: compare arrays of answers (order doesn't matter)
      if (Array.isArray(studentAns) && Array.isArray(correctAns)) {
        // Sort both arrays and compare
        const sortedStudent = [...studentAns].sort();
        const sortedCorrect = [...correctAns].sort();
        isCorrect = JSON.stringify(sortedStudent) === JSON.stringify(sortedCorrect);
      } else {
        isCorrect = false;
      }
      break;

    case 'identification':
      // Identification: case-insensitive string comparison
      if (typeof studentAns === 'string' && typeof correctAns === 'string') {
        isCorrect = studentAns.toLowerCase().trim() === correctAns.toLowerCase().trim();
      } else if (correctAns === undefined || correctAns === null) {
        // If correct answer is undefined/null, mark as incorrect
        isCorrect = false;
      } else {
        isCorrect = false;
      }
      break;

    case 'essay':
      // Essay: always marked as incorrect for automatic grading
      // In a real system, this would be manually graded later
      isCorrect = false;
      break;

    default:
      console.warn(`⚠️ Unknown question type: ${question.type}`);
      isCorrect = false;
  }

  // Award points if correct
  if (isCorrect) {
    pointsEarned = question.points || 0;
  }

  return { isCorrect, pointsEarned };
}

/**
 * 🔵 Get attempts by student ID
 */
router.get("/student/:studentId", async (req, res) => {
  try {
    const attempts = await StudentTestAttempt.find({ student: req.params.studentId })
      .populate("test", "title subjectCode totalPoints passingPoints")
      .sort({ submittedAt: -1 });
    res.json(attempts);
  } catch (error) {
    res.status(500).json({ message: "Failed to get attempts" });
  }
});

/**
 * 🟣 Get one attempt by ID
 */
router.get("/:id", async (req, res) => {
  try {
    const attempt = await StudentTestAttempt.findById(req.params.id)
      .populate("test", "title subjectCode questions");
    if (!attempt) return res.status(404).json({ message: "Not found" });
    res.json(attempt);
  } catch (error) {
    res.status(500).json({ message: "Failed to get attempt" });
  }
});

export default router;
