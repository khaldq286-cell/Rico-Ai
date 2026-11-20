
"use strict";

// RICO BOT - Frontend Controller

const $ = (id) => document.getElementById(id);

let countdownInterval = null;

// إرسال الطلبات للسيرفر
async function requestJSON(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "حدث خطأ أثناء تنفيذ الطلب");
  }

  return data;
}

function showMessage(message, type = "success") {
  const element = $("message");
  if (!element) return;

  element.textContent = message;
  element.style.color =
    type === "error" ? "#ff7777" : "#8aff75";
}

function setLoading(button, loading, text) {
  if (!button) return;

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = text || "يرجى الانتظار...";
  } else {
    button.disabled = false;
    button.textContent =
      button.dataset.originalText || text || "تنفيذ";
  }
}

function validPhone(phone) {
  return /^\d{7,15}$/.test(phone);
}

// تنصيب البوت
const pairForm = $("pairForm");

if (pairForm) {
  pairForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = $("pairButton");
    const country = $("country").value.replace(/\D/g, "");
    const phone = $("phone").value.replace(/\D/g, "")
      .replace(/^0+/, "");

    $("result").hidden = true;
    showMessage("");

    if (!validPhone(phone)) {
      showMessage("تأكد من كتابة رقم الهاتف بصورة صحيحة", "error");
      return;
    }

    setLoading(button, true, "جارٍ تنصيب البوت...");

    try {
      const data = await requestJSON("/api/pair", {
        method: "POST",
        body: JSON.stringify({
          phone: country + phone
        })
      });

      const code = data.code || data.pairingCode || data.pairCode;

      if (!code) {
        throw new Error("السيرفر لم يرجع رمز الاقتران");
      }

      $("pairCode").textContent = code;
      $("result").hidden = false;

      showMessage(data.message || "تم طلب رمز الاقتران بنجاح");

      startCountdown(60);

    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setLoading(button, false);
    }
  });
}

// عداد واجهة فقط، لا يؤكد صلاحية الرمز من واتساب
function startCountdown(seconds) {
  clearInterval(countdownInterval);

  const timer = $("timer");
  if (!timer) return;

  let remaining = seconds;

  function update() {
    const minutes = Math.floor(remaining / 60);
    const secs = remaining % 60;

    timer.textContent =
      `وقت الانتظار: ${minutes}:${String(secs).padStart(2, "0")}`;

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      timer.textContent = "انتهى وقت الانتظار، اطلب رمزاً جديداً عند الحاجة";
      return;
    }

    remaining--;
  }

  update();
  countdownInterval = setInterval(update, 1000);
}

// نسخ رمز الاقتران
const copyButton = $("copyCode");

if (copyButton) {
  copyButton.addEventListener("click", async () => {
    const code = $("pairCode").textContent.trim();

    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      copyButton.textContent = "تم النسخ";
      setTimeout(() => {
        copyButton.textContent = "نسخ الرمز";
      }, 1800);
    } catch {
      showMessage("تعذر النسخ تلقائياً، انسخ الرمز يدوياً", "error");
    }
  });
}

// تسجيل دخول المطور
const developerLogin = $("developerLogin");

if (developerLogin) {
  developerLogin.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = developerLogin.querySelector("button");
    const password = $("adminPassword").value;

    setLoading(button, true, "جارٍ التحقق...");

    try {
      await requestJSON("/api/developer/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });

      $("adminPassword").value = "";
      developerLogin.hidden = true;
      $("developerDashboard").hidden = false;

      showMessage("تم تسجيل الدخول إلى لوحة المطور");

      await loadStats();

    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setLoading(button, false);
    }
  });
}

// إحصائيات المنصة
async function loadStats() {
  try {
    const data = await requestJSON("/api/developer/stats");

    $("usersCount").textContent =
      data.users ?? data.totalUsers ?? "--";

    $("connectionsCount").textContent =
      data.connections ?? data.totalConnections ?? "--";

    $("failedCount").textContent =
      data.failedConnections ?? "--";

    $("limitCount").textContent =
      data.installLimit ?? "--";

  } catch (error) {
    console.error("Stats error:", error.message);
  }
}

// تحديث حد التنصيب
const limitForm = $("limitForm");

if (limitForm) {
  limitForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = limitForm.querySelector("button");
    const limit = Number($("newLimit").value);

    if (!Number.isInteger(limit) || limit < 0) {
      showMessage("أدخل حداً صحيحاً", "error");
      return;
    }

    setLoading(button, true, "جارٍ التحديث...");

    try {
      const data = await requestJSON("/api/developer/limit", {
        method: "POST",
        body: JSON.stringify({ limit })
      });

      showMessage(data.message || "تم تحديث الحد");
      $("newLimit").value = "";

      await loadStats();

    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setLoading(button, false);
    }
  });
}

// حظر مستخدم
const banForm = $("banForm");

if (banForm) {
  banForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = banForm.querySelector("button");
    const phone = $("banPhone").value.replace(/\D/g, "");

    if (!validPhone(phone)) {
      showMessage("رقم المستخدم غير صحيح", "error");
      return;
    }

    setLoading(button, true, "جارٍ الحظر...");

    try {
      const data = await requestJSON("/api/developer/ban", {
        method: "POST",
        body: JSON.stringify({ phone })
      });

      showMessage(data.message || "تم تنفيذ طلب الحظر");
      $("banPhone").value = "";

    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setLoading(button, false);
    }
  });
}

// إلغاء حظر مستخدم
const unbanForm = $("unbanForm");

if (unbanForm) {
  unbanForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = unbanForm.querySelector("button");
    const phone = $("unbanPhone").value.replace(/\D/g, "");

    if (!validPhone(phone)) {
      showMessage("رقم المستخدم غير صحيح", "error");
      return;
    }

    setLoading(button, true, "جارٍ التنفيذ...");

    try {
      const data = await requestJSON("/api/developer/unban", {
        method: "POST",
        body: JSON.stringify({ phone })
      });

      showMessage(data.message || "تم تنفيذ طلب إلغاء الحظر");
      $("unbanPhone").value = "";

    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setLoading(button, false);
    }
  });
}

// إرسال إعلان
const announcementForm = $("announcementForm");

if (announcementForm) {
  announcementForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = announcementForm.querySelector("button");
    const announcement = $("announcement").value.trim();

    if (!announcement) {
      showMessage("اكتب نص الإعلان أولاً", "error");
      return;
    }

    setLoading(button, true, "جارٍ الإرسال...");

    try {
      const data = await requestJSON("/api/developer/announce", {
        method: "POST",
        body: JSON.stringify({ announcement })
      });

      showMessage(data.message || "تم إرسال طلب حفظ الإعلان");
      $("announcement").value = "";

    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setLoading(button, false);
    }
  });
}

// تسجيل خروج المطور
const logoutButton = $("developerLogout");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    setLoading(logoutButton, true, "جارٍ الخروج...");

    try {
      await requestJSON("/api/developer/logout", {
        method: "POST",
        body: JSON.stringify({})
      });

      $("developerDashboard").hidden = true;
      developerLogin.hidden = false;

      showMessage("تم تسجيل الخروج");

    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setLoading(logoutButton, false);
    }
  });
}

// تفعيل روابط القائمة
document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => {
      item.classList.remove("active");
    });

    link.classList.add("active");
  });
});

console.log("RICO BOT Frontend Loaded");

