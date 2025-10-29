import express from "express";
import mongoose from "mongoose";
import Test from "../models/Test.js";
import StudentTestAttempt from "../models/StudentTestAttempt.js";

const router = express.Router();

// ✅ Test endpoint for debugging
router.get("/test", (req, res) => {
  res.json({ message: "API is working!", timestamp: new Date().toISOString() });
});

// ✅ Get all tests with user attempt status
router.get("/", async (req, res) => {
  try {
    const { studentId } = req.query;
    console.log("📥 Received request for all tests", studentId ? `for student: ${studentId}` : "for all students");
    
    const tests = await Test.find().sort({ createdAt: -1 }).lean();
    console.log(`📦 Found ${tests.length} tests in MongoDB`);
    
    // If studentId is provided, check for completed attempts
    if (studentId) {
      const studentObjectId = typeof studentId === 'string' 
        ? new mongoose.Types.ObjectId(studentId) 
        : studentId;
      
      // Get all attempts for this student
      const attempts = await StudentTestAttempt.find({ student: studentObjectId })
        .select('test score percentage passed submittedAt')
        .lean();
      
      // Create a map of testId to attempt for quick lookup
      const attemptMap = {};
      attempts.forEach(attempt => {
        attemptMap[attempt.test.toString()] = attempt;
      });
      
      // Add attempt status to each test
      const testsWithStatus = tests.map(test => {
        const attempt = attemptMap[test._id.toString()];
        return {
          ...test,
          status: attempt ? "Done" : "Available",
          score: attempt ? `${attempt.percentage.toFixed(1)}%` : null,
          attemptId: attempt ? attempt._id : null,
          submittedAt: attempt ? attempt.submittedAt : null
        };
      });
      
      res.json(testsWithStatus);
    } else {
      res.json(tests);
    }
  } catch (err) {
    console.error("Error fetching tests:", err);
    res.status(500).json({ message: "Server error fetching tests" });
  }
});

// ✅ Get a single test with its questions (with randomization if specified)
router.get("/:id", async (req, res) => {
  try {
    const test = await Test.findById(req.params.id).lean();
    if (!test) return res.status(404).json({ message: "Test not found" });
    
    // Apply randomization if howManyQuestions is specified and less than total questions
    let questionsToShow = test.questions;
    if (test.howManyQuestions && test.howManyQuestions < test.questions.length) {
      console.log(`🎲 Randomizing questions: showing ${test.howManyQuestions} out of ${test.questions.length}`);
      questionsToShow = shuffleArray([...test.questions]).slice(0, test.howManyQuestions);
    }
    
    const testWithRandomizedQuestions = {
      ...test,
      questions: questionsToShow,
      totalQuestions: test.questions.length, // Keep original total for reference
      questionsShown: questionsToShow.length // Number of questions actually shown
    };
    
    res.json(testWithRandomizedQuestions);
  } catch (err) {
    console.error("Error fetching test:", err);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * 🎲 Shuffle Array Function
 * Randomly shuffles an array using Fisher-Yates algorithm
 */
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ✅ Trigger sync for a specific test (when clicked in app)
router.post("/:id/sync", async (req, res) => {
  try {
    const test = await Test.findById(req.params.id).lean();
    if (!test) return res.status(404).json({ message: "Test not found" });

    // Import Firebase admin here to avoid circular imports
    const firebaseModule = await import("../config/firebase.js");
    const firestore = firebaseModule.db;
    
    // Clean and sync the test to Firestore
    const { __v, _id, ...rest } = test;
    const cleanedTest = { id: _id.toString(), ...rest };
    
    // Recursively clean ObjectId fields
    const cleanObject = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      if (obj.constructor.name === 'ObjectId') return obj.toString();
      if (Array.isArray(obj)) return obj.map(cleanObject);
      if (obj.constructor.name === 'Date') return obj;
      
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        cleaned[key] = cleanObject(value);
      }
      return cleaned;
    };
    
    const finalTest = cleanObject(cleanedTest);
    
    // Save to Firestore
    const testRef = firestore.collection("tests").doc(test._id.toString());
    await testRef.set({ ...finalTest, _syncedFrom: "mongo" });
    
    console.log(`🔄 Test ${test._id} synced to Firestore`);
    res.json({ message: "Test synced to Firebase successfully", testId: test._id });
  } catch (err) {
    console.error("Error syncing test to Firebase:", err);
    res.status(500).json({ message: "Server error syncing test" });
  }
});

// ✅ Submit quiz attempt
router.post("/:id/submit", async (req, res) => {
  try {
    const { studentId, answers } = req.body;
    
    // Convert string studentId to ObjectId if needed
    const studentObjectId = typeof studentId === 'string' 
      ? new mongoose.Types.ObjectId(studentId) 
      : studentId;
    
    const test = await Test.findById(req.params.id).lean();
    if (!test) return res.status(404).json({ message: "Test not found" });

    console.log(`📝 Processing quiz submission for test: ${test.title}`);
    console.log(`👤 Student ID: ${studentObjectId}`);
    console.log(`📊 Received ${answers.length} answers`);

    // Process the quiz submission with comprehensive scoring
    const result = processQuizSubmissionWithStudentTestAttempt(test, answers, studentObjectId);
    
    // Save the attempt to database
    const attempt = new StudentTestAttempt({
      student: studentObjectId,
      test: test._id,
      questionResults: result.questionResults,
      score: result.score,
      totalPoints: result.totalPoints,
      percentage: result.percentage,
      passed: result.passed,
      submittedAt: new Date()
    });

    await attempt.save();
    
    console.log(`✅ Quiz submitted successfully:`, {
      score: result.score,
      totalPoints: result.totalPoints,
      percentage: result.percentage.toFixed(2),
      passed: result.passed
    });

    res.json({ 
      message: "Quiz submitted successfully", 
      attempt: {
        score: result.score,
        totalPoints: result.totalPoints,
        percentage: result.percentage,
        passed: result.passed,
        correctAnswers: result.correctAnswers,
        totalQuestions: result.totalQuestions
      }
    });
  } catch (err) {
    console.error("Error submitting quiz:", err);
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
    console.log(`\n🔍 PROCESSING QUESTION: ${question.text.substring(0, 50)}...`);
    console.log(`   Question ID: ${question._id}`);
    console.log(`   Type: ${question.type}, Points: ${question.points}`);
    console.log(`   Available Student Answers: ${JSON.stringify(studentAnswers.map(a => ({ questionId: a.questionId, answer: a.answer })))}`);
    
    // Find the student's answer for this question
    const studentAnswer = studentAnswers.find(a => {
      const match = a.questionId && a.questionId.toString() === question._id.toString();
      console.log(`   Checking answer: ${a.questionId} === ${question._id} ? ${match}`);
      return match;
    });
    
    console.log(`   Found Student Answer: ${JSON.stringify(studentAnswer)}`);
    
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
  console.log(`\n🔍 EVALUATING QUESTION:`);
  console.log(`   Question ID: ${question._id}`);
  console.log(`   Question Text: ${question.text.substring(0, 100)}...`);
  console.log(`   Question Type: ${question.type}`);
  console.log(`   Question Points: ${question.points}`);
  console.log(`   Correct Answer: ${JSON.stringify(question.correctAnswer)} (type: ${typeof question.correctAnswer})`);
  console.log(`   Student Answer: ${JSON.stringify(studentAnswer)}`);
  
  let isCorrect = false;
  let pointsEarned = 0;

  // If no student answer provided, question is incorrect
  if (!studentAnswer || studentAnswer.answer === null || studentAnswer.answer === undefined) {
    console.log(`   ❌ No student answer provided`);
    return { isCorrect: false, pointsEarned: 0 };
  }

  const studentAns = studentAnswer.answer;
  const correctAns = question.correctAnswer;
  
  console.log(`   Student Answer Value: ${JSON.stringify(studentAns)} (type: ${typeof studentAns})`);
  console.log(`   Correct Answer Value: ${JSON.stringify(correctAns)} (type: ${typeof correctAns})`);

  switch (question.type) {
    case 'multiple':
      console.log(`   🔹 Processing MULTIPLE CHOICE`);
      console.log(`   Student Index: ${studentAns}, Correct Answer: ${JSON.stringify(correctAns)}`);
      
      // Handle different correctAnswer formats
      if (Array.isArray(correctAns) && correctAns.length > 0) {
        // If correctAnswer is an array like ["B"], convert to index
        const correctChoice = correctAns[0]; // Get the first (and usually only) correct choice
        const choiceIndex = question.choices ? question.choices.indexOf(correctChoice) : -1;
        console.log(`   Correct Choice: ${correctChoice}, Choice Index: ${choiceIndex}`);
        isCorrect = studentAns === choiceIndex;
      } else if (typeof correctAns === 'number') {
        // If correctAnswer is already an index
        isCorrect = studentAns === correctAns;
      } else {
        console.log(`   ❌ Unexpected correctAnswer format: ${typeof correctAns}`);
        isCorrect = false;
      }
      console.log(`   Result: ${isCorrect}`);
      break;

    case 'truefalse':
      console.log(`   🔹 Processing TRUE/FALSE`);
      console.log(`   Student Answer: ${studentAns} (type: ${typeof studentAns})`);
      console.log(`   Correct Answer: ${correctAns} (type: ${typeof correctAns})`);
      
      // Convert student answer (0/1) to boolean, and correct answer to boolean
      const studentBool = studentAns === 1;
      let correctBool;
      
      if (typeof correctAns === 'string') {
        correctBool = correctAns.toLowerCase() === 'true';
      } else if (typeof correctAns === 'boolean') {
        correctBool = correctAns;
      } else {
        console.log(`   ❌ Unexpected correctAnswer format: ${typeof correctAns}`);
        correctBool = false;
      }
      
      console.log(`   Student Boolean: ${studentBool}, Correct Boolean: ${correctBool}`);
      isCorrect = studentBool === correctBool;
      console.log(`   Result: ${isCorrect}`);
      break;

    case 'enumeration':
      console.log(`   🔹 Processing ENUMERATION`);
      console.log(`   Student Array: ${JSON.stringify(studentAns)} (isArray: ${Array.isArray(studentAns)})`);
      console.log(`   Question Answers: ${JSON.stringify(question.answers)}`);
      console.log(`   Correct Answer: ${JSON.stringify(correctAns)} (isArray: ${Array.isArray(correctAns)})`);
      
      // Use question.answers array for correct answers, fallback to correctAnswer
      const enumerationAnswers = question.answers ? question.answers.map(ans => String(ans).toLowerCase().trim()).filter(ans => ans.length > 0) : [];
      if (enumerationAnswers.length > 0) {
        let studentAnswers = [];
        if (Array.isArray(studentAns)) {
          // If answers are numeric indexes, map through choices if available
          if (studentAns.length > 0 && typeof studentAns[0] === 'number' && Array.isArray(question.choices)) {
            studentAnswers = studentAns
              .map(idx => question.choices[idx])
              .filter(ans => typeof ans === 'string')
              .map(ans => ans.toLowerCase().trim())
              .filter(ans => ans.length > 0);
          } else {
            studentAnswers = studentAns
              .map(ans => String(ans).toLowerCase().trim())
              .filter(ans => ans.length > 0);
          }
        } else if (studentAns) {
          studentAnswers = [String(studentAns).toLowerCase().trim()].filter(ans => ans.length > 0);
        }
        
        console.log(`   Correct Answers: ${JSON.stringify(enumerationAnswers)}`);
        console.log(`   Student Answers: ${JSON.stringify(studentAnswers)}`);
        
        // Require set equality (order-insensitive, case-insensitive)
        const uniqueStudent = [...new Set(studentAnswers)];
        const requiredCount = enumerationAnswers.length;
        if (uniqueStudent.length !== requiredCount) {
          isCorrect = false;
          console.log(`   ❌ Count mismatch: ${uniqueStudent.length} vs ${requiredCount}`);
        } else {
          const allMatch = enumerationAnswers.every(ans => uniqueStudent.includes(ans));
          isCorrect = allMatch;
          console.log(`   All Match: ${allMatch}`);
        }
      } else if (Array.isArray(studentAns) && Array.isArray(correctAns)) {
        // Fallback to old logic
        const sortedStudent = [...studentAns].sort();
        const sortedCorrect = [...correctAns].sort();
        console.log(`   Sorted Student: ${JSON.stringify(sortedStudent)}`);
        console.log(`   Sorted Correct: ${JSON.stringify(sortedCorrect)}`);
        isCorrect = JSON.stringify(sortedStudent) === JSON.stringify(sortedCorrect);
        console.log(`   Arrays Match: ${isCorrect}`);
      } else {
        console.log(`   ❌ No valid answers found`);
        isCorrect = false;
      }
      break;

    case 'identification':
      console.log(`   🔹 Processing IDENTIFICATION`);
      console.log(`   Student String: "${studentAns}" (type: ${typeof studentAns})`);
      console.log(`   Question Answers: ${JSON.stringify(question.answers)}`);
      console.log(`   Correct Answer: "${correctAns}" (type: ${typeof correctAns})`);
      
      // Check against answers array first, then fallback to correctAnswer
      const identificationAnswers = question.answers ? question.answers.map(ans => ans.toLowerCase().trim()) : [];
      if (identificationAnswers.length > 0) {
        const studentLower = String(studentAns).toLowerCase().trim();
        isCorrect = identificationAnswers.includes(studentLower);
        console.log(`   Student Lower: "${studentLower}"`);
        console.log(`   Correct Answers: ${JSON.stringify(identificationAnswers)}`);
        console.log(`   Answer Found: ${isCorrect}`);
      } else if (typeof studentAns === 'string' && typeof correctAns === 'string') {
        const studentLower = studentAns.toLowerCase().trim();
        const correctLower = correctAns.toLowerCase().trim();
        console.log(`   Student Lower: "${studentLower}"`);
        console.log(`   Correct Lower: "${correctLower}"`);
        isCorrect = studentLower === correctLower;
        console.log(`   Strings Match: ${isCorrect}`);
      } else if (correctAns === undefined || correctAns === null) {
        console.log(`   ⚠️ Correct answer is undefined/null - marking as incorrect`);
        isCorrect = false;
      } else {
        console.log(`   ❌ One or both are not strings`);
        isCorrect = false;
      }
      break;

    case 'essay':
      console.log(`   🔹 Processing ESSAY (always incorrect for auto-grading)`);
      isCorrect = false;
      break;

    default:
      console.warn(`   ⚠️ Unknown question type: ${question.type}`);
      isCorrect = false;
  }

  // Award points if correct
  if (isCorrect) {
    pointsEarned = question.points || 0;
    console.log(`   ✅ CORRECT! Points earned: ${pointsEarned}`);
  } else {
    console.log(`   ❌ INCORRECT! Points earned: 0`);
  }

  console.log(`   Final Result: isCorrect=${isCorrect}, pointsEarned=${pointsEarned}`);
  return { isCorrect, pointsEarned };
}

// ===== NEW SIMPLIFIED QUIZ SYSTEM =====

// ✅ Take Test - Get test questions for taking
router.get('/take-test/:testId', async (req, res) => {
  try {
    const testId = req.params.testId;
    const { studentId } = req.query;

    console.log('🎯 TAKE TEST DEBUG:');
    console.log('Test ID:', testId);
    console.log('Student ID:', studentId);

    // Check if student already attempted this test
    const existingAttempt = await StudentTestAttempt.findOne({
      student: studentId,
      test: testId
    });

    // Check if this is a retake request (has query parameter)
    const isRetake = req.query.retake === 'true';

    if (existingAttempt && !isRetake) {
      // Return existing attempt info if already attempted and not retaking
      return res.json({
        success: false,
        message: "Test already attempted",
        existingAttempt: {
          score: existingAttempt.score,
          passed: existingAttempt.passed,
          takenAt: existingAttempt.takenAt
        }
      });
    }

    if (existingAttempt && isRetake) {
      // Delete the old attempt to allow retake
      await StudentTestAttempt.findByIdAndDelete(existingAttempt._id);
      console.log('🗑️ Deleted old attempt for retake:', existingAttempt._id);
    }

    // Get test details
    const test = await Test.findById(testId);
    if (!test) {
      return res.status(404).json({
        success: false,
        message: "Test not found"
      });
    }

    // Check access (simplified for mobile)
    // For now, we'll allow all tests to be taken

    console.log('✅ Test loaded successfully:', test.title);
    console.log('📊 Questions count:', test.questions.length);

    res.json({
      success: true,
      test: {
        _id: test._id,
        title: test.title,
        description: test.description,
        timeLimit: test.timeLimit,
        passingPoints: test.passingPoints,
        questions: test.questions.map(q => ({
          _id: q._id,
          text: q.text,
          type: q.type,
          points: q.points,
          choices: q.choices,
          // Don't send correct answers to frontend
        })),
        totalPoints: test.totalPoints,
        totalQuestions: test.questions.length
      },
      isRetake: isRetake
    });

  } catch (error) {
    console.error("❌ Take test error:", error);
    res.status(500).json({
      success: false,
      message: "Error loading test: " + error.message
    });
  }
});

// ✅ Submit Test Answers - Simplified grading
router.post('/submit-test/:testId', async (req, res) => {
  try {
    const testId = req.params.testId;
    const { studentId, answers } = req.body; // Array of student answers

    console.log('📝 Submitting test:', testId);
    console.log('👤 Student:', studentId);
    console.log('📋 Answers:', answers);

    console.log('🎯 SUBMIT TEST DEBUG:');
    console.log('Test ID:', testId);
    console.log('Student ID:', studentId);
    console.log('Answers received:', answers);
    console.log('Answers length:', answers ? answers.length : 0);
    
    if (answers && Array.isArray(answers)) {
      answers.forEach((answer, index) => {
        console.log(`Answer ${index}:`, answer, 'Type:', typeof answer);
      });
    }

    // Check if student already attempted this test
    const existingAttempt = await StudentTestAttempt.findOne({
      student: studentId,
      test: testId
    });

    if (existingAttempt) {
      return res.status(400).json({ 
        success: false, 
        message: "Test already attempted" 
      });
    }

    // Get test with questions
    const test = await Test.findById(testId);
    if (!test) {
      return res.status(404).json({ 
        success: false, 
        message: "Test not found" 
      });
    }

    // Grade the test
    let totalScore = 0;
    const questionResults = [];

    test.questions.forEach((question, index) => {
      const studentAnswer = answers[index];
      let isCorrect = false;
      let pointsEarned = 0;

      // Add this before the switch statement
      console.log('🎯 Grading Question:', {
        index: index,
        type: question.type,
        text: question.text,
        correctAnswer: question.correctAnswer,
        studentAnswer: studentAnswer
      });

      // Grade based on question type
      switch (question.type) {
        case 'identification':
          // Case-insensitive comparison for identification
          const identificationCorrectAnswers = question.answers ? question.answers.map(ans => ans.toLowerCase().trim()) : [];
          const studentAns = (studentAnswer || '').toLowerCase().trim();
          isCorrect = identificationCorrectAnswers.includes(studentAns);
          break;

        case 'multiple':
          // Convert both correct and student answers to comparable formats
          if (question.correctAnswer !== undefined && studentAnswer !== undefined) {
            if (Array.isArray(question.correctAnswer)) {
              // Multiple correct answers (select all that apply)
              // Convert letter answers (A, B, C) to indexes (0, 1, 2)
              const correctIndexes = question.correctAnswer.map(letter => {
                // Convert "A" -> 0, "B" -> 1, "C" -> 2, etc.
                return letter.charCodeAt(0) - 65; // A=65 in ASCII
              }).sort();
              
              // Ensure student answer is an array of numbers
              const studentIndexes = Array.isArray(studentAnswer) 
                ? [...new Set(studentAnswer.map(val => Number(val)))].sort()
                : [Number(studentAnswer)].sort();
              
              isCorrect = JSON.stringify(correctIndexes) === JSON.stringify(studentIndexes);
            } else {
              // Single correct answer - convert letter to index
              const correctIndex = question.correctAnswer.charCodeAt(0) - 65;
              const studentIndex = Number(studentAnswer);
              isCorrect = correctIndex === studentIndex;
            }
          }
          break;

        case 'truefalse':
          // Normalize both sides to booleans
          if (question.correctAnswer !== undefined && studentAnswer !== undefined) {
            const normalizeBool = (val) => {
              if (typeof val === 'boolean') return val;
              if (typeof val === 'number') return val === 1 || val === 0 ? val === 1 : Boolean(val);
              const s = String(val).toLowerCase().trim();
              if (s === 'true' || s === 't' || s === '1') return true;
              if (s === 'false' || s === 'f' || s === '0') return false;
              return Boolean(s);
            };
            isCorrect = normalizeBool(question.correctAnswer) === normalizeBool(studentAnswer);
          }
          break;

        case 'enumeration':
          // For enumeration questions, use the 'answers' array for correct answers
          if (Array.isArray(question.answers) && question.answers.length > 0) {
            const enumerationCorrectAnswers = question.answers
              .map(ans => String(ans).toLowerCase().trim())
              .filter(ans => ans.length > 0);
            
            let studentAnswers = [];
            if (Array.isArray(studentAnswer)) {
              // If answers are numeric indexes, map through choices if available
              if (studentAnswer.length > 0 && typeof studentAnswer[0] === 'number' && Array.isArray(question.choices)) {
                studentAnswers = studentAnswer
                  .map(idx => question.choices[idx])
                  .filter(ans => typeof ans === 'string')
                  .map(ans => ans.toLowerCase().trim())
                  .filter(ans => ans.length > 0);
              } else {
                studentAnswers = studentAnswer
                  .map(ans => String(ans).toLowerCase().trim())
                  .filter(ans => ans.length > 0);
              }
            } else if (studentAnswer) {
              studentAnswers = [String(studentAnswer).toLowerCase().trim()].filter(ans => ans.length > 0);
            }
            
            console.log('🔍 Enumeration Debug:', {
              question: question.text,
              correctAnswers: enumerationCorrectAnswers,
              studentAnswers,
              studentAnswerRaw: studentAnswer
            });
            
            // Require set equality (order-insensitive, case-insensitive)
            const uniqueStudent = [...new Set(studentAnswers)];
            const requiredCount = enumerationCorrectAnswers.length;
            if (uniqueStudent.length !== requiredCount) {
              isCorrect = false;
            } else {
              const allMatch = enumerationCorrectAnswers.every(ans => uniqueStudent.includes(ans));
              isCorrect = allMatch;
            }
          } else {
            isCorrect = false;
            console.log('❌ No answers array defined for enumeration');
          }
          break;

        case 'essay':
          // For essay questions, auto-grade as correct for now
          isCorrect = true; // Auto-pass essays for demo
          break;
      }

      // Calculate points
      pointsEarned = isCorrect ? question.points : 0;
      totalScore += pointsEarned;

      // Store the answers in a display-friendly format for results
      let displayStudentAnswer = studentAnswer;
      let displayCorrectAnswer = question.correctAnswer;

      // Format enumeration answers for display (check first as it has special logic)
      if (question.type === 'enumeration') {
        if (Array.isArray(studentAnswer)) {
          // Map numeric indexes to choice text if available
          if (studentAnswer.length > 0 && typeof studentAnswer[0] === 'number' && Array.isArray(question.choices)) {
            displayStudentAnswer = studentAnswer
              .map(idx => question.choices[idx])
              .filter(Boolean)
              .join(', ');
          } else {
            displayStudentAnswer = studentAnswer
              .map(ans => String(ans))
              .filter(ans => ans && ans.trim().length > 0)
              .join(', ');
          }
        } else if (studentAnswer) {
          displayStudentAnswer = String(studentAnswer);
        } else {
          displayStudentAnswer = 'No answer provided';
        }
        
        // Use answers array for display since correctAnswer is undefined
        if (Array.isArray(question.answers)) {
          displayCorrectAnswer = question.answers.filter(ans => ans && ans.trim().length > 0).join(', ');
        } else {
          displayCorrectAnswer = 'No correct answers defined';
        }
      }

      // Handle unanswered questions - mark as "No answer provided" (after enumeration formatting)
      if (displayStudentAnswer === null || displayStudentAnswer === undefined || 
          (typeof displayStudentAnswer === 'string' && displayStudentAnswer.trim() === '' && displayStudentAnswer !== 'No answer provided') ||
          (Array.isArray(displayStudentAnswer) && displayStudentAnswer.length === 0)) {
        displayStudentAnswer = 'No answer provided';
      }

      // Convert true/false to consistent capitalization for display
      if (question.type === 'truefalse') {
        if (displayStudentAnswer !== 'No answer provided') {
          displayStudentAnswer = String(studentAnswer).charAt(0).toUpperCase() + String(studentAnswer).slice(1).toLowerCase();
        }
        displayCorrectAnswer = String(question.correctAnswer).charAt(0).toUpperCase() + String(question.correctAnswer).slice(1).toLowerCase();
      }

      questionResults.push({
        questionId: question._id,
        questionText: question.text,
        questionType: question.type,
        studentAnswer: displayStudentAnswer,
        correctAnswer: displayCorrectAnswer,
        isCorrect: isCorrect,
        pointsEarned: pointsEarned,
        maxPoints: question.points,
        feedback: isCorrect ? question.feedbackWhenCorrect : question.feedbackWhenIncorrect
      });
    });

    // Determine if student passed
    const passed = totalScore >= test.passingPoints;

    // Save attempt to database
    const testAttempt = new StudentTestAttempt({
      student: studentId,
      test: testId,
      score: totalScore,
      totalPoints: test.totalPoints,
      percentage: test.totalPoints > 0 ? (totalScore / test.totalPoints) * 100 : 0,
      passed: passed,
      questionResults: questionResults,
      takenAt: new Date(),
      submittedAt: new Date()
    });

    await testAttempt.save();

    console.log('✅ Test submitted successfully. Score:', totalScore);

    res.json({
      success: true,
      score: totalScore,
      totalPoints: test.totalPoints,
      percentage: test.totalPoints > 0 ? (totalScore / test.totalPoints) * 100 : 0,
      passed: passed,
      correctAnswers: questionResults.filter(q => q.isCorrect).length,
      totalQuestions: test.questions.length,
      results: questionResults
    });

  } catch (error) {
    console.error("❌ Submit test error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Error submitting test: " + error.message 
    });
  }
});

export default router;
