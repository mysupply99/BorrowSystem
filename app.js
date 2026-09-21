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
    console.log("Supabase Client 初始化成功");
  } else {
    console.warn("未偵測到 Supabase SDK");
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
      console.warn("蜂鳴聲播放略過:", err);
    }
  }
}

const beeper = new Beeper();

// === 3. 狀態變數 ===
let currentRole = "student";
let activeTab = "borrow";
let borrowPad = null;
let returnPad = null;
let html5QrCode = null;
let selectedReturnRecordId = null;

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

// === 5. 掃碼相機模組 (延遲安全加載) ===
function initQrScanner() {
  const qrBox = document.getElementById("qr-reader");
  if (!qrBox || typeof Html5Qrcode === "undefined") return;

  try {
    html5QrCode = new Html5Qrcode("qr-reader");
    const config = {
      fps: 15,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.85);
        return { width: edge, height: edge };
      },
      aspectRatio: 1.777778
    };

    html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText) => {
        beeper.beep();
        const codeInput = document.getElementById("borrow-item-code");
        if (codeInput) codeInput.value = decodedText;
      },
      () => {}
    ).catch(err => {
      console.log("鏡頭未啟動或使用者未授權:", err);
      qrBox.innerHTML = `<div style="color:#94a3b8; font-size:12px; display:flex; height:100%; align-items:center; justify-content:center;">相機已就緒 (手動輸入代碼亦可)</div>`;
    });
  } catch (err) {
    console.warn("掃描器啟動例外:", err);
  }
}

// === 6. 身分切換 (學生 vs 教職員) ===
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

// === 7. 分頁切換 (借用登記 vs 歸還清單) ===
function switchTab(tab) {
  activeTab = tab;
  const navBorrow = document.getElementById("nav-borrow");
  const navReturn = document.getElementById("nav-return");
  const pageBorrow = document.getElementById("page-borrow");
  const pageReturn = document.getElementById("page-return");

  if (tab === "borrow") {
    navBorrow?.classList.add("active");
    navReturn?.classList.remove("active");
    pageBorrow?.classList.remove("is-hidden");
    pageReturn?.classList.add("is-hidden");

    setTimeout(() => {
      const c = document.getElementById("canvas-borrow-sign");
      borrowPad = initSignatureCanvas(c, borrowPad);
    }, 150);
  } else {
    navReturn?.classList.add("active");
    navBorrow?.classList.remove("active");
    pageReturn?.classList.remove("is-hidden");
    pageBorrow?.classList.add("is-hidden");

    fetchUnreturnedList();
  }
}

// === 8. 借出登記送出 ===
async function submitBorrowRecord() {
  if (!dbClient) {
    alert("尚未設定 Supabase 連線資訊！");
    return;
  }

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

  if (!itemCode || !borrowerName) {
    alert("請填寫物品條碼代碼與借用人姓名！");
    return;
  }

  if (!borrowPad || borrowPad.isEmpty()) {
    alert("借用人必須手寫簽名！");
    return;
  }

  const signData = borrowPad.toDataURL("image/png");
  const btn = document.getElementById("btn-submit-borrow");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "寫入資料庫中...";
  }

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

  if (btn) {
    btn.disabled = false;
    btn.innerText = "送出借用登記";
  }

  if (error) {
    console.error("Supabase 寫入錯誤:", error);
    alert("登記失敗，請檢查網路連線！");
  } else {
    alert("借用登記成功！");
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

// === 9. 未歸還清單與歸還作業 ===
async function fetchUnreturnedList() {
  const tbody = document.getElementById("unreturned-tbody");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:#94a3b8;">載入中...</td></tr>`;

  if (!dbClient) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:#ef4444;">未配置 Supabase 金鑰</td></tr>`;
    return;
  }

  const { data, error } = await dbClient
    .from("borrow_records")
    .select("*")
    .eq("is_returned", false)
    .order("borrow_time", { ascending: false });

  if (error) {
    console.error("清單讀取失敗:", error);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:#ef4444;">讀取失敗</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:#94a3b8;">目前無借出中的物品</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(row => {
    const d = new Date(row.borrow_time).toLocaleDateString("zh-TW", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    return `
      <tr>
        <td style="font-family: monospace; font-size: 0.75rem; color: #64748b;">${d}</td>
        <td><b>${row.item_name || "無品名"}</b> <span style="font-size: 0.75rem; color: #94a3b8;">(${row.item_code})</span></td>
        <td>${row.borrower_name}</td>
        <td style="font-size: 0.75rem; color: #64748b;">${row.department_class || "-"}</td>
        <td><b>${row.quantity}</b></td>
        <td style="text-align: right;">
          <button onclick="openReturnModal('${row.id}', '${row.item_name || row.item_code}', '${row.borrower_name}')" class="btn-sm" style="background-color: #059669; color: white; border: none;">
            辦理歸還
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

window.openReturnModal = function(id, itemName, borrowerName) {
  selectedReturnRecordId = id;
  const info = document.getElementById("modal-item-info");
  if (info) info.innerHTML = `<b>品名/條碼:</b> ${itemName} ｜ <b>借用人:</b> ${borrowerName}`;
  
  const pName = document.getElementById("return-person-name");
  if (pName) pName.value = borrowerName;
  
  const notes = document.getElementById("return-notes");
  if (notes) notes.value = "";

  document.getElementById("modal-return")?.classList.remove("is-hidden");

  setTimeout(() => {
    const c = document.getElementById("canvas-return-sign");
    returnPad = initSignatureCanvas(c, returnPad);
  }, 150);
};

function closeReturnModal() {
  document.getElementById("modal-return")?.classList.add("is-hidden");
  selectedReturnRecordId = null;
  if (returnPad) returnPad.clear();
}

async function submitReturnRecord() {
  if (!selectedReturnRecordId || !dbClient) return;

  const returnName = document.getElementById("return-person-name")?.value.trim() || "";
  const notes = document.getElementById("return-notes")?.value.trim() || "";

  if (!returnName) {
    alert("請輸入歸還人姓名！");
    return;
  }

  if (!returnPad || returnPad.isEmpty()) {
    alert("歸還人必須手寫簽名！");
    return;
  }

  const signData = returnPad.toDataURL("image/png");
  const btn = document.getElementById("btn-confirm-return");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "存檔中...";
  }

  const { error } = await dbClient
    .from("borrow_records")
    .update({
      is_returned: true,
      return_time: new Date().toISOString(),
      return_name: returnName,
      return_sign: signData,
      return_notes: notes
    })
    .eq("id", selectedReturnRecordId);

  if (btn) {
    btn.disabled = false;
    btn.innerText = "確認歸還存檔";
  }

  if (error) {
    console.error("歸還失敗:", error);
    alert("歸還失敗，請檢查網路連線！");
  } else {
    alert("歸還手續完成！");
    closeReturnModal();
    fetchUnreturnedList();
  }
}

// === 10. 綁定監聽器 (獨立掛載，互不影響) ===
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM 載入完成，正在綁定事件...");

  // 1. 提示音量
  const beepVol = document.getElementById("beep-volume");
  if (beepVol) {
    beepVol.value = beeper.volume;
    beepVol.addEventListener("input", (e) => beeper.setVolume(e.target.value));
  }

  // 2. 身分切換 (學生 / 教職員)
  document.getElementById("role-btn-student")?.addEventListener("click", () => switchRole("student"));
  document.getElementById("role-btn-staff")?.addEventListener("click", () => switchRole("staff"));

  // 3. 分頁切換 (借用 / 歸還)
  document.getElementById("nav-borrow")?.addEventListener("click", () => switchTab("borrow"));
  document.getElementById("nav-return")?.addEventListener("click", () => switchTab("return"));

  // 4. 簽名板按鈕
  document.getElementById("btn-clear-signature")?.addEventListener("click", () => borrowPad && borrowPad.clear());
  document.getElementById("btn-clear-return-signature")?.addEventListener("click", () => returnPad && returnPad.clear());

  // 5. 表單按鈕
  document.getElementById("btn-submit-borrow")?.addEventListener("click", submitBorrowRecord);
  document.getElementById("btn-refresh-list")?.addEventListener("click", fetchUnreturnedList);
  document.getElementById("btn-cancel-return")?.addEventListener("click", closeReturnModal);
  document.getElementById("btn-close-modal")?.addEventListener("click", closeReturnModal);
  document.getElementById("btn-confirm-return")?.addEventListener("click", submitReturnRecord);

  // 6. 延遲掛載簽名板與掃描器
  setTimeout(() => {
    const c = document.getElementById("canvas-borrow-sign");
    borrowPad = initSignatureCanvas(c);
    initQrScanner();
  }, 200);

  // 7. 螢幕旋轉適配
  window.addEventListener("resize", () => {
    if (activeTab === "borrow") {
      const c = document.getElementById("canvas-borrow-sign");
      borrowPad = initSignatureCanvas(c, borrowPad);
    }
  });

  console.log("所有元件事件綁定完成！");
});
