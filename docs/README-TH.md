# ระบบสตาฟ บ้านผีสิง — คู่มือติดตั้งและใช้งาน

ระบบนี้มี 2 ส่วนที่แยกกันสนิท
- **ระบบ B: ลงเวลาสตาฟ** (`backend-staff/` + `frontend/staff/`) ← กำลังทำอยู่
- **ระบบ A: จองตั๋วบ้านผีสิง** (`backend-booking/` + `frontend/booking/`) ← ทำทีหลัง

สเปกต้นฉบับ: `docs/SPEC-v4.md`

---

## ภาพรวมการทำงาน (ฉบับมือใหม่)

```
มือถือ (Safari)  ──►  หน้าเว็บบน GitHub Pages  ──►  Google Apps Script (หลังบ้าน)  ──►  Google Sheets (ฐานข้อมูล)
                      frontend/                     backend-staff/                    1 ไฟล์ต่อโหมด
```

- **หน้าเว็บ** อยู่บน GitHub Pages เพราะ iPhone ไม่ยอมเปิดกล้องในหน้าเว็บของ Apps Script โดยตรง
- **หลังบ้าน** คือโค้ด Apps Script ที่ผูกกับไฟล์ Google Sheets ทำหน้าที่รับคำสั่ง เช็คสิทธิ์ แล้วเขียนลงชีต
- **มี 2 โหมดแยกกัน**: `TEST` (ทดสอบ/เดโม) และ `PROD` (ใช้งานจริง) แต่ละโหมดมีไฟล์ชีตและโปรเจกต์ Apps Script ของตัวเอง ข้อมูลไม่ปนกัน
- หน้าเว็บโหมดทดสอบจะมีแถบเหลือง **"โหมดทดสอบ"** ด้านบนเสมอ
- เวลาทุกอย่างมาจากเซิร์ฟเวอร์ (เวลาไทย) มือถือแก้นาฬิกาเองไม่มีผล

### โครงสร้างโฟลเดอร์

| โฟลเดอร์ | คืออะไร |
|---|---|
| `frontend/` | หน้าเว็บทั้งหมด (`config.js` = ที่อยู่หลังบ้านแต่ละโหมด) |
| `backend-staff/core/` | กติกาล้วนๆ (สิทธิ์, คำนวณชั่วโมง ฯลฯ) ทดสอบบนเครื่องได้ด้วย Node |
| `backend-staff/adapters/` | ตัวเชื่อม Google (Sheets, Cache, Lock, Properties) |
| `backend-staff/main.js` | ประตูรับคำสั่ง API (`doPost`) |
| `backend-staff/setup.js` | เมนู "🎃 ระบบสตาฟ" ในไฟล์ชีต |
| `tests/core/` | ทดสอบกติกา (`npm test`) |
| `tests/api/` | ทดสอบ API จริงบนโหมด TEST (`npm run test:api`) |
| `tools/clasp-env.js` | สลับส่งโค้ดไปโหมด TEST / PROD |

---

## ติดตั้งครั้งแรก

ต้องมี: Node.js 20 ขึ้นไป, บัญชี Google, บัญชี GitHub

1. ติดตั้งเครื่องมือ: `npm install`
2. เปิดสิทธิ์ Apps Script API: เข้า https://script.google.com/home/usersettings แล้วเปิด **Google Apps Script API**
3. ล็อกอิน Google ให้ clasp (เครื่องมือส่งโค้ดขึ้น Apps Script): `npx clasp login`
4. สร้างโปรเจกต์โหมด TEST (สร้างไฟล์ชีตใหม่พร้อมโค้ดผูกกัน):
   ```
   cd backend-staff
   npx clasp create-script --type sheets --title "ระบบสตาฟ บ้านผีสิง [TEST]" --rootDir .
   ```
   แล้วเปลี่ยนชื่อไฟล์ `.clasp.json` ที่ได้เป็น `.clasp.test.json`
   (ทำแบบเดียวกันสำหรับ PROD → `.clasp.prod.json` เมื่อพร้อมใช้งานจริง)
5. ส่งโค้ดขึ้น: `npm run push:test`
6. เปิดไฟล์ Google Sheets ที่สร้างขึ้น → เมนู **🎃 ระบบสตาฟ → ตั้งค่าเป็นโหมดทดสอบ (TEST)**
   ครั้งแรก Google จะถามสิทธิ์ ให้กดอนุญาต (ขึ้นคำเตือน "แอปยังไม่ผ่านการตรวจสอบ" ให้กด ขั้นสูง → ไปที่โปรเจกต์)
7. เปิดเป็นเว็บแอป: `npm run deploy:test`
   - ครั้งแรกจะได้ `deploymentId` → ใส่ลงใน `.clasp.test.json` เป็น `"deploymentId": "..."` เพื่อให้ deploy ครั้งต่อไปได้ URL เดิม
   - URL หลังบ้าน = `https://script.google.com/macros/s/<deploymentId>/exec`
8. ใส่ URL นั้นใน `frontend/config.js` ที่ `envs.test.apiUrl`
9. เช็คว่าใช้ได้: เปิด `<URL>?action=health` ในเบราว์เซอร์ ต้องเห็น `"ok":true` และ `"env":"TEST"`

### เปิดหน้าเว็บบน GitHub Pages
1. สร้าง repo ใหม่บน GitHub แล้ว push โฟลเดอร์นี้ขึ้นไป (branch `main`)
2. ใน repo: Settings → Pages → Source: **GitHub Actions**
3. ทุกครั้งที่ push ขึ้น `main` ระบบจะรันเทสต์แล้วอัปโหลดหน้าเว็บให้อัตโนมัติ
4. หน้าเว็บ: `https://<ชื่อผู้ใช้>.github.io/<ชื่อ repo>/` (ใส่ `?env=test` หรือ `?env=prod` เพื่อสลับโหมด)

### อัปเดตโค้ดหลังบ้านอย่างปลอดภัย
- ใช้ `npm run deploy:test` / `npm run deploy:prod` เสมอ คำสั่งนี้อัปเดต deployment เดิม **URL ไม่เปลี่ยน** หน้าเว็บไม่พัง
- อย่ากด "New deployment" เองในหน้า Apps Script เพราะจะได้ URL ใหม่

---

## สถานะงาน

### ✅ M0 – Foundation (เสร็จ 2026-10-29)
- โครงโฟลเดอร์ + clasp + สคริปต์สลับโหมด TEST/PROD
- ตัวรับคำสั่ง API (`doPost`) ใช้รูปแบบตอบกลับเดียวทุกคำสั่ง + `requestId`
- ตารางสิทธิ์ทุกคำสั่งตามสเปกข้อ 7 (`core/permissions.js`) + เทสต์
- บันทึก error ลงชีต `Errors` (ผู้ใช้เห็น "รหัสอ้างอิง")
- เมนูตั้งค่าในชีต: สร้างชีตทุกแผ่นตามข้อ 6, ล็อกหัวตาราง, ใส่ค่า Config เริ่มต้น, สร้างรหัสลับ
- หน้าเว็บสถานะระบบ + แถบ "โหมดทดสอบ" + GitHub Actions deploy
- เทสต์: `npm test` (27 ข้อผ่าน)

**ยังต้องทำบนบัญชีจริง (master ล็อกอิน):** ข้อ 2–9 ด้านบน และเปิด GitHub Pages

### ⏳ ต่อไป
- M1 – บัญชีและบัตร: นำเข้ารายชื่อ, รหัสเปิดใช้งาน, ล็อกอิน, จำกัดการใส่รหัสผิด, บัตรบาร์โค้ด + บันทึกเป็นรูป
- M2 – สแกนและนับชั่วโมง
- M3 – พอร์ทัลสมาชิกและหน้าทีม
- M4 – แก้ไขชั่วโมง (2 คนอนุมัติ), ปิดงวด, ส่งออก CSV
