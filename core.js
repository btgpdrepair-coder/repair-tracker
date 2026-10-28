/**
 * โมดูลกติกากลาง: ค่าคงที่ สถานะ โรล และ error code ของระบบ
 * เป็นฟังก์ชันล้วน ไม่แตะ Google หรือ LINE
 * ไฟล์เดียวกันนี้ใช้ทั้งใน Apps Script, หน้าจอ LIFF และชุดทดสอบ (Node)
 */
var Core = (function () {
  // โรลของผู้ใช้ (ดู GLOSSARY.md)
  var ROLES = ['STAFF', 'LEAD', 'PLANNER', 'TECH', 'ADMIN'];

  // สถานะของผู้ใช้ในชีต Users
  var USER_STATUS = {
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    DISABLED: 'DISABLED',
  };

  // สถานะที่ "ดูข้อมูลตัวเอง" ตอบกลับ: เพิ่มกรณียังไม่ลงทะเบียนจากสถานะในชีต
  var ME_STATUS = {
    NOT_REGISTERED: 'NOT_REGISTERED',
    PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    DISABLED: 'DISABLED',
  };

  // error code ที่คงที่ ห้ามเปลี่ยนชื่อ เพราะหน้าจอและ backend ใหม่ตอนย้ายเข้าบริษัทต้องใช้ชื่อเดียวกัน
  var ERROR = {
    BAD_REQUEST: 'BAD_REQUEST',
    UNAUTHENTICATED: 'UNAUTHENTICATED',
    UNKNOWN_ACTION: 'UNKNOWN_ACTION',
    NOT_REGISTERED: 'NOT_REGISTERED',
    PENDING_APPROVAL: 'PENDING_APPROVAL',
    REJECTED: 'REJECTED',
    DISABLED: 'DISABLED',
    FORBIDDEN: 'FORBIDDEN',
    VALIDATION: 'VALIDATION',
    NOT_FOUND: 'NOT_FOUND',
    ALREADY_REGISTERED: 'ALREADY_REGISTERED',
    INTERNAL: 'INTERNAL',
  };

  // ข้อความภาษาไทยของแต่ละ error ที่หน้าจอแสดงได้เลย
  var ERROR_MESSAGE = {
    BAD_REQUEST: 'คำขอไม่ถูกต้อง',
    UNAUTHENTICATED: 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ กรุณาเปิดแอปจากแชทใหม่อีกครั้ง',
    UNKNOWN_ACTION: 'ไม่รู้จักคำสั่งนี้',
    NOT_REGISTERED: 'กรุณาลงทะเบียนก่อนใช้งาน',
    PENDING_APPROVAL: 'คำขอใช้งานของคุณรอแอดมินอนุมัติ',
    REJECTED: 'คำขอไม่ผ่าน ติดต่อแอดมิน',
    DISABLED: 'บัญชีของคุณถูกระงับ ติดต่อแอดมิน',
    FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    VALIDATION: 'ข้อมูลไม่ถูกต้อง',
    NOT_FOUND: 'ไม่พบข้อมูล',
    ALREADY_REGISTERED: 'คุณลงทะเบียนไว้แล้ว',
    INTERNAL: 'ระบบขัดข้อง กรุณาลองใหม่',
  };

  // แปลงสถานะผู้ใช้ที่ยังไม่อนุมัติเป็น error code ที่ใช้ปฏิเสธคำขอ
  function errorForUserStatus(status) {
    if (status === USER_STATUS.PENDING) return ERROR.PENDING_APPROVAL;
    if (status === USER_STATUS.REJECTED) return ERROR.REJECTED;
    if (status === USER_STATUS.DISABLED) return ERROR.DISABLED;
    return ERROR.NOT_REGISTERED;
  }

  // ตรวจว่าเป็นโรลที่ระบบรู้จัก
  function isRole(value) {
    return ROLES.indexOf(value) !== -1;
  }

  // โรลที่ขอได้เองตอนลงทะเบียน แอดมินกำหนดได้อย่างเดียว ขอเองไม่ได้
  var REQUESTABLE_ROLES = ['STAFF', 'LEAD', 'PLANNER', 'TECH'];

  var NAME_MAX = 100;
  var DEPARTMENT_MAX = 50;

  // แปลงเวลาเป็นข้อความเวลาไทย เช่น 2026-10-28 08:00:00 (ไทยไม่มีเวลาออมแสง จึงบวก 7 ชั่วโมงได้ตรง ๆ)
  function formatTime(date) {
    var shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 19).replace('T', ' ');
  }

  // ตัดช่องว่างและขีดออกจากเบอร์โทร เช่น 081-234 5678 → 0812345678
  function normalizePhone(value) {
    return String(value == null ? '' : value).replace(/[\s-]/g, '');
  }

  // ตรวจข้อมูลลงทะเบียน คืน { ok, fields } โดย fields บอกข้อความผิดของแต่ละช่อง
  // departments คือรายชื่อแผนกที่เปิดใช้ (จากชีต Departments) ถ้าส่งมา แผนกต้องอยู่ในรายการนี้
  function validateRegistration(input, departments) {
    input = input || {};
    var fields = {};
    var realName = String(input.realName == null ? '' : input.realName).trim();
    var department = String(input.department == null ? '' : input.department).trim();
    var phone = normalizePhone(input.phone);

    if (!realName) fields.realName = 'กรุณากรอกชื่อ-นามสกุลจริง';
    else if (realName.length > NAME_MAX) fields.realName = 'ชื่อยาวเกิน ' + NAME_MAX + ' ตัวอักษร';

    if (!department) fields.department = 'กรุณาเลือกแผนก';
    else if (department.length > DEPARTMENT_MAX) fields.department = 'ชื่อแผนกยาวเกิน ' + DEPARTMENT_MAX + ' ตัวอักษร';
    else if (departments && departments.indexOf(department) === -1) fields.department = 'กรุณาเลือกแผนกจากรายการ';

    if (!phone) fields.phone = 'กรุณากรอกเบอร์มือถือ';
    else if (!/^0\d{9}$/.test(phone)) fields.phone = 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0';

    if (REQUESTABLE_ROLES.indexOf(input.requestedRole) === -1) fields.requestedRole = 'กรุณาเลือกโรลที่ขอ';

    if (input.consent !== true) fields.consent = 'กรุณาติ๊กรับทราบข้อความแจ้งเรื่องข้อมูลก่อนส่ง';

    return {
      ok: Object.keys(fields).length === 0,
      fields: fields,
      value: { realName: realName, department: department, phone: phone, requestedRole: input.requestedRole },
    };
  }

  return {
    ROLES: ROLES,
    REQUESTABLE_ROLES: REQUESTABLE_ROLES,
    USER_STATUS: USER_STATUS,
    ME_STATUS: ME_STATUS,
    ERROR: ERROR,
    ERROR_MESSAGE: ERROR_MESSAGE,
    errorForUserStatus: errorForUserStatus,
    isRole: isRole,
    formatTime: formatTime,
    normalizePhone: normalizePhone,
    validateRegistration: validateRegistration,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Core;
