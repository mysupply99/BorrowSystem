// ==============================================================
// 1. Supabase 連線參數設定 (請替換為你的後台真實資料)
// 注意：URL 尾端不可帶 /rest/v1/ 或任何斜線
// ==============================================================
const SUPABASE_URL = "https://qdiwyzkjgxvuinulpvsg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaXd5emtqZ3h2dWludWxwdnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4Mjg4ODQsImV4cCI6MjEwNTQwNDg4NH0.U_IUlKcz-6Qgr_AmEf-EyVTabdfs5oMEQXujBiRDfVg";


let dbClient = null;
try {
  if (window.supabase && typeof window.supabase.createClient === "function") {
    dbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) {
  console.error("Supabase 初始化異常:", e);
}

// === 2. Web Audio API 蜂鳴聲 (1800Hz) ===
class Beeper {
  constructor() {
    this.ctx = null;
    const savedVol = localStorage.getItem("app_beep_volume");
    this.volume = savedVol !== null ? parseFloat(savedVol) : 0.5;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, parseFloat(val)));
    localStorage.setItem("app_beep_volume", this.volume);
  }

  beep() {
    try {
      this.init();
      if (!this.ctx || this.volume <= 0) return;

      const osc = this.ctx.createOscillator();
      const gainNode = this.ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(1800, this.ctx.currentTime);

      gainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.08);

      osc.connect(gainNode);
      gainNode.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.08);
    } catch (err) {
      console.warn("音效略過:", err);
    }
  }
}

const beeper = new Beeper();

// === 3. 全域狀態管理 ===
let currentRole = "student";
let activeMainTab = "borrow"; // "borrow" | "return" | "records"
let activeRecordsSubTab = "unreturned"; // "unreturned" | "returned"

let borrowPad = null;
let returnPad = null;

let qrBorrow = null;
let qrReturn = null;
let isBorrowCameraOn = false;
let isReturnCameraOn = false;

let selectedBorrowRecord = null; // 歸還操作選定的紀錄物件
let cachedUnreturnedRecords = []; // 快取未還資料供掃碼匹配

// === 4. 高解析度 Canvas 初始化 ===
function initSignatureCanvas(canvas, currentPad) {
  if (!canvas || typeof SignaturePad === "undefined") return currentPad;
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvas.getBoundingClientRect();

  if (rect.width === 0 || rect.height === 0) return currentPad;

  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);

  if (!currentPad) {
    return new SignaturePad(canvas, {
      backgroundColor: "rgba(255, 255, 255, 0)",
      penColor: "rgb(15, 23, 42)"
    });
  } else {
    currentPad.clear();
    return currentPad;
  }
}

// === 5. 掃描模組（借用 與 歸還 獨立鏡頭） ===

// 借用掃描器
async function toggleBorrowScanner() {
  const btn = document.getElementById("btn-toggle-scanner-borrow");
  const qrBox = document.getElementById("qr-reader-borrow");

  if (isBorrowCameraOn) {
    if (qrBorrow) await qrBorrow.stop();
    isBorrowCameraOn = false;
    btn.innerText = "開啟鏡頭";
    btn.classList.remove("camera-active");
    qrBox.innerHTML = `<div class="scanner-placeholder"><span class="placeholder-icon">📷</span><p>點擊上方「開啟鏡頭」掃描 QR Code</p></div>`;
    return;
  }

  try {
    if (!qrBorrow) qrBorrow = new Html5Qrcode("qr-reader-borrow");
    btn.innerText = "啟動中...";
    btn.disabled = true;

    await qrBorrow.start(
      { facingMode: "environment" },
      { fps: 15, qrbox: (w, h) => ({ width: Math.floor(Math.min(w, h) * 0.85), height: Math.floor(Math.min(w, h) * 0.85) }) },
      (decodedText) => {
        beeper.beep();
        const input = document.getElementById("borrow-item-code");
        if (input) {
          input.value = decodedText;
          input.style.borderColor = "#10b981";
          setTimeout(() => input.style.borderColor = "", 1000);
        }
      },
      () => {}
    );

    isBorrowCameraOn = true;
    btn.disabled = false;
    btn.innerText = "關閉鏡頭";
    btn.classList.add("camera-active");
  } catch (err) {
    alert("無法開啟借用鏡頭，請確認相機權限！");
    btn.disabled = false;
    btn.innerText = "開啟鏡頭";
  }
}

// 歸還掃描器 (自動配對未歸還清冊)
async function toggleReturnScanner() {
  const btn = document.getElementById("btn-toggle-scanner-return");
  const qrBox = document.getElementById("qr-reader-return");

  if (isReturnCameraOn) {
    if (qrReturn) await qrReturn.stop();
    isReturnCameraOn = false;
    btn.innerText = "開啟鏡頭";
    btn.classList.remove("camera-active");
    qrBox.innerHTML = `<div class="scanner-placeholder"><span class="placeholder-icon">📷</span><p>掃描歸還物品 QR Code 可自動帶入紀錄</p></div>`;
    return;
  }

  try {
    if (!qrReturn) qrReturn = new Html5Qrcode("qr-reader-return");
    btn.innerText = "啟動中...";
    btn.disabled = true;

    await qrReturn.start(
      { facingMode: "environment" },
      { fps: 15, qrbox: (w, h) => ({ width: Math.floor(Math.min(w, h) * 0.85), height: Math.floor(Math.min(w, h) * 0.85) }) },
      (decodedText) => {
        beeper.beep();
        // 比對目前未還快取中是否有此 item_code
        const match = cachedUnreturnedRecords.find(r => r.item_code === decodedText);
        if (match) {
          selectRecordForReturn(match);
        } else {
          alert(`未找到此代碼 [${decodedText}] 借出中的紀錄！`);
        }
      },
      () => {}
    );

    isReturnCameraOn = true;
    btn.disabled = false;
    btn.innerText = "關閉鏡頭";
    btn.classList.add("camera-active");
  } catch (err) {
    alert("無法開啟歸還鏡頭，請確認相機權限！");
    btn.disabled = false;
    btn.innerText = "開啟鏡頭";
  }
}

// 停止所有相機
async function stopAllCameras() {
  if (isBorrowCameraOn && qrBorrow) {
    try { await qrBorrow.stop(); } catch (e) {}
    isBorrowCameraOn = false;
    const b = document.getElementById("btn-toggle-scanner-borrow");
    if (b) { b.innerText = "開啟鏡頭"; b.classList.remove("camera-active"); }
  }
  if (isReturnCameraOn && qrReturn) {
    try { await qrReturn.stop(); } catch (e) {}
    isReturnCameraOn = false;
    const b = document.getElementById("btn-toggle-scanner-return");
    if (b) { b.innerText = "開啟鏡頭"; b.classList.remove("camera-active"); }
  }
}

// === 6. 身分切換 ===
function switchRole(role) {
  currentRole = role;
  const btnStudent = document.getElementById("role-btn-student");
  const btnStaff = document.getElementById("role-btn-staff");
  const contStudent = document.getElementById("container-student");
  const contStaff = document.getElementById("container-staff");

  if (role === "student") {
    btnStudent?.classList.add("active");
    btnStaff?.classList.remove("active");
    contStudent?.classList.remove("is-hidden");
    contStaff?.classList.add("is-hidden");
  } else {
    btnStaff?.classList.add("active");
    btnStudent?.classList.remove("active");
    contStaff?.classList.remove("is-hidden");
    contStudent?.classList.add("is-hidden");
  }
}

// === 7. 主分頁切換 (借用 / 歸還 / 借還清單) ===
function switchMainTab(tab) {
  activeMainTab = tab;
  stopAllCameras();

  document.getElementById("nav-borrow")?.classList.toggle("active", tab === "borrow");
  document.getElementById("nav-return")?.classList.toggle("active", tab === "return");
  document.getElementById("nav-records")?.classList.toggle("active", tab === "records");

  document.getElementById("page-borrow")?.classList.toggle("is-hidden", tab !== "borrow");
  document.getElementById("page-return")?.classList.toggle("is-hidden", tab !== "return");
  document.getElementById("page-records")?.classList.toggle("is-hidden", tab !== "records");

  if (tab === "borrow") {
    setTimeout(() => {
      const c = document.getElementById("canvas-borrow-sign");
      borrowPad = initSignatureCanvas(c, borrowPad);
    }, 150);
  } else if (tab === "return") {
    setTimeout(() => {
      const c = document.getElementById("canvas-return-sign");
      returnPad = initSignatureCanvas(c, returnPad);
    }, 150);
    fetchReturnPickList();
  } else if (tab === "records") {
    fetchAllRecords();
  }
}

// === 8. 清單次分頁切換 (已借未還 VS 已歸還清冊) ===
function switchRecordsSubTab(subTab) {
  activeRecordsSubTab = subTab;
  document.getElementById("subnav-unreturned")?.classList.toggle("active", subTab === "unreturned");
  document.getElementById("subnav-returned")?.classList.toggle("active", subTab === "returned");

  document.getElementById("subpage-unreturned")?.classList.toggle("is-hidden", subTab !== "unreturned");
  document.getElementById("subpage-returned")?.classList.toggle("is-hidden", subTab !== "returned");
}

// === 9. 模組 1：借用登記送出 ===
async function submitBorrowRecord() {
  if (!dbClient) return alert("未設定 Supabase 連線！");

  const itemCode = document.getElementById("borrow-item-code")?.value.trim() || "";
  const itemName = document.getElementById("borrow-item-name")?.value.trim() || "";
  const quantity = parseInt(document.getElementById("borrow-quantity")?.value, 10) || 1;
  const purpose = document.getElementById("borrow-purpose")?.value.trim() || "";

  let borrowerName = "";
  let departmentOrClass = "";

  if (currentRole === "student") {
    borrowerName = document.getElementById("borrow-name-student")?.value.trim() || "";
    const c = document.getElementById("borrow-class")?.value.trim() || "";
    const s = document.getElementById("borrow-seat")?.value.trim() || "";
    departmentOrClass = `${c}班 ${s}號`.trim();
  } else {
    borrowerName = document.getElementById("borrow-name-staff")?.value.trim() || "";
    departmentOrClass = document.getElementById("borrow-dept")?.value || "";
  }

  if (!itemCode) return alert("請先開啟鏡頭掃描物品 QR Code 代碼！");
  if (!borrowerName) return alert("請填寫借用人姓名！");
  if (!borrowPad || borrowPad.isEmpty()) return alert("借用人必須手寫簽名！");

  const signData = borrowPad.toDataURL("image/png");
  const btn = document.getElementById("btn-submit-borrow");
  btn.disabled = true;
  btn.innerText = "寫入中...";

  const { error } = await dbClient.from("borrow_records").insert([
    {
      item_code: itemCode,
      item_name: itemName,
      quantity: quantity,
      borrower_role: currentRole,
      department_class: departmentOrClass,
      borrower_name: borrowerName,
      purpose: purpose,
      borrow_sign: signData,
      borrow_time: new Date().toISOString(),
      is_returned: false
    }
  ]);

  btn.disabled = false;
  btn.innerText = "確認借出並送出登記";

  if (error) {
    console.error("借用失敗:", error);
    alert("登記失敗，請檢查網路！");
  } else {
    alert("借用手續完成！");
    document.getElementById("borrow-item-code").value = "";
    document.getElementById("borrow-item-name").value = "";
    document.getElementById("borrow-quantity").value = "1";
    document.getElementById("borrow-class").value = "";
    document.getElementById("borrow-seat").value = "";
    document.getElementById("borrow-name-student").value = "";
    document.getElementById("borrow-name-staff").value = "";
    document.getElementById("borrow-purpose").value = "";
    borrowPad.clear();
  }
}

// === 10. 模組 2：歸還登記邏輯 ===

// 讀取待歸還清單供挑選
async function fetchReturnPickList() {
  const tbody = document.getElementById("return-pick-tbody");
  if (!tbody || !dbClient) return;

  const { data, error } = await dbClient
    .from("borrow_records")
    .select("*")
    .eq("is_returned", false)
    .order("borrow_time", { ascending: false });

  if (error || !data) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#ef4444;">載入失敗</td></tr>`;
    return;
  }

  cachedUnreturnedRecords = data;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#94a3b8;">無借出中的物品</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(r => `
    <tr>
      <td><b>${r.item_name || "無品名"}</b> <span style="font-size:0.75rem;color:#94a3b8;">(${r.item_code})</span></td>
      <td>${r.borrower_name}</td>
      <td style="text-align: right;">
        <button onclick='selectRecordForReturn(${JSON.stringify(r)})' class="btn-sm" style="background-color:#2563eb;color:#fff;border:none;">選擇</button>
      </td>
    </tr>
  `).join("");
}

// 點選或掃描選定歸還物品
window.selectRecordForReturn = function(record) {
  selectedBorrowRecord = record;
  const infoBox = document.getElementById("return-active-info");
  const d = new Date(record.borrow_time).toLocaleDateString("zh-TW", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" });

  infoBox.innerHTML = `
    <div>
      <div><b>已選定：</b> ${record.item_name || "無品名"} (${record.item_code}) × ${record.quantity}</div>
      <div style="font-size:0.75rem;color:#475569;margin-top:2px;">借用人: <b>${record.borrower_name}</b> (${record.department_class || "-"}) ｜ 借出時間: ${d}</div>
    </div>
  `;

  document.getElementById("return-borrower-name").value = record.borrower_name;
  document.getElementById("return-notes").value = "";
  if (returnPad) returnPad.clear();
};

// 送出歸還存檔
async function submitReturnConfirm() {
  if (!selectedBorrowRecord) return alert("請先選定欲歸還之物品紀錄！");
  if (!dbClient) return alert("資料庫尚未連接！");

  const returnName = document.getElementById("return-borrower-name")?.value.trim() || "";
  const notes = document.getElementById("return-notes")?.value.trim() || "";

  if (!returnName) return alert("請填寫歸還人姓名！");
  if (!returnPad || returnPad.isEmpty()) return alert("歸還人必須手寫簽名！");

  const signData = returnPad.toDataURL("image/png");
  const btn = document.getElementById("btn-confirm-return");
  btn.disabled = true;
  btn.innerText = "歸還存檔中...";

  const { error } = await dbClient
    .from("borrow_records")
    .update({
      is_returned: true,
      return_time: new Date().toISOString(),
      return_name: returnName,
      return_sign: signData,
      return_notes: notes
    })
    .eq("id", selectedBorrowRecord.id);

  btn.disabled = false;
  btn.innerText = "確認無誤，辦理歸還存檔";

  if (error) {
    alert("歸還失敗，請檢查網路！");
  } else {
    alert("物品已順利完成歸還手續！");
    selectedBorrowRecord = null;
    document.getElementById("return-active-info").innerHTML = `請先由左側「鏡頭掃描條碼」或「點選待還物品」`;
    document.getElementById("return-borrower-name").value = "";
    document.getElementById("return-notes").value = "";
    returnPad.clear();
    fetchReturnPickList();
  }
}

// === 11. 模組 3：借還清冊載入與簽名查閱 ===
async function fetchAllRecords() {
  if (!dbClient) return;

  const unreturnedTbody = document.getElementById("table-unreturned-body");
  const returnedTbody = document.getElementById("table-returned-body");

  unreturnedTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#94a3b8;">載入中...</td></tr>`;
  returnedTbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:16px;color:#94a3b8;">載入中...</td></tr>`;

  const { data, error } = await dbClient
    .from("borrow_records")
    .select("*")
    .order("borrow_time", { ascending: false });

  if (error || !data) {
    unreturnedTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#ef4444;">資料讀取失敗</td></tr>`;
    returnedTbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#ef4444;">資料讀取失敗</td></tr>`;
    return;
  }

  const unreturnedList = data.filter(r => !r.is_returned);
  const returnedList = data.filter(r => r.is_returned);

  // 更新計數
  document.getElementById("count-unreturned").innerText = unreturnedList.length;
  document.getElementById("count-returned").innerText = returnedList.length;

  // 1. 渲染 已借未還
  if (unreturnedList.length === 0) {
    unreturnedTbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#94a3b8;">目前所有借用物品皆已歸還</td></tr>`;
  } else {
    unreturnedTbody.innerHTML = unreturnedList.map(r => {
      const bDate = new Date(r.borrow_time).toLocaleDateString("zh-TW", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" });
      return `
        <tr>
          <td style="font-family:monospace;font-size:0.75rem;color:#64748b;">${bDate}</td>
          <td><b>${r.item_name || "無品名"}</b> <span style="font-size:0.75rem;color:#94a3b8;">(${r.item_code})</span></td>
          <td><b>${r.quantity}</b></td>
          <td>${r.borrower_name}</td>
          <td style="font-size:0.75rem;color:#64748b;">${r.department_class || "-"}</td>
          <td style="font-size:0.8rem;color:#64748b;">${r.purpose || "-"}</td>
          <td style="text-align:right;">
            <button onclick='viewSignModal(${JSON.stringify(r)})' class="btn-sm">查看簽名</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // 2. 渲染 已歸還清冊
  if (returnedList.length === 0) {
    returnedTbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:#94a3b8;">目前尚無已歸還紀錄</td></tr>`;
  } else {
    returnedTbody.innerHTML = returnedList.map(r => {
      const bDate = new Date(r.borrow_time).toLocaleDateString("zh-TW", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" });
      const rDate = r.return_time ? new Date(r.return_time).toLocaleDateString("zh-TW", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }) : "-";
      return `
        <tr>
          <td style="font-family:monospace;font-size:0.75rem;color:#64748b;">${bDate}</td>
          <td style="font-family:monospace;font-size:0.75rem;color:#059669;">${rDate}</td>
          <td><b>${r.item_name || "無品名"}</b> <span style="font-size:0.75rem;color:#94a3b8;">(${r.item_code})</span></td>
          <td><b>${r.quantity}</b></td>
          <td>${r.borrower_name} <span style="font-size:0.75rem;color:#94a3b8;">(${r.department_class || "-"})</span></td>
          <td style="color:#059669;font-weight:600;">${r.return_name || "-"}</td>
          <td style="font-size:0.8rem;color:#64748b;">${r.return_notes || "-"}</td>
          <td style="text-align:right;">
            <button onclick='viewSignModal(${JSON.stringify(r)})' class="btn-sm">借/還簽名</button>
          </td>
        </tr>
      `;
    }).join("");
  }
}

// 彈窗檢視簽名圖片
window.viewSignModal = function(record) {
  const modal = document.getElementById("modal-view-signs");
  const content = document.getElementById("sign-view-content");

  content.innerHTML = `
    <div class="sign-card">
      <h4>借用簽名 (${record.borrower_name})</h4>
      ${record.borrow_sign ? `<img src="${record.borrow_sign}" alt="借用簽名" />` : `<div style="padding:20px;color:#cbd5e1;">無簽名資料</div>`}
    </div>
    <div class="sign-card">
      <h4>歸還簽名 (${record.return_name || "未歸還"})</h4>
      ${record.return_sign ? `<img src="${record.return_sign}" alt="歸還簽名" />` : `<div style="padding:20px;color:#cbd5e1;">尚未歸還</div>`}
    </div>
  `;

  modal.classList.remove("is-hidden");
};

// === 12. 事件監聽初始化 ===
document.addEventListener("DOMContentLoaded", () => {
  // 提示音
  const beepVol = document.getElementById("beep-volume");
  if (beepVol) {
    beepVol.value = beeper.volume;
    beepVol.addEventListener("input", (e) => beeper.setVolume(e.target.value));
  }

  // 主導航切換
  document.getElementById("nav-borrow")?.addEventListener("click", () => switchMainTab("borrow"));
  document.getElementById("nav-return")?.addEventListener("click", () => switchMainTab("return"));
  document.getElementById("nav-records")?.addEventListener("click", () => switchMainTab("records"));

  // 清單次導航切換
  document.getElementById("subnav-unreturned")?.addEventListener("click", () => switchRecordsSubTab("unreturned"));
  document.getElementById("subnav-returned")?.addEventListener("click", () => switchRecordsSubTab("returned"));

  // 身分切換
  document.getElementById("role-btn-student")?.addEventListener("click", () => switchRole("student"));
  document.getElementById("role-btn-staff")?.addEventListener("click", () => switchRole("staff"));

  // 鏡頭開關
  document.getElementById("btn-toggle-scanner-borrow")?.addEventListener("click", toggleBorrowScanner);
  document.getElementById("btn-toggle-scanner-return")?.addEventListener("click", toggleReturnScanner);

  // 簽名板按鈕
  document.getElementById("btn-clear-signature")?.addEventListener("click", () => borrowPad && borrowPad.clear());
  document.getElementById("btn-clear-return-signature")?.addEventListener("click", () => returnPad && returnPad.clear());

  // 表單操作按鈕
  document.getElementById("btn-submit-borrow")?.addEventListener("click", submitBorrowRecord);
  document.getElementById("btn-confirm-return")?.addEventListener("click", submitReturnConfirm);
  document.getElementById("btn-refresh-return-pick")?.addEventListener("click", fetchReturnPickList);
  document.getElementById("btn-refresh-records")?.addEventListener("click", fetchAllRecords);

  // 彈窗關閉
  document.getElementById("btn-close-sign-modal")?.addEventListener("click", () => {
    document.getElementById("modal-view-signs")?.classList.add("is-hidden");
  });

  // 初始借用簽名板
  setTimeout(() => {
    const c = document.getElementById("canvas-borrow-sign");
    borrowPad = initSignatureCanvas(c);
  }, 200);

  // iPad 旋轉適配
  window.addEventListener("resize", () => {
    if (activeMainTab === "borrow") {
      const c = document.getElementById("canvas-borrow-sign");
      borrowPad = initSignatureCanvas(c, borrowPad);
    } else if (activeMainTab === "return") {
      const c = document.getElementById("canvas-return-sign");
      returnPad = initSignatureCanvas(c, returnPad);
    }
  });
});
