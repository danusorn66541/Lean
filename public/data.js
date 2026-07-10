// Data access layer สำหรับ patients / inventory(medicines) / records / employees
// เชื่อมกับ Firestore แบบประหยัดพลังงาน (ผสมผสาน Real-time และ Server-Side Pagination เพื่อลดการ Read)

import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  runTransaction,
  serverTimestamp,
  limit,       // 👈 เพิ่มใหม่เพื่อจำกัดการดึงข้อมูล
  startAfter,  // 👈 เพิ่มใหม่เพื่อใช้เป็นตัวจำจุดสิ้นสุดหน้าเก่า (Cursor)
  getDocs,
  getCountFromServer      // 👈 เพิ่มใหม่สำหรับดึงข้อมูลแบบ On-Demand (ดึงครั้งเดียวจบ)
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ==================== PATIENTS ====================
export function listenPatients(onChange) {
  const q = query(collection(db, "patients"), orderBy("name"));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(list);
  }, (err) => console.error("listenPatients error:", err));
}

export async function addPatientDoc({ name, ward, bed }) {
  await addDoc(collection(db, "patients"), { name, ward, bed, createdAt: serverTimestamp() });
}

export async function deletePatientDoc(id) {
  await deleteDoc(doc(db, "patients", id));
}

export async function updatePatientDoc(id, { name, ward, bed }) {
  const patientRef = doc(db, "patients", id);
  await updateDoc(patientRef, { name, ward, bed });
}

// ==================== INVENTORY (MEDICINES) ====================
export function listenInventory(onChange) {
  const q = query(collection(db, "inventory"), orderBy("name"));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(list);
  }, (err) => console.error("listenInventory error:", err));
}

export async function addMedicineDoc({ name, stock, unit, reorder, barcode }) {
  await addDoc(collection(db, "inventory"), {
    name, 
    stock, 
    unit, 
    reorder, 
    barcode: barcode || "", 
    createdAt: serverTimestamp()
  });
}

export async function deleteMedicineDoc(id) {
  await deleteDoc(doc(db, "inventory", id));
}

// ==================== RECORDS (การใช้เวชภัณฑ์ - เวอร์ชันลดการ READ ขั้นสุด) ====================

// ❌ [ยกเลิกใช้งาน listenRecords ของเดิม เพื่อหยุดสตรีมข้อมูลขนาดใหญ่ตลอดเวลา]

/**
 * ⚡ ฟังก์ชันใหม่ 1: ดึงประวัติการใช้ยาเฉพาะหน้าที่ต้องการจาก Firestore (ดึงจำกัดครั้งละ n รายการ)
 * ช่วยเซฟจำนวน Read ได้อย่างมหาศาล เพราะพยาบาลเปิดดูหน้าไหน ระบบจะวิ่งไปนับดึงข้อมูลมาให้แค่นั้นพอ
 */
export async function getRecordsPageFromFirestore(limitNum, startAfterDoc = null) {
  try {
    let q = query(collection(db, "records"), orderBy("createdAt", "desc"), limit(limitNum));
    
    // ถ้ามีคอร์เซอร์ (ตำแหน่งจุดจบของหน้าก่อนหน้า) ให้ดึงข้อมูลต่อจากจุดนั้น
    if (startAfterDoc) {
      q = query(collection(db, "records"), orderBy("createdAt", "desc"), startAfter(startAfterDoc), limit(limitNum));
    }
    
    const snapshot = await getDocs(q);
    const list = [];
    snapshot.forEach((doc) => {
      list.push({ 
        id: doc.id, 
        ...doc.data(), 
        docSnap: doc // 👈 เซฟตัว snapshot ของแต่ละชิ้นไว้ในรูปแบบ cursor เพื่อส่งกลับไปให้หน้าบ้านใช้กดเปลี่ยนหน้า
      });
    });
    return list;
  } catch (err) {
    console.error("getRecordsPageFromFirestore error:", err);
    throw err;
  }
}

/**
 * ⚡ ฟังก์ชันใหม่ 2: ดึงประวัติทั้งหมดเพียง "ครั้งเดียว" (On-Demand)
 * จะทำงานเฉพาะเจาะจงตอนที่ แอดมินกดปุ่มส่งออก Excel เท่านั้น พอทำงานเสร็จข้อมูลก็ทำลายทิ้งทันที
 */
export async function getTotalRecordsCount() {
    try {
        const snapshot = await getCountFromServer(collection(db, "records"));
        return snapshot.data().count;
    } catch (err) {
        console.error("Count error:", err);
        return 0;
    }
}

/**
 * บันทึกการใช้เวชภัณฑ์ + ตัดสต็อกพร้อมกันแบบ atomic
 */
export async function submitRecordDoc({ patientId, patientName, performedByUid, performedByName, shift, items }) { // 👈 เพิ่ม patientId ตรงนี้
  await runTransaction(db, async (tx) => {
    const medSnaps = [];

    for (const item of items) {
      const medicineRef = doc(db, "inventory", item.medicineId);
      const snap = await tx.get(medicineRef);
      if (!snap.exists()) throw new Error(`ไม่พบเวชภัณฑ์ "${item.medicineName}" ในระบบแล้ว`);
      const currentStock = snap.data().stock || 0;
      if (currentStock < item.quantity) throw new Error(`สต็อก "${item.medicineName}" ไม่พอ (คงเหลือ ${currentStock})`);
      medSnaps.push({ ref: medicineRef, currentStock, quantity: item.quantity });
    }

    for (const med of medSnaps) {
      tx.update(med.ref, { stock: med.currentStock - med.quantity });
    }

    const recordRef = doc(collection(db, "records"));
    tx.set(recordRef, {
      patientId, // 👈 แสตมป์ ID คนไข้ลงฐานข้อมูลคลาวด์แบบถาวร
      patientName,
      performedByUid: performedByUid || null,
      performedByName: performedByName || null,
      shift: shift || '-',
      items: items, 
      createdAt: serverTimestamp()
    });
  });
}

export async function restockMedicineDoc(id, addedQuantity) {
  const medRef = doc(db, "inventory", id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(medRef);
    if (!snap.exists()) {
      throw new Error("ไม่พบเวชภัณฑ์นี้ในระบบแล้ว");
    }
    const currentStock = snap.data().stock || 0;
    tx.update(medRef, { stock: currentStock + addedQuantity });
  });
}

// ==================== EMPLOYEES (สำหรับหน้า admin) ====================
export function listenEmployees(onChange) {
  const q = query(collection(db, "Usertest"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(list);
  }, (err) => console.error("listenEmployees error:", err));
}

export async function voidRecordDoc(recordId, voidedByName) {
  await runTransaction(db, async (tx) => {
    const recordRef = doc(db, "records", recordId);
    const recordSnap = await tx.get(recordRef);

    if (!recordSnap.exists()) throw new Error("ไม่พบบันทึกนี้ในระบบ");
    
    const recordData = recordSnap.data();
    if (recordData.voided) throw new Error("บันทึกนี้ถูกยกเลิกไปแล้ว");

    // 1. อ่านรายการยาทั้งหมดในบิล เพื่อเตรียมคืนสต็อก
    const items = recordData.items || [];
    const medSnaps = [];

    for (const item of items) {
      if (item.medicineId) {
        const medRef = doc(db, "inventory", item.medicineId);
        const medSnap = await tx.get(medRef);
        if (medSnap.exists()) {
          medSnaps.push({ 
            ref: medRef, 
            currentStock: medSnap.data().stock || 0, 
            returnQty: item.quantity 
          });
        }
      }
    }

    // 2. คืนค่ายอดสต็อกให้ยาแต่ละตัว
    for (const med of medSnaps) {
      tx.update(med.ref, { stock: med.currentStock + med.returnQty });
    }

    // 3. เปลี่ยนสถานะบิลเป็น "ถูกยกเลิกแล้ว"
    tx.update(recordRef, {
      voided: true,
      voidedBy: voidedByName,
      voidedAt: serverTimestamp()
    });
  });
}

export async function getAllRecordsOnceFromFirestore() {
  try {
    const q = query(collection(db, "records"), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    const list = [];
    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() });
    });
    return list;
  } catch (err) {
    console.error("getAllRecordsOnceFromFirestore error:", err);
    throw err;
  }
}