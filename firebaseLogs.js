const firebaseAdmin = require("firebase-admin");

//Firebase setup
const serviceAccount = require("./firebase.json");
firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount),
  databaseURL: "https://planemate-4aabc-default-rtdb.firebaseio.com/",
});
const db = firebaseAdmin.database();

// Use the push() method to add the log entry to your "lastTen" array
const lastTenRef = db.ref("runningLog/lastTen");

// Remove the oldest entry if there are more than 10 entries
lastTenRef.on("value", (snapshot) => {
  if (snapshot.numChildren() > 10) {
    let childCount = 0;
    const updates = {};
    snapshot.forEach((childSnapshot) => {
      if (++childCount <= snapshot.numChildren() - 10) {
        updates[childSnapshot.key] = null;
      }
    });
    lastTenRef.update(updates);
  }
});

function pushFirebase(message) {
  const logEntry = {
    message: message,
    timestamp: firebaseAdmin.database.ServerValue.TIMESTAMP,
  };
  lastTenRef.push(logEntry);
}

pushFirebase("Door 11122334998 (Dock 199) Opened");
