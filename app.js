// Lean QR Code Patient-Bed Tracking System (Multi-Items + Search Component)
// Login: Email/Password | สแกนเตียงผู้ป่วย: QR Code จากชื่อผู้ป่วย

import {
  restoreSession, loginWithEmail, logout, createEmployee,
  toggleEmployeeActive, deleteEmployeeDoc
} from "./auth.js";
import {
  listenPatients, addPatientDoc, deletePatientDoc,
  listenInventory, addMedicineDoc, deleteMedicineDoc,
  listenRecords, submitRecordDoc,
  listenEmployees
} from "./data.js";

// ตรวจสอบว่าเบราว์เซอร์รองรับกล้อง live scan จริงหรือไม่
var supportsLiveCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

var currentPage = 'dashboard';
var currentUser = null;
var appData = { patients: [], inventory: [], records: [], employees: [] };
var videoStream = null;
var currentScannedPatient = null; 
var unsubscribePatients = null;
var unsubscribeInventory = null;
var unsubscribeRecords = null;
var unsubscribeEmployees = null;

// ==================== INIT (เรียกครั้งเดียว) ====================
async function initApp() {
    var user = await restoreSession();
    if (user) {
        currentUser = user;
        renderAppShell();
        startDataListeners();
        renderApp();
    } else {
        renderLogin();
    }
}
initApp();

// ==================== SECURITY HELPER: กัน XSS ====================
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==================== NAVIGATION ====================
function toggleSidebar() {
    var sidebar = document.getElementById('appSidebar');
    if (sidebar) sidebar.classList.toggle('active');
}

function updateNavigation() {
    document.querySelectorAll('.nav-item').forEach(function(item) { item.classList.remove('active'); });
    var pageMap = { dashboard:'navDashboard', scan:'navScan', patients:'navPatients', medicines:'navMedicines', inventory:'navInventory', records:'navRecords', admin:'navAdmin' };
    var navId = pageMap[currentPage];
    if (navId && document.getElementById(navId)) document.getElementById(navId).classList.add('active');
}

function updateHeaderTime() {
    var el = document.getElementById('headerTime');
    if (!el) return;
    var now = new Date();
    el.textContent = now.toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' }) + ' ' +
                     now.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
}

function formatTimestamp(ts) {
    if (!ts) return 'กำลังบันทึก...';
    var d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
    return d.toLocaleString('th-TH', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

// ==================== DATA LISTENERS ====================
function startDataListeners() {
    unsubscribePatients = listenPatients(function(list) {
        appData.patients = list;
        if (currentPage === 'patients' || currentPage === 'scan' || currentPage === 'dashboard') renderApp();
    });
    unsubscribeInventory = listenInventory(function(list) {
        appData.inventory = list;
        if (currentPage === 'medicines' || currentPage === 'inventory' || currentPage === 'scan' || currentPage === 'dashboard') renderApp();
    });
    unsubscribeRecords = listenRecords(function(list) {
        appData.records = list;
        if (currentPage === 'records' || currentPage === 'dashboard') renderApp();
    });
    if (currentUser && currentUser.admin === true) {
        unsubscribeEmployees = listenEmployees(function(list) {
            appData.employees = list;
            if (currentPage === 'admin') renderApp();
        });
    }
}

function stopDataListeners() {
    if (unsubscribePatients) unsubscribePatients();
    if (unsubscribeInventory) unsubscribeInventory();
    if (unsubscribeRecords) unsubscribeRecords();
    if (unsubscribeEmployees) unsubscribeEmployees();
    unsubscribePatients = unsubscribeInventory = unsubscribeRecords = unsubscribeEmployees = null;
    appData = { patients: [], inventory: [], records: [], employees: [] };
}

// ==================== สแกนผู้ป่วยจากรูปถ่าย (Fallback) ====================
var MAX_DECODE_DIMENSION = 1600;

function decodeQRFromFile(file) {
    return new Promise(function(resolve, reject) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function() {
            var scale = Math.min(1, MAX_DECODE_DIMENSION / Math.max(img.width, img.height));
            var w = Math.round(img.width * scale);
            var h = Math.round(img.height * scale);

            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            try {
                var imageData = ctx.getImageData(0, 0, w, h);
                var code = jsQR(imageData.data, w, h);
                if (code) resolve(code.data.trim());
                else reject(new Error('ไม่พบ QR ในรูป กรุณาถ่ายใหม่ให้ชัดเจนและอยู่กึ่งกลางภาพ'));
            } catch (err) {
                reject(new Error('ประมวลผลรูปไม่สำเร็จ: ' + err.message));
            }
        };
        img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('โหลดรูปไม่สำเร็จ ลองถ่ายใหม่อีกครั้ง')); };
        img.src = url;
    });
}

async function handleIOSMedCapture(event) {
    var file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    var el = document.getElementById('scanResult');
    if (el) { el.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังอ่าน QR จากรูปภาพ...'; el.className = 'info-box'; el.style.display = 'block'; }

    try {
        var code = await decodeQRFromFile(file);
        searchByCode(code);
    } catch (err) {
        if (el) { el.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> ' + escapeHtml(err.message); el.className = 'info-box error'; el.style.display = 'block'; }
    }
}

// ==================== LOGIN (Email/Password) ====================
function renderLogin() {
    var root = document.getElementById('appRoot');
    root.innerHTML =
        '<div class="login-screen"><div class="login-box">' +
        '<div class="login-logo-wrapper"><img src="https://upload.wikimedia.org/wikipedia/th/thumb/d/d7/MED_Phayao.png/250px-MED_Phayao.png" alt="Logo" class="login-logo"></div>' +
        '<h1 class="login-brand">Lean</h1>' +
        '<p class="login-subtitle">ระบบบันทึกเวชภัณฑ์รายผู้ป่วย</p>' +
        
        '<div class="form-group login-group">' +
        '<label><i class="fa-solid fa-envelope"></i> อีเมลผู้ใช้งาน</label>' +
        '<div class="input-with-icon">' +
        '<input type="email" id="loginEmail" placeholder="username@hospital.com">' +
        '</div></div>' +
        
        '<div class="form-group login-group">' +
        '<label><i class="fa-solid fa-lock"></i> รหัสผ่าน</label>' +
        '<div class="input-with-icon">' +
        '<input type="password" id="loginPassword" placeholder="••••••">' +
        '</div></div>' +
        
        '<button class="btn-login-submit" onclick="window.submitEmailLogin()">' +
        '<i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบ</button>' +
        '<div id="loginError" class="info-box error" style="display:none;margin-top:15px"></div>' +
        '</div></div>';

    setTimeout(function() {
        var pwInput = document.getElementById('loginPassword');
        if (pwInput) pwInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') window.submitEmailLogin(); });
        var emailInput = document.getElementById('loginEmail');
        if (emailInput) emailInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('loginPassword').focus(); });
    }, 100);
}

async function submitEmailLogin() {
    var email = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;
    var errorBox = document.getElementById('loginError');

    if (!email || !password) {
        if (errorBox) { errorBox.textContent = 'กรุณากรอกอีเมลและรหัสผ่าน'; errorBox.style.display = 'block'; }
        return;
    }

    var btn = document.querySelector('.login-box .btn-primary');
    if (btn) { btn.textContent = 'กำลังเข้าสู่ระบบ...'; btn.disabled = true; }

    try {
        currentUser = await loginWithEmail(email, password);
        await initAppAfterLogin();
    } catch (err) {
        var msg = err.message || 'เข้าสู่ระบบไม่สำเร็จ';
        if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
            msg = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
        } else if (msg.includes('invalid-email')) {
            msg = 'รูปแบบอีเมลไม่ถูกต้อง';
        } else if (msg.includes('too-many-requests')) {
            msg = 'พยายามเข้าสู่ระบบมากเกินไป กรุณารอสักครู่';
        }
        if (errorBox) { errorBox.textContent = msg; errorBox.style.display = 'block'; }
        if (btn) { btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบ'; btn.disabled = false; }
    }
}

async function handleLogout() {
    if (!confirm('ต้องการออกจากระบบใช่หรือไม่?')) return;
    stopDataListeners();
    await logout();
    currentUser = null;
    renderLogin();
}

// ==================== APP SHELL ====================
function renderAppShell() {
    var root = document.getElementById('appRoot');
    var userName = (currentUser && currentUser.name) ? currentUser.name : 'ผู้ใช้งาน';
    var userRole = (currentUser && currentUser.role) ? currentUser.role : 'user';
    var adminMenu = (currentUser && currentUser.admin === true)
        ? '<a href="#" onclick="window.goToPage(\'admin\')" class="nav-item" id="navAdmin"><span class="nav-icon"><i class="fa-solid fa-user-shield"></i></span><span class="nav-label">จัดการพนักงาน</span></a>'
        : '';

    root.innerHTML =
        '<header class="app-header"><div class="header-content">' +
        '<div class="header-left"><button class="sidebar-toggle" onclick="window.toggleSidebar()"><i class="fa-solid fa-bars"></i></button>' +
        '<div class="header-logo"><img src="https://upload.wikimedia.org/wikipedia/th/thumb/d/d7/MED_Phayao.png/250px-MED_Phayao.png" alt="Logo">' +
        '<div class="header-title"><h1>Lean</h1><p>บันทึกเวชภัณฑ์รายผู้ป่วย</p></div></div></div>' +
        '<div class="header-right"><span class="header-user"><i class="fa-solid fa-user"></i> ' + escapeHtml(userName) + ' (' + escapeHtml(userRole) + ')</span>' +
        '<span class="header-time" id="headerTime"></span>' +
        '<button class="btn-secondary" onclick="window.handleLogout()"><i class="fa-solid fa-right-from-bracket"></i> ออกจากระบบ</button></div></div></header>' +
        '<div class="app-body"><aside class="app-sidebar" id="appSidebar"><nav class="sidebar-nav">' +
        '<button class="sidebar-close" onclick="window.toggleSidebar()"><i class="fa-solid fa-xmark"></i></button>' +
        '<div class="nav-section">' +
        '<a href="#" onclick="window.goToPage(\'dashboard\')" class="nav-item active" id="navDashboard"><span class="nav-icon"><i class="fa-solid fa-house"></i></span><span class="nav-label">แดชบอร์ด</span></a>' +
        '<a href="#" onclick="window.goToPage(\'scan\')" class="nav-item" id="navScan"><span class="nav-icon"><i class="fa-solid fa-qrcode"></i></span><span class="nav-label">สแกน QR เตียง</span></a>' + 
        '<a href="#" onclick="window.goToPage(\'patients\')" class="nav-item" id="navPatients"><span class="nav-icon"><i class="fa-solid fa-user-injured"></i></span><span class="nav-label">จัดการผู้ป่วย</span></a>' +
        '<a href="#" onclick="window.goToPage(\'medicines\')" class="nav-item" id="navMedicines"><span class="nav-icon"><i class="fa-solid fa-pills"></i></span><span class="nav-label">จัดการเวชภัณฑ์</span></a>' +
        '<a href="#" onclick="window.goToPage(\'inventory\')" class="nav-item" id="navInventory"><span class="nav-icon"><i class="fa-solid fa-boxes-stacked"></i></span><span class="nav-label">ยอดคงคลัง</span></a>' +
        '<a href="#" onclick="window.goToPage(\'records\')" class="nav-item" id="navRecords"><span class="nav-icon"><i class="fa-solid fa-clipboard-list"></i></span><span class="nav-label">บันทึกการใช้</span></a>' +
        adminMenu + '</div></nav></aside><main class="app-main" id="app"></main></div>';

    updateHeaderTime();
    setInterval(updateHeaderTime, 60000);
}

// ==================== PAGES ====================
function renderApp() {
    var app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = '';

    if (currentPage === 'admin' && !(currentUser && currentUser.admin === true)) {
        currentPage = 'dashboard';
    }

    if (currentPage === 'dashboard') renderDashboard(app);
    else if (currentPage === 'patients') renderPatients(app);
    else if (currentPage === 'medicines') renderMedicines(app);
    else if (currentPage === 'scan') renderScanPage(app);
    else if (currentPage === 'inventory') renderInventory(app);
    else if (currentPage === 'records') renderRecords(app);
    else if (currentPage === 'admin') renderAdminPage(app);
    updateNavigation();
    attachEventListeners();
    if (window.innerWidth <= 768) {
        var sidebar = document.getElementById('appSidebar');
        if (sidebar) sidebar.classList.remove('active');
    }
}

function renderDashboard(container) {
    container.innerHTML =
        '<div class="page-container"><div class="page-header"><div>' +
        '<h1><i class="fa-solid fa-house"></i> แดชบอร์ด</h1></div></div>' + 
        '<div class="page-content"><div class="dashboard-grid"><div class="dashboard-right" style="grid-column:1/-1">' +
        '<div class="stats-container">' +
        '<div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-user-injured"></i></div><div class="stat-number">' + appData.patients.length + '</div><div class="stat-label">ผู้ป่วยทั้งหมด</div></div>' +
        '<div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-pills"></i></div><div class="stat-number">' + appData.inventory.length + '</div><div class="stat-label">รายการยา</div></div>' +
        '<div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-clipboard-list"></i></div><div class="stat-number">' + appData.records.length + '</div><div class="stat-label">บันทึกทั้งหมด</div></div>' +
        '</div><div class="quick-actions">' +
        '<button class="quick-action-card" onclick="window.goToPage(\'scan\')"><i class="fa-solid fa-qrcode"></i><span>สแกนเตียงผู้ป่วย</span></button>' +
        '<button class="quick-action-card" onclick="window.goToPage(\'patients\')"><i class="fa-solid fa-user-injured"></i><span>จัดการผู้ป่วย</span></button>' +
        '<button class="quick-action-card" onclick="window.goToPage(\'medicines\')"><i class="fa-solid fa-pills"></i><span>จัดการเวชภัณฑ์</span></button>' +
        '<button class="quick-action-card" onclick="window.goToPage(\'inventory\')"><i class="fa-solid fa-boxes-stacked"></i><span>ยอดคงคลัง</span></button>' +
        '<button class="quick-action-card" onclick="window.goToPage(\'records\')"><i class="fa-solid fa-clipboard-list"></i><span>บันทึกการใช้</span></button>' +
        '</div></div></div></div></div>';
}

function renderPatients(container) {
    var items = appData.patients.map(function(p) {
        return '<div class="list-item"><div class="item-info"><div class="item-title">' + escapeHtml(p.name) + '</div>' +
            '<div class="item-detail">หอ ' + escapeHtml(p.ward) + ' | เตียง ' + escapeHtml(p.bed) + '</div></div>' +
            '<div style="display:flex;gap:8px">' +
            '<button class="btn-secondary" onclick="window.showQRCode(\'' + escapeHtml(p.name).replace(/'/g, "\\'") + '\', \'' + escapeHtml(p.name).replace(/'/g, "\\'") + '\')"><i class="fa-solid fa-qrcode"></i> เตียง QR</button>' + 
            '<button class="btn-delete" onclick="window.deletePatient(\'' + p.id + '\')"><i class="fa-solid fa-trash"></i> ลบ</button></div></div>';
    }).join('');
    container.innerHTML =
        '<div class="page-container"><div class="page-header"><h1><i class="fa-solid fa-user-injured"></i> จัดการผู้ป่วย</h1>' +
        (appData.patients.length > 0 ? '<button class="btn-primary" onclick="window.printAllQRCodes()"><i class="fa-solid fa-print"></i> พิมพ์ QR ทั้งหมด</button>' : '') +
        '</div>' +
        '<div class="page-content"><form class="form-section" id="addPatientForm"><h2>เพิ่มผู้ป่วยใหม่</h2>' +
        '<div class="form-row">' +
        '<div class="form-group" style="grid-column: 1 / -1"><label>ชื่อผู้ป่วย</label><input type="text" id="patientName" placeholder="ชื่อ-นามสกุล" required></div></div>' +
        '<div class="form-row"><div class="form-group"><label>หอผู้ป่วย</label><input type="text" id="patientWard" placeholder="เช่น A, B, C" required></div>' +
        '<div class="form-group"><label>เตียงที่</label><input type="text" id="patientBed" placeholder="เช่น 101, 205" required></div></div>' +
        '<button type="submit" class="btn-primary"><i class="fa-solid fa-plus"></i> เพิ่มผู้ป่วย</button></form>' +
        '<div class="list-section"><h2><i class="fa-solid fa-list"></i> รายชื่อผู้ป่วย</h2>' +
        '<div id="patientList">' + (appData.patients.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ไม่มีข้อมูลผู้ป่วย</p>' : items) + '</div>' +
        '</div></div></div>';
}

function renderMedicines(container) {
    var items = appData.inventory.map(function(m) {
        return '<div class="list-item" style="' + (m.stock <= m.reorder ? 'background:#fef2f2' : '') + '">' +
            '<div class="item-info"><div class="item-title">' + escapeHtml(m.name) + '</div>' +
            '<div class="item-detail">คงเหลือ: ' + m.stock + ' ' + escapeHtml(m.unit) + '</div>' +
            (m.stock <= m.reorder ? '<div style="color:#ef4444;margin-top:5px;font-weight:700"><i class="fa-solid fa-triangle-exclamation"></i> ต่ำกว่าเตือนใหม่</div>' : '') +
            '</div><div style="display:flex;gap:8px">' +
            '<button class="btn-delete" onclick="window.deleteMedicine(\'' + m.id + '\')"><i class="fa-solid fa-trash"></i> ลบ</button></div></div>';
    }).join('');
    container.innerHTML =
        '<div class="page-container"><div class="page-header"><h1><i class="fa-solid fa-pills"></i> จัดการเวชภัณฑ์</h1></div>' +
        '<div class="page-content"><form class="form-section" id="addMedicineForm"><h2>เพิ่มเวชภัณฑ์ใหม่</h2>' +
        '<div class="form-row">' +
        '<div class="form-group" style="grid-column: 1 / -1"><label>ชื่อเวชภัณฑ์</label><input type="text" id="medicineName" placeholder="เช่น Paracetamol 500mg" required></div></div>' +
        '<div class="form-row"><div class="form-group"><label>จำนวนคงเหลือ</label><input type="number" id="medicineStock" placeholder="0" min="0" required></div>' +
        '<div class="form-group"><label>หน่วยนับ</label><select id="medicineUnit" required>' +
        '<option value="">-- เลือกหน่วยนับ --</option>' +
        '<option value="ชิ้น">ชิ้น</option>' +
        '<option value="อัน">อัน</option>' +
        '<option value="กล่อง">กล่อง</option>' +
        '<option value="แพ็ค">แพ็ค</option></select></div></div>' + 
        '<div class="form-row"><div class="form-group"><label>จำนวนเตือนใหม่</label><input type="number" id="medicineReorder" placeholder="0" min="0" required></div></div>' +
        '<button type="submit" class="btn-primary"><i class="fa-solid fa-plus"></i> เพิ่มเวชภัณฑ์</button></form>' +
        '<div class="list-section"><h2><i class="fa-solid fa-list"></i> รายการเวชภัณฑ์</h2>' +
        '<div id="medicineList">' + (appData.inventory.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ไม่มีรายการเวชภัณฑ์</p>' : items) + '</div>' +
        '</div></div></div>';
}

// ==================== [REFACTOR] หน้าสแกนรองรับ MULTI-ITEMS + SEARCH ====================
function renderScanPage(container) {
    var iosMedHtml = '<div style="text-align:center;margin:20px 0">' +
        '<label for="iosMedInput" class="btn-primary" style="display:inline-block;cursor:pointer;padding:12px 24px;border-radius:12px">' +
        '<i class="fa-solid fa-camera"></i> ถ่ายรูป QR เตียงผู้ป่วย</label>' +
        '<input type="file" id="iosMedInput" accept="image/*" capture="environment" style="display:none" onchange="window.handleIOSMedCapture(event)"></div>';

    var webMedHtml = '<div id="qr-scan-area" class="qr-scan-area"><video id="scan-video" autoplay playsinline muted></video></div>' +
    '<p class="page-subtitle" style="text-align:center">วาง QR Code ประจำเตียงผู้ป่วยให้อยู่ในกรอบกล้องเพื่อสแกน</p>' +
    '<div style="text-align:center">' +
    '<button id="startScanBtn" class="btn-primary" onclick="window.startScanning()"><i class="fa-solid fa-play"></i> เริ่มสแกน</button>' +
    '<button id="stopScanBtn" class="btn-secondary" onclick="window.stopScanning()" style="display:none"><i class="fa-solid fa-stop"></i> หยุดสแกน</button>' +
    '</div>' +
    '<div style="text-align:center;margin-top:15px;padding-top:15px;border-top:1px solid #eee">' +
    '<p style="color:#9ca3af;font-size:13px;margin-bottom:8px">กล้องเปิดไม่ติด หรือไม่สะดวกสแกนสด?</p>' + iosMedHtml + '</div>';

    container.innerHTML =
        '<div class="page-container"><div class="page-header"><h1><i class="fa-solid fa-qrcode"></i> สแกนเตียงผู้ป่วย</h1>' +
        '<button class="btn-back" onclick="window.goToPage(\'dashboard\')"><i class="fa-solid fa-arrow-left"></i> กลับ</button></div>' +
        '<div class="page-content"><div class="scan-mode-toggle">' +
        '<button class="mode-btn active" onclick="window.switchScanMode(\'camera\')"><i class="fa-solid fa-camera"></i> กล้อง</button>' +
        '<button class="mode-btn" onclick="window.switchScanMode(\'manual\')"><i class="fa-solid fa-keyboard"></i> พิมพ์ชื่อค้นหา</button></div>' +
        '<div id="cameraMode" class="scan-mode active">' + (supportsLiveCamera ? webMedHtml : iosMedHtml) + '</div>' +
        '<div id="manualMode" class="scan-mode" style="display:none"><div class="form-group"><label>ป้อนชื่อผู้ป่วยเพื่อค้นหา</label>' +
        '<input type="text" id="medicineCodeInput" placeholder="พิมพ์ชื่อ-นามสกุล"></div>' +
        '<button class="btn-primary" onclick="window.searchByCode()"><i class="fa-solid fa-magnifying-glass"></i> ค้นหา</button></div>' +
        '<div id="scanResult" class="info-box" style="display:none;margin-top:20px"></div>' +
        '</div></div>' +
        
        // --- MULTI-ITEMS OVERLAY MODAL ---
        '<div id="scanModalOverlay" style="position:fixed;inset:0;background:rgba(46,37,66,0.55);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;z-index:9999;padding:20px">' +
        '<div class="form-section" id="recordForm" style="background:#fff;border-radius:24px;border-top:6px solid var(--c-primary);box-shadow:0 25px 60px rgba(46,37,66,0.4);padding:30px 25px;max-width:500px;width:100%;margin:0;max-height:90vh;overflow-y:auto">' +
        '<h2 style="margin-top:0;margin-bottom:16px;color:#1e293b;border-bottom:2px solid #f1f5f9;padding-bottom:10px"><i class="fa-solid fa-clipboard-check" style="color:#10b981"></i> ยืนยันการจ่ายเวชภัณฑ์</h2>' +
        '<div class="form-group"><label style="font-weight:600">ผู้ป่วยที่ระบุ (เตียง)</label><input type="text" id="recordPatientDisplay" style="background:#f8fafc;font-weight:700;color:#5e3db5" readonly></div>' +
        
        // พื้นที่ผูกแถวรายการยาแบบ Multi-rows
        '<div style="margin-top:15px;margin-bottom:8px;font-weight:700;color:#334155;font-size:0.95rem;display:flex;justify-content:space-between;align-items:center">' +
        '<span>รายการเวชภัณฑ์ที่จ่าย</span>' +
        '<button type="button" onclick="window.addMedicineRow()" style="background:#5e3db5;color:#fff;border:none;padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600"><i class="fa-solid fa-plus"></i> เพิ่มรายการ</button>' +
        '</div>' +
        '<div id="multiMedicineContainer" style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px"></div>' +
        
        '<div style="display:flex;gap:12px;margin-top:24px">' +
        '<button class="btn-primary" onclick="window.submitMultiRecords()" style="flex:1;padding:12px"><i class="fa-solid fa-check"></i> บันทึกทั้งหมด</button>' +
        '<button class="btn-secondary" onclick="window.cancelRecord()" style="flex:1;padding:12px;background:#ef4444;color:#fff"><i class="fa-solid fa-xmark"></i> ยกเลิก</button>' +
        '</div></div></div>';

    if (supportsLiveCamera) {
        setTimeout(function() { startScanning(); }, 200);
    }
}

// ฟังก์ชันเพิ่มแถวรายการเวชภัณฑ์แบบมีฟิลด์ Search ในตัว
var rowCounter = 0;
function addMedicineRow() {
    rowCounter++;
    var container = document.getElementById('multiMedicineContainer'); if (!container) return;

    var rowId = 'medRow_' + rowCounter;
    var rowHtml = document.createElement('div');
    rowHtml.id = rowId;
    rowHtml.className = 'medicine-form-row';
    rowHtml.style.cssText = 'background:#f8fafc;padding:14px;border-radius:12px;border:1px solid #e2e8f0;position:relative;margin-bottom:10px;box-sizing:border-box';

    rowHtml.innerHTML = 
        (container.children.length > 0 ? '<button type="button" onclick="document.getElementById(\''+rowId+'\').remove()" style="position:absolute;right:8px;top:8px;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;z-index:10"><i class="fa-solid fa-circle-xmark"></i></button>' : '') +
        '<div class="form-group" style="position:relative;margin-bottom:8px">' +
        '<label style="font-size:0.85rem;color:#64748b;margin-bottom:4px;display:block">ค้นหาเวชภัณฑ์</label>' +
        
        // ตัวล็อกค่า ID จริงส่งเข้า Firebase
        '<input type="hidden" class="med-select-field" id="id_'+rowId+'" value="">' +
        
        // ช่องพิมพ์ข้อความค้นหา
        '<input type="text" id="input_'+rowId+'" placeholder="🔍 พิมพ์เพื่อค้นหาเวชภัณฑ์..." onfocus="window.openSearchSug(\''+rowId+'\')" oninput="window.filterSearchSug(\''+rowId+'\')" style="width:100%;padding:12px;font-size:14px;border-radius:10px;border:2px solid #cbd5e1;background:#fff;box-sizing:border-box">' +
        
        // 🌟 กล่อง DROPDOWN ยกลอย (สามารถสไลด์เลื่อนขึ้น-ลงได้จริงเมื่อรายการยาว) 🌟
        '<div id="sug_'+rowId+'" class="google-sug-box" style="position:absolute;left:0;right:0;top:100%;background:#fff;border:2px solid #5e3db5;border-radius:0 0 12px 12px;box-shadow:0 8px 24px rgba(0,0,0,0.15);display:none;z-index:999;max-height:180px;overflow-y:auto;box-sizing:border-box"></div>' +
        '</div>' +
        
        '<div class="form-group" style="margin:0">' +
        '<label style="font-size:0.85rem;color:#64748b;margin-bottom:4px;display:block">จำนวน</label>' +
        '<input type="number" class="med-qty-field" min="1" value="1" style="width:100%;padding:12px;border-radius:10px;border:2px solid #cbd5e1;box-sizing:border-box" required>' +
        '</div>';

    container.appendChild(rowHtml);
}

// ฟังก์ชันเปิด Dropdown เมื่อคลิกโฟกัสที่ช่องค้นหา
function openSearchSug(rowId) {
    document.querySelectorAll('.google-sug-box').forEach(function(box) { box.style.display = 'none'; });
    var sugBox = document.getElementById('sug_' + rowId);
    if (!sugBox) return;
    
    renderSuggestions(rowId, document.getElementById('input_' + rowId).value);
    sugBox.style.display = 'block';
}

// ฟังก์ชันกรองข้อมูลใน Dropdown แบบ Real-time ตามที่คีย์พิมพ์จริง
function filterSearchSug(rowId) {
    var text = document.getElementById('input_' + rowId).value;
    renderSuggestions(rowId, text);
}

// ฟังก์ชันสร้างรายการสิ่งของในคลังยัดลงฟอร์ม Dropdown
function renderSuggestions(rowId, filterText) {
    var sugBox = document.getElementById('sug_' + rowId);
    if (!sugBox) return;

    var query = filterText.toLowerCase().trim();
    var matchItems = appData.inventory.filter(function(m) {
        return m.name.toLowerCase().indexOf(query) > -1;
    });

    if (matchItems.length === 0) {
        sugBox.innerHTML = '<div style="padding:12px;color:#94a3b8;font-size:13px;text-align:center">ไม่พบข้อมูลเวชภัณฑ์</div>';
        return;
    }

    var html = '';
    matchItems.forEach(function(m) {
        html += '<div class="sug-item" onclick="window.selectSugItem(\''+rowId+'\', \''+m.id+'\', \''+escapeHtml(m.name).replace(/'/g, "\\'")+'\')" style="padding:12px 16px;cursor:pointer;font-size:14px;border-bottom:1px solid #f1f5f9;color:#334155;text-align:left;transition:background 0.2s" onmouseover="this.style.background=\'#f3effa\'" onmouseout="this.style.background=\'#fff\'">' +
                '<i class="fa-solid fa-pills" style="color:#8e7cc3;margin-right:8px"></i>' + escapeHtml(m.name) + 
                ' <span style="font-size:11px;color:#64748b;float:right;background:#e6dff2;padding:2px 6px;border-radius:6px">เหลือ ' + m.stock + ' ' + m.unit + '</span>' +
                '</div>';
    });
    sugBox.innerHTML = html;
}

// ฟังก์ชันทำงานเมื่อกดเลือกรายการยาใน Dropdown
function selectSugItem(rowId, medId, medName) {
    // ฝัง ID ยาลงในกล่องรับค่าเพื่อรอส่งบันทึก Firebase
    var idInput = document.getElementById('id_' + rowId);
    if (idInput) idInput.value = medId;
    
    // แสดงชื่อยาให้พยาบาลเห็นในกล่องพิมพ์ค้นหา
    var textInput = document.getElementById('input_' + rowId);
    if (textInput) textInput.value = medName;
    
    // ปิดซ่อนกล่อง Dropdown ทันทีหลังเลือกเสร็จ
    var box = document.getElementById('sug_' + rowId); 
    if (box) box.style.display = 'none';
}

// ตรวจจับถ้าคลิกพื้นที่ว่างข้างนอกป็อปอัพ ให้ช่วยพับหุบ Dropdown เก็บให้เรียบร้อย
document.addEventListener('click', function(e) {
    if (!e.target.closest('.form-group')) {
        document.querySelectorAll('.google-sug-box').forEach(function(box) { box.style.display = 'none'; });
    }
});

// ระบบ Search กรองรายชื่อยาใน Dropdown อัตโนมัติ (Real-time Filter)
function filterMedicineOptions(inputEl, rowId) {
    var filterText = inputEl.value.toLowerCase().trim();
    var selectEl = document.querySelector('#' + rowId + ' .med-select-field');
    if (!selectEl) return;

    var options = selectEl.options;
    var firstMatch = null;

    for (var i = 0; i < options.length; i++) {
        if (i === 0) continue; // ข้ามตัวเลือกแรกที่เป็น placeholder
        var medName = options[i].getAttribute('data-name') || '';
        if (medName.indexOf(filterText) > -1) {
            options[i].style.display = 'block';
            if (!firstMatch) firstMatch = options[i].value;
        } else {
            options[i].style.display = 'none';
        }
    }
    // ถ้าพิมพ์ค้นหาแล้วตรง ล็อกเลือกตัวที่เจออันแรกให้เลยเพื่อความ lean
    if (firstMatch && filterText.length > 1) selectEl.value = firstMatch;
}

function renderInventory(container) {
    var items = appData.inventory.map(function(item) {
        return '<div class="inventory-card ' + (item.stock <= item.reorder ? 'low-stock' : '') + '">' +
            '<div class="inventory-name">' + escapeHtml(item.name) + '</div>' +
            '<div class="inventory-row"><span>จำนวนคงเหลือ:</span><span style="font-weight:700">' + item.stock + ' ' + escapeHtml(item.unit) + '</span></div>' +
            '<div class="inventory-row"><span>เตือนใหม่:</span><span>' + item.reorder + '</span></div>' +
            (item.stock <= item.reorder ? '<div style="color:#ef4444;margin-top:10px;font-weight:700"><i class="fa-solid fa-triangle-exclamation"></i> ต้องสั่งสินค้า</div>' : '') +
            '</div>';
    }).join('');
    container.innerHTML =
        '<div class="page-container"><div class="page-header"><h1><i class="fa-solid fa-boxes-stacked"></i> ยอดคงคลัง</h1></div>' +
        '<div class="page-content"><div class="list-section"><div class="inventory-grid">' +
        (appData.inventory.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ไม่มีรายการ</p>' : items) +
        '</div></div></div></div>';
}

function renderRecords(container) {
    var items = appData.records.map(function(r) {
        return '<div class="record-card"><div class="record-date">' + formatTimestamp(r.createdAt) + '</div>' +
            '<div class="record-row"><span class="label">ผู้ป่วย:</span><span>' + escapeHtml(r.patientName) + '</span></div>' +
            '<div class="record-row"><span class="label">เวชภัณฑ์:</span><span>' + escapeHtml(r.medicineName) + '</span></div>' +
            '<div class="record-row"><span class="label">จำนวน:</span><span style="font-weight:700">' + r.quantity + '</span></div>' +
            '<div class="record-row"><span class="label">บันทึกโดย:</span><span>' + escapeHtml(r.performedByName || '-') + '</span></div></div>';
    }).join('');
    container.innerHTML =
        '<div class="page-container"><div class="page-header"><h1><i class="fa-solid fa-clipboard-list"></i> บันทึกการใช้เวชภัณฑ์</h1></div>' +
        '<div class="page-content"><div class="records-grid">' +
        (appData.records.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ไม่มีบันทึก</p>' : items) +
        '</div></div></div>';
}

var roleLabels = { nurse: 'พยาบาล', pharmacist: 'เภสัชกร', admin: 'ผู้ดูแลระบบ' };

function renderAdminPage(container) {
    var isSelf = function(emp) { return currentUser && emp.id === currentUser.uid; };

    var employeeItems = appData.employees.map(function(emp) {
        var roleLabel = roleLabels[emp.role] || emp.role || '-';
        var isActive = emp.active !== false;
        var statusBadge = isActive
            ? '<span style="color:#16a34a;font-weight:700">● ใช้งานอยู่</span>'
            : '<span style="color:#9ca3af;font-weight:700">● ปิดใช้งาน</span>';

        var toggleBtn = isSelf(emp)
            ? ''
            : '<button class="btn-secondary" onclick="window.handleToggleEmployee(\'' + emp.id + '\', ' + isActive + ')">' +
              '<i class="fa-solid fa-' + (isActive ? 'ban' : 'check') + '"></i> ' + (isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน') + '</button>';

        var deleteBtn = isSelf(emp)
            ? ''
            : '<button class="btn-delete" onclick="window.deleteEmployee(\'' + emp.id + '\')"><i class="fa-solid fa-trash"></i> ลบ</button>';

        return '<div class="list-item"><div class="item-info">' +
            '<div class="item-title">' + escapeHtml(emp.name) + (isSelf(emp) ? ' (คุณ)' : '') + '</div>' +
            '<div class="item-detail">' + escapeHtml(emp.email) + ' | ' + escapeHtml(roleLabel) +
            (emp.department ? ' | ' + escapeHtml(emp.department) : '') + '</div>' +
            '<div style="margin-top:5px">' + statusBadge + '</div></div>' +
            '<div style="display:flex;gap:8px">' + toggleBtn + deleteBtn + '</div></div>';
    }).join('');

    container.innerHTML =
        '<div class="page-container"><div class="page-header"><h1><i class="fa-solid fa-user-shield"></i> จัดการพนักงาน</h1></div>' +
        '<div class="page-content"><form class="form-section" id="addEmployeeForm"><h2>เพิ่มพนักงานใหม่</h2>' +
        '<div class="form-row"><div class="form-group"><label>ชื่อ-นามสกุล</label><input type="text" id="empName" placeholder="ชื่อ-นามสกุล" required></div>' +
        '<div class="form-group"><label>อีเมล</label><input type="email" id="empEmail" placeholder="email@hospital.com" required></div></div>' +
        '<div class="form-row"><div class="form-group"><label>รหัสผ่าน</label><input type="password" id="empPassword" placeholder="อย่างน้อย 6 ตัวอักษร" required></div>' +
        '<div class="form-group"><label>ตำแหน่ง</label><select id="empRole" required>' +
        '<option value="nurse">พยาบาล (nurse)</option>' +
        '<option value="pharmacist">เภสัชกร (pharmacist)</option>' +
        '<option value="admin">ผู้ดูแลระบบ (admin)</option></select></div></div>' +
        '<div class="form-row"><div class="form-group"><label>แผนก/วอร์ด</label><input type="text" id="empDept" placeholder="เช่น วอร์ด 4A"></div></div>' +
        '<button type="submit" class="btn-primary" id="addEmployeeBtn"><i class="fa-solid fa-plus"></i> เพิ่มพนักงาน</button></form>' +
        '<div id="empSuccess" class="info-box success" style="display:none;margin-top:15px"></div>' +
        '<div id="empError" class="info-box error" style="display:none;margin-top:15px"></div>' +
        '<div class="list-section" style="margin-top:25px"><h2><i class="fa-solid fa-list"></i> รายชื่อพนักงาน</h2>' +
        '<div id="employeeList">' + (appData.employees.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ยังไม่มีพนักงาน</p>' : employeeItems) + '</div>' +
        '</div></div></div>';
}

async function handleAddEmployee(e) {
    e.preventDefault();
    var name = document.getElementById('empName').value.trim();
    var email = document.getElementById('empEmail').value.trim();
    var password = document.getElementById('empPassword').value;
    var role = document.getElementById('empRole').value;
    var department = document.getElementById('empDept').value.trim();
    var successBox = document.getElementById('empSuccess');
    var errorBox = document.getElementById('empError');
    var btn = document.getElementById('addEmployeeBtn');

    if (errorBox) errorBox.style.display = 'none';
    if (successBox) successBox.style.display = 'none';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเพิ่ม...'; }

    try {
        await createEmployee({
            name: name, email: email, password: password, role: role,
            admin: (role === 'admin'), department: department
        });
        if (successBox) {
            successBox.innerHTML = '<i class="fa-solid fa-circle-check"></i> เพิ่มพนักงาน <strong>' + escapeHtml(name) + '</strong> สำเร็จ (อีเมล: ' + escapeHtml(email) + ')';
            successBox.style.display = 'block';
        }
        document.getElementById('addEmployeeForm').reset();
    } catch (err) {
        var msg = err.message || 'เพิ่มพนักงานไม่สำเร็จ';
        if (msg.includes('email-already-in-use')) msg = 'อีเมลนี้ถูกใช้งานแล้ว';
        if (msg.includes('weak-password')) msg = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
        if (errorBox) { errorBox.textContent = msg; errorBox.style.display = 'block'; }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-plus"></i> เพิ่มพนักงาน'; }
    }
}

async function handleToggleEmployee(id, currentlyActive) {
    var action = currentlyActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน';
    if (!confirm('ต้องการ' + action + 'พนักงานคนนี้ใช่หรือไม่?')) return;
    try { await toggleEmployeeActive(id, !currentlyActive); }
    catch (err) { alert(action + 'ไม่สำเร็จ: ' + err.message); }
}

async function deleteEmployee(id) {
    if (!confirm('ต้องการลบพนักงานคนนี้ใช่หรือไม่? การลบจะลบสิทธิ์เข้าระบบถาวร')) return;
    try { await deleteEmployeeDoc(id); }
    catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
}

// ==================== CRUD ====================
async function addPatient(e) {
    e.preventDefault();
    var name = document.getElementById('patientName').value;
    var ward = document.getElementById('patientWard').value;
    var bed = document.getElementById('patientBed').value;
    if (name && ward && bed) {
        try { await addPatientDoc({ name: name, ward: ward, bed: bed }); goToPage('patients'); }
        catch (err) { alert('เพิ่มผู้ป่วยไม่สำเร็จ: ' + err.message); }
    }
}

async function deletePatient(id) {
    if (confirm('ต้องการลบผู้ป่วยนี้ใช่หรือไม่?')) {
        try { await deletePatientDoc(id); } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
    }
}

async function addMedicine(e) {
    e.preventDefault();
    var name = document.getElementById('medicineName').value;
    var stock = parseInt(document.getElementById('medicineStock').value);
    var unit = document.getElementById('medicineUnit').value;
    var reorder = parseInt(document.getElementById('medicineReorder').value);
    if (name && unit && !isNaN(stock) && !isNaN(reorder)) {
        try { await addMedicineDoc({ name: name, stock: stock, unit: unit, reorder: reorder }); goToPage('medicines'); }
        catch (err) { alert('เพิ่มเวชภัณฑ์ไม่สำเร็จ: ' + err.message); }
    }
}

async function deleteMedicine(id) {
    if (confirm('ต้องการลบเวชภัณฑ์นี้ใช่หรือไม่?')) {
        try { await deleteMedicineDoc(id); } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
    }
}

// ==================== QR CODE GENERATION ====================
function getQRDataURL(text) {
    return new Promise(function(resolve, reject) {
        if (typeof QRCode === 'undefined') {
            reject(new Error('ไม่พบ QR library'));
            return;
        }

        if (typeof QRCode.toDataURL === 'function') {
            QRCode.toDataURL(text, { width: 260, margin: 1 }, function(err, url) {
                if (err) reject(err); else resolve(url);
            });
            return;
        }

        if (typeof QRCode === 'function') {
            try {
                var holder = document.createElement('div');
                holder.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
                document.body.appendChild(holder);

                var opts = { text: text, width: 260, height: 260 };
                if (QRCode.CorrectLevel) opts.correctLevel = QRCode.CorrectLevel.M;
                new QRCode(holder, opts);

                setTimeout(function() {
                    var canvas = holder.querySelector('canvas');
                    var img = holder.querySelector('img');
                    var dataUrl = canvas ? canvas.toDataURL('image/png') : (img ? img.src : null);
                    document.body.removeChild(holder);
                    if (dataUrl) resolve(dataUrl);
                    else reject(new Error('qrcodejs สร้าง QR ไม่สำเร็จ'));
                }, 50);
            } catch (err) {
                reject(err);
            }
            return;
        }

        reject(new Error('QRCode library ที่โหลดมาไม่รู้จัก'));
    });
}

async function showQRCode(patientName, titleName) {
    var existing = document.getElementById('qrModalOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'qrModalOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
    overlay.innerHTML =
        '<div style="background:#fff;border-radius:16px;padding:30px;max-width:340px;width:100%;text-align:center">' +
        '<h2 style="margin:0 0 4px">' + escapeHtml(titleName) + '</h2>' +
        '<p style="color:#6b7280;margin:0 0 20px">QR Code ยืนยันตำแหน่งเตียง</p>' +
        '<div id="qrImageHolder" style="display:flex;justify-content:center;min-height:260px;align-items:center">' +
        '<i class="fa-solid fa-spinner fa-spin" style="font-size:32px;color:#9ca3af"></i></div>' +
        '<div style="display:flex;gap:10px;margin-top:20px">' +
        '<button class="btn-primary" id="qrDownloadBtn" style="flex:1" disabled><i class="fa-solid fa-download"></i> ดาวน์โหลด</button>' +
        '<button class="btn-primary" id="qrPrintBtn" style="flex:1" disabled><i class="fa-solid fa-print"></i> พิมพ์</button>' +
        '</div>' +
        '<button class="btn-secondary" onclick="document.getElementById(\'qrModalOverlay\').remove()" style="width:100%;margin-top:10px">ปิด</button>' +
        '</div>';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    try {
        var dataUrl = await getQRDataURL(patientName);
        var holder = document.getElementById('qrImageHolder');
        if (holder) holder.innerHTML = '<img src="' + dataUrl + '" alt="QR ' + escapeHtml(patientName) + '" style="width:220px;height:220px">';

        var dlBtn = document.getElementById('qrDownloadBtn');
        if (dlBtn) {
            dlBtn.disabled = false;
            dlBtn.onclick = function() {
                var a = document.createElement('a');
                a.href = dataUrl;
                a.download = 'QR-Bed-' + patientName + '.png';
                a.click();
            };
        }
        var prBtn = document.getElementById('qrPrintBtn');
        if (prBtn) {
            prBtn.disabled = false;
            prBtn.onclick = function() { printQRImages([{ code: patientName, name: titleName, dataUrl: dataUrl }]); };
        }
    } catch (err) {
        var holder2 = document.getElementById('qrImageHolder');
        if (holder2) holder2.innerHTML = '<p style="color:#ef4444"><i class="fa-solid fa-circle-xmark"></i> ' + escapeHtml(err.message) + '</p>';
    }
}

async function printAllQRCodes() {
    if (appData.patients.length === 0) { alert('ยังไม่มีรายการผู้ป่วย'); return; }
    try {
        var results = await Promise.all(appData.patients.map(function(p) {
            return getQRDataURL(p.name).then(function(url) { return { code: p.name, name: p.name + ' (เตียง: ' + p.bed + ')', dataUrl: url }; });
        }));
        printQRImages(results);
    } catch (err) {
        alert('สร้าง QR ไม่สำเร็จ: ' + err.message);
    }
}

function printQRImages(items) {
    var win = window.open('', '_blank', 'width=800,height=600');
    if (!win) { alert('เบราว์เซอร์บล็อก pop-up กรุณาอนุญาต pop-up สำหรับเว็บนี้'); return; }

    var cards = items.map(function(item) {
        return '<div class="qr-card">' +
            '<img src="' + item.dataUrl + '" alt="QR">' +
            '<div class="qr-name">' + escapeHtml(item.name) + '</div>' +
            '</div>';
    }).join('');

    win.document.write(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>พิมพ์ QR เตียงผู้ป่วย</title><style>' +
        'body{font-family:Sarabun,Arial,sans-serif;margin:20px}' +
        '.qr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}' +
        '.qr-card{border:1px solid #ddd;border-radius:8px;padding:12px;text-align:center;page-break-inside:avoid}' +
        '.qr-card img{width:140px;height:140px}' +
        '.qr-name{font-weight:700;margin-top:8px;font-size:14px}' +
        '@media print{.no-print{display:none}}' +
        '</style></head><body>' +
        '<button class="no-print" onclick="window.print()" style="margin-bottom:16px;padding:10px 20px">พิมพ์เลย</button>' +
        '<div class="qr-grid">' + cards + '</div>' +
        '</body></html>'
    );
    win.document.close();
    win.onload = function() { win.print(); };
}

// ==================== LIVE SCANNER ENGINE ====================
function startScanning() {
    var video = document.getElementById('scan-video');
    var startBtn = document.getElementById('startScanBtn');
    var stopBtn = document.getElementById('stopScanBtn');
    
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(function(stream) {
            videoStream = stream;
            video.srcObject = stream;
            video.setAttribute('playsinline', 'true');
            video.setAttribute('muted', 'true');
            
            var playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.then(function() {
                    if (startBtn) startBtn.style.display = 'none';
                    if (stopBtn) stopBtn.style.display = 'inline-block';
                    scanQRCode(video);
                }).catch(function(error) {
                    console.error("Video play ถูกบล็อก:", error);
                });
            }
        })
        .catch(function(err) { 
            alert('ไม่สามารถเข้าถึงกล้องได้: ' + err.message); 
        });
}

function scanQRCode(video) {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var scanResult = document.getElementById('scanResult');
    
    function scan() {
        if (!videoStream) return;
        
        if (typeof jsQR === 'undefined') {
            stopScanning();
            if (scanResult) {
                scanResult.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> ระบบสแกนไม่พร้อมใช้งาน: ไม่สามารถโหลด Library jsQR ได้';
                scanResult.className = 'info-box error';
                scanResult.style.display = 'block';
            }
            return;
        }
        
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            var code = jsQR(imageData.data, canvas.width, canvas.height);
            
            if (code) {
                stopScanning();
                searchByCode(code.data.trim());
                return;
            }
        }
        requestAnimationFrame(scan);
    }
    requestAnimationFrame(scan);
}

function stopScanning() {
    if (videoStream) { videoStream.getTracks().forEach(function(t) { t.stop(); }); videoStream = null; }
    var startBtn = document.getElementById('startScanBtn');
    var stopBtn = document.getElementById('stopScanBtn');
    if (startBtn) startBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';
}

function searchByCode(codeParam) {
    var code = codeParam || document.getElementById('medicineCodeInput').value;
    var patient = appData.patients.find(function(p) { return p.name === code; });
    var modalOverlay = document.getElementById('scanModalOverlay');
    var scanResult = document.getElementById('scanResult');
    
    if (patient) {
        currentScannedPatient = patient; 
        document.getElementById('recordPatientDisplay').value = patient.name + ' (เตียง: ' + patient.bed + ' | หอ: ' + patient.ward + ')';
        
        // ล้างกล่องเก็บสัญญายาเก่าออก แล้วเจนแถวแรกเริ่มต้นขึ้นมาต้อนรับพยาบาล
        var mContainer = document.getElementById('multiMedicineContainer');
        if (mContainer) {
            mContainer.innerHTML = '';
            addMedicineRow(); 
        }
        
        if (modalOverlay) modalOverlay.style.display = 'flex';
        
        if (scanResult) { 
            scanResult.innerHTML = '<i class="fa-solid fa-circle-check"></i> ระบุตัวเตียงผู้ป่วยสำเร็จ: ' + escapeHtml(patient.name); 
            scanResult.className = 'info-box success'; 
            scanResult.style.display = 'block'; 
        }
    } else {
        currentScannedPatient = null;
        if (modalOverlay) modalOverlay.style.display = 'none';
        if (scanResult) { 
            scanResult.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> ไม่พบข้อมูลผู้ป่วยที่ใช้ชื่อนี้: ' + escapeHtml(code); 
            scanResult.className = 'info-box error'; 
            scanResult.style.display = 'block'; 
        }
    }
}

// [NEW] ฟังก์ชันเซฟรายการธุรกรรมยาแบบทีละหลายตัวพร้อมกัน (Loop-Submitting Transactions)
async function submitMultiRecords() {
    if (!currentScannedPatient) return;
    var rows = document.querySelectorAll('#multiMedicineContainer .medicine-form-row');
    if (rows.length === 0) { alert('กรุณาเพิ่มรายการเวชภัณฑ์อย่างน้อย 1 รายการ'); return; }

    var itemsToSubmit = []; 
    var validationPass = true;
    
    rows.forEach(function(row) {
        // ✅ แก้ไข: ดึงค่าจาก Hidden Input ที่เก็บ ID ยาจริงโดยตรง (ไม่ดึงสลับตัวแปรเอ๋อ)
        var medIdField = row.querySelector('.med-select-field');
        var medId = medIdField ? medIdField.value : '';
        
        var qtyField = row.querySelector('.med-qty-field');
        var quantity = qtyField ? parseInt(qtyField.value) : 0;
        
        if (!medId || isNaN(quantity) || quantity < 1) { 
            validationPass = false; 
            return; 
        }
        
        var targetMed = appData.inventory.find(function(m) { return m.id === medId; });
        if (targetMed) itemsToSubmit.push({ med: targetMed, qty: quantity });
    });

    if (!validationPass || itemsToSubmit.length === 0) { 
        alert('กรุณาเลือกเวชภัณฑ์จากช่องค้นหาและระบุจำนวนให้ถูกต้องครบถ้วนทุกแถว'); 
        return; 
    }

    try {
        // วนลูปยิงสัญญาสัญญาณตัดคลังทีละรายการลงระบบ Firestore Atomic Transaction
        for (var i = 0; i < itemsToSubmit.length; i++) {
            var current = itemsToSubmit[i];
            await submitRecordDoc({
                medicineId: current.med.id, 
                medicineName: current.med.name,
                patientName: currentScannedPatient.name, 
                quantity: current.qty,
                performedByUid: currentUser.uid, 
                performedByName: currentUser.name
            });
        }
        alert('บันทึกการจ่ายเวชภัณฑ์ชุดนี้สำเร็จเรียบร้อย');
        var modalOverlay = document.getElementById('scanModalOverlay'); 
        if (modalOverlay) modalOverlay.style.display = 'none';
        currentScannedPatient = null; 
        goToPage('records');
    } catch (err) { 
        alert('บันทึกผิดพลาด: ' + err.message); 
    }
}

function cancelRecord() {
    var modalOverlay = document.getElementById('scanModalOverlay');
    var scanResult = document.getElementById('scanResult');
    if (modalOverlay) modalOverlay.style.display = 'none';
    if (scanResult) scanResult.style.display = 'none';
    var input = document.getElementById('medicineCodeInput');
    if (input) input.value = '';
    currentScannedPatient = null;
    if (supportsLiveCamera && !videoStream) {
        startScanning();
    }
}

function goToPage(page) { currentPage = page; renderApp(); }

function attachEventListeners() {
    var f1 = document.getElementById('addPatientForm');
    var f2 = document.getElementById('addMedicineForm');
    var f3 = document.getElementById('addEmployeeForm');
    if (f1) f1.addEventListener('submit', addPatient);
    if (f2) f2.addEventListener('submit', addMedicine);
    if (f3) f3.addEventListener('submit', handleAddEmployee);
}

async function initAppAfterLogin() {
    renderAppShell();
    startDataListeners();
    renderApp();
}

// ผูกฟังก์ชัน Global ตัวเสริมเข้าสู่ Window Object
window.addMedicineRow = addMedicineRow;
window.filterMedicineOptions = filterMedicineOptions;
window.submitMultiRecords = submitMultiRecords;

window.toggleSidebar = toggleSidebar;
window.goToPage = goToPage;
window.handleLogout = handleLogout;
window.submitEmailLogin = submitEmailLogin;
window.handleAddEmployee = handleAddEmployee;
window.handleToggleEmployee = handleToggleEmployee;
window.deleteEmployee = deleteEmployee;
window.addPatient = addPatient;
window.deletePatient = deletePatient;
window.addMedicine = addMedicine;
window.deleteMedicine = deleteMedicine;
window.showQRCode = showQRCode;
window.printAllQRCodes = printAllQRCodes;
window.switchScanMode = switchScanMode;
window.startScanning = startScanning;
window.stopScanning = stopScanning;
window.searchByCode = searchByCode;
window.submitRecord = submitRecord;
window.cancelRecord = cancelRecord;
window.handleIOSMedCapture = handleIOSMedCapture;