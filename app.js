// ==============================================================
// 1. Supabase 連線參數設定 (請替換為你的後台真實資料)
// 注意：URL 尾端不可帶 /rest/v1/ 或任何斜線
// ==============================================================
const SUPABASE_URL = "https://qdiwyzkjgxvuinulpvsg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFkaXd5emtqZ3h2dWludWxwdnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk4Mjg4ODQsImV4cCI6MjEwNTQwNDg4NH0.U_IUlKcz-6Qgr_AmEf-EyVTabdfs5oMEQXujBiRDfVg";



const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  setVolume(val) {
    this.volume = Math.max(0, Math.min(1, parseFloat(val)));
    localStorage.setItem("app_beep_volume", this.volume);
  }

  beep() {
    this.init();
    if (this.volume <= 0) return;

    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1800, this.ctx.currentTime); // 1800Hz 條碼讀取機頻率

    gainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.08);

    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }
}

const beeper = new Beeper();

// === 3. 系統狀態變數 ===
let currentRole = "student"; // "student" | "staff"
let activeTab = "borrow";    // "borrow" | "return"
let borrowPad = null;
let returnPad = null;
let html5QrCode = null;
let selectedReturnRecordId = null;

// === 4. DOM 快取 ===
const el = {
  beepVol: document.getElementById("beep-volume"),
  navBorrow: document.getElementById("nav-borrow"),
  navReturn: document.getElementById("nav-return"),
  pageBorrow: document.getElementById("page-borrow"),
  pageReturn: document.getElementById("page-return"),

  btnStudent: document.getElementById("role-btn-student"),
  btnStaff: document.getElementById("role-btn-staff"),
  contStudent: document.getElementById("container-student"),
  contStaff: document.getElementById("container-staff"),

  canvasBorrow: document.getElementById("canvas-borrow-sign"),
  btnClearBorrowSign: document.getElementById("btn-clear-signature"),
  btnSubmitBorrow: document.getElementById("btn-submit-borrow"),

  itemCode: document.getElementById("borrow-item-code"),
  itemName: document.getElementById("borrow-item-name"),
  itemQty: document.getElementById("borrow-quantity"),
  borrowClass: document.getElementById("borrow-class"),
  borrowSeat: document.getElementById("borrow-seat"),
  borrowNameStudent: document.getElementById("borrow-name-student"),
  borrowDept: document.getElementById("borrow-dept"),
  borrowNameStaff: document.getElementById("borrow-name-staff"),
  borrowPurpose: document.getElementById("borrow-purpose"),

  unreturnedTbody: document.getElementById("unreturned-tbody"),
  btnRefreshList: document.getElementById("btn-refresh-list"),

  modalReturn: document.getElementById("modal-return"),
  modalItemInfo: document.getElementById("modal-item-info"),
  returnPersonName: document.getElementById("return-person-name"),
  returnNotes: document.getElementById("return-notes"),
  canvasReturn: document.getElementById("canvas-return-sign"),
  btnClearReturnSign: document.getElementById("btn-clear-return-signature"),
  btnCancelReturn: document.getElementById("btn-cancel-return"),
  btnCloseModal: document.getElementById("btn-close-modal"),
  btnConfirmReturn: document.getElementById("btn-confirm-return")
};

// === 5. iPad Canvas Retina 解析度校正 ===
function initSignatureCanvas(canvas, currentPad) {
  if (!canvas) return null;
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

// === 6. 條碼掃描模組 (15 FPS / 85% 視窗) ===
function initQrScanner() {
  const qrElement = document.getElementById("qr-reader");
  if (!qrElement) return;

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
      if (el.itemCode) el.itemCode.value = decodedText;
    },
    (err) => {
      // 掃描幀無條碼略過
    }
  ).catch(err => {
    console.warn("鏡頭未啟動或未給予權限:", err);
  });
}

// === 7. 身分切換 (學生 vs 教職員) ===
function switchRole(role) {
  currentRole = role;
  if (role === "student") {
    el.btnStudent.classList.add("active");
    el.btnStaff.classList.remove("active");
    el.contStudent.classList.remove("is-hidden");
    el.contStaff.classList.add("is-hidden");
  } else {
    el.btnStaff.classList.add("active");
    el.btnStudent.classList.remove("active");
    el.contStaff.classList.remove("is-hidden");
    el.contStudent.classList.add("is-hidden");
  }
}

// === 8. 分頁切換 (借用登記 vs 歸還清單) ===
function switchTab(tab) {
  activeTab = tab;
  if (tab === "borrow") {
    el.navBorrow.classList.add("active");
    el.navReturn.classList.remove("active");
    el.pageBorrow.classList.remove("is-hidden");
    el.pageReturn.classList.add("is-hidden");

    setTimeout(() => {
      borrowPad = initSignatureCanvas(el.canvasBorrow, borrowPad);
    }, 150);
  } else {
    el.navReturn.classList.add("active");
    el.navBorrow.classList.remove("active");
    el.pageReturn.classList.remove("is-hidden");
    el.pageBorrow.classList.add("is-hidden");

    fetchUnreturnedList();
  }
}

// === 9. 雲端資料庫操作 (使用 supabaseClient) ===
async function submitBorrowRecord() {
  const itemCode = el.itemCode.value.trim();
  const itemName = el.itemName.value.trim();
  const quantity = parseInt(el.itemQty.value, 10) || 1;
  const purpose = el.borrowPurpose.value.trim();

  let borrowerName = "";
  let departmentOrClass = "";

  if (currentRole === "student") {
    borrowerName = el.borrowNameStudent.value.trim();
    const c = el.borrowClass.value.trim();
    const s = el.borrowSeat.value.trim();
    departmentOrClass = `${c}班 ${s}號`.trim();
  } else {
    borrowerName = el.borrowNameStaff.value.trim();
    departmentOrClass = el.borrowDept.value;
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

  el.btnSubmitBorrow.disabled = true;
  el.btnSubmitBorrow.innerText = "寫入資料庫中...";

  const { error } = await supabaseClient.from("borrow_records").insert([
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

  el.btnSubmitBorrow.disabled = false;
  el.btnSubmitBorrow.innerText = "送出借用登記";

  if (error) {
    console.error("Supabase 寫入錯誤:", error);
    alert("登記失敗，請檢查網路連線或稍後再試！");
  } else {
    alert("借用登記成功！");
    el.itemCode.value = "";
    el.itemName.value = "";
    el.itemQty.value = "1";
    el.borrowClass.value = "";
    el.borrowSeat.value = "";
    el.borrowNameStudent.value = "";
    el.borrowNameStaff.value = "";
    el.borrowPurpose.value = "";
    borrowPad.clear();
  }
}

// 取得未歸還物品清單
async function fetchUnreturnedList() {
  if (!el.unreturnedTbody) return;
  el.unreturnedTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: #94a3b8;">載入中...</td></tr>`;

  const { data, error } = await supabaseClient
    .from("borrow_records")
    .select("*")
    .eq("is_returned", false)
    .order("borrow_time", { ascending: false });

  if (error) {
    console.error("清單讀取失敗:", error);
    el.unreturnedTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: #ef4444;">無法載入資料表</td></tr>`;
    return;
  }

  if (!data || data.length === 0) {
    el.unreturnedTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: #94a3b8;">目前無借出中的物品</td></tr>`;
    return;
  }

  el.unreturnedTbody.innerHTML = data.map(row => {
    const borrowDate = new Date(row.borrow_time).toLocaleDateString("zh-TW", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });

    return `
      <tr>
        <td style="font-family: monospace; font-size: 0.75rem; color: #64748b;">${borrowDate}</td>
        <td><b>${row.item_name || "無品名"}</b> <span style="font-size: 0.75rem; color: #94a3b8;">(${row.item_code})</span></td>
        <td>${row.borrower_name}</td>
        <td style="font-size: 0.75rem; color: #64748b;">${row.department_class || "-"}</td>
        <td><b>${row.quantity}</b></td>
        <td style="text-align: right;">
          <button onclick="openReturnModal('${row.id}', '${row.item_name || row.item_code}', '${row.borrower_name}')" class="btn-sm" style="background-color: #059669; color: white; border: none; cursor: pointer;">
            辦理歸還
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

// 歸還彈窗控制
window.openReturnModal = function(id, itemName, borrowerName) {
  selectedReturnRecordId = id;
  el.modalItemInfo.innerHTML = `<b>品名/條碼:</b> ${itemName} ｜ <b>借用人:</b> ${borrowerName}`;
  el.returnPersonName.value = borrowerName;
  el.returnNotes.value = "";
  el.modalReturn.classList.remove("is-hidden");

  setTimeout(() => {
    returnPad = initSignatureCanvas(el.canvasReturn, returnPad);
  }, 150);
};

function closeReturnModal() {
  el.modalReturn.classList.add("is-hidden");
  selectedReturnRecordId = null;
  if (returnPad) returnPad.clear();
}

// 提交歸還
async function submitReturnRecord() {
  if (!selectedReturnRecordId) return;

  const returnName = el.returnPersonName.value.trim();
  const notes = el.returnNotes.value.trim();

  if (!returnName) {
    alert("請輸入歸還人姓名！");
    return;
  }

  if (!returnPad || returnPad.isEmpty()) {
    alert("歸還人必須手寫簽名！");
    return;
  }

  const signData = returnPad.toDataURL("image/png");
  el.btnConfirmReturn.disabled = true;
  el.btnConfirmReturn.innerText = "存檔中...";

  const { error } = await supabaseClient
    .from("borrow_records")
    .update({
      is_returned: true,
      return_time: new Date().toISOString(),
      return_name: returnName,
      return_sign: signData,
      return_notes: notes
    })
    .eq("id", selectedReturnRecordId);

  el.btnConfirmReturn.disabled = false;
  el.btnConfirmReturn.innerText = "確認歸還存檔";

  if (error) {
    console.error("歸還更新失敗:", error);
    alert("歸還失敗，請檢查網路連線！");
  } else {
    alert("歸還手續完成！");
    closeReturnModal();
    fetchUnreturnedList();
  }
}

// === 10. 事件監聽綁定 ===
window.addEventListener("DOMContentLoaded", () => {
  // 音量初始
  if (el.beepVol) {
    el.beepVol.value = beeper.volume;
    el.beepVol.addEventListener("input", (e) => beeper.setVolume(e.target.value));
  }

  // 身分切換
  if (el.btnStudent) el.btnStudent.addEventListener("click", () => switchRole("student"));
  if (el.btnStaff) el.btnStaff.addEventListener("click", () => switchRole("staff"));

  // 分頁切換
  if (el.navBorrow) el.navBorrow.addEventListener("click", () => switchTab("borrow"));
  if (el.navReturn) el.navReturn.addEventListener("click", () => switchTab("return"));

  // 簽名板清除按鈕
  if (el.btnClearBorrowSign) el.btnClearBorrowSign.addEventListener("click", () => borrowPad && borrowPad.clear());
  if (el.btnClearReturnSign) el.btnClearReturnSign.addEventListener("click", () => returnPad && returnPad.clear());

  // 表單送出與清單更新
  if (el.btnSubmitBorrow) el.btnSubmitBorrow.addEventListener("click", submitBorrowRecord);
  if (el.btnRefreshList) el.btnRefreshList.addEventListener("click", fetchUnreturnedList);
  if (el.btnCancelReturn) el.btnCancelReturn.addEventListener("click", closeReturnModal);
  if (el.btnCloseModal) el.btnCloseModal.addEventListener("click", closeReturnModal);
  if (el.btnConfirmReturn) el.btnConfirmReturn.addEventListener("click", submitReturnRecord);

  // 初始化簽名板與鏡頭掃描
  setTimeout(() => {
    borrowPad = initSignatureCanvas(el.canvasBorrow);
    initQrScanner();
  }, 200);

  // 螢幕旋轉/調整尺寸時適配
  window.addEventListener("resize", () => {
    if (activeTab === "borrow") {
      borrowPad = initSignatureCanvas(el.canvasBorrow, borrowPad);
    }
  });
});
