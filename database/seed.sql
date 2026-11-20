-- =====================================================================
-- KPOP STORE — ข้อมูลตัวอย่างสำหรับเครื่องพัฒนาเท่านั้น (PostgreSQL)
--
-- ห้ามรันบน Supabase ของเว็บจริง: มีบัญชีที่ทุกคนรู้รหัส
--   admin@kpopstore.com  =>  admin123
--   user@kpopstore.com   =>  123456
--   somi@kpopstore.com   =>  123456
--
-- docker compose รันไฟล์นี้ต่อจาก schema.sql ให้เองตอนสร้าง DB ครั้งแรก
-- ข้อมูลถอดมาจาก DEFAULT_* ใน preorderkpopweb/js/store.js
-- =====================================================================

-- รอบพรีออเดอร์ — วันที่สัมพัทธ์กับวันที่ import เพื่อให้มีรอบที่ "เปิดรับอยู่" เสมอ
-- คอลัมน์: id, ชื่อรอบ, ชนิด (korean-site = กดสั่งเว็บเกาหลี / shipping = ร้านไปหิ้วเอง), วันเปิด, วันปิด, สถานะ, กำหนดส่ง, หมายเหตุ
INSERT INTO rounds (id, name, type, open_at, close_at, status, est_delivery, note) VALUES
-- รอบเว็บเกาหลี: เปิดมาแล้ว 3 วัน ปิดอีก 4 วัน (สถานะ open → ลูกค้าสั่งได้)
('round-kr',     'รอบพรีออเดอร์เว็บเกาหลี (Weverse / Ktown4u)', 'korean-site',
 CURRENT_DATE - 3, CURRENT_DATE + 4, 'open',
 'ประมาณ 3-5 สัปดาห์หลังปิดรอบ', 'ร้านจะรวบรวมยอดแล้วกดสั่งกับเว็บ Official หลังปิดรอบ'),
-- รอบหิ้วหน้าร้าน: เปิดเมื่อวาน ปิดอีก 9 วัน
('round-ship',   'รอบหิ้วหน้าร้าน + ชิปรวมกลับไทย', 'shipping',
 CURRENT_DATE - 1, CURRENT_DATE + 9, 'open',
 'ประมาณ 2-3 สัปดาห์หลังปิดรอบ', 'รอบนี้ร้านเดินทางไปหิ้วหน้าร้านที่เกาหลีเอง'),
-- รอบสำรองที่เปิดตลอด (2000–2999) สำหรับข้อมูลที่สร้างก่อนมีระบบรอบ
('round-legacy', 'รอบทั่วไป (ข้อมูลก่อนมีระบบรอบ)', 'korean-site',
 '2000-01-01', '2999-12-31', 'open',
 '7 - 14 วัน', 'รอบสำรองสำหรับสินค้า/ออเดอร์ที่สร้างไว้ก่อนระบบรอบจะมี');

-- ผู้ใช้ (bcrypt สร้างจาก password_hash() — รหัสอยู่ที่หัวไฟล์)
-- คอลัมน์: id, ชื่อ, อีเมล, hash รหัสผ่าน (bcrypt), เบอร์, ที่อยู่, บทบาท, วันที่สมัคร
INSERT INTO users (id, name, email, password_hash, phone, address, role, created_at) VALUES
-- บัญชีแอดมิน — รหัส admin123
('u-admin', 'ผู้ดูแลระบบ (Admin)', 'admin@kpopstore.com',
 '$2y$10$0NFVqDF6EgvSDOHx7TS6Luoc.tjVX2fDQzgsxurOTbWdgd.pLieNO',
 '080-000-0000', 'ศูนย์ประสานงาน KPOP STORE กรุงเทพมหานคร', 'admin', '2026-01-01'),
-- ลูกค้าคนที่ 1 (สมชาย) — รหัส 123456 · เจ้าของออเดอร์ตัวอย่าง 2 ใบ
('u-customer1', 'คุณสมชาย ใจดี', 'user@kpopstore.com',
 '$2y$10$wLaINlQci2H2VxlTUOUgxODrQ8c1p.ZNWdPmbEGCXvgFP88T.nmt2',
 '081-234-5678', '123/45 หมู่บ้านตัวอย่าง ซ.สุขุมวิท 1 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
 'customer', '2026-06-15'),
-- ลูกค้าคนที่ 2 (โซมี) — รหัส 123456 · เจ้าของออเดอร์ที่จัดส่งสำเร็จแล้ว
('u-customer2', 'คุณโซมี รักเคป็อป', 'somi@kpopstore.com',
 '$2y$10$tNWop.UCd442R1rOU16OlOJhzQur8zDCP8x7hHrNkBNUrUZlS.MqW',
 '089-876-5432', '88/9 คอนโดสยาม ถนนพญาไท เขตราชเทวี กรุงเทพมหานคร 10400',
 'customer', '2026-07-01');

-- สินค้า
-- คอลัมน์: id, ศิลปิน, ชื่อสินค้า, ราคาวอน, ค่าบริการหิ้ว (บาท), ราคาบาทเดิม (สำรอง), รอบ, โควตาต่อรอบ, รูป, ป้ายสถานะ, กำหนดส่ง, รายละเอียด
-- ไม่ได้ระบุ category / sizes → ได้ค่าตั้งต้น (อัลบั้ม, ไม่มีไซซ์)
INSERT INTO products (id, artist, title, price_krw, service_fee, price,
                      round_id, quota_per_round, image, status, est_delivery, description) VALUES
-- อัลบั้ม BTS: ₩27,000 + ค่าบริการ ฿174 → ราคาขาย ฿930 · รอบเว็บเกาหลี · โควตา 50
('bts', 'BTS', 'BTS - Map of the Soul: 7 Album (Pre-order)', 27000, 174, 890,
 'round-kr', 50, 'images/mapsoul7.jpg', 'PRE-ORDER', '7 - 14 วัน หลังปิดรอบประจำวัน',
 'อัลบั้มเต็มชุดที่ 4 จาก BTS "Map of the Soul: 7" ฉลองครบรอบ 7 ปีของวง ภายในเซ็ตประกอบด้วย Photobook เล่มใหญ่, CD, Lyric Book, Mini Book, Photocard, Postcard, Sticker และ Coloring Paper'),
-- อัลบั้ม NewJeans: ₩22,000 + ฿167 → ฿783 · รอบเว็บเกาหลี · โควตา 35
('newjeans', 'NEWJEANS', 'NewJeans - Get Up Album Set (Pre-order)', 22000, 167, 750,
 'round-kr', 35, 'images/getup.jpg', 'PRE-ORDER', '7 - 14 วัน หลังปิดรอบประจำวัน',
 'เซ็ตอัลบั้ม EP ที่ 2 "Get Up" จาก NewJeans มาพร้อมกับแพ็กเกจสุดพิเศษ ดีไซน์มินิมอลน่าสะสม ในเซ็ตประกอบด้วย Photobook, CD, Photocard, และโปสเตอร์ขนาดมินิ (สุ่มลาย)'),
-- ไวนิล BLACKPINK: ₩42,000 + ฿177 → ฿1,353 · รอบหิ้วหน้าร้าน · โควตา 20
('blackpink', 'BLACKPINK', 'BLACKPINK - BORN PINK Limited Vinyl', 42000, 177, 1290,
 'round-ship', 20, 'images/placeholder-album.svg', 'PRE-ORDER', '10 - 18 วัน หลังปิดรอบประจำวัน',
 'ไวนิลอัลบั้ม BORN PINK ผลิตจำนวนจำกัด มาพร้อมกับ Photobook ฉบับพิเศษและแผ่นไวนิลสีชมพูพาสเทล'),
-- อัลบั้ม aespa: ₩24,500 + ฿170 → ฿856 · รอบหิ้วหน้าร้าน · โควตา 40
('aespa', 'AESPA', 'aespa - Armageddon 1st Album', 24500, 170, 820,
 'round-ship', 40, 'images/placeholder-album.svg', 'PRE-ORDER', '7 - 14 วัน หลังปิดรอบประจำวัน',
 'อัลบั้มเต็มชุดแรกจาก aespa มาพร้อมโปสการ์ดและโฟโต้การ์ดสุ่มสุดเอ็กซ์คลูซีฟ');

-- ออเดอร์ตัวอย่าง
-- ออเดอร์ตัวอย่าง 3 ใบ คนละสถานะ ไว้ทดสอบหน้าประวัติคำสั่งซื้อและหลังบ้าน
-- เรท 0.0265 เป็นเรทที่ล็อกไว้ตอนสั่ง (ก่อนเปลี่ยนเป็น 0.028) — ออเดอร์เก่าต้องคงเรทเดิมไว้
INSERT INTO orders (id, customer_email, customer_name, phone, address, order_date,
                    subtotal, shipping_fee, total, status_code, round_id,
                    rate_used, rate_locked_at, slip_image, tracking_number, admin_notes,
                    purchase_proof_image, purchase_proof_note) VALUES
-- ใบที่ 1: สมชาย · รอตรวจสลิป (PENDING_SLIP) → ยกเลิกเองได้ / แอดมินเห็นในแท็บตรวจสลิป
('ORD-2026071301', 'user@kpopstore.com', 'คุณสมชาย ใจดี', '081-234-5678',
 '123/45 หมู่บ้านตัวอย่าง ซ.สุขุมวิท 1 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
 '2026-07-13 14:30:00', 750, 50, 800, 'PENDING_SLIP', 'round-kr',
 0.026500, '2026-07-13 14:30:00', 'images/placeholder-slip.svg', '',
 'รอตรวจสอบสลิปจากลูกค้า', NULL, NULL),
-- ใบที่ 2: สมชาย · กำลังเตรียมพัสดุ (PREPARING) มีเลขพัสดุและหลักฐานการกดสั่งแล้ว → ยกเลิกเองไม่ได้
('ORD-2026062815', 'user@kpopstore.com', 'คุณสมชาย ใจดี', '081-234-5678',
 '123/45 หมู่บ้านตัวอย่าง ซ.สุขุมวิท 1 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
 '2026-06-28 10:15:00', 1780, 50, 1830, 'PREPARING', 'round-kr',
 0.026500, '2026-06-28 10:15:00', 'images/placeholder-slip.svg', 'TH0192837465TH',
 'อนุมัติสลิปเรียบร้อยแล้ว อยู่ระหว่างแพ็กพัสดุ', 'images/placeholder-slip.svg',
 'กดสั่งซื้อสำเร็จจาก Weverse Shop Official เรียบร้อยแล้ว (Order #WV-982301)'),
-- ใบที่ 3: โซมี · จัดส่งสำเร็จ (DELIVERED)
('ORD-2026070102', 'somi@kpopstore.com', 'คุณโซมี รักเคป็อป', '089-876-5432',
 '88/9 คอนโดสยาม ถนนพญาไท เขตราชเทวี กรุงเทพมหานคร 10400',
 '2026-07-01 18:20:00', 1290, 50, 1340, 'DELIVERED', 'round-ship',
 0.026500, '2026-07-01 18:20:00', 'images/placeholder-slip.svg', 'KERRY-8829104',
 'จัดส่งสำเร็จเรียบร้อย', 'images/placeholder-slip.svg',
 'ซื้อหิ้วหน้าร้าน YG SELECT Pop-up Store เรียบร้อย');

-- รายการสินค้าในแต่ละออเดอร์ (ชื่อ ราคา รูป เป็นค่าตอนสั่ง ไม่เปลี่ยนตามสินค้าปัจจุบัน)
INSERT INTO order_items (order_id, product_id, title, qty, price, price_krw, service_fee, image) VALUES
('ORD-2026071301', 'newjeans',  'NewJeans - Get Up Album Set (Pre-order)',   1,  750, 22000, 167, 'images/getup.jpg'),
('ORD-2026062815', 'bts',       'BTS - Map of the Soul: 7 Album (Pre-order)', 2,  890, 27000, 174, 'images/mapsoul7.jpg'),
('ORD-2026070102', 'blackpink', 'BLACKPINK - BORN PINK Limited Vinyl',        1, 1290, 42000, 177, 'images/placeholder-album.svg');

-- แจ้งเตือนตัวอย่าง
-- แจ้งเตือนตัวอย่างของสมชาย: ใบแรกยังไม่อ่าน (is_read 0) ใบที่สองอ่านแล้ว (1)
-- type = order + ref = เลขออเดอร์ → กดแล้วเปิดรายละเอียดออเดอร์นั้น
INSERT INTO notifications (user_email, title, message, type, ref, created_at, is_read) VALUES
('user@kpopstore.com', 'อัปเดตสถานะคำสั่งซื้อ #ORD-2026062815',
 'คำสั่งซื้อของคุณปรับสถานะเป็น "กำลังจัดเตรียมสินค้า" เลขพัสดุ: TH0192837465TH',
 'order', 'ORD-2026062815', '2026-06-29 09:00:00', 0),
('user@kpopstore.com', 'ได้รับการแจ้งชำระเงิน #ORD-2026071301',
 'ขอบคุณสำหรับการสั่งซื้อ ระบบกำลังเสนอสลิปให้ผู้ดูแลระบบตรวจสอบค่ะ',
 'order', 'ORD-2026071301', '2026-07-13 14:31:00', 1);
