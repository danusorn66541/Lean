// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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
const analytics = getAnalytics(app);