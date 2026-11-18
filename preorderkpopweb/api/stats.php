<?php
/**
 * ตัวเลขพื้นที่จัดเก็บสำหรับการ์ดในหน้าแอดมิน
 *
 * วัด "ขนาดไฟล์อัปโหลดทั้งหมด" (สลิป · รูปสินค้า) ซึ่งเป็นทรัพยากรที่โตขึ้นเรื่อย ๆ จริงและแอดมินควรเห็น
 * บนเว็บจริงนับจาก Supabase Storage บนเครื่องนับจากโฟลเดอร์ uploads/ (ดู storage_usage ใน storage.php)
 */

require_once __DIR__ . '/helpers.php';

require_admin();

// เกณฑ์เตือน 500MB — ครึ่งหนึ่งของพื้นที่ Storage ในแพ็กเกจฟรีของ Supabase (1GB)
const SOFT_LIMIT = 500 * 1024 * 1024;

[$bytes, $files] = storage_usage();

ok([
    'bytes'   => $bytes,
    'limit'   => SOFT_LIMIT,
    'percent' => min(100, (int) round(($bytes / SOFT_LIMIT) * 100)),
    'files'   => $files,
]);
