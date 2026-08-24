-- =====================================================================
-- KPOP STORE — โครงสร้างฐานข้อมูล + ข้อมูลตั้งต้น (ฉบับสำหรับ Railway)
--
-- ต่างจาก database/kpop_store.sql แค่จุดเดียว: ตัด CREATE DATABASE กับ
-- USE `kpop_store` ออก เพราะ Railway สร้าง database ชื่อ `railway` มาให้แล้ว
-- และ user ที่ให้มาไม่มีสิทธิ์ CREATE DATABASE จึงต้อง import ลงใน
-- database ที่มีอยู่แล้วโดยตรง
--
-- วิธี import (ทำครั้งเดียวตอนตั้งค่าเว็บครั้งแรก) — ค่าเชื่อมต่อดูได้จาก
-- แท็บ Variables ของ MySQL service บน Railway (ใช้ค่า PUBLIC/proxy):
--
--   mysql -h <proxy-host> -P <proxy-port> -u root -p railway < kpop_store_railway.sql
--
-- !! คำเตือน !!
-- ไฟล์นี้ขึ้นต้นด้วย DROP TABLE IF EXISTS ทุกตาราง
-- รันซ้ำหลังเปิดใช้จริง = ออเดอร์ บัญชีลูกค้า และสลิปทั้งหมดหายเกลี้ยง
-- =====================================================================

-- ลบของเดิมก่อน เพื่อให้ import ซ้ำได้โดยไม่ error
-- เรียงจากตารางลูกไปแม่ ไม่งั้นติด foreign key
DROP TABLE IF EXISTS `cart_items`;
DROP TABLE IF EXISTS `order_items`;
DROP TABLE IF EXISTS `notifications`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `rates`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `rounds`;

-- ---------------------------------------------------------------------
-- rounds — รอบพรีออเดอร์
-- ไม่ใช่ "รอบตัดยอดรายวัน" แต่เป็นหน้าต่างรับสั่งที่ผูกกับรอบของเว็บเกาหลี
-- หรือรอบที่ร้านเดินทางไปหิ้วเอง สินค้าคนละรอบถึงไทยคนละเวลา
-- ---------------------------------------------------------------------
CREATE TABLE `rounds` (
    `id`           VARCHAR(50)  NOT NULL,
    `name`         VARCHAR(255) NOT NULL,
    `type`         ENUM('korean-site','shipping') NOT NULL DEFAULT 'korean-site',
    `open_at`      DATE         NOT NULL,
    `close_at`     DATE         NOT NULL,
    -- สถานะที่ร้านกดเอง ถ้าไม่ใช่ open ระบบจะยึดค่านี้เหนือช่วงวันที่
    `status`       ENUM('open','upcoming','closed','ordered','arrived','shipped')
                   NOT NULL DEFAULT 'open',
    `est_delivery` VARCHAR(255) NULL,
    `note`         TEXT         NULL,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- users — บัญชีผู้ใช้
-- password_hash เป็นของใหม่ (เดิมระบบเป็น demo ล็อกอินด้วยรหัสอะไรก็ได้)
-- เก็บเป็น bcrypt จาก password_hash() ตรวจด้วย password_verify() เท่านั้น
-- ---------------------------------------------------------------------
CREATE TABLE `users` (
    `id`            VARCHAR(50)  NOT NULL,
    `name`          VARCHAR(150) NOT NULL,
    `email`         VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `phone`         VARCHAR(30)  NULL,
    `address`       TEXT         NULL,
    `role`          ENUM('admin','customer') NOT NULL DEFAULT 'customer',
    `created_at`    DATE         NOT NULL,
    PRIMARY KEY (`id`),
    -- อีเมลคือคีย์ที่ผูกออเดอร์กับเจ้าของ ห้ามซ้ำเด็ดขาด
    -- ถ้าซ้ำได้ การสมัครด้วยอีเมลแอดมินจะกลายเป็นการยึดบัญชี
    UNIQUE KEY `uniq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- products — สินค้า
-- ราคาจริงคิดจาก price_krw x เรทปัจจุบัน + service_fee
-- คอลัมน์ price เป็นราคาบาทคงที่ของข้อมูลยุคก่อนมีเรท ใช้เป็น fallback เท่านั้น
-- ---------------------------------------------------------------------
CREATE TABLE `products` (
    `id`              VARCHAR(50)   NOT NULL,
    `artist`          VARCHAR(150)  NOT NULL,
    `title`           VARCHAR(255)  NOT NULL,
    `price_krw`       INT           NOT NULL DEFAULT 0,
    `service_fee`     DECIMAL(10,2) NOT NULL DEFAULT 0,
    `price`           DECIMAL(10,2) NULL,
    `round_id`        VARCHAR(50)   NOT NULL,
    -- NULL = รับไม่จำกัด ห้ามแปลงเป็น 0 เพราะ 0 แปลว่า "เต็มแล้ว"
    `quota_per_round` INT           NULL,
    -- เก็บ path เท่านั้น (images/... หรือ uploads/...) ไม่เก็บ base64 อีกต่อไป
    `image`           VARCHAR(255)  NULL,
    `status`          ENUM('PRE-ORDER','OUT OF STOCK') NOT NULL DEFAULT 'PRE-ORDER',
    `est_delivery`    VARCHAR(255)  NULL,
    -- ชื่อ desc ตรงกับฝั่ง JS แต่เป็น reserved word ของ SQL จึงใช้ description
    `description`     TEXT          NULL,
    PRIMARY KEY (`id`),
    KEY `idx_products_round` (`round_id`),
    CONSTRAINT `fk_products_round` FOREIGN KEY (`round_id`)
        REFERENCES `rounds` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- rates — ประวัติเรทเงินวอน (append-only)
-- เรทปัจจุบัน = แถวล่าสุดที่ effective_from ถึงเวลาแล้ว
-- จุดตัด 22:00 จึงเกิดขึ้นเองโดยไม่ต้องมี cron
-- ---------------------------------------------------------------------
CREATE TABLE `rates` (
    `id`             INT           NOT NULL AUTO_INCREMENT,
    `rate`           DECIMAL(12,6) NOT NULL,
    `effective_from` DATETIME      NOT NULL,
    `set_by`         VARCHAR(255)  NULL,
    `note`           VARCHAR(255)  NULL,
    PRIMARY KEY (`id`),
    KEY `idx_rates_effective` (`effective_from`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- orders — หัวคำสั่งซื้อ
--
-- ชื่อ/เบอร์/ที่อยู่เป็น snapshot ตอนสั่ง ตั้งใจไม่ sync กลับจากตาราง users
-- เพราะลูกค้าอาจย้ายที่อยู่หลังสั่งไปแล้ว พัสดุใบเก่าต้องคงที่อยู่เดิมไว้
--
-- ไม่มีคอลัมน์ status ที่เป็นข้อความไทย — ข้อความถูก derive จาก status_code
-- ตาม ORDER_STATUS ใน js/store.js ซึ่งเป็นแหล่งความจริงเดียวของทั้งระบบ
-- ---------------------------------------------------------------------
CREATE TABLE `orders` (
    `id`                   VARCHAR(30)   NOT NULL,
    `customer_email`       VARCHAR(255)  NOT NULL,
    `customer_name`        VARCHAR(150)  NOT NULL,
    `phone`                VARCHAR(30)   NULL,
    `address`              TEXT          NULL,
    `order_date`           DATETIME      NOT NULL,
    `subtotal`             DECIMAL(10,2) NOT NULL DEFAULT 0,
    `shipping_fee`         DECIMAL(10,2) NOT NULL DEFAULT 50,
    `total`                DECIMAL(10,2) NOT NULL DEFAULT 0,
    `status_code`          ENUM(
                               'PENDING_SLIP','PAID_WAIT_ROUND','ROUND_CLOSED','ORDERED_KR',
                               'PREPARING','SHIPPING','DELIVERED','SLIP_REJECTED',
                               'CANCELLED_USER','PURCHASE_FAILED','REFUND_PENDING','REFUNDED'
                           ) NOT NULL DEFAULT 'PENDING_SLIP',
    `round_id`             VARCHAR(50)   NULL,
    -- เรทถูกล็อกตอนลูกค้าแนบสลิป หลังจากนั้นเรทขยับก็ไม่กระทบออเดอร์ใบนี้
    `rate_used`            DECIMAL(12,6) NULL,
    `rate_locked_at`       DATETIME      NULL,
    `slip_image`           VARCHAR(255)  NULL,
    `tracking_number`      VARCHAR(100)  NULL,
    `admin_notes`          TEXT          NULL,
    `purchase_proof_image` VARCHAR(255)  NULL,
    `purchase_proof_note`  TEXT          NULL,
    `cancelled_at`         DATETIME      NULL,
    `refunded_at`          DATETIME      NULL,
    `refund_note`          TEXT          NULL,
    PRIMARY KEY (`id`),
    KEY `idx_orders_email`  (`customer_email`),
    KEY `idx_orders_status` (`status_code`),
    KEY `idx_orders_round`  (`round_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- order_items — รายการสินค้าในออเดอร์
-- แตกออกมาจาก items[] ที่เดิมฝังเป็น JSON ก้อนเดียวในออเดอร์
--
-- title/price/image เป็น snapshot โดยตั้งใจ เพราะสินค้าถูกลบทีหลังได้
-- จึงไม่ผูก foreign key กับ products (โค้ดเดิมรองรับสินค้าหายอยู่แล้ว)
-- ---------------------------------------------------------------------
CREATE TABLE `order_items` (
    `id`          INT           NOT NULL AUTO_INCREMENT,
    `order_id`    VARCHAR(30)   NOT NULL,
    `product_id`  VARCHAR(50)   NOT NULL,
    `title`       VARCHAR(255)  NOT NULL,
    `qty`         INT           NOT NULL DEFAULT 1,
    `price`       DECIMAL(10,2) NOT NULL DEFAULT 0,
    `price_krw`   INT           NULL,
    `service_fee` DECIMAL(10,2) NULL,
    `image`       VARCHAR(255)  NULL,
    PRIMARY KEY (`id`),
    KEY `idx_items_product` (`product_id`),
    CONSTRAINT `fk_items_order` FOREIGN KEY (`order_id`)
        REFERENCES `orders` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- notifications — แจ้งเตือนรายคน
-- user_email ไม่ผูก foreign key เพราะ 'admin@kpopstore.com' ถูกใช้เป็น
-- ที่อยู่ broadcast ของร้าน และแจ้งเตือนต้องอยู่ต่อแม้บัญชีถูกลบ
-- ---------------------------------------------------------------------
CREATE TABLE `notifications` (
    `id`         INT          NOT NULL AUTO_INCREMENT,
    `user_email` VARCHAR(255) NOT NULL,
    `title`      VARCHAR(255) NOT NULL,
    `message`    TEXT         NOT NULL,
    `created_at` DATETIME     NOT NULL,
    `is_read`    TINYINT(1)   NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`),
    KEY `idx_noti_email` (`user_email`, `is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- cart_items — ตะกร้า
-- ของใหม่: ผูกกับ user_id แล้ว เดิมเป็นตะกร้ากลางของทั้งเบราว์เซอร์
-- ทำให้คนละบัญชีบนเครื่องเดียวกันใช้ตะกร้าใบเดียวกัน
--
-- ไม่เก็บราคาโดยตั้งใจ เพราะราคาบาทลอยตามเรทจนกว่าจะแนบสลิป
-- ---------------------------------------------------------------------
CREATE TABLE `cart_items` (
    `id`         INT         NOT NULL AUTO_INCREMENT,
    `user_id`    VARCHAR(50) NOT NULL,
    `product_id` VARCHAR(50) NOT NULL,
    `qty`        INT         NOT NULL DEFAULT 1,
    `added_at`   DATETIME    NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uniq_cart_user_product` (`user_id`, `product_id`),
    KEY `idx_cart_product` (`product_id`),
    CONSTRAINT `fk_cart_user` FOREIGN KEY (`user_id`)
        REFERENCES `users` (`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_cart_product` FOREIGN KEY (`product_id`)
        REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =====================================================================
-- ข้อมูลตั้งต้น
-- =====================================================================

-- รอบพรีออเดอร์ -------------------------------------------------------
-- ใช้วันที่สัมพัทธ์กับวันที่ import เพื่อให้มีรอบที่ "เปิดรับอยู่" เสมอ
-- (ของเดิมใน store.js ก็คำนวณสดด้วย dayOffset() แบบเดียวกัน)
INSERT INTO `rounds` (`id`, `name`, `type`, `open_at`, `close_at`, `status`, `est_delivery`, `note`) VALUES
('round-kr',     'รอบพรีออเดอร์เว็บเกาหลี (Weverse / Ktown4u)', 'korean-site',
 DATE_ADD(CURDATE(), INTERVAL -3 DAY), DATE_ADD(CURDATE(), INTERVAL 4 DAY), 'open',
 'ประมาณ 3-5 สัปดาห์หลังปิดรอบ', 'ร้านจะรวบรวมยอดแล้วกดสั่งกับเว็บ Official หลังปิดรอบ'),
('round-ship',   'รอบหิ้วหน้าร้าน + ชิปรวมกลับไทย', 'shipping',
 DATE_ADD(CURDATE(), INTERVAL -1 DAY), DATE_ADD(CURDATE(), INTERVAL 9 DAY), 'open',
 'ประมาณ 2-3 สัปดาห์หลังปิดรอบ', 'รอบนี้ร้านเดินทางไปหิ้วหน้าร้านที่เกาหลีเอง'),
('round-legacy', 'รอบทั่วไป (ข้อมูลก่อนมีระบบรอบ)', 'korean-site',
 '2000-01-01', '2999-12-31', 'open',
 '7 - 14 วัน', 'รอบสำรองสำหรับสินค้า/ออเดอร์ที่สร้างไว้ก่อนระบบรอบจะมี');

-- ผู้ใช้ ---------------------------------------------------------------
-- รหัสผ่านตั้งต้น (bcrypt ด้านล่างสร้างจาก password_hash() แล้วตรวจด้วย password_verify() ผ่าน):
--   admin@kpopstore.com  =>  admin123
--   user@kpopstore.com   =>  123456
--   somi@kpopstore.com   =>  123456
INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `phone`, `address`, `role`, `created_at`) VALUES
('u-admin', 'ผู้ดูแลระบบ (Admin)', 'admin@kpopstore.com',
 '$2y$10$0NFVqDF6EgvSDOHx7TS6Luoc.tjVX2fDQzgsxurOTbWdgd.pLieNO',
 '080-000-0000', 'ศูนย์ประสานงาน KPOP STORE กรุงเทพมหานคร', 'admin', '2026-01-01'),
('u-customer1', 'คุณสมชาย ใจดี', 'user@kpopstore.com',
 '$2y$10$wLaINlQci2H2VxlTUOUgxODrQ8c1p.ZNWdPmbEGCXvgFP88T.nmt2',
 '081-234-5678', '123/45 หมู่บ้านตัวอย่าง ซ.สุขุมวิท 1 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
 'customer', '2026-06-15'),
('u-customer2', 'คุณโซมี รักเคป็อป', 'somi@kpopstore.com',
 '$2y$10$tNWop.UCd442R1rOU16OlOJhzQur8zDCP8x7hHrNkBNUrUZlS.MqW',
 '089-876-5432', '88/9 คอนโดสยาม ถนนพญาไท เขตราชเทวี กรุงเทพมหานคร 10400',
 'customer', '2026-07-01');

-- สินค้า ---------------------------------------------------------------
INSERT INTO `products` (`id`, `artist`, `title`, `price_krw`, `service_fee`, `price`,
                        `round_id`, `quota_per_round`, `image`, `status`, `est_delivery`, `description`) VALUES
('bts', 'BTS', 'BTS - Map of the Soul: 7 Album (Pre-order)', 27000, 174, 890,
 'round-kr', 50, 'images/mapsoul7.jpg', 'PRE-ORDER', '7 - 14 วัน หลังปิดรอบประจำวัน',
 'อัลบั้มเต็มชุดที่ 4 จาก BTS "Map of the Soul: 7" ฉลองครบรอบ 7 ปีของวง ภายในเซ็ตประกอบด้วย Photobook เล่มใหญ่, CD, Lyric Book, Mini Book, Photocard, Postcard, Sticker และ Coloring Paper'),
('newjeans', 'NEWJEANS', 'NewJeans - Get Up Album Set (Pre-order)', 22000, 167, 750,
 'round-kr', 35, 'images/getup.jpg', 'PRE-ORDER', '7 - 14 วัน หลังปิดรอบประจำวัน',
 'เซ็ตอัลบั้ม EP ที่ 2 "Get Up" จาก NewJeans มาพร้อมกับแพ็กเกจสุดพิเศษ ดีไซน์มินิมอลน่าสะสม ในเซ็ตประกอบด้วย Photobook, CD, Photocard, และโปสเตอร์ขนาดมินิ (สุ่มลาย)'),
('blackpink', 'BLACKPINK', 'BLACKPINK - BORN PINK Limited Vinyl', 42000, 177, 1290,
 'round-ship', 20, 'images/placeholder-album.svg', 'PRE-ORDER', '10 - 18 วัน หลังปิดรอบประจำวัน',
 'ไวนิลอัลบั้ม BORN PINK ผลิตจำนวนจำกัด มาพร้อมกับ Photobook ฉบับพิเศษและแผ่นไวนิลสีชมพูพาสเทล'),
('aespa', 'AESPA', 'aespa - Armageddon 1st Album', 24500, 170, 820,
 'round-ship', 40, 'images/placeholder-album.svg', 'PRE-ORDER', '7 - 14 วัน หลังปิดรอบประจำวัน',
 'อัลบั้มเต็มชุดแรกจาก aespa มาพร้อมโปสการ์ดและโฟโต้การ์ดสุ่มสุดเอ็กซ์คลูซีฟ');

-- เรทเงินวอนตั้งต้น -----------------------------------------------------
-- ย้อนหลัง 7 วันที่เวลา 22:00 (RATE_CUTOFF_HOUR) เพื่อให้มีผลบังคับใช้แล้วแน่ ๆ
INSERT INTO `rates` (`rate`, `effective_from`, `set_by`, `note`) VALUES
(0.026500, CONCAT(DATE_ADD(CURDATE(), INTERVAL -7 DAY), ' 22:00:00'),
 'admin@kpopstore.com', 'เรทตั้งต้นของระบบ');

-- ออเดอร์ตัวอย่าง -------------------------------------------------------
INSERT INTO `orders` (`id`, `customer_email`, `customer_name`, `phone`, `address`, `order_date`,
                      `subtotal`, `shipping_fee`, `total`, `status_code`, `round_id`,
                      `rate_used`, `rate_locked_at`, `slip_image`, `tracking_number`, `admin_notes`,
                      `purchase_proof_image`, `purchase_proof_note`) VALUES
('ORD-2026071301', 'user@kpopstore.com', 'คุณสมชาย ใจดี', '081-234-5678',
 '123/45 หมู่บ้านตัวอย่าง ซ.สุขุมวิท 1 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
 '2026-07-13 14:30:00', 750, 50, 800, 'PENDING_SLIP', 'round-kr',
 0.026500, '2026-07-13 14:30:00', 'images/placeholder-slip.svg', '',
 'รอตรวจสอบสลิปจากลูกค้า', NULL, NULL),
('ORD-2026062815', 'user@kpopstore.com', 'คุณสมชาย ใจดี', '081-234-5678',
 '123/45 หมู่บ้านตัวอย่าง ซ.สุขุมวิท 1 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
 '2026-06-28 10:15:00', 1780, 50, 1830, 'PREPARING', 'round-kr',
 0.026500, '2026-06-28 10:15:00', 'images/placeholder-slip.svg', 'TH0192837465TH',
 'อนุมัติสลิปเรียบร้อยแล้ว อยู่ระหว่างแพ็กพัสดุ', 'images/placeholder-slip.svg',
 'กดสั่งซื้อสำเร็จจาก Weverse Shop Official เรียบร้อยแล้ว (Order #WV-982301)'),
('ORD-2026070102', 'somi@kpopstore.com', 'คุณโซมี รักเคป็อป', '089-876-5432',
 '88/9 คอนโดสยาม ถนนพญาไท เขตราชเทวี กรุงเทพมหานคร 10400',
 '2026-07-01 18:20:00', 1290, 50, 1340, 'DELIVERED', 'round-ship',
 0.026500, '2026-07-01 18:20:00', 'images/placeholder-slip.svg', 'KERRY-8829104',
 'จัดส่งสำเร็จเรียบร้อย', 'images/placeholder-slip.svg',
 'ซื้อหิ้วหน้าร้าน YG SELECT Pop-up Store เรียบร้อย');

INSERT INTO `order_items` (`order_id`, `product_id`, `title`, `qty`, `price`, `price_krw`, `service_fee`, `image`) VALUES
('ORD-2026071301', 'newjeans',  'NewJeans - Get Up Album Set (Pre-order)',   1,  750, 22000, 167, 'images/getup.jpg'),
('ORD-2026062815', 'bts',       'BTS - Map of the Soul: 7 Album (Pre-order)', 2,  890, 27000, 174, 'images/mapsoul7.jpg'),
('ORD-2026070102', 'blackpink', 'BLACKPINK - BORN PINK Limited Vinyl',        1, 1290, 42000, 177, 'images/placeholder-album.svg');

-- แจ้งเตือนตัวอย่าง -----------------------------------------------------
INSERT INTO `notifications` (`user_email`, `title`, `message`, `created_at`, `is_read`) VALUES
('user@kpopstore.com', 'อัปเดตสถานะคำสั่งซื้อ #ORD-2026062815',
 'คำสั่งซื้อของคุณปรับสถานะเป็น "กำลังจัดเตรียมสินค้า" เลขพัสดุ: TH0192837465TH',
 '2026-06-29 09:00:00', 0),
('user@kpopstore.com', 'ได้รับการแจ้งชำระเงิน #ORD-2026071301',
 'ขอบคุณสำหรับการสั่งซื้อ ระบบกำลังเสนอสลิปให้ผู้ดูแลระบบตรวจสอบค่ะ',
 '2026-07-13 14:31:00', 1);
