# GitHub Frontend (Apple Glass + Responsive)

โฟลเดอร์นี้คือหน้าเว็บฝั่ง GitHub สำหรับระบบทะเบียนคุมเอกสาร โดยใช้ Google Apps Script เดิมเป็น Backend/API

## ไฟล์ที่ต้องมีบน GitHub
- `index.html`
- `welcome.html`
- `access-denied.html`
- `not-found.html`
- `document-form.html`
- `document-view.html`
- `document-status.html`
- `loan-index.html`
- `loan-register.html`
- `inspection-report.html`
- `storage-box-view.html`
- `storage-box-scan.html`
- `api-client.js`
- `app-common.js`
- `config.js`
- `theme-legacy.css`
- `theme-legacy.js`

## ตั้งค่าก่อนใช้งาน
1. แก้ `config.js`
- `scriptUrl`: ใส่ URL Web App ที่ลงท้าย `/exec`
- `deviceKey`: เว้นว่างได้ (ระบบจะสร้างให้อัตโนมัติ)
- `lockSettings`: ถ้า `true` จะบังคับค่าจากไฟล์นี้
- `themePreset`: ธีมหน้าเว็บ (ค่าเริ่มต้น `apple-glass`)
- `requestTimeoutMs`: เวลารอ API (ms) แนะนำ `22000`

2. Deploy Google Apps Script เป็น Web App
- Execute as: `Me`
- Who has access: `Anyone`

3. อัปโหลดโฟลเดอร์ `github_frontend` ไป GitHub และเปิด GitHub Pages

## หมายเหตุ
- หน้าเว็บทุกหน้าจะเรียก API ตัวเดิมของ Google Apps Script
- Logic จัดการ Google Sheet ยังคงอยู่ใน `.gs` เดิม
- ถ้าเบราว์เซอร์มีข้อจำกัด CORS ระบบ `api-client.js` จะ fallback เป็น JSONP อัตโนมัติ
- `index.html` รองรับ query เดิมแบบระบบ Apps Script (`?mode=...`, `?id=...`, `?box=...`) และจะ redirect ไปหน้าใหม่ที่ตรงกันอัตโนมัติ
- ธีม UI ปัจจุบันเป็น Apple Glass แบบโปร่งใสทั้งระบบ (รวม popup / filter / loader / ปุ่ม)
- รองรับมือถือด้วย viewport dynamic (`--app-vh`) เพื่อแก้ปัญหาแถบ browser iOS ทับ layout
