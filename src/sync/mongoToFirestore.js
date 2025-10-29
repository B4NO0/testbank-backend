import { firestore } from "../config/firebase.js";
import Student from "../models/Student.js";
import Test from "../models/Test.js";
import StudentTestAttempt from "../models/StudentTestAttempt.js";

// 🧩 Clean document before uploading to Firestore
function cleanDocument(doc) {
  if (!doc) return {};
  const { __v, _id, ...rest } = doc;
  
  // Convert ObjectId fields to strings
  const cleaned = { id: _id.toString(), ...rest };
  
  // Recursively clean nested objects
  const cleanObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (obj.constructor?.name === 'ObjectId') return obj.toString();
    if (Array.isArray(obj)) return obj.map(cleanObject);
    if (obj instanceof Date) return obj;
    
    const cleanedObj = {};
    for (const [key, value] of Object.entries(obj)) {
      cleanedObj[key] = cleanObject(value);
    }
    return cleanedObj;
  };
  
  return cleanObject(cleaned);
}

// 🧠 Generic sync listener (to avoid repetition)
async function syncModelToFirestore(model, collectionName) {
  console.log(`🔄 Starting MongoDB → Firestore sync for ${collectionName}...`);

  // ✅ One-time initial sync
  const allDocs = await model.find().lean();
  console.log(`📦 Found ${allDocs.length} existing ${collectionName} in MongoDB.`);
  for (const d of allDocs) {
    try {
      const ref = firestore.collection(collectionName).doc(d._id.toString());
      const docSnap = await ref.get();
      if (!docSnap.exists) {
        await ref.set({ ...cleanDocument(d), _syncedFrom: "mongo" });
        console.log(`🟢 Initial sync: ${d._id.toString()}`);
      }
    } catch (err) {
      console.error(`❌ Error in initial sync for ${collectionName}:`, err.message);
    }
  }
  console.log(`✅ Initial sync complete (Mongo → Firestore) for '${collectionName}'`);

  // ✅ Real-time sync listener
  const changeStream = model.watch();

  changeStream.on("change", (change) => {
    (async () => {
      try {
        const { operationType, documentKey, fullDocument } = change;
        const id = documentKey._id.toString();
        const ref = firestore.collection(collectionName).doc(id);

        // prevent sync loops
        if (fullDocument?._syncedFrom === "firestore") return;

        switch (operationType) {
          case "insert":
            await ref.set({ ...cleanDocument(fullDocument), _syncedFrom: "mongo" });
            console.log(`🟢 Firestore insert (${collectionName}): ${id}`);
            break;

          case "update":
          case "replace": {
            const updatedDoc = await model.findById(id).lean();
            if (updatedDoc?._syncedFrom === "firestore") return;
            await ref.set({ ...cleanDocument(updatedDoc), _syncedFrom: "mongo" });
            console.log(`🟡 Firestore update (${collectionName}): ${id}`);
            break;
          }

          case "delete":
            await ref.delete();
            console.log(`🔴 Firestore delete (${collectionName}): ${id}`);
            break;
        }
      } catch (err) {
        console.error(`❌ Mongo→Firestore sync error for ${collectionName}:`, err);
      }
    })();
  });

  console.log(`✅ MongoDB → Firestore listener active for '${collectionName}'`);
}

// 🧩 Main Sync Function
export const startMongoToFirestoreSync = async () => {
  try {
    await syncModelToFirestore(Student, "students");
    await syncModelToFirestore(Test, "tests");
    await syncModelToFirestore(StudentTestAttempt, "studentTestAttempts");
  } catch (err) {
    console.error("❌ Failed to start Mongo→Firestore sync:", err);
  }
};
export default startMongoToFirestoreSync;