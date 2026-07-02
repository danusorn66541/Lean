// auth.js - ระบบ Login ด้วย Email/Password (Firebase Auth)
import { auth, db } from "./firebase-config.js";
import {
  initializeApp,
  getApps,
  deleteApp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const SESSION_KEY = "leanCurrentUser";
const COLLECTION_NAME = "Usertest";

setPersistence(auth, browserLocalPersistence).catch(function(err) {
  console.error("setPersistence error:", err);
});

// ==================== LOGIN ====================
export async function loginWithEmail(email, password) {
  var cred = await signInWithEmailAndPassword(auth, email, password);
  var uid = cred.user.uid;

  var snap = await getDoc(doc(db, COLLECTION_NAME, uid));
  if (!snap.exists()) throw new Error("ไม่พบข้อมูลผู้ใช้ในระบบ");
  var data = snap.data();
  if (data.active === false) throw new Error("บัญชีนี้ถูกปิดใช้งาน");

  var currentUser = {
    uid: uid,
    email: email,
    name: data.name,
    role: data.role || "user",
    admin: data.admin,
    department: data.department || ""
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
  return currentUser;
}

// ==================== ADMIN: สร้างผู้ใช้ใหม่ ====================
// แก้ไข: ใช้ Firebase App instance ที่สอง ("Secondary") แยกจาก app หลัก
// เพื่อไม่ให้ createUserWithEmailAndPassword() สลับ auth state ของ admin
// ที่ล็อกอินอยู่ ณ ขณะนั้น (ปัญหาเดิม: สร้าง user ใหม่ปุ๊บ admin หลุด session ทันที)
//
// auth.app.options คือ config ของ default app ที่ auth ผูกอยู่ ดึงมาใช้ init
// secondary app ได้เลย ไม่ต้องแก้ไฟล์ firebase-config.js
export async function createEmployee(employeeData) {
  var email = employeeData.email;
  var password = employeeData.password;
  var name = employeeData.name;
  var role = employeeData.role || "nurse";
  var admin = employeeData.admin || false;
  var department = employeeData.department || "";

  if (!email || !password || !name) {
    throw new Error("ข้อมูลไม่ครบ: ต้องมี email, password, name");
  }

  // reuse secondary app ถ้ามีอยู่แล้ว ไม่ init ซ้ำ
  var secondaryApp = getApps().find(function(a) { return a.name === "Secondary"; });
  if (!secondaryApp) {
    secondaryApp = initializeApp(auth.app.options, "Secondary");
  }
  var secondaryAuth = getAuth(secondaryApp);

  try {
    var cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    var uid = cred.user.uid;

    // เขียน Firestore ด้วย db ของ app หลัก (db ไม่ผูกกับ auth session จึงใช้ได้ปกติ)
    await setDoc(doc(db, COLLECTION_NAME, uid), {
      uid: uid,
      email: email,
      name: name,
      role: role,        // <-- แก้บั๊ก: เดิมไม่ได้บันทึก role ทำให้ login แล้วได้ role "user" เสมอ
      admin: admin,
      department: department,
      active: true,
      createdAt: serverTimestamp()
    });

    return { uid: uid, email: email, name: name, role: role, admin: admin, department: department };
  } finally {
    // sign out จาก secondary auth เสมอ ไม่ว่าสำเร็จหรือ error
    // เพื่อไม่ให้ session ของ user ใหม่ค้างอยู่ในเบราว์เซอร์ของ admin
    await signOut(secondaryAuth).catch(function() {});
    // ลบ instance ทิ้งกัน memory ค้าง (ไม่กระทบ default app / admin session)
    await deleteApp(secondaryApp).catch(function() {});
  }
}

// ==================== ADMIN: จัดการพนักงาน (เปิด/ปิดใช้งาน, ลบ) ====================
export async function toggleEmployeeActive(uid, active) {
  await updateDoc(doc(db, COLLECTION_NAME, uid), { active: active });
}

// หมายเหตุสำคัญ: ฟังก์ชันนี้ลบได้แค่ "เอกสาร Firestore" เท่านั้น
// ผู้ใช้ที่ถูกลบยังสามารถ login เข้า Firebase Auth ได้อยู่ (แค่ไม่มีข้อมูลใน
// Usertest ทำให้ loginWithEmail โยน error "ไม่พบข้อมูลผู้ใช้ในระบบ" ให้แทน)
// ถ้าต้องการลบสิทธิ์ login ออกจาก Firebase Auth จริงๆ ต้องทำผ่าน
// Cloud Function ที่ใช้ Firebase Admin SDK (admin.auth().deleteUser(uid))
// เพราะ client SDK ลบ Auth user คนอื่นที่ไม่ใช่ตัวเองไม่ได้
export async function deleteEmployeeDoc(uid) {
  await deleteDoc(doc(db, COLLECTION_NAME, uid));
}

// ==================== LOGOUT & SESSION ====================
export async function logout() {
  await signOut(auth);
  localStorage.removeItem(SESSION_KEY);
}

export function getCurrentUser() {
  var raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function isLoggedIn() {
  return getCurrentUser() !== null;
}

export function restoreSession() {
  return new Promise(function(resolve) {
    var cached = getCurrentUser();
    if (!cached) { resolve(null); return; }

    var unsubscribe = onAuthStateChanged(auth, async function(fbUser) {
      unsubscribe();
      if (!fbUser) {
        localStorage.removeItem(SESSION_KEY);
        resolve(null);
        return;
      }
      try {
        var snap = await getDoc(doc(db, COLLECTION_NAME, fbUser.uid));
        if (!snap.exists() || snap.data().active === false) {
          await signOut(auth);
          localStorage.removeItem(SESSION_KEY);
          resolve(null);
          return;
        }
        resolve(cached);
      } catch (err) {
        resolve(cached);
      }
    });
  });
}