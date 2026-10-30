/**
 * หน้าจอ LIFF ทั้งแอป (HTML + JavaScript ล้วน ไม่มี framework ตามกติกาทางเทคนิคข้อ 8)
 *
 * การแยกหน้า: ใช้พารามิเตอร์ ?page= เช่น https://liff.line.me/{liffId}?page=register
 * (GitHub Pages เปิด path ย่อยของแอปหน้าเดียวไม่ได้ จึงไม่ใช้ /register แบบในตารางของสเปก)
 *
 * ลำดับตอนเปิดแอป: เปิด LIFF → ล็อกอินถ้าเปิดนอก LINE → เรียก me → เลือกหน้าตามสถานะผู้ใช้
 */
(function () {
  var CONFIG = window.APP_CONFIG || {};

  var STATUS_LABEL = {
    NOT_REGISTERED: ['ยังไม่ได้ลงทะเบียน', 'warn'],
    PENDING: ['รอแอดมินอนุมัติ', 'warn'],
    APPROVED: ['ใช้งานได้', 'ok'],
    REJECTED: ['คำขอไม่ผ่าน', 'err'],
    DISABLED: ['ถูกระงับ', 'err'],
  };

  var ROLE_LABEL = {
    STAFF: 'พนักงานหน้างาน',
    LEAD: 'หัวหน้ากะ',
    PLANNER: 'Planner',
    TECH: 'ช่าง',
    ADMIN: 'แอดมิน',
    SAFETY: 'จป',
    DEPT_HEAD: 'หัวหน้าแผนก',
    DIRECTOR: 'ผอ.',
  };

  // คำอธิบายโรลในหน้าลงทะเบียน (ตาม mockup)
  var ROLE_HINT = {
    STAFF: 'แจ้งงานพร้อมรูป และดูงานของตัวเอง',
    LEAD: 'เปิด Noti ใน SAP ยกเลิก และปิดงาน ของแผนกตัวเอง',
    PLANNER: 'ดูสรุปงานค้างทั้งหมด',
    TECH: 'ดูงานรอซ่อม และแนบรูปหลังซ่อม',
    SAFETY: 'ประเมินงานที่กระทบความปลอดภัย ทุกแผนก',
    DEPT_HEAD: 'ดูงานของแผนกตัวเอง (หัวหน้าแผนกผลิตประเมินงานที่กระทบการผลิตและ NCP)',
    DIRECTOR: 'ดูภาพรวมงานซ่อมทุกแผนก',
  };

  // ข้อความแจ้งเรื่องข้อมูล ตามหัวข้อ "กติกาหน้าจอ" ในสเปก
  var CONSENT_TEXT = 'ระบบนี้เป็นโครงการนำร่องติดตามงานซ่อม เก็บชื่อจริง แผนก เบอร์มือถือ บัญชี LINE และรูปที่คุณถ่าย เพื่อใช้ติดตามงานซ่อมเท่านั้น ผู้ที่เห็นข้อมูลคือผู้ใช้ในระบบตามสิทธิ์ของแต่ละโรล ข้อมูลจะถูกลบหรือย้ายเข้าระบบบริษัทเมื่อจบโครงการ ถ้าต้องการให้ลบข้อมูล ติดต่อแอดมิน';

  // ---------- ส่วนช่วยสร้างหน้าจอ ----------

  // สร้าง element พร้อมคลาสและข้อความ
  function el(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  }

  // ล้างเนื้อหาหน้า แล้วตั้งข้อความใต้ชื่อแอปด้านบน
  function screen(subtitle) {
    document.getElementById('subtitle').textContent = subtitle;
    var main = document.getElementById('app');
    main.innerHTML = '';
    return main;
  }

  function row(name, valueNode) {
    var div = el('div', 'row');
    div.appendChild(el('span', '', name));
    div.appendChild(valueNode);
    return div;
  }

  function badge(value, kind) {
    return el('span', 'badge ' + kind, value);
  }

  // ---------- คุยกับ backend ----------

  // เรียกคำสั่ง API 1 คำสั่ง ส่ง ID token ไปทุกครั้ง (backend ไม่เชื่อ userId จากหน้าจอ)
  function api(action, payload) {
    var key = requestKey(action, payload);
    if (prefetched[key]) {
      var ready = prefetched[key];
      delete prefetched[key];
      return ready;
    }
    return callApi(action, payload);
  }

  function callApi(action, payload) {
    return fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, idToken: liff.getIDToken(), payload: payload || {} }),
    }).then(function (res) { return res.json(); });
  }

  function requestKey(action, payload) {
    return action + ' ' + JSON.stringify(payload || {});
  }

  // โหลดข้อมูลของหน้าที่จะเปิดไปพร้อมกับคำขอ me ไม่ต้องรอทีละรอบ (Apps Script ตอบราว 1.5–2 วินาทีต่อคำขอ)
  // หน้าจอเรียก api() คำสั่งเดียวกันทีหลังก็ได้ผลชุดนี้ทันที · ผู้ใช้ไม่มีสิทธิ์ backend ตอบ error เองและผลนี้ไม่ถูกใช้
  var prefetched = {};
  var PAGE_DATA = {
    my: ['listMyJobs'],
    new: ['reportOptions'],
    users: ['listUsers'],
    all: ['listJobs', { view: 'all' }],
    'queue-noti': ['listJobs', { view: 'noti' }],
    'queue-close': ['listJobs', { view: 'close' }],
    'queue-repair': ['listJobs', { view: 'repair' }],
  };
  function prefetchPage() {
    var params = new URLSearchParams(window.location.search);
    var page = params.get('page') || '';
    var request = page === 'job' ? ['jobDetail', { jobId: params.get('id') }] : PAGE_DATA[page];
    if (!request) return;
    var pending = callApi(request[0], request[1]);
    pending.catch(function () { /* หน้าที่ใช้ผลนี้จัดการ error เอง */ });
    prefetched[requestKey(request[0], request[1])] = pending;
  }

  // ---------- หน้าต่าง ๆ ----------

  // หน้าแสดงข้อผิดพลาด
  function showError(message) {
    var main = screen('เกิดข้อผิดพลาด');
    var card = el('section', 'card');
    card.appendChild(el('p', 'error', message));
    main.appendChild(card);
  }

  // หน้าสถานะ: ใช้กับคนที่รออนุมัติ ถูกระงับ และหน้าแรกชั่วคราวของผู้ใช้ที่อนุมัติแล้ว
  function showStatus(me, note) {
    var label = STATUS_LABEL[me.status] || [me.status, 'warn'];
    var main = screen(label[0]);
    var card = el('section', 'card');
    card.appendChild(el('h1', '', 'สวัสดี ' + (me.lineName || '')));
    card.appendChild(row('สถานะ', badge(label[0], label[1])));
    if (me.role) card.appendChild(row('โรล', el('span', '', ROLE_LABEL[me.role] || me.role)));
    if (me.realName) card.appendChild(row('ชื่อจริง', el('span', '', me.realName)));
    if (note) card.appendChild(el('p', 'muted', note));
    main.appendChild(card);
  }

  // หน้าลงทะเบียน (ตาม mockup Register.html)
  // departments คือรายชื่อแผนกจากชีต Departments (คำสั่ง listDepartments)
  function showRegister(me, departments) {
    var main = screen('ลงทะเบียนใช้งาน');
    var form = el('form', 'card');
    form.noValidate = true;

    form.appendChild(el('h1', '', 'สวัสดี ' + (me.lineName || '')));
    form.appendChild(el('p', 'muted', 'ครั้งแรกที่ใช้งาน กรอกข้อมูลให้แอดมินอนุมัติ อนุมัติแล้วเมนูในแชทจะเปลี่ยนตามโรล'));
    if (me.status === 'REJECTED') {
      form.appendChild(el('p', 'error', 'คำขอครั้งก่อนไม่ผ่าน แก้ข้อมูลแล้วส่งใหม่ได้ หรือติดต่อแอดมิน'));
    }

    var realName = field(form, 'realName', 'ชื่อ-นามสกุลจริง', input('text', 'ใช้ชื่อเดียวกับในบัตรพนักงาน'));
    var department = field(form, 'department', 'แผนก', select(departments));
    var phone = field(form, 'phone', 'เบอร์มือถือ', input('tel', '0812345678'));
    phone.inputMode = 'numeric';
    phone.maxLength = 12;
    form.querySelector('[data-field="phone"]').appendChild(el('small', 'muted', 'หัวหน้ากะและช่างใช้โทรถามอาการ คนอื่นไม่เห็นเบอร์นี้'));

    var roleBox = el('fieldset', 'field');
    roleBox.dataset.field = 'requestedRole';
    roleBox.appendChild(el('legend', '', 'โรลที่ขอ *'));
    Object.keys(ROLE_HINT).forEach(function (role) {
      var option = el('label', 'choice');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'requestedRole';
      radio.value = role;
      option.appendChild(radio);
      var textBox = el('span', 'choice-text');
      textBox.appendChild(el('strong', '', ROLE_LABEL[role]));
      textBox.appendChild(el('small', 'muted', ROLE_HINT[role]));
      option.appendChild(textBox);
      roleBox.appendChild(option);
    });
    roleBox.appendChild(el('small', 'field-error'));
    form.appendChild(roleBox);

    var consentBox = el('div', 'field consent');
    consentBox.dataset.field = 'consent';
    consentBox.appendChild(el('p', 'notice', CONSENT_TEXT));
    var consentLabel = el('label', 'choice');
    var consent = document.createElement('input');
    consent.type = 'checkbox';
    consentLabel.appendChild(consent);
    consentLabel.appendChild(el('span', '', 'รับทราบ'));
    consentBox.appendChild(consentLabel);
    consentBox.appendChild(el('small', 'field-error'));

    // ใบงาน 28: คนที่เปิด Notification ใน SAP เองได้ ติ๊กไว้ จะใส่เลข Noti ให้งานที่ตัวเองแจ้งได้หลังอนุมัติ
    var sapLabel = el('label', 'choice');
    var canNoti = document.createElement('input');
    canNoti.type = 'checkbox';
    sapLabel.appendChild(canNoti);
    var sapText = el('span', 'choice-text');
    sapText.appendChild(el('strong', '', 'ฉันเปิด Notification ใน SAP เองได้'));
    sapText.appendChild(el('small', '', 'ไม่บังคับ · ติ๊กแล้วใส่เลข Noti ให้งานที่ตัวเองแจ้งได้ ไม่ต้องรอหัวหน้ากะ'));
    sapLabel.appendChild(sapText);
    // มีผลเฉพาะพนักงานหน้างาน จึงขึ้นเฉพาะตอนเลือกโรลนี้ (หัวหน้ากะใส่เลข Noti ได้อยู่แล้ว โรลอื่นแจ้งงานไม่ได้)
    sapLabel.style.display = 'none';
    roleBox.addEventListener('change', function () {
      var picked = form.querySelector('input[name="requestedRole"]:checked');
      sapLabel.style.display = picked && picked.value === 'STAFF' ? '' : 'none';
    });
    form.appendChild(sapLabel);
    form.appendChild(consentBox);

    var submit = el('button', 'primary', 'ส่งคำขอ');
    submit.type = 'submit';
    form.appendChild(submit);
    var formError = el('p', 'error hidden');
    form.appendChild(formError);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var checked = form.querySelector('input[name="requestedRole"]:checked');
      var payload = {
        realName: realName.value,
        department: department.value,
        phone: phone.value,
        requestedRole: checked ? checked.value : '',
        consent: consent.checked,
        canNoti: Boolean(checked && checked.value === 'STAFF' && canNoti.checked),
      };
      // ตรวจในเครื่องก่อนด้วยกติกาชุดเดียวกับ backend จะได้เห็นข้อผิดทันที
      var check = Core.validateRegistration(payload, departments);
      showFieldErrors(form, check.fields);
      if (!check.ok) return;

      submit.disabled = true;
      submit.textContent = 'กำลังส่ง…';
      formError.classList.add('hidden');
      api('register', payload)
        .then(function (res) {
          if (res.ok) {
            showStatus({ status: 'PENDING', lineName: me.lineName, realName: payload.realName.trim() },
              'ส่งคำขอแล้ว รอแอดมินอนุมัติ เมื่ออนุมัติแล้วเมนูในแชทจะเปลี่ยนตามโรล');
            return;
          }
          if (res.error.details && res.error.details.fields) showFieldErrors(form, res.error.details.fields);
          formError.textContent = res.error.message;
          formError.classList.remove('hidden');
        })
        .catch(function () {
          formError.textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดส่งอีกครั้ง';
          formError.classList.remove('hidden');
        })
        .then(function () {
          submit.disabled = false;
          submit.textContent = 'ส่งคำขอ';
        });
    });

    main.appendChild(form);
  }

  // สร้างช่องกรอก 1 ช่อง พร้อมป้ายชื่อและที่แสดงข้อความผิด คืน element ของช่องกรอก
  function field(form, name, labelText, control, optional) {
    var box = el('div', 'field');
    box.dataset.field = name;
    var label = el('label', '', labelText + (optional ? '' : ' *'));
    control.id = 'f-' + name;
    label.htmlFor = control.id;
    box.appendChild(label);
    box.appendChild(control);
    box.appendChild(el('small', 'field-error'));
    form.appendChild(box);
    return control;
  }

  function input(type, placeholder) {
    var node = document.createElement('input');
    node.type = type;
    node.placeholder = placeholder;
    return node;
  }

  function select(options) {
    var node = document.createElement('select');
    var empty = el('option', '', 'เลือกแผนก');
    empty.value = '';
    node.appendChild(empty);
    options.forEach(function (value) { node.appendChild(el('option', '', value)); });
    return node;
  }

  // แสดงข้อความผิดใต้แต่ละช่อง และล้างข้อความของช่องที่ถูกแล้ว
  function showFieldErrors(form, fields) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-field]'), function (box) {
      var message = fields[box.dataset.field] || '';
      box.querySelector('.field-error').textContent = message;
      box.classList.toggle('invalid', Boolean(message));
    });
  }

  // แสดง QR เพิ่มเพื่อน OA เต็มจอ ให้คนใหม่สแกนจากมือถือแอดมิน ปิดแล้วเรียก onClose
  // รูป QR ดึงจากบริการ QR ทางการของ LINE ตาม Basic ID ของ OA
  function showFriendQr(onClose) {
    var basicId = String(CONFIG.OA_BASIC_ID || '').replace(/^@/, '');
    var overlay = el('div', 'qr-overlay');
    var box = el('div', 'qr-box');
    box.appendChild(el('h1', '', 'สแกนเพื่อเพิ่มเพื่อน'));
    box.appendChild(el('p', 'muted', 'ให้คนใหม่เปิดกล้อง LINE สแกน แล้วกดปุ่ม "ลงทะเบียน" ที่เมนูด้านล่างแชท'));
    var img = document.createElement('img');
    img.alt = 'QR เพิ่มเพื่อน LINE OA';
    img.src = 'https://qr-official.line.me/sid/L/' + encodeURIComponent(basicId) + '.png';
    box.appendChild(img);
    box.appendChild(el('p', 'qr-id', '@' + basicId));
    var close = el('button', 'primary', 'ปิด แล้วดูคำขอใหม่');
    close.addEventListener('click', function () {
      document.body.removeChild(overlay);
      onClose();
    });
    box.appendChild(close);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  // หน้าจัดการผู้ใช้ของแอดมิน (ตาม mockup Users.html)
  function showUsers(me) {
    var main = screen('จัดการผู้ใช้');
    main.appendChild(el('p', 'muted', 'กำลังโหลดรายชื่อ…'));

    api('listUsers').then(function (res) {
      main.innerHTML = '';
      if (!res.ok) return showError(res.error.message);

      // ปุ่มด้านบน: QR เพิ่มเพื่อนสำหรับลงทะเบียนหน้างาน และโหลดรายการใหม่
      var tools = el('div', 'toolbar');
      var qrButton = el('button', 'primary small', 'QR เพิ่มเพื่อน');
      qrButton.addEventListener('click', function () { showFriendQr(function () { showUsers(me); }); });
      var reload = el('button', 'small', 'โหลดใหม่');
      reload.addEventListener('click', function () { showUsers(me); });
      tools.appendChild(qrButton);
      tools.appendChild(reload);
      main.appendChild(tools);

      // เตือนแผนกที่มีพนักงานหน้างานแต่ไม่มีหัวหน้ากะ งานของแผนกนั้นจะไม่มีหัวหน้ากะคนไหนเห็นในคิว
      (res.data.departmentsWithoutLead || []).forEach(function (dept) {
        main.appendChild(el('p', 'warning', '⚠️ แผนก ' + dept + ' ยังไม่มีหัวหน้ากะ งานที่คนแผนกนี้แจ้งจะไม่มีหัวหน้ากะคนไหนเห็น ให้อนุมัติหรือเปลี่ยนโรลให้มีหัวหน้ากะของแผนกนี้อย่างน้อย 1 คน'));
      });
      var users = res.data.users;
      var pending = users.filter(function (u) { return u.status === 'PENDING'; });
      var approved = users.filter(function (u) { return u.status === 'APPROVED'; });

      // คำขอที่รออนุมัติ
      var pendingCard = el('section', 'card');
      var head = el('div', 'card-head');
      head.appendChild(el('h1', '', 'รออนุมัติ ' + pending.length + ' คน'));
      if (pending.length > 1) {
        var all = el('button', 'primary small', 'อนุมัติทั้งหมด');
        all.addEventListener('click', function () {
          act(all, 'approveUsers', { approvals: pending.map(function (u) { return { userId: u.userId }; }) });
        });
        head.appendChild(all);
      }
      pendingCard.appendChild(head);
      if (!pending.length) pendingCard.appendChild(el('p', 'muted', 'ไม่มีคำขอใหม่'));
      pending.forEach(function (u) {
        var item = el('div', 'person');
        var info = el('div', 'person-info');
        info.appendChild(el('strong', '', u.realName || u.lineName));
        info.appendChild(el('small', 'muted', 'ขอเป็น' + (ROLE_LABEL[u.requestedRole] || u.requestedRole)));
        if (u.canNoti) info.appendChild(badge('เปิด Noti ใน SAP ได้', 'info'));
        // แอดมินแก้แผนกที่กรอกผิดได้ก่อนกดอนุมัติ
        info.appendChild(departmentSelect(u));
        item.appendChild(info);
        var actions = el('div', 'person-actions');
        var reject = el('button', 'small', 'ปฏิเสธ');
        reject.addEventListener('click', function () {
          if (window.confirm('ปฏิเสธคำขอของ ' + (u.realName || u.lineName) + '?')) act(reject, 'rejectUser', { userId: u.userId });
        });
        var approve = el('button', 'primary small', 'อนุมัติ');
        approve.addEventListener('click', function () { act(approve, 'approveUsers', { approvals: [{ userId: u.userId }] }); });
        actions.appendChild(reject);
        actions.appendChild(approve);
        item.appendChild(actions);
        pendingCard.appendChild(item);
      });
      main.appendChild(pendingCard);

      // ผู้ใช้ที่อนุมัติแล้ว เปลี่ยนโรล แผนก และระงับได้ (ตัวเองเปลี่ยนได้แค่แผนก)
      var allCard = el('section', 'card');
      allCard.appendChild(el('h1', '', 'ผู้ใช้ทั้งหมด ' + approved.length + ' คน'));
      approved.forEach(function (u) {
        var item = el('div', 'person person-manage');
        var info = el('div', 'person-info');
        var isSelf = u.userId === me.userId;
        info.appendChild(el('strong', '', (u.realName || u.lineName) + (isSelf ? ' (คุณ)' : '')));
        item.appendChild(info);
        var controls = el('div', 'person-controls');
        controls.appendChild(departmentSelect(u));
        item.appendChild(controls);
        if (isSelf) {
          controls.appendChild(el('span', 'badge ok', ROLE_LABEL[u.role] || u.role));
        } else {
          var roleSelect = document.createElement('select');
          roleSelect.className = 'role-select';
          Object.keys(ROLE_LABEL).forEach(function (role) {
            var option = el('option', '', ROLE_LABEL[role]);
            option.value = role;
            option.selected = role === u.role;
            roleSelect.appendChild(option);
          });
          roleSelect.addEventListener('change', function () {
            act(roleSelect, 'changeRole', { userId: u.userId, role: roleSelect.value });
          });
          controls.appendChild(roleSelect);
          var suspend = el('button', 'small', 'ระงับ');
          suspend.addEventListener('click', function () {
            var name = u.realName || u.lineName;
            if (window.confirm('ระงับ ' + name + '? คนนี้จะใช้ระบบไม่ได้ ประวัติงานเก่ายังอยู่ และเปิดใช้อีกครั้งได้')) {
              act(suspend, 'suspendUser', { userId: u.userId });
            }
          });
          controls.appendChild(suspend);
        }
        allCard.appendChild(item);
      });
      allCard.appendChild(el('p', 'muted', 'เปลี่ยนโรลแล้ว เมนูในแชทของคนนั้นเปลี่ยนตามทันที · เปลี่ยนแผนกแล้ว งานที่แจ้งไปแล้วอยู่แผนกเดิม'));
      main.appendChild(allCard);

      // ผู้ใช้ที่ระงับ (เช่น ลาออก) ซ่อนไว้ กดเปิดดูได้ และเปิดใช้อีกครั้งได้
      var disabled = users.filter(function (u) { return u.status === 'DISABLED'; });
      if (disabled.length) {
        var box = el('details', 'card');
        box.appendChild(el('summary', 'card-title', 'ผู้ใช้ที่ระงับ ' + disabled.length + ' คน'));
        disabled.forEach(function (u) {
          var item = el('div', 'person');
          var info = el('div', 'person-info');
          info.appendChild(el('strong', '', u.realName || u.lineName));
          info.appendChild(el('small', 'muted', [u.department, ROLE_LABEL[u.role] || u.role].filter(Boolean).join(' · ')));
          item.appendChild(info);
          var back = el('button', 'small', 'เปิดใช้อีกครั้ง');
          back.addEventListener('click', function () { act(back, 'reactivateUser', { userId: u.userId }); });
          item.appendChild(back);
          box.appendChild(item);
        });
        main.appendChild(box);
      }

      // ช่องเลือกแผนกของผู้ใช้ 1 คน เปลี่ยนแล้วบันทึกทันที (แผนกที่ปิดใช้ไปแล้วยังแสดงเป็นค่าปัจจุบัน)
      function departmentSelect(u) {
        var node = document.createElement('select');
        node.className = 'role-select';
        node.setAttribute('aria-label', 'แผนกของ ' + (u.realName || u.lineName));
        var names = res.data.departments || [];
        if (u.department && names.indexOf(u.department) === -1) names = [u.department].concat(names);
        names.forEach(function (name) {
          var option = el('option', '', 'แผนก' + name);
          option.value = name;
          option.selected = name === u.department;
          node.appendChild(option);
        });
        node.addEventListener('change', function () {
          act(node, 'changeDepartment', { userId: u.userId, department: node.value });
        });
        return node;
      }
    }).catch(function () {
      showError('โหลดรายชื่อไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่');
    });

    // ส่งคำสั่ง 1 คำสั่ง ระหว่างรอปิดปุ่มไว้ เสร็จแล้วโหลดหน้าใหม่ ผิดพลาดก็บอก
    function act(control, action, payload) {
      control.disabled = true;
      api(action, payload)
        .then(function (res) {
          if (!res.ok) window.alert(res.error.message);
          showUsers(me);
        })
        .catch(function () {
          window.alert('ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่');
          control.disabled = false;
        });
    }
  }

  // ---------- เลือกหน้า ----------

  // เลือกหน้าจากสถานะผู้ใช้และพารามิเตอร์ ?page=
  // ---------- แจ้งงาน 4 ขั้น (ใบงาน 06 · docs/design/UI.md หัวข้อ "แจ้งงาน") ----------

  // ช่องของแต่ละขั้น ใช้เลือกข้อความผิดจาก Core.validateJob มาแสดงเฉพาะขั้นที่อยู่
  var STEP_FIELDS = { 1: ['photos'], 2: ['asset', 'symptom'], 3: ['area', 'locationDetail'], 4: ['impacts', 'detail', 'notiNo', 'sapShortText'] };
  var MIC_HINT = 'กดไมค์บนแป้นพิมพ์เพื่อพูดแทนพิมพ์ได้';

  // แบบร่างเก็บในเครื่อง (รวมรูป) ปิดแอปกลางคันแล้วเปิดใหม่ยังอยู่ · ที่เก็บเต็มหรือถูกปิดก็ใช้ต่อได้แค่ไม่มีแบบร่าง
  function draftKey(me) { return 'btgpd-draft-' + me.userId; }
  function loadDraft(me) {
    try { return JSON.parse(localStorage.getItem(draftKey(me)) || 'null'); } catch (e) { return null; }
  }
  function saveDraft(me, draft) {
    try { localStorage.setItem(draftKey(me), JSON.stringify(draft)); } catch (e) { /* ใช้ต่อได้โดยไม่มีแบบร่าง */ }
  }
  function clearDraft(me) {
    try { localStorage.removeItem(draftKey(me)); } catch (e) { /* ไม่มีอะไรต้องทำ */ }
  }

  // รหัสแบบร่าง ส่งไปกับงาน กดส่งซ้ำตอนเน็ตหลุดแล้ว backend คืนงานเดิม ไม่เกิดงานซ้ำ
  function newRequestId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ย่อรูปในเครื่องก่อนส่ง ด้านยาวไม่เกิน Core.PHOTO_MAX_SIDE แล้วแปลงเป็น JPEG
  function resizePhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, Core.PHOTO_MAX_SIDE / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', Core.PHOTO_QUALITY));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('อ่านรูปไม่ได้')); };
      img.src = url;
    });
  }

  function loading(subtitle) {
    var main = screen(subtitle);
    var card = el('section', 'card');
    card.appendChild(el('p', 'muted', 'กำลังโหลด…'));
    main.appendChild(card);
  }

  // กลุ่มช่องที่ไม่ใช่ช่องพิมพ์ช่องเดียว (รูป ปุ่มตัวเลือก) คืนกล่องสำหรับใส่ของข้างใน
  function group(form, name, labelText) {
    var box = el('div', 'field');
    box.dataset.field = name;
    box.appendChild(el('span', 'field-label', labelText));
    var body = el('div', 'field-body');
    box.appendChild(body);
    box.appendChild(el('small', 'field-error'));
    form.appendChild(box);
    return body;
  }

  // ช่องพิมพ์ที่ผูกกับค่าใน state พร้อมคำแนะนำไมค์ใต้ช่อง persist คือบันทึกแบบร่าง (หน้าแก้งานส่งฟังก์ชันว่าง)
  function textField(form, persist, state, key, name, labelText, placeholder, onChange) {
    var control = field(form, name, labelText, input('text', placeholder));
    control.value = state[key] || '';
    control.addEventListener('input', function () {
      state[key] = control.value;
      persist();
      if (onChange) onChange();
    });
    control.parentNode.insertBefore(el('small', 'hint', MIC_HINT), control.nextSibling);
    return control;
  }

  // ช่องพิมพ์หลายบรรทัด พร้อมคำแนะนำไมค์ onInput ได้ข้อความทุกครั้งที่พิมพ์
  function textArea(form, name, labelText, placeholder, value, onInput) {
    var box = el('div', 'field');
    box.dataset.field = name;
    var area = el('textarea');
    area.id = 'f-' + name;
    area.rows = 3;
    area.placeholder = placeholder;
    area.value = value || '';
    area.addEventListener('input', function () { onInput(area.value); });
    var label = el('label', '', labelText);
    label.htmlFor = area.id;
    box.appendChild(label);
    box.appendChild(area);
    box.appendChild(el('small', 'hint', MIC_HINT));
    box.appendChild(el('small', 'field-error'));
    form.appendChild(box);
    return area;
  }

  // รายการคำแนะนำใต้ช่องพิมพ์ กรองตามที่พิมพ์ (ไม่ใช้ datalist เพราะบนมือถือแสดงไม่เหมือนกัน)
  function suggestions(control, items, onPick) {
    var list = el('div', 'suggest');
    control.parentNode.insertBefore(list, control.nextSibling);
    function update() {
      var typed = control.value.trim().toLowerCase();
      list.innerHTML = '';
      items
        .filter(function (item) {
          var text = item.text.toLowerCase();
          return text !== typed && text.indexOf(typed) >= 0;
        })
        .slice(0, 5)
        .forEach(function (item) {
          var pick = el('button', 'suggest-item', item.text);
          pick.type = 'button';
          pick.addEventListener('click', function () {
            control.value = item.text;
            control.dispatchEvent(new Event('input'));
          });
          list.appendChild(pick);
        });
    }
    control.addEventListener('input', update);
    update();
  }

  // ปุ่มตัวเลือกแบบชิป ต่อท้ายด้วย "อื่น ๆ" (รหัส Core.OTHER)
  function chips(body, items, selected, onPick) {
    var row = el('div', 'chips');
    items.concat([{ code: Core.OTHER, text: 'อื่น ๆ' }]).forEach(function (item) {
      var chip = el('button', 'chip', item.text);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(item.code === selected));
      chip.addEventListener('click', function () { onPick(item.code); });
      row.appendChild(chip);
    });
    body.appendChild(row);
  }

  // ช่องรูป 1–3 รูป ใช้ทั้งแจ้งงาน แก้เสร็จหน้างาน และแนบรูปหลังซ่อม
  // รูปย่อมีปุ่ม ✕ ลบ · ปุ่ม "ถ่ายรูป" เปิดกล้องในหน้าแอป · ลิงก์ "หรือเลือกจากอัลบั้ม"
  // state.photos คือรายการรูป (data URL) · opts: label, save (บันทึกแบบร่าง ไม่ส่งได้), rerender (วาดหน้าใหม่หลังรูปเปลี่ยน)
  // คืนกล่องเนื้อหาของช่อง ใส่คำแนะนำต่อท้ายได้
  function photoField(form, state, opts) {
    var save = opts.save || function () {};
    var body = group(form, 'photos', opts.label);
    var thumbs = el('div', 'thumbs');
    for (var i = 0; i < Core.PHOTO_MAX_COUNT; i++) thumbs.appendChild(photoCell(i));
    body.appendChild(thumbs);
    var camera = fileInput(false);
    camera.setAttribute('capture', 'environment');
    var album = fileInput(true);
    var full = state.photos.length >= Core.PHOTO_MAX_COUNT;
    var cameraButton = el('button', 'primary', 'ถ่ายรูป');
    cameraButton.type = 'button';
    cameraButton.disabled = full;
    cameraButton.addEventListener('click', function () { openCamera(); });
    var albumButton = el('button', 'link', 'หรือเลือกจากอัลบั้ม');
    albumButton.type = 'button';
    albumButton.disabled = full;
    albumButton.addEventListener('click', function () { album.click(); });
    body.appendChild(cameraButton);
    body.appendChild(albumButton);
    body.appendChild(camera);
    body.appendChild(album);
    return body;

    // ช่องรูปย่อ 1 ช่อง มีรูปแล้วแสดงปุ่ม ✕ ลบ
    function photoCell(index) {
      var cell = el('div', 'thumb');
      var photo = state.photos[index];
      if (!photo) return cell;
      var img = el('img');
      img.src = photo;
      img.alt = 'รูปที่ ' + (index + 1);
      var remove = el('button', 'thumb-remove', '✕');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'ลบรูปที่ ' + (index + 1));
      remove.addEventListener('click', function () {
        state.photos.splice(index, 1);
        save();
        opts.rerender();
      });
      cell.appendChild(img);
      cell.appendChild(remove);
      return cell;
    }

    function fileInput(multiple) {
      var node = document.createElement('input');
      node.type = 'file';
      node.accept = 'image/*';
      node.multiple = multiple;
      node.className = 'hidden';
      node.addEventListener('change', function () { addPhotos(node.files); });
      return node;
    }

    function addPhotos(files) {
      var room = Core.PHOTO_MAX_COUNT - state.photos.length;
      var picked = Array.prototype.slice.call(files || [], 0, room);
      if (!picked.length) return;
      var dropped = files.length > picked.length;
      cameraButton.disabled = true;
      cameraButton.textContent = 'กำลังย่อรูป…';
      Promise.all(picked.map(resizePhoto))
        .then(function (photos) {
          photos.forEach(function (p) { state.photos.push(p); });
          save();
          opts.rerender();
          if (dropped) {
            showFieldErrors(document.querySelector('form'),
              { photos: 'แนบได้ไม่เกิน ' + Core.PHOTO_MAX_COUNT + ' รูป ใช้เฉพาะรูปแรก ๆ ที่เลือก' });
          }
        })
        .catch(function () {
          opts.rerender();
          showFieldErrors(document.querySelector('form'), { photos: 'อ่านรูปไม่ได้ ลองถ่ายใหม่อีกครั้ง' });
        });
    }

    // กล้องในหน้าแอป: กดถ่ายรูปแล้วเห็นภาพกล้องหลังทันที ไม่ต้องผ่านหน้าเลือก "กล้อง / ไฟล์" ของ LINE บน Android
    // เปิดกล้องในแอปไม่ได้ ใช้แบบเดิมแทน (ช่องไฟล์แบบ capture ซึ่งบน Android จะมีหน้าเลือก "กล้อง / ไฟล์")
    function openCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        camera.click();
        return;
      }
      var overlay = el('div', 'cam');
      var video = el('video');
      video.setAttribute('playsinline', '');
      video.muted = true;
      video.autoplay = true;
      var message = el('p', 'cam-message hidden');
      var strip = el('div', 'cam-strip');
      var count = el('span', 'cam-count');
      var shutter = el('button', 'cam-shutter');
      shutter.type = 'button';
      shutter.setAttribute('aria-label', 'ถ่าย');
      shutter.disabled = true;
      var done = el('button', 'small', 'เสร็จ');
      done.type = 'button';
      // ปุ่มนี้โผล่เฉพาะตอนเปิดกล้องในแอปไม่ได้ (เช่น ไม่ได้อนุญาตกล้อง) ต้องให้ผู้ใช้แตะเอง เพราะเบราว์เซอร์ไม่ยอมเปิดช่องไฟล์ให้โดยไม่มีการแตะ
      var phoneCamera = el('button', 'primary cam-fallback hidden', 'ใช้กล้องแบบเดิม');
      phoneCamera.type = 'button';
      var bar = el('div', 'cam-bar');
      bar.appendChild(count);
      bar.appendChild(shutter);
      bar.appendChild(done);
      overlay.appendChild(video);
      overlay.appendChild(message);
      overlay.appendChild(strip);
      overlay.appendChild(bar);
      overlay.appendChild(phoneCamera);
      document.body.appendChild(overlay);

      var stream = null;
      function close() {
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        overlay.remove();
        opts.rerender();
      }
      function update() {
        count.textContent = 'รูป ' + state.photos.length + '/' + Core.PHOTO_MAX_COUNT;
        strip.innerHTML = '';
        state.photos.forEach(function (photo) {
          var img = el('img');
          img.src = photo;
          img.alt = '';
          strip.appendChild(img);
        });
      }
      function fail(text) {
        message.textContent = text;
        message.classList.remove('hidden');
        shutter.classList.add('hidden');
        phoneCamera.classList.remove('hidden');
      }
      update();
      done.addEventListener('click', close);
      phoneCamera.addEventListener('click', function () { close(); camera.click(); });
      shutter.addEventListener('click', function () {
        var scale = Math.min(1, Core.PHOTO_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        state.photos.push(canvas.toDataURL('image/jpeg', Core.PHOTO_QUALITY));
        save();
        overlay.classList.add('cam-flash');
        setTimeout(function () { overlay.classList.remove('cam-flash'); }, 150);
        update();
        if (state.photos.length >= Core.PHOTO_MAX_COUNT) close();
      });

      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
        .then(function (s) {
          stream = s;
          if (!overlay.isConnected) { close(); return; }
          video.srcObject = s;
          return video.play().then(function () { shutter.disabled = false; });
        })
        .catch(function () {
          fail('เปิดกล้องในแอปไม่ได้ (อาจยังไม่ได้อนุญาตให้ใช้กล้อง)');
        });
    }
  }

  function showNewJob(me) {
    loading('แจ้งงานใหม่');
    api('reportOptions')
      .then(function (res) {
        if (!res.ok) return showError(res.error.message);
        var draft = loadDraft(me);
        if (!draft || !draft.clientRequestId) {
          draft = {
            clientRequestId: newRequestId(),
            photos: [],
            areaCode: res.data.lastAreaCode || '',
            areaOther: res.data.lastAreaOther || '',
          };
        }
        // ใบงาน 27: ผลกระทบบังคับเลือก (แบบร่างเก่าที่ยังไม่มีช่องนี้เริ่มที่ยังไม่เลือก)
        if (!Array.isArray(draft.impacts)) draft.impacts = [];
        showReportStep(me, res.data, draft, draft.step || 1);
      })
      .catch(function () { showError('โหลดหน้าแจ้งงานไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
  }

  function showReportStep(me, options, draft, step) {
    draft.step = step;
    saveDraft(me, draft);
    var main = screen('แจ้งงานใหม่');
    var rerender = function () { showReportStep(me, options, draft, step); };
    var persist = function () { saveDraft(me, draft); };

    var progress = el('div', 'progress');
    progress.appendChild(el('span', 'muted', 'ขั้น ' + step + ' จาก 4'));
    var bar = el('div', 'progress-bar');
    bar.appendChild(el('div', 'progress-fill')).style.width = (step * 25) + '%';
    progress.appendChild(bar);
    main.appendChild(progress);

    var form = el('form', 'card');
    form.noValidate = true;
    // ตรวจด้วยกติกาชุดเดียวกับ backend · งานแจ้งแทนที่ใส่เลข Noti ตรวจเลข Noti ด้วย (ใบงาน 12)
    var check = function () {
      var result = Core.validateJob(draft, options);
      if (options.noti && String(draft.notiNo || '').trim()) {
        var noti = Core.validateNoti(draft, { NOTI_DIGITS: options.noti.digits, SAP_SHORTTEXT_MAX: options.noti.sapMax });
        Object.keys(noti.fields).forEach(function (k) { result.fields[k] = noti.fields[k]; });
        result.ok = result.ok && noti.ok;
      }
      return result;
    };
    var buildInfo = null;

    if (step === 1) {
      form.appendChild(el('h1', '', 'ถ่ายรูปอาการ'));
      var body = photoField(form, draft, { label: 'รูป 1–3 รูป *', save: persist, rerender: rerender });
      body.appendChild(el('p', 'notice', 'ถ้าทำได้ ถ่าย 1 รูปให้เห็นรอบ ๆ ด้วย ช่างจะหาเจอง่ายขึ้น'));
      // เลขรุ่นแอปและสถานะกล้องในแอป ตัวเล็กสีจาง ใช้ถามผู้ใช้ตอนกล้องมีปัญหา (Android บางเครื่อง LINE ไม่ให้ใช้กล้องในแอป)
      var inAppCamera = navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? 'รองรับ' : 'ไม่รองรับ';
      buildInfo = el('p', 'build-info', 'กล้องในแอป: ' + inAppCamera);
    }

    if (step === 2) {
      form.appendChild(el('h1', '', 'อะไรเสีย เกิดอะไรขึ้น'));
      var title = el('p', 'notice');
      var showTitle = function () {
        var value = check().value.title;
        title.textContent = 'ชื่องาน: ' + (value || '-');
      };
      var asset = textField(form, persist, draft, 'asset', 'asset', 'อะไรเสีย', 'เช่น ปั๊มน้ำ สายพาน', showTitle);
      suggestions(asset, options.assetSuggestions || []);
      var symptoms = group(form, 'symptom', 'เกิดอะไรขึ้น *');
      chips(symptoms, options.symptoms.map(function (s) { return { code: s.code, text: s.label }; }), draft.symptomCode,
        function (code) { draft.symptomCode = code; rerender(); });
      if (draft.symptomCode === Core.OTHER) {
        textField(form, persist, draft, 'symptomOther', 'symptomOther', 'พิมพ์อาการ', 'เช่น มีกลิ่นไหม้', showTitle);
      }
      form.appendChild(title);
      showTitle();
    }

    if (step === 3) {
      form.appendChild(el('h1', '', 'อยู่ที่ไหน'));
      var areas = group(form, 'area', 'พื้นที่ *');
      chips(areas, options.areas.map(function (a) { return { code: a.code, text: a.name }; }), draft.areaCode,
        function (code) { draft.areaCode = code; rerender(); });
      if (draft.areaCode === Core.OTHER) {
        textField(form, persist, draft, 'areaOther', 'areaOther', 'พิมพ์ชื่อพื้นที่', 'เช่น โรงซ่อมบำรุง');
      }
      var spot = textField(form, persist, draft, 'locationDetail', 'locationDetail', 'ตรงไหน', 'เช่น ชั้น 2 ข้างลิฟต์');
      suggestions(spot, (options.locationSuggestions || {})[draft.areaCode] || []);
    }

    if (step === 4) {
      form.appendChild(el('h1', '', 'ตรวจแล้วส่ง'));
      var value = check().value;
      var strip = el('div', 'thumbs small');
      draft.photos.forEach(function (photo) {
        var img = el('img');
        img.src = photo;
        img.alt = '';
        strip.appendChild(img);
      });
      form.appendChild(summary('รูป', strip, 1));
      form.appendChild(summary('ชื่องาน', el('span', '', value.title), 2));
      form.appendChild(summary('พื้นที่', el('span', '', value.areaName), 3));
      form.appendChild(summary('ตรงไหน', el('span', '', value.locationDetail), 3));
      if (options.noti) {
        form.appendChild(el('p', 'notice', 'แจ้งแทนคนอื่น: ใส่ชื่อและเบอร์ของคนแจ้งจริงในรายละเอียด · ถ้าเปิด Noti ใน SAP แล้ว ใส่เลข Noti ด้านล่าง งานจะเข้าคิวรอซ่อมทันที'));
      }
      impactChips(form, draft, persist);
      textArea(form, 'detail', 'รายละเอียดเพิ่มเติม (ไม่บังคับ)', options.noti ? 'เช่น คุณสมมุติ 0812345678 โทรมาแจ้ง' : 'เช่น เริ่มรั่วตั้งแต่เช้า',
        draft.detail, function (text) { draft.detail = text; persist(); });
      if (options.noti) {
        var notiNo = field(form, 'notiNo', 'เลข Noti (ถ้าเปิดใน SAP แล้ว)', input('text', options.noti.digits + ' หลัก'), true);
        notiNo.inputMode = 'numeric';
        notiNo.autocomplete = 'off';
        notiNo.value = draft.notiNo || '';
        var sap = field(form, 'sapShortText', 'ชื่องาน SAP', input('text', ''));
        sap.maxLength = options.noti.sapMax;
        sap.value = draft.sapShortText || '';
        var sapBox = sap.parentNode;
        sapBox.classList.toggle('hidden', !String(draft.notiNo || '').trim());
        notiNo.addEventListener('input', function () {
          draft.notiNo = notiNo.value;
          var has = Boolean(notiNo.value.trim());
          if (has && !draft.sapShortText) {
            draft.sapShortText = Core.sapShortText(value.title, value.areaName, value.locationDetail, { SAP_SHORTTEXT_MAX: options.noti.sapMax });
            sap.value = draft.sapShortText;
          }
          sapBox.classList.toggle('hidden', !has);
          persist();
        });
        sap.addEventListener('input', function () { draft.sapShortText = sap.value; persist(); });
      }
    }

    var formError = el('p', 'error hidden');
    form.appendChild(formError);
    var nav = el('div', 'toolbar');
    if (step > 1) {
      var back = el('button', '', 'ย้อนกลับ');
      back.type = 'button';
      back.addEventListener('click', function () { showReportStep(me, options, draft, step - 1); });
      nav.appendChild(back);
    }
    var next = el('button', 'primary', step < 4 ? 'ถัดไป' : 'ส่งงาน');
    next.type = 'submit';
    nav.appendChild(next);
    form.appendChild(nav);
    if (buildInfo) form.appendChild(buildInfo);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var result = check();
      if (step < 4) {
        var fields = pickFields(result.fields, STEP_FIELDS[step]);
        showFieldErrors(form, fields);
        if (Object.keys(fields).length) return;
        showReportStep(me, options, draft, step + 1);
        return;
      }
      // ขั้นสุดท้ายตรวจทุกข้อ ถ้าขั้นก่อนหน้ายังขาด พากลับไปขั้นนั้น
      if (!result.ok && goToFirstError(result.fields)) return;
      sendJob(me, options, draft, next, formError);
    });

    main.appendChild(form);

    // แถวสรุป 1 แถวในขั้น 4 พร้อมปุ่ม "แก้" กลับไปขั้นนั้น
    function summary(name, valueNode, backTo) {
      var line = el('div', 'summary');
      var info = el('div', 'summary-info');
      info.appendChild(el('small', 'muted', name));
      info.appendChild(valueNode);
      line.appendChild(info);
      var edit = el('button', 'small', 'แก้');
      edit.type = 'button';
      edit.addEventListener('click', function () { showReportStep(me, options, draft, backTo); });
      line.appendChild(edit);
      return line;
    }

    function goToFirstError(fields) {
      for (var s = 1; s <= 4; s++) {
        var found = pickFields(fields, STEP_FIELDS[s]);
        if (Object.keys(found).length) {
          showReportStep(me, options, draft, s);
          showFieldErrors(document.querySelector('form'), found);
          return true;
        }
      }
      return false;
    }
  }

  // ใบงาน 27: "งานนี้กระทบอะไร" บังคับเลือก · 3 ด้านเลือกได้หลายข้อ · "ไม่กระทบ" เลือกเดี่ยว
  function impactChips(form, draft, persist) {
    var body = group(form, 'impacts', 'งานนี้กระทบอะไร *');
    var row = el('div', 'chips');
    var codes = Object.keys(Core.IMPACT).concat([Core.IMPACT_NONE]);
    function render() {
      row.innerHTML = '';
      codes.forEach(function (code) {
        var chip = el('button', 'chip', code === Core.IMPACT_NONE ? Core.IMPACT_NONE_LABEL : Core.IMPACT[code]);
        chip.type = 'button';
        chip.setAttribute('aria-pressed', String(draft.impacts.indexOf(code) >= 0));
        chip.addEventListener('click', function () {
          var on = draft.impacts.indexOf(code) >= 0;
          if (code === Core.IMPACT_NONE) draft.impacts = on ? [] : [code];
          else {
            draft.impacts = draft.impacts.filter(function (c) { return c !== Core.IMPACT_NONE && c !== code; });
            if (!on) draft.impacts.push(code);
          }
          persist();
          render();
        });
        row.appendChild(chip);
      });
    }
    render();
    body.appendChild(row);
    body.appendChild(el('small', 'muted', 'ไลน์หยุดหรือมีคนเสี่ยงอันตราย โทรแจ้งก่อน แล้วค่อยแจ้งในระบบ'));
  }

  // ป้ายผลกระทบในรายการ (ใบงาน 27): รอประเมิน · ระดับด่วนมาก/ด่วน
  function impactBadges(impact) {
    var box = el('span', 'badges');
    if (!impact) return box;
    if (impact.level === 'URGENT') box.appendChild(badge('ด่วนมาก', 'err'));
    else if (impact.level === 'HIGH') box.appendChild(badge('ด่วน', 'warn'));
    if (impact.pending.length) {
      box.appendChild(badge('รอประเมิน · ' + impact.pending.map(function (c) { return Core.IMPACT[c]; }).join(', '), 'info'));
    }
    return box;
  }

  // เลือกเฉพาะข้อความผิดของช่องที่ระบุ (ข้อผิดของช่อง "อื่น ๆ" แสดงใต้กลุ่มปุ่มที่อยู่ติดกัน)
  function pickFields(fields, names) {
    var out = {};
    names.forEach(function (name) {
      if (fields[name]) out[name] = fields[name];
    });
    return out;
  }

  function sendJob(me, options, draft, button, formError) {
    button.disabled = true;
    button.textContent = 'กำลังส่ง…';
    formError.classList.add('hidden');
    api('createJob', {
      photos: draft.photos,
      asset: draft.asset,
      symptomCode: draft.symptomCode,
      symptomOther: draft.symptomOther,
      areaCode: draft.areaCode,
      areaOther: draft.areaOther,
      locationDetail: draft.locationDetail,
      detail: draft.detail,
      clientRequestId: draft.clientRequestId,
      impacts: draft.impacts,
      // งานแจ้งแทนพร้อมเลข Noti (เฉพาะหัวหน้ากะและแอดมิน backend ตรวจสิทธิ์ซ้ำ)
      notiNo: options.noti ? draft.notiNo : undefined,
      sapShortText: options.noti ? draft.sapShortText : undefined,
    })
      .then(function (res) {
        if (res.ok) {
          clearDraft(me);
          sendConfirmMessage(res.data.jobId);
          showJobSent(me, res.data);
          return;
        }
        formError.textContent = res.error.message;
        formError.classList.remove('hidden');
      })
      .catch(function () {
        formError.textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกด "ส่งงาน" อีกครั้ง ข้อมูลที่กรอกไว้ยังอยู่ครบ';
        formError.classList.remove('hidden');
      })
      .then(function () {
        button.disabled = false;
        button.textContent = 'ส่งงาน';
      });
  }

  // ส่งข้อความ "แจ้งงาน R-xxxx-xxx" เข้าแชทในนามผู้ใช้ แล้ว webhook ตอบกลับเป็นการ์ดยืนยัน (ใบงาน 07)
  // ต้องเป็นข้อความตัวอักษร เพราะ Flex ที่ส่งจาก LIFF ไม่ทำให้เกิด webhook
  // ใช้ได้เฉพาะตอนเปิดแอปจากห้องแชท ส่งไม่ได้ก็ข้ามไปเงียบ ๆ หน้าสำเร็จแสดงเลขงานอยู่แล้ว
  function sendConfirmMessage(jobId) {
    sendChatText('แจ้งงาน ' + jobId);
  }

  // ส่งข้อความตัวอักษรเข้าแชทในนามผู้ใช้ (ใบงาน 07 และ 13) ส่งไม่ได้ก็ข้ามไปเงียบ ๆ
  function sendChatText(text) {
    try {
      if (!liff.isInClient()) return;
      liff.sendMessages([{ type: 'text', text: text }]).catch(function () { /* ข้ามไปเงียบ ๆ */ });
    } catch (e) { /* ข้ามไปเงียบ ๆ */ }
  }

  // หน้าส่งงานสำเร็จ
  function showJobSent(me, job) {
    var main = screen('ส่งงานแล้ว');
    var card = el('section', 'card done');
    card.appendChild(el('div', 'done-mark', '✓'));
    card.appendChild(el('p', 'muted', 'เลขงาน'));
    card.appendChild(el('p', 'job-id', job.jobId));
    card.appendChild(el('p', '', job.title));
    card.appendChild(el('p', 'notice', job.status === 'IN_REPAIR' ? 'เปิด Noti แล้ว งานเข้าคิวรอซ่อมของช่างทันที'
      : 'หัวหน้ากะแผนก' + job.department + ' จะเปิด Noti ใน SAP ให้'));
    var close = el('button', 'primary', 'กลับไปที่แชท');
    close.addEventListener('click', function () { liff.closeWindow(); });
    var again = el('button', '', 'แจ้งงานอีกงาน');
    again.addEventListener('click', function () { showNewJob(me); });
    card.appendChild(close);
    card.appendChild(again);
    main.appendChild(card);
  }

  // ---------- งานของฉัน ----------

  var MY_FILTERS = [
    ['ทั้งหมด', null],
    ['รอเปิด Noti', ['PENDING_NOTI']],
    ['กำลังซ่อม', ['IN_REPAIR']],
    ['เสร็จแล้ว', ['REPAIRED', 'CLOSED']],
  ];

  function showMyJobs(me, filterIndex) {
    loading('งานของฉัน');
    api('listMyJobs')
      .then(function (res) {
        if (!res.ok) return showError(res.error.message);
        renderMyJobs(me, res.data.jobs, filterIndex || 0);
      })
      .catch(function () { showError('โหลดงานของฉันไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
  }

  function renderMyJobs(me, jobs, filterIndex) {
    var main = screen('งานของฉัน');
    var bar = el('div', 'chips filters');
    MY_FILTERS.forEach(function (filter, index) {
      var count = jobs.filter(function (j) { return !filter[1] || filter[1].indexOf(j.status) >= 0; }).length;
      var chip = el('button', 'chip', filter[0] + ' ' + count);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(index === filterIndex));
      chip.addEventListener('click', function () { renderMyJobs(me, jobs, index); });
      bar.appendChild(chip);
    });
    main.appendChild(bar);

    var statuses = MY_FILTERS[filterIndex][1];
    var shown = jobs.filter(function (j) { return !statuses || statuses.indexOf(j.status) >= 0; });
    var card = el('section', 'card');
    if (!jobs.length) card.appendChild(el('p', 'muted', 'ยังไม่เคยแจ้งงาน กด "แจ้งงานใหม่" ที่เมนูในแชทเพื่อเริ่ม'));
    else if (!shown.length) card.appendChild(el('p', 'muted', 'ไม่มีงานในกลุ่มนี้'));
    shown.forEach(function (job) {
      var item = el('button', 'job');
      item.type = 'button';
      item.addEventListener('click', function () {
        showJob(me, job.jobId, { label: '‹ งานของฉัน', go: function () { showMyJobs(me, filterIndex); } });
      });
      var label = Core.JOB_STATUS_LABEL[job.status] || [job.status, 'off'];
      var head = el('div', 'job-head');
      head.appendChild(badge(label[0], label[1]));
      head.appendChild(el('small', 'muted', job.jobId));
      item.appendChild(head);
      item.appendChild(el('strong', '', job.title));
      item.appendChild(el('small', 'muted', [job.areaName, job.locationDetail].filter(Boolean).join(' · ')));
      item.appendChild(el('small', 'muted', 'แจ้งเมื่อ ' + shortTime(job.createdAt)));
      if (job.followUp) item.appendChild(followUpBadges(job.followUp));
      if (job.impact) item.appendChild(impactBadges(job.impact));
      // ใบงาน 29: ช่างซ่อมเสร็จแล้ว รอผู้แจ้งไปดูแล้วกดยืนยัน
      if (job.needsConfirm) item.appendChild(badge('ซ่อมเสร็จ รอคุณยืนยัน', 'warn'));
      card.appendChild(item);
    });
    main.appendChild(card);
  }

  // ---------- รายละเอียดงาน (ใบงาน 08 · docs/design/UI.md หัวข้อ "หน้ารายละเอียดงาน") ----------

  // ชื่อการกระทำในประวัติ (Action ในชีต StatusLog ตาม SPEC)
  var ACTION_LABEL = {
    CREATE: 'แจ้งงาน',
    EDIT: 'แก้ไขงาน',
    ADD_NOTI: 'เปิด Noti',
    CANCEL: 'ยกเลิกงาน',
    CLOSE_NO_NOTI: 'แก้เสร็จหน้างาน',
    REPAIRED: 'ซ่อมเสร็จ',
    CLOSE: 'ปิดงาน',
    SEND_BACK: 'ส่งกลับให้ช่าง',
    FOLLOW_UP: 'บันทึกการตาม',
    CONFIRM: 'ผู้แจ้งยืนยันว่าหายแล้ว',
    NOT_FIXED: 'ผู้แจ้งแจ้งว่ายังไม่หาย',
    SELF_FIX: 'ผู้แจ้งแก้เอง',
    IMPACT: 'ติ๊กผลกระทบ',
    ASSESS: 'ประเมินความเร่งด่วน',
  };

  // nav คือหน้าที่เปิดมา { label, go(notice) } ใช้ทำปุ่มย้อนกลับ (ไม่มีถ้าเปิดจากลิงก์ตรง)
  function showJob(me, jobId, nav, notice) {
    loading('รายละเอียดงาน');
    api('jobDetail', { jobId: jobId })
      .then(function (res) {
        if (!res.ok) return showError(res.error.message);
        renderJob(me, res.data, nav, notice);
      })
      .catch(function () { showError('โหลดรายละเอียดงานไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
  }

  // ปุ่มย้อนกลับด้านบนของหน้า
  function backButton(main, nav) {
    if (!nav) return;
    var back = el('button', 'small back', nav.label);
    back.type = 'button';
    back.addEventListener('click', function () { nav.go(); });
    main.appendChild(back);
  }

  // ป้ายสถานะ + ป้ายค้าง (หน้ารายละเอียด) งานที่ถูกส่งกลับใช้ป้ายส้ม "ส่งกลับ" แทน "กำลังซ่อม"
  function statusBadges(status, overdue, sentBack) {
    var box = el('span', 'badges');
    var label = Core.JOB_STATUS_LABEL[status] || [status, 'off'];
    box.appendChild(sentBack ? badge('ส่งกลับ', 'back') : badge(label[0], label[1]));
    if (overdue && overdue.overdue) box.appendChild(badge('ค้างเกิน ' + overdue.limit, 'err'));
    return box;
  }

  // ข้อความนำหน้าเหตุผลที่ส่งกลับ: ผู้แจ้งบอกว่ายังไม่หาย (ใบงาน 29) · งานแก้เองที่ถูกส่งกลับ (ใบงาน 25) · หัวหน้ากะส่งกลับให้ช่าง
  function sentBackText(data) {
    if (data.sentBack.byReporter) return 'ผู้แจ้งบอกว่ายังไม่หาย: ';
    return data.job.status === 'PENDING_NOTI' ? 'หัวหน้ากะส่งกลับ: ' : 'ส่งกลับให้ช่าง: ';
  }

  // ป้ายการยืนยันในคิวรอปิด (ใบงาน 25, 29)
  function confirmBadge(job) {
    if (job.selfFix) return badge('ผู้แจ้งแก้เอง · ไม่มี Noti', 'off');
    if (job.reporterConfirm === 'CONFIRMED') return badge('ผู้แจ้งยืนยันแล้ว', 'ok');
    if (job.reporterConfirm === 'WAITING') return badge('รอผู้แจ้งยืนยัน', 'info');
    if (job.reporterConfirm === 'LATE') return badge('ผู้แจ้งยังไม่ยืนยัน', 'warn');
    return null;
  }

  // ป้ายเดียวของงานในรายการ: ค้าง > ส่งกลับ > สถานะ
  function listBadge(job, short) {
    if (job.overdue) return badge(short ? 'ค้าง' : 'ค้างเกิน ' + job.overdueLimit, 'err');
    if (job.sentBack) return badge('ส่งกลับ', 'back');
    var label = Core.JOB_STATUS_LABEL[job.status] || [job.status, 'off'];
    return badge(label[0], label[1]);
  }

  // ---------- บันทึกการตาม (ใบงาน 21) ----------

  // วันนัดแบบสั้น 2026-11-08 → "8/11"
  function dayMonth(date) {
    var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(date || ''));
    return m ? Number(m[2]) + '/' + Number(m[1]) : '';
  }

  // ป้ายการตามในรายการ: มีคำตอบ = "เหตุผล · นัด 8/11" · รอคำตอบ = ป้ายแดง
  function followUpBadges(followUp) {
    var box = el('span', 'badges');
    if (followUp.state === 'AWAITING') box.appendChild(badge('รอคำตอบ', 'err'));
    else if (followUp.state === 'ANSWERED') box.appendChild(badge(followUp.reason + ' · นัด ' + dayMonth(followUp.nextDate), 'off'));
    return box;
  }

  // กล่องบันทึกการตามในหน้ารายละเอียด (งานกำลังซ่อม): บันทึกล่าสุด หรือบอกว่ารอคำตอบ + ปุ่มบันทึก (ช่าง Planner แอดมิน)
  function followUpCard(me, data, self) {
    var f = data.followUp;
    var canRecord = data.actions && data.actions.followUp;
    if (!f || (!f.state && !f.last && !canRecord)) return null;
    var card = el('section', 'card');
    var head = el('div', 'job-head');
    head.appendChild(el('h2', 'card-title', 'บันทึกการตาม'));
    if (f.state) head.appendChild(followUpBadges({ state: f.state, reason: 'มีคำตอบ', nextDate: f.last && f.last.nextDate }));
    card.appendChild(head);
    if (f.last) {
      card.appendChild(row('ช้าเพราะ', el('span', '', f.last.reason)));
      card.appendChild(row('นัดตาม', el('span', '', dayMonth(f.last.nextDate) + (f.state === 'AWAITING' ? ' (ถึงวันนัดแล้ว)' : ''))));
      if (f.last.note) card.appendChild(el('p', 'notice', f.last.note));
      card.appendChild(el('small', 'muted', 'บันทึกโดย ' + (f.last.by || '-') + ' · ' + shortTime(f.last.at)));
    } else if (f.state === 'AWAITING') {
      card.appendChild(el('p', 'muted', 'งานค้างแล้ว ยังไม่มีใครบอกว่าช้าเพราะอะไร'));
    } else {
      card.appendChild(el('p', 'muted', 'ถ้างานนี้ต้องรอ บอกเหตุผลและวันนัดตาม ให้หัวหน้ากะและผู้แจ้งรู้'));
    }
    if (canRecord) {
      card.appendChild(actionButton(f.state === 'AWAITING' ? 'primary' : '', f.last ? 'บันทึกการตามใหม่' : 'บันทึกการตาม',
        function () { showFollowUp(me, data, self); }));
    }
    return card;
  }

  // ฟอร์มบันทึกการตาม: เหตุผล (ปุ่มเลือก "อื่น ๆ" ต้องพิมพ์) + หมายเหตุ + วันนัด (ปุ่มลัด หรือเลือกวัน ไม่เกิน 30 วัน)
  function showFollowUp(me, data, nav) {
    var job = data.job;
    var opts = data.followUpForm;
    var main = screen('บันทึกการตาม');
    backButton(main, nav);
    main.appendChild(jobSummary(me, data, nav));
    var form = el('form', 'card');
    form.noValidate = true;
    form.appendChild(el('h1', '', 'บันทึกการตาม'));
    form.appendChild(el('p', 'notice', 'บอกหัวหน้ากะและผู้แจ้งว่าช้าเพราะอะไร และจะตามอีกครั้งวันไหน งานยังนับค้างตามเดิม'));

    var box = el('fieldset', 'field');
    box.dataset.field = 'reason';
    box.appendChild(el('legend', '', 'ช้าเพราะ *'));
    opts.reasons.forEach(function (r) {
      var option = el('label', 'choice');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'reason';
      radio.value = r.code;
      option.appendChild(radio);
      option.appendChild(el('span', '', r.label));
      box.appendChild(option);
    });
    box.appendChild(el('small', 'field-error'));
    form.appendChild(box);

    var noteValue = '';
    var note = textArea(form, 'note', 'หมายเหตุ (ไม่บังคับ)', 'เช่น สั่งซีลแล้ว ของเข้าวันพฤหัส', '', function (text) { noteValue = text; });
    var noteLabel = note.parentNode.querySelector('label');
    box.addEventListener('change', function () {
      var picked = form.querySelector('input[name="reason"]:checked');
      noteLabel.textContent = picked && picked.value === Core.OTHER ? 'รออะไร *' : 'หมายเหตุ (ไม่บังคับ)';
    });

    var dateBody = group(form, 'nextDate', 'นัดตามอีกครั้ง *');
    var date = input('date', '');
    date.min = opts.minDate;
    date.max = opts.maxDate;
    var shortcuts = [['พรุ่งนี้', 0], ['อีก 3 วัน', 2], ['อีก 7 วัน', 6]].map(function (s) {
      return { text: s[0], date: Core.addDays(opts.minDate, s[1]) };
    });
    var bar = el('div', 'chips');
    function mark() {
      Array.prototype.forEach.call(bar.childNodes, function (chip, i) {
        chip.setAttribute('aria-pressed', String(shortcuts[i] && shortcuts[i].date === date.value));
      });
    }
    shortcuts.forEach(function (s) {
      var chip = el('button', 'chip', s.text);
      chip.type = 'button';
      chip.addEventListener('click', function () { date.value = s.date; mark(); });
      bar.appendChild(chip);
    });
    dateBody.appendChild(bar);
    dateBody.appendChild(el('small', 'muted', 'หรือเลือกวัน (ไกลสุด 30 วัน ถ้ารอนานกว่านั้น บันทึกใหม่เมื่อถึงวันนัด)'));
    dateBody.appendChild(date);
    date.addEventListener('change', mark);
    date.addEventListener('input', mark);

    var error = el('p', 'error hidden');
    form.appendChild(error);
    var submit = el('button', 'primary', 'บันทึกการตาม');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var picked = form.querySelector('input[name="reason"]:checked');
      var payload = { jobId: job.jobId, reason: picked ? picked.value : '', note: noteValue.trim(), nextDate: date.value };
      var fields = {};
      if (!payload.reason) fields.reason = 'กรุณาเลือกเหตุผลที่ช้า';
      if (payload.reason === Core.OTHER && !payload.note) fields.note = 'กรุณาบอกว่ารออะไร';
      if (!payload.nextDate) fields.nextDate = 'กรุณาเลือกวันนัดตาม';
      else if (payload.nextDate < opts.minDate || payload.nextDate > opts.maxDate) fields.nextDate = 'เลือกวันพรุ่งนี้ถึงอีก 30 วัน';
      showFieldErrors(form, fields);
      if (Object.keys(fields).length) return;
      submit.disabled = true;
      submit.textContent = 'กำลังบันทึก…';
      error.classList.add('hidden');
      api('addFollowUp', payload)
        .then(function (res) {
          if (res.ok) return nav.go('บันทึกการตามแล้ว · นัดตาม ' + dayMonth(payload.nextDate));
          if (res.error.details && res.error.details.fields) showFieldErrors(form, res.error.details.fields);
          error.textContent = res.error.message;
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'บันทึกการตาม';
        })
        .catch(function () {
          error.textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดอีกครั้ง';
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'บันทึกการตาม';
        });
    });
    main.appendChild(form);
  }

  function renderJob(me, data, nav, notice) {
    var job = data.job;
    var main = screen('รายละเอียดงาน');
    backButton(main, nav);
    if (notice) main.appendChild(el('p', 'success', notice));
    // หน้านี้ในฐานะหน้าที่กลับมาได้ (จากฟอร์มแก้ เปิด Noti ยกเลิก ฯลฯ)
    var self = { label: '‹ รายละเอียดงาน', go: function (n) { showJob(me, job.jobId, nav, n); } };

    var card = el('section', 'card');
    var head = el('div', 'job-head');
    head.appendChild(statusBadges(job.status, data.overdue, data.sentBack));
    head.appendChild(el('small', 'muted', job.jobId));
    card.appendChild(head);
    card.appendChild(el('h1', '', job.title));
    card.appendChild(row('พื้นที่', el('span', '', [job.areaName, job.locationDetail].filter(Boolean).join(' · '))));
    card.appendChild(row('อาการ', el('span', '', job.symptom)));
    card.appendChild(row('แจ้งโดย', el('span', '', [data.reporter.name, data.reporter.department].filter(Boolean).join(' · '))));
    card.appendChild(row('แจ้งเมื่อ', el('span', '', shortTime(job.createdAt) + ' · แจ้งมา ' + Core.ageText(job.createdAt, data.now))));
    if (job.notiNo) card.appendChild(row('เลข Noti', el('span', 'mono', Core.formatNoti(job.notiNo))));
    if (job.sapShortText) card.appendChild(row('ชื่องาน SAP', el('span', '', job.sapShortText)));
    if (job.cancelReason) card.appendChild(row('เหตุผลที่ยกเลิก', el('span', '', job.cancelReason)));
    if (job.closedWithoutNoti) card.appendChild(row('ปิดงาน', el('span', '', 'แก้เสร็จหน้างาน ไม่เปิด Noti')));
    if (job.detail) card.appendChild(el('p', 'notice', job.detail));
    if (data.sentBack) card.appendChild(el('p', 'sent-back', sentBackText(data) + data.sentBack.note));
    main.appendChild(card);
    var follow = followUpCard(me, data, self);
    if (follow) main.appendChild(follow);
    var confirmCard = reporterConfirmCard(me, data, self);
    if (confirmCard) main.appendChild(confirmCard);
    var impact = impactCard(me, data, self);
    if (impact) main.appendChild(impact);

    // รูปก่อนซ่อม (และหลังซ่อมรอบล่าสุดถ้ามี) วางคู่กัน แตะรูปดูเต็มจอ
    var photos = el('section', 'card');
    var after = data.photos.after;
    var afterTitle = job.closedWithoutNoti ? 'รูปหลังแก้' : data.photos.afterRounds > 1 ? 'หลังซ่อม รอบ ' + data.photos.afterRounds : 'รูปหลังซ่อม';
    var pair = el('div', after.length ? 'photo-pair' : '');
    pair.appendChild(photoGroup(job.jobId, 'รูปอาการ', data.photos.before));
    if (after.length) pair.appendChild(photoGroup(job.jobId, afterTitle, after));
    photos.appendChild(pair);
    if (job.repairNote) photos.appendChild(row(job.closedWithoutNoti ? 'แก้อะไรไป' : 'บันทึกของช่าง', el('span', '', job.repairNote)));
    main.appendChild(photos);

    var history = el('section', 'card');
    history.appendChild(el('h2', 'card-title', 'ประวัติ'));
    data.history.forEach(function (h) {
      var item = el('div', 'history');
      var text = (ACTION_LABEL[h.action] || h.action);
      var to = Core.JOB_STATUS_LABEL[h.toStatus];
      // ต่อท้ายสถานะใหม่เฉพาะเมื่อชื่อการกระทำยังไม่บอก (เช่น "เปิด Noti → กำลังซ่อม" แต่ไม่ใช่ "ซ่อมเสร็จ → ซ่อมเสร็จ")
      var obvious = ['EDIT', 'FOLLOW_UP', 'CONFIRM', 'IMPACT', 'ASSESS'].indexOf(h.action) >= 0 || (h.action === 'CREATE' && h.toStatus === 'PENDING_NOTI');
      if (to && !obvious && text.indexOf(to[0]) < 0) text += ' → ' + to[0];
      item.appendChild(el('strong', '', text));
      item.appendChild(el('small', 'muted', shortTime(h.at) + (h.by ? ' · ' + h.by : '')));
      if (h.note) item.appendChild(el('small', '', h.note));
      history.appendChild(item);
    });
    if (!data.history.length) history.appendChild(el('p', 'muted', 'ยังไม่มีประวัติ'));
    main.appendChild(history);

    // ปุ่มตามโรลและสถานะ (docs/design/UI.md ตารางหน้ารายละเอียดงาน) backend ตรวจสิทธิ์ซ้ำทุกคำสั่ง
    var a = data.actions || {};
    var actions = el('section', 'actions');
    // ปุ่มโทรหาผู้แจ้ง: backend ส่งเบอร์มาเฉพาะหัวหน้ากะ ช่าง และแอดมิน
    if (data.reporter.phone) {
      var call = el('a', 'button-link', 'โทรหาผู้แจ้ง');
      call.href = 'tel:' + data.reporter.phone;
      actions.appendChild(call);
    }
    if (data.edit && data.edit.allowed) {
      actions.appendChild(actionButton('', 'แก้ไข' + (data.edit.hoursLeft ? ' (เหลือ ' + data.edit.hoursLeft + ' ชม.)' : ''),
        function () { showEditJob(me, data, self); }));
    }
    if (a.addNoti) actions.appendChild(actionButton('primary', 'เปิด Noti', function () { showNotiForm(me, data, self); }));
    if (a.fixOnSite) actions.appendChild(actionButton('', 'แก้เสร็จหน้างานแล้ว', function () { showFixOnSite(me, data, self); }));
    if (a.repair) actions.appendChild(actionButton('primary', 'แนบรูปหลังซ่อม', function () { showAfterRepair(me, data, self); }));
    if (a.selfFix) actions.appendChild(actionButton('', 'แก้เองแล้ว', function () { showSelfFix(me, data, self); }));
    if (a.close) closeControls(me, data, actions, self);
    if (a.cancel) actions.appendChild(actionButton('danger', 'ยกเลิกงาน', function () { showCancel(me, data, self); }));
    if (actions.childNodes.length) main.appendChild(actions);
  }

  function actionButton(kind, label, onClick) {
    var b = el('button', kind, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // ปิดงาน (ใบงาน 14): ต้องติ๊ก "ยืนยันว่าซ่อมเสร็จจริง" ก่อน กดโดยไม่ติ๊กขึ้นข้อความเตือน ไม่ปิดปุ่มเป็นสีเทา
  // หลักการปิดงาน (30 ต.ค. 2026): หัวหน้ากะตรวจด้วยวิธีไหนก็ได้ (ไปดูเอง ดูรูป หรือดูที่ผู้แจ้งยืนยัน) และรับผิดชอบคำยืนยัน
  function closeControls(me, data, actions, self) {
    var job = data.job;
    var box = el('div', 'field');
    box.dataset.field = 'checked';
    var label = el('label', 'choice');
    var tick = document.createElement('input');
    tick.type = 'checkbox';
    label.appendChild(tick);
    label.appendChild(el('span', '', 'ยืนยันว่าซ่อมเสร็จจริง'));
    box.appendChild(label);
    var warn = el('small', 'field-error');
    box.appendChild(warn);
    actions.appendChild(box);
    var close = actionButton('primary', 'ปิดงาน', function () {
      if (!tick.checked) { warn.textContent = 'ติ๊ก "ยืนยันว่าซ่อมเสร็จจริง" ก่อนปิดงาน'; return; }
      warn.textContent = '';
      close.disabled = true;
      close.textContent = 'กำลังปิดงาน…';
      api('closeJob', { jobId: job.jobId, checked: true })
        .then(function (res) {
          if (!res.ok) { warn.textContent = res.error.message; close.disabled = false; close.textContent = 'ปิดงาน'; return; }
          showQueue(me, 'close', 'ปิดงาน ' + job.jobId + ' แล้ว');
        })
        .catch(function () {
          warn.textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดอีกครั้ง';
          close.disabled = false;
          close.textContent = 'ปิดงาน';
        });
    });
    tick.addEventListener('change', function () { if (tick.checked) warn.textContent = ''; });
    actions.appendChild(close);
    actions.appendChild(actionButton('', 'ส่งกลับให้ช่าง', function () { showSendBack(me, data, self); }));
  }

  // หัวการ์ดงานในหน้าฟอร์ม (เปิด Noti แก้เสร็จหน้างาน ยกเลิก แนบรูปหลังซ่อม ส่งกลับ): ชื่องาน ที่อยู่ ผู้แจ้ง รูปอาการรูปแรก
  function jobSummary(me, data, nav) {
    var job = data.job;
    var card = el('section', 'card');
    var head = el('div', 'job-head');
    head.appendChild(statusBadges(job.status, data.overdue, data.sentBack));
    head.appendChild(el('small', 'muted', job.jobId));
    card.appendChild(head);
    var line = el('div', 'qcard static');
    if (data.photos.before.length) line.appendChild(thumbImage(job.jobId, data.photos.before[0], true));
    var info = el('div', 'qinfo');
    info.appendChild(el('strong', '', job.title));
    info.appendChild(el('small', 'muted', [job.areaName, job.locationDetail, job.notiNo ? 'Noti ' + Core.formatNoti(job.notiNo) : ''].filter(Boolean).join(' · ')));
    info.appendChild(el('small', 'muted', [data.reporter.name, 'แจ้งมา ' + Core.ageText(job.createdAt, data.now)].filter(Boolean).join(' · ')));
    line.appendChild(info);
    card.appendChild(line);
    if (data.sentBack) card.appendChild(el('p', 'sent-back', sentBackText(data) + data.sentBack.note));
    var tools = el('div', 'toolbar');
    if (data.reporter.phone) {
      var call = el('a', 'button-link small', 'โทรหาผู้แจ้ง');
      call.href = 'tel:' + data.reporter.phone;
      tools.appendChild(call);
    }
    var more = el('button', 'small', 'ดูรายละเอียด');
    more.type = 'button';
    more.addEventListener('click', function () { showJob(me, job.jobId, nav); });
    tools.appendChild(more);
    card.appendChild(tools);
    return card;
  }

  // ---------- แก้งาน (ใบงาน 09) ----------

  function showEditJob(me, data, nav) {
    loading('แก้ไขงาน');
    api('reportOptions')
      .then(function (res) {
        if (!res.ok) return showError(res.error.message);
        var job = data.job;
        var options = res.data;
        // พื้นที่และอาการเดิมที่ปิดใช้ไปแล้วต้องมีปุ่มให้เลือกค้างไว้ (backend ยอมรับค่าเดิมของงาน)
        var hasArea = options.areas.some(function (a) { return a.code === job.areaCode; });
        if (job.areaCode && job.areaCode !== Core.OTHER && !hasArea) options.areas = options.areas.concat([{ code: job.areaCode, name: job.areaName }]);
        var hasSymptom = options.symptoms.some(function (x) { return x.code === job.symptomCode; });
        if (job.symptomCode && job.symptomCode !== Core.OTHER && !hasSymptom) options.symptoms = options.symptoms.concat([{ code: job.symptomCode, label: job.symptom }]);
        var state = {
          asset: job.asset, symptomCode: job.symptomCode, symptomOther: job.symptomOther,
          areaCode: job.areaCode, areaOther: job.areaOther, locationDetail: job.locationDetail, detail: job.detail,
        };
        renderEditJob(me, data, options, state, nav);
      })
      .catch(function () { showError('โหลดหน้าแก้ไขไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
  }

  function renderEditJob(me, data, options, state, nav, fields) {
    var job = data.job;
    var main = screen('แก้ไขงาน');
    backButton(main, nav);
    var rerender = function () { renderEditJob(me, data, options, state, nav); };
    var nothing = function () {};
    var check = function () {
      var r = Core.validateJob(state, options);
      delete r.fields.photos;
      r.ok = Object.keys(r.fields).length === 0;
      return r;
    };
    var form = el('form', 'card');
    form.noValidate = true;
    form.appendChild(el('h1', '', 'แก้ไข ' + job.jobId));
    form.appendChild(el('p', 'muted', 'แก้รูปไม่ได้ ถ้ารูปผิด ให้หัวหน้ากะยกเลิกงาน (แจ้งผิด) แล้วแจ้งใหม่'));
    var title = el('p', 'notice');
    var showTitle = function () { title.textContent = 'ชื่องาน: ' + (check().value.title || '-'); };
    var asset = textField(form, nothing, state, 'asset', 'asset', 'อะไรเสีย', 'เช่น ปั๊มน้ำ สายพาน', showTitle);
    suggestions(asset, options.assetSuggestions || []);
    var symptoms = group(form, 'symptom', 'เกิดอะไรขึ้น *');
    chips(symptoms, options.symptoms.map(function (x) { return { code: x.code, text: x.label }; }), state.symptomCode,
      function (code) { state.symptomCode = code; rerender(); });
    if (state.symptomCode === Core.OTHER) {
      textField(form, nothing, state, 'symptomOther', 'symptomOther', 'พิมพ์อาการ', 'เช่น มีกลิ่นไหม้', showTitle);
    }
    form.appendChild(title);
    showTitle();
    var areas = group(form, 'area', 'พื้นที่ *');
    chips(areas, options.areas.map(function (a) { return { code: a.code, text: a.name }; }), state.areaCode,
      function (code) { state.areaCode = code; rerender(); });
    if (state.areaCode === Core.OTHER) textField(form, nothing, state, 'areaOther', 'areaOther', 'พิมพ์ชื่อพื้นที่', 'เช่น โรงซ่อมบำรุง');
    var spot = textField(form, nothing, state, 'locationDetail', 'locationDetail', 'ตรงไหน', 'เช่น ชั้น 2 ข้างลิฟต์');
    suggestions(spot, (options.locationSuggestions || {})[state.areaCode] || []);
    textArea(form, 'detail', 'รายละเอียดเพิ่มเติม (ไม่บังคับ)', 'เช่น เริ่มรั่วตั้งแต่เช้า', state.detail, function (text) { state.detail = text; });
    var formError = el('p', 'error hidden');
    form.appendChild(formError);
    var tools = el('div', 'toolbar');
    tools.appendChild(actionButton('', 'ยกเลิก', function () { nav.go(); }));
    var save = el('button', 'primary', 'บันทึก');
    save.type = 'submit';
    tools.appendChild(save);
    form.appendChild(tools);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var result = check();
      showFieldErrors(form, result.fields);
      if (!result.ok) return;
      save.disabled = true;
      save.textContent = 'กำลังบันทึก…';
      formError.classList.add('hidden');
      api('editJob', Object.assign({ jobId: job.jobId }, state))
        .then(function (res) {
          if (res.ok) return nav.go(res.data.changed ? 'บันทึกการแก้ไขแล้ว' : 'ไม่มีอะไรเปลี่ยน');
          if (res.error.details && res.error.details.fields) showFieldErrors(form, res.error.details.fields);
          formError.textContent = res.error.message;
          formError.classList.remove('hidden');
          save.disabled = false;
          save.textContent = 'บันทึก';
        })
        .catch(function () {
          formError.textContent = 'บันทึกไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดอีกครั้ง';
          formError.classList.remove('hidden');
          save.disabled = false;
          save.textContent = 'บันทึก';
        });
    });
    main.appendChild(form);
    if (fields) showFieldErrors(form, fields);
  }

  // ---------- เปิด Noti (ใบงาน 10) ----------

  // เปิดฟอร์มกรอกเลข Noti จากคิว (โหลดรายละเอียดงานก่อน) ถ้างานนี้กรอกไม่ได้แล้ว แสดงรายละเอียดแทน
  function openNotiForm(me, jobId, nav, notice) {
    loading('กรอกเลข Noti');
    api('jobDetail', { jobId: jobId })
      .then(function (res) {
        if (!res.ok) return showError(res.error.message);
        if (res.data.noti) showNotiForm(me, res.data, nav, notice);
        else renderJob(me, res.data, nav, notice);
      })
      .catch(function () { showError('โหลดงานไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
  }

  // values = { notiNo, sapShortText } ค่าที่กรอกไว้ (กลับมาแก้จากหน้ายืนยันแล้วไม่หาย)
  function showNotiForm(me, data, nav, notice, values, fields) {
    var job = data.job;
    var noti = data.noti;
    values = values || { notiNo: '', sapShortText: noti.sapDefault };
    var main = screen('กรอกเลข Noti');
    backButton(main, nav);
    if (notice) main.appendChild(el('p', 'success', notice));
    // ปุ่มแก้เสร็จหน้างานและยกเลิกจากหน้านี้ ทำเสร็จแล้วไปงานถัดไปในคิว
    var self = { label: '‹ กรอกเลข Noti', queue: 'noti', go: function (n) { showNotiForm(me, data, nav, n, values); } };
    main.appendChild(jobSummary(me, data, self));

    var form = el('form', 'card');
    form.noValidate = true;
    var number = field(form, 'notiNo', 'เลข Noti (' + noti.digits + ' หลัก)', input('text', ''));
    number.inputMode = 'numeric';
    number.autocomplete = 'off';
    number.className = 'mono big-input';
    number.value = values.notiNo;
    number.addEventListener('input', function () { values.notiNo = number.value; });
    var sap = field(form, 'sapShortText', 'ชื่องาน SAP (เติมให้แล้ว แก้ได้)', input('text', ''));
    sap.maxLength = noti.sapMax;
    sap.value = values.sapShortText;
    var counter = el('small', 'hint', '');
    var count = function () { counter.textContent = sap.value.length + '/' + noti.sapMax + ' ตัวอักษร'; };
    sap.addEventListener('input', function () { values.sapShortText = sap.value; count(); });
    sap.parentNode.insertBefore(counter, sap.nextSibling);
    count();
    var next = el('button', 'primary', 'ถัดไป');
    next.type = 'submit';
    form.appendChild(next);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var result = Core.validateNoti(values, { NOTI_DIGITS: noti.digits, SAP_SHORTTEXT_MAX: noti.sapMax });
      showFieldErrors(form, result.fields);
      if (result.ok) showNotiConfirm(me, data, nav, result.value);
    });
    main.appendChild(form);
    if (fields) showFieldErrors(form, fields);

    var others = el('section', 'actions');
    if (data.actions.fixOnSite) others.appendChild(actionButton('', 'แก้เสร็จหน้างานแล้ว', function () { showFixOnSite(me, data, self); }));
    if (data.actions.cancel) others.appendChild(actionButton('danger', 'ยกเลิกงานนี้', function () { showCancel(me, data, self); }));
    if (others.childNodes.length) main.appendChild(others);
  }

  // หน้ายืนยันเลข Noti ตัวใหญ่ แบ่งทีละ 4 หลัก ให้เทียบกับหน้าจอ SAP ก่อนบันทึก
  function showNotiConfirm(me, data, nav, values) {
    var job = data.job;
    var main = screen('ยืนยันเลข Noti');
    var card = el('section', 'card done');
    card.appendChild(el('h1', '', 'ยืนยันเลข Noti'));
    card.appendChild(el('p', 'muted', 'เทียบกับหน้าจอ SAP ให้ตรงกัน'));
    card.appendChild(el('p', 'noti-big', Core.formatNoti(values.notiNo)));
    card.appendChild(el('p', '', values.sapShortText));
    card.appendChild(el('p', 'muted', job.jobId + ' · ' + job.title));
    var error = el('p', 'error hidden');
    var save = actionButton('primary', 'บันทึก แล้วไปงานถัดไป', function () {
      save.disabled = true;
      save.textContent = 'กำลังบันทึก…';
      error.classList.add('hidden');
      api('addNoti', { jobId: job.jobId, notiNo: values.notiNo, sapShortText: values.sapShortText })
        .then(function (res) {
          if (res.ok) return goToNextNoti(me, 'บันทึก Noti ' + Core.formatNoti(values.notiNo) + ' ของ ' + job.jobId + ' แล้ว');
          if (res.error.details && res.error.details.fields) return showNotiForm(me, data, nav, null, values, res.error.details.fields);
          error.textContent = res.error.message;
          error.classList.remove('hidden');
          save.disabled = false;
          save.textContent = 'บันทึก แล้วไปงานถัดไป';
        })
        .catch(function () {
          error.textContent = 'บันทึกไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดอีกครั้ง';
          error.classList.remove('hidden');
          save.disabled = false;
          save.textContent = 'บันทึก แล้วไปงานถัดไป';
        });
    });
    card.appendChild(save);
    card.appendChild(actionButton('', 'กลับไปแก้', function () { showNotiForm(me, data, nav, null, values); }));
    card.appendChild(error);
    main.appendChild(card);
  }

  // หลังบันทึก ไปงานถัดไปในคิวรอเปิด Noti ทันที (เก่าสุดก่อน) ไม่มีงานเหลือแสดงคิวว่าง
  function goToNextNoti(me, notice) {
    loading('รอเปิด Noti');
    var queueNav = { label: '‹ รอเปิด Noti', go: function (n) { showQueue(me, 'noti', n); } };
    api('listJobs', { view: 'noti' })
      .then(function (res) {
        if (!res.ok) return showError(res.error.message);
        if (!res.data.jobs.length) return renderQueue(me, 'noti', res.data, notice + ' · ไม่มีงานรอเปิด Noti แล้ว');
        openNotiForm(me, res.data.jobs[0].jobId, queueNav, notice + ' · งานถัดไป');
      })
      .catch(function () { showError('โหลดคิวไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
  }

  // ทำเสร็จแล้วกลับไปไหน: มาจากฟอร์มเปิด Noti (คิว) ไปงานถัดไป · มาจากรายละเอียดงานกลับไปหน้ารายละเอียด
  function afterDone(me, nav, notice) {
    if (nav && nav.queue === 'noti') return goToNextNoti(me, notice);
    if (nav) return nav.go(notice);
    showStatus(me, notice);
  }

  // ---------- ยกเลิกงาน (ใบงาน 11) ----------

  function showCancel(me, data, nav) {
    var job = data.job;
    var reasons = data.actions.cancelReasons || [];
    var main = screen('ยกเลิกงาน');
    backButton(main, nav);
    main.appendChild(jobSummary(me, data, nav));
    var form = el('form', 'card');
    form.noValidate = true;
    form.appendChild(el('h1', '', 'ยกเลิกงาน'));
    var box = el('fieldset', 'field');
    box.dataset.field = 'reason';
    box.appendChild(el('legend', '', 'เหตุผล *'));
    reasons.forEach(function (code) {
      var option = el('label', 'choice');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'reason';
      radio.value = code;
      option.appendChild(radio);
      option.appendChild(el('span', '', Core.CANCEL_REASON[code]));
      box.appendChild(option);
    });
    box.appendChild(el('small', 'field-error'));
    form.appendChild(box);
    var ref = field(form, 'refJobId', 'เลขงานที่ซ้ำ', input('text', 'เช่น R-2610-009'));
    ref.autocapitalize = 'characters';
    var refBox = ref.parentNode;
    refBox.classList.add('hidden');
    var noteValue = '';
    var note = textArea(form, 'note', 'หมายเหตุ (ไม่บังคับ)', 'เช่น แจ้งซ้ำกับกะเช้า', '', function (text) { noteValue = text; });
    var noteLabel = note.parentNode.querySelector('label');
    if (data.actions.fixOnSite) form.appendChild(el('p', 'notice', 'ถ้าแก้เสร็จหน้างานแล้ว ไม่ต้องยกเลิก ใช้ปุ่ม "แก้เสร็จหน้างานแล้ว" แทน'));
    box.addEventListener('change', function () {
      var picked = form.querySelector('input[name="reason"]:checked');
      var code = picked ? picked.value : '';
      refBox.classList.toggle('hidden', code !== 'DUPLICATE');
      noteLabel.textContent = code === 'OTHER' ? 'เหตุผล *' : 'หมายเหตุ (ไม่บังคับ)';
    });
    var error = el('p', 'error hidden');
    form.appendChild(error);
    var submit = el('button', 'danger', 'ยกเลิกงาน');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var picked = form.querySelector('input[name="reason"]:checked');
      var payload = { jobId: job.jobId, reason: picked ? picked.value : '', refJobId: ref.value.trim().toUpperCase(), note: noteValue.trim() };
      var fields = {};
      if (!payload.reason) fields.reason = 'กรุณาเลือกเหตุผล';
      if (payload.reason === 'DUPLICATE' && !payload.refJobId) fields.refJobId = 'กรุณาใส่เลขงานที่ซ้ำ';
      if (payload.reason === 'OTHER' && !payload.note) fields.note = 'กรุณาบอกเหตุผล';
      showFieldErrors(form, fields);
      if (Object.keys(fields).length) return;
      if (!window.confirm('ยกเลิกงาน ' + job.jobId + '? ยกเลิกแล้วเปลี่ยนกลับไม่ได้')) return;
      submit.disabled = true;
      submit.textContent = 'กำลังยกเลิก…';
      error.classList.add('hidden');
      api('cancelJob', payload)
        .then(function (res) {
          if (res.ok) return afterDone(me, nav, 'ยกเลิกงาน ' + job.jobId + ' แล้ว');
          if (res.error.details && res.error.details.fields) showFieldErrors(form, res.error.details.fields);
          error.textContent = res.error.message;
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'ยกเลิกงาน';
        })
        .catch(function () {
          error.textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดอีกครั้ง';
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'ยกเลิกงาน';
        });
    });
    main.appendChild(form);
  }

  // ---------- รูปหลังแก้/หลังซ่อม (ใบงาน 11 แก้เสร็จหน้างาน · ใบงาน 13 แนบรูปหลังซ่อม) ----------

  // ฟอร์มรูป + บันทึก ใช้ร่วมกัน 2 หน้า opts: title, photoLabel, noteLabel, notePlaceholder, notice, button, action, done(res)
  // state เก็บในหน่วยความจำ ถ้าส่งไม่สำเร็จ รูปและบันทึกยังอยู่ กดส่งซ้ำได้
  function showRepairForm(me, data, nav, opts, state) {
    state = state || { photos: [], note: '' };
    var job = data.job;
    var main = screen(opts.title);
    backButton(main, nav);
    main.appendChild(jobSummary(me, data, nav));
    var form = el('form', 'card');
    form.noValidate = true;
    form.appendChild(el('h1', '', opts.title));
    photoField(form, state, { label: opts.photoLabel, rerender: function () { showRepairForm(me, data, nav, opts, state); } });
    var note = textArea(form, 'note', opts.noteLabel, opts.notePlaceholder, state.note, function (text) { state.note = text; });
    // ปุ่มลัด (ใบงาน 30): แตะแล้วคำเข้าช่องบันทึก พิมพ์ต่อได้ · ปุ่มที่ต้องพิมพ์ต่อ (เช่น เปลี่ยนอะไหล่) ส่งเปล่า ๆ ไม่ได้
    if (data.repairPicks && data.repairPicks.length) {
      var picks = el('div', 'chips picks');
      data.repairPicks.forEach(function (p) {
        var chip = el('button', 'chip', p.label);
        chip.type = 'button';
        chip.addEventListener('click', function () {
          var current = note.value.trim();
          note.value = (current ? current + ' · ' : '') + p.label + ' ';
          state.note = note.value;
          note.focus();
        });
        picks.appendChild(chip);
      });
      note.parentNode.insertBefore(picks, note);
    }
    if (opts.notice) form.appendChild(el('p', 'notice', opts.notice));
    var error = el('p', 'error hidden');
    form.appendChild(error);
    var submit = el('button', 'primary', opts.button);
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var check = Core.validateAfterRepair(state, opts.noteMissing, data.repairPicks);
      showFieldErrors(form, check.fields);
      if (!check.ok) return;
      submit.disabled = true;
      submit.textContent = 'กำลังส่ง…';
      error.classList.add('hidden');
      api(opts.action, { jobId: job.jobId, photos: state.photos, note: check.value.note })
        .then(function (res) {
          if (res.ok) return opts.done(res);
          if (res.error.details && res.error.details.fields) showFieldErrors(form, res.error.details.fields);
          error.textContent = res.error.message;
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = opts.button;
        })
        .catch(function () {
          error.textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกด "' + opts.button + '" อีกครั้ง รูปและบันทึกยังอยู่ครบ';
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = opts.button;
        });
    });
    main.appendChild(form);
  }

  // ---------- ผลกระทบและการประเมิน (ใบงาน 27) ----------

  var LEVEL_KIND = { URGENT: 'err', HIGH: 'warn', NORMAL: 'info', LOW: 'off' };

  function impactCard(me, data, self) {
    var info = data.impact;
    if (!info || (!info.impacts.length && !info.none && !info.canAdd.length)) return null;
    var card = el('section', 'card');
    var head = el('div', 'job-head');
    head.appendChild(el('h2', 'card-title', 'ผลกระทบ'));
    if (info.level) head.appendChild(badge(Core.LEVEL[info.level], LEVEL_KIND[info.level]));
    card.appendChild(head);
    if (info.none) card.appendChild(el('p', 'muted', Core.IMPACT_NONE_LABEL));
    info.impacts.forEach(function (i) {
      var item = el('div', 'history');
      var top = el('div', 'job-head');
      top.appendChild(el('strong', '', i.label));
      top.appendChild(i.level ? badge(Core.LEVEL[i.level], LEVEL_KIND[i.level]) : badge('รอประเมิน', 'info'));
      item.appendChild(top);
      if (i.note) item.appendChild(el('small', '', i.note));
      if (i.by) item.appendChild(el('small', 'muted', 'ประเมินโดย ' + i.by + ' · ' + shortTime(i.at)));
      if (i.canAssess) {
        item.appendChild(actionButton(i.level ? 'small' : 'primary small', i.level ? 'เปลี่ยนระดับ' : 'ประเมิน',
          function () { showAssess(me, data, i, self); }));
      }
      card.appendChild(item);
    });
    if (info.deadline) {
      card.appendChild(el('small', info.late ? 'field-error' : 'muted', 'ต้องแก้ภายใน ' + shortTime(info.deadline) + (info.late ? ' (เลยกำหนดแล้ว)' : '')));
    }
    if (info.canAdd.length) {
      var add = el('div', 'chips');
      info.canAdd.forEach(function (code) {
        var chip = el('button', 'chip', '+ ' + Core.IMPACT[code]);
        chip.type = 'button';
        chip.addEventListener('click', function () {
          if (!window.confirm('ติ๊กเพิ่มว่างานนี้กระทบ' + Core.IMPACT[code] + '? ติ๊กแล้วเอาออกไม่ได้')) return;
          chip.disabled = true;
          api('addImpact', { jobId: data.job.jobId, impact: code })
            .then(function (res) {
              if (res.ok) return self.go('ติ๊กผลกระทบ' + Core.IMPACT[code] + 'แล้ว รอประเมิน');
              chip.disabled = false;
              window.alert(res.error.message);
            })
            .catch(function () { chip.disabled = false; window.alert('ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดอีกครั้ง'); });
        });
        add.appendChild(chip);
      });
      card.appendChild(el('small', 'muted', 'ติ๊กผลกระทบเพิ่ม'));
      card.appendChild(add);
    }
    return card;
  }

  // ฟอร์มประเมินความเร่งด่วน 1 ด้าน: 4 ระดับ + หมายเหตุ (ไม่บังคับ)
  function showAssess(me, data, impact, nav) {
    var main = screen('ประเมิน' + impact.label);
    backButton(main, nav);
    main.appendChild(jobSummary(me, data, nav));
    var form = el('form', 'card');
    form.noValidate = true;
    form.appendChild(el('h1', '', 'ประเมิน' + impact.label));
    var box = el('fieldset', 'field');
    box.dataset.field = 'level';
    box.appendChild(el('legend', '', 'ความเร่งด่วน *'));
    Core.LEVEL_ORDER.forEach(function (code) {
      var option = el('label', 'choice');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'level';
      radio.value = code;
      radio.checked = impact.level === code;
      option.appendChild(radio);
      option.appendChild(el('span', '', Core.LEVEL[code]));
      box.appendChild(option);
    });
    box.appendChild(el('small', 'field-error'));
    form.appendChild(box);
    var note = impact.note || '';
    textArea(form, 'note', 'กระทบอะไร (ไม่บังคับ)', 'เช่น พื้นลื่นทางเดินหลัก ให้กั้นพื้นที่ก่อน', note, function (t) { note = t; });
    var error = el('p', 'error hidden');
    form.appendChild(error);
    var submit = el('button', 'primary', 'บันทึกการประเมิน');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var picked = form.querySelector('input[name="level"]:checked');
      var fields = picked ? {} : { level: 'กรุณาเลือกระดับความเร่งด่วน' };
      showFieldErrors(form, fields);
      if (!picked) return;
      submit.disabled = true;
      submit.textContent = 'กำลังบันทึก…';
      api('assessImpact', { jobId: data.job.jobId, impact: impact.code, level: picked.value, note: note.trim() })
        .then(function (res) {
          if (res.ok) return nav.go('ประเมิน' + impact.label + 'แล้ว: ' + Core.LEVEL[picked.value]);
          if (res.error.details && res.error.details.fields) showFieldErrors(form, res.error.details.fields);
          error.textContent = res.error.message;
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'บันทึกการประเมิน';
        })
        .catch(function () {
          error.textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดอีกครั้ง';
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'บันทึกการประเมิน';
        });
    });
    main.appendChild(form);
  }

  // ---------- ผู้แจ้งยืนยัน (ใบงาน 29) และผู้แจ้งแก้เอง (ใบงาน 25) ----------

  // กล่องในหน้ารายละเอียด: ผู้แจ้งเห็นปุ่มหายแล้ว/ยังไม่หาย · หัวหน้ากะเห็นว่าผู้แจ้งยืนยันแล้วหรือยัง
  function reporterConfirmCard(me, data, self) {
    var info = data.reporterConfirm || {};
    var a = data.actions || {};
    if (!a.confirm && !info.state) return null;
    var card = el('section', 'card');
    var head = el('div', 'job-head');
    head.appendChild(el('h2', 'card-title', 'ผู้แจ้งยืนยัน'));
    // ป้ายสถานะการยืนยันมีไว้ให้หัวหน้ากะดู ผู้แจ้งที่ยังต้องกดเห็นแค่ปุ่ม
    var b = !a.confirm && confirmBadge({ reporterConfirm: info.state });
    if (b) head.appendChild(b);
    card.appendChild(head);
    if (info.state === 'CONFIRMED') {
      card.appendChild(el('p', 'muted', 'ผู้แจ้งยืนยันว่าหายแล้ว · ' + shortTime(info.at)));
      return card;
    }
    if (!a.confirm) {
      card.appendChild(el('p', 'muted', 'ผู้แจ้งยังไม่ได้กดยืนยัน หัวหน้ากะปิดงานได้เลยถ้ายืนยันเองว่าซ่อมเสร็จจริง'));
      return card;
    }
    card.appendChild(el('p', '', 'ช่างซ่อมเสร็จแล้ว ไปดูที่หน้างานแล้วบอกเราว่าหายหรือยัง'));
    var error = el('p', 'error hidden');
    var ok = actionButton('primary', 'หายแล้ว', function () {
      ok.disabled = true;
      ok.textContent = 'กำลังส่ง…';
      api('confirmRepair', { jobId: data.job.jobId })
        .then(function (res) {
          if (res.ok) return self.go('ขอบคุณ ส่งให้หัวหน้ากะปิดงานแล้ว');
          error.textContent = res.error.message;
          error.classList.remove('hidden');
          ok.disabled = false;
          ok.textContent = 'หายแล้ว';
        })
        .catch(function () {
          error.textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดอีกครั้ง';
          error.classList.remove('hidden');
          ok.disabled = false;
          ok.textContent = 'หายแล้ว';
        });
    });
    card.appendChild(ok);
    card.appendChild(actionButton('', 'ยังไม่หาย', function () { showNotFixed(me, data, self); }));
    card.appendChild(error);
    return card;
  }

  // ผู้แจ้งบอกว่ายังไม่หาย: เหตุผลบังคับ แล้วงานกลับไปให้ช่างทันที
  function showNotFixed(me, data, nav) {
    var job = data.job;
    var main = screen('ยังไม่หาย');
    backButton(main, nav);
    main.appendChild(jobSummary(me, data, nav));
    var form = el('form', 'card');
    form.noValidate = true;
    form.appendChild(el('h1', '', 'ยังไม่หาย'));
    var reason = '';
    textArea(form, 'reason', 'ยังไม่หายตรงไหน (บังคับ)', 'เช่น ยังซึมที่ข้อต่อด้านล่าง', '', function (t) { reason = t; });
    form.appendChild(el('p', 'notice', 'งานกลับไปให้ช่างซ่อมต่อ พร้อมข้อความนี้'));
    var error = el('p', 'error hidden');
    form.appendChild(error);
    var submit = el('button', 'primary', 'ส่งกลับให้ช่าง');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var fields = reason.trim() ? {} : { reason: 'กรุณาบอกว่ายังไม่หายตรงไหน' };
      showFieldErrors(form, fields);
      if (fields.reason) return;
      submit.disabled = true;
      submit.textContent = 'กำลังส่ง…';
      error.classList.add('hidden');
      api('rejectRepair', { jobId: job.jobId, reason: reason.trim() })
        .then(function (res) {
          if (res.ok) return nav.go('ส่งกลับให้ช่างแล้ว');
          if (res.error.details && res.error.details.fields) showFieldErrors(form, res.error.details.fields);
          error.textContent = res.error.message;
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'ส่งกลับให้ช่าง';
        })
        .catch(function () {
          error.textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดอีกครั้ง';
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'ส่งกลับให้ช่าง';
        });
    });
    main.appendChild(form);
  }

  // ผู้แจ้งแก้เองแล้ว (ใบงาน 25): รูปหลังแก้ + บันทึก แล้วรอหัวหน้ากะตรวจและปิด
  function showSelfFix(me, data, nav) {
    showRepairForm(me, data, nav, {
      title: 'แก้เองแล้ว',
      photoLabel: 'ถ่ายรูปหลังแก้ 1–3 รูป *',
      noteLabel: 'แก้อะไรไป (บังคับ)',
      notePlaceholder: 'เช่น ขันน็อตที่หลวม',
      noteMissing: 'กรุณาบอกว่าแก้อะไรไป',
      notice: 'งานไม่ต้องเปิด Noti · หัวหน้ากะจะตรวจแล้วปิดงาน',
      button: 'ส่ง แก้เสร็จแล้ว',
      action: 'selfFix',
      done: function () { nav.go('ส่งแล้ว รอหัวหน้ากะตรวจและปิดงาน'); },
    });
  }

  // แก้เสร็จหน้างาน: ปิดงานโดยไม่เปิด Noti (สวิตช์ ALLOW_CLOSE_WITHOUT_NOTI เปิด)
  function showFixOnSite(me, data, nav) {
    showRepairForm(me, data, nav, {
      title: 'แก้เสร็จหน้างาน',
      photoLabel: 'ถ่ายรูปหลังแก้ (บังคับ 1 รูป) *',
      noteLabel: 'แก้อะไรไป (บังคับ)',
      notePlaceholder: 'เช่น รีเซ็ตเบรกเกอร์',
      noteMissing: 'กรุณาบอกว่าแก้อะไรไป',
      notice: 'ปิดงานโดยไม่มีเลข Noti · ใช้ได้เมื่อแอดมินเปิดสวิตช์',
      button: 'ปิดงาน',
      action: 'closeWithoutNoti',
      done: function () { afterDone(me, nav, 'ปิดงาน ' + data.job.jobId + ' แล้ว (แก้เสร็จหน้างาน)'); },
    });
  }

  // แนบรูปหลังซ่อม: ช่างส่งแล้วได้การ์ดยืนยันในแชท (ส่ง "ซ่อมเสร็จ R-…" แล้ว webhook ตอบ)
  function showAfterRepair(me, data, nav) {
    showRepairForm(me, data, nav, {
      title: 'แนบรูปหลังซ่อม',
      photoLabel: 'รูปหลังซ่อม 1–3 รูป *',
      noteLabel: 'ซ่อมอะไรไป (บังคับ)',
      notePlaceholder: 'เช่น เปลี่ยนซีลปั๊ม',
      noteMissing: 'กรุณาบอกว่าซ่อมอะไรไป',
      button: 'ส่ง ซ่อมเสร็จ',
      action: 'markRepaired',
      done: function () {
        sendChatText('ซ่อมเสร็จ ' + data.job.jobId);
        showRepairDone(me, data.job);
      },
    });
  }

  function showRepairDone(me, job) {
    var main = screen('ซ่อมเสร็จ');
    var card = el('section', 'card done');
    card.appendChild(el('div', 'done-mark', '✓'));
    card.appendChild(el('p', 'muted', 'บันทึกซ่อมเสร็จแล้ว'));
    card.appendChild(el('p', 'job-id', job.jobId));
    card.appendChild(el('p', '', job.title));
    card.appendChild(el('p', 'notice', 'ผู้แจ้งจะกดยืนยันว่าหายแล้ว แล้วหัวหน้ากะแผนก' + job.department + ' ปิดงาน · บอกผู้แจ้งด้วยว่าซ่อมเสร็จแล้ว'));
    card.appendChild(actionButton('primary', 'กลับไปที่แชท', function () { liff.closeWindow(); }));
    card.appendChild(actionButton('', 'ดูงานรอซ่อม', function () { showQueue(me, 'repair'); }));
    main.appendChild(card);
  }

  // ---------- ส่งกลับให้ช่าง (ใบงาน 14) ----------

  function showSendBack(me, data, nav) {
    var job = data.job;
    var main = screen('ส่งกลับให้ช่าง');
    backButton(main, nav);
    main.appendChild(jobSummary(me, data, nav));
    var form = el('form', 'card');
    form.noValidate = true;
    form.appendChild(el('h1', '', 'ส่งกลับให้ช่าง'));
    var reason = '';
    textArea(form, 'reason', 'ยังไม่เรียบร้อยตรงไหน (บังคับ)', 'เช่น ยังมีน้ำซึมที่ข้อต่อด้านล่าง', '', function (text) { reason = text; });
    form.appendChild(el('p', 'notice', 'งานกลับไปคิวรอซ่อมพร้อมป้าย "ส่งกลับ"'));
    var error = el('p', 'error hidden');
    form.appendChild(error);
    var submit = el('button', 'primary', 'ส่งกลับ');
    submit.type = 'submit';
    form.appendChild(submit);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var fields = reason.trim() ? {} : { reason: 'กรุณาบอกว่ายังไม่เรียบร้อยตรงไหน' };
      showFieldErrors(form, fields);
      if (fields.reason) return;
      submit.disabled = true;
      submit.textContent = 'กำลังส่ง…';
      error.classList.add('hidden');
      api('sendBack', { jobId: job.jobId, reason: reason.trim() })
        .then(function (res) {
          if (res.ok) return showQueue(me, 'close', 'ส่ง ' + job.jobId + ' กลับให้ช่างแล้ว');
          if (res.error.details && res.error.details.fields) showFieldErrors(form, res.error.details.fields);
          error.textContent = res.error.message;
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'ส่งกลับ';
        })
        .catch(function () {
          error.textContent = 'ส่งไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วกดอีกครั้ง';
          error.classList.remove('hidden');
          submit.disabled = false;
          submit.textContent = 'ส่งกลับ';
        });
    });
    main.appendChild(form);
  }

  // ---------- คิวงาน (ใบงาน 10, 13, 14) และงานทั้งหมด (ใบงาน 15) ----------

  var QUEUE_TITLE = { noti: 'รอเปิด Noti', close: 'รอปิดงาน', repair: 'งานรอซ่อม', assess: 'รอประเมิน' };
  var QUEUE_EMPTY = { noti: 'ไม่มีงานรอเปิด Noti', close: 'ไม่มีงานรอปิด', repair: 'ไม่มีงานรอซ่อม', assess: 'ไม่มีงานที่คุณต้องประเมิน' };

  function showQueue(me, view, notice) {
    loading(QUEUE_TITLE[view]);
    api('listJobs', { view: view })
      .then(function (res) {
        if (!res.ok) return showError(res.error.message);
        renderQueue(me, view, res.data, notice, '');
      })
      .catch(function () { showError('โหลดรายการไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
  }

  // area คือรหัสพื้นที่ที่กรองอยู่ (คิวรอซ่อม) ว่าง = ทุกพื้นที่
  function renderQueue(me, view, data, notice, area) {
    var main = screen(QUEUE_TITLE[view]);
    if (notice) main.appendChild(el('p', 'success', notice));
    var jobs = data.jobs;
    var shown = jobs;
    if (view === 'repair' && jobs.length) {
      var seen = {};
      var areas = [{ code: '', text: 'ทุกพื้นที่' }];
      jobs.forEach(function (j) {
        if (!seen[j.areaCode]) { seen[j.areaCode] = true; areas.push({ code: j.areaCode, text: j.areaName || '-' }); }
      });
      var bar = el('div', 'chips filters');
      areas.forEach(function (a) {
        var chip = el('button', 'chip', a.text);
        chip.type = 'button';
        chip.setAttribute('aria-pressed', String(a.code === area));
        chip.addEventListener('click', function () { renderQueue(me, view, data, null, a.code); });
        bar.appendChild(chip);
      });
      main.appendChild(bar);
      if (area) shown = jobs.filter(function (j) { return j.areaCode === area; });
    }
    var card = el('section', 'card');
    var head = el('div', 'card-head');
    var scope = me.role === 'LEAD' ? me.department : 'ทุกแผนก';
    head.appendChild(el('h1', '', QUEUE_TITLE[view] + ' · ' + scope + ' (' + shown.length + ')'));
    head.appendChild(actionButton('small', 'โหลดใหม่', function () { showQueue(me, view); }));
    card.appendChild(head);
    if (!shown.length) card.appendChild(el('p', 'muted', QUEUE_EMPTY[view]));
    var nav = { label: '‹ ' + QUEUE_TITLE[view], go: function (n) { showQueue(me, view, n); } };
    shown.forEach(function (job) {
      var item = el('button', 'qcard');
      item.type = 'button';
      item.appendChild(job.thumb ? thumbImage(job.jobId, job.thumb) : el('div', 'thumb'));
      var info = el('div', 'qinfo');
      var top = el('div', 'job-head');
      top.appendChild(el('strong', '', job.title));
      top.appendChild(listBadge(job));
      info.appendChild(top);
      info.appendChild(el('small', 'muted', [job.areaName, job.locationDetail].filter(Boolean).join(' · ')));
      var meta = view === 'close'
        ? 'ซ่อมเสร็จ ' + Core.ageText(job.repairedAt || job.since, data.now) + 'ก่อน' + (job.repairedBy ? (job.selfFix ? ' · แก้เองโดย ' : ' · ช่าง ') + job.repairedBy : '')
        : [job.reporterName, 'แจ้งมา ' + Core.ageText(job.createdAt, data.now)].filter(Boolean).join(' · ');
      info.appendChild(el('small', 'muted', (me.role === 'LEAD' ? '' : job.department + ' · ') + meta));
      if (job.followUp) info.appendChild(followUpBadges(job.followUp));
      if (job.impact) info.appendChild(impactBadges(job.impact));
      var confirm = view === 'close' && confirmBadge(job);
      if (confirm) info.appendChild(confirm);
      item.appendChild(info);
      item.addEventListener('click', function () {
        if (view === 'noti') openNotiForm(me, job.jobId, nav);
        else showJob(me, job.jobId, nav);
      });
      card.appendChild(item);
    });
    main.appendChild(card);
  }

  // ตัวกรองสถานะของหน้างานทั้งหมด (เริ่มต้น "ยังไม่จบ") ช่องที่ 3 คือเงื่อนไขเพิ่ม (ไม่มี = กรองแค่สถานะ)
  var ALL_FILTERS = [
    ['ยังไม่จบ', Core.OPEN_STATUSES],
    ['รอเปิด Noti', ['PENDING_NOTI']],
    ['กำลังซ่อม', ['IN_REPAIR']],
    // ใบงาน 21: งานที่หัวหน้ากะต้องไปตาม
    ['รอคำตอบ', ['IN_REPAIR'], function (j) { return Boolean(j.followUp && j.followUp.state === 'AWAITING'); }],
    ['ซ่อมเสร็จ', ['REPAIRED']],
    ['ปิดงาน', ['CLOSED']],
    ['ยกเลิก', ['CANCELLED']],
    ['ทุกสถานะ', null],
  ];

  function showAllJobs(me, filters) {
    loading('งานทั้งหมด');
    api('listJobs', { view: 'all' })
      .then(function (res) {
        if (!res.ok) return showError(res.error.message);
        renderAllJobs(me, res.data, filters || { status: 0, department: '', area: '' });
      })
      .catch(function () { showError('โหลดงานทั้งหมดไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
  }

  function renderAllJobs(me, data, filters) {
    var main = screen('งานทั้งหมด');
    var rerender = function () { renderAllJobs(me, data, filters); };
    var bar = el('div', 'filter-row');
    bar.appendChild(filterSelect(ALL_FILTERS.map(function (f, i) { return [String(i), f[0]]; }), String(filters.status), function (v) {
      filters.status = Number(v);
      rerender();
    }));
    // หัวหน้ากะเห็นเฉพาะแผนกตัวเอง จึงไม่มีตัวกรองแผนก
    if (me.role !== 'LEAD') {
      var depts = unique(data.jobs.map(function (j) { return j.department; }).filter(Boolean)).sort();
      bar.appendChild(filterSelect([['', 'ทุกแผนก']].concat(depts.map(function (d) { return [d, d]; })), filters.department, function (v) {
        filters.department = v;
        rerender();
      }));
    }
    var areaNames = {};
    data.jobs.forEach(function (j) { areaNames[j.areaCode] = j.areaName || '-'; });
    bar.appendChild(filterSelect([['', 'ทุกพื้นที่']].concat(Object.keys(areaNames).map(function (c) { return [c, areaNames[c]]; })), filters.area, function (v) {
      filters.area = v;
      rerender();
    }));
    main.appendChild(bar);

    var statuses = ALL_FILTERS[filters.status][1];
    var extra = ALL_FILTERS[filters.status][2];
    var shown = data.jobs.filter(function (j) {
      return (!statuses || statuses.indexOf(j.status) >= 0) && (!extra || extra(j)) &&
        (!filters.department || j.department === filters.department) &&
        (!filters.area || j.areaCode === filters.area);
    });
    var card = el('section', 'card');
    var head = el('div', 'card-head');
    head.appendChild(el('h1', '', 'งานทั้งหมด (' + shown.length + ')'));
    head.appendChild(actionButton('small', 'โหลดใหม่', function () { showAllJobs(me, filters); }));
    card.appendChild(head);
    if (!shown.length) card.appendChild(el('p', 'muted', 'ไม่มีงานในกลุ่มนี้'));
    var nav = { label: '‹ งานทั้งหมด', go: function () { showAllJobs(me, filters); } };
    shown.forEach(function (job) {
      var item = el('button', 'job');
      item.type = 'button';
      item.addEventListener('click', function () { showJob(me, job.jobId, nav); });
      var top = el('div', 'job-head');
      top.appendChild(el('strong', '', job.title));
      top.appendChild(listBadge(job, true));
      item.appendChild(top);
      var parts = me.role === 'LEAD' ? [] : [job.department];
      item.appendChild(el('small', 'muted', parts.concat([job.areaName, Core.ageText(job.createdAt, data.now)]).filter(Boolean).join(' · ')));
      if (job.followUp) item.appendChild(followUpBadges(job.followUp));
      if (job.impact) item.appendChild(impactBadges(job.impact));
      item.appendChild(el('small', 'muted', job.jobId));
      card.appendChild(item);
    });
    main.appendChild(card);
  }

  function filterSelect(options, value, onChange) {
    var node = document.createElement('select');
    options.forEach(function (o) {
      var option = el('option', '', o[1]);
      option.value = o[0];
      option.selected = o[0] === value;
      node.appendChild(option);
    });
    node.addEventListener('change', function () { onChange(node.value); });
    return node;
  }

  function unique(values) {
    return values.filter(function (v, i) { return values.indexOf(v) === i; });
  }

  // รูปจาก Drive ผ่าน API (รูปไม่มีลิงก์สาธารณะ) จำไว้ในหน้า เปิดซ้ำไม่โหลดใหม่
  var photoCache = {};
  function loadPhoto(jobId, fileId) {
    if (!photoCache[fileId]) {
      photoCache[fileId] = api('jobPhoto', { jobId: jobId, fileId: fileId }).then(function (res) {
        if (!res.ok) throw new Error(res.error.message);
        return res.data.photo;
      });
      photoCache[fileId].catch(function () { delete photoCache[fileId]; });
    }
    return photoCache[fileId];
  }

  // รูปย่อในรายการ (โหลดทีหลัง) zoom = แตะดูเต็มจอได้
  function thumbImage(jobId, fileId, zoom) {
    var cell = el('div', 'thumb loading');
    loadPhoto(jobId, fileId)
      .then(function (src) {
        cell.classList.remove('loading');
        var img = el('img');
        img.src = src;
        img.alt = '';
        cell.appendChild(img);
        if (zoom) cell.addEventListener('click', function () { showPhoto(src); });
      })
      .catch(function () { cell.classList.remove('loading'); });
    return cell;
  }

  // กลุ่มรูป 1 กลุ่ม ขอรูปทีละรูปผ่าน API (รูปใน Drive ไม่มีลิงก์สาธารณะ)
  function photoGroup(jobId, title, ids) {
    var box = el('div', 'photo-group');
    box.appendChild(el('span', 'field-label', title));
    var grid = el('div', 'thumbs');
    ids.forEach(function (fileId, i) {
      var cell = el('button', 'thumb loading');
      cell.type = 'button';
      cell.setAttribute('aria-label', title + ' รูปที่ ' + (i + 1));
      grid.appendChild(cell);
      loadPhoto(jobId, fileId)
        .then(function (src) {
          cell.classList.remove('loading');
          var img = el('img');
          img.src = src;
          img.alt = '';
          cell.appendChild(img);
          cell.addEventListener('click', function () { showPhoto(src); });
        })
        .catch(function () { cell.classList.remove('loading'); cell.textContent = 'โหลดไม่ได้'; });
    });
    if (!ids.length) grid.appendChild(el('p', 'muted', 'ไม่มีรูป'));
    box.appendChild(grid);
    return box;
  }

  // ดูรูปเต็มจอ แตะที่ไหนก็ปิด
  function showPhoto(src) {
    var overlay = el('div', 'photo-full');
    var img = el('img');
    img.src = src;
    img.alt = '';
    overlay.appendChild(img);
    var close = el('button', 'small', 'ปิด');
    close.type = 'button';
    overlay.appendChild(close);
    overlay.addEventListener('click', function () { overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // "2026-10-28 08:05:00" → "28/10 08:05"
  function shortTime(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value || ''));
    return m ? m[3] + '/' + m[2] + ' ' + m[4] + ':' + m[5] : String(value || '');
  }

  function route(me) {
    var params = new URLSearchParams(window.location.search);
    var page = params.get('page') || '';
    if (me.status === 'NOT_REGISTERED' || me.status === 'REJECTED') {
      return api('listDepartments')
        .then(function (res) {
          if (!res.ok) return showError(res.error.message);
          showRegister(me, res.data.departments);
        })
        .catch(function () { showError('โหลดรายชื่อแผนกไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
    }
    if (me.status === 'PENDING') return showStatus(me, 'แอดมินจะอนุมัติให้เร็วที่สุด เมื่ออนุมัติแล้วเมนูในแชทจะเปลี่ยนตามโรล');
    if (me.status === 'DISABLED') return showStatus(me, 'ติดต่อแอดมินถ้าคิดว่าเป็นความผิดพลาด');
    if (page === 'register') return showStatus(me, 'คุณลงทะเบียนและได้รับอนุมัติแล้ว');
    if (page === 'users') {
      if (me.role === 'ADMIN') return showUsers(me);
      return showError('หน้านี้สำหรับแอดมินเท่านั้น');
    }
    if (page === 'new') {
      if (Core.REPORTER_ROLES.indexOf(me.role) >= 0) return showNewJob(me);
      return showError('โรลของคุณแจ้งงานไม่ได้ ติดต่อแอดมินถ้าต้องการแจ้งงาน');
    }
    if (page === 'my') return showMyJobs(me);
    if (page === 'job') return showJob(me, params.get('id'));
    if (page === 'queue-noti' || page === 'queue-close') {
      if (me.role === 'LEAD' || me.role === 'ADMIN') return showQueue(me, page.slice(6));
      return showError('หน้านี้สำหรับหัวหน้ากะและแอดมิน');
    }
    if (page === 'queue-repair') {
      if (['TECH', 'PLANNER', 'ADMIN'].indexOf(me.role) >= 0) return showQueue(me, 'repair');
      return showError('หน้านี้สำหรับช่าง Planner และแอดมิน');
    }
    if (page === 'queue-assess') {
      if (['SAFETY', 'DEPT_HEAD', 'ADMIN'].indexOf(me.role) >= 0) return showQueue(me, 'assess');
      return showError('หน้านี้สำหรับ จป หัวหน้าแผนก และแอดมิน');
    }
    if (page === 'all') {
      if (me.role !== 'STAFF') return showAllJobs(me);
      return showError('หน้านี้สำหรับหัวหน้ากะ Planner ช่าง และแอดมิน');
    }
    if (page) return showStatus(me, 'ไม่พบหน้านี้');
    return showStatus(me);
  }

  // ลายเซ็นผู้ทำและเลขรุ่น ตัวเล็กสีจางล่างสุดทุกหน้า (docs/design/UI.md)
  // เลขรุ่นใช้ถามผู้ใช้ว่ามือถือเปิดแอปรุ่นล่าสุดหรือยัง (ความผิดพลาดข้อ 7)
  function showSignature() {
    var footer = document.getElementById('signature');
    if (footer) footer.textContent = 'v1.0 · รุ่น ' + (CONFIG.BUILD || 'dev') + ' · ออกแบบและพัฒนาโดย JABB';
  }

  // เริ่มต้น: เปิด LIFF → ล็อกอินถ้าเปิดนอก LINE → เรียก me → เลือกหน้า
  function start() {
    showSignature();
    if (!CONFIG.LIFF_ID || !CONFIG.API_URL) {
      showError('ยังตั้งค่าแอปไม่ครบ (LIFF_ID หรือ API_URL ใน config.js)');
      return;
    }
    liff.init({ liffId: CONFIG.LIFF_ID })
      .then(function () {
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return null;
        }
        prefetchPage();
        return api('me');
      })
      .then(function (res) {
        if (!res) return;
        if (!res.ok) {
          showError(res.error.message);
          return;
        }
        route(res.data);
      })
      .catch(function (err) {
        showError('เชื่อมต่อไม่สำเร็จ: ' + (err && err.message ? err.message : err));
      });
  }

  start();
})();
