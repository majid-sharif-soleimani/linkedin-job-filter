# LinkedIn Job Filter (AI)

Chrome extension (Manifest V3) that goes through the jobs on a LinkedIn results page, asks an AI model how well each one fits
**your** resume and rules, and acts on the result directly on the page.

## Install
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
2. Pin the icon. The first click opens the options page (or right-click the icon → Options).
3. Choose an AI provider, paste your API key and your resume (plain text), write your hard criteria
   (see the example and guide at the top of `settings.js`), then press **Save & test API**.

## Privacy
Your API keys, resume and settings are stored only in your browser (`chrome.storage.local`). They are sent only to the AI
provider you choose and are never part of this repository. Do not commit exported settings or resume files (see `.gitignore`).

Technical details: `ARCHITECTURE.md` · history: `CHANGELOG.md`.

---

## راهنمای فارسی

## نصب
1. `chrome://extensions` → Developer mode را روشن کنید → **Load unpacked** → پوشه `linkedin-job-filter` را انتخاب کنید.
2. آیکون را در نوار اکستنشن‌ها pin کنید.
3. اولین کلیک صفحه تنظیمات را باز می‌کند (یا راست‌کلیک روی آیکون → Options):
   سرویس AI، مدل، API Key، رزومه (متن) و معیارها را وارد کنید و **Save & test API** را بزنید.

## استفاده
- در صفحه جستجوی کار لینکدین (`linkedin.com/jobs/...`) روی آیکون کلیک کنید.
- اکستنشن کارت‌های صفحه فعلی را یکی‌یکی باز می‌کند، متن آگهی را به AI می‌دهد و اگر نمره زیر حد آستانه بود یا یکی از معیارهای سخت نقض شده بود، ✕ آن را می‌زند.
- پنل پایین-چپ پیشرفت، نمره و دلیل هر کار را نشان می‌دهد. کلیک دوباره روی آیکون یا دکمه Stop متوقف می‌کند.
- نمره هر کار ذخیره می‌شود تا دوباره هزینه API نشود؛ با Save در تنظیمات این حافظه پاک می‌شود.
- گزینه Dry run فقط نمره می‌دهد و چیزی را رد نمی‌کند (برای تست اولیه مفید است).

## نکات
- لینکدین ساختار HTML را مرتب عوض می‌کند. اگر کارت‌ها باز نشدند یا ✕ زده نشد، selectorها در بالای `content.js` هستند (`getCards`, `findDismissButton`, `getDetailPane`).
- نام مدل‌ها قابل تغییر است؛ اگر مدل پیش‌فرض برای کلید شما در دسترس نبود، نام مدل دیگری وارد کنید.
