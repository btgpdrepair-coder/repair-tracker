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
    LEAD: 'เปิด Noti ใน SAP ยกเลิก และปิดงาน ของแผนกตัวเอง',
    PLANNER: 'ดูสรุปงานค้างทั้งหมด',
    TECH: 'ดูงานรอซ่อม และแนบรูปหลังซ่อม',
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
    // ลายเซ็นผู้ทำ ตัวเล็กสีจางล่างสุดของหน้าแรก (docs/design/UI.md)
    main.appendChild(el('p', 'signature', 'v1.0 · ออกแบบและพัฒนาโดย JABB'));
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
  // ---------- แจ้งงาน 4 ขั้น (ใบงาน 06 · docs/design/UI.md หัวข้อ "แจ้งงาน") ----------

  // ช่องของแต่ละขั้น ใช้เลือกข้อความผิดจาก Core.validateJob มาแสดงเฉพาะขั้นที่อยู่
  var STEP_FIELDS = { 1: ['photos'], 2: ['asset', 'symptom'], 3: ['area', 'locationDetail'], 4: ['detail'] };
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

  // ช่องพิมพ์ที่ผูกกับค่าในแบบร่าง พร้อมคำแนะนำไมค์ใต้ช่อง
  function textField(form, me, draft, key, name, labelText, placeholder, onChange) {
    var control = field(form, name, labelText, input('text', placeholder));
    control.value = draft[key] || '';
    control.addEventListener('input', function () {
      draft[key] = control.value;
      saveDraft(me, draft);
      if (onChange) onChange();
    });
    control.parentNode.insertBefore(el('small', 'hint', MIC_HINT), control.nextSibling);
    return control;
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
        showReportStep(me, res.data, draft, draft.step || 1);
      })
      .catch(function () { showError('โหลดหน้าแจ้งงานไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
  }

  function showReportStep(me, options, draft, step) {
    draft.step = step;
    saveDraft(me, draft);
    var main = screen('แจ้งงานใหม่');
    var rerender = function () { showReportStep(me, options, draft, step); };

    var progress = el('div', 'progress');
    progress.appendChild(el('span', 'muted', 'ขั้น ' + step + ' จาก 4'));
    var bar = el('div', 'progress-bar');
    bar.appendChild(el('div', 'progress-fill')).style.width = (step * 25) + '%';
    progress.appendChild(bar);
    main.appendChild(progress);

    var form = el('form', 'card');
    form.noValidate = true;
    var check = function () { return Core.validateJob(draft, options); };

    if (step === 1) {
      form.appendChild(el('h1', '', 'ถ่ายรูปอาการ'));
      var body = group(form, 'photos', 'รูป 1–3 รูป *');
      var thumbs = el('div', 'thumbs');
      for (var i = 0; i < Core.PHOTO_MAX_COUNT; i++) thumbs.appendChild(photoCell(i));
      body.appendChild(thumbs);
      var camera = fileInput(false);
      camera.setAttribute('capture', 'environment');
      var album = fileInput(true);
      var full = draft.photos.length >= Core.PHOTO_MAX_COUNT;
      var cameraButton = el('button', 'primary', 'ถ่ายรูป');
      cameraButton.type = 'button';
      cameraButton.disabled = full;
      cameraButton.addEventListener('click', function () { camera.click(); });
      var albumButton = el('button', 'link', 'หรือเลือกจากอัลบั้ม');
      albumButton.type = 'button';
      albumButton.disabled = full;
      albumButton.addEventListener('click', function () { album.click(); });
      body.appendChild(cameraButton);
      body.appendChild(albumButton);
      body.appendChild(camera);
      body.appendChild(album);
      body.appendChild(el('p', 'notice', 'ถ้าทำได้ ถ่าย 1 รูปให้เห็นรอบ ๆ ด้วย ช่างจะหาเจอง่ายขึ้น'));
    }

    if (step === 2) {
      form.appendChild(el('h1', '', 'อะไรเสีย เกิดอะไรขึ้น'));
      var title = el('p', 'notice');
      var showTitle = function () {
        var value = check().value.title;
        title.textContent = 'ชื่องาน: ' + (value || '-');
      };
      var asset = textField(form, me, draft, 'asset', 'asset', 'อะไรเสีย', 'เช่น ปั๊มน้ำ สายพาน', showTitle);
      suggestions(asset, options.assetSuggestions || []);
      var symptoms = group(form, 'symptom', 'เกิดอะไรขึ้น *');
      chips(symptoms, options.symptoms.map(function (s) { return { code: s.code, text: s.label }; }), draft.symptomCode,
        function (code) { draft.symptomCode = code; rerender(); });
      if (draft.symptomCode === Core.OTHER) {
        textField(form, me, draft, 'symptomOther', 'symptomOther', 'พิมพ์อาการ', 'เช่น มีกลิ่นไหม้', showTitle);
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
        textField(form, me, draft, 'areaOther', 'areaOther', 'พิมพ์ชื่อพื้นที่', 'เช่น โรงซ่อมบำรุง');
      }
      var spot = textField(form, me, draft, 'locationDetail', 'locationDetail', 'ตรงไหน', 'เช่น ชั้น 2 ข้างลิฟต์');
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
      var detail = el('textarea');
      detail.id = 'f-detail';
      detail.rows = 3;
      detail.placeholder = 'เช่น เริ่มรั่วตั้งแต่เช้า';
      detail.value = draft.detail || '';
      detail.addEventListener('input', function () { draft.detail = detail.value; saveDraft(me, draft); });
      var detailBox = el('div', 'field');
      detailBox.dataset.field = 'detail';
      var detailLabel = el('label', '', 'รายละเอียดเพิ่มเติม (ไม่บังคับ)');
      detailLabel.htmlFor = detail.id;
      detailBox.appendChild(detailLabel);
      detailBox.appendChild(detail);
      detailBox.appendChild(el('small', 'hint', MIC_HINT));
      detailBox.appendChild(el('small', 'field-error'));
      form.appendChild(detailBox);
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

    // ช่องรูปย่อ 1 ช่อง มีรูปแล้วแสดงปุ่ม ✕ ลบ
    function photoCell(index) {
      var cell = el('div', 'thumb');
      var photo = draft.photos[index];
      if (!photo) return cell;
      var img = el('img');
      img.src = photo;
      img.alt = 'รูปที่ ' + (index + 1);
      var remove = el('button', 'thumb-remove', '✕');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'ลบรูปที่ ' + (index + 1));
      remove.addEventListener('click', function () {
        draft.photos.splice(index, 1);
        rerender();
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
      var room = Core.PHOTO_MAX_COUNT - draft.photos.length;
      var picked = Array.prototype.slice.call(files || [], 0, room);
      if (!picked.length) return;
      var dropped = files.length > picked.length;
      cameraButton.disabled = true;
      cameraButton.textContent = 'กำลังย่อรูป…';
      Promise.all(picked.map(resizePhoto))
        .then(function (photos) {
          draft.photos = draft.photos.concat(photos);
          rerender();
          if (dropped) {
            showFieldErrors(document.querySelector('form'),
              { photos: 'แนบได้ไม่เกิน ' + Core.PHOTO_MAX_COUNT + ' รูป ใช้เฉพาะรูปแรก ๆ ที่เลือก' });
          }
        })
        .catch(function () {
          rerender();
          showFieldErrors(document.querySelector('form'), { photos: 'อ่านรูปไม่ได้ ลองถ่ายใหม่อีกครั้ง' });
        });
    }

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
    try {
      if (!liff.isInClient()) return;
      liff.sendMessages([{ type: 'text', text: 'แจ้งงาน ' + jobId }]).catch(function () { /* ข้ามไปเงียบ ๆ */ });
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
    card.appendChild(el('p', 'notice', 'หัวหน้ากะแผนก' + job.department + ' จะเปิด Noti ใน SAP ให้'));
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

  function showMyJobs(me) {
    loading('งานของฉัน');
    api('listMyJobs')
      .then(function (res) {
        if (!res.ok) return showError(res.error.message);
        renderMyJobs(res.data.jobs, 0);
      })
      .catch(function () { showError('โหลดงานของฉันไม่สำเร็จ ตรวจสัญญาณอินเทอร์เน็ตแล้วลองใหม่'); });
  }

  function renderMyJobs(jobs, filterIndex) {
    var main = screen('งานของฉัน');
    var bar = el('div', 'chips filters');
    MY_FILTERS.forEach(function (filter, index) {
      var count = jobs.filter(function (j) { return !filter[1] || filter[1].indexOf(j.status) >= 0; }).length;
      var chip = el('button', 'chip', filter[0] + ' ' + count);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(index === filterIndex));
      chip.addEventListener('click', function () { renderMyJobs(jobs, index); });
      bar.appendChild(chip);
    });
    main.appendChild(bar);

    var statuses = MY_FILTERS[filterIndex][1];
    var shown = jobs.filter(function (j) { return !statuses || statuses.indexOf(j.status) >= 0; });
    var card = el('section', 'card');
    if (!jobs.length) card.appendChild(el('p', 'muted', 'ยังไม่เคยแจ้งงาน กด "แจ้งงานใหม่" ที่เมนูในแชทเพื่อเริ่ม'));
    else if (!shown.length) card.appendChild(el('p', 'muted', 'ไม่มีงานในกลุ่มนี้'));
    shown.forEach(function (job) {
      var item = el('div', 'job');
      var label = Core.JOB_STATUS_LABEL[job.status] || [job.status, 'off'];
      var head = el('div', 'job-head');
      head.appendChild(badge(label[0], label[1]));
      head.appendChild(el('small', 'muted', job.jobId));
      item.appendChild(head);
      item.appendChild(el('strong', '', job.title));
      item.appendChild(el('small', 'muted', [job.areaName, job.locationDetail].filter(Boolean).join(' · ')));
      item.appendChild(el('small', 'muted', 'แจ้งเมื่อ ' + shortTime(job.createdAt)));
      card.appendChild(item);
    });
    main.appendChild(card);
  }

  // "2026-10-28 08:05:00" → "28/10 08:05"
  function shortTime(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(value || ''));
    return m ? m[3] + '/' + m[2] + ' ' + m[4] + ':' + m[5] : String(value || '');
  }

  function route(me) {
    var page = new URLSearchParams(window.location.search).get('page') || '';
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
    // หน้าที่ปุ่มเมนูเปิดได้แล้วแต่ยังไม่ได้สร้าง (ทำในใบงาน 07 เป็นต้นไป)
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
