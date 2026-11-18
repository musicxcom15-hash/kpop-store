# KPOP STORE — ระบบรับพรีออเดอร์อัลบั้มเคป็อป

เว็บรับพรีออเดอร์อัลบั้ม K-POP จากเกาหลี
ข้อมูลทั้งหมดเก็บใน **PostgreSQL บน Supabase** เชื่อมผ่าน **PHP API (PDO + prepared statements)**
รันบน **Docker** ตอนพัฒนา และ deploy ตัวเว็บขึ้น **Vercel** (Container Runtime — build จาก Dockerfile เดียวกัน php:8.3-apache)
ไฟล์อัปโหลด (สลิป · รูปสินค้า) เก็บใน **Supabase Storage**

📸 **ภาพสาธิตการใช้งานทีละขั้น** (ลูกค้าสั่งซื้อ → แนบสลิป → แอดมินอนุมัติ → จัดส่ง): [docs/demo](docs/demo/README.md)

## ระบบทำอะไรได้บ้าง

**ฝั่งลูกค้า**
- ดูแคตตาล็อกสินค้าได้โดยไม่ต้องล็อกอิน — แต่กดดูรายละเอียดหรือสั่งซื้อต้องเข้าสู่ระบบก่อน
- ตะกร้าแยกตามรอบพรีออเดอร์ (ของคนละรอบถึงไทยคนละเวลา จึงคิดค่าส่งแยกรอบ)
- แนบสลิปโอนเงินเพื่อยืนยันคำสั่งซื้อ · ยอดเงินถูกล็อกที่เรทวันนั้นทันทีที่แนบสลิป
- ติดตามสถานะพัสดุ ขอยกเลิก และส่งสลิปใบใหม่เมื่อสลิปเดิมไม่ผ่าน

**ฝั่งผู้ดูแล**
- ตรวจและอนุมัติ/ปฏิเสธสลิปทีละใบ
- จัดการสินค้า · รอบพรีออเดอร์ (เรทเงินวอนเป็นค่าคงที่ในโค้ด ไม่มีหน้าให้ตั้งเอง)
- ใบสรุปรอบสำหรับถือไปกดสั่งกับเว็บเกาหลี
- กรณีกดของไม่สำเร็จ ปรับสถานะเป็นรอคืนเงินและบันทึกการคืนเงินได้

## วิธีรันบนเครื่อง (Docker)

ต้องมี **Docker Desktop** เปิดอยู่ แล้วรันที่รากโปรเจกต์:

```
docker compose up -d --build
```

| | |
|---|---|
| หน้าร้าน | http://localhost:8080 |
| Adminer (ดูฐานข้อมูล) | http://localhost:8081 — System `PostgreSQL` · Server `db` · User/Password `kpop` · Database `kpop_store` |

- ใช้ image เดียวกับที่ Vercel ใช้จริง (php:8.3-apache) และ PostgreSQL 17 รุ่นเดียวกับ Supabase
- ครั้งแรกจะสร้างตารางจาก [`database/schema.sql`](database/schema.sql) แล้วใส่ข้อมูลตัวอย่างจาก [`database/seed.sql`](database/seed.sql) ให้เอง
- โฟลเดอร์ `preorderkpopweb/` ผูกเข้าไปตรง ๆ แก้โค้ดแล้วรีเฟรชหน้าเห็นผลทันที ไม่ต้อง build ใหม่
  (ยกเว้นแก้ `Dockerfile` หรือ `docker-entrypoint.sh` ต้องรัน `docker compose up -d --build` ใหม่)
- `docker compose down` ปิด (ข้อมูลยังอยู่) · `docker compose down -v` ปิดและล้างข้อมูล
  ครั้งต่อไปที่เปิดจะสร้างข้อมูลตั้งต้นใหม่

ค่าเชื่อมต่อฐานข้อมูลมีตัวเดียวคือ `DATABASE_URL` (อ่านใน [`preorderkpopweb/api/config.php`](preorderkpopweb/api/config.php))
รูปแบบเดียวกับ Connection string ที่ Supabase ให้มา: `postgresql://USER:PASSWORD@HOST:PORT/DBNAME`

> MAMP ใช้ไม่ได้แล้ว — MAMP มีแต่ MySQL ส่วนระบบย้ายไป PostgreSQL แล้ว

### บัญชีทดสอบ (เฉพาะฐานข้อมูลบนเครื่อง)

บัญชีเหล่านี้มาจาก `database/seed.sql` ใช้ทดสอบบน Docker เท่านั้น
**ห้ามรัน `seed.sql` บน Supabase ของเว็บจริง** — รหัสผ่านถูกเผยแพร่อยู่ในไฟล์นี้แล้ว

| บทบาท | อีเมล | รหัสผ่าน |
|---|---|---|
| แอดมิน | `admin@kpopstore.com` | `admin123` |
| ลูกค้า | `user@kpopstore.com` | `123456` |
| ลูกค้า | `somi@kpopstore.com` | `123456` |

## Deploy ขึ้นเว็บจริง (Vercel + Supabase)

**📖 คู่มือฉบับเต็มไล่ทีละขั้น: [`docs/DEPLOY.md`](docs/DEPLOY.md)**
(รวมขั้นตอนย้ายข้อมูลและไฟล์จากระบบเดิมบน Railway)

- **ฐานข้อมูล + ไฟล์** อยู่ที่ Supabase — สร้างตารางด้วยการวาง [`database/schema.sql`](database/schema.sql) ใน **SQL Editor** แล้วกด Run · สร้าง Public bucket ชื่อ `uploads`
- **ตัวเว็บ (PHP)** อยู่ที่ Vercel — import repo แล้ว Vercel build จาก `Dockerfile` (`vercel.json` บังคับ Container preset ไว้)
- Environment Variables ที่ Vercel: `DATABASE_URL` (Transaction pooler ของ Supabase) · `SUPABASE_URL` · `SUPABASE_SECRET_KEY` · `APP_ENV=production` (ดู [`.env.example`](.env.example))
- ตั้ง Function Region ของ Vercel ให้ตรงกับ region ของ Supabase (แนะนำสิงคโปร์ทั้งคู่)

## ทดสอบ

```
npm test
```

รันชุดทดสอบตรรกะทั้งหมดโดยไม่ต้องเปิดเบราว์เซอร์และไม่ต้องเปิดฐานข้อมูล
ใช้เวลาไม่ถึง 1 วินาที และไม่ต้อง `npm install` ก่อน (ใช้แต่ของที่มากับ Node)

ชุดทดสอบโหลด `preorderkpopweb/js/store.js` **ตัวจริง** เข้าไปรันใน `localStorage` จำลอง
เป็นไปได้เพราะ `store.js` ตรวจว่ามี `KpopApi` กับ `fetch` หรือไม่:
มี = คุยกับ PHP API · ไม่มี = ใช้ `localStorage` แบบเดิม
**ตรรกะธุรกิจที่ถูกทดสอบจึงเป็นโค้ดชุดเดียวกับที่รันจริงในเบราว์เซอร์**

**รายละเอียดการทดสอบทั้งหมด รวมถึงเช็กลิสต์ที่ต้องไล่กดเองในเบราว์เซอร์ อยู่ใน
[`docs/TESTING.md`](docs/TESTING.md)** — ควรอ่านก่อนส่งงานหรือก่อนแก้โค้ดส่วนสำคัญ

## โครงสร้างไฟล์

```
database/
  schema.sql             โครงสร้างตาราง PostgreSQL — วางใน Supabase SQL Editor ได้ทั้งไฟล์
  seed.sql               ข้อมูลตัวอย่าง (เฉพาะเครื่องพัฒนา — ห้ามรันบนเว็บจริง)
  tools/                 สคริปต์ย้ายข้อมูลจาก MySQL เดิม → Supabase (ดู docs/DEPLOY.md)
preorderkpopweb/
  index.html           หน้าแรก + แคตตาล็อกสินค้า
  product-detail.html  รายละเอียดสินค้า (ดูได้โดยไม่ต้องล็อกอิน)
  cart.html            ตะกร้า แยกกลุ่มตามรอบ (ต้องล็อกอิน)
  checkout.html        เช็คเอาต์ + แนบสลิป (ต้องล็อกอิน)
  order-history.html   ประวัติคำสั่งซื้อของลูกค้า
  login.html           เข้าสู่ระบบ (รองรับ ?next= เด้งกลับหน้าที่ค้างไว้)
  register.html        สมัครสมาชิก
  admin.html           หลังบ้าน 8 แท็บ
  api/                 PHP API ทั้งหมด (PDO + prepared statements)
    config.php           ค่าเชื่อมต่อฐานข้อมูล (DATABASE_URL) — แก้ที่นี่ที่เดียว
    session.php          เก็บ session ล็อกอินในฐานข้อมูล (container บน Vercel ไม่มีดิสก์ถาวร)
    storage.php          เก็บไฟล์อัปโหลด: Supabase Storage บนเว็บจริง · โฟลเดอร์ uploads/ บนเครื่อง
    helpers.php          ตัวช่วยกลาง · ตรวจสิทธิ์ · แปลงแถว DB เป็นรูปทรงฝั่ง JS
    bootstrap.php        ดึงข้อมูลทั้งหมดของหน้าในคำขอเดียว
    auth.php             เข้าสู่ระบบ / สมัคร / ออก / แก้โปรไฟล์
    orders.php · cart.php · products.php · rounds.php
    users.php · notifications.php · upload.php · stats.php
  uploads/             รูปที่อัปโหลดตอนรันบนเครื่อง (เว็บจริงอยู่ใน Supabase Storage)
  js/api.js            ตัวห่อการเรียก API (ต้องโหลดก่อน store.js)
  js/store.js          ข้อมูลและตรรกะทั้งหมด (data layer — ไม่แตะ DOM)
  js/ui.js             navbar · modal · แถบล่างมือถือ (ต้องโหลดหลัง store.js)
  js/pages/<หน้า>.js   โค้ดเฉพาะของแต่ละหน้า (เช่น js/pages/admin.js คู่กับ admin.html)
  css/common.css       สไตล์ที่ทุกหน้าฝั่งร้านค้าใช้ร่วมกัน (body · navbar)
  css/responsive.css   ปรับหน้าจอมือถือ ใช้ทุกหน้า
  css/pages/<หน้า>.css สไตล์เฉพาะของแต่ละหน้า
Dockerfile             image สำหรับ deploy (php:8.3-apache) — ตัวที่ Vercel build จริง
docker-entrypoint.sh   ตั้งพอร์ตตาม PORT + วาง .htaccess คืนให้โฟลเดอร์ uploads ที่ถูก volume บัง
docker-compose.yml     รันทั้งระบบบนเครื่องด้วย Docker (web + PostgreSQL + Adminer) — ไม่ได้ใช้บนเว็บจริง
vercel.json            บังคับให้ Vercel ใช้ Container preset (build จาก Dockerfile) ไม่ใช่เดาเป็น Node app
railway.json           ของระบบเดิมบน Railway — ลบได้หลังปิด Railway (docs/DEPLOY.md ภาค D)
package.json           มีไว้สั่ง npm test อย่างเดียว (ไม่มี dependency)
tests/                 ชุดทดสอบอัตโนมัติ
docs/DEPLOY.md         คู่มือ deploy (Vercel + Supabase) + ย้ายข้อมูล + วิธีใช้เว็บ
docs/TESTING.md        คู่มือทดสอบฉบับเต็ม
```

ลำดับการโหลดสคริปต์ในทุกหน้าคือ `api.js` → `store.js` → `ui.js` → `pages/<หน้า>.js` **ห้ามสลับ**
(ไฟล์ HTML มีแค่โครงหน้า ไม่มี `<style>`/`<script>` ฝังในหน้าแล้ว)

## สถาปัตยกรรม

หน้าเว็บวาดหน้าจอด้วยโค้ดแบบ synchronous (เรียกข้อมูลกลางลูปที่ประกอบ HTML อยู่หลายจุด)
การเปลี่ยนทุกจุดให้เป็น async จึงเท่ากับรื้อการวาดหน้าจอใหม่ทั้งระบบ — เลยใช้วิธีนี้แทน

```
เปิดหน้า → api/bootstrap.php (คำขอเดียว) → เก็บลงหน่วยความจำ
        → KpopStore.ready(fn) ค่อยปล่อยโค้ดวาดหน้าจอของหน้านั้นทำงาน
กดปุ่ม  → await KpopStore.addOrder(...) → POST ไป API → ดึงข้อมูลใหม่มาทับ
```

- **การอ่านข้อมูล** ยังเป็น synchronous เหมือนเดิมทุกบรรทัด อ่านจากที่เก็บในหน่วยความจำ
- **การเขียนข้อมูล** เป็น `async` ยิงไป PHP แล้วค่อยรีเฟรชข้อมูล
- กติกาสำคัญ (โควตา · ราคา · รอบเปิด · สิทธิ์แอดมิน) **ตรวจซ้ำที่ฝั่ง PHP เสมอ**
  ไม่เชื่อตัวเลขที่ส่งมาจากเบราว์เซอร์ โดยเฉพาะเรื่องเงิน

## หมายเหตุสำคัญ

- ระบบล็อกอิน **ตรวจรหัสผ่านจริง** ด้วย `password_hash()` / `password_verify()`
  ไม่มีการสร้างบัญชีอัตโนมัติให้อีกแล้ว — อีเมลที่ยังไม่สมัครจะเข้าไม่ได้
- **ตะกร้าผูกกับบัญชีผู้ใช้** คนละบัญชีบนเครื่องเดียวกันจึงมีตะกร้าคนละใบ
- รูปภาพถูกเก็บเป็น **ไฟล์จริง** (Supabase Storage บนเว็บจริง · `preorderkpopweb/uploads/` บนเครื่อง) ฐานข้อมูลเก็บแค่ URL/path
