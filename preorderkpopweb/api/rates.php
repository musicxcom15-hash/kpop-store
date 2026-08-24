<?php
/**
 * เรทเงินวอน (เฉพาะแอดมิน)
 *
 * เป็นตารางแบบ append-only — ตั้งเรทใหม่คือเพิ่มแถว ไม่ใช่แก้ของเดิม
 * เพื่อให้ย้อนดูได้ว่าออเดอร์แต่ละใบใช้เรทอะไร
 * เรทที่ใช้อยู่ = แถวล่าสุดที่ effective_from ถึงเวลาแล้ว
 */

require_once __DIR__ . '/helpers.php';

$admin = require_admin();
$in    = body();

if (action() !== 'add') {
    fail('ไม่รู้จักคำสั่งนี้', 400);
}

$rate = (float) ($in['rate'] ?? 0);
if ($rate <= 0) {
    fail('เรทต้องมากกว่า 0 ค่ะ');
}

$effectiveFrom = to_datetime((string) ($in['effectiveFrom'] ?? ''));
if ($effectiveFrom === null) {
    $effectiveFrom = date('Y-m-d H:i:s');
}

$st = db()->prepare('INSERT INTO rates (rate, effective_from, set_by, note) VALUES (?,?,?,?)');
$st->execute([
    $rate,
    $effectiveFrom,
    (string) ($in['setBy'] ?? $admin['email']),
    (string) ($in['note'] ?? ''),
]);

$rates = array_map('map_rate',
    db()->query('SELECT * FROM rates ORDER BY effective_from DESC, id DESC')->fetchAll());

ok(['rates' => $rates]);
