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
let activeScanner = null;
let currentScanMode = null;

// ==========================================
// 2. 初始化與頁面載入
// ==========================================
window.addEventListener("DOMContentLoaded", async () => {
  initSignPads();
  initCloudConnection();
  startClock();

  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);

  await loadRecords();
});

// 初始化簽名畫布（自適應 Retina 螢幕比例）
function initSignPads() {
  const canvasBorrow = document.getElementById("padBorrow");
  const canvasReturn = document.getElementById("padReturn");

  function setupCanvas(canvas) {
    if (!canvas) return null;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    return new SignaturePad(canvas, {
      backgroundColor: "rgb(255, 255, 255)",
      penColor: "rgb(0, 0, 0)",
      minWidth: 1.5,
      maxWidth: 3.5
    });
  }

  padBorrow = setupCanvas(canvasBorrow);
  padReturn = setupCanvas(canvasReturn);
  window.padBorrow = padBorrow;
  window.padReturn = padReturn;

  window.addEventListener("resize", () => {
    if (canvasBorrow && padBorrow) {
      const bData = padBorrow.toData();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvasBorrow.width = canvasBorrow.offsetWidth * ratio;
      canvasBorrow.height = canvasBorrow.offsetHeight * ratio;
      canvasBorrow.getContext("2d").scale(ratio, ratio);
      padBorrow.fromData(bData);
    }
    if (canvasReturn && padReturn) {
      const rData = padReturn.toData();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvasReturn.width = canvasReturn.offsetWidth * ratio;
      canvasReturn.height = canvasReturn.offsetHeight * ratio;
      canvasReturn.getContext("2d").scale(ratio, ratio);
      padReturn.fromData(rData);
    }
  });
}

// 初始化 Supabase
function initCloudConnection() {
  if (window.supabase && SUPABASE_URL.startsWith("http")) {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  updateConnectionStatus();
}

// 狀態指示燈
async function updateConnectionStatus() {
  const dot = document.getElementById("dbStatusDot");
  const text = document.getElementById("dbStatusText");
  if (!navigator.onLine || !sbClient) {
    isOnline = false;
    if (dot) dot.className = "status-dot offline";
    if (text) text.innerText = "離線模式 (本機暫存)";
    return;
  }

  try {
    const { error } = await sbClient.from("borrow_records").select("id").limit(1);
    if (error && error.code !== "PGRST116") throw error;
    isOnline = true;
    if (dot) dot.className = "status-dot online";
    if (text) text.innerText = "雲端資料庫已連線";
  } catch (err) {
    isOnline = false;
    if (dot) dot.className = "status-dot offline";
    if (text) text.innerText = "連線異常 (檢查網路或金鑰)";
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

// 視圖切換
window.navigateTo = function(viewId) {
  stopCamera();
  document.querySelectorAll(".view-section").forEach(sec => sec.classList.remove("active"));
  const target = document.getElementById(viewId);
  if (target) target.classList.add("active");

  if (viewId === "viewBorrow" && padBorrow) padBorrow.clear();
  if (viewId === "viewReturn" && padReturn) padReturn.clear();
  if (viewId === "viewDetails") loadRecords();
};

// ==========================================
// 3. 強制指定 iPad 後鏡頭（解決前鏡頭無法自動對焦問題）
// ==========================================
window.toggleCamera = async function(mode) {
  const elementId = mode === "borrow" ? "readerBorrow" : "readerReturn";
  const btn = mode === "borrow" ? document.getElementById("btnCamBorrow") : document.getElementById("btnCamReturn");

  if (activeScanner && activeScanner.isScanning) {
    stopCamera();
    return;
  }

  currentScanMode = mode;
  try {
    if (!activeScanner) {
      activeScanner = new Html5Qrcode(elementId);
    }

    // 取得所有鏡頭清單，精準抓取後鏡頭 ID
    const devices = await Html5Qrcode.getCameras();
    let targetCameraId = null;

    if (devices && devices.length > 0) {
      const backCam = devices.find(d => 
        d.label.toLowerCase().includes("back") || 
        d.label.toLowerCase().includes("rear") ||
        d.label.toLowerCase().includes("environment")
      );
      // iPad 的後置鏡頭若無 label 權限，通常列在最後一個
      targetCameraId = backCam ? backCam.id : devices[devices.length - 1].id;
    }

    const cameraConfig = targetCameraId 
      ? { deviceId: { exact: targetCameraId } }
      : { facingMode: { exact: "environment" } };

    const scanConfig = {
      fps: 15,
      qrbox: { width: 180, height: 180 },
      aspectRatio: 1.0
    };

    await activeScanner.start(
      cameraConfig,
      scanConfig,
      (decodedText) => {
        handleScanResult(decodedText, mode);
        stopCamera();
      },
      (err) => {}
    );

    if (btn) {
      btn.innerText = "關閉相機";
      btn.className = "btn-secondary";
    }
  } catch (err) {
    console.warn("Exact 模式啟動失敗，嘗試降級 environment 請求...", err);
    try {
      await activeScanner.start(
        { facingMode: "environment" },
        { fps: 15, qrbox: { width: 180, height: 180 } },
        (decodedText) => {
          handleScanResult(decodedText, mode);
          stopCamera();
        },
        (e) => {}
      );
      if (btn) {
        btn.innerText = "關閉相機";
        btn.className = "btn-secondary";
      }
    } catch (fallbackErr) {
      alert("無法啟動後鏡頭，請確認 Safari 相機授權！");
    }
  }
};

function stopCamera() {
  if (activeScanner && activeScanner.isScanning) {
    activeScanner.stop().then(() => {
      activeScanner.clear();
      activeScanner = null;
      resetCamButtons();
    }).catch(() => {
      activeScanner = null;
      resetCamButtons();
    });
  } else {
    resetCamButtons();
  }
}

function resetCamButtons() {
  const bBtn = document.getElementById("btnCamBorrow");
  const rBtn = document.getElementById("btnCamReturn");
  if (bBtn) { bBtn.innerText = "開啟後鏡頭掃碼"; bBtn.className = "btn-action"; }
  if (rBtn) { rBtn.innerText = "開啟後鏡頭掃碼"; rBtn.className = "btn-action"; }
}

// 掃描條碼處理
function handleScanResult(decodedText, mode) {
  const cleanCode = decodedText.trim().toUpperCase();
  const itemName = ITEM_MAP[cleanCode] || "自訂/外部物品";

  if (mode === "borrow") {
    document.getElementById("borrowItemId").value = `[${cleanCode}] ${itemName}`;
    document.getElementById("borrowItemId").dataset.id = cleanCode;
    document.getElementById("borrowItemId").dataset.name = itemName;
  } else if (mode === "return") {
    populateReturnData(cleanCode);
  }
}

window.mockScanBorrow = function(code) {
  handleScanResult(code, "borrow");
};

window.mockScanReturn = function(code) {
  handleScanResult(code, "return");
};

let currentReturnRecordId = null;

async function populateReturnData(cleanCode) {
  const records = await getLocalOrCloudRecords();
  const activeRecord = records.find(r => r.item_id === cleanCode && r.status === "borrowed");

  const displayInput = document.getElementById("returnItemDisplay");
  const itemName = ITEM_MAP[cleanCode] || "自訂/外部物品";
  if (displayInput) {
    displayInput.value = `[${cleanCode}] ${itemName}`;
  }

  if (!activeRecord) {
    alert(`代碼 [${cleanCode}] 目前無借出中紀錄！`);
    document.getElementById("returnRefPanel").style.display = "none";
    currentReturnRecordId = null;
    return;
  }

  currentReturnRecordId = activeRecord.id;
  const panel = document.getElementById("returnRefPanel");
  panel.style.display = "block";
  document.getElementById("refItem").innerText = `[${activeRecord.item_id}] ${activeRecord.item_name || ""}`;
  document.getElementById("refTime").innerText = activeRecord.borrow_time || "-";

  const roleDesc = activeRecord.borrower_role === "teacher"
    ? `教職員 (${activeRecord.borrower_dept || ""})`
    : `學生 (${activeRecord.borrower_class || ""} / ${activeRecord.borrower_seat || ""}號)`;
  document.getElementById("refBorrower").innerText = `${roleDesc} ${activeRecord.borrower_name || ""}`;
  document.getElementById("refPurpose").innerText = `${activeRecord.borrow_qty || 1} 個 / ${activeRecord.borrow_purpose || "未填寫"}`;
}

// ==========================================
// 4. 資料登記與提交
// ==========================================
window.submitBorrow = async function() {
  const itemInput = document.getElementById("borrowItemId");
  const itemId = itemInput.dataset.id;
  const itemName = itemInput.dataset.name;
  const role = document.querySelector('input[name="borrowRole"]:checked').value;
  const borrowerName = document.getElementById("borrowName").value.trim();
  const borrowTime = document.getElementById("borrowTime").value;
  const borrowQty = parseInt(document.getElementById("borrowQty").value, 10) || 1;
  const borrowPurpose = document.getElementById("borrowPurpose").value.trim();

  if (!itemId) {
    alert("請先掃描或選擇借出物品！");
    return;
  }
  if (!borrowerName) {
    alert("請輸入借用人姓名！");
    return;
  }
  if (!padBorrow || padBorrow.isEmpty()) {
    alert("請借用人在簽名框內手寫簽名！");
    return;
  }

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
    borrow_sign: padBorrow.toDataURL("image/png"),
    status: "borrowed",
    returner_name: null,
    return_time: null,
    return_sign: null,
    return_remark: null
  };

  await saveRecord(newRecord);
  alert("借出登記成功！");

  // 清空輸入項
  itemInput.value = "";
  delete itemInput.dataset.id;
  delete itemInput.dataset.name;
  document.getElementById("borrowName").value = "";
  document.getElementById("borrowTeacherName").value = "";
  document.getElementById("borrowPurpose").value = "";
  padBorrow.clear();

  window.navigateTo("viewDetails");
};

window.submitReturn = async function() {
  if (!currentReturnRecordId) {
    alert("請先掃描欲歸還的物品條碼！");
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
    alert("請歸還人在簽名框內手寫簽名！");
    return;
  }

  const updateFields = {
    status: "returned",
    returner_name: returnerName,
    return_time: returnTime,
    return_sign: padReturn.toDataURL("image/png"),
    return_remark: returnRemark
  };

  await updateRecord(currentReturnRecordId, updateFields);
  alert("物品歸還登記成功！");

  // 清空歸還表單
  currentReturnRecordId = null;
  document.getElementById("returnItemDisplay").value = "";
  document.getElementById("returnRefPanel").style.display = "none";
  document.getElementById("returnerName").value = "";
  document.getElementById("returnRemark").value = "";
  padReturn.clear();

  window.navigateTo("viewDetails");
};

// ==========================================
// 5. 資料儲存與載入 (LocalStorage / Supabase)
// ==========================================
async function saveRecord(record) {
  const localList = JSON.parse(localStorage.getItem("offline_records") || "[]");
  localList.unshift(record);
  localStorage.setItem("offline_records", JSON.stringify(localList));

  if (isOnline && sbClient) {
    try {
      await sbClient.from("borrow_records").insert([record]);
    } catch (e) {
      console.error("Supabase 寫入失敗，留存於本機", e);
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
    try {
      await sbClient.from("borrow_records").update(updateFields).eq("id", id);
    } catch (e) {
      console.error("Supabase 更新失敗，留存於本機", e);
    }
  }
}

async function getLocalOrCloudRecords() {
  if (isOnline && sbClient) {
    try {
      const { data, error } = await sbClient
        .from("borrow_records")
        .select("*")
        .order("borrow_time", { ascending: false });
      if (!error && data) {
        localStorage.setItem("offline_records", JSON.stringify(data));
        return data;
      }
    } catch (e) {
      console.warn("無法取得遠端資料，改讀取本機快取");
    }
  }
  return JSON.parse(localStorage.getItem("offline_records") || "[]");
}

window.syncLocalRecords = async function() {
  if (!sbClient) return alert("資料庫尚未連線！");
  const localList = JSON.parse(localStorage.getItem("offline_records") || "[]");
  if (localList.length === 0) return alert("目前無本機待同步紀錄！");

  try {
    const { error } = await sbClient.from("borrow_records").upsert(localList);
    if (error) throw error;
    alert("離線資料同步完成！");
    await loadRecords();
  } catch (err) {
    alert("同步失敗：" + err.message);
  }
};

// ==========================================
// 6. 詳細清單渲染
// ==========================================
let currentDetailTab = "unreturned";

window.switchDetailTab = function(tabName) {
  currentDetailTab = tabName;
  document.getElementById("tabUnreturned").className = tabName === "unreturned" ? "tab-btn active" : "tab-btn";
  document.getElementById("tabReturned").className = tabName === "returned" ? "tab-btn active" : "tab-btn";

  const isRet = tabName === "returned";
  document.getElementById("thReturnTime").style.display = isRet ? "" : "none";
  document.getElementById("thReturner").style.display = isRet ? "" : "none";
  document.getElementById("thReturnSign").style.display = isRet ? "" : "none";
  document.getElementById("thRemark").style.display = isRet ? "" : "none";

  loadRecords();
};

async function loadRecords() {
  const records = await getLocalOrCloudRecords();

  const unreturned = records.filter(r => r.status === "borrowed");
  const returned = records.filter(r => r.status === "returned");

  document.getElementById("countUnreturned").innerText = unreturned.length;
  document.getElementById("countReturned").innerText = returned.length;

  const displayList = currentDetailTab === "unreturned" ? unreturned : returned;
  const tbody = document.getElementById("recordTableBody");
  tbody.innerHTML = "";

  if (displayList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${currentDetailTab === 'unreturned' ? 6 : 10}" style="text-align:center; padding:24px; color:#9ca3af;">查無相關借還資料</td></tr>`;
    return;
  }

  displayList.forEach(rec => {
    const tr = document.createElement("tr");

    const statusBadge = rec.status === "borrowed"
      ? `<span class="status-badge status-borrowed">借出中</span>`
      : `<span class="status-badge status-returned">已歸還</span>`;

    const roleBadge = rec.borrower_role === "teacher"
      ? `<span class="role-badge badge-teacher">教職員</span>`
      : `<span class="role-badge badge-student">學生</span>`;

    const deptInfo = rec.borrower_role === "teacher"
      ? (rec.borrower_dept || "未指定")
      : `${rec.borrower_class || ""} (${rec.borrower_seat || ""}號)`;

    let cols = `
      <td>${statusBadge}</td>
      <td><strong>[${rec.item_id}]</strong> ${rec.item_name || ""}</td>
      <td>${roleBadge} ${deptInfo}</td>
      <td><strong>${rec.borrower_name || "-"}</strong></td>
      <td>${rec.borrow_time || "-"}</td>
      <td>${rec.borrow_sign ? `<img src="${rec.borrow_sign}" class="sign-thumbnail">` : "-"}</td>
    `;

    if (currentDetailTab === "returned") {
      cols += `
        <td>${rec.return_time || "-"}</td>
        <td><strong>${rec.returner_name || "-"}</strong></td>
        <td>${rec.return_sign ? `<img src="${rec.return_sign}" class="sign-thumbnail">` : "-"}</td>
        <td>${rec.return_remark || "-"}</td>
      `;
    }

    tr.innerHTML = cols;
    tbody.appendChild(tr);
  });
}
