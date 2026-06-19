// Lean QR Code Medical Supply Tracking System
// Complete application implementation

let currentPage = 'dashboard';
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
    // Remove active from all nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    // Add active to current page
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

// ==================== DATA PERSISTENCE ====================
function loadData() {
    const saved = localStorage.getItem('leanAppData');
    if (saved) {
        appData = JSON.parse(saved);
    } else {
        // Initialize with sample data
        appData = {
            patients: [
                { id: 1, hn: 'HN001', name: 'สมชาย คำดี', ward: 'A', bed: '101' },
                { id: 2, hn: 'HN002', name: 'สมหญิง ใจดี', ward: 'B', bed: '205' }
            ],
            inventory: [
                { id: 1, code: 'MED001', name: 'Paracetamol 500mg', stock: 100, unit: 'เม็ด', reorder: 50 },
                { id: 2, code: 'MED002', name: 'Amoxicillin 500mg', stock: 80, unit: 'เม็ด', reorder: 40 },
                { id: 3, code: 'MED003', name: 'Normal Saline 1L', stock: 30, unit: 'ขวด', reorder: 15 }
            ],
            records: [
                { id: 1, date: new Date().toLocaleString('th-TH'), patientName: 'สมชาย คำดี', medicineName: 'Paracetamol 500mg', quantity: 2 }
            ]
        };
        saveData();
    }
}

function saveData() {
    localStorage.setItem('leanAppData', JSON.stringify(appData));
}

// ==================== MAIN RENDER FUNCTION ====================
function renderApp() {
    const app = document.getElementById('app');
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
    }

    updateNavigation();
    attachEventListeners();
    
    // Close sidebar on mobile when navigating
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('appSidebar');
        if (sidebar) {
            sidebar.classList.remove('active');
        }
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
                    <div class="qr-container">
                        <h2><i class="fa-solid fa-qrcode"></i> สแกน QR Code เพื่อเข้าใช้งาน</h2>
                        <div id="qr-code"></div>
                        <p class="qr-hint">ใช้กล้องโทรศัพท์มือถือสแกน QR นี้เพื่อเปิดระบบบนมือถือ</p>
                    </div>

                    <div class="dashboard-right">
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
                            <button class="quick-action-card" onclick="goToPage('scan')">
                                <i class="fa-solid fa-qrcode"></i>
                                <span>สแกนเวชภัณฑ์</span>
                            </button>
                            <button class="quick-action-card" onclick="goToPage('patients')">
                                <i class="fa-solid fa-user-injured"></i>
                                <span>จัดการผู้ป่วย</span>
                            </button>
                            <button class="quick-action-card" onclick="goToPage('medicines')">
                                <i class="fa-solid fa-pills"></i>
                                <span>จัดการเวชภัณฑ์</span>
                            </button>
                            <button class="quick-action-card" onclick="goToPage('inventory')">
                                <i class="fa-solid fa-boxes-stacked"></i>
                                <span>ยอดคงคลัง</span>
                            </button>
                            <button class="quick-action-card" onclick="goToPage('records')">
                                <i class="fa-solid fa-clipboard-list"></i>
                                <span>บันทึกการใช้</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Generate QR code
    setTimeout(() => {
        const qrElement = document.getElementById('qr-code');
        if (qrElement) {
            qrElement.innerHTML = '';
            // Generate QR code with full URL including protocol
            const protocol = window.location.protocol;
            const host = window.location.host;
            const pathname = window.location.pathname;
            const fullUrl = protocol + '//' + host + pathname;
            
            new QRCode(qrElement, {
                text: fullUrl,
                width: 220,
                height: 220,
                colorDark: '#5e3db5',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.H
            });
        }
    }, 100);
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

    // Render patient list
    const patientList = container.querySelector('#patientList');
    if (appData.patients.length > 0) {
        patientList.innerHTML = appData.patients.map(patient => `
            <div class="list-item">
                <div class="item-info">
                    <div class="item-title">${patient.name}</div>
                    <div class="item-detail">เลขที่บัตร: ${patient.hn} | หอ ${patient.ward} | เตียง ${patient.bed}</div>
                </div>
                <button class="btn-delete" onclick="deletePatient(${patient.id})"><i class="fa-solid fa-trash"></i> ลบ</button>
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

    // Render medicine list
    const medicineList = container.querySelector('#medicineList');
    if (appData.inventory.length > 0) {
        medicineList.innerHTML = appData.inventory.map(medicine => `
            <div class="list-item" style="${medicine.stock <= medicine.reorder ? 'background: #fef2f2;' : ''}">
                <div class="item-info">
                    <div class="item-title">${medicine.name}</div>
                    <div class="item-detail">รหัส: ${medicine.code} | คงเหลือ: ${medicine.stock} ${medicine.unit}</div>
                    ${medicine.stock <= medicine.reorder ? '<div style="color: #ef4444; margin-top: 5px; font-weight: 700;"><i class="fa-solid fa-triangle-exclamation"></i> ต่ำกว่าเตือนใหม่</div>' : ''}
                </div>
                <button class="btn-delete" onclick="deleteMedicine(${medicine.id})"><i class="fa-solid fa-trash"></i> ลบ</button>
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
                <button class="btn-back" onclick="goToPage('dashboard')"><i class="fa-solid fa-arrow-left"></i> กลับ</button>
            </div>

            <div class="page-content">
                <div class="scan-mode-toggle">
                    <button class="mode-btn active" onclick="switchScanMode('camera')"><i class="fa-solid fa-camera"></i> กล้อง</button>
                    <button class="mode-btn" onclick="switchScanMode('manual')"><i class="fa-solid fa-keyboard"></i> พิมพ์ด้วยมือ</button>
                </div>

                <div id="cameraMode" class="scan-mode active">
                    <div id="qr-scan-area" class="qr-scan-area">
                        <video id="scan-video"></video>
                    </div>
                    <p class="page-subtitle" style="text-align:center;">วาง QR Code ให้อยู่ในกรอบกล้องเพื่อสแกน</p>
                    <div style="text-align:center;">
                        <button id="startScanBtn" class="btn-primary" onclick="startScanning()"><i class="fa-solid fa-play"></i> เริ่มสแกน</button>
                        <button id="stopScanBtn" class="btn-secondary" onclick="stopScanning()" style="display:none;"><i class="fa-solid fa-stop"></i> หยุดสแกน</button>
                    </div>
                </div>

                <div id="manualMode" class="scan-mode">
                    <div class="form-group">
                        <label>ป้อนรหัสเวชภัณฑ์</label>
                        <input type="text" id="medicineCodeInput" placeholder="เช่น MED001">
                    </div>
                    <button class="btn-primary" onclick="searchByCode()"><i class="fa-solid fa-magnifying-glass"></i> ค้นหา</button>
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
                    <button class="btn-primary" onclick="submitRecord()"><i class="fa-solid fa-check"></i> บันทึก</button>
                    <button class="btn-secondary" onclick="cancelRecord()"><i class="fa-solid fa-xmark"></i> ยกเลิก</button>
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
                <div class="record-date">${record.date}</div>
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
            </div>
        `).join('');
    }
}

// ==================== PATIENT CRUD ====================
function addPatient(e) {
    e.preventDefault();
    const hn = document.getElementById('patientHN').value;
    const name = document.getElementById('patientName').value;
    const ward = document.getElementById('patientWard').value;
    const bed = document.getElementById('patientBed').value;

    if (hn && name && ward && bed) {
        const newId = Math.max(...appData.patients.map(p => p.id), 0) + 1;
        appData.patients.push({ id: newId, hn, name, ward, bed });
        saveData();
        goToPage('patients');
    }
}

function deletePatient(id) {
    if (confirm('ต้องการลบผู้ป่วยนี้ใช่หรือไม่?')) {
        appData.patients = appData.patients.filter(p => p.id !== id);
        saveData();
        renderApp();
    }
}

// ==================== MEDICINE CRUD ====================
function addMedicine(e) {
    e.preventDefault();
    const code = document.getElementById('medicineCode').value;
    const name = document.getElementById('medicineName').value;
    const stock = parseInt(document.getElementById('medicineStock').value);
    const unit = document.getElementById('medicineUnit').value;
    const reorder = parseInt(document.getElementById('medicineReorder').value);

    if (code && name && unit && !isNaN(stock) && !isNaN(reorder)) {
        const newId = Math.max(...appData.inventory.map(i => i.id), 0) + 1;
        appData.inventory.push({ id: newId, code, name, stock, unit, reorder });
        saveData();
        goToPage('medicines');
    }
}

function deleteMedicine(id) {
    if (confirm('ต้องการลบเวชภัณฑ์นี้ใช่หรือไม่?')) {
        appData.inventory = appData.inventory.filter(i => i.id !== id);
        saveData();
        renderApp();
    }
}

// ==================== QR CODE SCANNING ====================
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
        document.querySelector('[onclick="switchScanMode(\'camera\')"]').classList.add('active');
    } else {
        if (cameraMode) cameraMode.style.display = 'none';
        if (manualMode) manualMode.style.display = 'block';
        document.querySelector('[onclick="switchScanMode(\'manual\')"]').classList.add('active');
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

function submitRecord() {
    const patientName = document.getElementById('recordPatient').value;
    const quantity = parseInt(document.getElementById('recordQuantity').value);

    if (!patientName || !currentScannedMedicine || !quantity) {
        alert('กรุณากรอกข้อมูลให้ครบถ้วน');
        return;
    }

    const newId = Math.max(...appData.records.map(r => r.id || 0), 0) + 1;
    appData.records.push({
        id: newId,
        date: new Date().toLocaleString('th-TH'),
        patientName,
        medicineName: currentScannedMedicine.name,
        quantity
    });

    // Update stock
    currentScannedMedicine.stock -= quantity;

    saveData();
    alert('บันทึกการใช้เวชภัณฑ์สำเร็จ');
    cancelRecord();
    goToPage('dashboard');
}

function cancelRecord() {
    const recordForm = document.getElementById('recordForm');
    const scanResult = document.getElementById('scanResult');
    if (recordForm) recordForm.style.display = 'none';
    if (scanResult) scanResult.style.display = 'none';
    document.getElementById('medicineCodeInput').value = '';
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

    if (addPatientForm) {
        addPatientForm.addEventListener('submit', addPatient);
    }

    if (addMedicineForm) {
        addMedicineForm.addEventListener('submit', addMedicine);
    }
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    renderApp();
});