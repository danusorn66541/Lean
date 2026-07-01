// auth.js
// ระบบ Login ด้วย QR Code พนักงาน (ใช้แทน password ภายในวอร์ดเท่านั้น)
//
// แนวคิด:
// - Admin สร้างพนักงานใหม่ครั้งเดียว -> ระบบ generate "qrToken" แบบสุ่มยาว เก็บใน Firestore (users/{employeeId})
// - พนักงานสแกน QR (ที่ encode เป็น qrToken) -> ระบบค้นหาใน Firestore ว่า token ตรงกับใคร -> ถ้าพบและ active=true ให้เข้าระบบ
// - ใช้ Firebase Anonymous Auth คู่กับ token เพื่อให้มี request.auth.uid ไว้ใช้ใน Firestore Security Rules
//   (หมายเหตุด้านความปลอดภัย: นี่คือการยืนยันตัวตนแบบเบา เหมาะกับการใช้งานในเครือข่ายปิดของวอร์ดเท่านั้น
//    ถ้า token หลุดออกนอกวอร์ด คนอื่นจะสวมรอยได้ จึงต้องเก็บ QR บัตรพนักงานให้ปลอดภัยทางกายภาพ)

import { auth, db } from "./firebase-config.js";
import {
  signInAnonymously,
  signOut,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const SESSION_KEY = "leanCurrentUser";

// ตั้งค่าให้ Firebase Auth จำ session ไว้ในเครื่องถาวร (ไม่หายแม้ปิดเบราว์เซอร์/แอป)
// ต้องเรียกก่อนใช้งาน auth ใดๆ - เรียกครั้งเดียวตอนโหลดไฟล์นี้
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("ตั้งค่า persistence ไม่สำเร็จ:", err);
});

// ==================== TOKEN GENERATION ====================
// สุ่ม token ยาว 48 ตัวอักษร (กันเดา/ปลอม)
function generateSecureToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ==================== ADMIN: สร้างพนักงานใหม่ + QR ====================
/**
 * เรียกใช้ตอน Admin รับพนักงานเข้าระบบ
 * @param {Object} employeeData - { employeeId, name, role, department }
 * @returns {Promise<string>} qrToken ที่ใช้ generate เป็น QR code ให้พนักงาน
 */
export async function createEmployeeWithQR(employeeData) {
  const { employeeId, name, role, department } = employeeData;

  if (!employeeId || !name || !role) {
    throw new Error("ข้อมูลไม่ครบ: ต้องมี employeeId, name, role");
  }

  // เช็คว่ามี employeeId นี้อยู่แล้วหรือยัง
  const existing = await getDoc(doc(db, "users", employeeId));
  if (existing.exists()) {
    throw new Error("รหัสพนักงานนี้มีอยู่ในระบบแล้ว");
  }

  const qrToken = generateSecureToken();

  await setDoc(doc(db, "users", employeeId), {
    employeeId,
    name,
    role,            // "nurse" | "pharmacist" | "admin"
    department: department || "",
    qrToken,
    active: true,
    createdAt: serverTimestamp(),
    lastLoginAt: null,
    lastLoginUid: null
  });

  return qrToken; // นำค่านี้ไป generate เป็น QR code ด้วย QRCode library ที่มีอยู่แล้ว
}

// ==================== EMPLOYEE: Login ด้วย QR ====================
/**
 * เรียกใช้เมื่อสแกน QR พนักงานสำเร็จ (ได้ค่า token จากการสแกน)
 * @param {string} scannedToken
 * @returns {Promise<Object>} ข้อมูล user ที่ login สำเร็จ
 */
export async function loginWithQR(scannedToken) {
  if (!scannedToken) {
    throw new Error("ไม่พบข้อมูล QR Code");
  }

  // ค้นหาพนักงานที่มี qrToken ตรงกัน
  const q = query(
    collection(db, "users"),
    where("qrToken", "==", scannedToken),
    where("active", "==", true)
  );
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    throw new Error("QR Code ไม่ถูกต้อง หรือบัญชีถูกปิดใช้งาน");
  }

  const userDoc = snapshot.docs[0];
  const userData = userDoc.data();

  // sign in แบบ anonymous เพื่อให้มี request.auth.uid ใช้ใน Security Rules
  const cred = await signInAnonymously(auth);
  const uid = cred.user.uid;

  // บันทึก log การ login ล่าสุด (audit trail)
  await updateDoc(doc(db, "users", userDoc.id), {
    lastLoginAt: serverTimestamp(),
    lastLoginUid: uid
  });

  const currentUser = {
    uid,
    employeeId: userData.employeeId,
    name: userData.name,
    role: userData.role,
    department: userData.department
  };

  // เก็บ session ไว้ใน localStorage เพื่อให้รอดตอน refresh หน้า
  localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));

  return currentUser;
}

// ==================== Logout ====================
export async function logout() {
  await signOut(auth);
  localStorage.removeItem(SESSION_KEY);
}

// ==================== ดึง user ปัจจุบันจาก session ====================
export function getCurrentUser() {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function isLoggedIn() {
  return getCurrentUser() !== null;
}

// ==================== Restore session ตอนเปิดแอปใหม่ ====================
/**
 * เรียกตอนแอปเริ่มทำงาน (DOMContentLoaded) เพื่อเช็คว่ามี session ค้างอยู่ไหม
 * - ถ้ามี และ Firebase Auth ยัง valid อยู่ -> ใช้ session เดิมต่อ ไม่ต้องสแกน QR ซ้ำ
 * - ถ้าบัญชีถูกปิด (active=false) ระหว่างนั้น -> เคลียร์ session บังคับ login ใหม่
 * @returns {Promise<Object|null>} currentUser หรือ null ถ้าไม่มี session ที่ใช้ได้
 */
export function restoreSession() {
  return new Promise((resolve) => {
    const cached = getCurrentUser();
    if (!cached) {
      resolve(null);
      return;
    }

    // รอ Firebase Auth คืนสถานะ session เดิม (มาจาก browserLocalPersistence)
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      unsubscribe();

      if (!fbUser) {
        // Firebase auth session หมดอายุ/ไม่มี -> เคลียร์ session ฝั่งแอปด้วย
        localStorage.removeItem(SESSION_KEY);
        resolve(null);
        return;
      }

      // เช็คซ้ำกับ Firestore ว่าบัญชียัง active อยู่ไหม (เผื่อ admin ปิดบัญชีไประหว่างนั้น)
      try {
        const userSnap = await getDoc(doc(db, "users", cached.employeeId));
        if (!userSnap.exists() || userSnap.data().active !== true) {
          await signOut(auth);
          localStorage.removeItem(SESSION_KEY);
          resolve(null);
          return;
        }
        resolve(cached);
      } catch (err) {
        console.error("ตรวจสอบ session ไม่สำเร็จ:", err);
        resolve(cached); // กรณีออฟไลน์/เน็ตมีปัญหา ให้ใช้ session เดิมไปก่อน
      }
    });
  });
}