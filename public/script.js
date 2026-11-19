
const pairForm = document.getElementById("pairForm");

const resultBox = document.getElementById("result");
const pairCodeElement = document.getElementById("pairCode");
const messageElement = document.getElementById("message");

const pairButton = pairForm?.querySelector("button[type='submit']");

let countdownInterval = null;

function showMessage(message, color = "#ffffff") {
  if (!messageElement) return;

  messageElement.textContent = message;
  messageElement.style.color = color;
}

function startCountdown(seconds = 120) {
  clearInterval(countdownInterval);

  let remaining = seconds;

  const timerElement = document.getElementById("timer");

  if (!timerElement) return;

  timerElement.textContent = remaining;

  countdownInterval = setInterval(() => {
    remaining--;

    timerElement.textContent = remaining;

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      timerElement.textContent = "انتهى الوقت";
    }
  }, 1000);
}

pairForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const country = document.getElementById("country").value;
  const phoneInput = document.getElementById("phone").value.trim();

  const phone = country + phoneInput.replace(/\D/g, "");

  if (phone.length < 8 || phone.length > 15) {
    showMessage("تأكد من كتابة رقم الهاتف بصورة صحيحة", "#ff7777");
    return;
  }

  pairButton.disabled = true;
  pairButton.textContent = "جاري طلب كود الربط...";

  resultBox.style.display = "none";
  showMessage("يرجى الانتظار...", "#ffd447");

  try {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ phone })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.message || "تعذر طلب كود الربط");
    }

    pairCodeElement.textContent = data.code;
    resultBox.style.display = "block";

    showMessage(
      "تم إنشاء كود الربط. أدخله في واتساب لإكمال العملية.",
      "#72ffc0"
    );

    startCountdown(120);

  } catch (error) {
    showMessage(error.message, "#ff7777");
  } finally {
    pairButton.disabled = false;
    pairButton.textContent = "إنشاء كود الربط";
  }
});

document.getElementById("copyCode")?.addEventListener("click", async () => {
  const code = pairCodeElement?.textContent;

  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
    showMessage("تم نسخ كود الربط", "#72ffc0");
  } catch {
    showMessage("تعذر النسخ تلقائياً", "#ff7777");
  }
});

// تسجيل دخول المطور
document.getElementById("developerLogin")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = document.getElementById("adminPassword").value;

  try {
    const response = await fetch("/api/developer/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({ password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "فشل تسجيل الدخول");
    }

    document.getElementById("developerDashboard").hidden = false;
    document.getElementById("developerLogin").hidden = true;

    await loadStats();

  } catch (error) {
    alert(error.message);
  }
});

// تحميل الإحصائيات
async function loadStats() {
  try {
    const response = await fetch("/api/developer/stats", {
      credentials: "same-origin"
    });

    if (!response.ok) throw new Error("تعذر تحميل الإحصائيات");

    const data = await response.json();

    document.getElementById("usersCount").textContent = data.users;
    document.getElementById("connectionsCount").textContent = data.connections;
    document.getElementById("failedCount").textContent = data.failed;
    document.getElementById("limitCount").textContent = data.limit;

  } catch (error) {
    console.error(error);
  }
}

// تغيير حد التنصيب
document.getElementById("limitForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const limit = Number(document.getElementById("newLimit").value);

  try {
    const response = await fetch("/api/developer/limit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({ limit })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.message);

    alert("تم تحديث حد التنصيب");
    loadStats();

  } catch (error) {
    alert(error.message);
  }
});

// حظر رقم
document.getElementById("banForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const phone = document.getElementById("banPhone").value.trim();

  await adminAction("/api/developer/ban", { phone });
});

// فك الحظر
document.getElementById("unbanForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const phone = document.getElementById("unbanPhone").value.trim();

  await adminAction("/api/developer/unban", { phone });
});

// إرسال إعلان للحفظ
document.getElementById("announcementForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = document.getElementById("announcement").value.trim();

  await adminAction("/api/developer/announce", { message });
});

async function adminAction(url, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.message);

    alert("تم تنفيذ العملية");
    loadStats();

  } catch (error) {
    alert(error.message || "حدث خطأ");
  }
}

// تسجيل الخروج
document.getElementById("developerLogout")?.addEventListener("click", async () => {
  await fetch("/api/developer/logout", {
    method: "POST",
    credentials: "same-origin"
  });

  location.reload();
});
