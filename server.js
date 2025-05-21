require("dotenv").config();
const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

// Parse service account from env
const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL, // Make sure this is set in your .env
});

const firestore = admin.firestore();
const rtdb = admin.database();

const app = express();
app.use(bodyParser.json());

// ✅ Endpoint to send notification to a single user
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

    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) {
      return res.status(404).json({ error: "FCM token not found for user" });
    }

    const message = {
      notification: {
        title,
        body,
      },
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

// ✅ Endpoint to notify all members in a circle with GPS data
app.post("/notify-circle-members", async (req, res) => {
  const { adminUid, title, body } = req.body;

  if (!adminUid || !title || !body) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    // Get admin's circleCode
    const adminDoc = await firestore.collection("users").doc(adminUid).get();
    if (!adminDoc.exists) {
      return res.status(404).json({ error: "Admin user not found" });
    }

    const adminData = adminDoc.data();
    const circleCode = adminData.circleCode;

    if (!circleCode) {
      return res.status(400).json({ error: "Admin has no circleCode" });
    }

    // Find all members with joinedCircleCode === circleCode
    const membersSnapshot = await firestore.collection("users")
      .where("joinedCircleCode", "==", circleCode)
      .get();

    if (membersSnapshot.empty) {
      return res.status(404).json({ error: "No members found in this circle" });
    }

    const results = [];

    for (const doc of membersSnapshot.docs) {
      const memberUid = doc.id;

      // Get FCM token from RTDB
      const tokenSnap = await rtdb.ref(`deviceTokens/${memberUid}`).once("value");
      const fcmToken = tokenSnap.val();
      if (!fcmToken) continue;

      // Get location from RTDB
      const locationSnap = await rtdb.ref(`GPSLocation/${memberUid}`).once("value");
      const location = locationSnap.val() || {};
      const latitude = location.latitude?.toString() || "Unknown";
      const longitude = location.longitude?.toString() || "Unknown";

      // Send notification
      const message = {
        token: fcmToken,
        notification: {
          title,
          body: `${body} (Lat: ${latitude}, Lon: ${longitude})`,
        },
        data: {
          latitude,
          longitude,
        },
      };

      const response = await admin.messaging().send(message);
      console.log(`✅ Notification sent to ${memberUid}`);
      results.push({ memberUid, response });
    }

    res.status(200).json({ success: true, results });

  } catch (error) {
    console.error("❌ Error notifying members:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
