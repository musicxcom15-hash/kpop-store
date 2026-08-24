# คู่มือขึ้นเว็บ + วิธีใช้ — KPOP STORE

เอกสารนี้ไล่ทีละขั้นจนได้ URL สาธารณะ แล้วต่อด้วยวิธีใช้งานจริง

| ภาค | เรื่อง |
|---|---|
| A | ขึ้นเว็บบน Railway (ขั้น A1–A9) |
| B | วิธีใช้เว็บ ทั้งฝั่งลูกค้าและหลังบ้าน |
| C | กลับมารันบนเครื่องตัวเอง (MAMP PRO) |

---

## สถานะตอนนี้ — ✅ ขึ้นเว็บเรียบร้อยแล้ว

### 🌐 https://web-production-6fbe4.up.railway.app

| รายการ | สถานะ |
|---|---|
| service `web` (php:8.3-apache) | ✅ Online |
| MySQL + ข้อมูลตั้งต้น (8 ตาราง) | ✅ Online |
| Volume ที่ `/var/www/html/uploads` | ✅ ติดแล้ว |
| Domain | ✅ generate แล้ว |
| รหัสแอดมิน | ✅ เปลี่ยนจาก `admin123` แล้ว |
| `uploads/` เปิดตรง ๆ | ✅ ได้ `403` |
| Document Root ใน MAMP PRO (เครื่องตัวเอง) | ⬜ ยังต้องตั้งเอง — ดูภาค C |

---

# ภาค A — ขึ้นเว็บบน Railway

ปลายทางคือ Railway project 1 อัน มี 2 service

```
project
├── web     ← Docker (php:8.3-apache) + Volume ที่ uploads/
└── MySQL   ← ฐานข้อมูล คุยกันผ่าน private network
```

> **ทำไมต้องใช้ Dockerfile:** โปรเจกต์นี้เป็น PHP + Apache ถ้าปล่อยให้ Railway เดาเอง
> มันจะใช้ **Railpack** สร้าง image ของตัวเอง ซึ่งของเวอร์ชันที่เจอมี MPM ของ Apache ชนกัน
> จน Apache ไม่ยอม start เลย (`AH00534`) — และ `railway.json` **ไม่พอ** ที่จะบังคับ
> ต้องไปตั้ง **Dockerfile Path** ที่ตัว service ด้วย (อ่านกล่องแดงในขั้น A3)

## A1 — commit ✅ ทำให้แล้ว

ตั้ง `user.name` / `user.email` แบบเฉพาะ repo นี้ และ commit ไป 57 ไฟล์เรียบร้อย
ตรวจได้ด้วย `git log --oneline`

## A2 — สร้าง repo บน GitHub แล้ว push

1. ไปที่ **github.com → New repository**
2. ตั้งชื่อ เช่น `kpop-store`
3. ⚠️ **อย่าติ๊ก** "Add a README file", "Add .gitignore", "Choose a license"
   — repo ต้องว่างเปล่า ไม่งั้นจะชนกับไฟล์ที่ commit ไว้แล้ว แล้ว push ไม่ผ่าน
4. กด **Create repository** แล้วก๊อป URL ที่ได้

จากนั้นรันในโฟลเดอร์โปรเจกต์:

```bash
git remote add origin https://github.com/<username>/<ชื่อ-repo>.git
git push -u origin main
```

> ถ้า push แล้วถูกถามรหัสผ่าน: GitHub ไม่รับรหัสผ่านบัญชีแล้ว ต้องใช้ **Personal Access Token**
> (GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
> → Generate new token → ติ๊กสิทธิ์ `repo`) แล้วเอา token มาวางแทนรหัสผ่าน

## A3 — สร้าง project บน Railway

> ⚠️ **ทำขั้นนี้หลัง A2 push สำเร็จแล้วเท่านั้น**
> Railway อ่าน commit ตอนที่เชื่อม repo ถ้าสร้าง project ตอน repo ยังว่าง จะติดค้างที่ข้อความ
> `Could not find latest commit for repo` หรือ `Branch 'main' not found` ทันที
> และไม่มีปุ่มไหนในหน้า Railway แก้ได้ ต้อง push ก่อนอย่างเดียว
> ถ้าเผลอสร้างไปแล้ว ลบทิ้ง (Settings → Danger → Delete Project) แล้วสร้างใหม่หลัง push ง่ายกว่ามานั่งไล่แก้

**railway.app → New Project → Deploy from GitHub repo → เลือก repo ที่เพิ่ง push**

Railway จะเริ่ม build ทันที

> ### 🔴 กับดักตัวจริงที่เจอตอนทำ — Railway ไม่ใช้ Dockerfile ให้อัตโนมัติ
>
> ตอน deploy จริงพบว่า Railway ตั้ง builder เป็น **`RAILPACK`** และ **ไม่อ่าน `railway.json`**
> (`railwayConfigFile: null`) Railpack เห็นว่าเป็นโปรเจกต์ PHP แล้วสร้าง image Apache ของตัวเอง
> ที่มี MPM ชนกัน → Apache ตายด้วย `AH00534: More than one MPM loaded.` วนไม่หยุด
>
> อาการหลอกมาก เพราะแก้ `Dockerfile` เท่าไหร่ก็ไม่มีอะไรเปลี่ยน — **ไฟล์นั้นไม่ได้ถูกใช้เลย**
>
> **วิธีเช็ก:** build log ที่ใช้ Dockerfile จริงจะขึ้น `[internal] load build definition from Dockerfile`
> และ `FROM docker.io/library/php:8.3-apache` ถ้าไม่เห็นสองบรรทัดนี้ = ไม่ได้ใช้ Dockerfile
>
> **วิธีแก้:** service `web` → **Settings → Build** → ตั้ง **Dockerfile Path** = `Dockerfile`
> แล้ว Redeploy (ทำผ่าน CLI ก็ได้ ดูหัวข้อ "ทำผ่าน Railway CLI" ท้ายเอกสาร)
>
> `railway.json` ยังใช้ได้ถึง **2026-12-01** แต่ Railway แนะนำให้ย้ายไป `.railway/railway.ts`
> (`railway config migrate`) — ของโปรเจกต์นี้ตั้งค่าที่ตัว service ไปแล้ว จึงไม่ต้องพึ่งไฟล์นั้น

> ⚠️ **deploy รอบแรกจะพัง — เป็นเรื่องปกติ ไม่ต้องไปรื้อ Dockerfile**
> เพราะยังไม่มี MySQL service ให้ต่อ ตัว image build ผ่านแต่ทุก request จะขึ้น error
> เดี๋ยวหายเองหลังทำขั้น A4–A5 เสร็จ
> (คนละเรื่องกับ error ด้านบน — อันนี้แปลว่า Railway เจอโค้ดแล้วและกำลังทำงานอยู่)

## A4 — เพิ่ม MySQL

ในหน้า project กด **`+ Create` → Database → MySQL**

รอจนขึ้นสถานะเขียว แล้วจะมี service ชื่อ `MySQL` โผล่มาข้าง ๆ service ของเว็บ

> 📌 **เรื่องชื่อ service:** Railway ตั้งชื่อ service ตามชื่อ repo ให้อัตโนมัติ ของโปรเจกต์นี้จึงชื่อ
> **`kpop-store`** ไม่ใช่ `web` เอกสารนี้เรียกมันว่า `web` เพื่อให้อ่านง่าย —
> เจอคำว่า `web` ที่ไหนให้หมายถึง **service ที่ชื่อตาม repo ของคุณ** (อีกอันคือ `MySQL`)
> จะเปลี่ยนชื่อให้เป็น `web` จริง ๆ ก็ได้ที่ Settings → Service Name

## A5 — ตั้ง Variables ที่ service `web`

คลิก service **`web`** → แท็บ **Variables** → ใส่ทีละตัว **6 ตัว**

| ชื่อตัวแปร | ค่า |
|---|---|
| `MYSQLHOST` | `${{MySQL.MYSQLHOST}}` |
| `MYSQLPORT` | `${{MySQL.MYSQLPORT}}` |
| `MYSQLDATABASE` | `${{MySQL.MYSQLDATABASE}}` |
| `MYSQLUSER` | `${{MySQL.MYSQLUSER}}` |
| `MYSQLPASSWORD` | `${{MySQL.MYSQLPASSWORD}}` |
| `APP_ENV` | `production` |

ค่า `${{MySQL.…}}` ให้ **พิมพ์ตรง ๆ แบบนั้นเลย** — Railway จะแทนค่าจริงให้เอง
ข้อดีคือถ้ารหัสผ่านฐานข้อมูลเปลี่ยน ค่าตรงนี้ตามให้อัตโนมัติ ไม่ต้องมาแก้เอง

> `APP_ENV=production` มีผลจริง: ทำให้ข้อความ error ที่เคยบอก host/port/ชื่อฐานข้อมูล
> ไม่ถูกส่งออกไปหน้าเว็บอีก (ไปโผล่ในแท็บ Logs แทน)

## A6 — เพิ่ม Volume

**`web` → Settings → Volumes → Add Volume** → ช่อง Mount path ใส่:

```
/var/www/html/uploads
```

> ⚠️ **ทำขั้นนี้ก่อนเปิดให้คนอื่นใช้** ระบบไฟล์ของคอนเทนเนอร์หายทุกครั้งที่ deploy ใหม่
> ถ้ามาเพิ่ม volume ทีหลัง สลิปและรูปสินค้าที่อัปโหลดไปแล้วจะหายหมด และ path ที่เก็บใน
> ฐานข้อมูลจะชี้ไปยังไฟล์ที่ไม่มีอยู่ (หน้าเว็บขึ้นรูปแตก)

## A7 — เปิด domain

**`web` → Settings → Networking → Generate Domain**

จะได้ URL หน้าตาแบบ `https://xxxx.up.railway.app` — นี่คือลิงก์ที่เอาไปส่งอาจารย์

## A8 — import ฐานข้อมูล (ทำครั้งเดียว)

ต้องใช้ไฟล์ **`database/kpop_store_railway.sql`** — ⚠️ **ไม่ใช่ `kpop_store.sql`**
(ตัวเดิมมีคำสั่ง `CREATE DATABASE` ซึ่ง Railway ไม่ให้สิทธิ์ user ทำ จะ error ทันที)

**หาค่าเชื่อมต่อ:** คลิก service `MySQL` → แท็บ **Variables** → ดูค่าฝั่ง **public / proxy**
(`RAILWAY_TCP_PROXY_DOMAIN`, `RAILWAY_TCP_PROXY_PORT`, `MYSQLPASSWORD`)

### วิธีที่ 1 — command line (แนะนำ)

เปิด PowerShell ที่โฟลเดอร์โปรเจกต์ แล้วรัน (แทนค่าในวงเล็บมุม):

```powershell
& "C:\MAMP\bin\mysql\bin\mysql.exe" -h <proxy-domain> -P <proxy-port> -u root -p --default-character-set=utf8mb4 railway -e "source database/kpop_store_railway.sql"
```

แล้วพิมพ์รหัสผ่านที่ก๊อปมาจาก `MYSQLPASSWORD`

> `--default-character-set=utf8mb4` สำคัญ ไม่ใส่แล้วชื่อศิลปิน/สินค้าภาษาไทยจะเพี้ยน

### วิธีที่ 2 — ไม่อยากใช้ command line

คลิก service `MySQL` → แท็บ **Data** → **Query** → เปิดไฟล์
`database/kpop_store_railway.sql` ด้วย Notepad → ก๊อปทั้งไฟล์ไปวาง → กดรัน

> ⚠️⚠️ ไฟล์นี้ขึ้นต้นด้วย `DROP TABLE IF EXISTS` ทุกตาราง
> **รันซ้ำหลังเปิดใช้จริง = ออเดอร์ บัญชีลูกค้า และสลิปทั้งหมดหายเกลี้ยง**
> ให้รันครั้งเดียวตอนตั้งค่าเท่านั้น

## A9 — เปลี่ยนรหัสแอดมิน

รหัส `admin123` ที่มากับข้อมูลตั้งต้นใช้บนเว็บสาธารณะไม่ได้ — ใครก็เดาได้และเข้าหลังบ้านได้ทันที

สร้าง hash ก่อน (ใช้ php ที่มากับ MAMP):

```powershell
& "C:\MAMP\bin\php\php8.3.1\php.exe" -r "echo password_hash('รหัสใหม่ของคุณ', PASSWORD_DEFAULT);"
```

แล้วเอา hash ที่ได้ไปรันใน Query editor ของ Railway:

```sql
UPDATE users SET password_hash = '<hash ที่ได้>' WHERE email = 'admin@kpopstore.com';
```

## เช็กว่าสำเร็จจริง

เปิด URL ที่ได้จาก A7 แล้วไล่ 6 ข้อนี้

| # | ทำอะไร | ต้องได้ | ถ้าไม่ได้แปลว่า |
|---|---|---|---|
| 1 | เปิดหน้าแรก | สินค้าขึ้นครบ 4 รายการ | PHP ไม่ถูกรัน — เช็กว่า Railway ใช้ Dockerfile จริง |
| 2 | F12 → Network → `api/bootstrap.php` | `200` + `application/json` | ถ้าเป็น `text/html` แปลว่าโดนเสิร์ฟเป็นไฟล์ธรรมดา |
| 3 | ล็อกอิน แล้ว refresh | ยังล็อกอินอยู่ | คุกกี้ `secure` ตั้งผิด |
| 4 | แนบสลิป → **Redeploy** → เปิดออเดอร์เดิม | รูปยังอยู่ | ลืมตั้ง Volume (A6) |
| 5 | แอดมินตั้งเรทใหม่ ณ เวลาปัจจุบัน → refresh | ราคาขยับทันที | เขตเวลาเพี้ยน 7 ชั่วโมง |
| 6 | เปิด `<domain>/uploads/` ตรง ๆ | `403` | โฟลเดอร์สลิปเปิดโล่ง — อันตราย |

## แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ | ทางแก้ |
|---|---|---|
| เปิดเว็บแล้วเห็นโค้ด PHP เป็นตัวหนังสือ | Railway build เป็น Node app | เช็กว่า `railway.json` ถูก push ขึ้นไปแล้ว → Redeploy |
| ทุกหน้าขึ้น "ระบบขัดข้องชั่วคราว" | ต่อฐานข้อมูลไม่ได้ | ดูแท็บ **Logs** ของ `web` · เช็ก Variables ทั้ง 6 ตัว · ยัง import (A8) หรือยัง |
| สินค้าไม่ขึ้นแต่ไม่มี error | ยังไม่ได้ import | ทำขั้น A8 |
| ชื่อสินค้าเป็น `???` | import โดยไม่ได้ระบุ charset | import ใหม่พร้อม `--default-character-set=utf8mb4` |
| ล็อกอินแล้วเด้งออกทันที | คุกกี้ session ถูกทิ้ง | เปิดผ่าน `https://` ไม่ใช่ `http://` |
| รูปหายหลัง deploy | ไม่มี Volume | ทำขั้น A6 (รูปเดิมกู้ไม่ได้) |

---

# ภาค B — วิธีใช้เว็บ

## บัญชีตั้งต้น

| บทบาท | อีเมล | รหัสผ่าน |
|---|---|---|
| ผู้ดูแลระบบ | `admin@kpopstore.com` | `admin123` → **เปลี่ยนแล้วตามขั้น A9** |
| ลูกค้า (สมชาย) | `user@kpopstore.com` | `123456` |
| ลูกค้า (โซมี) | `somi@kpopstore.com` | `123456` |

> รหัสผ่านถูกตรวจจริงด้วย `password_verify()` — อีเมลที่ยังไม่สมัครจะเข้าไม่ได้
> และระบบไม่สร้างบัญชีให้อัตโนมัติ

## ฝั่งลูกค้า

```
ดูแคตตาล็อก (ไม่ต้องล็อกอิน)
   → กด "เพิ่มลงตะกร้า" หรือ "สั่งซื้อทันที"   ← กำแพงล็อกอินอยู่ตรงนี้
   → ตะกร้า (แยกกลุ่มตามรอบพรีออเดอร์)
   → เช็คเอาต์ + แนบสลิป                      ← เรทถูกล็อกที่ค่าวันนั้นทันทีที่แนบ
   → ติดตามสถานะในหน้าประวัติการสั่งซื้อ
```

จุดที่คนใช้มักสงสัย:

- **ทำไมตะกร้าแยกเป็นกลุ่ม** — ของคนละรอบถึงไทยคนละเวลา จึงคิดค่าส่งแยกรอบ
- **เรทล็อกตอนไหน** — ตอนแนบสลิป ไม่ใช่ตอนกดสั่ง หลังจากนั้นเรทขยับก็ไม่กระทบใบนั้น
- **สลิปไม่ผ่านทำยังไง** — สถานะจะเป็น "สลิปไม่ถูกต้อง" แล้วลูกค้าส่งสลิปใบใหม่ได้เอง
- **ยกเลิกได้ถึงเมื่อไหร่** — ยกเลิกเองได้จนถึงก่อนร้านกดสั่งกับเกาหลี หลังจากนั้นต้องคุยกับแอดมิน
- **ตะกร้าผูกกับบัญชี** ล็อกอินคนละบัญชีบนเครื่องเดียวกันจะเห็นตะกร้าคนละใบ

## หลังบ้าน (`/admin.html`) — 8 แท็บ

ต้องล็อกอินด้วยบัญชี role `admin` ก่อนถึงจะเข้าได้
(หน้าเว็บซ่อนปุ่มให้เฉย ๆ ด่านจริงอยู่ที่ `require_admin()` ฝั่ง PHP ยิง endpoint ตรงก็ไม่ผ่าน)

| แท็บ | ใช้ตอนไหน |
|---|---|
| ภาพรวมระบบ | ดูยอดขาย จำนวนออเดอร์ ของที่ต้องจัดการวันนี้ |
| ตรวจสอบสลิป | **งานประจำวัน** — ไล่ดูสลิปทีละใบ กดอนุมัติหรือปฏิเสธ |
| คำสั่งซื้อทั้งหมด | แก้สถานะ ใส่เลขพัสดุ บันทึกโน้ต แนบหลักฐานการกดสั่ง |
| จัดการสินค้า | เพิ่ม/แก้/ลบสินค้า ตั้งราคาวอน ค่าบริการ โควตาต่อรอบ |
| จัดการรอบพรีออเดอร์ | เปิด/ปิดรอบ ตั้งวันเปิด-ปิด กำหนดวันของถึงไทย |
| เรทเงินวอน | ตั้งเรทใหม่ ดูประวัติเรทย้อนหลัง |
| จัดการผู้ใช้งาน | ดูรายชื่อลูกค้า เปลี่ยนบทบาท |
| แจ้งเตือนลูกค้า | ส่งข้อความถึงลูกค้า |

## ลำดับงานจริงของร้าน

```
1. ตั้งรอบพรีออเดอร์                  (แท็บ จัดการรอบพรีออเดอร์)
2. ตั้งเรทเงินวอนของวันนั้น            (แท็บ เรทเงินวอน)
3. เพิ่มสินค้า ผูกกับรอบ + ตั้งโควตา    (แท็บ จัดการสินค้า)
4. ── ลูกค้าสั่งซื้อและแนบสลิป ──
5. ตรวจสลิป อนุมัติทีละใบ              (แท็บ ตรวจสอบสลิป)
6. ปิดรอบ                             (แท็บ จัดการรอบพรีออเดอร์)
7. เอาใบสรุปรอบไปกดสั่งกับเว็บเกาหลี
8. อัปเดตสถานะจนถึง "จัดส่งสำเร็จ"      (แท็บ คำสั่งซื้อทั้งหมด)
```

**ถ้ากดสั่งกับเกาหลีไม่สำเร็จ (ของหมด):**
`ร้านกดสั่งไม่สำเร็จ` → `รอคืนเงิน` → `คืนเงินเรียบร้อยแล้ว`
สามสถานะนี้ไม่นับเข้ายอดขายและคืนโควตาให้รอบทันที

## เรื่องเรท 22:00

ระบบ **ไม่มี cron** — เรทที่มีผลคือ "แถวล่าสุดที่ `effective_from` ถึงเวลาแล้ว"
(ดู `current_rate()` ใน `preorderkpopweb/api/helpers.php`)

ผลที่ได้คือ **ตั้งเรทล่วงหน้าได้** เช่นตั้งตอนบ่ายให้มีผล 22:00 คืนนี้ พอถึงเวลาระบบสลับเอง
ไม่ต้องมานั่งกดตอนสี่ทุ่ม

## ข้อจำกัดที่ควรรู้ตอนใช้จริง

- **deploy ใหม่ทีไร ทุกคนหลุดล็อกอิน** — session เก็บเป็นไฟล์ในคอนเทนเนอร์ซึ่งหายตอน deploy
  (ตะกร้ากับออเดอร์ไม่หาย เพราะอยู่ในฐานข้อมูล) เว็บระดับเดโมยอมรับได้
- **ห้ามเพิ่ม replica เกิน 1** ด้วยเหตุผลเดียวกัน — `railway.json` ล็อก `numReplicas: 1` ไว้แล้ว
- **Railway ไม่มี free tier** — Trial ให้เครดิต $5 หลังจากนั้น Hobby $5/เดือน

---

# ภาค C — กลับมารันบนเครื่องตัวเอง (MAMP PRO)

โค้ดที่แก้ไปเพื่อขึ้น Railway **ไม่กระทบการรันบนเครื่อง**
`api/config.php` จะตกไปใช้ค่า MAMP เดิม (`root/root @ 127.0.0.1`) เมื่อไม่เจอ environment variable

## ฐานข้อมูล ✅ import ให้แล้ว

`kpop_store` มีครบ 8 ตารางพร้อมข้อมูลตั้งต้น (สินค้า 4 · ผู้ใช้ 3 · ออเดอร์ 3 · รอบ 3 · เรท 1)

อยากรีเซ็ตกลับเป็นค่าตั้งต้นเมื่อไหร่ ให้รันซ้ำ:

```powershell
& "C:\MAMP\bin\mysql\bin\mysql.exe" -h 127.0.0.1 -P 3306 -u root -proot --default-character-set=utf8mb4 -e "source database/kpop_store.sql"
```

## ⬜ ที่ยังต้องทำ — ตั้ง Document Root ใน MAMP PRO

**นี่คือเหตุผลที่เปิด `http://localhost` ตอนนี้แล้วเจอหน้า MAMP PRO แทนหน้าร้าน**

1. เปิดโปรแกรม **MAMP PRO**
2. ไปแท็บ **Hosts**
3. เลือก host `localhost` (ถ้ายังไม่มีให้กด `+` สร้าง)
4. ช่อง **Document Root** กดเลือกโฟลเดอร์ → `D:\ProjectPreorder\preorderkpopweb`
5. กด **Stop** แล้ว **Start Servers** ใหม่ (ต้อง restart ค่าถึงจะมีผล)

> ⚠️ **อย่าไปแก้ `C:\MAMP\conf\apache\httpd.conf`**
> ค่าในไฟล์นั้นชี้มาที่โปรเจกต์ถูกต้องอยู่แล้ว แต่เว็บก็ยังไม่ขึ้น เพราะ **MAMP PRO
> เขียนไฟล์ config ของตัวเองทับใหม่ทุกครั้งที่ Start Servers** โดยอ่านค่าจากหน้าต่างโปรแกรมเท่านั้น
> แก้ในไฟล์เท่าไหร่ก็ไม่มีผล (ข้อนี้ต่างจาก MAMP รุ่นธรรมดา)

## เช็กว่าสำเร็จ

| เปิด | ต้องได้ |
|---|---|
| `http://localhost/index.html` | หน้าร้าน มีสินค้า 4 รายการ |
| `http://localhost/api/bootstrap.php` | ข้อความ JSON (ไม่ใช่หน้า 404 ของ MAMP) |
| ล็อกอิน `user@kpopstore.com` / `123456` | เข้าได้ |

## ชุดทดสอบ

```
npm test
```

รันได้เลยโดย **ไม่ต้องเปิด MAMP** และไม่ต้อง `npm install` ก่อน (ใช้แต่ของที่มากับ Node)
รายละเอียดอยู่ใน [`docs/TESTING.md`](TESTING.md)

## เครื่องตัวเอง vs Railway ต่างกันตรงไหน

| | เครื่องตัวเอง (MAMP PRO) | Railway |
|---|---|---|
| เว็บเซิร์ฟเวอร์ | Apache ของ MAMP PRO | Apache ใน Docker (`php:8.3-apache`) |
| ไฟล์ SQL ที่ใช้ | `kpop_store.sql` | `kpop_store_railway.sql` |
| ชื่อฐานข้อมูล | `kpop_store` | `railway` |
| ค่าเชื่อมต่อ DB | ค่า default ใน `config.php` | environment variable `MYSQL*` |
| รูปที่อัปโหลด | `preorderkpopweb/uploads/` | Volume ที่ `/var/www/html/uploads` |
| ข้อความ error | บอกละเอียดเพื่อ debug | ข้อความกลาง ๆ (`APP_ENV=production`) |
| เขตเวลา | ตาม php.ini ของ MAMP | `Asia/Bangkok` (ตั้งใน Dockerfile) |


---

# ภาคผนวก — ทำผ่าน Railway CLI

ทั้งหมดในภาค A ทำผ่าน CLI ได้โดยไม่ต้องกดหน้าเว็บ ยกเว้นการ login ครั้งแรก

```bash
npm install -g @railway/cli
railway login                       # หรือ --browserless ถ้าเปิดเบราว์เซอร์เองไม่ได้

railway init --name kpop-store
railway add --service web --repo <user>/<repo> --branch main
railway add --database mysql

railway variables --service web   --set 'MYSQLHOST=${{MySQL.MYSQLHOST}}'   --set 'MYSQLPORT=${{MySQL.MYSQLPORT}}'   --set 'MYSQLDATABASE=${{MySQL.MYSQLDATABASE}}'   --set 'MYSQLUSER=${{MySQL.MYSQLUSER}}'   --set 'MYSQLPASSWORD=${{MySQL.MYSQLPASSWORD}}'   --set 'APP_ENV=production'

railway volume --service <SERVICE_ID> add --mount-path /var/www/html/uploads
railway domain --service web
railway redeploy --service web --yes
railway logs --build --service web        # ดู build log
railway logs --deployment --service web   # ดู runtime log
```

## กับดักของ CLI ที่เจอมาแล้ว

| อาการ | สาเหตุ / ทางแก้ |
|---|---|
| `Builder` enum ไม่มีค่า `DOCKERFILE` | Railway ไม่ได้มองว่า Dockerfile เป็น builder — ตั้งผ่าน `dockerfilePath` ที่ service แทน |
| `railway volume add --service web` → `unexpected argument` | `--service` ต้องอยู่ **ก่อน** `add` และต้องเป็น **Service ID** ไม่ใช่ชื่อ ไม่งั้น CLI panic |
| `Mount path must start with a /` ทั้งที่ใส่ `/` แล้ว | Git Bash บน Windows แปลง `/var/...` เป็น Windows path — นำหน้าด้วย `MSYS_NO_PATHCONV=1` |
| `railway connect --tunnel-only` บอกว่าไม่มี SSH key | ต้องมี key ใน `~/.ssh` — หรือเปิด TCP proxy ให้ MySQL แทนแล้วต่อตรง |
| import ด้วย mysql client ของ MAMP → `SSL connection error` | client 5.7 คุย TLS กับ MySQL 9 ไม่ได้ — ใช้ Node + `mysql2` แทน ดีกว่าปิด SSL เพราะรหัสผ่านจะไม่วิ่งเป็น plaintext |

> เปิด TCP proxy ให้ MySQL ไว้ชั่วคราวตอน import ได้ **แต่ปิดทิ้งหลังใช้เสร็จ**
> ไม่งั้น MySQL จะเปิดรับ connection จากอินเทอร์เน็ตด้วยบัญชี root ตลอดเวลา
