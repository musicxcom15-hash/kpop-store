<?php
/**
 * ตัวเลขพื้นที่จัดเก็บสำหรับการ์ดในหน้าแอดมิน
 *
 * เดิมการ์ดนี้วัดโควตา localStorage (5MB ต่อ origin) ซึ่งหมดความหมายไปแล้ว
 * เมื่อข้อมูลย้ายมาอยู่ในฐานข้อมูล จึงเปลี่ยนไปวัด "ขนาดโฟลเดอร์ uploads/"
 * ซึ่งเป็นทรัพยากรที่โตขึ้นเรื่อย ๆ จริงและแอดมินควรเห็น
 */

require_once __DIR__ . '/helpers.php';

require_admin();

const UPLOAD_DIR   = __DIR__ . '/../uploads';
const SOFT_LIMIT   = 500 * 1024 * 1024;   // เกณฑ์เตือน 500MB

$bytes = 0;
$files = 0;

if (is_dir(UPLOAD_DIR)) {
    foreach (scandir(UPLOAD_DIR) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $path = UPLOAD_DIR . '/' . $entry;
        if (is_file($path)) {
            $bytes += filesize($path) ?: 0;
            $files++;
        }
    }
}

ok([
    'bytes'   => $bytes,
    'limit'   => SOFT_LIMIT,
    'percent' => min(100, (int) round(($bytes / SOFT_LIMIT) * 100)),
    'files'   => $files,
]);
