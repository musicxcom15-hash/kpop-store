<?php
/**
 * รับรูปที่ย่อแล้วจากฝั่งเบราว์เซอร์ แล้วเก็บเป็นไฟล์จริง (Supabase Storage บนเว็บจริง · uploads/ บนเครื่อง — ดู storage.php)
 *
 * ฝั่ง JS ยังใช้ compressImage()/compressSlipImage()/compressProductImage() เหมือนเดิม
 * (ย่อด้วย canvas แล้วได้ data URL) เปลี่ยนแค่ปลายทาง — จากที่เคยยัด base64
 * ลงฐานข้อมูล มาเป็นเขียนไฟล์แล้วเก็บแค่ path
 *
 * ความปลอดภัย:
 *   - ยอมรับเฉพาะ data URL ที่เป็น jpeg/png/webp
 *   - ตรวจซ้ำด้วย getimagesizefromstring() ว่าเป็นรูปจริง ไม่ใช่สคริปต์ที่แปะหัวมาหลอก
 *   - นามสกุลไฟล์กำหนดเองจากชนิดที่ตรวจได้ ไม่เอาชื่อไฟล์ที่ผู้ใช้ส่งมา
 *   - ชื่อไฟล์สุ่ม 96 บิต: ไฟล์เปิดได้ด้วย URL ตรง ๆ (Public bucket) สลิปมีชื่อบัญชีลูกค้า จึงต้องเดาชื่อไม่ได้
 *
 * ขนาด: Vercel รับ request body ได้ไม่เกิน 4.5MB — รูปที่ย่อด้วย canvas ในเบราว์เซอร์แล้วเล็กกว่านั้นมาก
 */

require_once __DIR__ . '/helpers.php';

require_login();

const MAX_UPLOAD_BYTE = 3 * 1024 * 1024;   // 3MB หลังย่อแล้ว เหลือเฟือ (base64 โตขึ้นอีก 1/3 ยังไม่ชนเพดาน 4.5MB ของ Vercel)

$in      = body();
$dataUrl = (string) ($in['dataUrl'] ?? '');
$kind    = (string) ($in['kind'] ?? 'img');   // slip | product | proof — ใช้ตั้งชื่อไฟล์เฉย ๆ

if ($dataUrl === '') {
    fail('ไม่พบข้อมูลรูปภาพค่ะ');
}

// รูปที่ไม่ได้อัปโหลดใหม่ (เป็น path เดิมอยู่แล้ว) ส่งกลับไปตรง ๆ
// ทำให้ฝั่งเรียกไม่ต้องแยกเคสเองว่ารูปนี้ใหม่หรือเก่า
if (!str_starts_with($dataUrl, 'data:')) {
    ok(['path' => $dataUrl]);
}

if (!preg_match('#^data:image/(jpeg|jpg|png|webp);base64,#i', $dataUrl, $m)) {
    fail('รองรับเฉพาะไฟล์รูปภาพ JPG, PNG หรือ WEBP ค่ะ');
}

$base64 = substr($dataUrl, strpos($dataUrl, ',') + 1);
$binary = base64_decode($base64, true);

if ($binary === false) {
    fail('ไฟล์รูปภาพเสียหาย กรุณาลองใหม่อีกครั้งค่ะ');
}
if (strlen($binary) > MAX_UPLOAD_BYTE) {
    fail('ไฟล์รูปใหญ่เกินไปค่ะ กรุณาเลือกรูปที่เล็กลง');
}

// ด่านจริง: ต้องอ่านเป็นรูปได้จริง หัว data: ปลอมได้แต่เนื้อในปลอมไม่ได้
$info = getimagesizefromstring($binary);
if ($info === false) {
    fail('ไฟล์นี้ไม่ใช่รูปภาพที่ถูกต้องค่ะ');
}

$ext = match ($info[2]) {
    IMAGETYPE_JPEG => 'jpg',
    IMAGETYPE_PNG  => 'png',
    IMAGETYPE_WEBP => 'webp',
    default        => null,
};
if ($ext === null) {
    fail('รองรับเฉพาะไฟล์รูปภาพ JPG, PNG หรือ WEBP ค่ะ');
}

$safeKind = preg_match('/^[a-z]+$/', $kind) ? $kind : 'img';
$filename = sprintf('%s-%s-%s.%s', $safeKind, date('Ymd-His'), bin2hex(random_bytes(12)), $ext);

try {
    // คืน URL เต็ม (Supabase) หรือ 'uploads/...' (เครื่องพัฒนา) — ใส่ src ของรูปได้ตรง ๆ ทั้งคู่
    ok(['path' => storage_put($filename, $binary, $info['mime'])]);
} catch (RuntimeException $e) {
    fail($e->getMessage(), 500);
}
