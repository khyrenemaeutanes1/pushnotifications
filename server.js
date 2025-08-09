require("dotenv").config();
const express = require("express");
const admin = require("firebase-admin");

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

const app = express();
app.use(express.json());

/**
 * ✅ Send notification to a specific user
 */
app.post("/send-notification", async (req, res) => {
  const { userId, title, body } = req.body;

  if (!userId || !title || !body) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const userDoc = await firestore.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const fcmToken = userDoc.data()?.fcmToken;

    if (!fcmToken) {
      return res.status(404).json({ error: "FCM token not found in Firestore" });
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

/**
 * ✅ Notify all members in a circle (role: Monitoring User),
 * excluding the sender
 */
app.post("/notify-circle-members", async (req, res) => {
  const { circleCode, title, body, senderUid } = req.body;

  if (!circleCode || !title || !body || !senderUid) {
    return res.status(400).json({
      error: "circleCode, title, body, and senderUid are required"
    });
  }

  try {
    // Get monitoring users in the circle
    const usersSnapshot = await firestore
      .collection("users")
      .where("joinedCircleCode", "==", circleCode)
      .where("role", "==", "Monitoring User")
      .get();

    if (usersSnapshot.empty) {
      return res.status(200).json({ message: "No members found in this circle" });
    }

    // ✅ Skip sender and collect valid tokens
    const tokens = [];
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.uid !== senderUid && userData.fcmToken) {
        tokens.push(userData.fcmToken);
      }
    });

    if (tokens.length === 0) {
      return res.status(200).json({ message: "No other monitoring users found" });
    }

    // Send multicast notification
    const message = {
      notification: { title, body },
      tokens
    };

    const response = await admin.messaging().sendMulticast(message);
    res.status(200).json({ success: true, response });

  } catch (error) {
    console.error("Error notifying circle members:", error);
    res.status(500).json({ error: error.message });
  }
});

// 🖥️ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
