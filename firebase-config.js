// firebase-config.js
// ใช้ Firebase ผ่าน CDN (modular SDK) ไม่ต้องมี build tool
// ทุกไฟล์ที่ต้องใช้ Firebase ให้ import จากไฟล์นี้แทนการ import จาก "firebase/..." ตรงๆ

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDiNN9_E3YKF46b7RywW7lyczB3JP6mw_U",
  authDomain: "lean-56e67.firebaseapp.com",
  projectId: "lean-56e67",
  storageBucket: "lean-56e67.firebasestorage.app",
  messagingSenderId: "28737001937",
  appId: "1:28737001937:web:171fd4f73058dcc586a8f0",
  measurementId: "G-KWZLYDNRR4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Export สิ่งที่ไฟล์อื่นต้องใช้
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;