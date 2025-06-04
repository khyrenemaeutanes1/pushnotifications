require("dotenv").config();
const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

// ✅ Clean parse of service account from .env
const rawCredentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
const serviceAccount = {
  ...rawCredentials,
  private_key: rawCredentials.private_key.replace(/\\n/g, '\n'),
};

// ✅ Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const firestore = admin.firestore();
const rtdb = admin.database();

const app = express();
app.use(bodyParser.json());

// ✅ Send notification to a specific user, fetching token from RTDB
app.post("/send-notification", async (req, res) => {
  const { userId, title, body } = req.body;

  if (!userId || !title || !body) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    // Optional: check if user exists in Firestore
    const userDoc = await firestore.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get FCM token from Realtime Database
    const tokenSnap = await rtdb.ref(`deviceTokens/${userId}`).once("value");
    const fcmToken = tokenSnap.val();

    if (!fcmToken) {
      return res.status(404).json({ error: "FCM token not found for user" });
    }

    const message = {
      notification: { title, body },
      token: fcmToken,
    };

    const response = await admin.messaging().send(message);
    console.log("✅ Sent message:", response);
    res.status(200).json({ success: true, response });

  } catch (error) {
    console.error("❌ Error sending message:", error);
    res.status(500).json({ error: error.message });
  }
});

// ✅ Notify all members in a circle with GPS info, filtering by role = "Monitoring User"
app.post("/notify-circle-members", async (req, res) => {
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({ error: "Missing title or body" });
  }

  try {
    // 🟡 Get all users with role = Monitoring User
    const usersSnapshot = await firestore
      .collection("users")
      .where("role", "==", "Monitoring User")
      .get();

    if (usersSnapshot.empty) {
      return res.status(404).json({ error: "No monitoring users found" });
    }

    const results = await Promise.all(usersSnapshot.docs.map(async (doc) => {
      const uid = doc.id;
      const tokenSnap = await rtdb.ref(`deviceTokens/${uid}`).once("value");
      const fcmToken = tokenSnap.val();

      if (!fcmToken) return null;

      const messagePayload = {
        token: fcmToken,
        notification: {
          title,
          body,
        },
      };

      const response = await admin.messaging().send(messagePayload);
      console.log(`✅ Sent to ${uid}`);
      return { uid, response };
    }));

    res.status(200).json({ success: true, sent: results.filter(Boolean) });
  } catch (error) {
    console.error("🚨 Error sending notifications:", error);
    res.status(500).json({ error: error.message });
  }
});

// 🖥️ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
