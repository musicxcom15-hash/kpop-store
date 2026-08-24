# KPOP STORE — ระบบรับพรีออเดอร์อัลบั้มเคป็อป

เว็บรับพรีออเดอร์อัลบั้ม K-POP จากเกาหลี
ข้อมูลทั้งหมดเก็บใน **MySQL** เชื่อมผ่าน **PHP API (PDO + prepared statements)**
รันบน **MAMP** ตอนพัฒนา และ deploy ขึ้น **Railway** ด้วย Docker (php:8.3-apache)

## ระบบทำอะไรได้บ้าง

**ฝั่งลูกค้า**
- ดูแคตตาล็อกสินค้าได้โดยไม่ต้องล็อกอิน — แต่กดดูรายละเอียดหรือสั่งซื้อต้องเข้าสู่ระบบก่อน
- ตะกร้าแยกตามรอบพรีออเดอร์ (ของคนละรอบถึงไทยคนละเวลา จึงคิดค่าส่งแยกรอบ)
- แนบสลิปโอนเงินเพื่อยืนยันคำสั่งซื้อ · ยอดเงินถูกล็อกที่เรทวันนั้นทันทีที่แนบสลิป
- ติดตามสถานะพัสดุ ขอยกเลิก และส่งสลิปใบใหม่เมื่อสลิปเดิมไม่ผ่าน

**ฝั่งผู้ดูแล**
- ตรวจและอนุมัติ/ปฏิเสธสลิปทีละใบ
- จัดการสินค้า · รอบพรีออเดอร์ · เรทเงินวอน (กำหนดเอง ปรับรอบใหม่ทุก 22:00 น.)
- ใบสรุปรอบสำหรับถือไปกดสั่งกับเว็บเกาหลี
- กรณีกดของไม่สำเร็จ ปรับสถานะเป็นรอคืนเงินและบันทึกการคืนเงินได้

## วิธีรัน (MAMP + MySQL)

ต้องมี **MAMP** ติดตั้งไว้ (Apache + MySQL + PHP 8) ส่วน Node.js ใช้เฉพาะตอนรันชุดทดสอบ

### 1. ตั้ง Document Root

ตั้ง **Document Root** ให้ชี้มาที่โฟลเดอร์ `preorderkpopweb` ของโปรเจกต์นี้
(เช่น `D:\ProjectPreorder\preorderkpopweb`)

- **MAMP ธรรมดา** — ตั้งได้จากหน้าต่างโปรแกรมโดยตรง
- **MAMP PRO** — ต้องตั้งที่แท็บ **Hosts** → เลือก host `localhost` → ช่อง **Document Root**

> ⚠️ ถ้าใช้ **MAMP PRO** อย่าไปแก้ `C:\MAMP\conf\apache\httpd.conf` เอง
> MAMP PRO เขียนไฟล์ config ของตัวเองทับใหม่ทุกครั้งที่ Start Servers โดยอ่านค่าจาก
> หน้าต่างโปรแกรมเท่านั้น แก้ในไฟล์แล้วจะไม่มีผล และอาการที่เห็นคือเปิด `http://localhost`
> แล้วได้หน้าต้อนรับของ MAMP PRO แทนหน้าร้าน

### 2. เปิดเซิร์ฟเวอร์

กด **Start Servers** ให้ทั้ง Apache และ MySQL ขึ้นสถานะเขียว

### 3. นำเข้าฐานข้อมูล

เปิด **phpMyAdmin** → แท็บ **Import** → เลือกไฟล์ [`database/kpop_store.sql`](database/kpop_store.sql) → กด **Go**

ไฟล์นี้มีคำสั่ง `CREATE DATABASE` ให้แล้ว จึงไม่ต้องสร้างฐานข้อมูลเองก่อน
และ import ซ้ำได้เรื่อย ๆ (มี `DROP TABLE IF EXISTS` นำหน้า) — แต่ข้อมูลเดิมจะหายทุกครั้ง

### 4. เปิดเว็บ

`http://localhost/index.html`

### ถ้าต่อฐานข้อมูลไม่ติด

แก้ค่าเชื่อมต่อได้ที่ [`preorderkpopweb/api/config.php`](preorderkpopweb/api/config.php) ที่เดียว

```php
define('DB_HOST', getenv('MYSQLHOST') ?: '127.0.0.1');
define('DB_NAME', getenv('MYSQLDATABASE') ?: 'kpop_store');
define('DB_USER', getenv('MYSQLUSER') ?: 'root');
define('DB_PASS', getenv('MYSQLPASSWORD') !== false ? getenv('MYSQLPASSWORD') : 'root');
define('DB_PORTS', getenv('MYSQLPORT') ? [(int) getenv('MYSQLPORT')] : [3307, 3306]);
```

ค่าหลัง `?:` คือค่าที่ใช้บนเครื่องตัวเอง ส่วน `getenv('MYSQL*')` มีค่าเฉพาะตอนรันบน Railway
ถ้าพอร์ตของ MAMP ไม่ใช่ 3307 หรือ 3306 ให้เติมเลขพอร์ตจริงไว้ตัวแรกใน `DB_PORTS`

> หมายเหตุ: ไฟล์ `C:\MAMP\conf\mysql\my.ini` อาจเขียนพอร์ตไว้ไม่ตรงกับที่ MySQL ฟังจริง
> ถ้าไม่แน่ใจให้ดูเลขพอร์ตจากหน้าต่าง MAMP โดยตรง

### บัญชีทดสอบ

| บทบาท | อีเมล | รหัสผ่าน |
|---|---|---|
| แอดมิน | `admin@kpopstore.com` | `admin123` |
| ลูกค้า | `user@kpopstore.com` | `123456` |
| ลูกค้า | `somi@kpopstore.com` | `123456` |

## Deploy ขึ้นเว็บจริง (Railway)

### 🌐 เว็บจริง: https://web-production-6fbe4.up.railway.app


**📖 คู่มือฉบับเต็มไล่ทีละขั้น: [`docs/DEPLOY.md`](docs/DEPLOY.md)**
(ครอบคลุมทั้งขั้นตอน deploy · วิธีใช้เว็บ · วิธีกลับมารันบนเครื่อง)

สรุปสั้น ๆ — deploy ด้วย **Dockerfile** ที่รากโปรเจกต์ ไม่ใช่ `server.js`

> `server.js` เสิร์ฟได้แค่ไฟล์ static — **รัน `api/*.php` ไม่ได้**
>
> ⚠️ `railway.json` **ไม่พอ** ที่จะบังคับให้ Railway ใช้ Dockerfile — ของจริงมันตั้ง builder
> เป็น `RAILPACK` แล้วสร้าง image Apache เองที่ MPM ชนกันจน start ไม่ขึ้น (`AH00534`)
> ต้องไปตั้ง **Settings → Build → Dockerfile Path = `Dockerfile`** ที่ตัว service ด้วย
> รายละเอียดอยู่ใน [`docs/DEPLOY.md`](docs/DEPLOY.md)

1. push ขึ้น GitHub (`.gitignore` กัน `node_modules/` และ `uploads/` ไว้แล้ว)
2. railway.app → New Project → Deploy from GitHub repo
3. `+ Create` → Database → **MySQL**
4. ที่ service `web` ตั้ง Variables: `MYSQLHOST` `MYSQLPORT` `MYSQLDATABASE` `MYSQLUSER`
   `MYSQLPASSWORD` (ใช้ค่า `${{MySQL.*}}`) และ `APP_ENV=production`
5. **เพิ่ม Volume ที่ `/var/www/html/uploads`** — ไม่งั้นสลิปหายทุกครั้งที่ deploy
6. Generate Domain แล้ว import [`database/kpop_store_railway.sql`](database/kpop_store_railway.sql)
   (ฉบับตัด `CREATE DATABASE` ออก — **ไม่ใช่** `kpop_store.sql`)
7. เปลี่ยนรหัสแอดมินจาก `admin123`

## ทดสอบ

```
npm test
```

รันชุดทดสอบตรรกะทั้งหมดโดยไม่ต้องเปิดเบราว์เซอร์และไม่ต้องเปิด MAMP
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
  kpop_store.sql         สคริปต์สร้างฐานข้อมูล + ข้อมูลตั้งต้น (import ใน phpMyAdmin บนเครื่องตัวเอง)
  kpop_store_railway.sql ฉบับเดียวกันแต่ตัด CREATE DATABASE ออก (import ขึ้น Railway)
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
    config.php           ค่าเชื่อมต่อฐานข้อมูล — แก้ที่นี่ที่เดียว
    helpers.php          ตัวช่วยกลาง · ตรวจสิทธิ์ · แปลงแถว DB เป็นรูปทรงฝั่ง JS
    bootstrap.php        ดึงข้อมูลทั้งหมดของหน้าในคำขอเดียว
    auth.php             เข้าสู่ระบบ / สมัคร / ออก / แก้โปรไฟล์
    orders.php · cart.php · products.php · rounds.php · rates.php
    users.php · notifications.php · upload.php · stats.php
  uploads/             รูปที่อัปโหลด (สลิป · รูปสินค้า · หลักฐานการกดสั่ง)
  js/api.js            ตัวห่อการเรียก API (ต้องโหลดก่อน store.js)
  js/store.js          ข้อมูลและตรรกะทั้งหมด (data layer — ไม่แตะ DOM)
  js/ui.js             navbar · modal · แถบล่างมือถือ (ต้องโหลดหลัง store.js)
Dockerfile             image สำหรับ deploy (php:8.3-apache) — ตัวที่ Railway ใช้จริง
docker-entrypoint.sh   ตั้งพอร์ตตาม PORT ที่ Railway ฉีดมา + วาง .htaccess คืนให้โฟลเดอร์ uploads ที่ถูก volume บัง
railway.json           บังคับให้ Railway build ด้วย Dockerfile ไม่ใช่เดาเป็น Node app
server.js              express static server (ของเดิม — รัน PHP ไม่ได้ ใช้แค่ตอนเสิร์ฟ static เฉย ๆ)
tests/                 ชุดทดสอบอัตโนมัติ
docs/DEPLOY.md         คู่มือ deploy ขึ้น Railway + วิธีใช้เว็บ + วิธีรันบนเครื่อง
docs/TESTING.md        คู่มือทดสอบฉบับเต็ม
```

ลำดับการโหลดสคริปต์ในทุกหน้าคือ `api.js` → `store.js` → `ui.js` **ห้ามสลับ**

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
- รูปภาพถูกเก็บเป็น **ไฟล์จริง** ใน `preorderkpopweb/uploads/` ฐานข้อมูลเก็บแค่ path
