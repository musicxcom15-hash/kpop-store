<?php
/**
 * ย้ายไฟล์อัปโหลดเดิม (uploads/... บนเว็บเก่า) ขึ้น Supabase Storage แล้วแก้ path ในฐานข้อมูลให้ชี้ที่ใหม่
 *
 * ปกติไม่ต้องเรียกตรง ๆ — ใช้ copy-uploads-to-storage.sh
 *
 * ต้องการ environment variable:
 *   DATABASE_URL         ฐานข้อมูล Supabase (ที่ import ข้อมูลเดิมเข้าไปแล้ว)
 *   SUPABASE_URL, SUPABASE_SECRET_KEY, (SUPABASE_STORAGE_BUCKET)  ที่เก็บไฟล์ปลายทาง
 *   OLD_SITE_URL         เว็บเดิมที่ยังเปิดอยู่ เช่น https://web-production-6fbe4.up.railway.app
 *
 * รันซ้ำได้: แถวที่แก้เป็น URL แล้วจะไม่ถูกหยิบมาอีก ไฟล์ที่มีใน Storage แล้วจะไม่อัปโหลดซ้ำ
 * ไฟล์ที่เว็บเดิมหาไม่เจอ (404) ปล่อย path เดิมไว้แล้วรายงานชื่อ
 */

require_once __DIR__ . '/../../preorderkpopweb/api/storage.php';

// เว็บเดิมที่ยังเปิดอยู่ (ดึงไฟล์จากที่นี่)
$old = rtrim((string) getenv('OLD_SITE_URL'), '/');
if (!storage_configured() || $old === '' || !getenv('DATABASE_URL')) {
    fwrite(STDERR, "ต้องตั้ง DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY และ OLD_SITE_URL\n");
    exit(1);
}

/** คอลัมน์ที่เก็บ path รูป => ตาราง */
const IMAGE_COLUMNS = [
    ['products', 'image'],
    ['orders', 'slip_image'],
    ['orders', 'purchase_proof_image'],
    ['order_items', 'image'],
];

/** เรียก URL แล้วคืน [สถานะ HTTP, เนื้อหา, ชนิดไฟล์] ($headOnly = ถามแค่ว่ามีไฟล์ไหม ไม่ดาวน์โหลด) */
function http_get(string $url, bool $headOnly = false): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_NOBODY         => $headOnly,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT        => 30,
    ]);
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $type = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);
    return [$status, (string) $body, $type];
}

// path ไม่ซ้ำทั้งหมดที่ยังชี้ไปโฟลเดอร์ uploads/ เดิม
// รวบรวม path ที่ยังชี้ไป uploads/ เดิมจากทุกคอลัมน์รูป (ไม่ซ้ำกัน)
$paths = [];
foreach (IMAGE_COLUMNS as [$table, $col]) {
    foreach (db()->query("SELECT DISTINCT $col FROM $table WHERE $col LIKE 'uploads/%'")->fetchAll(PDO::FETCH_COLUMN) as $p) {
        $paths[$p] = true;
    }
}
$paths = array_keys($paths);
echo 'พบไฟล์ที่ต้องย้าย ' . count($paths) . " ไฟล์\n";

$moved = 0;
$missing = [];
foreach ($paths as $path) {
    $name = basename($path);
    // ชื่อไฟล์ระบบตั้งเองทั้งหมด แต่กันไว้ก่อน ไม่ส่งชื่อแปลก ๆ ขึ้น Storage
    if (!preg_match('/^[A-Za-z0-9._-]+$/', $name)) {
        $missing[] = "$path (ชื่อไฟล์ไม่ถูกรูปแบบ)";
        continue;
    }

    // มีไฟล์นี้ใน Storage แล้วไหม (รันซ้ำจะไม่อัปโหลดซ้ำ) — ไม่มีค่อยดึงจากเว็บเดิมแล้วอัปโหลด
    $url = storage_public_url($name);
    [$exists] = http_get($url, true);
    if ($exists !== 200) {
        [$status, $body, $type] = http_get($old . '/' . $path);
        if ($status !== 200 || $body === '') {
            $missing[] = "$path (เว็บเดิมตอบ $status)";
            continue;
        }
        try {
            storage_put($name, $body, $type ?: 'application/octet-stream');
        } catch (RuntimeException $e) {
            // ไฟล์เดียวพังไม่ควรหยุดทั้งรอบ — รายละเอียดอยู่ใน log ของ storage_put แล้ว รันซ้ำทีหลังได้
            $missing[] = "$path (อัปโหลดขึ้น Storage ไม่สำเร็จ)";
            continue;
        }
    }

    // แก้ทุกแถวที่ใช้ path นี้ให้ชี้ URL ใหม่ใน Storage
    foreach (IMAGE_COLUMNS as [$table, $col]) {
        db()->prepare("UPDATE $table SET $col = ? WHERE $col = ?")->execute([$url, $path]);
    }
    $moved++;
    echo "  ✓ $name\n";
}

echo "\nย้ายเสร็จ $moved / " . count($paths) . " ไฟล์\n";
// มีไฟล์ที่ย้ายไม่ได้ = จบด้วย exit 2 ให้สคริปต์ที่เรียกรู้ว่าไม่ครบ
if ($missing) {
    echo "ย้ายไม่ได้ (path เดิมยังอยู่ในฐานข้อมูล รูปจะแตก):\n  " . implode("\n  ", $missing) . "\n";
    exit(2);
}
