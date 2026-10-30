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

  // เบอร์สำหรับโทรและแสดงผล: เบอร์ที่พิมพ์ลงชีตเองเป็นตัวเลข ชีตตัดเลข 0 ข้างหน้าทิ้ง (0879649498 → 879649498)
  // เบอร์มือถือไทยมี 10 หลักขึ้นต้นด้วย 0 จึงเติม 0 คืนให้เมื่อเหลือ 9 หลัก
  function phoneForCall(value) {
    var digits = normalizePhone(value).replace(/\D/g, '');
    return /^[1-9]\d{8}$/.test(digits) ? '0' + digits : digits;
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
      value: { realName: realName, department: department, phone: phone, requestedRole: input.requestedRole, canNoti: input.canNoti === true },
    };
  }

  // ใบงาน 28: ผู้ใช้คนนี้เปิด Notification ใน SAP เองได้ไหม (ชีต Users คอลัมน์ CanNoti: ได้ / TRUE)
  function canOpenNoti(user) {
    var v = (user || {}).CanNoti;
    return configFlagValue(v) || String(v == null ? '' : v).trim() === 'ได้';
  }

  // ---------- งาน ----------

  // สถานะงาน 5 สถานะ (SPEC หัวข้อสถานะงาน)
  var JOB_STATUS = {
    PENDING_NOTI: 'PENDING_NOTI',
    IN_REPAIR: 'IN_REPAIR',
    REPAIRED: 'REPAIRED',
    CLOSED: 'CLOSED',
    CANCELLED: 'CANCELLED',
  };

  // ชื่อสถานะภาษาไทยและชื่อสีป้าย (สีอยู่ใน liff/style.css ตาม docs/design/UI.md)
  var JOB_STATUS_LABEL = {
    PENDING_NOTI: ['รอเปิด Noti', 'warn'],
    IN_REPAIR: ['กำลังซ่อม', 'info'],
    REPAIRED: ['ซ่อมเสร็จ', 'ok'],
    CLOSED: ['ปิดงาน', 'ok'],
    CANCELLED: ['ยกเลิก', 'off'],
  };

  // โรลที่แจ้งงานได้ (SPEC ตารางโรลและสิทธิ์)
  var REPORTER_ROLES = ['STAFF', 'LEAD', 'ADMIN'];

  // รหัสของปุ่ม "อื่น ๆ" ทั้งอาการและพื้นที่ ไม่มีในชีต ข้อความที่พิมพ์อยู่ใน SymptomOther / AreaOther
  var OTHER = 'OTHER';

  var TITLE_MAX = 60;
  var ASSET_MAX = 50;
  var OTHER_MAX = 30;
  var LOCATION_MAX = 100;
  var DETAIL_MAX = 500;
  var CLIENT_REQUEST_ID_MAX = 64;

  // รูป: ย่อในเครื่องก่อนส่ง ด้านยาวไม่เกิน 1600 px คุณภาพ JPEG 0.7 (SPEC กติกาหน้าจอ)
  var PHOTO_MAX_COUNT = 3;
  var PHOTO_MAX_SIDE = 1600;
  var PHOTO_QUALITY = 0.7;
  var PHOTO_PREFIX = 'data:image/jpeg;base64,';
  // รูปที่ย่อแล้วประมาณ 300 KB เป็น base64 ราว 400,000 ตัวอักษร เผื่อไว้ 5 เท่า
  var PHOTO_MAX_CHARS = 2000000;

  // ออกเลขงานถัดไปรูปแบบ R-YYMM-NNN ตามเดือนไทยของ date เลขรันเริ่มใหม่ทุกเดือน
  // existingIds คือเลขงานทั้งหมดที่มีแล้ว ต้องเรียกภายใต้ล็อกเท่านั้น กันเลขซ้ำ
  function nextJobId(existingIds, date) {
    var thai = formatTime(date);
    var prefix = 'R-' + thai.slice(2, 4) + thai.slice(5, 7) + '-';
    var max = 0;
    (existingIds || []).forEach(function (id) {
      id = String(id || '');
      if (id.indexOf(prefix) !== 0) return;
      var n = parseInt(id.slice(prefix.length), 10);
      if (n > max) max = n;
    });
    var next = String(max + 1);
    while (next.length < 3) next = '0' + next;
    return prefix + next;
  }

  // ชื่อไฟล์รูปใน Drive: {เลขงาน}_{BEFORE|AFTER}{รอบ}_{ลำดับ}.jpg รอบแรกไม่มีเลขรอบ
  function photoFileName(jobId, kind, round, index) {
    return jobId + '_' + kind + (round > 1 ? round : '') + '_' + index + '.jpg';
  }

  // ผู้แจ้งแก้งานได้ภายใน 24 ชม. นับจากแจ้ง และเฉพาะตอนรอเปิด Noti · แอดมินแก้ได้ทุกงานทุกเวลา
  // คืน { allowed, hoursLeft } โดย hoursLeft มีเฉพาะผู้แจ้ง (ปัดขึ้นเป็นชั่วโมง) ใช้แสดงบนปุ่ม "แก้ไข (เหลือ X ชม.)"
  var EDIT_WINDOW_HOURS = 24;
  function canEditJob(job, user, now) {
    if (user.Role === 'ADMIN') return { allowed: true, hoursLeft: null };
    if (job.ReporterID !== user.UserID || job.Status !== JOB_STATUS.PENDING_NOTI) return { allowed: false, hoursLeft: null };
    var start = parseTime(job.CreatedAt);
    var end = parseTime(now);
    if (start === null || end === null) return { allowed: false, hoursLeft: null };
    var left = EDIT_WINDOW_HOURS * 3600000 - (end - start);
    if (left <= 0) return { allowed: false, hoursLeft: null };
    return { allowed: true, hoursLeft: Math.ceil(left / 3600000) };
  }

  // อายุงานแบบสั้น เช่น "15 นาที" "3 ชม." "2 วัน" จากเวลาข้อความ YYYY-MM-DD HH:mm:ss สองค่า (เวลาไทยทั้งคู่)
  function ageText(from, now) {
    var a = parseTime(from);
    var b = parseTime(now);
    if (a === null || b === null) return '';
    var minutes = Math.floor((b - a) / 60000);
    if (minutes < 1) return 'ไม่ถึง 1 นาที';
    if (minutes < 60) return minutes + ' นาที';
    if (minutes < 24 * 60) return Math.floor(minutes / 60) + ' ชม.';
    return Math.floor(minutes / (24 * 60)) + ' วัน';
  }

  function parseTime(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(value || ''));
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }

  // ชื่อพื้นที่ของงาน: "อื่น ๆ" ใช้ชื่อที่พิมพ์ ที่เหลือแปลงรหัสเป็นชื่อ (รวมพื้นที่ที่ปิดใช้แล้ว)
  // areas คือรายการ { code, name } จากชีต Areas
  function jobAreaName(job, areas) {
    if (job.AreaCode === OTHER) return job.AreaOther || '';
    var area = (areas || []).filter(function (a) { return a.code === job.AreaCode; })[0];
    return area ? area.name : job.AreaCode;
  }

  // ชื่องาน "อะไรเสีย อาการ" เช่น "ปั๊มน้ำ รั่ว" ไม่เกิน 60 ตัวอักษร
  function jobTitle(asset, symptomLabel) {
    return (asset + ' ' + symptomLabel).trim().slice(0, TITLE_MAX);
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  // ตรวจข้อมูลแจ้งงาน คืน { ok, fields, value } fields บอกข้อความผิดของแต่ละช่อง
  // options.areas = [{ code, name }] และ options.symptoms = [{ code, label }] เฉพาะที่เปิดใช้
  // ชื่อช่องใน fields ตรงกับขั้นในหน้าแจ้งงาน: photos (ขั้น 1) · asset, symptom (ขั้น 2) · area, locationDetail (ขั้น 3) · detail (ขั้น 4)
  function validateJob(input, options) {
    input = input || {};
    options = options || {};
    var fields = {};
    var photos = Array.isArray(input.photos) ? input.photos : [];
    var asset = text(input.asset);
    var symptomCode = text(input.symptomCode);
    var symptomOther = text(input.symptomOther);
    var areaCode = text(input.areaCode);
    var areaOther = text(input.areaOther);
    var locationDetail = text(input.locationDetail);
    var detail = text(input.detail);

    if (!photos.length) fields.photos = 'กรุณาถ่ายรูปอาการอย่างน้อย 1 รูป';
    else if (photos.length > PHOTO_MAX_COUNT) fields.photos = 'แนบรูปได้ไม่เกิน ' + PHOTO_MAX_COUNT + ' รูป';
    else if (!photos.every(isPhoto)) fields.photos = 'รูปไม่ถูกต้อง ลองถ่ายใหม่อีกครั้ง';

    if (!asset) fields.asset = 'กรุณาบอกว่าอะไรเสีย';
    else if (asset.length > ASSET_MAX) fields.asset = 'ยาวเกิน ' + ASSET_MAX + ' ตัวอักษร';

    var symptom = (options.symptoms || []).filter(function (s) { return s.code === symptomCode; })[0];
    var symptomLabel = '';
    if (symptomCode === OTHER) {
      if (!symptomOther) fields.symptom = 'กรุณาพิมพ์อาการ';
      else if (symptomOther.length > OTHER_MAX) fields.symptom = 'อาการยาวเกิน ' + OTHER_MAX + ' ตัวอักษร';
      symptomLabel = symptomOther;
    } else if (!symptom) {
      fields.symptom = 'กรุณาเลือกว่าเกิดอะไรขึ้น';
    } else {
      symptomLabel = symptom.label;
      symptomOther = '';
    }

    var area = (options.areas || []).filter(function (a) { return a.code === areaCode; })[0];
    var areaName = '';
    if (areaCode === OTHER) {
      if (!areaOther) fields.area = 'กรุณาพิมพ์ชื่อพื้นที่';
      else if (areaOther.length > OTHER_MAX) fields.area = 'ชื่อพื้นที่ยาวเกิน ' + OTHER_MAX + ' ตัวอักษร';
      areaName = areaOther;
    } else if (!area) {
      fields.area = 'กรุณาเลือกพื้นที่';
    } else {
      areaName = area.name;
      areaOther = '';
    }

    if (!locationDetail) fields.locationDetail = 'กรุณาบอกว่าอยู่ตรงไหน';
    else if (locationDetail.length > LOCATION_MAX) fields.locationDetail = 'ยาวเกิน ' + LOCATION_MAX + ' ตัวอักษร';

    if (detail.length > DETAIL_MAX) fields.detail = 'รายละเอียดยาวเกิน ' + DETAIL_MAX + ' ตัวอักษร';

    return {
      ok: Object.keys(fields).length === 0,
      fields: fields,
      value: {
        photos: photos,
        asset: asset,
        symptomCode: symptomCode,
        symptomOther: symptomOther,
        areaCode: areaCode,
        areaOther: areaOther,
        areaName: areaName,
        locationDetail: locationDetail,
        detail: detail,
        title: jobTitle(asset, symptomLabel),
      },
    };
  }

  // รูปต้องเป็น JPEG แบบ data URL ที่ย่อแล้ว (ไม่ใหญ่เกินกำหนด)
  function isPhoto(value) {
    return typeof value === 'string' &&
      value.indexOf(PHOTO_PREFIX) === 0 &&
      value.length > PHOTO_PREFIX.length &&
      value.length <= PHOTO_MAX_CHARS &&
      /^[A-Za-z0-9+/]+=*$/.test(value.slice(PHOTO_PREFIX.length));
  }

  // ---------- Config ----------

  // ค่าตัวเลขในชีต Config (เก็บเป็นข้อความ) ว่างหรือไม่ใช่ตัวเลขบวกใช้ค่าเริ่มต้น
  function configNumber(config, key, fallback) {
    var raw = String((config || {})[key] == null ? '' : config[key]).trim();
    var n = Number(raw);
    return raw !== '' && isFinite(n) && n > 0 ? n : fallback;
  }

  // สวิตช์ TRUE/FALSE ในชีต Config ว่างหรือพิมพ์ผิดใช้ค่าเริ่มต้น
  function configFlag(config, key, fallback) {
    var raw = String((config || {})[key] == null ? '' : config[key]).trim().toUpperCase();
    if (raw === 'TRUE') return true;
    if (raw === 'FALSE') return false;
    return fallback;
  }

  // ---------- งานค้าง (ใบงาน 15) ----------

  // สถานะที่ยังไม่จบ (นับค้างได้)
  var OPEN_STATUSES = [JOB_STATUS.PENDING_NOTI, JOB_STATUS.IN_REPAIR, JOB_STATUS.REPAIRED];

  // เกณฑ์งานค้างของสถานะ { hours, label } เช่น { 168, '7 วัน' } สถานะที่จบแล้วคืน null
  function slaLimit(status, config) {
    if (status === JOB_STATUS.PENDING_NOTI) {
      var h = configNumber(config, 'SLA_NOTI_HOURS', 24);
      return { hours: h, label: h + ' ชม.' };
    }
    var days = status === JOB_STATUS.IN_REPAIR ? configNumber(config, 'SLA_REPAIR_DAYS', 7)
      : status === JOB_STATUS.REPAIRED ? configNumber(config, 'SLA_CLOSE_DAYS', 3) : null;
    return days === null ? null : { hours: days * 24, label: days + ' วัน' };
  }

  // เวลาที่งานเข้าสถานะปัจจุบันครั้งล่าสุด: แถว StatusLog ล่าสุดที่ ToStatus เป็นสถานะปัจจุบัน และสถานะเปลี่ยนจริง (หรือเป็น CREATE)
  // แถว EDIT (สถานะเดิม = ใหม่) จึงไม่ทำให้เริ่มนับใหม่ · ส่งกลับให้ช่างเริ่มนับใหม่ · ไม่มีประวัติใช้เวลาแจ้ง
  function statusSince(job, logs) {
    var since = '';
    (logs || []).forEach(function (l) {
      if (l.JobID && l.JobID !== job.JobID) return;
      if (l.ToStatus !== job.Status) return;
      if (l.Action !== 'CREATE' && l.FromStatus === l.ToStatus) return;
      if (String(l.At) >= since) since = String(l.At);
    });
    return since || job.CreatedAt;
  }

  // งานค้างไหม: { overdue, since, limit } limit คือข้อความเกณฑ์ เช่น "24 ชม." ใช้บนป้าย "ค้างเกิน 24 ชม."
  function overdueInfo(job, logs, now, config) {
    var since = statusSince(job, logs);
    var limit = slaLimit(job.Status, config);
    if (!limit) return { overdue: false, since: since, limit: '' };
    var a = parseTime(since);
    var b = parseTime(now);
    return { overdue: a !== null && b !== null && b - a > limit.hours * 3600000, since: since, limit: limit.label };
  }

  // ---------- เลข Noti (ใบงาน 10) ----------

  // ตรวจเลข Noti และชื่องาน SAP ตามจำนวนหลักและความยาวใน Config คืน { ok, fields, value }
  // เลข Noti เก็บเป็นข้อความ เลข 0 ข้างหน้าไม่หาย · เว้นวรรคที่พิมพ์มา (เช่น "1004 5678") ตัดออก
  function validateNoti(input, config) {
    input = input || {};
    var digits = configNumber(config, 'NOTI_DIGITS', 8);
    var max = configNumber(config, 'SAP_SHORTTEXT_MAX', 40);
    var notiNo = text(input.notiNo).replace(/\s+/g, '');
    var sap = text(input.sapShortText);
    var fields = {};
    if (!notiNo) fields.notiNo = 'กรุณากรอกเลข Noti';
    else if (!new RegExp('^\\d{' + digits + '}$').test(notiNo)) fields.notiNo = 'เลข Noti ต้องเป็นตัวเลข ' + digits + ' หลัก';
    if (!sap) fields.sapShortText = 'กรุณากรอกชื่องาน SAP';
    else if (sap.length > max) fields.sapShortText = 'ชื่องาน SAP ยาวเกิน ' + max + ' ตัวอักษร';
    return { ok: Object.keys(fields).length === 0, fields: fields, value: { notiNo: notiNo, sapShortText: sap } };
  }

  // งานอื่นที่ยังไม่ยกเลิกซึ่งใช้เลข Noti นี้แล้ว ไม่มีคืน null (เลขของงานที่ยกเลิกแล้วนำมาใช้ใหม่ได้)
  function duplicateNoti(jobs, notiNo, exceptJobId) {
    return (jobs || []).filter(function (j) {
      return j.JobID !== exceptJobId && j.Status !== JOB_STATUS.CANCELLED && text(j.NotiNo) === notiNo;
    })[0] || null;
  }

  // ชื่องาน SAP เริ่มต้น "อะไรเสีย อาการ พื้นที่ ตรงไหน" ไม่เกินความยาวใน Config (ผู้ใช้แก้ได้)
  // ตัดทีละคำ ไม่ตัดกลางคำ (สระและวรรณยุกต์ไทยไม่ขาด) ถ้าคำแรกยาวเกินเองค่อยตัดตามจำนวนตัวอักษร
  function sapShortText(title, areaName, locationDetail, config) {
    var max = configNumber(config, 'SAP_SHORTTEXT_MAX', 40);
    var words = [title, areaName, locationDetail].map(text).join(' ').split(/\s+/).filter(Boolean);
    var out = '';
    for (var i = 0; i < words.length; i++) {
      var next = out ? out + ' ' + words[i] : words[i];
      if (next.length > max) break;
      out = next;
    }
    return out || (words[0] || '').slice(0, max);
  }

  // แสดงเลข Noti ทีละ 4 หลัก เช่น 10045678 → "1004 5678"
  function formatNoti(notiNo) {
    return String(notiNo || '').replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  // ---------- รูปหลังซ่อม ยกเลิก และสิทธิ์ตามสถานะ (ใบงาน 11, 13, 14) ----------

  var NOTE_MAX = 300;

  // ปุ่ม "อื่น ๆ" ของบันทึกการซ่อม (ใบงาน 30) มีเสมอและต้องพิมพ์ต่อ
  var REPAIR_PICK_OTHER = { code: OTHER, label: 'อื่น ๆ', needDetail: true };

  // ตรวจรูปหลังซ่อม/หลังแก้ 1–3 รูป และบันทึก (บังคับ) คืน { ok, fields: { photos, note }, value }
  // picks = ปุ่มลัด [{ label, needDetail }] (ใบงาน 30): บันทึกที่จบด้วยคำของปุ่มที่ต้องพิมพ์ต่อ ถือว่ายังไม่ได้พิมพ์ต่อ
  function validateAfterRepair(input, noteMessage, picks) {
    input = input || {};
    var photos = Array.isArray(input.photos) ? input.photos : [];
    var note = text(input.note);
    var fields = {};
    if (!photos.length) fields.photos = 'กรุณาถ่ายรูปอย่างน้อย 1 รูป';
    else if (photos.length > PHOTO_MAX_COUNT) fields.photos = 'แนบรูปได้ไม่เกิน ' + PHOTO_MAX_COUNT + ' รูป';
    else if (!photos.every(isPhoto)) fields.photos = 'รูปไม่ถูกต้อง ลองถ่ายใหม่อีกครั้ง';
    if (!note) fields.note = noteMessage || 'กรุณาบอกว่าซ่อมอะไรไป';
    else if (note.length > NOTE_MAX) fields.note = 'ยาวเกิน ' + NOTE_MAX + ' ตัวอักษร';
    else {
      var bare = (picks || []).filter(function (p) {
        if (!p.needDetail) return false;
        return note === p.label || note.slice(-p.label.length - 1) === ' ' + p.label;
      })[0];
      if (bare) fields.note = 'พิมพ์ต่อจาก "' + bare.label + '" ว่า' + (bare.code === OTHER ? 'ทำอะไรไป' : 'อะไรบ้าง');
    }
    return { ok: Object.keys(fields).length === 0, fields: fields, value: { photos: photos, note: note } };
  }

  // รูปหลังซ่อมเก็บทุกรอบในคอลัมน์ PhotoAfter: รอบคั่นด้วย ; รูปในรอบคั่นด้วย , → [[id, ...], ...]
  function photoRounds(value) {
    return String(value || '').split(';').map(function (round) {
      return round.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }).filter(function (round) { return round.length; });
  }

  // เหตุผลยกเลิกงาน (SPEC คอลัมน์ CancelReason)
  var CANCEL_REASON = {
    DUPLICATE: 'ซ้ำกับงานอื่น',
    INVALID: 'แจ้งผิด',
    FIXED_NO_NOTI: 'แก้เสร็จหน้างานแล้ว ไม่ต้องเปิด Noti',
    OTHER: 'อื่น ๆ',
  };

  // ผู้ใช้คนนี้ทำอะไรกับงานนี้ได้บ้าง ใช้ทั้งตอนแสดงปุ่มและตอน backend ตรวจสิทธิ์
  // หัวหน้ากะทำได้เฉพาะงานแผนกตัวเอง (ADR 0003) · แอดมินทำได้ทุกงาน
  function jobPermissions(job, user, config) {
    var s = job.Status;
    var admin = user.Role === 'ADMIN';
    var manager = admin || (user.Role === 'LEAD' && job.Department === user.Department);
    var noNoti = configFlag(config, 'ALLOW_CLOSE_WITHOUT_NOTI', true);
    var reasons = [];
    if (manager) {
      reasons = ['DUPLICATE', 'INVALID'];
      if (!noNoti) reasons.push('FIXED_NO_NOTI');
      if (admin) reasons.push('OTHER');
    }
    // ใบงาน 28: ผู้แจ้งที่เปิด Notification ใน SAP เองได้ ใส่เลข Noti ให้งานที่ตัวเองแจ้ง
    var ownNoti = s === JOB_STATUS.PENDING_NOTI && job.ReporterID === user.UserID && canOpenNoti(user);
    return {
      addNoti: (manager && s === JOB_STATUS.PENDING_NOTI) || ownNoti,
      fixOnSite: manager && noNoti && s === JOB_STATUS.PENDING_NOTI,
      cancel: (manager && s === JOB_STATUS.PENDING_NOTI) || (admin && (s === JOB_STATUS.IN_REPAIR || s === JOB_STATUS.REPAIRED)),
      repair: (user.Role === 'TECH' || admin) && s === JOB_STATUS.IN_REPAIR,
      close: manager && s === JOB_STATUS.REPAIRED,
      // บันทึกการตาม (ใบงาน 21): คนโดนตาม ช่าง Planner และแอดมิน เฉพาะงานกำลังซ่อม
      followUp: ['TECH', 'PLANNER', 'ADMIN'].indexOf(user.Role) >= 0 && s === JOB_STATUS.IN_REPAIR,
      cancelReasons: reasons,
    };
  }

  // ---------- บันทึกการตาม (ใบงาน 21) ----------

  // แถว StatusLog ของบันทึกการตาม สถานะเดิม = ใหม่ จึงไม่ทำให้นาฬิกางานค้างเริ่มนับใหม่ (statusSince)
  var FOLLOW_UP = 'FOLLOW_UP';
  // มีคำตอบ = มีบันทึกและยังไม่ถึงวันนัด · รอคำตอบ = งานค้างที่ยังไม่มีบันทึก หรือถึงวันนัดแล้ว (GLOSSARY)
  var FOLLOW_UP_STATE = { ANSWERED: 'ANSWERED', AWAITING: 'AWAITING' };
  var FOLLOW_UP_MAX_DAYS = 30;
  var DELAY_OTHER_LABEL = 'อื่น ๆ';
  var FOLLOW_UP_NOTE = /^([\s\S]*?) · นัดตาม (\d{4}-\d{2}-\d{2})(?: · ([\s\S]*))?$/;

  // วันที่ YYYY-MM-DD บวก n วัน วันที่ผิดรูปแบบคืน ''
  function addDays(date, n) {
    var t = parseTime(String(date) + ' 00:00:00');
    return t === null ? '' : new Date(t + n * 86400000).toISOString().slice(0, 10);
  }

  // วันที่มีจริง (2026-02-30 ไม่ผ่าน)
  function isDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value;
  }

  // ตรวจบันทึกการตาม คืน { ok, fields, value: { reason, reasonLabel, note, nextDate } }
  // reasons = [{ code, label, active }] จากชีต DelayReasons · "อื่น ๆ" (OTHER) ใช้ได้เสมอแต่ต้องพิมพ์
  // today = วันที่ไทย YYYY-MM-DD · วันนัดต้องหลังวันนี้และไม่เกิน 30 วัน (รอนานกว่านั้นให้บันทึกซ้ำเมื่อถึงวันนัด)
  function validateFollowUp(input, reasons, today) {
    input = input || {};
    var code = text(input.reason);
    var note = text(input.note);
    var nextDate = text(input.nextDate);
    var reason = code === OTHER ? { label: DELAY_OTHER_LABEL }
      : (reasons || []).filter(function (r) { return r.active && r.code === code; })[0];
    var fields = {};
    if (!reason) fields.reason = 'กรุณาเลือกเหตุผลที่ช้า';
    if (code === OTHER && !note) fields.note = 'กรุณาบอกว่ารออะไร';
    else if (note.length > NOTE_MAX) fields.note = 'ยาวเกิน ' + NOTE_MAX + ' ตัวอักษร';
    if (!isDate(nextDate)) fields.nextDate = 'กรุณาเลือกวันนัดตาม';
    else if (nextDate <= today) fields.nextDate = 'วันนัดต้องเป็นพรุ่งนี้หรือหลังจากนั้น';
    else if (nextDate > addDays(today, FOLLOW_UP_MAX_DAYS)) {
      fields.nextDate = 'นัดได้ไกลสุด ' + FOLLOW_UP_MAX_DAYS + ' วัน ถ้ารอนานกว่านั้นให้บันทึกใหม่เมื่อถึงวันนัด';
    }
    return {
      ok: Object.keys(fields).length === 0,
      fields: fields,
      value: { reason: code, reasonLabel: reason ? reason.label : '', note: note, nextDate: nextDate },
    };
  }

  // ข้อความในช่อง Note ของ StatusLog เช่น "รออะไหล่ · นัดตาม 2026-11-08 · สั่งซีลแล้ว" (คนอ่านในชีตเข้าใจ และแยกกลับได้)
  function followUpNote(value) {
    return value.reasonLabel + ' · นัดตาม ' + value.nextDate + (value.note ? ' · ' + value.note : '');
  }

  // บันทึกการตามล่าสุดของรอบกำลังซ่อมปัจจุบัน (หลังถูกส่งกลับเริ่มรอบใหม่) และสภาพการตาม
  // คืน { state: ANSWERED | AWAITING | '', last: { reason, nextDate, note, at, byUserId } | null } · สถานะอื่นไม่มีสภาพการตาม
  function followUpInfo(job, logs, now, config) {
    if (job.Status !== JOB_STATUS.IN_REPAIR) return { state: '', last: null };
    var since = statusSince(job, logs);
    var last = null;
    (logs || []).forEach(function (l) {
      if (l.JobID && l.JobID !== job.JobID) return;
      if (l.Action !== FOLLOW_UP || String(l.At) < since) return;
      if (last && String(l.At) < last.at) return;
      var m = FOLLOW_UP_NOTE.exec(String(l.Note || ''));
      if (m) last = { reason: m[1], nextDate: m[2], note: m[3] || '', at: String(l.At), byUserId: l.ByUserID || '' };
    });
    if (last && last.nextDate > String(now).slice(0, 10)) return { state: FOLLOW_UP_STATE.ANSWERED, last: last };
    var late = overdueInfo(job, logs, now, config).overdue;
    return { state: late ? FOLLOW_UP_STATE.AWAITING : '', last: last };
  }

  // ---------- สรุปงานค้าง (ใบงาน 16, 17) ----------

  // นับงานค้างจากงานชุดหนึ่ง (กรองแผนกมาก่อนถ้าต้องการ) logs คือ StatusLog ทั้งหมด
  // คืน { open, overdue, byStatus: { สถานะ: { count, overdue } }, byDepartment: { แผนก: จำนวน },
  //       oldest: [งานที่แจ้งมานานสุด 3 งาน], noNotiThisMonth: { แผนก: จำนวน }, awaiting: กำลังซ่อมรอคำตอบ (ใบงาน 21) }
  function summarize(jobs, logs, now, config) {
    var byJob = {};
    (logs || []).forEach(function (l) { (byJob[l.JobID] = byJob[l.JobID] || []).push(l); });
    var month = String(now).slice(0, 7);
    var result = { open: 0, overdue: 0, byStatus: {}, byDepartment: {}, oldest: [], noNotiThisMonth: {}, awaiting: 0 };
    OPEN_STATUSES.forEach(function (s) { result.byStatus[s] = { count: 0, overdue: 0 }; });
    var open = [];
    (jobs || []).forEach(function (j) {
      var dept = j.Department || '-';
      if (j.Status === JOB_STATUS.CLOSED && configFlagValue(j.ClosedWithoutNoti) && String(j.ClosedAt || '').slice(0, 7) === month) {
        result.noNotiThisMonth[dept] = (result.noNotiThisMonth[dept] || 0) + 1;
      }
      if (OPEN_STATUSES.indexOf(j.Status) < 0) return;
      var late = overdueInfo(j, byJob[j.JobID], now, config).overdue;
      result.open++;
      result.byStatus[j.Status].count++;
      if (late) { result.overdue++; result.byStatus[j.Status].overdue++; }
      if (late && followUpInfo(j, byJob[j.JobID], now, config).state === FOLLOW_UP_STATE.AWAITING) result.awaiting++;
      result.byDepartment[dept] = (result.byDepartment[dept] || 0) + 1;
      open.push(j);
    });
    open.sort(function (a, b) { return String(a.CreatedAt).localeCompare(String(b.CreatedAt)); });
    result.oldest = open.slice(0, 3).map(function (j) {
      return { jobId: j.JobID, title: j.Title, status: j.Status, age: ageText(j.CreatedAt, now) };
    });
    return result;
  }

  // ช่อง TRUE/FALSE ในชีต (ช่องติ๊กอ่านออกมาเป็นข้อความ) หรือค่า true
  function configFlagValue(value) {
    return value === true || String(value).toUpperCase() === 'TRUE';
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
    phoneForCall: phoneForCall,
    validateRegistration: validateRegistration,
    JOB_STATUS: JOB_STATUS,
    JOB_STATUS_LABEL: JOB_STATUS_LABEL,
    REPORTER_ROLES: REPORTER_ROLES,
    OTHER: OTHER,
    TITLE_MAX: TITLE_MAX,
    ASSET_MAX: ASSET_MAX,
    OTHER_MAX: OTHER_MAX,
    LOCATION_MAX: LOCATION_MAX,
    DETAIL_MAX: DETAIL_MAX,
    CLIENT_REQUEST_ID_MAX: CLIENT_REQUEST_ID_MAX,
    PHOTO_MAX_COUNT: PHOTO_MAX_COUNT,
    PHOTO_MAX_SIDE: PHOTO_MAX_SIDE,
    PHOTO_QUALITY: PHOTO_QUALITY,
    PHOTO_PREFIX: PHOTO_PREFIX,
    nextJobId: nextJobId,
    photoFileName: photoFileName,
    jobTitle: jobTitle,
    jobAreaName: jobAreaName,
    ageText: ageText,
    canEditJob: canEditJob,
    validateJob: validateJob,
    parseTime: parseTime,
    configNumber: configNumber,
    configFlag: configFlag,
    isTrue: configFlagValue,
    OPEN_STATUSES: OPEN_STATUSES,
    slaLimit: slaLimit,
    statusSince: statusSince,
    overdueInfo: overdueInfo,
    validateNoti: validateNoti,
    duplicateNoti: duplicateNoti,
    sapShortText: sapShortText,
    formatNoti: formatNoti,
    NOTE_MAX: NOTE_MAX,
    validateAfterRepair: validateAfterRepair,
    REPAIR_PICK_OTHER: REPAIR_PICK_OTHER,
    photoRounds: photoRounds,
    CANCEL_REASON: CANCEL_REASON,
    jobPermissions: jobPermissions,
    canOpenNoti: canOpenNoti,
    FOLLOW_UP: FOLLOW_UP,
    FOLLOW_UP_STATE: FOLLOW_UP_STATE,
    FOLLOW_UP_MAX_DAYS: FOLLOW_UP_MAX_DAYS,
    DELAY_OTHER_LABEL: DELAY_OTHER_LABEL,
    addDays: addDays,
    validateFollowUp: validateFollowUp,
    followUpNote: followUpNote,
    followUpInfo: followUpInfo,
    summarize: summarize,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Core;
