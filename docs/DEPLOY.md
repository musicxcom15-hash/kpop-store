# คู่มือขึ้นเว็บ + ย้ายระบบ + วิธีใช้ — KPOP STORE

| ภาค | เรื่อง |
|---|---|
| A | ตั้งค่า Supabase (ฐานข้อมูล + ที่เก็บไฟล์) |
| B | ย้ายข้อมูลจากระบบเดิม (Railway MySQL) |
| C | Deploy ตัวเว็บบน Vercel |
| D | ปิดระบบเดิมบน Railway |
| E | วิธีใช้เว็บ ทั้งฝั่งลูกค้าและหลังบ้าน |
| F | รันบนเครื่องตัวเอง + สำรองข้อมูล + แก้ปัญหา |

---

## ภาพรวมระบบ

```
เบราว์เซอร์ลูกค้า
   │  https
   ▼
Vercel  ── Container Runtime: build จาก Dockerfile (php:8.3-apache) ตัวเดียวกับที่รันบนเครื่อง
   │        ทั้งหน้าเว็บ (HTML/JS/CSS) และ api/*.php อยู่ใน container นี้
   │
   ├──► Supabase Postgres   ข้อมูลทั้งหมด + session ล็อกอิน (ตาราง sessions)
   └──► Supabase Storage    สลิป · รูปสินค้า · หลักฐานการกดสั่ง (bucket "uploads")
```

**ทำไม session และไฟล์ต้องอยู่ Supabase:** container บน Vercel ปิดตัวเองเมื่อไม่มีคนใช้ 5 นาที
และมีได้หลายตัวพร้อมกัน ไฟล์ที่เขียนลงเครื่องไม่ถาวรและมองไม่เห็นข้ามตัว
(เอกสาร Vercel: "Files written inside a function container are not durable or shared between instances")

**ภูมิภาค (region) ต้องอยู่ที่เดียวกัน** — หน้าเว็บหนึ่งหน้าคุยกับฐานข้อมูลหลายรอบ
ถ้า Vercel กับ Supabase อยู่คนละทวีป ทุกหน้าจะช้าลงชัดเจน แนะนำ **สิงคโปร์ทั้งคู่** (ใกล้ลูกค้าในไทยที่สุด)

> ⚠️ **Container Runtime ของ Vercel ยังเป็น Beta** (ใช้ได้ทุกแพ็กเกจรวม Hobby)
> ทางเลือก `vercel-php` (runtime ชุมชน) ถูก archive ไปแล้วเมื่อ 29 ต.ค. 2026 และ Vercel แนะนำ container แทน

---

# ภาค A — ตั้งค่า Supabase

## A1 — สร้างโปรเจกต์

supabase.com → **New project**

- **Region:** `Southeast Asia (Singapore)` — เปลี่ยนทีหลังไม่ได้ ต้องสร้างโปรเจกต์ใหม่
- **Database Password:** ตั้งแล้ว**เก็บในที่ปลอดภัย** (ใช้ในขั้น A4) — ห้ามใส่ในโค้ดหรือ commit

## A2 — สร้างตาราง

**SQL Editor → New query** → เปิดไฟล์ [`database/schema.sql`](../database/schema.sql) ก๊อปทั้งไฟล์มาวาง → **Run**

ตรวจ: **Table Editor** ต้องเห็น 9 ตาราง (`rounds users products orders order_items notifications password_resets cart_items sessions`)
ทุกตารางขึ้นว่าเปิด RLS แล้ว

> ⚠️ `schema.sql` **ลบตารางเดิมทิ้งก่อนสร้างใหม่** — รันซ้ำหลังเปิดใช้จริง = ข้อมูลหายทั้งหมด
>
> 🔒 ทำไมต้องเปิด RLS: Supabase เปิด REST API ให้ทุกตารางอัตโนมัติ และ publishable/anon key ไม่ใช่ความลับ
> ถ้าไม่เปิด RLS ใครมี key ก็อ่านตาราง `users` (รวม hash รหัสผ่าน) ได้ตรง ๆ
> `schema.sql` เปิด RLS ทุกตารางและถอนสิทธิ์ role `anon`/`authenticated` ให้แล้ว
> PHP ต่อเข้ามาเป็นเจ้าของตารางจึงไม่ติด RLS
>
> **ห้ามรัน `database/seed.sql` บน Supabase** — มีบัญชีแอดมินรหัส `admin123` ที่ทุกคนรู้

## A3 — สร้างที่เก็บไฟล์

**Storage → New bucket**

- ชื่อ: `uploads`
- **Public bucket: เปิด** (หน้าเว็บแสดงรูปด้วย URL ตรง ๆ)
- (แนะนำ) Allowed MIME types: `image/jpeg, image/png, image/webp` · File size limit: `3 MB`

> ชื่อไฟล์ที่ระบบตั้งมีส่วนสุ่ม 96 บิต จึงเดา URL ของสลิปคนอื่นไม่ได้
> (เทียบเท่าของเดิมที่โฟลเดอร์ `uploads/` เปิดไฟล์ได้ถ้ารู้ชื่อ แต่ไล่ดูรายชื่อไม่ได้)

## A4 — เก็บค่าที่ต้องใช้ 3 ค่า

| ค่า | หาจากไหน | ใช้เป็นตัวแปร |
|---|---|---|
| Connection string | ปุ่ม **Connect** ด้านบน → **Transaction pooler** → URI (พอร์ต `6543`) แทน `[YOUR-PASSWORD]` ด้วยรหัสจาก A1 แล้วต่อท้าย `?sslmode=require` | `DATABASE_URL` |
| Project URL | **Project Settings → API** (`https://<ref>.supabase.co`) | `SUPABASE_URL` |
| Secret key | **Project Settings → API Keys** → Secret keys (`sb_secret_...`) | `SUPABASE_SECRET_KEY` |

- รหัสผ่านที่มีอักขระพิเศษ (`@ : / ? #` ฯลฯ) ต้อง URL-encode ก่อนใส่ใน URI
- ใช้ **Transaction pooler** เพราะ container บน Vercel เปิด-ปิดบ่อยและมีได้หลายตัว — `config.php` เห็นพอร์ต 6543 แล้วสลับไปใช้ prepared statement แบบจำลองให้เอง (pooler แบบนี้ใช้ของจริงไม่ได้) ถ้าเลือก Session pooler (พอร์ต 5432) ก็ใช้ได้เหมือนกัน
- **Secret key = กุญแจใหญ่ของทั้งโปรเจกต์** เก็บใน Environment Variables ของ Vercel เท่านั้น ห้ามใส่ในโค้ด หน้าเว็บ หรือแชต

---

# ภาค B — ย้ายข้อมูลจากระบบเดิม (Railway MySQL → Supabase)

ทำครั้งเดียวตอนย้ายระบบ ใช้เวลาประมาณ 20–30 นาที **ทำช่วงที่ไม่มีคนสั่งของ**

ต้องมี: Docker Desktop เปิดอยู่ · `railway login` แล้ว · build image ไว้แล้ว (`docker compose build web`) · ทำ A1–A4 เสร็จแล้ว

## B0 — ปิดรับออเดอร์ชั่วคราว

หลังบ้านเว็บเดิม → **จัดการรอบพรีออเดอร์** → ตั้งรอบที่เปิดอยู่ทุกรอบเป็น **ปิดรับ**
กันออเดอร์ใหม่เข้า MySQL เดิมระหว่างย้าย (ออเดอร์ที่เข้ามาหลัง B1 จะไม่ตามมาที่ระบบใหม่)
จดไว้ว่าปิดรอบไหนไปบ้าง จะเปิดคืนในขั้น C5

## B1 — dump ข้อมูลล่าสุดจาก MySQL บน Railway

Git Bash ที่โฟลเดอร์โปรเจกต์ (ต้องเปิด TCP proxy ของ service MySQL ไว้ — ปิดทิ้งหลังทำเสร็จ):

```bash
railway run --service MySQL -- bash -c 'docker run --rm -e MYSQL_PWD="$MYSQLPASSWORD" mysql:9.4 mysqldump -h "$RAILWAY_TCP_PROXY_DOMAIN" -P "$RAILWAY_TCP_PROXY_PORT" -u root --single-transaction --no-tablespaces --set-gtid-purged=OFF "$MYSQLDATABASE"' > /d/kpop-store-backups/railway-$(date +%Y%m%d-%H%M)-final.sql
```

> ไฟล์ dump มีข้อมูลลูกค้า — เก็บใน `D:\kpop-store-backups\` เท่านั้น ห้ามอยู่ใน repo

## B2 — แปลงเป็น SQL ของ PostgreSQL

```bash
bash database/tools/mysql-dump-to-postgres.sh /d/kpop-store-backups/railway-<วันที่>-final.sql
```

สคริปต์เปิด MySQL ชั่วคราวในเครื่อง import dump แล้วเขียนไฟล์ `...-final-postgres.sql` ข้าง ๆ
(บรรทัดสุดท้ายบอกจำนวนแถวต่อตาราง) — ไม่แตะ Railway และไม่แตะ Docker ของเว็บ
ไม่ย้าย: ตาราง `rates` (เลิกใช้แล้ว) และ `password_resets` (ลิงก์หมดอายุใน 30 นาทีอยู่แล้ว)

## B3 — นำเข้า Supabase

**SQL Editor → New query** → เปิดไฟล์ `...-final-postgres.sql` ก๊อปทั้งไฟล์มาวาง → **Run**

- ทั้งไฟล์อยู่ใน transaction เดียว — ถ้าจำนวนแถวไม่ตรงกับต้นทาง หรือตารางมีข้อมูลอยู่แล้ว จะยกเลิกทั้งหมด ไม่มีข้อมูลครึ่ง ๆ กลาง ๆ
- ถ้าขึ้น "ตารางปลายทางมีข้อมูลอยู่แล้ว": รัน `schema.sql` (A2) ใหม่ก่อน แล้วรันไฟล์นี้อีกครั้ง
- ทางเลือกแทน SQL Editor (ไฟล์ใหญ่): `docker run --rm -i postgres:17-alpine psql "$DATABASE_URL" < ไฟล์.sql`

## B4 — ย้ายสลิปและรูปสินค้าขึ้น Supabase Storage

ไฟล์เดิมอยู่ใน volume ของ Railway สคริปต์ดึงผ่าน URL ของเว็บเดิม (ต้องยังเปิดอยู่) แล้วแก้ path ในฐานข้อมูลให้ชี้ที่ใหม่:

```bash
export DATABASE_URL='<จาก A4>'
export SUPABASE_URL='<จาก A4>'
export SUPABASE_SECRET_KEY='<จาก A4>'
export OLD_SITE_URL='https://web-production-6fbe4.up.railway.app'
bash database/tools/copy-uploads-to-storage.sh
```

- ต้องจบด้วย "ย้ายเสร็จ N / N ไฟล์" — ถ้ามีรายการ "ย้ายไม่ได้" รูปนั้นจะแตก (ส่วนใหญ่คือไฟล์ที่หายไปตั้งแต่ก่อนมี volume)
- รันซ้ำได้ ไฟล์ที่ย้ายแล้วจะไม่ถูกย้ายซ้ำ
- ปิดหน้าต่าง Git Bash หลังเสร็จ (ค่า secret อยู่ในตัวแปรของหน้าต่างนั้น)

---

# ภาค C — Deploy บน Vercel

## C1 — import โปรเจกต์

vercel.com → **Add New → Project** → เลือก GitHub repo `kpop-store` → **Import**

- **Root Directory:** รากของ repo (ค่าตั้งต้น)
- **Framework Preset:** ควรขึ้นเป็น Container — `vercel.json` บังคับไว้แล้ว (`"framework": "container"`)
  เพราะใน repo มี `package.json` (ไว้สั่ง `npm test`) ถ้าไม่บังคับ Vercel อาจเดาว่าเป็นแอป Node แล้วรัน PHP ไม่ได้

## C2 — ตั้ง Environment Variables (ก่อนกด Deploy)

| ชื่อ | ค่า |
|---|---|
| `DATABASE_URL` | จาก A4 |
| `SUPABASE_URL` | จาก A4 |
| `SUPABASE_SECRET_KEY` | จาก A4 (ความลับ) |
| `APP_ENV` | `production` |
| `MAIL_PROVIDER` / `MAIL_API_KEY` / `MAIL_FROM` | (ไม่บังคับ) ส่งอีเมลลืมรหัสผ่านจริง — ดูหัวข้อ "ส่งอีเมล" ใน F |

แล้วเปิด **Settings → Environment Variables → Automatically expose System Environment Variables**
(ระบบใช้ `VERCEL_PROJECT_PRODUCTION_URL` สร้างลิงก์รีเซ็ตรหัสผ่านในอีเมล — หรือตั้ง `APP_BASE_URL=https://โดเมนของคุณ` เองแทน)

## C3 — ตั้ง region ให้ตรงกับ Supabase

**Settings → Functions → Function Region** → `Singapore (sin1)` (หรือ region ที่ใกล้ Supabase จาก A1 ที่สุด)
แพ็กเกจ Hobby เลือกได้ 1 region · ค่าตั้งต้นคือ Washington D.C. (`iad1`) ซึ่งไกลจากสิงคโปร์มาก

> ถ้า build/deploy ครั้งแรกเกิดก่อนตั้งค่านี้ ให้ Redeploy หลังตั้ง

## C4 — Deploy แล้วตรวจ

กด **Deploy** (ครั้งต่อไป push ขึ้น `main` แล้ว Vercel deploy เอง)
build log ต้องมี `FROM docker.io/library/php:8.3-apache` — แปลว่าใช้ Dockerfile จริง

ตรวจที่ URL ที่ได้:

| # | ทำอะไร | ต้องได้ | ถ้าไม่ได้ |
|---|---|---|---|
| 1 | เปิด `/api/bootstrap.php` | JSON `"success":true` + สินค้าครบ | ดู Logs: ต่อฐานข้อมูลไม่ได้ → เช็ก `DATABASE_URL` / รหัสผ่าน URL-encode |
| 2 | เปิดหน้าแรก | สินค้า + รูปขึ้น | รูปแตก → B4 ยังไม่ครบ หรือ bucket ไม่ได้ตั้ง Public |
| 3 | ล็อกอินแอดมิน แล้วรีเฟรช / เปิดแท็บใหม่ | ยังล็อกอินอยู่ | ตาราง `sessions` ไม่มี → รัน A2 ไม่ครบ |
| 4 | ลูกค้าแนบสลิปทดสอบ | สลิปขึ้นในหลังบ้าน URL เป็น `...supabase.co/storage/...` | ดู Logs หา `[kpop-storage]` (key ผิด / ไม่มี bucket) |
| 5 | ประวัติสั่งซื้อของลูกค้าเดิม | ออเดอร์เก่าครบ สลิปเก่าเปิดได้ | B3/B4 |
| 6 | `curl "https://<ref>.supabase.co/rest/v1/users?select=*" -H "apikey: <publishable key>"` | `[]` หรือ permission denied — **ห้ามเห็นรายชื่อ** | RLS/สิทธิ์ไม่ได้ตั้ง → รันส่วน "ความปลอดภัยบน Supabase" ท้าย `schema.sql` ใน SQL Editor |

smoke test จากเครื่อง (ใช้บัญชีจริง ไม่ใช่บัญชีตัวอย่าง):

```bash
SMOKE_CUSTOMER_EMAIL=... SMOKE_CUSTOMER_PASSWORD=... SMOKE_SKIP_ADMIN=1 node tests/e2e/smoke.mjs https://<โดเมน-vercel>
```

## C5 — เปิดรับออเดอร์คืน

หลังบ้านเว็บใหม่ → **จัดการรอบพรีออเดอร์** → เปิดรอบที่ปิดไว้ใน B0

---

# ภาค D — ปิดระบบเดิมบน Railway

> ⚠️ ตราบใดที่ service `web` บน Railway ยังผูกกับ GitHub อยู่ **ทุกครั้งที่ push จะ deploy ขึ้น Railway ด้วย**
> โค้ดใหม่ไม่มี `DATABASE_URL` บน Railway → เว็บเก่าจะขึ้น "ระบบขัดข้องชั่วคราว" (ไฟล์ใน `uploads/` ยังเปิดได้ปกติ B4 จึงไม่กระทบ)

1. หลัง C4 ผ่าน: แจ้ง URL ใหม่กับลูกค้า
2. Railway → service `web` → **Settings → Disconnect** repo (หยุด deploy อัตโนมัติ) — เว็บเก่าค้างเป็นโค้ดเดิมไว้ให้ B4 รันซ้ำได้
3. เก็บ service `MySQL` ไว้ 1–2 สัปดาห์เผื่อต้องย้อนกลับ แล้ว dump สำรองครั้งสุดท้ายเก็บไว้ใน `D:\kpop-store-backups\`
4. ลบ project บน Railway (ปิด TCP proxy ของ MySQL ก่อนถ้ายังเปิดอยู่)
5. แจ้ง Claude ให้ลบของที่เหลือจากยุค Railway/MySQL: `railway.json`, `pdo_mysql` ใน `Dockerfile`, สคริปต์ใน `database/tools/`

**ย้อนกลับ (ถ้า Vercel มีปัญหาก่อนข้อ 4):** เชื่อม repo กับ Railway คืน แล้ว deploy commit ก่อนย้ายระบบ —
ข้อมูลที่เกิดบนระบบใหม่หลังย้ายจะไม่ตามกลับไป

---

# ภาค E — วิธีใช้เว็บ

## บัญชี

รหัสผ่านถูกตรวจจริงด้วย `password_verify()` — อีเมลที่ยังไม่สมัครเข้าไม่ได้ ระบบไม่สร้างบัญชีให้อัตโนมัติ
อีเมลไม่สนตัวพิมพ์เล็ก/ใหญ่ (`Somi@x.com` กับ `somi@x.com` คือบัญชีเดียวกัน)

> ⚠️ ข้อมูลที่ย้ายมาจากเว็บเดิมมีบัญชีตัวอย่าง `user@kpopstore.com` / `somi@kpopstore.com` ที่ใช้รหัส `123456`
> (รหัสนี้อยู่ใน repo สาธารณะ) — เปลี่ยนรหัสหรือลบบัญชีทิ้งที่แท็บ **จัดการผู้ใช้งาน** หลังย้ายเสร็จ

## ฝั่งลูกค้า

```
ดูแคตตาล็อก (ไม่ต้องล็อกอิน · กรองตามหมวดได้)
   → เลือกไซซ์ (ถ้ามี) → "เพิ่มลงตะกร้า" หรือ "สั่งซื้อทันที"   ← กำแพงล็อกอินอยู่ตรงนี้
   → ตะกร้า (แยกกลุ่มตามรอบพรีออเดอร์)
   → เช็คเอาต์ + แนบสลิป                                    ← ราคาถูกล็อกทันทีที่แนบ
   → ติดตามสถานะในหน้าประวัติการสั่งซื้อ (มีแจ้งเตือนที่กระดิ่ง)
```

- **ทำไมตะกร้าแยกเป็นกลุ่ม** — ของคนละรอบถึงไทยคนละเวลา จึงคิดค่าส่งแยกรอบ
- **สลิปไม่ผ่านทำยังไง** — สถานะจะเป็น "สลิปไม่ถูกต้อง" แล้วลูกค้าส่งสลิปใบใหม่ได้เองถ้ารอบยังเปิด
- **ยกเลิกได้ถึงเมื่อไหร่** — ยกเลิกเองได้จนถึงก่อนร้านกดสั่งกับเกาหลี หลังจากนั้นต้องคุยกับแอดมิน

## หลังบ้าน (`/admin.html`) — 8 แท็บ

ต้องล็อกอินด้วยบัญชี role `admin` (หน้าเว็บซ่อนปุ่มให้เฉย ๆ ด่านจริงคือ `require_admin()` ฝั่ง PHP)

| แท็บ | ใช้ตอนไหน |
|---|---|
| ภาพรวมระบบ | ยอดขาย จำนวนออเดอร์ ออเดอร์ล่าสุด พื้นที่เก็บไฟล์ |
| ตรวจสอบสลิป | **งานประจำวัน** — ไล่ดูสลิปทีละใบ กดอนุมัติหรือปฏิเสธ |
| คำสั่งซื้อทั้งหมด | แก้สถานะ ใส่เลขพัสดุ บันทึกโน้ต แนบหลักฐานการกดสั่ง |
| จัดการสินค้า | เพิ่ม/แก้/ลบสินค้า หมวดหมู่ ไซซ์ ราคาวอน ค่าบริการ โควตาต่อรอบ ลิงก์ร้านต้นทาง |
| รายงานคำสั่งซื้อ | ยอดต่อสินค้ารายวัน · ดาวน์โหลด Excel |
| จัดการรอบพรีออเดอร์ | เปิด/ปิดรอบ ตั้งวันเปิด-ปิด · ใบสรุปยอดที่ต้องกดสั่ง (แยกไซซ์) |
| จัดการผู้ใช้งาน | ดูรายชื่อ เปลี่ยนบทบาท รีเซ็ตรหัสผ่านให้ลูกค้า |
| แจ้งเตือนลูกค้า | ส่งข้อความถึงลูกค้าคนเดียวหรือทุกคน |

## ลำดับงานจริงของร้าน

```
1. ตั้งรอบพรีออเดอร์                    (จัดการรอบพรีออเดอร์)
2. เพิ่มสินค้า ผูกกับรอบ + ตั้งโควตา      (จัดการสินค้า)
3. ── ลูกค้าสั่งซื้อและแนบสลิป ──
4. ตรวจสลิป อนุมัติทีละใบ                (ตรวจสอบสลิป)
5. ปิดรอบ → เปิดใบสรุปยอด → ไปกดสั่งกับเว็บเกาหลี
6. อัปเดตสถานะจนถึง "จัดส่งสำเร็จ"        (คำสั่งซื้อทั้งหมด)
```

ถ้ากดสั่งไม่สำเร็จ (ของหมด): `ร้านกดสั่งไม่สำเร็จ` → `รอคืนเงิน` → `คืนเงินเรียบร้อยแล้ว`
สามสถานะนี้ไม่นับเข้ายอดขายและคืนโควตาให้รอบทันที

**เรทเงินวอน** เป็นค่าคงที่ 0.028 บาท/วอน ในโค้ด (`CENTRAL_RATE` ใน `api/config.php` และ `js/store.js`)
ไม่มีหน้าให้ตั้ง — เปลี่ยนเรทต้องแก้โค้ดแล้ว deploy · ออเดอร์เก่าเก็บเรทที่ใช้ตอนสั่งไว้ จึงไม่เปลี่ยนตาม

---

# ภาค F — รันบนเครื่อง · สำรองข้อมูล · แก้ปัญหา

## รันบนเครื่องตัวเอง

```
docker compose up -d --build
```

หน้าร้าน http://localhost:8080 · Adminer (ดูฐานข้อมูล) http://localhost:8081
ฐานข้อมูลเป็น PostgreSQL 17 สร้างจาก `schema.sql` + `seed.sql` ให้เอง ไฟล์อัปโหลดอยู่ใน volume ของ Docker
ไม่ต้องมีบัญชี Supabase หรือ Vercel — รายละเอียดใน [README](../README.md)

## เครื่องตัวเอง vs เว็บจริง

| | เครื่องตัวเอง (Docker) | เว็บจริง |
|---|---|---|
| เว็บเซิร์ฟเวอร์ | `php:8.3-apache` ใน Docker | Dockerfile เดียวกัน บน Vercel Container Runtime |
| ฐานข้อมูล | PostgreSQL 17 ใน container `db` | Supabase Postgres |
| ค่าเชื่อมต่อ DB | `DATABASE_URL` ใน docker-compose.yml | `DATABASE_URL` ใน Vercel |
| ข้อมูลตั้งต้น | `schema.sql` + `seed.sql` | `schema.sql` + ข้อมูลที่ย้ายมา (ภาค B) |
| ไฟล์อัปโหลด | volume `uploads` (`uploads/...`) | Supabase Storage (URL เต็ม) |
| session ล็อกอิน | ตาราง `sessions` | ตาราง `sessions` |
| ข้อความ error | ละเอียดเพื่อ debug | ข้อความกลาง ๆ (`APP_ENV=production`) — ของจริงอยู่ใน Logs ของ Vercel |

## สำรองข้อมูล

แพ็กเกจฟรีของ Supabase ไม่ได้ให้ดาวน์โหลด backup ย้อนหลังได้ตามใจ — สำรองเองเป็นระยะ:

```bash
docker run --rm postgres:17-alpine pg_dump --no-owner --no-privileges "$DATABASE_URL" > /d/kpop-store-backups/supabase-$(date +%Y%m%d-%H%M).sql
```

(ใช้ Session pooler พอร์ต 5432 หรือ Direct connection — `pg_dump` ผ่าน Transaction pooler ไม่ได้)
ไฟล์ใน Storage ดาวน์โหลดได้จากหน้า Storage ของ Supabase

## ส่งอีเมล (ลิงก์ลืมรหัสผ่าน)

ส่งผ่าน HTTPS API ของ **Brevo** หรือ **Resend** — ตั้ง `MAIL_PROVIDER` (`brevo`/`resend`), `MAIL_API_KEY`, `MAIL_FROM`
(+ `MAIL_FROM_NAME` ไม่บังคับ) ใน Environment Variables ของ Vercel

- **ยังไม่ตั้ง = เว็บยังใช้ได้:** คำขอลืมรหัสเข้ากล่องแจ้งเตือนแอดมินแทน (แอดมินกดปุ่มกุญแจในแท็บผู้ใช้ → ได้รหัสชั่วคราวไปแจ้งลูกค้า)
- Resend ต้องยืนยันโดเมนของตัวเองก่อน · Brevo ยืนยันอีเมลผู้ส่งที่หน้า Senders
- ทดสอบ: ลืมรหัสผ่าน? → ใส่อีเมลของคุณเอง → ถ้าไม่ได้รับ ดู Logs ของ Vercel หา `[kpop-mail]`

## แก้ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ | ทางแก้ |
|---|---|---|
| ทุกหน้าขึ้น "ระบบขัดข้องชั่วคราว" | ต่อฐานข้อมูลไม่ได้ | Logs ของ Vercel · เช็ก `DATABASE_URL` (รหัสผ่าน URL-encode? `?sslmode=require`?) · โปรเจกต์ Supabase ถูกพักไว้หรือเปล่า |
| เปิดเว็บครั้งแรกขึ้น "กำลังเชื่อมต่อ…" สักพัก | container ตื่นจากการปิดตัวตอนว่าง (cold start) | ปกติ — หน้าเว็บลองซ้ำเองราว 20 วินาที |
| หน้าแรกช้าทุกหน้า | Vercel กับ Supabase อยู่คนละ region | C3 |
| ล็อกอินแล้วหลุดเอง | ตาราง `sessions` ไม่มี / ต่อ DB ไม่ได้ | A2 · ดู Logs |
| แนบสลิปไม่ได้ "บันทึกไฟล์รูปไม่สำเร็จ" | key ผิด / ไม่มี bucket `uploads` | Logs หา `[kpop-storage]` · A3 · A4 |
| รูปเก่าแตก | ยังไม่ได้ย้ายไฟล์ / bucket ไม่ Public | B4 · A3 |
| Vercel build เป็นแอป Node / หา PHP ไม่เจอ | ไม่ได้ใช้ Container preset | เช็ก `vercel.json` (`"framework": "container"`) · Settings → Framework Preset |
| รูปใหญ่ส่งไม่ผ่าน (413) | Vercel รับ request ได้ไม่เกิน 4.5MB | เบราว์เซอร์ย่อรูปให้ก่อนอยู่แล้ว — เกิดได้กับรูปที่ย่อแล้วยังใหญ่มาก |

## ข้อจำกัดที่ควรรู้

- **Vercel Container Runtime ยังเป็น Beta** — ติดตามประกาศของ Vercel
- **Cold start:** ไม่มีคนใช้ 5 นาที container ปิดตัว คนแรกที่เข้ามารอนานกว่าปกติ
- **Supabase แพ็กเกจฟรีพักโปรเจกต์อัตโนมัติเมื่อไม่มีการใช้งานนาน** — ถ้าเว็บขึ้น "ระบบขัดข้อง" ทั้งที่ไม่ได้แก้อะไร ให้เข้าไปกด Restore ที่หน้า Supabase (ดูเงื่อนไขปัจจุบันในหน้าราคาของ Supabase)
- **Vercel Hobby สำหรับใช้ส่วนตัว/ไม่ใช่เชิงพาณิชย์** ตามเงื่อนไขของ Vercel — ถ้าเปิดขายจริงควรดูแพ็กเกจ Pro
