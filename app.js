// ==============================================================
// 1. Supabase 連線參數設定 (請替換為你的後台真實資料)
// 注意：URL 尾端不可帶 /rest/v1/ 或任何斜線
// ==============================================================
const SUPABASE_URL = "https://qdiwyzkjgxvuinulpvsg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaXd5emtqZ3h2dWludWxwdnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4Mjg4ODQsImV4cCI6MjEwNTQwNDg4NH0.U_IUlKcz-6Qgr_AmEf-EyVTabdfs5oMEQXujBiRDfVg";



let sbClient = null;
let isOnline = false;

// 預設物品對照表 (掃碼或離線時解析品名用)
const ITEM_MAP = {
  "K01": "視聽教室鑰匙",
  "K02": "電腦教室一鑰匙",
  "K03": "電腦教室二鑰匙",
  "K04": "創客中心鑰匙",
  "K05": "會議室鑰匙"
};

// 全域簽名畫布物件與相機掃描實例
let padBorrow = null;
let padReturn = null;
let html5QrBorrow = null;
let html5QrReturn = null;

// ==========================================
// 2. 初始化與連線檢查
// ==========================================
window.addEventListener("DOMContentLoaded", async () => {
  initSignPads();
  initCloudConnection();
  startClock();
  
  // 監聽網路連線切換
  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
  
  // 載入資料庫紀錄
  await loadRecords();
});

// 初始化簽名畫布
function initSignPads() {
  const canvasBorrow = document.getElementById("padBorrow");
  const canvasReturn = document.getElementById("padReturn");

  function resizeCanvas(canvas) {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext("2d").scale(ratio, ratio);
  }

  if (canvasBorrow) {
    resizeCanvas(canvasBorrow);
    padBorrow = new SignaturePad(canvasBorrow, { backgroundColor: 'rgb(255, 255, 255)' });
    window.padBorrow = padBorrow;
  }
  if (canvasReturn) {
    resizeCanvas(canvasReturn);
    padReturn = new SignaturePad(canvasReturn, { backgroundColor: 'rgb(255, 255, 255)' });
    window.padReturn = padReturn;
  }

  window.addEventListener("resize", () => {
    if (canvasBorrow) resizeCanvas(canvasBorrow);
    if (canvasReturn) resizeCanvas(canvasReturn);
  });
}

// 初始化 Supabase
function initCloudConnection() {
  if (window.supabase && SUPABASE_URL.startsWith("http")) {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  updateConnectionStatus();
}

// 更新首頁狀態燈
async function updateConnectionStatus() {
  const dot = document.getElementById("cloudDot");
  const text = document.getElementById("cloudStatusText");
  if (!navigator.onLine || !sbClient) {
    isOnline = false;
    if (dot) dot.className = "dot dot-offline";
    if (text) text.innerText = "離線模式 (本機暫存)";
    return;
  }

  try {
    const { error } = await sbClient.from("borrow_records").select("id").limit(1);
    if (error && error.code !== "PGRST116") throw error;
    isOnline = true;
    if (dot) dot.className = "dot dot-online";
    if (text) text.innerText = "雲端資料庫已連線";
  } catch (err) {
    isOnline = false;
    if (dot) dot.className = "dot dot-offline";
    if (text) text.innerText = "連線異常 (檢查 RLS 或網路)";
  }
}

// 即時時鐘產生器
function startClock() {
  setInterval(() => {
    const now = new Date();
    const timeString = now.toLocaleString("zh-TW", { hour12: false });
    const bTime = document.getElementById("borrowTime");
    const rTime = document.getElementById("returnTime");
    if (bTime) bTime.value = timeString;
    if (rTime) rTime.value = timeString;
  }, 1000);
}

// 頁面跳轉時觸發相機與畫布調整
window.onPageNavigated = function(viewId) {
  if (viewId === "viewBorrow" && padBorrow) {
    padBorrow.clear();
  }
  if (viewId === "viewReturn" && padReturn) {
    padReturn.clear();
  }
  if (viewId === "viewDetails") {
    loadRecords();
  }
};

// ==========================================
// 3. 身分切換 (學生 / 教師)
// ==========================================
window.toggleRoleFields = function() {
  const role = document.querySelector('input[name="borrowRole"]:checked').value;
  const groupStudent = document.getElementById("groupStudent");
  const groupTeacher = document.getElementById("groupTeacher");

  if (role === "student") {
    groupStudent.style.display = "grid";
    groupTeacher.style.display = "none";
  } else {
    groupStudent.style.display = "none";
    groupTeacher.style.display = "block";
  }
};

// ==========================================
// 4. 相機掃描與模擬功能
// ==========================================
window.toggleCamera = function(mode) {
  const elementId = mode === "borrow" ? "readerBorrow" : "readerReturn";
  const btn = mode === "borrow" ? document.getElementById("btnCamBorrow") : document.getElementById("btnCamReturn");

  if (mode === "borrow") {
    if (html5QrBorrow) {
      html5QrBorrow.stop().then(() => {
        html5QrBorrow.clear();
        html5QrBorrow = null;
        btn.innerText = "開啟前相機";
      });
      return;
    }
    html5QrBorrow = new Html5Qrcode(elementId);
    html5QrBorrow.start(
      { facingMode: "user" },
      { fps: 10, qrbox: 180 },
      (decodedText) => {
        handleScanBorrow(decodedText);
        window.toggleCamera("borrow");
      },
      () => {}
    ).then(() => {
      btn.innerText = "關閉相機";
    }).catch(err => alert("相機啟動失敗：" + err));
  } else {
    if (html5QrReturn) {
      html5QrReturn.stop().then(() => {
        html5QrReturn.clear();
        html5QrReturn = null;
        btn.innerText = "開啟前相機";
      });
      return;
    }
    html5QrReturn = new Html5Qrcode(elementId);
    html5QrReturn.start(
      { facingMode: "user" },
      { fps: 10, qrbox: 180 },
      (decodedText) => {
        handleScanReturn(decodedText);
        window.toggleCamera("return");
      },
      () => {}
    ).then(() => {
      btn.innerText = "關閉相機";
    }).catch(err => alert("相機啟動失敗：" + err));
  }
};

// 掃描條碼解析
function handleScanBorrow(code) {
  const cleanCode = code.trim().toUpperCase();
  const itemName = ITEM_MAP[cleanCode] || "自訂/外部物品";
  document.getElementById("borrowItemId").value = cleanCode;
  document.getElementById("borrowItemName").value = itemName;
  document.getElementById("borrowItemDisplay").value = `[${cleanCode}] ${itemName}`;
}

window.mockScanBorrow = function(code) {
  handleScanBorrow(code);
};

let currentReturnRecordId = null;

async function handleScanReturn(code) {
  const cleanCode = code.trim().toUpperCase();
  const records = await getLocalOrCloudRecords();
  
  // 尋找最後一筆借出且未還的紀錄
  const activeRecord = records.find(r => r.item_id === cleanCode && r.status === "borrowed");

  if (!activeRecord) {
    alert(`代碼 [${cleanCode}] 目前無借出中紀錄！`);
    return;
  }

  currentReturnRecordId = activeRecord.id;
  const panel = document.getElementById("returnRefPanel");
  panel.style.display = "block";
  document.getElementById("refItem").innerText = `[${activeRecord.item_id}] ${activeRecord.item_name || ''}`;
  document.getElementById("refTime").innerText = activeRecord.borrow_time || '-';
  
  const roleDesc = activeRecord.borrower_role === "teacher" 
    ? `教師 (${activeRecord.borrower_dept || ''})` 
    : `學生 (${activeRecord.borrower_class || ''} / ${activeRecord.borrower_seat || ''}號)`;
  document.getElementById("refBorrower").innerText = roleDesc;
  document.getElementById("refBorrowerName").innerText = activeRecord.borrower_name || '-';
  document.getElementById("refPurpose").innerText = `${activeRecord.borrow_qty || 1} 個 / ${activeRecord.borrow_purpose || '無'}`;
}

window.mockScanReturn = function(code) {
  handleScanReturn(code);
};

// ==========================================
// 5. 資料提交 (借用登記 & 歸還結案)
// ==========================================
window.submitBorrow = async function() {
  const itemId = document.getElementById("borrowItemId").value;
  const itemName = document.getElementById("borrowItemName").value;
  const role = document.querySelector('input[name="borrowRole"]:checked').value;
  const borrowerName = document.getElementById("borrowerName").value.trim();
  const borrowTime = document.getElementById("borrowTime").value;
  const borrowQty = parseInt(document.getElementById("borrowQty").value, 10) || 1;
  const borrowPurpose = document.getElementById("borrowPurpose").value.trim();

  if (!itemId) {
    alert("請先掃描物品條碼！");
    return;
  }
  if (!borrowerName) {
    alert("請輸入借用人姓名！");
    return;
  }
  if (!padBorrow || padBorrow.isEmpty()) {
    alert("請在借用人簽名框內簽名！");
    return;
  }

  const signData = padBorrow.toDataURL("image/png");

  const newRecord = {
    id: "rec_" + Date.now(),
    item_id: itemId,
    item_name: itemName,
    borrower_role: role,
    borrower_class: role === "student" ? document.getElementById("borrowStudentClass").value.trim() : null,
    borrower_seat: role === "student" ? document.getElementById("borrowStudentSeat").value.trim() : null,
    borrower_dept: role === "teacher" ? document.getElementById("borrowTeacherDept").value : null,
    borrower_name: borrowerName,
    borrow_time: borrowTime,
    borrow_qty: borrowQty,
    borrow_purpose: borrowPurpose,
    borrow_sign: signData,
    status: "borrowed",
    returner_name: null,
    return_time: null,
    return_sign: null,
    return_remark: null
  };

  await saveRecord(newRecord);
  alert("借出登記成功！");
  
  // 清空輸入
  document.getElementById("borrowItemDisplay").value = "";
  document.getElementById("borrowItemId").value = "";
  document.getElementById("borrowerName").value = "";
  document.getElementById("borrowPurpose").value = "";
  padBorrow.clear();
  
  window.navigateTo("viewDetails");
};

window.submitReturn = async function() {
  if (!currentReturnRecordId) {
    alert("請先掃描要歸還的物品條碼！");
    return;
  }
  const returnerName = document.getElementById("returnerName").value.trim();
  const returnTime = document.getElementById("returnTime").value;
  const returnRemark = document.getElementById("returnRemark").value.trim();

  if (!returnerName) {
    alert("請輸入歸還人姓名！");
    return;
  }
  if (!padReturn || padReturn.isEmpty()) {
    alert("請在歸還人簽名框內簽名！");
    return;
  }

  const signData = padReturn.toDataURL("image/png");

  const updateFields = {
    status: "returned",
    returner_name: returnerName,
    return_time: returnTime,
    return_sign: signData,
    return_remark: returnRemark
  };

  await updateRecord(currentReturnRecordId, updateFields);
  alert("物品歸還登記成功！");

  // 清空輸入
  currentReturnRecordId = null;
  document.getElementById("returnRefPanel").style.display = "none";
  document.getElementById("returnerName").value = "";
  document.getElementById("returnRemark").value = "";
  padReturn.clear();

  window.navigateTo("viewDetails");
};

// ==========================================
// 6. 資料儲存與載入 (支援 Supabase 與 LocalStorage)
// ==========================================
async function saveRecord(record) {
  // 先寫入本機備份
  const localList = JSON.parse(localStorage.getItem("offline_records") || "[]");
  localList.unshift(record);
  localStorage.setItem("offline_records", JSON.stringify(localList));

  if (isOnline && sbClient) {
    const { error } = await sbClient.from("borrow_records").insert([record]);
    if (error) {
      console.error("Supabase 寫入失敗:", error);
    }
  }
}

async function updateRecord(id, updateFields) {
  const localList = JSON.parse(localStorage.getItem("offline_records") || "[]");
  const idx = localList.findIndex(r => r.id === id);
  if (idx !== -1) {
    localList[idx] = { ...localList[idx], ...updateFields };
    localStorage.setItem("offline_records", JSON.stringify(localList));
  }

  if (isOnline && sbClient) {
    const { error } = await sbClient.from("borrow_records").update(updateFields).eq("id", id);
    if (error) {
      console.error("Supabase 更新失敗:", error);
    }
  }
}

async function getLocalOrCloudRecords() {
  if (isOnline && sbClient) {
    const { data, error } = await sbClient
      .from("borrow_records")
      .select("*")
      .order("borrow_time", { ascending: false });
    if (!error && data) {
      localStorage.setItem("offline_records", JSON.stringify(data));
      return data;
    }
  }
  return JSON.parse(localStorage.getItem("offline_records") || "[]");
}

// 手動同步本機資料至雲端
window.syncOfflineQueue = async function() {
  if (!sbClient) return alert("資料庫客戶端尚未建立！");
  const localList = JSON.parse(localStorage.getItem("offline_records") || "[]");
  if (localList.length === 0) return alert("本機無待同步資料！");

  const { error } = await sbClient.from("borrow_records").upsert(localList);
  if (error) {
    alert("同步失敗：" + error.message);
  } else {
    alert("離線資料同步完成！");
    await loadRecords();
  }
};

// ==========================================
// 7. 詳細資料清單渲染 (修正欄位錯位問題)
// ==========================================
let currentTab = "unreturned";

window.switchDetailTab = function(tabName) {
  currentTab = tabName;
  document.getElementById("tabUnreturned").className = tabName === "unreturned" ? "tab-btn active" : "tab-btn";
  document.getElementById("tabReturned").className = tabName === "returned" ? "tab-btn active" : "tab-btn";

  const isRet = tabName === "returned";
  document.getElementById("thReturnerName").style.display = isRet ? "" : "none";
  document.getElementById("thReturnTime").style.display = isRet ? "" : "none";
  document.getElementById("thReturnSign").style.display = isRet ? "" : "none";
  document.getElementById("thRemark").style.display = isRet ? "" : "none";

  loadRecords();
};

async function loadRecords() {
  const records = await getLocalOrCloudRecords();

  const unreturnedList = records.filter(r => r.status === "borrowed");
  const returnedList = records.filter(r => r.status === "returned");

  document.getElementById("countUnreturned").innerText = unreturnedList.length;
  document.getElementById("countReturned").innerText = returnedList.length;

  const displayList = currentTab === "unreturned" ? unreturnedList : returnedList;
  const tbody = document.getElementById("recordTableBody");
  tbody.innerHTML = "";

  if (displayList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${currentTab === 'unreturned' ? 6 : 10}" style="text-align:center; padding:30px; color:#9ca3af;">查無借還紀錄</td></tr>`;
    return;
  }

  displayList.forEach(rec => {
    const tr = document.createElement("tr");

    const statusHtml = rec.status === "borrowed"
      ? `<span class="status-badge status-borrowed">借出中</span>`
      : `<span class="status-badge status-returned">已歸還</span>`;

    const roleBadge = rec.borrower_role === "teacher"
      ? `<span class="role-badge badge-teacher">教師</span>`
      : `<span class="role-badge badge-student">學生</span>`;

    const deptOrClass = rec.borrower_role === "teacher"
      ? (rec.borrower_dept || "未填單位")
      : `${rec.borrower_class || ''} (${rec.borrower_seat || ''}號)`;

    let rowHtml = `
      <td>${statusHtml}</td>
      <td><strong>[${rec.item_id}]</strong> ${rec.item_name || ''}</td>
      <td>${roleBadge} ${deptOrClass}</td>
      <td><strong>${rec.borrower_name || '-'}</strong></td>
      <td>${rec.borrow_time || '-'}</td>
      <td>${rec.borrow_sign ? `<img src="${rec.borrow_sign}" class="sign-thumbnail">` : '-'}</td>
    `;

    if (currentTab === "returned") {
      rowHtml += `
        <td><strong>${rec.returner_name || '-'}</strong></td>
        <td>${rec.return_time || '-'}</td>
        <td>${rec.return_sign ? `<img src="${rec.return_sign}" class="sign-thumbnail">` : '-'}</td>
        <td>${rec.return_remark || '-'}</td>
      `;
    }

    tr.innerHTML = rowHtml;
    tbody.appendChild(tr);
  });
}
