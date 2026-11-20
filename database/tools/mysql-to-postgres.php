<?php
/**
 * แปลงข้อมูลจาก MySQL ฐานเดิม → ไฟล์ SQL สำหรับ PostgreSQL / Supabase
 *
 *   MYSQL_URL=mysql://user:pass@host:port/dbname php mysql-to-postgres.php > data.sql
 *
 * ปกติไม่ต้องเรียกตรง ๆ — ใช้ mysql-dump-to-postgres.sh ซึ่งเปิด MySQL ชั่วคราวจากไฟล์ dump ให้
 *
 * ผลลัพธ์คือ INSERT ทั้งหมดใน transaction เดียว ใช้ต่อจาก database/schema.sql:
 *   Supabase → SQL Editor → รัน schema.sql → รันไฟล์นี้
 * ถ้าจำนวนแถวไม่ตรงกับต้นทาง หรือตารางปลายทางมีข้อมูลอยู่แล้ว ทั้งไฟล์จะยกเลิกเอง (ไม่มีข้อมูลครึ่ง ๆ กลาง ๆ)
 *
 * ไฟล์ผลลัพธ์มีข้อมูลลูกค้า (ชื่อ ที่อยู่ เบอร์ hash รหัสผ่าน) — เก็บนอก repo เสมอ
 * ไม่ย้าย: rates (เลิกใช้แล้ว), password_resets (ลิงก์หมดอายุใน 30 นาทีอยู่แล้ว)
 */

// อ่านที่อยู่ MySQL ต้นทางจาก MYSQL_URL แล้วต่อด้วย PDO (utf8mb4 ให้ภาษาไทยถูกต้อง)
$url = parse_url((string) getenv('MYSQL_URL'));
if (!$url || !isset($url['host'], $url['path'])) {
    fwrite(STDERR, "ต้องตั้ง MYSQL_URL=mysql://user:pass@host:port/dbname\n");
    exit(1);
}
$src = new PDO(
    sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $url['host'], $url['port'] ?? 3306, ltrim($url['path'], '/')),
    rawurldecode($url['user'] ?? 'root'),
    rawurldecode($url['pass'] ?? ''),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
);

/**
 * ตารางปลายทาง เรียงตาม foreign key (แม่ก่อนลูก) => [คอลัมน์ => ค่าแทนถ้าต้นทางไม่มีคอลัมน์นั้น]
 * ต้องตรงกับ database/schema.sql — ค่าแทนมีไว้สำหรับ dump รุ่นเก่าก่อนมีหมวดหมู่/ไซซ์/ชนิดแจ้งเตือน
 */
const TABLES = [
    'rounds' => ['id' => null, 'name' => null, 'type' => 'korean-site', 'open_at' => null, 'close_at' => null,
                 'status' => 'open', 'est_delivery' => null, 'note' => null],
    'users' => ['id' => null, 'name' => null, 'email' => null, 'password_hash' => null, 'phone' => null,
                'address' => null, 'role' => 'customer', 'created_at' => null],
    'products' => ['id' => null, 'artist' => null, 'title' => null, 'category' => 'album', 'sizes' => '',
                   'price_krw' => 0, 'service_fee' => 0, 'price' => null, 'round_id' => null, 'quota_per_round' => null,
                   'image' => null, 'status' => 'PRE-ORDER', 'est_delivery' => null, 'description' => null, 'source_url' => ''],
    'orders' => ['id' => null, 'customer_email' => null, 'customer_name' => null, 'phone' => null, 'address' => null,
                 'order_date' => null, 'subtotal' => 0, 'shipping_fee' => 50, 'total' => 0, 'status_code' => 'PENDING_SLIP',
                 'round_id' => null, 'rate_used' => null, 'rate_locked_at' => null, 'slip_image' => null,
                 'tracking_number' => null, 'admin_notes' => null, 'purchase_proof_image' => null,
                 'purchase_proof_note' => null, 'cancelled_at' => null, 'refunded_at' => null, 'refund_note' => null],
    'order_items' => ['id' => null, 'order_id' => null, 'product_id' => null, 'title' => null, 'size' => '',
                      'qty' => 1, 'price' => 0, 'price_krw' => null, 'service_fee' => null, 'image' => null],
    'notifications' => ['id' => null, 'user_email' => null, 'title' => null, 'message' => null, 'type' => null,
                        'ref' => null, 'created_at' => null, 'is_read' => 0],
    'cart_items' => ['id' => null, 'user_id' => null, 'product_id' => null, 'size' => '', 'qty' => 1, 'added_at' => null],
];

/** ตารางที่ id เป็น IDENTITY — ต้องเลื่อนตัวนับต่อจาก id สูงสุดที่ใส่เอง ไม่งั้นแถวใหม่จะชน */
const IDENTITY_TABLES = ['order_items', 'notifications', 'cart_items'];

/** ค่า → literal ของ SQL (ใส่ทุกอย่างเป็นสตริง ให้ Postgres แปลงตามชนิดคอลัมน์เอง) */
function lit($v): string
{
    if ($v === null) {
        return 'NULL';
    }
    $v = (string) $v;
    // วันที่ศูนย์ของ MySQL ไม่มีใน Postgres
    if (str_starts_with($v, '0000-00-00')) {
        return 'NULL';
    }
    // standard_conforming_strings เปิดเป็นค่าเริ่มต้น: backslash เป็นตัวอักษรธรรมดา ต้อง escape แค่ '
    return "'" . str_replace("'", "''", $v) . "'";
}

// ตารางที่มีจริงในต้นทาง (dump รุ่นเก่าอาจไม่มีบางตาราง เช่น cart_items)
$have = $src->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
$counts = [];
$out = [];

// อ่านทีละตาราง แล้วสร้างคำสั่ง INSERT ครั้งละ 200 แถว
foreach (TABLES as $table => $columns) {
    if (!in_array($table, $have, true)) {
        $counts[$table] = 0;
        continue;
    }
    $rows = $src->query("SELECT * FROM `$table` ORDER BY id")->fetchAll();
    $counts[$table] = count($rows);
    if (!$rows) {
        continue;
    }

    $out[] = "\n-- $table (" . count($rows) . ' แถว)';
    foreach (array_chunk($rows, 200) as $chunk) {
        $values = array_map(function (array $row) use ($columns) {
            $cells = [];
            foreach ($columns as $col => $fallback) {
                // ต้นทางไม่มีคอลัมน์นี้ (dump เก่า) → ใช้ค่าแทนที่กำหนดไว้ใน TABLES
                $cells[] = lit(array_key_exists($col, $row) ? $row[$col] : $fallback);
            }
            return '(' . implode(', ', $cells) . ')';
        }, $chunk);
        $out[] = "INSERT INTO $table (" . implode(', ', array_keys($columns)) . ") VALUES\n" . implode(",\n", $values) . ';';
    }
}

// จำนวนแถวต่อตาราง ใช้ทั้งในหัวไฟล์และในขั้นตรวจท้ายไฟล์
$summary = implode(', ', array_map(fn($t, $n) => "$t=$n", array_keys($counts), $counts));

echo "-- =====================================================================\n";
echo "-- ข้อมูลจาก MySQL เดิม → PostgreSQL (สร้างโดย database/tools/mysql-to-postgres.php)\n";
echo '-- สร้างเมื่อ ' . date('Y-m-d H:i:s') . " · $summary\n";
echo "-- ไฟล์นี้มีข้อมูลลูกค้า — ห้าม commit ขึ้น git / ห้ามส่งต่อ\n";
echo "-- ใช้: รัน database/schema.sql ก่อน แล้วค่อยรันไฟล์นี้ (Supabase SQL Editor ได้ทั้งไฟล์)\n";
echo "-- =====================================================================\n\n";
// ทั้งไฟล์อยู่ใน transaction เดียว — พลาดตรงไหนยกเลิกทั้งหมด
echo "BEGIN;\n\n";
echo "-- กันรันซ้ำทับข้อมูลที่มีอยู่แล้ว\n";
echo "DO \$\$ BEGIN\n";
echo "    IF EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM orders) THEN\n";
echo "        RAISE EXCEPTION 'ตารางปลายทางมีข้อมูลอยู่แล้ว — รัน schema.sql ใหม่ก่อน (ข้อมูลเดิมในปลายทางจะถูกลบ)';\n";
echo "    END IF;\n";
echo "END \$\$;\n";
echo implode("\n", $out), "\n\n";

echo "-- ให้แถวใหม่ได้ id ต่อจากของเดิม\n";
// เลื่อนตัวนับ id อัตโนมัติให้ต่อจาก id สูงสุดที่นำเข้า
foreach (IDENTITY_TABLES as $t) {
    echo "SELECT setval(pg_get_serial_sequence('$t', 'id'), COALESCE((SELECT MAX(id) FROM $t), 0) + 1, false);\n";
}

echo "\n-- ตรวจจำนวนแถวให้ตรงกับต้นทาง ไม่ตรง = ยกเลิกทั้งหมด\n";
echo "DO \$\$ BEGIN\n";
// ตรวจว่าจำนวนแถวในปลายทางเท่ากับต้นทางทุกตาราง ไม่เท่า = RAISE EXCEPTION ยกเลิกทั้งหมด
foreach ($counts as $t => $n) {
    echo "    IF (SELECT COUNT(*) FROM $t) <> $n THEN RAISE EXCEPTION '$t: จำนวนแถวไม่ตรง (ต้นทาง $n)'; END IF;\n";
}
echo "END \$\$;\n\n";
echo "COMMIT;\n";

fwrite(STDERR, "แปลงเสร็จ: $summary\n");
