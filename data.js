// data.js
// Data access layer สำหรับ patients / inventory(medicines) / records
// เชื่อมกับ Firestore แบบ real-time (onSnapshot) แทน localStorage ทั้งหมด

import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ==================== PATIENTS ====================
export function listenPatients(onChange) {
  const q = query(collection(db, "patients"), orderBy("name"));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(list);
  }, (err) => console.error("listenPatients error:", err));
}

export async function addPatientDoc({ hn, name, ward, bed }) {
  await addDoc(collection(db, "patients"), { hn, name, ward, bed, createdAt: serverTimestamp() });
}

export async function deletePatientDoc(id) {
  await deleteDoc(doc(db, "patients", id));
}

// ==================== INVENTORY (MEDICINES) ====================
export function listenInventory(onChange) {
  const q = query(collection(db, "inventory"), orderBy("name"));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(list);
  }, (err) => console.error("listenInventory error:", err));
}

export async function addMedicineDoc({ code, name, stock, unit, reorder }) {
  await addDoc(collection(db, "inventory"), {
    code, name, stock, unit, reorder, createdAt: serverTimestamp()
  });
}

export async function deleteMedicineDoc(id) {
  await deleteDoc(doc(db, "inventory", id));
}

// ==================== RECORDS (การใช้เวชภัณฑ์) ====================
export function listenRecords(onChange) {
  const q = query(collection(db, "records"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    onChange(list);
  }, (err) => console.error("listenRecords error:", err));
}

/**
 * บันทึกการใช้เวชภัณฑ์ + ตัดสต็อกพร้อมกันแบบ atomic (กันกรณีสแกนพร้อมกันหลายเครื่องแล้วสต็อกเพี้ยน)
 */
export async function submitRecordDoc({ medicineId, medicineName, patientName, quantity, performedByUid, performedByEmployeeId, performedByName }) {
  const medicineRef = doc(db, "inventory", medicineId);
  const recordRef = doc(collection(db, "records"));

  await runTransaction(db, async (tx) => {
    const medicineSnap = await tx.get(medicineRef);
    if (!medicineSnap.exists()) {
      throw new Error("ไม่พบเวชภัณฑ์นี้ในระบบแล้ว (อาจถูกลบไปแล้ว)");
    }
    const currentStock = medicineSnap.data().stock || 0;
    if (currentStock < quantity) {
      throw new Error(`สต็อกไม่พอ (คงเหลือ ${currentStock})`);
    }

    tx.update(medicineRef, { stock: currentStock - quantity });
    tx.set(recordRef, {
      medicineId,
      medicineName,
      patientName,
      quantity,
      performedByUid: performedByUid || null,
      performedByEmployeeId: performedByEmployeeId || null,
      performedByName: performedByName || null,
      createdAt: serverTimestamp()
    });
  });
}