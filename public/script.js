
"use strict";

/* ==============================
   RICO BOT - FRONTEND CONTROLLER
============================== */

const $ = (id) => document.getElementById(id);

const pairForm = $("pairForm");
const resultBox = $("result");
const pairCodeElement = $("pairCode");
const messageElement = $("message");
const pairButton = pairForm?.querySelector("button[type='submit']");

let countdownInterval = null;

/* ==============================
   GENERAL HELPERS
============================== */

function showMessage(message, color = "#ffffff") {
  if (!messageElement) return;

  messageElement.textContent = message;
  messageElement.style.color = color;
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("استجابة الخادم غير مفهومة");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "حدث خطأ أثناء تنفيذ الطلب");
  }

  return data;
}

function setButtonLoading(button, loading, text) {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    button.textContent =
      button.dataset.originalText || text;
    delete button.dataset.originalText;
  }
}

function validPhone(phone) {
  return /^\d{8,15}$/.test(phone);
}

/* ==============================
   PAIRING COUNTDOWN
============================== */

function startCountdown(seconds = 120) {
  clearInterval(countdownInterval);

  let remaining = seconds;
  const timerElement = $("timer");

  if (!timerElement) return;

  function updateTimer() {
    const minutes = Math.floor(remaining / 60);
    const secondsLeft = remaining % 60;

    timerElement.textContent =
      `${minutes}:${String(secondsLeft).padStart(2, "0")}`;
  }

  updateTimer();

  countdownInterval = setInterval(() => {
    remaining--;

    updateTimer();

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      timerElement.textContent = "انتهى الوقت";
    }
  }, 1000);
}

/* ==============================
   WHATSAPP PAIRING
============================== */

pairForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!pairButton) return;

  const country = $("country")?.value || "";
  const phoneInput = $("phone")?.value.trim() || "";

  const localNumber = phoneInput.replace(/\D/g, "");

  // إزالة صفر البداية عند إدخال رمز الدولة
  const cleanedNumber = localNumber.replace(/^0+/, "");
  const phone = country.replace(/\D/g, "") + cleanedNumber;

  if (!validPhone(phone)) {
    showMessage(
      "تأكد من إدخال رقم الهاتف ورمز الدولة بصورة صحيحة",
      "#ff7777"
    );
    return;
  }

  setButtonLoading(
    pairButton,
    true,
    "جاري طلب كود الربط..."
  );

  resultBox && (resultBox.style.display = "none");

  clearInterval(countdownInterval);

  showMessage("يرجى الانتظار حتى يرد الخادم...", "#ffd447");

  try {
    const data = await requestJSON("/api/pair", {
      method: "POST",
      body: JSON.stringify({ phone })
    });

    if (!data.code) {
      throw new Error("الخادم لم يرجع كود الربط");
    }

    if (pairCodeElement) {
      pairCodeElement.textContent = data.code;
    }

    if (resultBox) {
      resultBox.style.display = "block";
    }

    showMessage(
      "تم استلام كود الربط من الخادم. أكمل الخطوات داخل واتساب.",
      "#72ffc0"
    );

    startCountdown(120);

  } catch (error) {
    showMessage(
      error.message || "تعذر إنشاء كود الربط",
      "#ff7777"
    );
  } finally {
    setButtonLoading(
      pairButton,
      false,
      "إنشاء كود الربط"
    );
  }
});

/* ==============================
   COPY PAIRING CODE
============================== */

$("copyCode")?.addEventListener("click", async () => {
  const code = pairCodeElement?.textContent.trim();

  if (!code) {
    showMessage("لا يوجد كود لنسخه", "#ff7777");
    return;
  }

  try {
    await navigator.clipboard.writeText(code);

    showMessage("تم نسخ كود الربط", "#72ffc0");

  } catch {
    showMessage(
      "تعذر النسخ. حاول تحديد الكود ونسخه يدوياً.",
      "#ff7777"
    );
  }
});

/* ==============================
   DEVELOPER LOGIN
============================== */

$("developerLogin")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const password = $("adminPassword")?.value || "";

  if (!password.trim()) {
    alert("أدخل رمز دخول المطور");
    return;
  }

  setButtonLoading(button, true, "جاري التحقق...");

  try {
    await requestJSON("/api/developer/login", {
      method: "POST",
      body: JSON.stringify({ password })
    });

    if ($("developerDashboard")) {
      $("developerDashboard").hidden = false;
    }

    form.hidden = true;

    await loadStats();

  } catch (error) {
    alert(error.message || "فشل تسجيل الدخول");
  } finally {
    setButtonLoading(button, false, "تسجيل الدخول");
  }
});

/* ==============================
   DEVELOPER STATISTICS
============================== */

async function loadStats() {
  try {
    const data = await requestJSON("/api/developer/stats");

    if ($("usersCount")) {
      $("usersCount").textContent = data.users ?? 0;
    }

    if ($("connectionsCount")) {
      $("connectionsCount").textContent = data.connections ?? 0;
    }

    if ($("failedCount")) {
      $("failedCount").textContent = data.failed ?? 0;
    }

    if ($("limitCount")) {
      $("limitCount").textContent = data.limit ?? 0;
    }

  } catch (error) {
    console.error("RICO BOT Stats:", error.message);

    if ($("developerDashboard")) {
      $("developerDashboard").hidden = true;
    }

    if ($("developerLogin")) {
      $("developerLogin").hidden = false;
    }
  }
}

/* ==============================
   CHANGE INSTALLATION LIMIT
============================== */

$("limitForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const limit = Number($("newLimit")?.value);

  if (!Number.isSafeInteger(limit) || limit < 1) {
    alert("أدخل حداً صحيحاً أكبر من صفر");
    return;
  }

  setButtonLoading(button, true, "جاري التحديث...");

  try {
    await requestJSON("/api/developer/limit", {
      method: "POST",
      body: JSON.stringify({ limit })
    });

    alert("تم تحديث حد التنصيب");
    await loadStats();

  } catch (error) {
    alert(error.message);
  } finally {
    setButtonLoading(button, false, "تحديث الحد");
  }
});

/* ==============================
   BAN / UNBAN
============================== */

$("banForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const phone = $("banPhone")?.value.trim() || "";

  if (!validPhone(phone.replace(/\D/g, ""))) {
    alert("أدخل رقم هاتف صحيحاً مع رمز الدولة");
    return;
  }

  await adminAction(
    event.currentTarget,
    "/api/developer/ban",
    { phone: phone.replace(/\D/g, "") },
    "تم حظر الرقم"
  );
});

$("unbanForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const phone = $("unbanPhone")?.value.trim() || "";

  if (!validPhone(phone.replace(/\D/g, ""))) {
    alert("أدخل رقم هاتف صحيحاً مع رمز الدولة");
    return;
  }

  await adminAction(
    event.currentTarget,
    "/api/developer/unban",
    { phone: phone.replace(/\D/g, "") },
    "تم فك الحظر"
  );
});

/* ==============================
   ANNOUNCEMENTS
============================== */

$("announcementForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = $("announcement")?.value.trim() || "";

  if (!message) {
    alert("اكتب نص الإعلان أولاً");
    return;
  }

  await adminAction(
    event.currentTarget,
    "/api/developer/announce",
    { message },
    "تم حفظ الإعلان"
  );
});

/* ==============================
   ADMIN ACTION HELPER
============================== */

async function adminAction(form, url, body, successMessage) {
  const button = form.querySelector("button[type='submit']");

  setButtonLoading(button, true, "جاري التنفيذ...");

  try {
    await requestJSON(url, {
      method: "POST",
      body: JSON.stringify(body)
    });

    alert(successMessage);

    await loadStats();

  } catch (error) {
    alert(error.message || "تعذر تنفيذ العملية");
  } finally {
    setButtonLoading(button, false, "تنفيذ");
  }
}

/* ==============================
   DEVELOPER LOGOUT
============================== */

$("developerLogout")?.addEventListener("click", async () => {
  try {
    await requestJSON("/api/developer/logout", {
      method: "POST"
    });
  } catch (error) {
    console.error("Logout error:", error.message);
  }

  location.reload();
});

/* ==============================
   END RICO BOT CONTROLLER
============================== */
