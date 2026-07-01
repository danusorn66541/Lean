// Lean QR Code Medical Supply Tracking System
// Complete application implementation
// ปรับเป็น ES Module เพื่อเชื่อมกับ Firebase (firebase-config.js, auth.js)

import { restoreSession, loginWithQR, logout, getCurrentUser, createEmployeeWithQR } from "./auth.js";
import {
  listenPatients, addPatientDoc, deletePatientDoc,
  listenInventory, addMedicineDoc, deleteMedicineDoc,
  listenRecords, submitRecordDoc
} from "./data.js";

let currentPage = 'dashboard';
let currentUser = null; // ผู้ใช้ที่ login อยู่ปัจจุบัน
let appData = {
    patients: [],
    inventory: [],
    records: []
};

// ==================== SIDEBAR & NAVIGATION ====================
function toggleSidebar() {
    const sidebar = document.getElementById('appSidebar');
    if (sidebar) {
        sidebar.classList.toggle('active');
    }
}

function updateNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    const pageMap = {
        'dashboard': 'navDashboard',
        'scan': 'navScan',
        'patients': 'navPatients',
        'medicines': 'navMedicines',
        'inventory': 'navInventory',
        'records': 'navRecords'
    };

    const navId = pageMap[currentPage];
    if (navId) {
        const navItem = document.getElementById(navId);
        if (navItem) navItem.classList.add('active');
    }
}

function updateHeaderTime() {
    const headerTime = document.getElementById('headerTime');
    if (headerTime) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        const dateStr = now.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
        headerTime.textContent = dateStr + ' ' + timeStr;
    }
}

// แปลง Firestore Timestamp -> ข้อความวันที่ไทย (กันกรณี serverTimestamp() ยังไม่ resolve ตอน optimistic update)
function formatTimestamp(ts) {
    if (!ts) return 'กำลังบันทึก...';
    const date = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    return date.toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ==================== DATA SYNC (Firestore real-time) ====================
// แทนที่ localStorage ทั้งหมด ใช้ onSnapshot ฟังการเปลี่ยนแปลงสด ๆ
// เก็บ unsubscribe ไว้เพื่อเลิกฟังตอน logout
let unsubscribePatients = null;
let unsubscribeInventory = null;
let unsubscribeRecords = null;

function startDataListeners() {
    unsubscribePatients = listenPatients((list) => {
        appData.patients = list;
        if (currentPage === 'patients' || currentPage === 'scan' || currentPage === 'dashboard') renderApp();
    });
    unsubscribeInventory = listenInventory((list) => {
        appData.inventory = list;
        if (currentPage === 'medicines' || currentPage === 'inventory' || currentPage === 'scan' || currentPage === 'dashboard') renderApp();
    });
    unsubscribeRecords = listenRecords((list) => {
        appData.records = list;
        if (currentPage === 'records' || currentPage === 'dashboard') renderApp();
    });
}

function stopDataListeners() {
    if (unsubscribePatients) unsubscribePatients();
    if (unsubscribeInventory) unsubscribeInventory();
    if (unsubscribeRecords) unsubscribeRecords();
    unsubscribePatients = unsubscribeInventory = unsubscribeRecords = null;
    appData = { patients: [], inventory: [], records: [] };
}

// ==================== LOGIN PAGE (QR) ====================
let loginVideoStream = null;

function renderLogin() {
    const root = document.getElementById('appRoot');
    root.innerHTML = `
        <div class="login-screen">
            <div class="login-box">
                <img src="https://upload.wikimedia.org/wikipedia/th/thumb/d/d7/MED_Phayao.png/250px-MED_Phayao.png" alt="Logo" class="login-logo">
                <h1>Lean</h1>
                <p class="page-subtitle">สแกน QR บัตรพนักงานเพื่อเข้าใช้งาน</p>

                <div id="login-scan-area" class="qr-scan-area">
                    <video id="login-scan-video" autoplay playsinline></video>
                </div>

                <div style="text-align:center; margin-top: 15px;">
                    <button id="loginStartBtn" class="btn-primary" onclick="window.startLoginScan()">
                        <i class="fa-solid fa-camera"></i> เริ่มสแกน QR
                    </button>
                    <button id="loginStopBtn" class="btn-secondary" onclick="window.stopLoginScan()" style="display:none;">
                        <i class="fa-solid fa-stop"></i> หยุด
                    </button>
                </div>

                <div class="login-manual">
                    <p>หรือป้อนรหัส QR ด้วยมือ</p>
                    <input type="text" id="loginManualToken" placeholder="วางค่า QR token ที่นี่">
                    <button class="btn-secondary" onclick="window.submitManualLogin()">เข้าสู่ระบบ</button>
                </div>

                <div id="loginError" class="info-box error" style="display:none; margin-top:15px;"></div>
            </div>
        </div>
    `;
}

function startLoginScan() {
    const video = document.getElementById('login-scan-video');
    const startBtn = document.getElementById('loginStartBtn');
    const stopBtn = document.getElementById('loginStopBtn');

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
            loginVideoStream = stream;
            video.srcObject = stream;
            if (startBtn) startBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-block';
            scanLoginQRCode(video);
        })
        .catch(err => {
            showLoginError('ไม่สามารถเข้าถึงกล้องได้: ' + err.message);
        });
}

function stopLoginScan() {
    const startBtn = document.getElementById('loginStartBtn');
    const stopBtn = document.getElementById('loginStopBtn');
    if (loginVideoStream) {
        loginVideoStream.getTracks().forEach(track => track.stop());
        loginVideoStream = null;
    }
    if (startBtn) startBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';
}

function scanLoginQRCode(video) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    function scan() {
        if (!loginVideoStream) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height);

        if (code) {
            const token = code.data.trim();
            console.log("QR scanned value:", JSON.stringify(token));
            stopLoginScan();
            attemptLogin(token);
        } else {
            requestAnimationFrame(scan);
        }
    }

    scan();
}

function submitManualLogin() {
    const token = document.getElementById('loginManualToken').value.trim();
    if (!token) {
        showLoginError('กรุณาป้อนค่า token');
        return;
    }
    attemptLogin(token);
}

async function attemptLogin(token) {
    try {
        currentUser = await loginWithQR(token);
        await initAppAfterLogin();
    } catch (err) {
        showLoginError(err.message || 'เข้าสู่ระบบไม่สำเร็จ');
    }
}

function showLoginError(message) {
    const box = document.getElementById('loginError');
    if (box) {
        box.textContent = message;
        box.style.display = 'block';
    }
}

async function handleLogout() {
    if (!confirm('ต้องการออกจากระบบใช่หรือไม่?')) return;
    stopDataListeners();
    await logout();
    currentUser = null;
    renderLogin();
}

// ==================== APP SHELL (หลัง login แล้ว) ====================
function renderAppShell() {
    const root = document.getElementById('appRoot');
    root.innerHTML = `
        <header class="app-header">
            <div class="header-content">
                <div class="header-left">
                    <button class="sidebar-toggle" onclick="window.toggleSidebar()"><i class="fa-solid fa-bars"></i></button>
                    <div class="header-logo">
                        <img src="https://upload.wikimedia.org/wikipedia/th/thumb/d/d7/MED_Phayao.png/250px-MED_Phayao.png" alt="Logo">
                        <div class="header-title">
                            <h1>Lean</h1>
                            <p>บันทึกเวชภัณฑ์รายผู้ป่วย</p>
                        </div>
                    </div>
                </div>
                <div class="header-right">
                    <span class="header-user"><i class="fa-solid fa-user"></i> ${currentUser.name} (${currentUser.role})</span>
                    <span class="header-time" id="headerTime"></span>
                    <button class="btn-secondary" onclick="window.handleLogout()"><i class="fa-solid fa-right-from-bracket"></i> ออกจากระบบ</button>
                </div>
            </div>
        </header>

        <div class="app-body">
            <aside class="app-sidebar" id="appSidebar">
                <nav class="sidebar-nav">
                    <button class="sidebar-close" onclick="window.toggleSidebar()"><i class="fa-solid fa-xmark"></i></button>
                    <div class="nav-section">
                        <a href="#" onclick="window.goToPage('dashboard')" class="nav-item active" id="navDashboard">
                            <span class="nav-icon"><i class="fa-solid fa-house"></i></span>
                            <span class="nav-label">แดชบอร์ด</span>
                        </a>
                        <a href="#" onclick="window.goToPage('scan')" class="nav-item" id="navScan">
                            <span class="nav-icon"><i class="fa-solid fa-qrcode"></i></span>
                            <span class="nav-label">สแกน QR</span>
                        </a>
                        <a href="#" onclick="window.goToPage('patients')" class="nav-item" id="navPatients">
                            <span class="nav-icon"><i class="fa-solid fa-user-injured"></i></span>
                            <span class="nav-label">จัดการผู้ป่วย</span>
                        </a>
                        <a href="#" onclick="window.goToPage('medicines')" class="nav-item" id="navMedicines">
                            <span class="nav-icon"><i class="fa-solid fa-pills"></i></span>
                            <span class="nav-label">จัดการเวชภัณฑ์</span>
                        </a>
                        <a href="#" onclick="window.goToPage('inventory')" class="nav-item" id="navInventory">
                            <span class="nav-icon"><i class="fa-solid fa-boxes-stacked"></i></span>
                            <span class="nav-label">ยอดคงคลัง</span>
                        </a>
                        <a href="#" onclick="window.goToPage('records')" class="nav-item" id="navRecords">
                            <span class="nav-icon"><i class="fa-solid fa-clipboard-list"></i></span>
                            <span class="nav-label">บันทึกการใช้</span>
                        </a>
                        ${currentUser.role === 'admin' ? `
                        <a href="#" onclick="window.goToPage('admin')" class="nav-item" id="navAdmin">
                            <span class="nav-icon"><i class="fa-solid fa-user-shield"></i></span>
                            <span class="nav-label">จัดการพนักงาน</span>
                        </a>` : ''}
                    </div>
                </nav>
            </aside>

            <main class="app-main" id="app"></main>
        </div>
    `;

    updateHeaderTime();
    setInterval(updateHeaderTime, 60000);
}

// ==================== MAIN RENDER FUNCTION ====================
function renderApp() {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '';

    if (currentPage === 'dashboard') {
        renderDashboard(app);
    } else if (currentPage === 'patients') {
        renderPatients(app);
    } else if (currentPage === 'medicines') {
        renderMedicines(app);
    } else if (currentPage === 'scan') {
        renderScanPage(app);
    } else if (currentPage === 'inventory') {
        renderInventory(app);
    } else if (currentPage === 'records') {
        renderRecords(app);
    } else if (currentPage === 'admin') {
        renderAdminPage(app);
    }

    updateNavigation();
    attachEventListeners();

    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('appSidebar');
        if (sidebar) {
            sidebar.classList.remove('active');
        }
    }
}

// ==================== ADMIN PAGE: สร้างพนักงาน + QR ====================
function renderAdminPage(container) {
    container.innerHTML = `
        <div class="page-container">
            <div class="page-header">
                <h1><i class="fa-solid fa-user-shield"></i> จัดการพนักงาน (สร้าง QR)</h1>
            </div>
            <div class="page-content">
                <form class="form-section" id="addEmployeeForm">
                    <h2>เพิ่มพนักงานใหม่</h2>
                    <div class="form-row">
                        <div class="form-group">
                            <label>รหัสพนักงาน</label>
                            <input type="text" id="empId" placeholder="เช่น EMP001" required>
                        </div>
                        <div class="form-group">
                            <label>ชื่อ-นามสกุล</label>
                            <input type="text" id="empName" placeholder="ชื่อ-นามสกุล" required>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>ตำแหน่ง</label>
                            <select id="empRole" required>
                                <option value="nurse">พยาบาล (nurse)</option>
                                <option value="pharmacist">เภสัชกร (pharmacist)</option>
                                <option value="admin">ผู้ดูแลระบบ (admin)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>แผนก/วอร์ด</label>
                            <input type="text" id="empDept" placeholder="เช่น วอร์ด 4A">
                        </div>
                    </div>
                    <button type="submit" class="btn-primary"><i class="fa-solid fa-plus"></i> สร้างพนักงาน + QR</button>
                </form>

                <div id="generatedQRBox" class="qr-container" style="display:none; margin-top:25px;">
                    <h2>QR Code พนักงาน (พิมพ์/บันทึกไว้ให้พนักงาน)</h2>
                    <div id="employee-qr-code"></div>
                    <p class="qr-hint" id="employeeQRHint"></p>
                </div>
            </div>
        </div>
    `;
}

async function handleAddEmployee(e) {
    e.preventDefault();
    const employeeId = document.getElementById('empId').value.trim();
    const name = document.getElementById('empName').value.trim();
    const role = document.getElementById('empRole').value;
    const department = document.getElementById('empDept').value.trim();

    try {
        const qrToken = await createEmployeeWithQR({ employeeId, name, role, department });

        const box = document.getElementById('generatedQRBox');
        const qrEl = document.getElementById('employee-qr-code');
        qrEl.innerHTML = '';
        new QRCode(qrEl, {
            text: qrToken,
            width: 220,
            height: 220,
            colorDark: '#5e3db5',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
        document.getElementById('employeeQRHint').textContent = `พนักงาน: ${name} (${employeeId}) — ปริ้น QR นี้ให้พนักงานเก็บไว้ใช้ login`;
        box.style.display = 'block';
        document.getElementById('addEmployeeForm').reset();
    } catch (err) {
        alert(err.message || 'สร้างพนักงานไม่สำเร็จ');
    }
}

// ==================== DASHBOARD PAGE ====================
function renderDashboard(container) {
    container.innerHTML = `
        <div class="page-container">
            <div class="page-header">
                <div>
                    <h1><i class="fa-solid fa-house"></i> แดชบอร์ด</h1>
                    <p class="page-subtitle">สแกนง่าย บันทึกไว ข้อมูลครบ ยอดคลังตรง</p>
                </div>
            </div>

            <div class="page-content">
                <div class="dashboard-grid">
                    <div class="dashboard-right" style="grid-column: 1 / -1;">
                        <div class="stats-container">
                            <div class="stat-card">
                                <div class="stat-icon"><i class="fa-solid fa-user-injured"></i></div>
                                <div class="stat-number">${appData.patients.length}</div>
                                <div class="stat-label">ผู้ป่วยทั้งหมด</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon"><i class="fa-solid fa-pills"></i></div>
                                <div class="stat-number">${appData.inventory.length}</div>
                                <div class="stat-label">รายการยา</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-icon"><i class="fa-solid fa-clipboard-list"></i></div>
                                <div class="stat-number">${appData.records.length}</div>
                                <div class="stat-label">บันทึกทั้งหมด</div>
                            </div>
                        </div>

                        <div class="quick-actions">
                            <button class="quick-action-card" onclick="window.goToPage('scan')">
                                <i class="fa-solid fa-qrcode"></i>
                                <span>สแกนเวชภัณฑ์</span>
                            </button>
                            <button class="quick-action-card" onclick="window.goToPage('patients')">
                                <i class="fa-solid fa-user-injured"></i>
                                <span>จัดการผู้ป่วย</span>
                            </button>
                            <button class="quick-action-card" onclick="window.goToPage('medicines')">
                                <i class="fa-solid fa-pills"></i>
                                <span>จัดการเวชภัณฑ์</span>
                            </button>
                            <button class="quick-action-card" onclick="window.goToPage('inventory')">
                                <i class="fa-solid fa-boxes-stacked"></i>
                                <span>ยอดคงคลัง</span>
                            </button>
                            <button class="quick-action-card" onclick="window.goToPage('records')">
                                <i class="fa-solid fa-clipboard-list"></i>
                                <span>บันทึกการใช้</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ==================== PATIENTS PAGE ====================
function renderPatients(container) {
    container.innerHTML = `
        <div class="page-container">
            <div class="page-header">
                <h1><i class="fa-solid fa-user-injured"></i> จัดการผู้ป่วย</h1>
            </div>

            <div class="page-content">
                <form class="form-section" id="addPatientForm">
                    <h2>เพิ่มผู้ป่วยใหม่</h2>
                    <div class="form-row">
                        <div class="form-group">
                            <label>เลขที่บัตรผู้ป่วย (HN)</label>
                            <input type="text" id="patientHN" placeholder="เช่น HN001" required>
                        </div>
                        <div class="form-group">
                            <label>ชื่อผู้ป่วย</label>
                            <input type="text" id="patientName" placeholder="ชื่อ-นามสกุล" required>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>หอผู้ป่วย</label>
                            <input type="text" id="patientWard" placeholder="เช่น A, B, C" required>
                        </div>
                        <div class="form-group">
                            <label>เตียงที่</label>
                            <input type="text" id="patientBed" placeholder="เช่น 101, 205" required>
                        </div>
                    </div>
                    <button type="submit" class="btn-primary"><i class="fa-solid fa-plus"></i> เพิ่มผู้ป่วย</button>
                </form>

                <div class="list-section">
                    <h2><i class="fa-solid fa-list"></i> รายชื่อผู้ป่วย</h2>
                    <div id="patientList">
                        ${appData.patients.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ไม่มีข้อมูลผู้ป่วย</p>' : ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    const patientList = container.querySelector('#patientList');
    if (appData.patients.length > 0) {
        patientList.innerHTML = appData.patients.map(patient => `
            <div class="list-item">
                <div class="item-info">
                    <div class="item-title">${patient.name}</div>
                    <div class="item-detail">เลขที่บัตร: ${patient.hn} | หอ ${patient.ward} | เตียง ${patient.bed}</div>
                </div>
                <button class="btn-delete" onclick="window.deletePatient('${patient.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>
            </div>
        `).join('');
    }
}

function renderMedicines(container) {
    container.innerHTML = `
        <div class="page-container">
            <div class="page-header">
                <h1><i class="fa-solid fa-pills"></i> จัดการเวชภัณฑ์</h1>
            </div>

            <div class="page-content">
                <form class="form-section" id="addMedicineForm">
                    <h2>เพิ่มเวชภัณฑ์ใหม่</h2>
                    <div class="form-row">
                        <div class="form-group">
                            <label>รหัสเวชภัณฑ์</label>
                            <input type="text" id="medicineCode" placeholder="เช่น MED001" required>
                        </div>
                        <div class="form-group">
                            <label>ชื่อเวชภัณฑ์</label>
                            <input type="text" id="medicineName" placeholder="เช่น Paracetamol 500mg" required>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>จำนวนคงเหลือ</label>
                            <input type="number" id="medicineStock" placeholder="0" min="0" required>
                        </div>
                        <div class="form-group">
                            <label>หน่วยนับ</label>
                            <select id="medicineUnit" required>
                                <option value="">-- เลือก --</option>
                                <option value="เม็ด">เม็ด</option>
                                <option value="ขวด">ขวด</option>
                                <option value="ห่อ">ห่อ</option>
                                <option value="กระปุก">กระปุก</option>
                                <option value="ชุด">ชุด</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>จำนวนเตือนใหม่</label>
                            <input type="number" id="medicineReorder" placeholder="0" min="0" required>
                        </div>
                    </div>
                    <button type="submit" class="btn-primary"><i class="fa-solid fa-plus"></i> เพิ่มเวชภัณฑ์</button>
                </form>

                <div class="list-section">
                    <h2><i class="fa-solid fa-list"></i> รายการเวชภัณฑ์</h2>
                    <div id="medicineList">
                        ${appData.inventory.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ไม่มีรายการเวชภัณฑ์</p>' : ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    const medicineList = container.querySelector('#medicineList');
    if (appData.inventory.length > 0) {
        medicineList.innerHTML = appData.inventory.map(medicine => `
            <div class="list-item" style="${medicine.stock <= medicine.reorder ? 'background: #fef2f2;' : ''}">
                <div class="item-info">
                    <div class="item-title">${medicine.name}</div>
                    <div class="item-detail">รหัส: ${medicine.code} | คงเหลือ: ${medicine.stock} ${medicine.unit}</div>
                    ${medicine.stock <= medicine.reorder ? '<div style="color: #ef4444; margin-top: 5px; font-weight: 700;"><i class="fa-solid fa-triangle-exclamation"></i> ต่ำกว่าเตือนใหม่</div>' : ''}
                </div>
                <button class="btn-delete" onclick="window.deleteMedicine('${medicine.id}')"><i class="fa-solid fa-trash"></i> ลบ</button>
            </div>
        `).join('');
    }
}

// ==================== SCAN PAGE ====================
function renderScanPage(container) {
    container.innerHTML = `
        <div class="page-container">
            <div class="page-header">
                <h1><i class="fa-solid fa-qrcode"></i> สแกนเวชภัณฑ์</h1>
                <button class="btn-back" onclick="window.goToPage('dashboard')"><i class="fa-solid fa-arrow-left"></i> กลับ</button>
            </div>

            <div class="page-content">
                <div class="scan-mode-toggle">
                    <button class="mode-btn active" onclick="window.switchScanMode('camera')"><i class="fa-solid fa-camera"></i> กล้อง</button>
                    <button class="mode-btn" onclick="window.switchScanMode('manual')"><i class="fa-solid fa-keyboard"></i> พิมพ์ด้วยมือ</button>
                </div>

                <div id="cameraMode" class="scan-mode active">
                    <div id="qr-scan-area" class="qr-scan-area">
                        <video id="scan-video" autoplay playsinline></video>
                    </div>
                    <p class="page-subtitle" style="text-align:center;">วาง QR Code ให้อยู่ในกรอบกล้องเพื่อสแกน</p>
                    <div style="text-align:center;">
                        <button id="startScanBtn" class="btn-primary" onclick="window.startScanning()"><i class="fa-solid fa-play"></i> เริ่มสแกน</button>
                        <button id="stopScanBtn" class="btn-secondary" onclick="window.stopScanning()" style="display:none;"><i class="fa-solid fa-stop"></i> หยุดสแกน</button>
                    </div>
                </div>

                <div id="manualMode" class="scan-mode">
                    <div class="form-group">
                        <label>ป้อนรหัสเวชภัณฑ์</label>
                        <input type="text" id="medicineCodeInput" placeholder="เช่น MED001">
                    </div>
                    <button class="btn-primary" onclick="window.searchByCode()"><i class="fa-solid fa-magnifying-glass"></i> ค้นหา</button>
                </div>

                <div id="recordForm" class="form-section" style="display:none; margin-top: 25px;">
                    <h2><i class="fa-solid fa-clipboard-list"></i> บันทึกการใช้เวชภัณฑ์</h2>
                    <div class="form-group">
                        <label>เวชภัณฑ์</label>
                        <input type="text" id="recordMedicine" readonly>
                    </div>
                    <div class="form-group">
                        <label>ผู้ป่วย</label>
                        <select id="recordPatient" required>
                            <option value="">-- เลือกผู้ป่วย --</option>
                            ${appData.patients.map(p => `<option value="${p.name}">${p.name} (${p.hn})</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>จำนวนที่ใช้</label>
                        <input type="number" id="recordQuantity" min="1" value="1" required>
                    </div>
                    <button class="btn-primary" onclick="window.submitRecord()"><i class="fa-solid fa-check"></i> บันทึก</button>
                    <button class="btn-secondary" onclick="window.cancelRecord()"><i class="fa-solid fa-xmark"></i> ยกเลิก</button>
                </div>

                <div id="scanResult" class="info-box" style="display:none; margin-top: 20px;"></div>
            </div>
        </div>
    `;
}

function renderInventory(container) {
    container.innerHTML = `
        <div class="page-container">
            <div class="page-header">
                <h1><i class="fa-solid fa-boxes-stacked"></i> ยอดคงคลัง</h1>
            </div>

            <div class="page-content">
                <div class="list-section">
                    <div class="inventory-grid" id="inventoryList">
                        ${appData.inventory.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ไม่มีรายการ</p>' : ''}
                    </div>
                </div>
            </div>
        </div>
    `;

    const inventoryList = container.querySelector('#inventoryList');
    if (appData.inventory.length > 0) {
        inventoryList.innerHTML = appData.inventory.map(item => `
            <div class="inventory-card ${item.stock <= item.reorder ? 'low-stock' : ''}">
                <div class="inventory-name">${item.name}</div>
                <div class="inventory-code">รหัส: ${item.code}</div>
                <div class="inventory-row">
                    <span>จำนวนคงเหลือ:</span>
                    <span style="font-weight: 700;">${item.stock} ${item.unit}</span>
                </div>
                <div class="inventory-row">
                    <span>เตือนใหม่:</span>
                    <span>${item.reorder}</span>
                </div>
                ${item.stock <= item.reorder ? '<div style="color: #ef4444; margin-top: 10px; font-weight: 700;"><i class="fa-solid fa-triangle-exclamation"></i> ต้องสั่งสินค้า</div>' : ''}
            </div>
        `).join('');
    }
}

function renderRecords(container) {
    container.innerHTML = `
        <div class="page-container">
            <div class="page-header">
                <h1><i class="fa-solid fa-clipboard-list"></i> บันทึกการใช้เวชภัณฑ์</h1>
            </div>

            <div class="page-content">
                <div class="records-grid" id="recordsList">
                    ${appData.records.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ไม่มีบันทึก</p>' : ''}
                </div>
            </div>
        </div>
    `;

    const recordsList = container.querySelector('#recordsList');
    if (appData.records.length > 0) {
        recordsList.innerHTML = appData.records.map(record => `
            <div class="record-card">
                <div class="record-date">${formatTimestamp(record.createdAt)}</div>
                <div class="record-row">
                    <span class="label">ผู้ป่วย:</span>
                    <span>${record.patientName}</span>
                </div>
                <div class="record-row">
                    <span class="label">เวชภัณฑ์:</span>
                    <span>${record.medicineName}</span>
                </div>
                <div class="record-row">
                    <span class="label">จำนวน:</span>
                    <span style="font-weight: 700;">${record.quantity}</span>
                </div>
                <div class="record-row">
                    <span class="label">บันทึกโดย:</span>
                    <span>${record.performedByName || '-'}</span>
                </div>
            </div>
        `).join('');
    }
}

// ==================== PATIENT CRUD ====================
async function addPatient(e) {
    e.preventDefault();
    const hn = document.getElementById('patientHN').value;
    const name = document.getElementById('patientName').value;
    const ward = document.getElementById('patientWard').value;
    const bed = document.getElementById('patientBed').value;

    if (hn && name && ward && bed) {
        try {
            await addPatientDoc({ hn, name, ward, bed });
            goToPage('patients');
        } catch (err) {
            alert('เพิ่มผู้ป่วยไม่สำเร็จ: ' + err.message);
        }
    }
}

async function deletePatient(id) {
    if (confirm('ต้องการลบผู้ป่วยนี้ใช่หรือไม่?')) {
        try {
            await deletePatientDoc(id);
        } catch (err) {
            alert('ลบไม่สำเร็จ: ' + err.message);
        }
    }
}

// ==================== MEDICINE CRUD ====================
async function addMedicine(e) {
    e.preventDefault();
    const code = document.getElementById('medicineCode').value;
    const name = document.getElementById('medicineName').value;
    const stock = parseInt(document.getElementById('medicineStock').value);
    const unit = document.getElementById('medicineUnit').value;
    const reorder = parseInt(document.getElementById('medicineReorder').value);

    if (code && name && unit && !isNaN(stock) && !isNaN(reorder)) {
        try {
            await addMedicineDoc({ code, name, stock, unit, reorder });
            goToPage('medicines');
        } catch (err) {
            alert('เพิ่มเวชภัณฑ์ไม่สำเร็จ: ' + err.message);
        }
    }
}

async function deleteMedicine(id) {
    if (confirm('ต้องการลบเวชภัณฑ์นี้ใช่หรือไม่?')) {
        try {
            await deleteMedicineDoc(id);
        } catch (err) {
            alert('ลบไม่สำเร็จ: ' + err.message);
        }
    }
}

// ==================== QR CODE SCANNING (เวชภัณฑ์) ====================
let videoStream = null;
let currentScannedMedicine = null;

function switchScanMode(mode) {
    const cameraMode = document.getElementById('cameraMode');
    const manualMode = document.getElementById('manualMode');
    const modeBtns = document.querySelectorAll('.mode-btn');

    modeBtns.forEach(btn => btn.classList.remove('active'));

    if (mode === 'camera') {
        if (cameraMode) cameraMode.style.display = 'block';
        if (manualMode) manualMode.style.display = 'none';
        document.querySelector('[onclick="window.switchScanMode(\'camera\')"]').classList.add('active');
    } else {
        if (cameraMode) cameraMode.style.display = 'none';
        if (manualMode) manualMode.style.display = 'block';
        document.querySelector('[onclick="window.switchScanMode(\'manual\')"]').classList.add('active');
    }
}

function startScanning() {
    const video = document.getElementById('scan-video');
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
            videoStream = stream;
            video.srcObject = stream;
            if (startBtn) startBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-block';
            scanQRCode(video);
        })
        .catch(err => {
            alert('ไม่สามารถเข้าถึงกล้องได้: ' + err.message);
        });
}

function stopScanning() {
    const startBtn = document.getElementById('startScanBtn');
    const stopBtn = document.getElementById('stopScanBtn');

    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    if (startBtn) startBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';
}

function scanQRCode(video) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    function scan() {
        if (!videoStream) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height);

        if (code) {
            const medicineCode = code.data.trim();
            stopScanning();
            searchByCode(medicineCode);
        } else {
            requestAnimationFrame(scan);
        }
    }

    scan();
}

function searchByCode(codeParam) {
    const code = codeParam || document.getElementById('medicineCodeInput').value;
    const medicine = appData.inventory.find(m => m.code === code);

    const recordForm = document.getElementById('recordForm');
    const scanResult = document.getElementById('scanResult');

    if (medicine) {
        currentScannedMedicine = medicine;
        if (recordForm) {
            document.getElementById('recordMedicine').value = medicine.name + ' (' + medicine.code + ')';
            recordForm.style.display = 'block';
        }
        if (scanResult) {
            scanResult.innerHTML = `<i class="fa-solid fa-circle-check"></i> พบเวชภัณฑ์: ${medicine.name}`;
            scanResult.className = 'info-box success';
            scanResult.style.display = 'block';
        }
    } else {
        currentScannedMedicine = null;
        if (recordForm) recordForm.style.display = 'none';
        if (scanResult) {
            scanResult.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ไม่พบเวชภัณฑ์ที่มีรหัส: ${code}`;
            scanResult.className = 'info-box error';
            scanResult.style.display = 'block';
        }
    }
}

async function submitRecord() {
    const patientName = document.getElementById('recordPatient').value;
    const quantity = parseInt(document.getElementById('recordQuantity').value);

    if (!patientName || !currentScannedMedicine || !quantity) {
        alert('กรุณากรอกข้อมูลให้ครบถ้วน');
        return;
    }

    try {
        await submitRecordDoc({
            medicineId: currentScannedMedicine.id,
            medicineName: currentScannedMedicine.name,
            patientName,
            quantity,
            // accountability: บันทึกว่าใครเป็นคนทำรายการนี้ (มาจาก session ที่ login ด้วย QR เท่านั้น)
            performedByUid: currentUser ? currentUser.uid : null,
            performedByEmployeeId: currentUser ? currentUser.employeeId : null,
            performedByName: currentUser ? currentUser.name : null
        });
        alert('บันทึกการใช้เวชภัณฑ์สำเร็จ');
        cancelRecord();
        goToPage('dashboard');
    } catch (err) {
        alert('บันทึกไม่สำเร็จ: ' + err.message);
    }
}

function cancelRecord() {
    const recordForm = document.getElementById('recordForm');
    const scanResult = document.getElementById('scanResult');
    if (recordForm) recordForm.style.display = 'none';
    if (scanResult) scanResult.style.display = 'none';
    const input = document.getElementById('medicineCodeInput');
    if (input) input.value = '';
    currentScannedMedicine = null;
}

// ==================== PAGE NAVIGATION ====================
function goToPage(page) {
    currentPage = page;
    renderApp();
}

// ==================== EVENT LISTENERS ====================
function attachEventListeners() {
    const addPatientForm = document.getElementById('addPatientForm');
    const addMedicineForm = document.getElementById('addMedicineForm');
    const addEmployeeForm = document.getElementById('addEmployeeForm');

    if (addPatientForm) {
        addPatientForm.addEventListener('submit', addPatient);
    }
    if (addMedicineForm) {
        addMedicineForm.addEventListener('submit', addMedicine);
    }
    if (addEmployeeForm) {
        addEmployeeForm.addEventListener('submit', handleAddEmployee);
    }
}

// ==================== INIT หลัง login สำเร็จ ====================
async function initAppAfterLogin() {
    renderAppShell();
    startDataListeners();
    renderApp();
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    currentUser = await restoreSession();
    if (currentUser) {
        await initAppAfterLogin();
    } else {
        renderLogin();
    }
});

// ==================== เปิดให้ inline onclick="" เรียกใช้ได้ (เพราะไฟล์นี้เป็น module) ====================
window.toggleSidebar = toggleSidebar;
window.goToPage = goToPage;
window.deletePatient = deletePatient;
window.deleteMedicine = deleteMedicine;
window.switchScanMode = switchScanMode;
window.startScanning = startScanning;
window.stopScanning = stopScanning;
window.searchByCode = searchByCode;
window.submitRecord = submitRecord;
window.cancelRecord = cancelRecord;
window.startLoginScan = startLoginScan;
window.stopLoginScan = stopLoginScan;
window.submitManualLogin = submitManualLogin;
window.handleLogout = handleLogout;

// เปิดให้เรียกจาก Browser Console ได้ (ใช้สร้าง admin คนแรกครั้งเดียว ตอนยังไม่มีใคร login ในระบบเลย)
// วิธีใช้: เปิด DevTools Console แล้วพิมพ์
//   await window.createEmployeeWithQR({employeeId:"ADMIN001", name:"ชื่อแอดมิน", role:"admin", department:"IT"})
// จะได้ token คืนมา เอาไปวางในช่อง "ป้อนรหัส QR ด้วยมือ" หน้า Login เพื่อเข้าระบบครั้งแรก
window.createEmployeeWithQR = createEmployeeWithQR;