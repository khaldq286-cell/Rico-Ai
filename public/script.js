"استخدام صارم"؛
const $ = (id) => document.getElementById(id);

// رمز الدولة:الاسم
const MAP = Object.fromEntries("249:🇩 السودان|211:🇪🇬 مصر|20:🇪🇬 مصر|966:🇸🇦 السعودية|971:🇦🇪 الإمارات|964:🇮🇶 العراق|962:🇯🇴 الأردن|965:🇰🇼 الكويت|974:🇶🇦 قطر|973:🇧🇭 البحرين|968:🇴🇲 عُمان|967:🇾🇪 اليمن|961:🇱🇧لبنان|963:🇸🇾 سوريا|970:🇵🇸 فلسطين|212:🇲🇦 المغرب|213:🇩🇿 الجزائر|216:🇹🇳 تونس|218:🇱🇾 ليبيا|222:🇲🇷 موريتانيا|252:🇸🇴 الصومال|253:🇩🇯 جيبوتي|269:🇰🇲 جزر القمر|251:🇪🇹 إثيوبيا|291:🇪🇷 إريتريا|235:🇹🇩 تشاد|90:🇹🇷 تركيا|98:🇮🇷 إيران|44:🇬🇧 بريطانيا|33:🇫🇷 فرنسا|49:🇩🇪|39:🇮🇹 إيطاليا|34:🇪🇸 إسبانيا|1:🇺🇸 أمريكا/كندا|91:🇮🇳 الهند|92:🇵🇰 باكستان|62:🇮🇩 إندونيسيا|234:🇳🇬 نيجيريا|254:🇰🇪 كينيا|27:🇿🇦 جنوب أفريقيا|55:🇧🇷 البرازيل|7:🇷🇺 برازيل")
  .split("|").map((x) => x.split(":")));

const digits = () => $("phone").value.replace(/\D/g, "").replace(/^00/, "");

دالة detect(d) {
  for (let n = 3; n > 0; n--) if (MAP[d.slice(0, n)]) return [d.slice(0, n), MAP[d.slice(0, n)]];
  إرجاع قيمة فارغة؛
}

دالة say(نص، سيء) {
  const m = $("message");
  m.textContent = text;
  m.className = bad ? "bad" : "";
}

$("phone").addEventListener("input", () => {
  const d = digits(), found = detect(d), el = $("country");
  el.className = "country" + (found ? "ok" : "");
  el.textContent = !d ? "سيتم التعرف على الدولة تلقائياً"
    هل تم العثور على شيء ما؟ `${found[1]} (+${found[0]})`
    : د.الطول > 3 ؟ "الدولة غير معروفة، تأكد من رمز الدولة" : "...";
});

$("pairForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = digits(), found = detect(d), btn = $("pairButton");
  $("result").hidden = true;
  say("");

  إذا (!وجد) return say("اكتب الرقم مع رمز الدولة، مثال: 249912345678"، صحيح)؛
  const phone = found[0] + d.slice(found[0].length).replace(/^0+/, "");
  if (!/^\d{8,15}$/.test(phone)) return say("رقم الهاتف غير صحيح", true);

  btn.disabled = true;
  btn.textContent = "جارٍ التنصيب...";
  حاول {
    const r = await fetch("/api/pair", {
      طريقة: "POST"،
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.code) throw new Error(data.message || "حدث خطأ، حاول إعادة");
    $("pairCode").textContent = data.code;
    $("result").hidden = false;
    say("");
  } catch (err) {
    say(err.message, true);
  } أخيرًا {
    btn.disabled = false;
    btn.textContent = "تشير";
  }
});

$("copyCode").addEventListener("click", async (e) => {
  حاول {
    await navigator.clipboard.writeText($("pairCode").textContent.replace(/-/g, ""));
    e.target.textContent = "تم النسخ";
    setTimeout(() => (e.target.textContent = "النسخة الرمزية"), 1800);
  } Catch { say("النسخة الرمزية", true); }
});
