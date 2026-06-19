// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDESuXZqC4XM_VRt7XA2KPzObmolEiKXis",
  authDomain: "lean-e8dfc.firebaseapp.com",
  projectId: "lean-e8dfc",
  storageBucket: "lean-e8dfc.firebasestorage.app",
  messagingSenderId: "614716993747",
  appId: "1:614716993747:web:93820ad104a22ae3be6426",
  measurementId: "G-QD3TH1ZKYG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);