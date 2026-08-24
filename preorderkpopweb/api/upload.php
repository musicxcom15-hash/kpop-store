<?php
/**
 * รับรูปที่ย่อแล้วจากฝั่งเบราว์เซอร์ แล้วเขียนเป็นไฟล์จริงใน uploads/
 *
 * ฝั่ง JS ยังใช้ compressImage()/compressSlipImage()/compressProductImage() เหมือนเดิม
 * (ย่อด้วย canvas แล้วได้ data URL) เปลี่ยนแค่ปลายทาง — จากที่เคยยัด base64
 * ลงฐานข้อมูล มาเป็นเขียนไฟล์แล้วเก็บแค่ path
 *
 * ความปลอดภัย:
 *   - ยอมรับเฉพาะ data URL ที่เป็น jpeg/png/webp
 *   - ตรวจซ้ำด้วย getimagesizefromstring() ว่าเป็นรูปจริง ไม่ใช่สคริปต์ที่แปะหัวมาหลอก
 *   - นามสกุลไฟล์กำหนดเองจากชนิดที่ตรวจได้ ไม่เอาชื่อไฟล์ที่ผู้ใช้ส่งมา
 */

require_once __DIR__ . '/helpers.php';

require_login();

const UPLOAD_DIR      = __DIR__ . '/../uploads';
const MAX_UPLOAD_BYTE = 8 * 1024 * 1024;   // 8MB หลังย่อแล้ว เหลือเฟือ

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

if (!is_dir(UPLOAD_DIR) && !mkdir(UPLOAD_DIR, 0775, true) && !is_dir(UPLOAD_DIR)) {
    fail('สร้างโฟลเดอร์เก็บรูปไม่สำเร็จ กรุณาตรวจสอบสิทธิ์เขียนไฟล์ค่ะ', 500);
}

$safeKind = preg_match('/^[a-z]+$/', $kind) ? $kind : 'img';
$filename = sprintf('%s-%s-%s.%s', $safeKind, date('Ymd-His'), bin2hex(random_bytes(4)), $ext);

if (file_put_contents(UPLOAD_DIR . '/' . $filename, $binary) === false) {
    fail('บันทึกไฟล์รูปไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ', 500);
}

// คืน path แบบสัมพัทธ์กับรากเว็บ ใช้ใส่ src ได้ตรง ๆ เหมือน 'images/...' เดิม
ok(['path' => 'uploads/' . $filename]);
