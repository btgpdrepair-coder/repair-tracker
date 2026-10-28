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
  };

  // คำอธิบายโรลในหน้าลงทะเบียน (ตาม mockup)
  var ROLE_HINT = {
    STAFF: 'แจ้งงานพร้อมรูป และดูงานของตัวเอง',
    LEAD: 'เปิด Noti ใน SAP ยกเลิก และปิดงาน',
    PLANNER: 'ดูสรุปงานค้างทั้งหมด',
    TECH: 'ดูงานรอซ่อม และแนบรูปหลังซ่อม',
  };

  var DEPARTMENTS = ['ผลิต', 'ซ่อมบำรุง', 'วิศวกรรม', 'คลังสินค้า'];

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
    return fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, idToken: liff.getIDToken(), payload: payload || {} }),
    }).then(function (res) { return res.json(); });
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
  function showRegister(me) {
    var main = screen('ลงทะเบียนใช้งาน');
    var form = el('form', 'card');
    form.noValidate = true;

    form.appendChild(el('h1', '', 'ครั้งแรกที่ใช้งาน'));
    form.appendChild(el('p', 'muted', 'กรอกข้อมูลให้แอดมินอนุมัติ อนุมัติแล้วเมนูในแชทจะเปลี่ยนตามโรล'));
    if (me.status === 'REJECTED') {
      form.appendChild(el('p', 'error', 'คำขอครั้งก่อนไม่ผ่าน แก้ข้อมูลแล้วส่งใหม่ได้ หรือติดต่อแอดมิน'));
    }

    var realName = field(form, 'realName', 'ชื่อ-นามสกุลจริง', input('text', 'ใช้ชื่อเดียวกับในบัตรพนักงาน'));
    var department = field(form, 'department', 'แผนก', select(DEPARTMENTS));
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
      };
      // ตรวจในเครื่องก่อนด้วยกติกาชุดเดียวกับ backend จะได้เห็นข้อผิดทันที
      var check = Core.validateRegistration(payload);
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
  function field(form, name, labelText, control) {
    var box = el('div', 'field');
    box.dataset.field = name;
    var label = el('label', '', labelText + ' *');
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

  // หน้าจัดการผู้ใช้ของแอดมิน (ตาม mockup Users.html)
  function showUsers(me) {
    var main = screen('จัดการผู้ใช้');
    main.appendChild(el('p', 'muted', 'กำลังโหลดรายชื่อ…'));

    api('listUsers').then(function (res) {
      main.innerHTML = '';
      if (!res.ok) return showError(res.error.message);
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
        info.appendChild(el('small', 'muted', u.department + ' · ขอเป็น' + (ROLE_LABEL[u.requestedRole] || u.requestedRole)));
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

      // ผู้ใช้ที่อนุมัติแล้ว เปลี่ยนโรลได้ (ยกเว้นตัวเอง)
      var allCard = el('section', 'card');
      allCard.appendChild(el('h1', '', 'ผู้ใช้ทั้งหมด ' + approved.length + ' คน'));
      approved.forEach(function (u) {
        var item = el('div', 'person');
        var info = el('div', 'person-info');
        var isSelf = u.userId === me.userId;
        info.appendChild(el('strong', '', (u.realName || u.lineName) + (isSelf ? ' (คุณ)' : '')));
        info.appendChild(el('small', 'muted', u.department));
        item.appendChild(info);
        if (isSelf) {
          item.appendChild(el('span', 'badge ok', ROLE_LABEL[u.role] || u.role));
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
          item.appendChild(roleSelect);
        }
        allCard.appendChild(item);
      });
      allCard.appendChild(el('p', 'muted', 'เปลี่ยนโรลแล้ว เมนูในแชทของคนนั้นเปลี่ยนตามทันที'));
      main.appendChild(allCard);
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
  function route(me) {
    var page = new URLSearchParams(window.location.search).get('page') || '';
    if (me.status === 'NOT_REGISTERED' || me.status === 'REJECTED') return showRegister(me);
    if (me.status === 'PENDING') return showStatus(me, 'แอดมินจะอนุมัติให้เร็วที่สุด เมื่ออนุมัติแล้วเมนูในแชทจะเปลี่ยนตามโรล');
    if (me.status === 'DISABLED') return showStatus(me, 'ติดต่อแอดมินถ้าคิดว่าเป็นความผิดพลาด');
    if (page === 'register') return showStatus(me, 'คุณลงทะเบียนและได้รับอนุมัติแล้ว');
    if (page === 'users') {
      if (me.role === 'ADMIN') return showUsers(me);
      return showError('หน้านี้สำหรับแอดมินเท่านั้น');
    }
    // หน้าที่ปุ่มเมนูเปิดได้แล้วแต่ยังไม่ได้สร้าง (ทำในใบงาน 06 เป็นต้นไป)
    if (page) return showStatus(me, 'หน้านี้กำลังสร้าง จะเปิดใช้เร็ว ๆ นี้');
    return showStatus(me);
  }

  // เริ่มต้น: เปิด LIFF → ล็อกอินถ้าเปิดนอก LINE → เรียก me → เลือกหน้า
  function start() {
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
