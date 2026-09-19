// ==============================================================
// 1. 請填入你的 Supabase 連線資訊
// ==============================================================
const SUPABASE_URL = "https://qdiwyzkjgxvuinulpvsg.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaXd5emtqZ3h2dWludWxwdnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4Mjg4ODQsImV4cCI6MjEwNTQwNDg4NH0.U_IUlKcz-6Qgr_AmEf-EyVTabdfs5oMEQXujBiRDfVg";

// 全域捕獲 JS 未預期報錯，避免無聲掛起
window.addEventListener('error', function(event) {
  const text = document.getElementById('cloudStatusText');
  const dot = document.getElementById('cloudDot');
  if (text && dot) {
    dot.className = 'dot dot-red';
    text.innerText = 'JS執行異常: ' + (event.message || '未知錯誤');
  }
});

let supabase = null;
let records = JSON.parse(localStorage.getItem('borrow_records') || '[]');
let padBorrow = null, padReturn = null;
let activeScanner = null;
let pendingReturnRecord = null;
let currentDetailTab = 'unreturned';

const fallbackCatalog = {
  "K01": "視聽教室鑰匙",
  "K02": "電腦教室(一)鑰匙",
  "K03": "電腦教室(二)鑰匙",
  "K04": "活動中心大門鑰匙",
  "K05": "會議室鑰匙"
};

function getNow() {
  return new Date().toLocaleString('zh-TW', { hour12: false });
}

function initPad(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.SignaturePad) return null;
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = canvas.offsetWidth * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.scale(ratio, ratio);
  return new SignaturePad(canvas, { backgroundColor: 'rgb(255, 255, 255)' });
}

function toggleRoleFields() {
  const checkedRadio = document.querySelector('input[name="borrowRole"]:checked');
  if (!checkedRadio) return;
  const role = checkedRadio.value;
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

// 連線檢測：加入強制 3 秒超時中斷
async function initSupabase() {
  const dot = document.getElementById('cloudDot');
  const text = document.getElementById('cloudStatusText');

  if (!SUPABASE_URL || SUPABASE_URL.indexOf("你的專案ID") !== -1) {
    dot.className = 'dot dot-red';
    text.innerText = '本地離線模式 (未填金鑰)';
    return;
  }

  if (!window.supabase || !window.supabase.createClient) {
    dot.className = 'dot dot-red';
    text.innerText = '本地離線模式 (Supabase SDK未載入)';
    return;
  }

  try {
    const cleanUrl = SUPABASE_URL.trim().replace(/\/$/, "");
    const cleanKey = SUPABASE_ANON_KEY.trim();
    supabase = window.supabase.createClient(cleanUrl, cleanKey);

    // 3 秒強制逾時保險
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("連線逾時")), 3000)
    );

    const testQuery = supabase.from('borrow_records').select('id').limit(1);
    const { error } = await Promise.race([testQuery, timeoutPromise]);

    if (error) {
      console.warn("Supabase 資料庫回傳錯誤:", error);
      dot.className = 'dot dot-red';
      text.innerText = '連線失敗: ' + (error.message || '權限或表名錯誤');
    } else {
      dot.className = 'dot dot-green';
      text.innerText = '雲端資料庫已連線';
    }
  } catch (err) {
    console.warn("連線檢測異常:", err);
    dot.className = 'dot dot-red';
    text.innerText = '本地離線模式 (' + (err.message || '超時') + ')';
  }
}

async function getItemName(code) {
  if (supabase) {
    try {
      const { data } = await supabase.from('items').select('name').eq('id', code).single();
      if (data && data.name) return data.name;
    } catch (e) {}
  }
  return fallbackCatalog[code] || `物品 (${code})`;
}

async function fetchCloudRecords() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('borrow_records')
      .select('*')
      .order('id', { ascending: false });
    if (!error && data) {
      records = data.map(r => ({
        id: r.id,
        itemId: r.item_id,
        itemName: r.item_name,
        role: r.role,
        studentClass: r.student_class,
        studentSeat: r.student_seat,
        teacherDept: r.teacher_dept,
        borrowerDisplay: r.borrower_display,
        qty: r.qty,
        borrowTime: r.borrow_time,
        purpose: r.purpose,
        borrowSign: r.borrow_sign,
        returnTime: r.return_time,
        returnSign: r.return_sign,
        remark: r.remark,
        status: r.status
      }));
      localStorage.setItem('borrow_records', JSON.stringify(records));
      updateCounts();
    }
  } catch (err) {}
}

function updateCounts() {
  const unreturned = records.filter(r => r.status === 'borrowed').length;
  const returned = records.filter(r => r.status === 'returned').length;
  const elUn = document.getElementById('countUnreturned');
  const elRe = document.getElementById('countReturned');
  if (elUn) elUn.innerText = unreturned;
  if (elRe) elRe.innerText = returned;
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

async function handleScanResult(decodedText, mode) {
  const code = decodedText.trim();
  const name = await getItemName(code);

  if (mode === 'borrow') {
    const existing = records.find(r => r.itemId === code && r.status === 'borrowed');
    if (existing) {
      alert(`物品 [${code}] ${name} 已經借出中！\n借用人：${existing.borrowerDisplay}\n尚未歸還，無法重複借出。`);
      return;
    }
    document.getElementById('borrowItemId').value = code;
    document.getElementById('borrowItemName').value = name;
    document.getElementById('borrowItemDisplay').value = `[${code}] ${name}`;
    document.getElementById('borrowTime').value = getNow();
  } else if (mode === 'return') {
    const record = records.find(r => r.itemId === code && r.status === 'borrowed');
    if (!record) {
      alert(`查無物品 [${code}] ${name} 的借出中紀錄。`);
      return;
    }
    pendingReturnRecord = record;
    document.getElementById('refItem').innerText = `[${record.itemId}] ${record.itemName}`;
    document.getElementById('refTime').innerText = record.borrowTime;
    document.getElementById('refBorrower').innerText = `${record.role === 'teacher' ? '[教師] ' : '[學生] '}${record.borrowerDisplay}`;
    document.getElementById('refPurpose').innerText = `${record.qty} 件 / ${record.purpose}`;
    document.getElementById('returnRefPanel').style.display = 'block';
    document.getElementById('returnTime').value = getNow();
  }
}

function mockScanBorrow(code) { handleScanResult(code, 'borrow'); }
function mockScanReturn(code) { handleScanResult(code, 'return'); }

function toggleCamera(mode) {
  if (!window.Html5Qrcode) {
    alert("相機模組載入中，請稍候重試。");
    return;
  }
  const containerId = mode === 'borrow' ? 'readerBorrow' : 'readerReturn';
  const btnId = mode === 'borrow' ? 'btnCamBorrow' : 'btnCamReturn';
  const btn = document.getElementById(btnId);

  if (activeScanner) {
    stopCamera();
    btn.innerText = "開啟相機";
    return;
  }

  activeScanner = new Html5Qrcode(containerId);
  activeScanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 140, height: 140 } },
    (decodedText) => {
      handleScanResult(decodedText, mode);
      stopCamera();
      btn.innerText = "開啟相機";
    },
    () => {}
  ).then(() => {
    btn.innerText = "關閉相機";
  }).catch(err => alert("相機啟動失敗: " + err));
}

function stopCamera() {
  if (activeScanner) {
    activeScanner.stop().catch(() => {});
    activeScanner = null;
  }
}

async function submitBorrow() {
  const itemId = document.getElementById('borrowItemId').value;
  const itemName = document.getElementById('borrowItemName').value;
  const role = document.querySelector('input[name="borrowRole"]:checked').value;
  const qty = parseInt(document.getElementById('borrowQty').value, 10) || 1;
  const purpose = document.getElementById('borrowPurpose').value.trim();

  let borrowerDisplay = '';
  let studentClass = '';
  let studentSeat = '';
  let teacherDept = '';

  if (!itemId) { alert('請先掃描借出物品 QR Code！'); return; }

  if (role === 'student') {
    studentClass = document.getElementById('borrowStudentClass').value.trim();
    studentSeat = document.getElementById('borrowStudentSeat').value.trim();
    if (!studentClass || !studentSeat) {
      alert('學生借用請填寫「班級」與「座號」！');
      return;
    }
    borrowerDisplay = `${studentClass} ${studentSeat} 號`;
  } else {
    teacherDept = document.getElementById('borrowTeacherDept').value;
    borrowerDisplay = teacherDept;
  }

  if (!padBorrow || padBorrow.isEmpty()) {
    alert('請借用人於畫布手寫姓名簽名！');
    return;
  }

  const borrowSignData = padBorrow.toDataURL();
  const borrowTimeVal = document.getElementById('borrowTime').value;

  const dbPayload = {
    item_id: itemId,
    item_name: itemName,
    role: role,
    student_class: studentClass,
    student_seat: studentSeat,
    teacher_dept: teacherDept,
    borrower_display: borrowerDisplay,
    qty: qty,
    borrow_time: borrowTimeVal,
    purpose: purpose,
    borrow_sign: borrowSignData,
    status: 'borrowed'
  };

  let insertedId = Date.now();

  if (supabase) {
    try {
      const { data, error } = await supabase.from('borrow_records').insert([dbPayload]).select();
      if (!error && data && data.length > 0) {
        insertedId = data[0].id;
      }
    } catch (err) {}
  }

  records.unshift({
    id: insertedId,
    itemId: itemId,
    itemName: itemName,
    role: role,
    studentClass: studentClass,
    studentSeat: studentSeat,
    teacherDept: teacherDept,
    borrowerDisplay: borrowerDisplay,
    qty: qty,
    borrowTime: borrowTimeVal,
    purpose: purpose,
    borrowSign: borrowSignData,
    returnTime: '',
    returnSign: '',
    remark: '',
    status: 'borrowed'
  });

  localStorage.setItem('borrow_records', JSON.stringify(records));
  updateCounts();
  alert(`【借出登記成功】！\n物品：${itemName}`);

  document.getElementById('borrowItemId').value = '';
  document.getElementById('borrowItemName').value = '';
  document.getElementById('borrowItemDisplay').value = '';
  document.getElementById('borrowStudentClass').value = '';
  document.getElementById('borrowStudentSeat').value = '';
  document.getElementById('borrowPurpose').value = '';
  if (padBorrow) padBorrow.clear();
  navigateTo('viewHome');
}

async function submitReturn() {
  if (!pendingReturnRecord) {
    alert('請先掃描要歸還的物品條碼！');
    return;
  }

  if (!padReturn || padReturn.isEmpty()) {
    alert('請歸還人於畫布手寫姓名簽名！');
    return;
  }

  const returnTimeVal = document.getElementById('returnTime').value;
  const returnSignData = padReturn.toDataURL();
  const remarkVal = document.getElementById('returnRemark').value.trim();

  const updatePayload = {
    return_time: returnTimeVal,
    return_sign: returnSignData,
    remark: remarkVal,
    status: 'returned'
  };

  if (supabase) {
    try {
      await supabase.from('borrow_records').update(updatePayload).eq('id', pendingReturnRecord.id);
    } catch (err) {}
  }

  pendingReturnRecord.returnTime = returnTimeVal;
  pendingReturnRecord.returnSign = returnSignData;
  pendingReturnRecord.remark = remarkVal;
  pendingReturnRecord.status = 'returned';

  localStorage.setItem('borrow_records', JSON.stringify(records));
  updateCounts();
  alert(`【物品歸還結案成功】！\n物品：${pendingReturnRecord.itemName}`);

  pendingReturnRecord = null;
  document.getElementById('returnRefPanel').style.display = 'none';
  document.getElementById('returnRemark').value = '';
  if (padReturn) padReturn.clear();
  navigateTo('viewHome');
}

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
  document.getElementById('thReturnSign').style.display = isReturnedTab ? '' : 'none';
  document.getElementById('thRemark').style.display = isReturnedTab ? '' : 'none';

  const filtered = records.filter(r => isReturnedTab ? r.status === 'returned' : r.status === 'borrowed');
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#9ca3af; padding:24px;">目前沒有任何項目</td></tr>`;
    return;
  }

  filtered.forEach(r => {
    const tr = document.createElement('tr');
    const badge = r.status === 'borrowed' 
      ? `<span class="status-badge status-borrowed">借出中</span>` 
      : `<span class="status-badge status-returned">已結案</span>`;

    const roleBadge = r.role === 'teacher'
      ? `<span class="role-badge badge-teacher">教師</span>`
      : `<span class="role-badge badge-student">學生</span>`;
    
    const signBorrowImg = r.borrowSign ? `<img src="${r.borrowSign}" class="sign-thumbnail">` : '-';
    const signReturnImg = r.returnSign ? `<img src="${r.returnSign}" class="sign-thumbnail">` : '-';

    let html = `
      <td>${badge}</td>
      <td style="font-weight:600;">[${r.itemId}] ${r.itemName || r.itemId}</td>
      <td>${roleBadge}${r.borrowerDisplay}</td>
      <td>${r.borrowTime}</td>
      <td>${signBorrowImg}</td>
    `;

    if (isReturnedTab) {
      html += `
        <td>${r.returnTime}</td>
        <td>${signReturnImg}</td>
        <td>${r.remark || '-'}</td>
      `;
    }

    tr.innerHTML = html;
    tbody.appendChild(tr);
  });
}

// 啟動入口
window.addEventListener('DOMContentLoaded', async () => {
  updateCounts();
  await initSupabase();
  await fetchCloudRecords();
});
