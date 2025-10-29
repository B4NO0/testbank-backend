import { firestore } from "../config/firebase.js";
import Student from "../models/Student.js";
import Test from "../models/Test.js";
import StudentTestAttempt from "../models/StudentTestAttempt.js";

// 🧩 Helper function to clean Firestore data
function cleanFirestoreDoc(doc) {
  if (!doc) return {};
  const data = doc.data();
  delete data.id;
  
  // Convert string IDs back to ObjectId format if needed
  const cleanObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(cleanObject);
    
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === '_id' && typeof value === 'string') {
        // Keep as string for now, MongoDB will handle conversion
        cleaned[key] = value;
      } else if (key === 'createdBy' && typeof value === 'string') {
        // Keep as string for now, MongoDB will handle conversion
        cleaned[key] = value;
      } else {
        cleaned[key] = cleanObject(value);
      }
    }
    return cleaned;
  };
  
  return cleanObject(data);
}

// 🧠 Generic Firestore listener
async function syncFirestoreToMongo(collectionName, model) {
  console.log(`🔄 Starting Firestore → MongoDB sync for '${collectionName}'...`);

  const collectionRef = firestore.collection(collectionName);

  // ✅ Initial snapshot
  const snapshot = await collectionRef.get();
  console.log(`📦 Found ${snapshot.size} documents in Firestore '${collectionName}'.`);

  for (const doc of snapshot.docs) {
    const docId = doc.id;
    const rawData = doc.data();
    
    // Skip documents already synced from MongoDB
    if (rawData._syncedFrom === "mongo") {
      console.log(`⏭️ Skipping document already synced from MongoDB: ${docId}`);
      continue;
    }
    
    const data = cleanFirestoreDoc(doc);
    
    // Check if the ID is a valid ObjectId format (24 hex characters)
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(docId);
    
    try {
      const existing = await model.findById(docId);

      if (!existing) {
        if (isValidObjectId) {
          await model.create({ _id: docId, ...data, _syncedFrom: "firestore" });
          console.log(`🟢 Initial Mongo insert (${collectionName}): ${docId}`);
        } else {
          // Generate new ObjectId for invalid format
          const newDoc = await model.create({ ...data, _syncedFrom: "firestore" });
          console.log(`🟢 Initial Mongo insert (${collectionName}) with new ID: ${newDoc._id}`);
        }
      } else {
        await model.findByIdAndUpdate(docId, { ...data, _syncedFrom: "firestore" });
        console.log(`🟡 Initial Mongo update (${collectionName}): ${docId}`);
      }
    } catch (error) {
      console.error(`❌ Error syncing document ${docId} to MongoDB:`, error.message);
    }
  }

  // ✅ Real-time snapshot listener
  collectionRef.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      (async () => {
        const doc = change.doc;
        const rawData = doc.data();
        const id = doc.id;
        
        // Skip if this document was synced from MongoDB
        if (rawData._syncedFrom === "mongo") {
          console.log(`⏭️ Skipping document already synced from MongoDB: ${id}`);
          return;
        }
        
        const data = cleanFirestoreDoc(doc);
        const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);

        try {
          switch (change.type) {
            case "added": {
              const existing = await model.findById(id);
              if (!existing) {
                if (isValidObjectId) {
                  await model.create({ _id: id, ...data, _syncedFrom: "firestore" });
                  console.log(`🟢 Firestore→Mongo insert (${collectionName}): ${id}`);
                } else {
                  const newDoc = await model.create({ ...data, _syncedFrom: "firestore" });
                  console.log(`🟢 Firestore→Mongo insert (${collectionName}) with new ID: ${newDoc._id}`);
                }
              }
              break;
            }

            case "modified":
              if (isValidObjectId) {
                const existing = await model.findById(id);
                if (existing) {
                  await model.findByIdAndUpdate(id, { ...data, _syncedFrom: "firestore" });
                  console.log(`🟡 Firestore→Mongo update (${collectionName}): ${id}`);
                } else {
                  console.log(`⚠️ Document ${id} not found in MongoDB for update`);
                }
              } else {
                console.log(`⚠️ Skipping update for invalid ObjectId format: ${id}`);
              }
              break;

            case "removed":
              if (isValidObjectId) {
                await model.findByIdAndDelete(id);
                console.log(`🔴 Firestore→Mongo delete (${collectionName}): ${id}`);
              } else {
                console.log(`⚠️ Skipping delete for invalid ObjectId format: ${id}`);
              }
              break;
          }
        } catch (err) {
          console.error(`❌ Firestore→Mongo sync error (${collectionName}):`, err);
        }
      })();
    });
  });

  console.log(`✅ Firestore → MongoDB listener active for '${collectionName}'`);
}

// 🧩 Main Sync Function
export const startFirestoreToMongoSync = async () => {
  try {
    await syncFirestoreToMongo("students", Student);
    await syncFirestoreToMongo("tests", Test);
    await syncFirestoreToMongo("studentTestAttempts", StudentTestAttempt);
  } catch (err) {
    console.error("❌ Failed to start Firestore→Mongo sync:", err);
  }
};
  