// ==============================================================
// 1. Supabase 連線參數設定 (請替換為你的後台真實資料)
// 注意：URL 尾端不可帶 /rest/v1/ 或任何斜線
// ==============================================================
const SUPABASE_URL = "https://qdiwyzkjgxvuinulpvsg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaXd5emtqZ3h2dWludWxwdnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4Mjg4ODQsImV4cCI6MjEwNTQwNDg4NH0.U_IUlKcz-6Qgr_AmEf-EyVTabdfs5oMEQXujBiRDfVg";

// 物品條碼對照表
const ASSET_MAP = {
  "K01": "視聽教室鑰匙",
  "K02": "電腦教室鑰匙",
  "K03": "創客中心鑰匙",
  "K04": "會議室鑰匙",
  "K05": "專科教室鑰匙"
};

// 避免變數重複命名
let sbClient = null;
let isOnline = false;

// 本地快取資料
let records = JSON.parse(localStorage.getItem('borrow_records') || '[]');

let padBorrow = null;
let padReturn = null;
let activeScanner = null;
let pendingReturnRecord = null;
let currentDetailTab = 'unreturned';

// ==========================================
// 2. 初始化與連線檢查
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  initSupabase();
  updateCounts();
});

function initSupabase() {
  const dot = document.getElementById('dbStatusDot');
  const text = document.getElementById('dbStatusText');

  if (SUPABASE_URL.includes("...") || SUPABASE_ANON_KEY.includes("...")) {
    setOfflineUI("未填入 Supabase 金鑰（本地離線模式）");
    return;
  }

  try {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    checkConnection();
  } catch (e) {
    setOfflineUI("連線初始化失敗（本地模式）");
  }
}

async function checkConnection() {
  const dot = document.getElementById('dbStatusDot');
  const text = document.getElementById('dbStatusText');

  try {
    const { data, error } = await sbClient.from('borrow_records').select('id').limit(1);
    if (!error) {
      isOnline = true;
      dot.className = "status-dot online";
      text.innerText = "雲端資料庫已連線";
      loadCloudRecords();
    } else {
      setOfflineUI("連線異常: " + error.message);
    }
  } catch (err) {
    setOfflineUI("網路離線（使用本地快取）");
  }
}

function setOfflineUI(msg) {
  isOnline = false;
  const dot = document.getElementById('dbStatusDot');
  const text = document.getElementById('dbStatusText');
  if (dot && text) {
    dot.className = "status-dot offline";
    text.innerText = msg;
  }
}

// ==========================================
// 3. 資料庫存取與同步
// ==========================================
async function loadCloudRecords() {
  if (!isOnline || !sbClient) return;
  try {
    const { data, error } = await sbClient
      .from('borrow_records')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      records = data.map(r => ({
        id: r.id,
        itemId: r.item_id,
        itemName: r.item_name,
        role: r.borrower_role,
        studentClass: r.borrower_class,
        studentSeat: r.borrower_seat,
        teacherDept: r.borrower_dept,
        borrowerName: r.borrower_name,
        borrowTime: r.borrow_time,
        qty: r.borrow_qty,
        purpose: r.borrow_purpose,
        borrowSign: r.borrow_sign,
        status: r.status,
        returnerName: r.returner_name,
        returnTime: r.return_time,
        returnSign: r.return_sign,
        remark: r.return_remark
      }));
      localStorage.setItem('borrow_records', JSON.stringify(records));
      updateCounts();
      if (document.getElementById('viewDetails').classList.contains('active')) {
        renderTable();
      }
    }
  } catch (e) {
    console.error("載入雲端紀錄失敗", e);
  }
}

async function syncLocalRecords() {
  if (!isOnline || !sbClient) {
    alert("目前處於離線狀態或金鑰未填寫，無法同步。");
    return;
  }
  await loadCloudRecords();
  alert("已成功與雲端資料庫完成同步！");
}

function saveLocal() {
  localStorage.setItem('borrow_records', JSON.stringify(records));
  updateCounts();
}

function updateCounts() {
  const unreturned = records.filter(r => r.status === 'borrowed').length;
  const returned = records.filter(r => r.status === 'returned').length;
  document.getElementById('countUnreturned').innerText = unreturned;
  document.getElementById('countReturned').innerText = returned;
}

// ==========================================
// 4. 頁面切換與手寫畫布
// ==========================================
function getNow() {
  return new Date().toLocaleString('zh-TW', { hour12: false });
}

function initPad(canvasId) {
  const canvas = document.getElementById(canvasId);
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = canvas.offsetWidth * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  canvas.getContext("2d").scale(ratio, ratio);
  return new SignaturePad(canvas, { backgroundColor: 'rgb(255, 255, 255)' });
}

function toggleRoleFields() {
  const role = document.querySelector('input[name="borrowRole"]:checked').value;
  const groupStudent = document.getElementById('groupStudent');
  const groupTeacher = document.getElementById('groupTeacher');

  if (role === 'student') {
    groupStudent.style.display = 'grid';
    groupTeacher.style.display = 'none';
  } else {
    groupStudent.style.display = 'none';
    groupTeacher.style.display = 'block';
  }
}

function navigateTo(viewId) {
  stopCamera();
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');

  if (viewId === 'viewBorrow') {
    document.getElementById('borrowTime').value = getNow();
    toggleRoleFields();
    setTimeout(() => { padBorrow = initPad('padBorrow'); }, 200);
  }
  if (viewId === 'viewReturn') {
    document.getElementById('returnTime').value = getNow();
    setTimeout(() => { padReturn = initPad('padReturn'); }, 200);
  }
  if (viewId === 'viewDetails') {
    renderTable();
  }
}

// ==========================================
// 5. 正方形掃描器與條碼處理
// ==========================================
function handleScanResult(decodedText, mode) {
  const cleanCode = decodedText.trim();
  const itemName = ASSET_MAP[cleanCode] || "自訂物品";

  if (mode === 'borrow') {
    const existing = records.find(r => r.itemId === cleanCode && r.status === 'borrowed');
    if (existing) {
      alert(`物品 [${cleanCode}] 目前由【${existing.borrowerName}】借用中，尚未歸還！`);
      return;
    }
    document.getElementById('borrowItemId').value = `[${cleanCode}] ${itemName}`;
    document.getElementById('borrowItemId').dataset.rawId = cleanCode;
    document.getElementById('borrowItemId').dataset.rawName = itemName;
    document.getElementById('borrowTime').value = getNow();
  } else if (mode === 'return') {
    const record = records.find(r => r.itemId === cleanCode && r.status === 'borrowed');
    if (!record) {
      alert(`查無此物品 [${cleanCode}] 的未歸還紀錄！`);
      return;
    }
    pendingReturnRecord = record;
    document.getElementById('refItem').innerText = `[${record.itemId}] ${record.itemName || ''}`;
    document.getElementById('refTime').innerText = record.borrowTime;
    document.getElementById('refBorrower').innerText = `${record.role === 'teacher' ? '[教師] ' + record.teacherDept : '[學生] ' + record.studentClass + ' ' + record.studentSeat + '號'} - ${record.borrowerName}`;
    document.getElementById('refPurpose').innerText = `${record.qty} 件 / ${record.purpose || '無'}`;
    document.getElementById('returnRefPanel').style.display = 'block';
    document.getElementById('returnTime').value = getNow();
  }
}

function mockScanBorrow(code) { handleScanResult(code, 'borrow'); }
function mockScanReturn(code) { handleScanResult(code, 'return'); }

function toggleCamera(mode) {
  const containerId = mode === 'borrow' ? 'readerBorrow' : 'readerReturn';
  const btnId = mode === 'borrow' ? 'btnCamBorrow' : 'btnCamReturn';
  const btn = document.getElementById(btnId);

  if (activeScanner) {
    stopCamera();
    btn.innerText = "開啟前鏡頭掃碼";
    return;
  }

  activeScanner = new Html5Qrcode(containerId);
  // 正方形配置：寬高固定 160，aspectRatio 設定 1.0
  activeScanner.start(
    { facingMode: "user" },
    { fps: 10, qrbox: { width: 160, height: 160 }, aspectRatio: 1.0 },
    (decodedText) => {
      handleScanResult(decodedText, mode);
      stopCamera();
      btn.innerText = "開啟前鏡頭掃碼";
    },
    (err) => {}
  ).then(() => {
    btn.innerText = "關閉相機";
  }).catch(err => alert("相機啟動失敗 (請確認 HTTPS 與權限): " + err));
}

function stopCamera() {
  if (activeScanner) {
    activeScanner.stop().catch(() => {});
    activeScanner = null;
    const b1 = document.getElementById('btnCamBorrow');
    const b2 = document.getElementById('btnCamReturn');
    if (b1) b1.innerText = "開啟前鏡頭掃碼";
    if (b2) b2.innerText = "開啟前鏡頭掃碼";
  }
}

// ==========================================
// 6. 表單提交：借出與歸還
// ==========================================
async function submitBorrow() {
  const inputEl = document.getElementById('borrowItemId');
  const rawId = inputEl.dataset.rawId;
  const rawName = inputEl.dataset.rawName;
  const role = document.querySelector('input[name="borrowRole"]:checked').value;
  const borrowerName = document.getElementById('borrowName').value.trim();
  const qty = parseInt(document.getElementById('borrowQty').value, 10) || 1;
  const purpose = document.getElementById('borrowPurpose').value.trim();

  let studentClass = '';
  let studentSeat = '';
  let teacherDept = '';

  if (!rawId) { alert('請先掃描物品 QR Code！'); return; }
  if (!borrowerName) { alert('請填寫借用人姓名！'); return; }

  if (role === 'student') {
    studentClass = document.getElementById('borrowStudentClass').value.trim();
    studentSeat = document.getElementById('borrowStudentSeat').value.trim();
    if (!studentClass || !studentSeat) {
      alert('學生借用請填寫「班級」與「座號」！');
      return;
    }
  } else {
    teacherDept = document.getElementById('borrowTeacherDept').value;
  }

  if (padBorrow.isEmpty()) { alert('請借用人於下方畫布簽名！'); return; }

  const newRec = {
    id: 'rec_' + Date.now(),
    item_id: rawId,
    item_name: rawName,
    borrower_role: role,
    borrower_class: studentClass,
    borrower_seat: studentSeat,
    borrower_dept: teacherDept,
    borrower_name: borrowerName,
    borrow_time: document.getElementById('borrowTime').value,
    borrow_qty: qty,
    borrow_purpose: purpose,
    borrow_sign: padBorrow.toDataURL(),
    status: 'borrowed'
  };

  // 本地快取先儲存
  records.unshift({
    id: newRec.id,
    itemId: newRec.item_id,
    itemName: newRec.item_name,
    role: newRec.borrower_role,
    studentClass: newRec.borrower_class,
    studentSeat: newRec.borrower_seat,
    teacherDept: newRec.borrower_dept,
    borrowerName: newRec.borrower_name,
    borrowTime: newRec.borrow_time,
    qty: newRec.borrow_qty,
    purpose: newRec.borrow_purpose,
    borrowSign: newRec.borrow_sign,
    status: 'borrowed'
  });
  saveLocal();

  // 若在線則寫入 Supabase
  if (isOnline && sbClient) {
    const { error } = await sbClient.from('borrow_records').insert([newRec]);
    if (error) console.error("雲端存檔警告:", error.message);
  }

  alert('【借出登記成功】！');

  // 清空表單欄位
  inputEl.value = '';
  delete inputEl.dataset.rawId;
  delete inputEl.dataset.rawName;
  document.getElementById('borrowName').value = '';
  document.getElementById('borrowStudentClass').value = '';
  document.getElementById('borrowStudentSeat').value = '';
  document.getElementById('borrowPurpose').value = '';
  padBorrow.clear();
  navigateTo('viewHome');
}

async function submitReturn() {
  if (!pendingReturnRecord) {
    alert('請先掃描要歸還的物品！');
    return;
  }
  const returnerName = document.getElementById('returnerName').value.trim();
  if (!returnerName) {
    alert('請填寫歸還人姓名！');
    return;
  }
  if (padReturn.isEmpty()) {
    alert('請歸還人於下方畫布簽名！');
    return;
  }

  const returnTime = document.getElementById('returnTime').value;
  const returnSign = padReturn.toDataURL();
  const remark = document.getElementById('returnRemark').value.trim();

  // 更新本地紀錄
  pendingReturnRecord.returnerName = returnerName;
  pendingReturnRecord.returnTime = returnTime;
  pendingReturnRecord.returnSign = returnSign;
  pendingReturnRecord.remark = remark;
  pendingReturnRecord.status = 'returned';
  saveLocal();

  // 若在線則同步更新 Supabase
  if (isOnline && sbClient) {
    const { error } = await sbClient.from('borrow_records')
      .update({
        returner_name: returnerName,
        return_time: returnTime,
        return_sign: returnSign,
        return_remark: remark,
        status: 'returned'
      })
      .eq('id', pendingReturnRecord.id);

    if (error) console.error("雲端更新警告:", error.message);
  }

  alert('【物品歸還結案成功】！');

  pendingReturnRecord = null;
  document.getElementById('returnRefPanel').style.display = 'none';
  document.getElementById('returnerName').value = '';
  document.getElementById('returnRemark').value = '';
  padReturn.clear();
  navigateTo('viewHome');
}

// ==========================================
// 7. 詳細資料渲染
// ==========================================
function switchDetailTab(tab) {
  currentDetailTab = tab;
  document.getElementById('tabUnreturned').classList.toggle('active', tab === 'unreturned');
  document.getElementById('tabReturned').classList.toggle('active', tab === 'returned');
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('recordTableBody');
  const isReturnedTab = currentDetailTab === 'returned';

  document.getElementById('thReturnTime').style.display = isReturnedTab ? '' : 'none';
  document.getElementById('thReturner').style.display = isReturnedTab ? '' : 'none';
  document.getElementById('thReturnSign').style.display = isReturnedTab ? '' : 'none';
  document.getElementById('thRemark').style.display = isReturnedTab ? '' : 'none';

  const filtered = records.filter(r => isReturnedTab ? r.status === 'returned' : r.status === 'borrowed');
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; color:#9ca3af; padding:24px;">目前沒有任何項目</td></tr>`;
    return;
  }

  filtered.forEach(r => {
    const tr = document.createElement('tr');
    const badge = r.status === 'borrowed' 
      ? `<span class="status-badge status-borrowed">借出中</span>` 
      : `<span class="status-badge status-returned">已歸還</span>`;

    const roleBadge = r.role === 'teacher'
      ? `<span class="role-badge badge-teacher">教師 (${r.teacherDept || ''})</span>`
      : `<span class="role-badge badge-student">學生 (${r.studentClass || ''} ${r.studentSeat ? r.studentSeat + '號' : ''})</span>`;
    
    const signBorrowImg = r.borrowSign ? `<img src="${r.borrowSign}" class="sign-thumbnail">` : '-';
    const signReturnImg = r.returnSign ? `<img src="${r.returnSign}" class="sign-thumbnail">` : '-';

    let html = `
      <td>${badge}</td>
      <td style="font-weight:600;">[${r.itemId}] ${r.itemName || ''}</td>
      <td>${roleBadge}</td>
      <td>${r.borrowerName || '-'}</td>
      <td>${r.borrowTime}</td>
      <td>${signBorrowImg}</td>
    `;

    if (isReturnedTab) {
      html += `
        <td>${r.returnTime || '-'}</td>
        <td>${r.returnerName || '-'}</td>
        <td>${signReturnImg}</td>
        <td>${r.remark || '-'}</td>
      `;
    }

    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
}
