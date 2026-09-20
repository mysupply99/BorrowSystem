// ==============================================================
// 1. Supabase 連線參數設定 (請替換為你的後台真實資料)
// 注意：URL 尾端不可帶 /rest/v1/ 或任何斜線
// ==============================================================
const SUPABASE_URL = "https://qdiwyzkjgxvuinulpvsg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaXd5emtqZ3h2dWludWxwdnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4Mjg4ODQsImV4cCI6MjEwNTQwNDg4NH0.U_IUlKcz-6Qgr_AmEf-EyVTabdfs5oMEQXujBiRDfVg";


let sbClient = null;
let isOnline = false;

// 預設物品對照表
const ITEM_MAP = {
  "K01": "視聽教室鑰匙",
  "K02": "電腦教室鑰匙",
  "K03": "創客中心鑰匙",
  "K04": "會議室鑰匙",
  "K05": "專科教室鑰匙"
};

// 全域簽名物件與掃碼實例
let padBorrow = null;
let padReturn = null;
let html5QrBorrow = null;
let html5QrReturn = null;
let currentReturnRecordId = null;

// ==========================================
// 2. 初始化與啟動
// ==========================================
window.addEventListener("DOMContentLoaded", async () => {
  initCloudConnection();
  initSignPads();
  startClock();

  // 預設喚醒目前顯示的畫布
  setTimeout(() => {
    resizePadCanvas("padBorrow", padBorrow);
  }, 100);

  // 監聽離線/連網事件
  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);

  await loadRecords();
});

// 即時時鐘產生器
function startClock() {
  const update = () => {
    const now = new Date();
    const timeStr = now.toLocaleString("zh-TW", { hour12: false });
    const bTime = document.getElementById("borrowTime");
    const rTime = document.getElementById("returnTime");
    if (bTime) bTime.value = timeStr;
    if (rTime) rTime.value = timeStr;
  };
  update();
  setInterval(update, 1000);
}

// 初始化 Supabase 連線
function initCloudConnection() {
  if (window.supabase && SUPABASE_URL.startsWith("http") && !SUPABASE_URL.includes("你的專案ID")) {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  updateConnectionStatus();
}

// 連線燈號檢查
async function updateConnectionStatus() {
  const dot = document.getElementById("cloudDot");
  const text = document.getElementById("cloudStatusText");

  if (!navigator.onLine || !sbClient) {
    isOnline = false;
    if (dot) dot.className = "dot dot-offline";
    if (text) text.innerText = "本地暫存模式";
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
    if (text) text.innerText = "連線受限 (本地暫存)";
  }
}

// ==========================================
// 3. 電子簽名畫布核心 (徹底解決寬高歸零與筆跡問題)
// ==========================================
function initSignPads() {
  const canvasBorrow = document.getElementById("padBorrow");
  const canvasReturn = document.getElementById("padReturn");

  if (canvasBorrow) {
    padBorrow = new SignaturePad(canvasBorrow, {
      backgroundColor: "rgb(255, 255, 255)",
      penColor: "rgb(0, 0, 0)",
      minWidth: 1.5,
      maxWidth: 3.5
    });
  }

  if (canvasReturn) {
    padReturn = new SignaturePad(canvasReturn, {
      backgroundColor: "rgb(255, 255, 255)",
      penColor: "rgb(0, 0, 0)",
      minWidth: 1.5,
      maxWidth: 3.5
    });
  }

  window.addEventListener("resize", () => {
    resizePadCanvas("padBorrow", padBorrow);
    resizePadCanvas("padReturn", padReturn);
  });
}

function resizePadCanvas(canvasId, padInstance) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !padInstance) return;

  const width = canvas.parentElement.clientWidth;
  const height = canvas.parentElement.clientHeight;

  // 若父容器為 display:none 寬高會是 0，此時不調整
  if (width === 0 || height === 0) return;

  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const data = !padInstance.isEmpty() ? padInstance.toData() : null;

  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";

  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);

  padInstance.clear();
  if (data) {
    padInstance.fromData(data);
  }
}

window.clearSignPad = function(type) {
  if (type === "borrow" && padBorrow) padBorrow.clear();
  if (type === "return" && padReturn) padReturn.clear();
};

// ==========================================
// 4. 視圖導覽切換 (包含畫布即時喚醒)
// ==========================================
window.navigateTo = function(targetViewId) {
  // 切換導覽按鈕樣式
  document.querySelectorAll(".nav-btn-group .btn-nav").forEach(b => b.classList.remove("active"));
  if (targetViewId === "viewBorrow") document.getElementById("btnNavBorrow").classList.add("active");
  if (targetViewId === "viewReturn") document.getElementById("btnNavReturn").classList.add("active");
  if (targetViewId === "viewDetails") document.getElementById("btnNavDetails").classList.add("active");

  // 關閉相機避免佔用資源
  stopAllCameras();

  // 切換視圖主體
  document.querySelectorAll(".view-section").forEach(sec => sec.style.display = "none");
  const activeSec = document.getElementById(targetViewId);
  if (activeSec) activeSec.style.display = "block";

  // 延遲 50ms 確保 display: block 生效後計算真實 DOM 寬度
  setTimeout(() => {
    if (targetViewId === "viewBorrow") {
      resizePadCanvas("padBorrow", padBorrow);
    } else if (targetViewId === "viewReturn") {
      resizePadCanvas("padReturn", padReturn);
    } else if (targetViewId === "viewDetails") {
      loadRecords();
    }
  }, 50);
};

function stopAllCameras() {
  if (html5QrBorrow) {
    html5QrBorrow.stop().then(() => {
      html5QrBorrow.clear();
      html5QrBorrow = null;
      document.getElementById("btnCamBorrow").innerText = "開啟前鏡頭掃碼";
    }).catch(() => {});
  }
  if (html5QrReturn) {
    html5QrReturn.stop().then(() => {
      html5QrReturn.clear();
      html5QrReturn = null;
      document.getElementById("btnCamReturn").innerText = "開啟前鏡頭掃碼";
    }).catch(() => {});
  }
}

// ==========================================
// 5. 掃描與身分切換
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
    groupTeacher.style.display = "flex";
  }
};

window.toggleCamera = function(mode) {
  const elemId = mode === "borrow" ? "readerBorrow" : "readerReturn";
  const btn = mode === "borrow" ? document.getElementById("btnCamBorrow") : document.getElementById("btnCamReturn");

  if (mode === "borrow") {
    if (html5QrBorrow) {
      html5QrBorrow.stop().then(() => {
        html5QrBorrow.clear();
        html5QrBorrow = null;
        btn.innerText = "開啟前鏡頭掃碼";
      });
      return;
    }
    html5QrBorrow = new Html5Qrcode(elemId);
    html5QrBorrow.start(
      { facingMode: "user" },
      { fps: 10, qrbox: 200 },
      (text) => {
        handleScanBorrow(text);
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
        btn.innerText = "開啟前鏡頭掃碼";
      });
      return;
    }
    html5QrReturn = new Html5Qrcode(elemId);
    html5QrReturn.start(
      { facingMode: "user" },
      { fps: 10, qrbox: 200 },
      (text) => {
        handleScanReturn(text);
        window.toggleCamera("return");
      },
      () => {}
    ).then(() => {
      btn.innerText = "關閉相機";
    }).catch(err => alert("相機啟動失敗：" + err));
  }
};

function handleScanBorrow(code) {
  const cleanCode = code.trim().toUpperCase();
  const itemName = ITEM_MAP[cleanCode] || "自訂物品";
  document.getElementById("borrowItemId").value = cleanCode;
  document.getElementById("borrowItemName").value = itemName;
  document.getElementById("borrowItemDisplay").value = `[${cleanCode}] ${itemName}`;
}
window.mockScanBorrow = handleScanBorrow;

async function handleScanReturn(code) {
  const cleanCode = code.trim().toUpperCase();
  const records = await fetchAllRecords();
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
    ? `教師 (${activeRecord.borrower_dept || '未填單位'})`
    : `學生 (${activeRecord.borrower_class || ''}班 ${activeRecord.borrower_seat || ''}號)`;

  document.getElementById("refBorrower").innerText = roleDesc;
  document.getElementById("refBorrowerName").innerText = activeRecord.borrower_name || '-';
  document.getElementById("refPurpose").innerText = `${activeRecord.borrow_qty || 1} 個 / ${activeRecord.borrow_purpose || '一般用途'}`;
}
window.mockScanReturn = handleScanReturn;

// ==========================================
// 6. 送出借出與歸還
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
    alert("請先掃描物品 QR Code！");
    return;
  }
  if (!borrowerName) {
    alert("請輸入借用人姓名！");
    return;
  }
  if (!padBorrow || padBorrow.isEmpty()) {
    alert("請在「借用人簽名」框內簽署！");
    return;
  }

  const signBase64 = padBorrow.toDataURL("image/png");

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
    borrow_sign: signBase64,
    status: "borrowed",
    returner_name: null,
    return_time: null,
    return_sign: null,
    return_remark: null
  };

  await saveSingleRecord(newRecord);
  alert("借出登記成功！");

  // 清空輸入項
  document.getElementById("borrowItemDisplay").value = "";
  document.getElementById("borrowItemId").value = "";
  document.getElementById("borrowItemName").value = "";
  document.getElementById("borrowerName").value = "";
  document.getElementById("borrowPurpose").value = "";
  padBorrow.clear();

  window.navigateTo("viewDetails");
};

window.submitReturn = async function() {
  if (!currentReturnRecordId) {
    alert("請先掃描要歸還的物品 QR Code！");
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
    alert("請在「歸還人簽名」框內簽署！");
    return;
  }

  const signBase64 = padReturn.toDataURL("image/png");

  const updateFields = {
    status: "returned",
    returner_name: returnerName,
    return_time: returnTime,
    return_sign: signBase64,
    return_remark: returnRemark
  };

  await updateSingleRecord(currentReturnRecordId, updateFields);
  alert("歸還結案成功！");

  currentReturnRecordId = null;
  document.getElementById("returnRefPanel").style.display = "none";
  document.getElementById("returnerName").value = "";
  document.getElementById("returnRemark").value = "";
  padReturn.clear();

  window.navigateTo("viewDetails");
};

// ==========================================
// 7. 資料存取層 (LocalStorage + Supabase)
// ==========================================
async function saveSingleRecord(record) {
  // 寫入本地緩存
  const list = JSON.parse(localStorage.getItem("offline_records") || "[]");
  list.unshift(record);
  localStorage.setItem("offline_records", JSON.stringify(list));

  // 連線至 Supabase
  if (isOnline && sbClient) {
    try {
      const { error } = await sbClient.from("borrow_records").insert([record]);
      if (error) console.error("Supabase 寫入異常:", error);
    } catch (e) {
      console.error("雲端存取失敗，保留本地暫存:", e);
    }
  }
}

async function updateSingleRecord(id, fields) {
  const list = JSON.parse(localStorage.getItem("offline_records") || "[]");
  const idx = list.findIndex(r => r.id === id);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...fields };
    localStorage.setItem("offline_records", JSON.stringify(list));
  }

  if (isOnline && sbClient) {
    try {
      const { error } = await sbClient.from("borrow_records").update(fields).eq("id", id);
      if (error) console.error("Supabase 更新異常:", error);
    } catch (e) {
      console.error("雲端更新失敗:", e);
    }
  }
}

async function fetchAllRecords() {
  if (isOnline && sbClient) {
    try {
      const { data, error } = await sbClient
        .from("borrow_records")
        .select("*")
        .order("borrow_time", { ascending: false });

      if (!error && data && data.length > 0) {
        localStorage.setItem("offline_records", JSON.stringify(data));
        return data;
      }
    } catch (e) {
      console.warn("使用本地暫存記錄");
    }
  }
  return JSON.parse(localStorage.getItem("offline_records") || "[]");
}

// ==========================================
// 8. 借還歷程清單渲染 (精確對齊欄位)
// ==========================================
let currentTab = "unreturned";

window.switchDetailTab = function(tabName) {
  currentTab = tabName;
  document.getElementById("tabUnreturned").className = tabName === "unreturned" ? "btn-nav tab-btn active" : "btn-nav tab-btn";
  document.getElementById("tabReturned").className = tabName === "returned" ? "btn-nav tab-btn active" : "btn-nav tab-btn";

  const isRet = tabName === "returned";
  document.getElementById("thReturnerName").style.display = isRet ? "" : "none";
  document.getElementById("thReturnTime").style.display = isRet ? "" : "none";
  document.getElementById("thReturnSign").style.display = isRet ? "" : "none";
  document.getElementById("thRemark").style.display = isRet ? "" : "none";

  loadRecords();
};

async function loadRecords() {
  const records = await fetchAllRecords();

  const unreturnedList = records.filter(r => r.status === "borrowed");
  const returnedList = records.filter(r => r.status === "returned");

  document.getElementById("countUnreturned").innerText = unreturnedList.length;
  document.getElementById("countReturned").innerText = returnedList.length;

  const displayList = currentTab === "unreturned" ? unreturnedList : returnedList;
  const tbody = document.getElementById("recordTableBody");
  tbody.innerHTML = "";

  if (displayList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${currentTab === 'unreturned' ? 6 : 10}" style="text-align:center; padding:30px; color:#9ca3af;">查無相關借還記錄</td></tr>`;
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
      ? (rec.borrower_dept || "教務處")
      : `${rec.borrower_class || ''} (${rec.borrower_seat || ''}號)`;

    // 精確對齊 6 格主要欄位
    let rowHtml = `
      <td>${statusHtml}</td>
      <td><strong>[${rec.item_id}]</strong> ${rec.item_name || ''}</td>
      <td>${roleBadge} ${deptOrClass}</td>
      <td><strong>${rec.borrower_name || '-'}</strong></td>
      <td>${rec.borrow_time || '-'}</td>
      <td>${rec.borrow_sign ? `<img src="${rec.borrow_sign}" class="sign-thumbnail">` : '-'}</td>
    `;

    // 歸還分頁追加 4 格欄位
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
