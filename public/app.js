// Lean QR Code Patient-Bed Tracking System (Multi-Items + Search Component)
// Login: Email/Password | สแกนเตียงผู้ป่วย: QR Code จากชื่อผู้ป่วย

import {
  restoreSession, loginWithEmail, logout, createEmployee,
  toggleEmployeeActive, deleteEmployeeDoc,updateCurrentUserPassword
} from "./auth.js";

import {
  listenPatients, addPatientDoc, deletePatientDoc, updatePatientDoc,
  listenInventory, addMedicineDoc, deleteMedicineDoc, restockMedicineDoc,
  submitRecordDoc, listenEmployees,
  getRecordsPageFromFirestore, getAllRecordsOnceFromFirestore, getTotalRecordsCount,
  voidRecordDoc // 👈 ใส่ 2 ตัวนี้แทนที่ของเดิม
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
var currentRecordPage = 1;
var recordsPerPage = 10; // โชว์หน้าละ 10 รายการ
var serverRecords = [];  // เก็บเฉพาะข้อมูล 10 ตัวของหน้านั้น ๆ ไม่เก็บทั้งหมด
var pageCursors = [null]; // ตัวเก็บตำแหน่งคอร์เซอร์ (docSnap) ของแต่ละหน้าเพื่อกดถอยหลัง/ไปข้างหน้า
var hasNextPage = false;

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2500, // แสดง 2.5 วินาทีแล้วหายไปเอง
    timerProgressBar: true,
    didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
    }
});

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
        
        // โยนหน้าที่ให้ฟังก์ชันจัดการตัวเอง มันจะเช็คเองว่าเวรนี้ควรเด้งไหม
        if (appData.inventory.length > 0) {
            window.checkLowStockAlert();
        }
    });
    
    // 🔥 [แก้ไขจุดนี้] เอาเงื่อนไข if (admin) ออก เพื่อให้พยาบาลทุกคนสามารถโหลดรายชื่อพนักงานไปใช้ใน Dropdown ตอน Export ได้
    unsubscribeEmployees = listenEmployees(function(list) {
        appData.employees = list;
        if (currentPage === 'admin' || currentPage === 'records') renderApp();
    });
}


function stopDataListeners() {
    if (unsubscribePatients) unsubscribePatients();
    if (unsubscribeInventory) unsubscribeInventory();
    if (unsubscribeEmployees) unsubscribeEmployees();
    unsubscribePatients = unsubscribeInventory = unsubscribeEmployees = null;
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
        '<label><i class="fa-solid fa-user"></i> ชื่อผู้ใช้งาน (Username)</label>' +
        '<div class="input-with-icon">' +
        '<input type="text" id="loginUsername" placeholder="เช่น nurse01">' +
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
    // 1. ดึงค่า ตัดช่องว่างหน้า-หลัง เปลี่ยนเป็นพิมพ์เล็ก และ "ลบช่องว่างตรงกลาง" ออกให้หมด
    var username = document.getElementById('loginUsername').value.trim().toLowerCase().replace(/\s+/g, '');
    var password = document.getElementById('loginPassword').value;
    var errorBox = document.getElementById('loginError');

    if (!username || !password) {
        if (errorBox) { errorBox.textContent = 'กรุณากรอก Username และรหัสผ่าน'; errorBox.style.display = 'block'; }
        return;
    }

    // 2. แปลงกาย: ถ้ามี @ อยู่แล้วแปลว่าเป็นแอดมินใช้ได้เลย แต่ถ้าไม่มีให้เติม @lean.local
    var fakeEmail = username.includes('@') ? username : username + '@lean.local';

    // (บรรทัดนี้แอบเอาไว้เช็คหลังบ้าน กด F12 ดูได้ว่ามันแปลงร่างเป็นอะไร)
    console.log('ระบบกำลังส่งบัญชีนี้ไปให้ Firebase ตรวจสอบ: ', fakeEmail);

    var btn = document.querySelector('.btn-login-submit'); 
    if (btn) { btn.textContent = 'กำลังเข้าสู่ระบบ...'; btn.disabled = true; }

    try {
        // 3. ส่งอีเมลจำลองไปให้ Firebase
        currentUser = await loginWithEmail(fakeEmail, password);
        await initAppAfterLogin();
    } catch (err) {
        var msg = err.message || 'เข้าสู่ระบบไม่สำเร็จ';
        
        // แปลงข้อความ Error ภาษาอังกฤษให้เป็นภาษาไทยเข้าใจง่ายๆ
        if (msg.includes('invalid-email')) {
            msg = 'รูปแบบ Username ไม่ถูกต้อง (ห้ามมีอักขระแปลกประหลาด)';
        } else if (msg.includes('invalid-credential') || msg.includes('wrong-password') || msg.includes('user-not-found')) {
            msg = 'Username หรือรหัสผ่านไม่ถูกต้อง';
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
        '</div></div></header>' +
        
        '<div class="app-body"><aside class="app-sidebar" id="appSidebar"><nav class="sidebar-nav" style="display:flex; flex-direction:column; height:100%">' +
        '<button class="sidebar-close" onclick="window.toggleSidebar()"><i class="fa-solid fa-xmark"></i></button>' +
        
        '<div class="nav-section" style="flex:1">' +
        '<a href="#" onclick="window.goToPage(\'dashboard\')" class="nav-item active" id="navDashboard"><span class="nav-icon"><i class="fa-solid fa-house"></i></span><span class="nav-label">แดชบอร์ด</span></a>' +
        '<a href="#" onclick="window.goToPage(\'scan\')" class="nav-item" id="navScan"><span class="nav-icon"><i class="fa-solid fa-qrcode"></i></span><span class="nav-label">สแกน QR เตียง</span></a>' + 
        '<a href="#" onclick="window.goToPage(\'patients\')" class="nav-item" id="navPatients"><span class="nav-icon"><i class="fa-solid fa-user-injured"></i></span><span class="nav-label">จัดการผู้ป่วย</span></a>' +
        '<a href="#" onclick="window.goToPage(\'medicines\')" class="nav-item" id="navMedicines"><span class="nav-icon"><i class="fa-solid fa-pills"></i></span><span class="nav-label">จัดการเวชภัณฑ์</span></a>' +
        '<a href="#" onclick="window.goToPage(\'inventory\')" class="nav-item" id="navInventory"><span class="nav-icon"><i class="fa-solid fa-boxes-stacked"></i></span><span class="nav-label">ยอดคงคลัง</span></a>' +
        '<a href="#" onclick="window.goToPage(\'records\')" class="nav-item" id="navRecords"><span class="nav-icon"><i class="fa-solid fa-clipboard-list"></i></span><span class="nav-label">บันทึกการใช้</span></a>' +
        adminMenu + '</div>' +
        
        '<div class="nav-section" style="padding-top:15px; border-top:1px solid rgba(255,255,255,0.1); margin-bottom:15px;">' +
        '<a href="#" onclick="window.handleChangeMyPassword()" class="nav-item" style="color: #cbd5e1;"><span class="nav-icon"><i class="fa-solid fa-key"></i></span><span class="nav-label">เปลี่ยนรหัสส่วนตัว</span></a>' +
        '<a href="#" onclick="window.handleLogout()" class="nav-item" style="color: #fca5a5;"><span class="nav-icon"><i class="fa-solid fa-right-from-bracket"></i></span><span class="nav-label">ออกจากระบบ</span></a>' +
        '</div>' +
        
        '</nav></aside><main class="app-main" id="app"></main></div>';

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

async function renderDashboard(container) {
    // 1. วาดหน้าจอไปก่อน โดยใส่ไอคอนหมุนๆ (Loading) ไว้ตรงตัวเลขบันทึกทั้งหมด
    container.innerHTML =
        '<div class="page-container"><div class="page-header"><div>' +
        '<h1><i class="fa-solid fa-house"></i> แดชบอร์ด</h1></div></div>' + 
        '<div class="page-content"><div class="dashboard-grid"><div class="dashboard-right" style="grid-column:1/-1">' +
        '<div class="stats-container">' +
        '<div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-user-injured"></i></div><div class="stat-number">' + appData.patients.length + '</div><div class="stat-label">ผู้ป่วยทั้งหมด</div></div>' +
        '<div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-pills"></i></div><div class="stat-number">' + appData.inventory.length + '</div><div class="stat-label">รายการยา</div></div>' +
        '<div class="stat-card"><div class="stat-icon"><i class="fa-solid fa-clipboard-list"></i></div><div class="stat-number" id="dashRecordCount"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px; color:#c4b5fd;"></i></div><div class="stat-label">บันทึกทั้งหมด</div></div>' +
        '</div><div class="quick-actions">' +
        '<button class="quick-action-card" onclick="window.goToPage(\'scan\')"><i class="fa-solid fa-qrcode"></i><span>สแกนเตียงผู้ป่วย</span></button>' +
        '<button class="quick-action-card" onclick="window.goToPage(\'patients\')"><i class="fa-solid fa-user-injured"></i><span>จัดการผู้ป่วย</span></button>' +
        '<button class="quick-action-card" onclick="window.goToPage(\'medicines\')"><i class="fa-solid fa-pills"></i><span>จัดการเวชภัณฑ์</span></button>' +
        '<button class="quick-action-card" onclick="window.goToPage(\'inventory\')"><i class="fa-solid fa-boxes-stacked"></i><span>ยอดคงคลัง</span></button>' +
        '<button class="quick-action-card" onclick="window.goToPage(\'records\')"><i class="fa-solid fa-clipboard-list"></i><span>บันทึกการใช้</span></button>' +
        '</div></div></div></div></div>';

    // 2. แอบวิ่งไปถาม Firebase หลังบ้านว่ามียอดเท่าไหร่ แล้วเอามาอัปเดตแทนไอคอนหมุนๆ
    try {
        var totalCount = await getTotalRecordsCount();
        var countEl = document.getElementById('dashRecordCount');
        if (countEl) countEl.textContent = totalCount;
    } catch (e) {
        console.error("ดึงยอดบันทึกรวมไม่สำเร็จ:", e);
        var countEl = document.getElementById('dashRecordCount');
        if (countEl) countEl.textContent = 'Error';
    }
}

function renderPatients(container) {
    // จัดเรียงผังเตียงตามตัวเลข
    var sortedPatients = [...appData.patients].sort(function(a, b) {
        return a.bed.localeCompare(b.bed, undefined, {numeric: true, sensitivity: 'base'});
    });

    var items = sortedPatients.map(function(p) {
        var safeName = escapeHtml(p.name).replace(/'/g, "\\'");
        var safeWard = escapeHtml(p.ward).replace(/'/g, "\\'");
        var safeBed = escapeHtml(p.bed).replace(/'/g, "\\'");

        var isVacant = !p.name || p.name === '-' || p.name === 'ว่าง';
        
        var statusBadge = isVacant 
            ? '<span style="background:#dcfce7; color:#16a34a; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:700; display:flex; align-items:center; gap:4px;"><i class="fa-solid fa-circle-check"></i> ว่าง</span>' 
            : '<span style="background:#ffedd5; color:#f97316; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:700; display:flex; align-items:center; gap:4px;"><i class="fa-solid fa-bed-pulse"></i> ไม่ว่าง</span>';
        
        var cardBorder = isVacant ? 'border-top: 5px solid #10b981;' : 'border-top: 5px solid #f97316;';
        var nameDisplay = isVacant ? '<span style="color:#94a3b8; font-style:italic;">[ ยังไม่มีผู้ป่วย ]</span>' : '👤 <b>' + escapeHtml(p.name) + '</b>';

        var searchText = (p.bed + ' ' + (p.name || '')).toLowerCase();
        var bedStatus = isVacant ? 'vacant' : 'occupied'; 

        var actionButtons = '';
        if (isVacant) {
            actionButtons = 
                '<button type="button" style="flex:1; background:#f8fafc; border:1px solid #cbd5e1; color:#0f172a; padding:12px; border-radius:10px; font-weight:600; font-size:14px; cursor:pointer; display:flex; justify-content:center; align-items:center; gap:6px;" onclick="window.promptMoveBed(\'' + p.id + '\', \'' + safeName + '\', \'' + safeWard + '\', \'' + safeBed + '\')"><i class="fa-solid fa-arrows-turn-to-dots"></i> ย้าย / จัดการ</button>' + 
                '<button type="button" style="width:48px; background:#f8fafc; border:1px solid #cbd5e1; padding:12px; border-radius:10px; color:#475569; cursor:pointer; transition: 0.2s;" onclick="window.showQRCode(\'' + safeBed + '\', \'เตียง ' + safeBed + '\')" onmouseover="this.style.background=\'#e2e8f0\'" onmouseout="this.style.background=\'#f8fafc\'"><i class="fa-solid fa-qrcode"></i></button>';
        } else {
            actionButtons = 
                '<button type="button" onclick="window.goToDispense(\'' + safeBed + '\')" style="flex:1.5; background:#5e3db5; border:none; color:#fff; padding:12px; border-radius:10px; font-weight:600; font-size:14px; cursor:pointer; display:flex; justify-content:center; align-items:center; gap:6px; box-shadow:0 4px 6px rgba(94,61,181,0.2);"><i class="fa-solid fa-pills"></i> จ่ายยา</button>' +
                '<button type="button" style="flex:1; background:#f8fafc; border:1px solid #cbd5e1; color:#0f172a; padding:12px; border-radius:10px; font-weight:600; font-size:13px; cursor:pointer; display:flex; justify-content:center; align-items:center; gap:4px;" onclick="window.promptMoveBed(\'' + p.id + '\', \'' + safeName + '\', \'' + safeWard + '\', \'' + safeBed + '\')"><i class="fa-solid fa-arrows-turn-to-dots"></i> ย้าย</button>' + 
                '<button type="button" style="width:48px; background:#f8fafc; border:1px solid #cbd5e1; padding:12px; border-radius:10px; color:#475569; cursor:pointer; transition: 0.2s;" onclick="window.showQRCode(\'' + safeBed + '\', \'เตียง ' + safeBed + '\')" onmouseover="this.style.background=\'#e2e8f0\'" onmouseout="this.style.background=\'#f8fafc\'"><i class="fa-solid fa-qrcode"></i></button>';
        }

        return '<div class="bed-card" data-search="' + searchText + '" data-status="' + bedStatus + '" style="background:#fff; border-radius:16px; padding:18px; box-shadow:0 4px 15px rgba(0,0,0,0.04); ' + cardBorder + ' display:flex; flex-direction:column; gap:12px;">' +
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
            '<div style="font-size:18px; font-weight:800; color:#1e293b;">เตียง ' + escapeHtml(p.bed) + '</div>' + statusBadge +
            '</div>' +
            '<div style="font-size:15px; color:#334155; min-height:24px;">' + nameDisplay + '</div>' +
            '<div style="font-size:12px; color:#64748b;"><i class="fa-solid fa-hospital"></i> หอผู้ป่วย: ' + escapeHtml(p.ward) + '</div>' +
            '<div style="display:flex; gap:8px; margin-top:10px;">' + actionButtons + '</div></div>';
    }).join('');

    // 🔥 สร้าง UI ช่องค้นหา + Dropdown กรองสถานะเตียง (กาง 100% จัดเรียงแบบ 2 ส่วน)
    var searchHtml = 
        '<div style="display:flex; gap:8px; width:100%;">' +
        '<select id="patientStatusFilter" onchange="window.filterPatientCards()" style="flex-shrink:0; padding:10px 12px; border-radius:12px; border:2px solid #cbd5e1; font-family:inherit; font-size:13px; outline:none; cursor:pointer; background:#f8fafc; color:#475569; font-weight:600;">' +
        '<option value="all">ทุกสถานะ</option>' +
        '<option value="occupied">เฉพาะไม่ว่าง</option>' +
        '<option value="vacant">เฉพาะว่าง</option>' +
        '</select>' +
        '<div style="position:relative; flex:1;">' +
        '<i class="fa-solid fa-magnifying-glass" style="position:absolute; left:14px; top:50%; transform:translateY(-50%); color:#94a3b8;"></i>' +
        '<input type="text" id="patientSearchInput" onkeyup="window.filterPatientCards()" placeholder="พิมพ์เตียง หรือ ชื่อ..." style="width:100%; padding:10px 10px 10px 38px; border-radius:12px; border:2px solid #cbd5e1; font-family:inherit; font-size:14px; outline:none; box-sizing:border-box;">' +
        '</div>' +
        '</div>';

    container.innerHTML =
        '<div class="page-container">' +
        // 🔥 ปรับ Layout เป็นแบบแบ่งชั้น (Title อยู่บน, Search อยู่ล่าง)
        '<div class="page-header" style="display:flex; flex-direction:column; gap:16px; align-items:stretch; margin-bottom:20px;">' +
        '  <div style="display:flex; justify-content:space-between; align-items:center;">' +
        '    <h1 style="margin:0;"><i class="fa-solid fa-hospital-user"></i> ผังเตียงผู้ป่วย</h1>' +
        '    ' + (appData.patients.length > 0 ? '<button class="btn-primary" onclick="window.printAllQRCodes()" style="white-space:nowrap; padding:10px 16px;"><i class="fa-solid fa-print"></i> ปริ้นท์ QR</button>' : '') +
        '  </div>' +
        '  <div style="width:100%;">' + searchHtml + '</div>' +
        '</div>' +
        '<div class="page-content">' +
        '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px;">' + 
        (appData.patients.length === 0 ? '<div style="grid-column:1/-1;"><p class="empty"><i class="fa-regular fa-folder-open"></i><br>ไม่มีข้อมูลผังเตียง</p></div>' : items) + 
        '</div></div></div>';
}

function promptMoveBed(id, currentName, currentWard, currentBed) {
    var sortedBeds = [...appData.patients].sort(function(a, b) {
        return a.bed.localeCompare(b.bed, undefined, {numeric: true});
    });

    var optionsHtml = sortedBeds.map(function(p) {
        var isVacant = !p.name || p.name === '-' || p.name === 'ว่าง';
        
        // 🔥 [เปลี่ยนสีตรงนี้] เปลี่ยนจุดแดง 🔴 เป็นส้ม 🟠 และเปลี่ยนสีพื้นหลัง/ตัวหนังสือ
        var statusBadge = isVacant 
            ? '<span style="background:#dcfce7; color:#16a34a; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700;">🟢 ว่าง</span>' 
            : '<span style="background:#ffedd5; color:#f97316; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700;">🟠 ไม่ว่าง</span>';
            
        var isCurrent = p.id === id;
        var bedLabel = 'เตียง ' + escapeHtml(p.bed);
        var displayName = isVacant ? 'ว่าง' : escapeHtml(p.name);
        var searchText = (bedLabel + ' ' + displayName).toLowerCase(); 
        
        return '<div id="bed-opt-' + p.id + '" class="swal-bed-item" onclick="window.selectBedOption(\'' + p.id + '\', \'' + bedLabel + '\')" data-text="' + searchText + '" style="padding:12px 16px; border-bottom:1px solid #f1f5f9; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:0.2s; ' + (isCurrent ? 'background:#f0fdf4; border-left:4px solid #16a34a;' : 'background:#fff; border-left:4px solid transparent;') + '">' +
               '<div style="text-align:left;">' +
               '<div style="font-weight:700; color:#1e293b; font-size:15px;">' + bedLabel + (isCurrent ? ' <span style="color:#16a34a;font-size:12px;">(ปัจจุบัน)</span>' : '') + '</div>' +
               '<div style="font-size:12px; color:#64748b;">👤 ' + displayName + ' | วอร์ด: ' + escapeHtml(p.ward) + '</div>' +
               '</div>' + statusBadge +
               '</div>';
    }).join('');

    var initialBedLabel = 'เตียง ' + currentBed;

    Swal.fire({
        title: 'จัดการผู้ป่วย / ย้ายเตียง',
        html:
            '<div style="text-align:left; font-family:inherit;">' +
            '  <div style="background:#f8fafc; padding:16px; border-radius:14px; border:1px solid #e2e8f0; margin-bottom:18px;">' +
            '    <div style="font-size:12.5px; color:#64748b; font-weight:600; margin-bottom:6px;">ชื่อผู้ป่วยที่กำลังดำเนินการ</div>' +
            '    <div style="display:flex; gap:10px;">' +
            '      <input id="swal-move-name" style="flex:1; border:none; background:transparent; font-size:16px; font-weight:700; color:#1e293b; outline:none; padding:4px;" value="' + currentName + '" disabled>' +
            '      <button type="button" id="btn-unlock-name" style="background:#e0f2fe; color:#0284c7; border:none; border-radius:10px; width:40px; height:40px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 4px rgba(2,132,199,0.1);" title="แก้ไขชื่อ/จำหน่าย">' +
            '        <i class="fa-solid fa-user-pen"></i>' +
            '      </button>' +
            '    </div>' +
            '  </div>' +
            '  <div style="margin-bottom:8px; font-size:13.5px; font-weight:700; color:#334155;">เลือกเตียงเป้าหมาย:</div>' +
            '  <div style="position:relative;">' +
            '    <div id="swal-dd-header" onclick="window.toggleBedDropdown()" style="background:#fff; border:2px solid #cbd5e1; border-radius:12px; padding:14px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; font-weight:600; color:#1e293b; box-shadow:0 2px 5px rgba(0,0,0,0.02); transition:border-color 0.2s;">' +
            '      <span id="swal-dd-text">' + initialBedLabel + '</span>' +
            '      <i id="swal-dd-icon" class="fa-solid fa-chevron-down" style="color:#64748b; transition:transform 0.3s;"></i>' +
            '    </div>' +
            '    <div id="swal-dd-body" style="display:none; background:#fff; border:2px solid #5e3db5; border-radius:12px; margin-top:6px; box-shadow:0 10px 25px rgba(0,0,0,0.1); overflow:hidden;">' +
            '      <div style="padding:10px; border-bottom:1px solid #e2e8f0; background:#f8fafc;">' +
            '        <div style="position:relative;">' +
            '          <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:#94a3b8;"></i>' +
            '          <input type="text" id="swal-bed-search" placeholder="พิมพ์เตียง หรือ ชื่อคนไข้..." style="width:100%; padding:10px 10px 10px 36px; border-radius:8px; border:1px solid #cbd5e1; box-sizing:border-box; font-size:14px; font-family:inherit; outline:none;" onkeyup="window.filterBedOptions()">' +
            '        </div>' +
            '      </div>' +
            '      <div id="swal-bed-list" style="max-height:220px; overflow-y:auto; background:#fff;">' + optionsHtml + '</div>' +
            '    </div>' +
            '  </div>' +
            '  <input type="hidden" id="swal-move-target-id" value="' + id + '">' +
            '</div>',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-check"></i> ยืนยันการเปลี่ยนแปลง',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#5e3db5',
        cancelButtonColor: '#94a3b8',
        didOpen: function() {
            var unlockBtn = document.getElementById('btn-unlock-name');
            var nameInput = document.getElementById('swal-move-name');
            if (unlockBtn && nameInput) {
                unlockBtn.addEventListener('click', function() {
                    nameInput.disabled = !nameInput.disabled;
                    if (!nameInput.disabled) {
                        nameInput.focus();
                        nameInput.style.background = '#fff';
                        nameInput.style.border = '2px dashed #93c5fd';
                        nameInput.style.borderRadius = '8px';
                        unlockBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                        unlockBtn.style.background = '#10b981';
                        unlockBtn.style.color = '#fff';
                    } else {
                        nameInput.style.background = 'transparent';
                        nameInput.style.border = 'none';
                        unlockBtn.innerHTML = '<i class="fa-solid fa-user-pen"></i>';
                        unlockBtn.style.background = '#e0f2fe';
                        unlockBtn.style.color = '#0284c7';
                    }
                });
            }
        },
        preConfirm: function() {
            var name = document.getElementById('swal-move-name').value.trim();
            var targetId = document.getElementById('swal-move-target-id').value;
            if (!name) { Swal.showValidationMessage('กรุณาระบุชื่อผู้ป่วย (หรือพิมพ์ - เพื่อว่างเตียง)'); return false; }
            if (!targetId) { Swal.showValidationMessage('กรุณาคลิกเลือกเตียงเป้าหมายจากรายการ'); return false; }
            return { name: name, targetId: targetId };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            var newName = result.value.name;
            var targetId = result.value.targetId;

            var currentBedDoc = appData.patients.find(function(p) { return p.id === id; });
            var targetBedDoc = appData.patients.find(function(p) { return p.id === targetId; });

            if (targetId === id) {
                Swal.fire({ title: 'กำลังบันทึกข้อมูล...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                try {
                    await updatePatientDoc(id, { name: newName, ward: currentBedDoc.ward, bed: currentBedDoc.bed });
                    Toast.fire({ icon: 'success', title: 'อัปเดตข้อมูลสำเร็จ' });
                    renderApp();
                } catch (err) { Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message }); }
            } 
            else {
                var targetIsVacant = !targetBedDoc.name || targetBedDoc.name === '-' || targetBedDoc.name === 'ว่าง';
                
                if (targetIsVacant) {
                    Swal.fire({ title: 'กำลังย้ายเตียง...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                    try {
                        await updatePatientDoc(targetId, { name: newName, ward: targetBedDoc.ward, bed: targetBedDoc.bed });
                        await updatePatientDoc(id, { name: '-', ward: currentBedDoc.ward, bed: currentBedDoc.bed });
                        Toast.fire({ icon: 'success', title: 'ย้ายเตียงสำเร็จ' });
                        renderApp();
                    } catch (err) { Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message }); }
                } 
                else {
                    Swal.fire({
                        title: 'เตียงนี้มีผู้ป่วยอยู่แล้ว!',
                        html: 'เตียงหมายเลข <b>' + targetBedDoc.bed + '</b> มีคุณ <b>' + targetBedDoc.name + '</b> อยู่<br><br><span style="color:#5e3db5;font-weight:700;">ต้องการ "สลับตำแหน่งเตียง" คู่นี้ใช่หรือไม่?</span>',
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: 'ยืนยันสลับเตียง',
                        cancelButtonText: 'ยกเลิก',
                        showLoaderOnConfirm: true,
                        preConfirm: async () => {
                            try {
                                var originalTargetName = targetBedDoc.name;
                                await updatePatientDoc(targetId, { name: newName, ward: targetBedDoc.ward, bed: targetBedDoc.bed });
                                await updatePatientDoc(id, { name: originalTargetName, ward: currentBedDoc.ward, bed: currentBedDoc.bed });
                                return true;
                            } catch (error) {
                                Swal.showValidationMessage(`เกิดข้อผิดพลาด: ${error.message}`);
                                return false;
                            }
                        },
                        allowOutsideClick: () => !Swal.isLoading()
                    }).then((swapResult) => {
                        if (swapResult.isConfirmed) {
                            Toast.fire({ icon: 'success', title: 'สลับตำแหน่งเตียงสำเร็จ' });
                            renderApp();
                        }
                    });
                }
            }
        }
    });
}

function renderMedicines(container) {
    var items = appData.inventory.map(function(m) {
        // 🔥 [แก้ไขตรงนี้] เปลี่ยนบาร์โค้ดให้กลายเป็น "ปุ่มกด" เพื่อเปิด Pop-up
        var barcodeDisplay = m.barcode ? 
            '<button type="button" onclick="window.showBarcode(\'' + escapeHtml(m.barcode) + '\', \'' + escapeHtml(m.name).replace(/'/g, "\\'") + '\')" style="margin-top:8px; padding:6px 12px; font-size:12px; background:#f3effa; color:#5e3db5; border:1px solid #d8b4fe; border-radius:8px; cursor:pointer; display:inline-block;"><i class="fa-solid fa-barcode"></i> ดูบาร์โค้ด</button>' : '';
        
        return '<div class="list-item" style="' + (m.stock <= m.reorder ? 'background:#fef2f2' : '') + '">' +
            '<div class="item-info"><div class="item-title">' + escapeHtml(m.name) + '</div>' +
            '<div class="item-detail">คงเหลือ: ' + m.stock + ' ' + escapeHtml(m.unit) + '</div>' +
            barcodeDisplay +
            (m.stock <= m.reorder ? '<div style="color:#ef4444;margin-top:5px;font-weight:700"><i class="fa-solid fa-triangle-exclamation"></i> ต่ำกว่าเตือนใหม่</div>' : '') +
            '</div><div style="display:flex;gap:8px">' +
            '<button class="btn-delete" onclick="window.deleteMedicine(\'' + m.id + '\')"><i class="fa-solid fa-trash"></i> ลบ</button></div></div>';
    }).join('');

    container.innerHTML =
        '<div class="page-container"><div class="page-header"><h1><i class="fa-solid fa-pills"></i> จัดการเวชภัณฑ์</h1></div>' +
        '<div class="page-content"><form class="form-section" id="addMedicineForm"><h2>เพิ่มเวชภัณฑ์ใหม่</h2>' +
        '<div class="form-row">' +
        '<div class="form-group" style="grid-column: 1 / -1"><label>ชื่อเวชภัณฑ์</label><input type="text" id="medicineName" placeholder="เช่น Paracetamol 500mg" required></div></div>' +
        
        // 🔥 [เพิ่มใหม่] ช่องใส่รหัสบาร์โค้ด
        '<div class="form-row"><div class="form-group" style="grid-column: 1 / -1"><label><i class="fa-solid fa-barcode"></i> รหัสบาร์โค้ดกล่องยา (ถ้ามี)</label>' +
        '<div style="display:flex; gap:10px;">' +
        '<input type="text" id="medicineBarcode" placeholder="พิมพ์ตัวเลข หรือสแกน..." style="flex:1; border:2px solid #e2e8f0; border-radius:10px; padding:10px;">' +
        // เตรียมปุ่มเปิดกล้องไว้สำหรับสเต็ปถัดไป
        '<button type="button" class="btn-secondary" onclick="window.startBarcodeScanner(function(code){ document.getElementById(\'medicineBarcode\').value = code; })" style="white-space:nowrap;"><i class="fa-solid fa-camera"></i> สแกนรหัส</button>' +
        '</div></div></div>' +

        '<div class="form-row"><div class="form-group"><label>จำนวนคงเหลือ</label><input type="number" id="medicineStock" placeholder="0" min="0" required></div>' +
        '<div class="form-group"><label>หน่วยนับ</label><select id="medicineUnit" required>' +
        '<option value="">-- เลือกหน่วยนับ --</option>' +
        '<option value="ชิ้น">ชิ้น</option>' +
        '<option value="เม็ด">เม็ด</option>' +
        '<option value="ก้อน">ก้อน</option>' +
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
// ฟังก์ชันวาดหน้าสแกน (พร้อมระบบ Live Search Dropdown)
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
        '<button class="mode-btn" onclick="window.switchScanMode(\'manual\')"><i class="fa-solid fa-keyboard"></i> พิมพ์ค้นหา</button></div>' +
        '<div id="cameraMode" class="scan-mode active">' + (supportsLiveCamera ? webMedHtml : iosMedHtml) + '</div>' +
        
        // 🔥 [อัปเกรด] โซนพิมพ์ค้นหา เปลี่ยนเป็นระบบ Live Search + Dropdown
        '<div id="manualMode" class="scan-mode" style="display:none">' +
        '<div style="margin-bottom: 8px; font-size: 14px; font-weight: 700; color: #334155;">ป้อนชื่อผู้ป่วย หรือ เลขเตียง เพื่อค้นหา:</div>' +
        '<div style="position: relative; width: 100%;">' +
        '  <i class="fa-solid fa-magnifying-glass" style="position: absolute; left: 16px; top: 16px; color: #94a3b8;"></i>' +
        '  <input type="text" id="manualScanInput" onkeyup="window.handleManualScanSearch()" autocomplete="off" placeholder="เช่น 1102 หรือ สมหญิง..." style="width: 100%; padding: 14px 14px 14px 44px; border-radius: 12px; border: 2px solid #cbd5e1; font-family: inherit; font-size: 15px; outline: none; box-sizing: border-box; transition: 0.2s;" onfocus="this.style.borderColor=\'#5e3db5\'" onblur="this.style.borderColor=\'#cbd5e1\'">' +
        '  <div id="manualScanDropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: #fff; border: 2px solid #5e3db5; border-radius: 12px; margin-top: 6px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); max-height: 250px; overflow-y: auto; z-index: 9999;"></div>' +
        '</div></div>' +
        
        '<div id="scanResult" class="info-box" style="display:none;margin-top:20px"></div>' +
        '</div></div>' +
        
        // ------------------ โซน Modal จ่ายยา ------------------
        '<div id="scanModalOverlay" style="position:fixed;inset:0;background:rgba(46,37,66,0.55);backdrop-filter:blur(8px);display:none;align-items:center;justify-content:center;z-index:9999;padding:20px">' +
        '<div class="form-section" id="recordForm" style="background:#fff;border-radius:24px;border-top:6px solid var(--c-primary);box-shadow:0 25px 60px rgba(46,37,66,0.4);padding:30px 25px;max-width:500px;width:100%;margin:0;max-height:90vh;overflow-y:auto">' +
        '<h2 style="margin-top:0;margin-bottom:16px;color:#1e293b;border-bottom:2px solid #f1f5f9;padding-bottom:10px"><i class="fa-solid fa-clipboard-check" style="color:#10b981"></i> ยืนยันการจ่ายเวชภัณฑ์</h2>' +
        '<div class="form-group"><label style="font-weight:600">ผู้ป่วยที่ระบุ (เตียง)</label><input type="text" id="recordPatientDisplay" style="background:#f8fafc;font-weight:700;color:#5e3db5" readonly></div>' +
        
        '<div class="form-group"><label style="font-weight:600"><i class="fa-solid fa-clock"></i> เวรปฏิบัติงาน</label>' +
        '<select id="recordShiftDisplay" onchange="window.lastSelectedShift = this.value" style="width:100%;padding:10px;border-radius:10px;border:2px solid #cbd5e1;font-weight:600;color:#334155;font-family:inherit;">' +
        '<option value="เช้า">เวรเช้า</option>' +
        '<option value="บ่าย">เวรบ่าย</option>' +
        '<option value="ดึก">เวรดึก</option>' +
        '</select></div>' +
        
        '<div style="margin-top:15px;margin-bottom:8px;font-weight:700;color:#334155;font-size:0.95rem;display:flex;justify-content:space-between;align-items:center">' +
        '<span>รายการเวชภัณฑ์ที่จ่าย</span>' +
        '<button type="button" onclick="window.addMedicineRow()" style="background:#5e3db5;color:#fff;border:none;padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600"><i class="fa-solid fa-plus"></i> เพิ่มรายการ</button>' +
        '</div>' +
        
        '<div id="multiMedicineContainer" style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px;padding-bottom:140px;"></div>' +
        
        '<div style="display:flex;gap:12px;margin-top:24px">' +
        '<button class="btn-primary" onclick="window.submitMultiRecords()" style="flex:1;padding:12px"><i class="fa-solid fa-check"></i> บันทึกทั้งหมด</button>' +
        '<button class="btn-secondary" onclick="window.cancelRecord()" style="flex:1;padding:12px;background:#ef4444;color:#fff"><i class="fa-solid fa-xmark"></i> ยกเลิก</button>' +
        '</div></div></div>';

    if (supportsLiveCamera) {
        setTimeout(function() { 
            if (window.skipAutoCamera) {
                window.skipAutoCamera = false; 
            } else {
                startScanning(); 
            }
        }, 200);
    }
}

// ==================== SCAN MODE TOGGLE ====================
function switchScanMode(mode) {
    var cam = document.getElementById('cameraMode');
    var man = document.getElementById('manualMode');
    document.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
    if (mode === 'camera') {
        if (cam) cam.style.display = 'block';
        if (man) man.style.display = 'none';
        var camBtn = document.querySelector('[onclick="window.switchScanMode(\'camera\')"]');
        if (camBtn) camBtn.classList.add('active');
        if (supportsLiveCamera && !videoStream) startScanning();
    } else {
        stopScanning();
        if (cam) cam.style.display = 'none';
        if (man) man.style.display = 'block';
        var manBtn = document.querySelector('[onclick="window.switchScanMode(\'manual\')"]');
        if (manBtn) manBtn.classList.add('active');
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
    rowHtml.style.cssText = 'background:#f8fafc;padding:14px;border-radius:12px;border:1px solid #e2e8f0;position:relative;margin-bottom:10px;box-sizing:border-box;z-index:1;';

    rowHtml.innerHTML = 
        '<button type="button" onclick="document.getElementById(\''+rowId+'\').remove()" style="position:absolute;right:14px;top:14px;background:none;border:none;color:#ef4444;cursor:pointer;font-size:14px;z-index:10;padding:4px;transition:color 0.2s" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#ef4444\'" title="ลบรายการนี้">' +
        '<i class="fa-solid fa-trash-can"></i>' +
        '</button>' +
        
        '<div class="form-group" style="position:relative;margin-bottom:8px;margin-right:24px">' +
        '<label style="font-size:0.85rem;color:#64748b;margin-bottom:4px;display:block">ค้นหาหรือสแกนเวชภัณฑ์</label>' +
        
        // 🔥 [อัปเกรด] เพิ่มช่องค้นหา และ ปุ่มกล้องสแกน (สีม่วง) ไว้ข้างๆ กัน
        '<div style="display:flex; gap:8px; position:relative;">' +
        '<input type="hidden" class="med-select-field" id="id_'+rowId+'" value="">' +
        '<div style="position:relative; flex:1;">' +
        '<input type="text" id="input_'+rowId+'" placeholder="🔍 พิมพ์ชื่อยา..." onfocus="window.openSearchSug(\''+rowId+'\')" oninput="window.filterSearchSug(\''+rowId+'\')" style="width:100%;padding:12px 35px 12px 12px;font-size:14px;border-radius:10px;border:2px solid #cbd5e1;background:#fff;box-sizing:border-box">' +
        '<button type="button" onclick="window.clearMedicineInput(\''+rowId+'\')" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;z-index:99;padding:6px;display:none;pointer-events:auto;" id="clear_'+rowId+'">' +
        '<i class="fa-solid fa-circle-xmark"></i>' +
        '</button>' +
        '</div>' +
        '<button type="button" onclick="window.scanMedicineForRow(\''+rowId+'\')" style="background:#5e3db5; color:#fff; border:none; border-radius:10px; padding:0 16px; font-size:18px; cursor:pointer; box-shadow:0 4px 6px rgba(94,61,181,0.2);"><i class="fa-solid fa-barcode"></i></button>' +
        '</div>' +
        
        '<div id="sug_'+rowId+'" class="google-sug-box" style="position:absolute;left:0;right:0;top:100%;background:#fff;border:2px solid #5e3db5;border-radius:0 0 12px 12px;box-shadow:0 8px 24px rgba(0,0,0,0.15);display:none;z-index:9999;max-height:180px;overflow-y:auto;box-sizing:border-box"></div>' +
        '</div>' +
        
        '<div class="form-group" style="margin:0">' +
        '<label style="font-size:0.85rem;color:#64748b;margin-bottom:4px;display:block">จำนวนที่จ่าย</label>' +
        '<input type="number" class="med-qty-field" min="1" value="1" style="width:100%;padding:12px;border-radius:10px;border:2px solid #cbd5e1;box-sizing:border-box" required>' +
        '</div>';

    container.prepend(rowHtml);
}

// ✅ [เพิ่มตามคำขอ] ฟังก์ชันทำงานล้างค่าข้อมูลและการจัดเลเยอร์ให้กลับเป็นปกติเมื่อคลิกปุ่ม X
function clearMedicineInput(rowId) {
    var input = document.getElementById('input_' + rowId);
    var idInput = document.getElementById('id_' + rowId);
    var clearBtn = document.getElementById('clear_' + rowId);
    var sugBox = document.getElementById('sug_' + rowId);

    if (input) input.value = '';
    if (idInput) idInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (sugBox) sugBox.style.display = 'none';

    var parentRow = document.getElementById(rowId);
    if (parentRow) parentRow.style.zIndex = '1';
}

// ฟังก์ชันเปิด Dropdown เมื่อคลิกโฟกัสที่ช่องค้นหา
function openSearchSug(rowId) {
    // รีเซ็ตค่าแถวอื่นๆ ลงด้านล่างและพับหุบหน้าต่างเก็บไว้ก่อน
    document.querySelectorAll('.medicine-form-row').forEach(function(row) { row.style.zIndex = '1'; });
    document.querySelectorAll('.google-sug-box').forEach(function(box) { box.style.display = 'none'; });
    var sugBox = document.getElementById('sug_' + rowId);
    if (!sugBox) return;
    
    // ดีดแถวปัจจุบันที่กำลังกรอกขึ้นมาอยู่ด้านบนสุด (z-index: 50) ป้องกันโดนแถวถัดไปด้านล่างบัง
    var parentRow = document.getElementById(rowId);
    if (parentRow) parentRow.style.zIndex = '50';
    
    var text = document.getElementById('input_' + rowId).value;
    var clearBtn = document.getElementById('clear_' + rowId);
    if (clearBtn) clearBtn.style.display = text.length > 0 ? 'block' : 'none';
    
    renderSuggestions(rowId, text);
    sugBox.style.display = 'block';
}

// ฟังก์ชันกรองข้อมูลใน Dropdown แบบ Real-time ตามที่คีย์พิมพ์จริง
function filterSearchSug(rowId) {
    var text = document.getElementById('input_' + rowId).value;
    var clearBtn = document.getElementById('clear_' + rowId);
    if (clearBtn) clearBtn.style.display = text.length > 0 ? 'block' : 'none';

    renderSuggestions(rowId, text);
    // ล้าง ID ที่เคยเลือกไว้เมื่อผู้ใช้พิมพ์แก้ข้อความใหม่ กันเลือกยาผิดตัวจากค่าค้าง
    var idInput = document.getElementById('id_' + rowId);
    if (idInput) idInput.value = '';
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
        box.innerHTML = '<div style="padding:12px;color:#94a3b8;font-size:13px;text-align:center">ไม่พบข้อมูลเวชภัณฑ์</div>';
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
    var idInput = document.getElementById('id_' + rowId);
    if (idInput) idInput.value = medId;
    
    var textInput = document.getElementById('input_' + rowId);
    if (textInput) textInput.value = medName;
    
    var clearBtn = document.getElementById('clear_' + rowId);
    if (clearBtn) clearBtn.style.display = 'block';
    
    var box = document.getElementById('sug_' + rowId); 
    if (box) box.style.display = 'none';

    // คืนค่าความสูงเลเยอร์กลับมาเป็นปกติเมื่อเลือกเสร็จสิ้นภารกิจ
    var parentRow = document.getElementById(rowId);
    if (parentRow) parentRow.style.zIndex = '1';
}

// ตรวจจับถ้าคลิกพื้นที่ว่างข้างนอกป็อปอัพ ให้ช่วยพับหุบ Dropdown เก็บให้เรียบร้อย
document.addEventListener('click', function(e) {
    if (!e.target.closest('.form-group')) {
        document.querySelectorAll('.google-sug-box').forEach(function(box) { box.style.display = 'none'; });
        document.querySelectorAll('.medicine-form-row').forEach(function(row) { row.style.zIndex = '1'; });
    }
});

// ระบบ Search กรองรายชื่อยาใน Dropdown อัตโนมัติ (Real-time Filter) — legacy, ไม่ได้ใช้กับ UI ปัจจุบันแล้ว
// (UI ตอนนี้ใช้ openSearchSug/filterSearchSug/selectSugItem แทน select+datalist เดิม)
function filterMedicineOptions(inputEl, rowId) {
    var filterText = inputEl.value.toLowerCase().trim();
    var selectEl = document.querySelector('#' + rowId + ' .med-select-field');
    if (!selectEl) return;

    var options = selectEl.options;
    var firstMatch = null;

    for (var i = 0; i < options.length; i++) {
        if (i === 0) continue;
        var medName = options[i].getAttribute('data-name') || '';
        if (medName.indexOf(filterText) > -1) {
            options[i].style.display = 'block';
            if (!firstMatch) firstMatch = options[i].value;
        } else {
            options[i].style.display = 'none';
        }
    }
    if (firstMatch && filterText.length > 1) selectEl.value = firstMatch;
}

function renderInventory(container) {
    var items = appData.inventory.map(function(item) {
        var isLow = item.stock <= item.reorder;
        
        return '<div class="inventory-card" style="background:#fff; padding:18px; border-radius:16px; box-shadow:0 4px 12px rgba(0,0,0,0.03); border:1px solid ' + (isLow ? '#fca5a5' : '#e2e8f0') + '; display:flex; flex-direction:column; justify-content:space-between">' +
            '<div>' +
            '<div class="inventory-name" style="font-weight:700; font-size:1.15rem; color:#1e293b; margin-bottom:12px">' + escapeHtml(item.name) + '</div>' +
            '<div class="inventory-row" style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:14px; color:#475569"><span>จำนวนคงเหลือ:</span><span style="font-weight:800; color:' + (isLow ? '#ef4444' : '#10b981') + '; font-size:1.15rem">' + item.stock + ' <span style="font-size:13px; font-weight:500; color:#64748b">' + escapeHtml(item.unit) + '</span></span></div>' +
            '<div class="inventory-row" style="display:flex; justify-content:space-between; margin-bottom:12px; font-size:13px; color:#94a3b8"><span>เตือนเมื่อเหลือน้อยกว่า:</span><span>' + item.reorder + '</span></div>' +
            
            // ป้ายเตือนสีแดงถ้าของใกล้หมด
            (isLow ? '<div style="color:#ef4444; font-size:12px; font-weight:700; background:#fef2f2; padding:8px 10px; border-radius:8px; margin-bottom:15px; text-align:center"><i class="fa-solid fa-triangle-exclamation"></i> สินค้าใกล้หมด! ต้องสั่งเพิ่ม</div>' : '') +
            '</div>' +
            
            // ปุ่มเติมสต็อก
            '<button type="button" onclick="window.promptRestock(\'' + item.id + '\', \'' + escapeHtml(item.name).replace(/'/g, "\\'") + '\', \'' + escapeHtml(item.unit).replace(/'/g, "\\'") + '\')" style="width:100%; padding:12px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:10px; color:#0284c7; font-weight:700; font-size:13.5px; cursor:pointer; transition:background 0.2s"><i class="fa-solid fa-boxes-packing"></i> เติมสต็อก</button>' +
            '</div>';
    }).join('');

    container.innerHTML =
        '<div class="page-container"><div class="page-header"><h1><i class="fa-solid fa-boxes-stacked"></i> ยอดคงคลัง</h1></div>' +
        '<div class="page-content"><div class="list-section"><div class="inventory-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px">' +
        (appData.inventory.length === 0 ? '<p class="empty" style="grid-column:1/-1; text-align:center; padding:40px 0; color:#94a3b8"><i class="fa-regular fa-folder-open" style="font-size:32px; margin-bottom:10px"></i><br>ไม่มีรายการเวชภัณฑ์</p>' : items) +
        '</div></div></div></div>';
}
// ฟังก์ชันเรียก Pop-up รับเข้าสต็อก
function promptRestock(id, name, unit) {
    Swal.fire({
        title: 'รับเข้าเวชภัณฑ์',
        html: 'ระบุจำนวน <b>' + escapeHtml(name) + '</b> ที่ต้องการเติมเข้าคลัง<br><span style="font-size:13px;color:#64748b">(หน่วยนับ: ' + escapeHtml(unit) + ')</span>',
        input: 'number',
        inputAttributes: { min: 1, step: 1 },
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-plus"></i> ยืนยันการเติม',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#0284c7',
        cancelButtonColor: '#94a3b8',
        inputValidator: (value) => {
            if (!value || value <= 0) {
                return 'กรุณาระบุจำนวนให้มากกว่า 0';
            }
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            var addedQty = parseInt(result.value);
            try {
                await restockMedicineDoc(id, addedQty);
                Toast.fire({
                    icon: 'success',
                    title: 'เติมสต็อก ' + addedQty + ' ' + unit + ' เรียบร้อย!'
                });
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: err.message });
            }
        }
    });
}

function renderRecords(container) {
    var items = serverRecords.map(function(r) {
        var itemCount = r.items ? r.items.length : 1;
        // 🔥 ถ้าบิลถูกยกเลิก ให้โชว์ป้ายสีแดงและทำสีการ์ดให้จางลง
        var isVoided = r.voided === true;
        var voidStyle = isVoided ? 'opacity:0.6; filter:grayscale(100%); border-left:5px solid #94a3b8;' : 'border-left:5px solid #5e3db5;';
        var voidBadge = isVoided ? '<span style="background:#fee2e2;color:#ef4444;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;margin-left:10px;"><i class="fa-solid fa-ban"></i> ถูกยกเลิก</span>' : '';

        return '<div class="record-card" style="margin-bottom:15px; background:#fff; padding:18px; border-radius:16px; box-shadow:0 4px 12px rgba(0,0,0,0.03); ' + voidStyle + '">' +
            '<div class="record-date" style="color:#94a3b8; font-size:12px; margin-bottom:8px"><i class="fa-regular fa-clock"></i> ' + formatTimestamp(r.createdAt) + voidBadge + '</div>' +
            '<div class="record-row" style="margin-bottom:6px"><span class="label" style="font-weight:600; color:#64748b">ผู้ป่วย:</span> <span style="font-weight:700; color:#5e3db5; font-size:1.05rem">' + escapeHtml(r.patientName) + '</span></div>' +
            '<div class="record-row" style="margin-bottom:12px"><span class="label" style="font-weight:500; color:#94a3b8; font-size:12px">บันทึกโดย:</span> <span style="font-size:13px; color:#475569">' + escapeHtml(r.performedByName || '-') + '</span></div>' +
            '<button type="button" onclick="window.viewRecordDetails(\'' + r.id + '\')" style="width:100%; padding:12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; color:#5e3db5; font-weight:600; font-size:13px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:background 0.2s">' +
            '<span><i class="fa-solid fa-list-check" style="margin-right:6px"></i> ดูรายละเอียดเวชภัณฑ์ (' + itemCount + ' รายการ)</span>' +
            '<i class="fa-solid fa-chevron-right" style="font-size:11px; color:#94a3b8"></i>' +
            '</button>' +
            '</div>';
    }).join('');

    var disablePrev = currentRecordPage === 1 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : '';
    var disableNext = !hasNextPage ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : '';
    
    var paginationHtml = 
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:20px; padding-top:15px; border-top:2px dashed #e2e8f0;">' +
        '<button class="btn-secondary" onclick="window.changeRecordPage(-1)" ' + disablePrev + '><i class="fa-solid fa-chevron-left"></i> ย้อนกลับ</button>' +
        '<span style="font-size:14px; color:#475569; font-weight:700;">หน้า ' + currentRecordPage + '</span>' +
        '<button class="btn-secondary" onclick="window.changeRecordPage(1)" ' + disableNext + '>ถัดไป <i class="fa-solid fa-chevron-right"></i></button>' +
        '</div>';

    container.innerHTML =
        '<div class="page-container">' +
        '<div class="page-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:20px">' +
        '<h1><i class="fa-solid fa-clipboard-list"></i> บันทึกการใช้เวชภัณฑ์</h1>' +
        '<button type="button" onclick="window.openExportModal()" style="background:#16a34a; color:#fff; border:none; padding:10px 18px; border-radius:12px; font-weight:600; font-size:14px; cursor:pointer; display:inline-flex; align-items:center; gap:8px; box-shadow:0 4px 12px rgba(22,163,74,0.2)">' +
        '<i class="fa-solid fa-file-excel"></i> ส่งออก Excel (.xlsx)' +
        '</button>' +
        '</div>' +
        '<div class="page-content">' +
        '<div class="records-grid" style="display:flex; flex-direction:column; gap:4px">' +
        (serverRecords.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ไม่มีบันทึก</p>' : items + paginationHtml) +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div id="recordModalOverlay" style="position:fixed;inset:0;background:rgba(46,37,66,0.6);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;z-index:9999;padding:20px"></div>';
}

// ฟังก์ชันเวลากดเปลี่ยนหน้า ให้ขึ้นโชว์หมุนๆ แล้วดึงข้อมูลหน้าถัดไปสดๆ
async function changeRecordPage(direction) {
    currentRecordPage += direction;
    var appEl = document.getElementById('app');
    if (appEl) appEl.innerHTML = '<div style="text-align:center;padding:50px;color:#5e3db5;"><i class="fa-solid fa-spinner fa-spin" style="font-size:32px;"></i></div>';
    await loadRecordsFromServer();
    renderApp();
}

function viewRecordDetails(recordId) {
    var r = serverRecords.find(function(rec) { return rec.id === recordId; });
    if (!r) { Swal.fire('ไม่พบข้อมูล', 'ไม่สามารถเปิดดูรายละเอียดเวชภัณฑ์รายการนี้ได้', 'error'); return; }

    var overlay = document.getElementById('recordModalOverlay');
    if (!overlay) return;

    var medListHtml = '';
    if (r.items && Array.isArray(r.items)) {
        medListHtml = r.items.map(function(item) {
            return '<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px dashed #e2e8f0;font-size:14.5px">' +
                   '<span style="color:#334155"><i class="fa-solid fa-pills" style="color:#8e7cc3; margin-right:8px"></i>' + escapeHtml(item.medicineName) + '</span>' +
                   '<span style="font-weight:700;color:#1e293b;white-space:nowrap;margin-left:10px">x ' + item.quantity + ' <span style="font-size:12px;color:#64748b;font-weight:500">' + escapeHtml(item.unit || 'ชิ้น') + '</span></span>' +
                   '</div>';
        }).join('');
    } else {
        medListHtml = '<div style="display:flex;justify-content:space-between;padding:12px 0;font-size:14.5px">' +
                      '<span style="color:#334155"><i class="fa-solid fa-pills" style="color:#8e7cc3; margin-right:8px"></i>' + escapeHtml(r.medicineName || '-') + '</span>' +
                      '<span style="font-weight:700;color:#1e293b;white-space:nowrap;margin-left:10px">x ' + (r.quantity || 0) + '</span>' +
                      '</div>';
    }

    // 🔥 โลจิกแสดงปุ่มลบ เฉพาะแอดมิน และเฉพาะบิลที่ยังไม่เคยโดนยกเลิก
    var voidActionHtml = '';
    if (r.voided) {
        voidActionHtml = '<div style="margin-top:15px;padding:12px;background:#fef2f2;color:#ef4444;border-radius:12px;font-weight:600;text-align:center;font-size:13px;"><i class="fa-solid fa-circle-xmark"></i> บิลนี้ถูกยกเลิกแล้วโดย ' + escapeHtml(r.voidedBy || 'ผู้ดูแลระบบ') + '</div>';
    } else if (currentUser && currentUser.admin === true) {
        voidActionHtml = '<button type="button" onclick="window.handleVoidRecord(\'' + r.id + '\')" style="width:100%;margin-top:20px;padding:12px;background:#fee2e2;color:#dc2626;border:2px dashed #fca5a5;border-radius:12px;font-weight:700;font-size:14px;cursor:pointer;"><i class="fa-solid fa-arrow-rotate-left"></i> ยกเลิกบิลและคืนสต็อก</button>';
    }

    var modalHtml = 
        '<div style="background:#fff;border-radius:20px;box-shadow:0 25px 60px rgba(0,0,0,0.3);width:100%;max-width:400px;overflow:hidden;transform:scale(0.95);animation:modalFadeIn 0.2s forwards">' +
        '<div style="background:' + (r.voided ? '#94a3b8' : '#5e3db5') + ';padding:18px 24px;color:#fff;display:flex;justify-content:space-between;align-items:center">' +
        '<h3 style="margin:0;font-size:16px;font-weight:600"><i class="fa-solid fa-receipt"></i> ' + (r.voided ? 'รายละเอียดบิล (ยกเลิก)' : 'รายละเอียดการเบิก') + '</h3>' +
        '<button type="button" onclick="document.getElementById(\'recordModalOverlay\').style.display=\'none\'" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        '<div style="padding:16px 24px;background:#f8fafc;border-bottom:1px solid #e2e8f0;font-size:13.5px;color:#475569">' +
        '<div style="margin-bottom:8px"><strong>ผู้ป่วย:</strong> <span style="color:' + (r.voided ? '#64748b' : '#5e3db5') + ';font-weight:700">' + escapeHtml(r.patientName) + '</span></div>' +
        '<div><strong>เวลาที่บันทึก:</strong> ' + formatTimestamp(r.createdAt) + '</div>' +
        '</div>' +
        '<div style="padding:10px 24px 24px 24px;max-height:50vh;overflow-y:auto">' + medListHtml + voidActionHtml + '</div>' +
        '</div>' +
        '<style>@keyframes modalFadeIn { to { transform:scale(1); opacity:1; } }</style>';

    overlay.innerHTML = modalHtml;
    overlay.style.display = 'flex';
    
    overlay.onclick = function(e) {
        if(e.target === overlay) overlay.style.display = 'none';
    };
}

function exportRecordsToExcel() {
    // 1. ตรวจสอบว่ามีข้อมูลให้ดาวน์โหลดหรือไม่
    if (!appData.records || appData.records.length === 0) {
        alert('ไม่มีข้อมูลบันทึกการใช้สำหรับส่งออก');
        return;
    }

    // 2. เตรียมโครงสร้างอาร์เรย์ของข้อมูลตาราง (Row-by-Row)
    var excelData = [];
    
    // ✅ เพิ่มคอลัมน์ "หอผู้ป่วย" และ "เตียง" ลงในแถวหัวตาราง (Header)
    excelData.push(['วัน-เวลา', 'ชื่อผู้ป่วย', 'หอผู้ป่วย', 'เตียง', 'รายการเวชภัณฑ์', 'จำนวนที่จ่าย', 'หน่วยนับ', 'บันทึกโดย']);

    // 3. วนลูปแปลงข้อมูลแต่ละ Record ยัดลงตาราง
    appData.records.forEach(function(r) {
        var dateStr = formatTimestamp(r.createdAt);
        var patientName = r.patientName || '-';
        var user = r.performedByName || '-';

        // 🔍 MAGIC ZONE: ค้นหาข้อมูล หอ (Ward) และ เตียง (Bed) จากรายชื่อผู้ป่วยในระบบ (appData.patients)
        var wardStr = '-';
        var bedStr = '-';
        var foundPatient = appData.patients.find(function(p) { return p.name === patientName; });
        if (foundPatient) {
            wardStr = foundPatient.ward || '-';
            bedStr = foundPatient.bed || '-';
        }

        if (r.items && Array.isArray(r.items)) {
            // เคสข้อมูลใหม่: 1 การ์ดมีหลายรายการยา ให้แตกแถวแยก
            r.items.forEach(function(item) {
                excelData.push([
                    dateStr,
                    patientName,
                    wardStr, // ยัดข้อมูลหอผู้ป่วย
                    bedStr,  // ยัดข้อมูลเลขเตียง
                    item.medicineName || '-',
                    item.quantity || 0,
                    item.unit || 'ชิ้น',
                    user
                ]);
            });
        } else {
            // เคสข้อมูลเก่า (Fallback)
            excelData.push([
                dateStr,
                patientName,
                wardStr,
                bedStr,
                r.medicineName || '-',
                r.quantity || 0,
                'ชิ้น',
                user
            ]);
        }
    });

    // 4. ใช้ Library สร้าง Worksheet จากอาร์เรย์ข้อมูลของเรา
    var ws = XLSX.utils.aoa_to_sheet(excelData);

    // 5. ลอจิกคำนวณ Auto-fit Column Width เพื่อให้คอลัมน์กางออกพอดีตัวอักษรอัตโนมัติ
    var colsWidth = excelData[0].map(function(col, i) {
        var maxLen = Math.max.apply(null, excelData.map(function(row) {
            return row[i] ? row[i].toString().length : 0;
        }));
        // เผื่อระยะขอบสวยงาม +5 สำหรับภาษาไทย
        return { wch: Math.max(maxLen + 5, 12) };
    });
    ws['!cols'] = colsWidth;

    // 6. สร้าง Workbook และนำเอาตารางไปใส่
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "บันทึกการใช้เวชภัณฑ์");

    // 7. สั่งดาวน์โหลดเป็นไฟล์ .xlsx แท้ๆ อัตโนมัติ
    var now = new Date();
    var dateFilename = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
    XLSX.writeFile(wb, 'Lean_Med_Records_' + dateFilename + '.xlsx');
}
// ฟังก์ชันสำหรับเปิด Pop-up เลือกช่วงวันที่ก่อน Export
function openExportModal() {
    var overlay = document.getElementById('recordModalOverlay');
    if (!overlay) return;

    // 1. ดึงรายชื่อพนักงานในระบบมาสร้างเป็นตัวเลือก (Dropdown Options)
    var nurseOptions = '<option value="">-- พนักงานทุกคน --</option>';
    if (appData.employees && appData.employees.length > 0) {
        appData.employees.forEach(function(emp) {
            nurseOptions += '<option value="' + escapeHtml(emp.name) + '">' + escapeHtml(emp.name) + ' (' + escapeHtml(roleLabels[emp.role] || emp.role) + ')</option>';
        });
    }

    var modalHtml = 
        '<div style="background:#fff;border-radius:20px;box-shadow:0 25px 60px rgba(0,0,0,0.3);width:100%;max-width:360px;overflow:hidden;transform:scale(0.95);animation:modalFadeIn 0.2s forwards">' +
        // Header
        '<div style="background:#16a34a;padding:16px 20px;color:#fff;display:flex;justify-content:space-between;align-items:center">' +
        '<h3 style="margin:0;font-size:16px;font-weight:600"><i class="fa-solid fa-file-excel"></i> เลือกเงื่อนไขส่งออก</h3>' +
        '<button type="button" onclick="document.getElementById(\'recordModalOverlay\').style.display=\'none\'" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer"><i class="fa-solid fa-xmark"></i></button>' +
        '</div>' +
        
        // Body Form
        '<div style="padding:20px 24px;display:flex;flex-direction:column;gap:16px">' +
        '  <div class="form-group" style="margin:0">' +
        '    <label style="font-size:0.85rem;color:#64748b;font-weight:600;display:block;margin-bottom:6px">วันที่เริ่มต้น</label>' +
        '    <input type="date" id="exportStartDate" style="width:100%;padding:10px;border-radius:10px;border:2px solid #cbd5e1;font-family:inherit;box-sizing:border-box">' +
        '  </div>' +
        '  <div class="form-group" style="margin:0">' +
        '    <label style="font-size:0.85rem;color:#64748b;font-weight:600;display:block;margin-bottom:6px">วันที่สิ้นสุด</label>' +
        '    <input type="date" id="exportEndDate" style="width:100%;padding:10px;border-radius:10px;border:2px solid #cbd5e1;font-family:inherit;box-sizing:border-box">' +
        '  </div>' +
        
        // 🔥 [เพิ่มใหม่] ช่องเลือกเวรปฏิบัติงานในหน้าสรุป Export
        '  <div class="form-group" style="margin:0">' +
        '    <label style="font-size:0.85rem;color:#64748b;font-weight:600;display:block;margin-bottom:6px">เลือกเวรปฏิบัติงาน</label>' +
        '    <select id="exportShiftName" style="width:100%;padding:10px;border-radius:10px;border:2px solid #cbd5e1;font-family:inherit;box-sizing:border-box">' +
        '      <option value="">-- ทุกเวร --</option>' +
        '      <option value="เช้า">เวรเช้า </option>' +
        '      <option value="บ่าย">เวรบ่าย </option>' +
        '      <option value="ดึก">เวรดึก </option>' +
        '    </select>' +
        '  </div>' +
        
        '  <div class="form-group" style="margin:0">' +
        '    <label style="font-size:0.85rem;color:#64748b;font-weight:600;display:block;margin-bottom:6px">เลือกพนักงานผู้บันทึก</label>' +
        '    <select id="exportNurseName" style="width:100%;padding:10px;border-radius:10px;border:2px solid #cbd5e1;font-family:inherit;box-sizing:border-box">' +
             nurseOptions +
        '    </select>' +
        '  </div>' +
        '  <p style="margin:0;font-size:11.5px;color:#94a3b8;text-align:center">* หากไม่เลือกเงื่อนไข ระบบจะส่งออกข้อมูลทั้งหมด</p>' +
        '</div>' +
        
        // Footer Buttons
        '<div style="padding:0 24px 20px 24px;display:flex;gap:10px">' +
        '  <button type="button" onclick="window.exportRecordsWithFilter()" style="flex:1;background:#16a34a;color:#fff;border:none;padding:12px;border-radius:12px;font-weight:600;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;gap:6px"><i class="fa-solid fa-download"></i> ดาวน์โหลด</button>' +
        '  <button type="button" onclick="document.getElementById(\'recordModalOverlay\').style.display=\'none\'" style="flex:1;background:#f1f5f9;color:#475569;border:none;padding:12px;border-radius:12px;font-weight:600;cursor:pointer;font-size:14px">ยกเลิก</button>' +
        '</div>' +
        '</div>' +
        '<style>@keyframes modalFadeIn { to { transform:scale(1); opacity:1; } }</style>';

    overlay.innerHTML = modalHtml;
    overlay.style.display = 'flex';
}

// ฟังก์ชันกรองข้อมูลตามวันที่ที่เลือก แล้วส่งออกเป็น Excel
async function exportRecordsWithFilter() {
    var startInput = document.getElementById('exportStartDate').value;
    var endInput = document.getElementById('exportEndDate').value;
    var selectedShift = document.getElementById('exportShiftName').value;
    var selectedNurse = document.getElementById('exportNurseName').value;

    document.getElementById('recordModalOverlay').style.display = 'none';

    Swal.fire({ 
        title: 'กำลังประมวลผลตาราง Excel...', 
        text: 'ระบบกำลังจัดกลุ่มประวัติยาให้วิ่งตามเตียงล่าสุด โปรดรอสักครู่', 
        allowOutsideClick: false, 
        didOpen: () => Swal.showLoading() 
    });

    var startDate = startInput ? new Date(startInput + 'T00:00:00') : null;
    var endDate = endInput ? new Date(endInput + 'T23:59:59') : null;

    try {
        var allRecords = await getAllRecordsOnceFromFirestore();

        var filteredRecords = allRecords.filter(function(r) {
            if (r.voided) return false; 
            
            var recordDate = typeof r.createdAt.toDate === 'function' ? r.createdAt.toDate() : new Date(r.createdAt);
            if (startDate && recordDate < startDate) return false;
            if (endDate && recordDate > endDate) return false;
            if (selectedShift && r.shift !== selectedShift) return false;
            if (selectedNurse && r.performedByName !== selectedNurse) return false;
            return true;
        });

        if (filteredRecords.length === 0) {
            Swal.fire({ icon: 'info', title: 'ไม่พบข้อมูล', text: 'ไม่พบข้อมูลบันทึกตามเงื่อนไข หรือข้อมูลถูกยกเลิกไปแล้ว', confirmButtonColor: '#16a34a' });
            return;
        }

        // 🔥 [แก้บัคเวลา 23:19 หาย] กลับด้าน Array เพื่อให้ข้อมูลเก่าถูกประมวลผลก่อน 
        // และข้อมูลใหม่สุด (เช่น 5 ทุ่ม) จะถูกประมวลผลทีหลังแล้วไปทับเวลาล่าสุดได้อย่างถูกต้อง!
        filteredRecords.reverse();

        var consolidatedMap = {};

        filteredRecords.forEach(function(r) {
            var dateStr = formatTimestamp(r.createdAt);
            var patientName = r.patientName || '-';
            var shiftStr = r.shift || '-';
            var user = r.performedByName || '-';

            var wardStr = '-';
            var bedStr = '-';

            var currentBedDoc = null;
            if (patientName !== '-' && patientName !== 'ว่าง') {
                currentBedDoc = appData.patients.find(function(p) { return p.name === patientName; });
            }

            if (currentBedDoc) {
                wardStr = currentBedDoc.ward || '-';
                bedStr = currentBedDoc.bed || '-';
            } else {
                var oldBedDoc = appData.patients.find(function(p) { return p.id === r.patientId; });
                if (oldBedDoc) {
                    wardStr = oldBedDoc.ward || '-';
                    bedStr = oldBedDoc.bed || '-';
                }
            }

            var recordItems = [];
            if (r.items && Array.isArray(r.items)) {
                recordItems = r.items;
            } else {
                recordItems = [{ medicineName: r.medicineName || '-', quantity: r.quantity || 0, unit: 'ชิ้น' }];
            }

            recordItems.forEach(function(item) {
                var medName = item.medicineName || '-';
                var qty = item.quantity || 0;
                var unitStr = item.unit || 'ชิ้น';

                var aggKey = patientName + '_' + shiftStr + '_' + medName;

                if (consolidatedMap[aggKey]) {
                    consolidatedMap[aggKey].quantity += qty;
                    if (consolidatedMap[aggKey].user.indexOf(user) === -1) {
                        consolidatedMap[aggKey].user += ', ' + user;
                    }
                    // อัปเดตข้อมูลเตียงและเวลาให้เป็นของบิลล่าสุดเสมอ
                    consolidatedMap[aggKey].dateStr = dateStr;
                    consolidatedMap[aggKey].wardStr = wardStr;
                    consolidatedMap[aggKey].bedStr = bedStr;
                } else {
                    consolidatedMap[aggKey] = {
                        dateStr: dateStr, 
                        shiftStr: shiftStr,
                        patientName: patientName,
                        wardStr: wardStr,
                        bedStr: bedStr,
                        medicineName: medName,
                        quantity: qty,
                        unit: unitStr,
                        user: user
                    };
                }
            });
        });

        var consolidatedArray = [];
        for (var key in consolidatedMap) {
            consolidatedArray.push(consolidatedMap[key]);
        }

        consolidatedArray.sort(function(a, b) {
            var shiftWeights = { 'เช้า': 1, 'บ่าย': 2, 'ดึก': 3 };
            var weightA = shiftWeights[a.shiftStr] || 99;
            var weightB = shiftWeights[b.shiftStr] || 99;
            if (weightA !== weightB) return weightA - weightB;

            var bedCompare = a.bedStr.localeCompare(b.bedStr, undefined, {numeric: true, sensitivity: 'base'});
            if (bedCompare !== 0) return bedCompare;

            return a.medicineName.localeCompare(b.medicineName, 'th');
        });

        var workbook = new ExcelJS.Workbook();
        var worksheet = workbook.addWorksheet('บันทึกการใช้เวชภัณฑ์', { views: [{ showGridLines: true }] });

        worksheet.columns = [
            { header: 'วัน-เวลา (ล่าสุด)', key: 'date', width: 22 },
            { header: 'เวร', key: 'shift', width: 10 },
            { header: 'ชื่อผู้ป่วย', key: 'patient', width: 25 },
            { header: 'หอผู้ป่วย', key: 'ward', width: 12 },
            { header: 'เตียง (ล่าสุด)', key: 'bed', width: 13 },
            { header: 'รายการเวชภัณฑ์', key: 'medicine', width: 30 },
            { header: 'จำนวนที่จ่ายรวม', key: 'quantity', width: 16 },
            { header: 'หน่วยนับ', key: 'unit', width: 12 },
            { header: 'บันทึกโดย', key: 'user', width: 22 }
        ];

        var headerRow = worksheet.getRow(1);
        headerRow.height = 28;
        headerRow.eachCell(function(cell) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } };
            cell.font = { name: 'Sarabun', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF15803D' } }, left: { style: 'thin', color: { argb: 'FF15803D' } },
                bottom: { style: 'thin', color: { argb: 'FF15803D' } }, right: { style: 'thin', color: { argb: 'FF15803D' } }
            };
        });

        consolidatedArray.forEach(function(rowItem) {
            var newRow = worksheet.addRow({
                date: rowItem.dateStr,
                shift: rowItem.shiftStr,
                patient: rowItem.patientName,
                ward: rowItem.wardStr,
                bed: rowItem.bedStr,
                medicine: rowItem.medicineName,
                quantity: rowItem.quantity,
                unit: rowItem.unit,
                user: rowItem.user
            });
            newRow.height = 22;
            newRow.eachCell(function(cell, colNumber) {
                cell.font = { name: 'Sarabun', size: 10 };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFE2E8F0' } }, left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }, right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                };
                if (colNumber === 2 || colNumber === 4 || colNumber === 5 || colNumber === 7 || colNumber === 8) {
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                } else {
                    cell.alignment = { vertical: 'middle', horizontal: 'left' };
                }
            });
        });

        var buffer = await workbook.xlsx.writeBuffer();
        var blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        var rangeName = 'All';
        if (startInput && endInput) rangeName = startInput + '_to_' + endInput;
        else if (startInput) rangeName = 'From_' + startInput;
        else if (endInput) rangeName = 'Until_' + endInput;

        var nurseFileName = selectedNurse ? '_' + selectedNurse.replace(/\s+/g, '') : '';
        var shiftFileName = selectedShift ? '_เวร' + selectedShift : '';

        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'Lean_Consolidated_Records' + nurseFileName + shiftFileName + '_' + rangeName + '.xlsx';
        link.click();
        
        Swal.close();
    } catch (err) {
        Swal.fire('เกิดข้อผิดพลาด', 'ไม่สามารถประมวลผลจัดสไตล์ไฟล์ได้: ' + err.message, 'error');
    }
}

var roleLabels = { nurse: 'พยาบาล', pn: 'ผู้ช่วยพยาบาล', admin: 'ผู้ดูแลระบบ' };

function renderAdminPage(container) {
    var isSelf = function(emp) { return currentUser && emp.id === currentUser.uid; };

    var employeeItems = appData.employees.map(function(emp) {
        var roleLabel = roleLabels[emp.role] || emp.role || '-';
        var isActive = emp.active !== false;
        var statusBadge = isActive
            ? '<span style="color:#16a34a;font-weight:700">● ใช้งานอยู่</span>'
            : '<span style="color:#9ca3af;font-weight:700">● ปิดใช้งาน</span>';

        // ❌ [ลบบรรทัด var changePwdBtn = '...' ของเก่าออกไปเลยครับ]

        var toggleBtn = isSelf(emp)
            ? ''
            : '<button class="btn-secondary" onclick="window.handleToggleEmployee(\'' + emp.id + '\', ' + isActive + ')">' +
              '<i class="fa-solid fa-' + (isActive ? 'ban' : 'check') + '"></i> ' + (isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน') + '</button>';

        var deleteBtn = isSelf(emp)
            ? ''
            : '<button class="btn-delete" onclick="window.handleDeleteEmployee(\'' + emp.id + '\', \'' + escapeHtml(emp.email) + '\')"><i class="fa-solid fa-trash"></i> ลบ</button>';

        return '<div class="list-item"><div class="item-info">' +
            '<div class="item-title">' + escapeHtml(emp.name) + (isSelf(emp) ? ' (คุณ)' : '') + '</div>' +
            '<div class="item-detail"><i class="fa-solid fa-user-tag"></i> ' + escapeHtml(emp.email.replace('@lean.local', '')) + ' | ' + escapeHtml(roleLabel) +
            (emp.department ? ' | ' + escapeHtml(emp.department) : '') + '</div>' +
            '<div style="margin-top:5px">' + statusBadge + '</div></div>' +
            // 🔥 [แก้ไข] เอาตัวแปร changePwdBtn ออกจากตรงนี้ด้วยครับ ให้เหลือแค่นี้พอ
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' + toggleBtn + deleteBtn + '</div></div>';
    }).join('');

    container.innerHTML =
        '<div class="page-container"><div class="page-header"><h1><i class="fa-solid fa-user-shield"></i> จัดการพนักงาน</h1></div>' +
        '<div class="page-content"><form class="form-section" id="addEmployeeForm"><h2>เพิ่มพนักงานใหม่</h2>' +
        '<div class="form-row"><div class="form-group"><label>ชื่อ-นามสกุล</label><input type="text" id="empName" placeholder="ชื่อ-นามสกุล" required></div>' +
        '<div class="form-group"><label>Username</label><input type="text" id="empUsername" placeholder="เช่น nurse01" required></div></div>' +
        '<div class="form-row"><div class="form-group"><label>รหัสผ่าน</label><input type="password" id="empPassword" placeholder="อย่างน้อย 6 ตัวอักษร" required></div>' +
        '<div class="form-group"><label>ตำแหน่ง</label><select id="empRole" required>' +
        '<option value="nurse">พยาบาล (nurse)</option>' +
        '<option value="pn">ผู้ช่วยพยาบาล (pn)</option>' +
        '<option value="admin">ผู้ดูแลระบบ (admin)</option></select></div></div>' +
        '<div class="form-row"><div class="form-group"><label>แผนก/วอร์ด</label><input type="text" id="empDept" placeholder="เช่น วอร์ด 4A"></div></div>' +
        '<button type="submit" class="btn-primary" id="addEmployeeBtn"><i class="fa-solid fa-plus"></i> เพิ่มพนักงาน</button></form>' +
        '<div id="empSuccess" class="info-box success" style="display:none;margin-top:15px"></div>' +
        '<div id="empError" class="info-box error" style="display:none;margin-top:15px"></div>' +
        '<div class="list-section" style="margin-top:25px"><h2><i class="fa-solid fa-list"></i> รายชื่อพนักงาน</h2>' +
        '<div id="employeeList">' + (appData.employees.length === 0 ? '<p class="empty"><i class="fa-regular fa-folder-open"></i><br>ยังไม่มีพนักงาน</p>' : employeeItems) + '</div>' +
        '</div></div></div>';
}

function handleAdminResetPassword(email) {
    Swal.fire({
        title: 'ยืนยันการเปลี่ยนรหัสผ่าน?',
        text: 'ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยังอีเมล ' + email + ' โดยตรง',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#0284c7',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'ส่งลิงก์รีเซ็ต',
        cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await adminResetPassword(email); // เรียกฟังก์ชันที่อิมพอร์ตมาจาก auth.js
                Swal.fire({
                    icon: 'success',
                    title: 'ส่งลิงก์สำเร็จ!',
                    text: 'ส่งอีเมลตั้งรหัสผ่านใหม่เรียบร้อยแล้ว พนักงานสามารถเช็คกล่องข้อความเพื่อกดเปลี่ยนรหัสเองได้เลย',
                    confirmButtonColor: '#5e3db5'
                });
            } catch (err) {
                Swal.fire('เกิดข้อผิดพลาด', err.message, 'error');
            }
        }
    });
}

function handleDeleteEmployee(id, email) {
    var username = email.replace('@lean.local', '');
    
    Swal.fire({
        title: 'ยืนยันการลบพนักงาน?',
        html: 'คุณต้องการลบข้อมูลและยกเลิกสิทธิ์เข้าใช้งานของพนักงาน <b style="color:#ef4444">' + escapeHtml(username) + '</b> ใช่หรือไม่?<br><span style="font-size:13px;color:#94a3b8;">(พนักงานคนนี้จะไม่สามารถล็อกอินเข้าสู่ระบบได้อีกต่อไป)</span>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: 'ใช่, ลบและบล็อกสิทธิ์เลย',
        cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                Swal.fire({ title: 'กำลังดำเนินการ...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                
                // 1. สั่งปิดใช้งาน (Active = false) ในระบบเพื่อให้ล็อกอินไม่ได้อีกต่อไป
                if (typeof toggleEmployeeActive === 'function') {
                    await toggleEmployeeActive(id, false);
                }
                
                // 2. ลบข้อมูลพนักงานคนนี้ออกจากรายชื่อตารางหน้าเว็บแอป
                if (typeof deleteEmployeeDoc === 'function') {
                    await deleteEmployeeDoc(id);
                } else if (typeof window.deleteEmployee === 'function') {
                    await window.deleteEmployee(id);
                }
                
                Swal.fire({
                    icon: 'success',
                    title: 'ลบพนักงานสำเร็จ!',
                    text: 'ระบบได้ทำการลบรายชื่อและระงับสิทธิ์การใช้งานของพนักงานคนนี้เรียบร้อยแล้วครับ',
                    confirmButtonColor: '#5e3db5'
                });
            } catch (err) {
                Swal.fire('เกิดข้อผิดพลาดในการลบ', err.message, 'error');
            }
        }
    });
}

async function handleAddEmployee(e) {
    e.preventDefault();
    var name = document.getElementById('empName').value.trim();
    // ดึงค่า Username และบังคับตัวพิมพ์เล็ก เพื่อป้องกันการล็อกอินผิดพลาด
   var username = document.getElementById('empUsername').value.trim().toLowerCase().replace(/\s+/g, '');
    var password = document.getElementById('empPassword').value;
    var role = document.getElementById('empRole').value;
    var department = document.getElementById('empDept').value.trim();
    var successBox = document.getElementById('empSuccess');
    var errorBox = document.getElementById('empError');
    var btn = document.getElementById('addEmployeeBtn');

    // 🥷 แปลงเป็นอีเมลจำลองก่อนบันทึกลงฐานข้อมูล
    var fakeEmail = username.includes('@') ? username : username + '@lean.local';

    if (errorBox) errorBox.style.display = 'none';
    if (successBox) successBox.style.display = 'none';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเพิ่ม...'; }

    try {
        await createEmployee({
            name: name, email: fakeEmail, password: password, role: role,
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
    var name = document.getElementById('patientName').value.trim();
    var ward = document.getElementById('patientWard').value.trim();
    var bed = document.getElementById('patientBed').value.trim();
    
    if (name && ward && bed) {
        // 🔍 ตรวจสอบว่า หอผู้ป่วย + เตียง นี้มีผู้ป่วยรายอื่นครองอยู่แล้วหรือไม่ (ตั้งแต่ตอนกดสร้าง)
        var isBedOccupied = appData.patients.some(function(p) {
            return p.ward.trim().toLowerCase() === ward.toLowerCase() && 
                   p.bed.trim().toLowerCase() === bed.toLowerCase();
        });

        if (isBedOccupied) {
            // แจ้งเตือนทันทีในกรณีที่เตียงซ้ำตั้งแต่ตอนสร้าง เพื่อป้องกันความสับสน
            Swal.fire({
                icon: 'warning',
                title: 'เตียงนี้มีผู้ป่วยอยู่แล้ว!',
                html: 'หอ <b>' + escapeHtml(ward) + '</b> เตียง <b>' + escapeHtml(bed) + '</b> มีผู้ป่วยรายอื่นครองอยู่แล้ว<br><span style="color:#ef4444;font-weight:600;">กรุณาย้ายผู้ป่วยเตียงนั้นออกก่อนเพราะว่ามันจะสับสนครับ</span>',
                confirmButtonColor: '#f59e0b'
            });
            return; // หยุดการทำงานทันที ไม่ส่งข้อมูลไป Firebase
        }

        // โชว์ Loading ป้องกันพยาบาลกดปุ่มเบิ้ลรัวๆ
        Swal.fire({
            title: 'กำลังบันทึกข้อมูล...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            await addPatientDoc({ name: name, ward: ward, bed: bed }); 
            
            // โชว์ Pop-up สำเร็จสีเขียว 1.5 วินาทีแล้วปิดเอง
            Swal.fire({
                icon: 'success',
                title: 'เพิ่มผู้ป่วยสำเร็จ!',
                text: 'บันทึกข้อมูล ' + name + ' เข้าสู่ระบบเรียบร้อย',
                showConfirmButton: false,
                timer: 1500
            });

            // เคลียร์ข้อความในฟอร์มให้ว่าง พร้อมรับคนถัดไป
            e.target.reset();

            goToPage('patients'); 
        } catch (err) { 
            Swal.fire({
                icon: 'error',
                title: 'เพิ่มผู้ป่วยไม่สำเร็จ',
                text: err.message,
                confirmButtonColor: '#ef4444'
            });
        }
    } else {
        Swal.fire({
            icon: 'warning',
            title: 'ข้อมูลไม่ครบถ้วน',
            text: 'กรุณากรอกชื่อ หอผู้ป่วย และเตียงให้ครบถ้วน',
            confirmButtonColor: '#5e3db5'
        });
    }
}

async function deletePatient(id) {
    Swal.fire({
        title: 'ยืนยันการลบ?',
        text: "คุณต้องการลบข้อมูลผู้ป่วยรายนี้ใช่หรือไม่ ข้อมูลจะไม่สามารถกู้คืนได้!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: '<i class="fa-solid fa-trash"></i> ใช่, ลบเลย',
        cancelButtonText: 'ยกเลิก'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try { 
                await deletePatientDoc(id); 
                Toast.fire({ icon: 'success', title: 'ลบผู้ป่วยเรียบร้อย' });
            } catch (err) { 
                Swal.fire('ลบไม่สำเร็จ', err.message, 'error'); 
            }
        }
    });
}

async function addMedicine(e) {
    e.preventDefault();
    var name = document.getElementById('medicineName').value.trim();
    var stock = parseInt(document.getElementById('medicineStock').value);
    var unit = document.getElementById('medicineUnit').value;
    var reorder = parseInt(document.getElementById('medicineReorder').value);
    
    // 🔥 [เพิ่มใหม่] ดึงค่าบาร์โค้ดออกมา
    var barcodeInput = document.getElementById('medicineBarcode');
    var barcode = barcodeInput ? barcodeInput.value.trim() : '';
    
    if (name && unit && !isNaN(stock) && !isNaN(reorder)) {
        var isDuplicate = appData.inventory.some(function(item) {
            return item.name.toLowerCase() === name.toLowerCase();
        });

        if (isDuplicate) {
            Swal.fire({
                icon: 'warning',
                title: 'มีเวชภัณฑ์นี้อยู่แล้ว!',
                text: 'ชื่อเวชภัณฑ์ "' + name + '" มีอยู่ในระบบแล้ว หากต้องการเพิ่มจำนวนกรุณาไปที่เมนู "ยอดคงคลัง" เพื่อกดเติมสต็อก',
                confirmButtonColor: '#f59e0b'
            });
            return; 
        }

        Swal.fire({
            title: 'กำลังบันทึกข้อมูล...',
            allowOutsideClick: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });

        try {
            // 🔥 [เพิ่มใหม่] ส่ง parameter 'barcode' พ่วงไปเก็บใน Firebase ด้วย
            await addMedicineDoc({ name: name, stock: stock, unit: unit, reorder: reorder, barcode: barcode }); 
            
            Swal.fire({
                icon: 'success',
                title: 'เพิ่มเวชภัณฑ์สำเร็จ!',
                text: 'นำ "' + name + '" เข้าสู่ระบบเรียบร้อย',
                showConfirmButton: false,
                timer: 1500
            });

            e.target.reset();
            goToPage('medicines'); 
        } catch (err) { 
            Swal.fire({
                icon: 'error',
                title: 'เพิ่มเวชภัณฑ์ไม่สำเร็จ',
                text: err.message,
                confirmButtonColor: '#ef4444'
            });
        }
    } else {
        Swal.fire({
            icon: 'warning',
            title: 'ข้อมูลไม่ครบถ้วน',
            text: 'กรุณากรอกข้อมูลเวชภัณฑ์ให้ครบทุกช่อง',
            confirmButtonColor: '#5e3db5'
        });
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
    if (appData.patients.length === 0) { alert('ยังไม่มีผังเตียงในระบบ'); return; }
    try {
        var results = await Promise.all(appData.patients.map(function(p) {
            // 🔥 [แก้ไขแล้ว] สร้าง QR จากเลขเตียงแทน
            return getQRDataURL(p.bed).then(function(url) { 
                return { code: p.bed, name: 'เตียง: ' + p.bed + ' (หอ: ' + p.ward + ')', dataUrl: url }; 
            });
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

function showBarcode(barcodeStr, medName) {
    var existing = document.getElementById('barcodeModalOverlay');
    if (existing) existing.remove();

    // เรียกใช้ API สร้างรูปบาร์โค้ด
    var barcodeUrl = 'https://bwipjs-api.metafloor.com/?bcid=code128&text=' + encodeURIComponent(barcodeStr) + '&scale=3&includetext=true';

    var overlay = document.createElement('div');
    overlay.id = 'barcodeModalOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px';
    
    overlay.innerHTML =
        '<div style="background:#fff;border-radius:20px;padding:30px;max-width:380px;width:100%;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,0.25);">' +
        '<h2 style="margin:0 0 8px;font-size:18px;color:#1e293b;">' + escapeHtml(medName) + '</h2>' +
        '<p style="color:#64748b;margin:0 0 20px;font-size:14px;"><i class="fa-solid fa-barcode"></i> รหัสอ้างอิง: ' + escapeHtml(barcodeStr) + '</p>' +
        '<div style="background:#f8fafc; border:2px dashed #cbd5e1; border-radius:12px; padding:25px 15px; display:flex; justify-content:center; align-items:center; min-height:140px; margin-bottom:20px;">' +
        '<img src="' + barcodeUrl + '" alt="Barcode" style="max-width:100%; height:auto; mix-blend-mode:multiply;">' +
        '</div>' +
        '<div style="display:flex;gap:10px;">' +
        '<button class="btn-primary" onclick="window.open(\'' + barcodeUrl + '\', \'_blank\')" style="flex:1;"><i class="fa-solid fa-download"></i> เซฟรูปภาพ</button>' +
        '<button class="btn-secondary" onclick="document.getElementById(\'barcodeModalOverlay\').remove()" style="flex:1;">ปิดหน้าต่าง</button>' +
        '</div>' +
        '</div>';
        
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
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
    
    // 🔥 [แก้ไขแล้ว] ให้ระบบค้นหาเจอทั้งจาก "ชื่อคนไข้" และ "หมายเลขเตียง"
    var patient = appData.patients.find(function(p) { 
        return p.name === code || p.bed === code; 
    });
    
    var modalOverlay = document.getElementById('scanModalOverlay');
    var scanResult = document.getElementById('scanResult');
    
    if (patient) {
        currentScannedPatient = patient; 
        document.getElementById('recordPatientDisplay').value = patient.name + ' (เตียง: ' + patient.bed + ' | หอ: ' + patient.ward + ')';
        
        var shiftSelect = document.getElementById('recordShiftDisplay');
        if (shiftSelect) {
            // ถ้าเคยเลือกเวรไปแล้ว ให้จำค่าเดิมไว้ ไม่ต้องเปลี่ยนตามเวลาปัจจุบัน
            if (window.lastSelectedShift) {
                shiftSelect.value = window.lastSelectedShift;
            } else {
                // ถ้าเพิ่งเปิดเข้ามาครั้งแรก ค่อยจับเวลาปัจจุบันเป็นค่าเริ่มต้น
                var currentHour = new Date().getHours();
                if (currentHour >= 8 && currentHour < 16) {
                    shiftSelect.value = 'เช้า';
                } else if (currentHour >= 16 && currentHour <= 23) {
                    shiftSelect.value = 'บ่าย';
                } else {
                    shiftSelect.value = 'ดึก'; 
                }
            }
        }
        
        var mContainer = document.getElementById('multiMedicineContainer');
        if (mContainer) {
            mContainer.innerHTML = '';
            addMedicineRow(); 
        }
        
        if (modalOverlay) modalOverlay.style.display = 'flex';
        
        if (scanResult) { 
            scanResult.innerHTML = '<i class="fa-solid fa-circle-check"></i> ระบุเตียงสำเร็จ: เตียง ' + escapeHtml(patient.bed) + ' (👤 ' + escapeHtml(patient.name) + ')'; 
            scanResult.className = 'info-box success'; 
            scanResult.style.display = 'block'; 
        }
    } else {
        currentScannedPatient = null;
        if (modalOverlay) modalOverlay.style.display = 'none';
        if (scanResult) { 
            scanResult.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> ไม่พบข้อมูลผังเตียง หรือชื่อผู้ป่วยนี้: ' + escapeHtml(code); 
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
        var medIdField = row.querySelector('.med-select-field');
        var medId = medIdField ? medIdField.value : '';
        
        var qtyField = row.querySelector('.med-qty-field');
        var quantity = qtyField ? parseInt(qtyField.value) : 0;
        
        if (!medId || isNaN(quantity) || quantity < 1) { 
            validationPass = false; 
            return; 
        }
        
        var targetMed = appData.inventory.find(function(m) { return m.id === medId; });
        if (targetMed) {
            itemsToSubmit.push({ 
                medicineId: targetMed.id, 
                medicineName: targetMed.name,
                quantity: quantity,
                unit: targetMed.unit || 'ชิ้น'
            });
        }
    });

    if (!validationPass || itemsToSubmit.length === 0) { 
        Swal.fire({
            icon: 'warning',
            title: 'ข้อมูลไม่ครบถ้วน',
            text: 'กรุณาเลือกเวชภัณฑ์และระบุจำนวนให้ถูกต้องทุกรายการ',
            confirmButtonColor: '#5e3db5'
        });
        return; 
    }

    // 🔥 [เพิ่มใหม่] อ่านค่า "เวร" ที่พยาบาลเลือกไว้บนหน้าฟอร์ม
    var shiftDisplayEl = document.getElementById('recordShiftDisplay');
    var selectedShift = shiftDisplayEl ? shiftDisplayEl.value : 'เช้า';

    try {
        await submitRecordDoc({
            patientId: currentScannedPatient.id,
            patientName: currentScannedPatient.name, 
            performedByUid: currentUser.uid, 
            performedByName: currentUser.name,
            shift: selectedShift, // 🔥 [เพิ่มใหม่] พ่วงส่งค่าเวรลงฐานข้อมูลคลาวด์
            items: itemsToSubmit
        });
        
        Swal.fire({
            icon: 'success',
            title: 'บันทึกสำเร็จ!',
            text: 'ตัดสต็อกและบันทึกข้อมูลเรียบร้อย',
            showConfirmButton: false,
            timer: 1500
        });

        var modalOverlay = document.getElementById('scanModalOverlay'); 
        if (modalOverlay) modalOverlay.style.display = 'none';
        currentScannedPatient = null; 
        goToPage('records');
    } catch (err) { 
        Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: err.message,
            confirmButtonColor: '#ef4444'
        });
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
    
    // 🔥 [เพิ่มใหม่] เช็คป้ายความจำ: ถ้ามาจากหน้าจัดการผู้ป่วย ให้พากลับไปหน้าเดิม!
    if (window.returnToPatients) {
        window.returnToPatients = false; // เคลียร์ค่าทิ้ง
        window.goToPage('patients');
    } else {
        // ถ้ามาจากการกดเมนู "สแกน QR เตียง" ปกติ ค่อยเปิดกล้องให้สแกนเตียงต่อไป
        if (supportsLiveCamera && !videoStream) {
            startScanning();
        }
    }
}

async function goToPage(page) { 
    currentPage = page; 
    
    // 🔥 [เพิ่มใหม่] ถ้ากดเข้าหน้าบันทึกการใช้ยา ให้โชว์ Loading และวิ่งไปดึงข้อมูลสดๆ จากคลาวด์มาแค่ 10 ใบพอ
    if (page === 'records') {
        var appEl = document.getElementById('app');
        if (appEl) appEl.innerHTML = '<div style="text-align:center;padding:50px;color:#5e3db5;"><i class="fa-solid fa-spinner fa-spin" style="font-size:32px;"></i><br><br>กำลังดึงข้อมูลประวัติจากคลาวด์...</div>';
        currentRecordPage = 1;
        pageCursors = [null];
        await loadRecordsFromServer();
    }
    
    renderApp(); 
}

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
// ==================== BARCODE SCANNER MODULE (HTML5-QRCODE) ====================
let html5QrCode = null;

function startBarcodeScanner(onSuccess) {
    var existing = document.getElementById('barcodeScannerOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'barcodeScannerOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(4px);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:10000;padding:20px';
    
    overlay.innerHTML =
        '<div style="background:#fff;border-radius:16px;width:100%;max-width:380px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.5)">' +
        '<div style="background:#5e3db5;color:#fff;padding:16px;text-align:center;font-weight:600;font-size:16px"><i class="fa-solid fa-barcode"></i> สแกนบาร์โค้ดเวชภัณฑ์</div>' +
        '<div id="qr-reader" style="width:100%; min-height:250px; background:#000;"></div>' +
        '<div style="padding:15px;text-align:center;background:#f8fafc">' +
        '<button type="button" onclick="window.stopBarcodeScanner()" style="width:100%;background:#ef4444;color:#fff;border:none;padding:12px;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer;"><i class="fa-solid fa-xmark"></i> ปิดกล้อง</button>' +
        '</div></div>';

    document.body.appendChild(overlay);

    html5QrCode = new Html5Qrcode("qr-reader");
    var config = { fps: 15, qrbox: { width: 250, height: 120 } };

    html5QrCode.start(
        { facingMode: "environment" }, // บังคับเปิดกล้องหลัง
        config,
        function(decodedText, decodedResult) {
            stopBarcodeScanner();
            if (onSuccess) onSuccess(decodedText);
        },
        function(errorMessage) {
            // รอสแกนไปเรื่อยๆ ซ่อน Error ยิบย่อย
        }
    ).catch(function(err) {
        // 🔥 [แก้ไข] ถ้ากล้องพัง หรือไม่ได้รับอนุญาต ให้ปิดแค่ Pop-up ไม่ต้องสั่ง stop() ให้บั๊ก
        if (html5QrCode) {
            html5QrCode.clear();
            html5QrCode = null;
        }
        if (document.getElementById('barcodeScannerOverlay')) {
            document.getElementById('barcodeScannerOverlay').remove();
        }
        Swal.fire({ 
            icon: 'error', 
            title: 'ไม่สามารถเปิดกล้องได้', 
            text: 'โปรดอนุญาตให้เบราว์เซอร์ใช้งานกล้อง หรือตรวจดูว่ามีแอปอื่นใช้งานกล้องอยู่หรือไม่ (Error: ' + err.message + ')' 
        });
    });
}

function stopBarcodeScanner() {
    // ปิด Pop-up ทันทีให้ผู้ใช้รู้สึกว่าระบบตอบสนองไว
    var overlay = document.getElementById('barcodeScannerOverlay');
    if (overlay) overlay.remove();

    if (html5QrCode) {
        // 🔥 [แก้ไข] เช็คสถานะก่อนว่ากำลังสแกนอยู่จริงๆ ถึงจะสั่ง stop() ได้
        if (html5QrCode.isScanning) {
            html5QrCode.stop().then(function() {
                html5QrCode.clear();
                html5QrCode = null;
            }).catch(function(err) { 
                console.log("Stop Scanner Error:", err);
                html5QrCode = null; 
            });
        } else {
            html5QrCode.clear();
            html5QrCode = null;
        }
    }
}

function scanMedicineForRow(rowId) {
    startBarcodeScanner(function(barcode) {
        // วิ่งไปค้นหาในฐานข้อมูลว่ารหัสที่สแกนได้ ตรงกับยาตัวไหน?
        var foundMed = appData.inventory.find(function(m) {
            return m.barcode && m.barcode === barcode;
        });
        
        if (foundMed) {
            // ถ้าเจอ: ยัดยาเข้าช่องให้พยาบาลทันที
            window.selectSugItem(rowId, foundMed.id, foundMed.name);
            Toast.fire({ icon: 'success', title: 'พบเวชภัณฑ์: ' + foundMed.name });
        } else {
            // ถ้าไม่เจอ: แจ้งเตือนสีแดง
            Swal.fire({
                icon: 'error',
                title: 'ไม่พบเวชภัณฑ์',
                text: 'รหัสบาร์โค้ด "' + barcode + '" ยังไม่มีในระบบ กรุณาเพิ่มที่เมนูจัดการเวชภัณฑ์',
                confirmButtonColor: '#ef4444'
            });
        }
    });
}
async function handleChangeMyPassword() {
    Swal.fire({
        title: 'เปลี่ยนรหัสผ่านส่วนตัว',
        html:
            '<div style="text-align:left; font-family:inherit;">' +
            '<label style="font-size:13px; font-weight:600; color:#475569;">รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)</label>' +
            '<input type="password" id="swal-mypwd-1" class="swal2-input" style="width:100%; margin:4px 0 15px 0; padding:10px; border-radius:10px;" placeholder="พิมพ์รหัสผ่านใหม่...">' +
            '<label style="font-size:13px; font-weight:600; color:#475569;">ยืนยันรหัสผ่านใหม่อีกครั้ง</label>' +
            '<input type="password" id="swal-mypwd-2" class="swal2-input" style="width:100%; margin:4px 0 0 0; padding:10px; border-radius:10px;" placeholder="พิมพ์รหัสผ่านใหม่อีกครั้ง...">' +
            '</div>',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-floppy-disk"></i> บันทึกรหัสผ่าน',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#5e3db5',
        cancelButtonColor: '#94a3b8',
        preConfirm: () => {
            var p1 = document.getElementById('swal-mypwd-1').value;
            var p2 = document.getElementById('swal-mypwd-2').value;
            if (!p1 || p1.length < 6) {
                Swal.showValidationMessage('⚠️ รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
                return false;
            }
            if (p1 !== p2) {
                Swal.showValidationMessage('⚠️ รหัสผ่านทั้งสองช่องไม่ตรงกัน');
                return false;
            }
            return p1;
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                Swal.fire({ title: 'กำลังเปลี่ยนรหัสผ่าน...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                
                await updateCurrentUserPassword(result.value); // ส่งไปบันทึกหลังบ้าน
                
                Swal.fire({ 
                    icon: 'success', 
                    title: 'เปลี่ยนรหัสผ่านสำเร็จ!', 
                    text: 'ครั้งหน้าที่เข้าสู่ระบบ ให้ใช้รหัสผ่านใหม่นี้ได้เลยครับ', 
                    confirmButtonColor: '#5e3db5' 
                });
            } catch (err) {
                var msg = err.message;
                // กฎความปลอดภัย Firebase: ถ้า User ล็อกอินค้างไว้นานเกินไป จะเปลี่ยนรหัสไม่ได้ ต้องให้ออกแล้วเข้าใหม่
                if (msg.includes('requires-recent-login')) {
                    msg = 'เพื่อความปลอดภัยสูงสุด กรุณา "ออกจากระบบ" แล้วล็อกอินเข้ามาใหม่ 1 ครั้งก่อนทำการเปลี่ยนรหัสผ่านครับ';
                }
                Swal.fire('เปลี่ยนรหัสไม่สำเร็จ', msg, 'error');
            }
        }
    });
}

async function loadRecordsFromServer() {
    try {
        // ดึงข้อมูลมาเผื่อ 1 ตัว (เช่น ดึง 11 ตัว) เพื่อแอบเช็คว่ามีหน้าถัดไปให้กดไหม
        var cursor = pageCursors[currentRecordPage - 1];
        var list = await getRecordsPageFromFirestore(recordsPerPage + 1, cursor);
        
        if (list.length > recordsPerPage) {
            hasNextPage = true;
            list.pop(); // ตัดตัวเกินตัวที่ 11 ออก ให้เหลือโชว์สวย ๆ แค่ 10 ตัวพอ
        } else {
            hasNextPage = false;
        }
        
        serverRecords = list;
        
        // เซฟคอร์เซอร์ตัวสุดท้ายของหน้านี้เก็บไว้ เพื่อใช้เปิดหน้าถัดไป
        if (list.length > 0) {
            pageCursors[currentRecordPage] = list[list.length - 1].docSnap;
        }
    } catch (err) {
        console.error("โหลดข้อมูลประวัติจากคลาวด์ล้มเหลว:", err);
    }
}

async function handleVoidRecord(recordId) {
    // 🔥 [แก้ตรงนี้] สั่งปิด Modal รายละเอียดการเบิกทิ้งไปทันที เพื่อไม่ให้บังหน้าต่างยืนยัน
    var overlay = document.getElementById('recordModalOverlay');
    if (overlay) overlay.style.display = 'none';

    Swal.fire({
        title: 'ยืนยันการยกเลิกบิล?',
        html: 'ระบบจะดึงเวชภัณฑ์ทั้งหมดในบิลนี้<br><b style="color:#10b981;">คืนกลับเข้าสู่สต็อกคงคลังอัตโนมัติ</b><br><span style="font-size:13px;color:#ef4444;">(การกระทำนี้ไม่สามารถย้อนกลับได้)</span>',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#94a3b8',
        confirmButtonText: '<i class="fa-solid fa-arrow-rotate-left"></i> ยืนยันยกเลิกและคืนของ',
        cancelButtonText: 'ปิดหน้าต่าง'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                Swal.fire({ title: 'กำลังคืนสต็อก...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
                
                await voidRecordDoc(recordId, currentUser.name); // เรียกหลังบ้าน
                
                Toast.fire({ icon: 'success', title: 'ยกเลิกบิลและคืนสต็อกสำเร็จ' });
                
                // โหลดข้อมูลประวัติใหม่เพื่อให้อัปเดต UI ทันที
                await loadRecordsFromServer();
                renderApp();
            } catch (err) {
                Swal.fire('เกิดข้อผิดพลาด', err.message, 'error');
            }
        }
    });
}

window.toggleBedDropdown = function() {
    var body = document.getElementById('swal-dd-body');
    var icon = document.getElementById('swal-dd-icon');
    var header = document.getElementById('swal-dd-header');
    
    if (body.style.display === 'none') {
        body.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
        header.style.borderColor = '#5e3db5';
        // Auto-focus ให้พิมพ์ได้เลยทันทีที่กางออก (สำหรับคอม)
        setTimeout(() => document.getElementById('swal-bed-search').focus(), 100);
    } else {
        body.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
        header.style.borderColor = '#cbd5e1';
    }
};

// ฟังก์ชันสำหรับพิมพ์ค้นหาเตียงหรือชื่อแบบ Real-time
window.filterBedOptions = function() {
    var keyword = document.getElementById('swal-bed-search').value.toLowerCase().trim();
    var items = document.querySelectorAll('.swal-bed-item');
    items.forEach(function(item) {
        var text = item.getAttribute('data-text'); // ค้นหาจากที่ซ่อนไว้ (เจอทั้งเลขเตียงและชื่อคนไข้)
        item.style.display = text.includes(keyword) ? 'flex' : 'none';
    });
};

// ฟังก์ชันเมื่อคลิกเลือกเตียงใน Dropdown ให้หุบเก็บอัตโนมัติ
window.selectBedOption = function(id, label) {
    document.getElementById('swal-move-target-id').value = id;
    document.getElementById('swal-dd-text').innerHTML = label + ' <span style="color:#16a34a; font-size:12px; font-weight:700; margin-left:6px;"><i class="fa-solid fa-circle-check"></i> เลือกแล้ว</span>';
    
    // หุบ Dropdown ทันทีที่เลือกเสร็จ
    window.toggleBedDropdown();
    
    // ล้างสีไฮไลท์อันเก่าทิ้งให้หมด
    document.querySelectorAll('.swal-bed-item').forEach(function(item) {
        item.style.background = '#fff';
        item.style.borderLeft = '4px solid transparent';
    });
    
    // ใส่สีเขียวไฮไลท์ตัวที่เพิ่งกดเลือก (เผื่อกดกางมาดูอีกรอบ)
    var selected = document.getElementById('bed-opt-' + id);
    if(selected) {
        selected.style.background = '#f0fdf4';
        selected.style.borderLeft = '4px solid #16a34a';
    }
};

// ==================== PWA AUTO INSTALL (เด้งเตือนให้ติดตั้งแอปอัตโนมัติ) ====================
let deferredPrompt;

// 1. ระบบดักจับสำหรับเครื่อง Android (Chrome)
window.addEventListener('beforeinstallprompt', (e) => {
    // ป้องกันไม่ให้แถบติดตั้งของ Chrome เด้งขึ้นมาแบบรกๆ ด้านล่าง (เราจะใช้ SweetAlert ของเราเอง)
    e.preventDefault();
    deferredPrompt = e;

    // เช็คว่าเคยเด้งถามไปแล้วหรือยัง จะได้ไม่รบกวนการทำงานถ้าเขาไม่อยากติดตั้ง
    if (!localStorage.getItem('pwaPrompted')) {
        // หน่วงเวลา 2 วินาทีหลังจากโหลดเว็บ ค่อยเด้งขึ้นมา
        setTimeout(() => {
            Swal.fire({
                title: '📱 ติดตั้งแอป Lean Ward',
                html: 'เพิ่มแอปนี้ลงในหน้าจอมือถือของคุณเพื่อการใช้งานที่รวดเร็ว<br><span style="font-size:13px; color:#ef4444;">(ไม่ต้องพิมพ์เข้าเว็บผ่านเบราว์เซอร์อีกต่อไป)</span>',
                icon: 'info',
                showCancelButton: true,
                confirmButtonColor: '#10b981',
                cancelButtonColor: '#94a3b8',
                confirmButtonText: '<i class="fa-solid fa-download"></i> ติดตั้งแอปเลย',
                cancelButtonText: 'ไว้คราวหลัง'
            }).then((result) => {
                if (result.isConfirmed && deferredPrompt) {
                    // เรียกหน้าต่างติดตั้งของระบบขึ้นมาทำงาน
                    deferredPrompt.prompt();
                    deferredPrompt.userChoice.then(() => { 
                        deferredPrompt = null; 
                    });
                    localStorage.setItem('pwaPrompted', 'true');
                } else {
                    // ถ้าพยาบาลกด "ไว้คราวหลัง" ก็จำไว้ จะได้ไม่เด้งกวนใจอีก
                    localStorage.setItem('pwaPrompted', 'true');
                }
            });
        }, 2000);
    }
});

// 2. ระบบดักจับสำหรับเครื่อง iPhone / iPad (iOS)
window.addEventListener('load', () => {
    const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
    const isInStandaloneMode = ('standalone' in window.navigator) && (window.navigator.standalone);

    // ถ้าเข้าด้วย iPhone และยังไม่ได้รันแบบเต็มจอ (แปลว่ายังไม่ได้ติดตั้งเป็นแอป)
    if (isIos && !isInStandaloneMode && !localStorage.getItem('iosPrompted')) {
        setTimeout(() => {
            Swal.fire({
                title: '📱 สำหรับผู้ใช้ iPhone / iPad',
                html: '<div style="text-align:left; font-size:14px; line-height:1.6;">' +
                      'Apple ไม่อนุญาตให้ติดตั้งอัตโนมัติ แต่คุณทำเองได้ง่ายๆ:<br><br>' +
                      '1️⃣ กดปุ่ม <b>แชร์ (Share)</b> <i class="fa-solid fa-arrow-up-from-bracket"></i> ที่ขอบจอด้านล่าง<br>' +
                      '2️⃣ เลื่อนลงมาเลือก <b>"เพิ่มไปยังหน้าจอโฮม"</b><br> <span style="color:#64748b; margin-left:24px;">(Add to Home Screen)</span><br>' +
                      '3️⃣ กด <b>เพิ่ม (Add)</b> ที่มุมขวาบน' +
                      '</div>',
                icon: 'info',
                confirmButtonColor: '#5e3db5',
                confirmButtonText: 'รับทราบ & เข้าใจแล้ว'
            }).then(() => {
                localStorage.setItem('iosPrompted', 'true'); // จำไว้ว่าสอนแล้ว จะได้ไม่เด้งซ้ำ
            });
        }, 2000);
    }
});

// 2. ฟังก์ชันทางลัด: กดปุ่มจ่ายยาที่ผังเตียง -> กระโดดไปหน้าจ่ายยาโดยไม่เปิดกล้อง
window.goToDispense = async function(bedNumber) {
    Swal.fire({ title: 'กำลังเตรียมหน้าต่างจ่ายยา...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    // 1. แอบส่งซิกบอกหน้า Scan ว่า "ไม่ต้องเปิดกล้องนะ!"
    window.skipAutoCamera = true;
    
    // 🔥 2. [เพิ่มใหม่] ฝังป้ายความจำไว้ว่า "เรามาจากหน้าจัดการผู้ป่วยนะ"
    window.returnToPatients = true; 
    
    // 3. เปลี่ยนหน้าไปหน้า Scan
    await window.goToPage('scan');
    
    // 4. ปรับ UI หน้าจอข้างหลังให้เป็น "โหมดพิมพ์ค้นหา"
    window.switchScanMode('manual');
    
    // 5. เรียกข้อมูลเตียงและเปิด Modal จ่ายยาทันที
    window.searchByCode(bedNumber);
    
    Swal.close();
};

// 1. ฟังก์ชันกรองการ์ดเตียงแบบ Real-time
window.filterPatientCards = function() {
    var inputEl = document.getElementById('patientSearchInput');
    var selectEl = document.getElementById('patientStatusFilter');
    if (!inputEl || !selectEl) return;
    
    var keyword = inputEl.value.toLowerCase().trim();
    var statusFilter = selectEl.value; // ค่าจะเป็น: 'all', 'occupied', 'vacant'
    var cards = document.querySelectorAll('.bed-card');
    
    cards.forEach(function(card) {
        var text = card.getAttribute('data-search') || '';
        var status = card.getAttribute('data-status') || '';
        
        // เช็ค 2 เงื่อนไข: 1. พิมพ์คำค้นหาตรงไหม? และ 2. เลือกสถานะตรงไหม?
        var matchKeyword = text.includes(keyword);
        var matchStatus = (statusFilter === 'all') || (status === statusFilter);
        
        if (matchKeyword && matchStatus) {
            card.style.display = 'flex'; // โชว์การ์ด
        } else {
            card.style.display = 'none'; // ซ่อนการ์ด
        }
    });
};

// 2. ฟังก์ชันทางลัด: กดปุ่มจ่ายยาที่ผังเตียง -> กระโดดไปหน้าจ่ายยาโดยไม่เปิดกล้อง
window.goToDispense = async function(bedNumber) {
    Swal.fire({ title: 'กำลังเตรียมหน้าต่างจ่ายยา...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
    
    window.skipAutoCamera = true;
    window.returnToPatients = true; 
    
    await window.goToPage('scan');
    window.switchScanMode('manual');
    window.searchByCode(bedNumber);
    
    Swal.close();
};

// 1. ฟังก์ชันจับตาการพิมพ์และแสดง Dropdown
window.handleManualScanSearch = function() {
    var inputEl = document.getElementById('manualScanInput');
    var dropdownEl = document.getElementById('manualScanDropdown');
    if (!inputEl || !dropdownEl) return;

    var keyword = inputEl.value.toLowerCase().trim();
    dropdownEl.innerHTML = ''; 

    if (keyword.length === 0) {
        dropdownEl.style.display = 'none';
        return;
    }

    var matched = appData.patients.filter(function(p) {
        var isVacant = !p.name || p.name === '-' || p.name === 'ว่าง';
        if (isVacant) return false; 
        
        var textToSearch = (p.bed + ' ' + p.name).toLowerCase();
        return textToSearch.includes(keyword);
    });

    if (matched.length === 0) {
        dropdownEl.innerHTML = '<div style="padding: 14px; color: #ef4444; text-align: center; font-size: 14px; font-weight: 600;"><i class="fa-solid fa-circle-xmark"></i> ไม่พบรายชื่อ หรือ เตียงนี้อาจว่างอยู่</div>';
        dropdownEl.style.display = 'block';
        return;
    }

    var html = matched.map(function(p) {
        return '<div onclick="window.selectManualScan(\'' + p.bed + '\')" style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; cursor: pointer; display: flex; justify-content: space-between; align-items: center; transition: background 0.2s;" onmouseover="this.style.background=\'#f8fafc\'" onmouseout="this.style.background=\'#fff\'">' +
               '<div>' +
               '<div style="font-weight: 700; color: #1e293b; font-size: 15.5px;">👤 ' + escapeHtml(p.name) + '</div>' +
               '<div style="font-size: 13px; color: #64748b; margin-top: 4px;"><i class="fa-solid fa-bed"></i> เตียง ' + escapeHtml(p.bed) + ' | วอร์ด: ' + escapeHtml(p.ward) + '</div>' +
               '</div>' +
               '<div style="background: #5e3db5; color: #fff; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 700; box-shadow: 0 2px 4px rgba(94,61,181,0.2);"><i class="fa-solid fa-pills"></i> จ่ายยา</div>' +
               '</div>';
    }).join('');

    dropdownEl.innerHTML = html;
    dropdownEl.style.display = 'block';
};

// 2. ฟังก์ชันเมื่อพยาบาลคลิกเลือกชื่อจาก Dropdown
window.selectManualScan = function(bedNumber) {
    var inputEl = document.getElementById('manualScanInput');
    var dropdownEl = document.getElementById('manualScanDropdown');
    
    if (inputEl) inputEl.value = ''; 
    if (dropdownEl) dropdownEl.style.display = 'none'; 
    
    // สั่งเปิดหน้าต่างจ่ายยาของเตียงนั้นทันที
    window.searchByCode(bedNumber);
};

// 3. ฟังก์ชันเสริม: ถ้าเผลอกดพื้นที่ว่างข้างนอก ให้ซ่อน Dropdown
document.addEventListener('click', function(event) {
    var inputEl = document.getElementById('manualScanInput');
    var dropdownEl = document.getElementById('manualScanDropdown');
    if (inputEl && dropdownEl) {
        if (!inputEl.contains(event.target) && !dropdownEl.contains(event.target)) {
            dropdownEl.style.display = 'none';
        }
    }
});


// ==================== ระบบแจ้งเตือนเวชภัณฑ์ใกล้หมด (อัปเกรดมีปุ่มเติมสต็อก) ====================
window.alertedLowStockIds = window.alertedLowStockIds || []; // หน่วยความจำเก็บ ID ยาที่เตือนไปแล้ว

window.checkLowStockAlert = function() {
    if (!appData.inventory || appData.inventory.length === 0) return;

    // 1. กรองหายาที่สต็อกปัจจุบัน ต่ำกว่าหรือเท่ากับจุดสั่งซื้อ
    var lowStockItems = appData.inventory.filter(function(item) {
        return item.stock <= item.reorder;
    });

    // 2. อัปเดตความจำ: ถ้ายาตัวไหนถูก "เติมสต็อก" จนรอดพ้นขีดอันตรายแล้ว ให้ลืม ID นั้นทิ้งไป (เผื่ออนาคตหมดอีกจะได้เตือนใหม่)
    window.alertedLowStockIds = window.alertedLowStockIds.filter(function(alertedId) {
        return lowStockItems.some(function(item) { return item.id === alertedId; });
    });

    // 3. หายาที่ "เพิ่งจะตกเกณฑ์สดๆ ร้อนๆ" และยังไม่ได้เด้งเตือน
    var unalertedItems = lowStockItems.filter(function(item) {
        return !window.alertedLowStockIds.includes(item.id);
    });

    // 4. ถ้ามีของที่เพิ่งหมดใหม่ (หรือเพิ่งเปิดแอปครั้งแรก) ค่อยเด้ง Modal
    if (unalertedItems.length > 0) {
        var itemListHtml = lowStockItems.map(function(item) {
            var isZero = item.stock === 0;
            var stockColor = isZero ? '#ef4444' : '#f59e0b'; 
            var stockBg = isZero ? '#fef2f2' : '#fffbeb';
            var stockText = isZero ? 'หมดแล้ว!' : 'เหลือ ' + item.stock + ' ' + escapeHtml(item.unit);

            return '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; padding:14px 12px; border-bottom:1px solid #e2e8f0;">' +
                   '<div style="flex:1; font-weight:600; color:#334155; text-align:left; font-size:14px; line-height:1.4; word-break:break-word;">' + escapeHtml(item.name) + '</div>' +
                   '<div style="flex-shrink:0; white-space:nowrap; color:' + stockColor + '; background:' + stockBg + '; font-weight:700; padding:4px 10px; border-radius:8px; font-size:13px; margin-top:2px;">' + stockText + '</div>' +
                   '</div>';
        }).join('');

        Swal.fire({
            title: '<div style="color:#ef4444; font-size:28px; margin-bottom:5px;"><i class="fa-solid fa-triangle-exclamation"></i></div><span style="font-size:18px;">แจ้งเตือนเวชภัณฑ์ใกล้หมด!</span>',
            html: '<div style="margin-bottom:12px; font-size:13.5px; color:#64748b;">ขณะนี้มีรายการเวชภัณฑ์ <b>' + lowStockItems.length + '</b> รายการ ที่ถึงจุดต้องสั่งเติม:</div>' +
                  '<div style="text-align:left; max-height:40vh; overflow-y:auto; border:2px solid #e2e8f0; border-radius:12px;">' + 
                  itemListHtml + 
                  '</div>',
            showCancelButton: true,
            confirmButtonColor: '#10b981', 
            cancelButtonColor: '#94a3b8',  
            confirmButtonText: '<i class="fa-solid fa-boxes-packing"></i> เติมสต็อกตอนนี้',
            cancelButtonText: 'ไว้ทีหลัง (รับทราบ)',
            reverseButtons: true, 
            width: '90%',           
            backdrop: 'rgba(0,0,0,0.6)',
            allowOutsideClick: false
        }).then((result) => {
            // 5. พอพยาบาลกดรับทราบ ให้เอา ID ยาที่เพิ่งเตือนไป ยัดเข้าสมอง
            // รอบหน้าถ้าสต็อกยังไม่เพิ่ม มันจะได้ไม่เด้งกวนใจพยาบาลซ้ำอีก
            unalertedItems.forEach(function(item) {
                window.alertedLowStockIds.push(item.id);
            });
            
            if (result.isConfirmed) {
                window.openBulkRestockModal();
            }
        });
    }
};

// ==================== ระบบเติมสต็อกหลายรายการพร้อมกัน (Bulk Restock) ====================
window.openBulkRestockModal = function() {
    var lowStockItems = appData.inventory.filter(function(item) {
        return item.stock <= item.reorder;
    });

    if (lowStockItems.length === 0) return;

    var formHtml = lowStockItems.map(function(item) {
        return '<div style="display:flex; justify-content:space-between; align-items:center; padding:12px 10px; border-bottom:1px solid #e2e8f0;">' +
               '<div style="flex:1; text-align:left; line-height:1.4; padding-right:10px;">' +
               '<div style="font-size:14px; font-weight:600; color:#334155; word-break:break-word;">' + escapeHtml(item.name) + '</div>' + 
               '<div style="font-size:12px; color:#64748b; margin-top:2px;">(สต็อกเดิม: ' + item.stock + ' ' + escapeHtml(item.unit) + ')</div>' +
               '</div>' +
               '<div style="width:100px; flex-shrink:0;">' +
               '<input type="number" id="bulk-restock-' + item.id + '" class="swal2-input" placeholder="+ จำนวน" min="1" style="width:100%; height:40px; margin:0; padding:5px 10px; font-size:14px; text-align:center;">' +
               '</div></div>';
    }).join('');

    Swal.fire({
        title: '<span style="font-size:18px;"><i class="fa-solid fa-boxes-packing" style="color:#10b981;"></i> รับเข้าเวชภัณฑ์รวดเดียว</span>',
        html: '<div style="text-align:left; font-size:13px; color:#ef4444; margin-bottom:10px;">*ระบุจำนวนรับเข้าใหม่ (ถ้าชิ้นไหนยังไม่พร้อมเติม ให้เว้นว่างไว้)</div>' + 
              '<div style="max-height:50vh; overflow-y:auto; border:2px solid #e2e8f0; border-radius:12px; padding:0 5px;">' + formHtml + '</div>',
        showCancelButton: true,
        confirmButtonText: '<i class="fa-solid fa-floppy-disk"></i> บันทึกรับเข้า',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#5e3db5',
        cancelButtonColor: '#94a3b8',
        width: '90%',
        preConfirm: () => {
            var updates = [];
            lowStockItems.forEach(function(item) {
                var inputEl = document.getElementById('bulk-restock-' + item.id);
                if (inputEl && inputEl.value) {
                    var qty = parseInt(inputEl.value);
                    if (qty > 0) {
                        updates.push({ id: item.id, name: item.name, addQty: qty, unit: item.unit });
                    }
                }
            });
            if (updates.length === 0) {
                Swal.showValidationMessage('กรุณาระบุจำนวนเวชภัณฑ์อย่างน้อย 1 รายการ');
                return false;
            }
            return updates;
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            var updates = result.value;
            Swal.fire({ title: 'กำลังอัปเดตสต็อก...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            try {
                await Promise.all(updates.map(function(u) {
                    return restockMedicineDoc(u.id, u.addQty);
                }));
                
                var summaryHtml = updates.map(function(u) { 
                    return '<div style="padding:6px 0; border-bottom:1px dashed #e2e8f0; display:flex; justify-content:space-between;">' +
                           '<span style="color:#334155; text-align:left; font-size:13.5px;">' + escapeHtml(u.name) + '</span>' +
                           '<span style="color:#10b981; font-weight:700; flex-shrink:0; margin-left:10px;">+' + u.addQty + ' ' + escapeHtml(u.unit) + '</span></div>'; 
                }).join('');
                
                Swal.fire({
                    icon: 'success',
                    title: 'เติมสต็อกสำเร็จ!',
                    html: '<div style="max-height:200px; overflow-y:auto; border:1px solid #e2e8f0; padding:10px; border-radius:8px;">' + summaryHtml + '</div>',
                    confirmButtonColor: '#10b981'
                });
                
            } catch (err) {
                Swal.fire('เกิดข้อผิดพลาด', err.message, 'error');
            }
        }
    });
};

// ==================== ระบบ Auto-Refresh บังคับอัปเดตโค้ดใหม่ ====================
// ตัวแปรเก็บเลขเวอร์ชันปัจจุบัน (ถ้า Deploy โค้ดใหม่ ให้มาเปลี่ยนเลขนี้ด้วย)
var APP_VERSION = "4"; 

window.checkNewVersion = function() {
    // แอบไปโหลดไฟล์ version.json มาดู (ใส่ ?t=เวลา เพื่อป้องกัน Cache)
    fetch('version.json?t=' + new Date().getTime())
        .then(function(res) { return res.json(); })
        .then(function(data) {
            // ถ้าเลขเวอร์ชันบนเซิร์ฟเวอร์ ไม่ตรงกับในเครื่องพยาบาล = มีโค้ดใหม่!
            if (data.version && data.version !== APP_VERSION) {
                console.log("พบการอัปเดตระบบใหม่! กำลังรีเฟรชหน้าจอ...");
                
                // โชว์ข้อความให้พยาบาลรู้ตัวนิดนึง ก่อนบังคับรีเฟรช
                Swal.fire({
                    icon: 'info',
                    title: 'กำลังอัปเดตระบบ',
                    text: 'มีการอัปเดตฟีเจอร์ใหม่ ระบบจะทำการรีเฟรชหน้าจออัตโนมัติครับ',
                    showConfirmButton: false,
                    timer: 2000,
                    allowOutsideClick: false
                }).then(() => {
                    // คำสั่งบังคับรีเฟรชหน้าจอ (ล้าง Cache เก่าทิ้ง)
                    window.location.reload(true);
                });
            }
        })
        .catch(function(e) { console.log("ไม่สามารถเช็คอัปเดตได้:", e); });
};

// เรดาร์ทำงานแบบที่ 1: เช็คทุกๆ 30 นาที (เผื่อเปิดจอคอมพิวเตอร์ทิ้งไว้ไม่ได้ปิด)
setInterval(window.checkNewVersion, 30 * 60 * 1000);

// เรดาร์ทำงานแบบที่ 2: เช็คทันทีที่ "หยิบมือถือขึ้นมา/เปิดหน้าเว็บกลับมาดู" (Visibility Change)
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
        window.checkNewVersion();
    }
});

// ผูกฟังก์ชัน Global ตัวเสริมเข้าสู่ Window Object
window.addMedicineRow = addMedicineRow;
window.filterMedicineOptions = filterMedicineOptions;
window.submitMultiRecords = submitMultiRecords;
window.openSearchSug = openSearchSug;
window.filterSearchSug = filterSearchSug;
window.selectSugItem = selectSugItem;
window.toggleSidebar = toggleSidebar;
window.goToPage = goToPage;
window.handleLogout = handleLogout;
window.submitEmailLogin = submitEmailLogin;
window.handleAddEmployee = handleAddEmployee;
window.handleDeleteEmployee = handleDeleteEmployee;
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
window.cancelRecord = cancelRecord;
window.handleIOSMedCapture = handleIOSMedCapture;
window.viewRecordDetails = viewRecordDetails;
window.exportRecordsToExcel = exportRecordsToExcel;
window.openExportModal = openExportModal;
window.exportRecordsWithFilter = exportRecordsWithFilter;
window.promptRestock = promptRestock;
window.promptMoveBed = promptMoveBed;
window.clearMedicineInput = clearMedicineInput;
window.showBarcode = showBarcode;
window.startBarcodeScanner = startBarcodeScanner;
window.stopBarcodeScanner = stopBarcodeScanner;
window.scanMedicineForRow = scanMedicineForRow;
window.handleChangeMyPassword = handleChangeMyPassword;
window.changeRecordPage = changeRecordPage;
window.handleVoidRecord = handleVoidRecord;