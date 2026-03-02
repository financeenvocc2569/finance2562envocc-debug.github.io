/* global window */
(function (global) {
  'use strict';

  global.DOC_CONTROL_CONFIG = {
    appName: 'ระบบทะเบียนคุมเอกสาร',
    subtitle: 'พร้อมใช้งานกับ Apps Script API',
    themePreset: 'apple-glass',

    // จำเป็น: ใส่ URL Web App ที่ลงท้ายด้วย /exec
    scriptUrl: 'https://script.google.com/macros/s/AKfycbyCUozkiWPN68IFpR34Ivnw9lKmhC35o9jC_uPhBXWVdn6-gyy22KMeaTb3W0cFajoc/exec',

    // ไม่จำเป็น: ถ้าเว้นว่าง ระบบจะสร้างและจำค่าให้เองในเบราว์เซอร์
    deviceKey: '',

    // ถ้า true จะซ่อนปุ่มตั้งค่า API บนหน้าเว็บ และบังคับใช้ค่าจากไฟล์นี้
    lockSettings: true,
    requestTimeoutMs: 22000,

    // ใส่เฉพาะลิงก์ที่ต้องการแสดงบนหน้าเว็บ
    links: {
      webApp: '',
      spreadsheet: '',
      appsScriptProject: '',
      driveFolder: '',
      manual: ''
    }
  };
})(typeof window !== 'undefined' ? window : this);
