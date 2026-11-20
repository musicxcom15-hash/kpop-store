<?php
/**
 * ตัวช่วยที่ทุก endpoint ใช้ร่วมกัน
 *
 *  - ตอบ JSON ในรูปแบบ envelope เดิม { success, message, ... }
 *    เพื่อให้โค้ดฝั่งหน้าเว็บที่เช็ค res.success อยู่แล้วทุกจุดใช้ต่อได้โดยไม่ต้องแก้
 *  - ตรวจสิทธิ์จาก PHP session
 *  - แปลงแถวจากฐานข้อมูล (snake_case) เป็นรูปทรงที่ js/store.js คาดหวัง (camelCase)
 *  - ตาราง ORDER_STATUS ฝั่งเซิร์ฟเวอร์ คัดมาจาก js/store.js ให้ตรงกันทุกค่า
 */

// โหลดไฟล์ที่ทุก endpoint ต้องใช้: ค่าเชื่อมต่อฐานข้อมูล, ที่เก็บไฟล์, ตัวจัดการ session
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/session.php';

/**
 * php.ini ของ MAMP ตั้ง serialize_precision = 100 ซึ่งทำให้ json_encode พ่นทศนิยม
 * ของ float ออกมาครบทุกหลักที่เลขฐานสองเก็บได้จริง เช่น เรท 0.0265 กลายเป็น
 * 0.02649999999999999925059945837801933... แล้วเลขชุดนั้นถูกเอาไปโชว์ให้ลูกค้าเห็น
 * ในหน้ายืนยันการสั่งซื้อ ("ล็อกที่เรท ...")
 *
 * ค่า -1 สั่งให้ใช้อัลกอริทึม "สั้นที่สุดที่แปลงกลับได้ค่าเดิม" ซึ่งได้ 0.0265 ตามต้องการ
 * ตั้งที่นี่เพื่อไม่ให้ผลลัพธ์ขึ้นกับ php.ini ของเครื่องที่เอาไปรัน
 */
ini_set('serialize_precision', '-1');

// ทุก endpoint ตอบเป็น JSON (ภาษาไทยเป็น UTF-8)
header('Content-Type: application/json; charset=utf-8');
// ข้อมูลผู้ใช้/ออเดอร์ห้ามถูกแคช
header('Cache-Control: no-store');

/**
 * ข้อผิดพลาดที่ไม่ได้ดักไว้ต้องออกไปเป็น JSON เสมอ
 *
 * ถ้าปล่อยให้ PHP พ่น fatal error เป็น HTML ออกไป ฝั่งเบราว์เซอร์จะ parse JSON ไม่ผ่าน
 * แล้วผู้ใช้จะเห็นแค่หน้าค้างโดยไม่รู้ว่าเกิดอะไรขึ้น (เคสที่เจอบ่อยสุดคือฐานข้อมูลไม่ได้เปิด
 * หรือยังไม่ได้รัน database/schema.sql ซึ่งทั้งคู่แก้ได้ง่ายถ้ารู้สาเหตุ)
 *
 * แต่บนเว็บจริงข้อความพวกนั้นไม่ช่วยลูกค้า และมักพ่วงชื่อโฮสต์ พอร์ต ชื่อฐานข้อมูล
 * หรือ path ของไฟล์ออกไปด้วย ซึ่งเป็นข้อมูลตั้งต้นชั้นดีให้คนที่กำลังหาช่องอยู่
 * บน production จึงตอบข้อความกลาง ๆ แล้วเก็บของจริงไว้ใน log (ดูได้ที่หน้า Logs ของ Vercel)
 */
set_exception_handler(function (Throwable $e): void {
    // บันทึกรายละเอียดจริงลง log ของเซิร์ฟเวอร์ (ผู้ใช้ไม่เห็น)
    error_log('[kpop-api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    // ตาราง/คอลัมน์หาย (42P01 / 42703 เช่นรัน schema.sql รุ่นเก่าทับตอน container ยังรัน)
    // — ลืมว่าเคยเช็คแล้ว คำขอถัดไปจะเติมให้เอง
    if ($e instanceof PDOException && in_array($e->getCode(), ['42P01', '42703'], true)) {
        @unlink(SCHEMA_FLAG_FILE);
    }
    // ตอบ 500 พร้อม JSON — หน้าเว็บจะขึ้นแถบแดงพร้อมปุ่มลองใหม่
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => IS_PRODUCTION
            ? 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลังค่ะ'
            : $e->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
});

// ตอนต้นทุกคำขอ — เติมตาราง/คอลัมน์ใหม่ให้ DB ที่สร้างไว้ก่อน (ทำจริงครั้งเดียวต่อ container)
// เปลี่ยนชื่อไฟล์ (pg1, pg2, ...) ทุกครั้งที่เพิ่มของใน ensure_schema_once() เพื่อให้ container ที่เคยเช็คแล้วเช็คใหม่
// ทำก่อน session_start() เพราะ session ก็อ่านจากฐานข้อมูล (ตาราง sessions)
define('SCHEMA_FLAG_FILE', sys_get_temp_dir() . '/kpop-schema-pg2');
// คำสั่งอัปเกรดโครงสร้าง (เรียงตามเวลาที่เพิ่ม) เช่น 'ALTER TABLE products ADD COLUMN IF NOT EXISTS x TEXT'
// ต้องประกาศก่อนบรรทัด ensure_schema_once() ด้านล่าง — const ระดับไฟล์ของ PHP มีตัวตนเมื่อรันมาถึงบรรทัดนั้นเท่านั้น
const SCHEMA_UPGRADES = [
    // pg2: ที่อยู่แบบแยกช่อง (บัญชีเดิมได้ค่าว่าง → ระบบให้กรอกใหม่ก่อนสั่งซื้อครั้งถัดไป)
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line VARCHAR(200) NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS subdistrict  VARCHAR(100) NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS district     VARCHAR(100) NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS province     VARCHAR(100) NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS postcode     VARCHAR(5)   NOT NULL DEFAULT ''",
];
ensure_schema_once();

/**
 * คุกกี้ session ต้องตั้งค่าก่อน session_start() เท่านั้น เรียกทีหลังไม่มีผล
 *
 * secure: Vercel (และ proxy ทั่วไป) ตัด TLS ทิ้งที่ขอบเครือข่ายแล้วส่งต่อเข้ามาเป็น HTTP ธรรมดา
 * $_SERVER['HTTPS'] จึงว่างเปล่าทั้งที่ผู้ใช้เข้าผ่าน https จริง ต้องดูจาก
 * header ที่ proxy แปะมาแทน — ถ้าตั้ง secure ตายตัวเป็น true จะล็อกอินบน
 * localhost (http) ไม่ได้เลย
 */
if (session_status() === PHP_SESSION_NONE) {
    // เก็บ session ในฐานข้อมูล ไม่ใช่ไฟล์ — container บน Vercel ไม่มีดิสก์ถาวรและมีได้หลายตัวพร้อมกัน (ดู session.php)
    session_set_save_handler(new DbSessionHandler(), true);
    session_set_cookie_params([
        'httponly' => true,               // JS อ่านคุกกี้นี้ไม่ได้
        'samesite' => 'Lax',              // กัน CSRF ขั้นพื้นฐาน (ทุก request เป็น same-origin อยู่แล้ว)
        'secure'   => (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
                      || (($_SERVER['HTTPS'] ?? '') !== ''),
    ]);
    // เริ่ม session: อ่านแถวใน sessions ตามคุกกี้ PHPSESSID ของผู้ใช้
    session_start();
}

/* ------------------------------------------------------------------ */
/* ตาราง ORDER_STATUS — ต้องตรงกับ js/store.js เป๊ะ                    */
/*                                                                     */
/*   revenue         นับเข้ายอดขายรวมหรือไม่                            */
/*   quota           กินโควตารับพรีออเดอร์ของรอบอยู่หรือไม่               */
/*   canCancel       ลูกค้ากดยกเลิกเองได้หรือไม่                         */
/*   canReuploadSlip ลูกค้าส่งสลิปใบใหม่ได้หรือไม่                       */
/* ------------------------------------------------------------------ */
// รหัสสถานะ => ข้อความไทย + กลุ่ม (ใช้กรองแท็บ) + flag ทั้ง 4 ตัว
const ORDER_STATUS = [
    'PENDING_SLIP'    => ['text' => 'รอตรวจสอบชำระเงิน',              'group' => 'pending',    'revenue' => true,  'quota' => true,  'canCancel' => true,  'canReuploadSlip' => true],
    'PAID_WAIT_ROUND' => ['text' => 'ชำระเงินแล้ว รอปิดรอบ',          'group' => 'processing', 'revenue' => true,  'quota' => true,  'canCancel' => true,  'canReuploadSlip' => false],
    'ROUND_CLOSED'    => ['text' => 'ปิดรอบแล้ว รอร้านกดสั่ง',         'group' => 'processing', 'revenue' => true,  'quota' => true,  'canCancel' => true,  'canReuploadSlip' => false],
    'ORDERED_KR'      => ['text' => 'ร้านกดสั่งกับเกาหลีแล้ว',          'group' => 'processing', 'revenue' => true,  'quota' => true,  'canCancel' => false, 'canReuploadSlip' => false],
    'PREPARING'       => ['text' => 'กำลังจัดเตรียมสินค้า',            'group' => 'processing', 'revenue' => true,  'quota' => true,  'canCancel' => false, 'canReuploadSlip' => false],
    'SHIPPING'        => ['text' => 'กำลังจัดส่งสินค้า',               'group' => 'shipped',    'revenue' => true,  'quota' => true,  'canCancel' => false, 'canReuploadSlip' => false],
    'DELIVERED'       => ['text' => 'จัดส่งสำเร็จ',                    'group' => 'shipped',    'revenue' => true,  'quota' => true,  'canCancel' => false, 'canReuploadSlip' => false],
    'SLIP_REJECTED'   => ['text' => 'ยกเลิกคำสั่งซื้อ / สลิปไม่ถูกต้อง', 'group' => 'cancelled',  'revenue' => false, 'quota' => false, 'canCancel' => false, 'canReuploadSlip' => true],
    'CANCELLED_USER'  => ['text' => 'ยกเลิกคำสั่งซื้อโดยลูกค้า',        'group' => 'cancelled',  'revenue' => false, 'quota' => false, 'canCancel' => false, 'canReuploadSlip' => false],
    'PURCHASE_FAILED' => ['text' => 'ร้านกดสั่งไม่สำเร็จ (ของหมดที่เกาหลี)', 'group' => 'refund', 'revenue' => false, 'quota' => false, 'canCancel' => false, 'canReuploadSlip' => false],
    'REFUND_PENDING'  => ['text' => 'รอคืนเงิน',                       'group' => 'refund',     'revenue' => false, 'quota' => false, 'canCancel' => false, 'canReuploadSlip' => false],
    'REFUNDED'        => ['text' => 'คืนเงินเรียบร้อยแล้ว',            'group' => 'refund',     'revenue' => false, 'quota' => false, 'canCancel' => false, 'canReuploadSlip' => false],
];

/** สถานะที่ยังกินโควตาของรอบอยู่ ใช้กรองตอนคำนวณโควตาคงเหลือ */
function quota_consuming_codes(): array
{
    return array_keys(array_filter(ORDER_STATUS, fn($m) => $m['quota']));
}

/* ------------------------------------------------------------------ */
/* การตอบกลับ                                                          */
/* ------------------------------------------------------------------ */

/** ส่ง JSON แล้วจบการทำงานทันที */
function json_out(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** ตอบว่าไม่สำเร็จ พร้อมข้อความที่เอาไปโชว์ผู้ใช้ได้เลย */
function fail(string $message, int $status = 200, array $extra = []): never
{
    json_out(array_merge(['success' => false, 'message' => $message], $extra), $status);
}

/** ตอบว่าสำเร็จ */
function ok(array $extra = []): never
{
    json_out(array_merge(['success' => true, 'message' => ''], $extra));
}

/** อ่าน JSON body ที่ fetch ส่งมา */
function body(): array
{
    // อ่าน body ดิบของคำขอ (หน้าเว็บส่ง JSON มาด้วย fetch)
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    // แปลงเป็น array — ถ้าไม่ใช่ JSON ที่ถูกต้อง ให้ถือว่าไม่มีข้อมูล ไม่ error
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/** อ่าน action จาก query string */
function action(): string
{
    return isset($_GET['action']) ? (string) $_GET['action'] : '';
}

/* ------------------------------------------------------------------ */
/* สิทธิ์                                                              */
/* ------------------------------------------------------------------ */

/** คืนแถวผู้ใช้ที่ล็อกอินอยู่ หรือ null ถ้ายังไม่ได้ล็อกอิน */
function current_user(): ?array
{
    // ยังไม่ได้ล็อกอิน (session ไม่มี user_id)
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    $st = db()->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([$_SESSION['user_id']]);
    $row = $st->fetch();
    if (!$row) {
        // บัญชีถูกลบไปแล้วระหว่างที่ session ยังอยู่ — ล้างทิ้ง
        unset($_SESSION['user_id']);
        return null;
    }
    return $row;
}

/** บังคับว่าต้องล็อกอิน ไม่งั้นจบด้วย 401 */
function require_login(): array
{
    $user = current_user();
    if (!$user) {
        fail('กรุณาเข้าสู่ระบบก่อนค่ะ', 401);
    }
    return $user;
}

/**
 * บังคับว่าต้องเป็นแอดมิน
 * สำคัญ: หน้า admin.html ซ่อน UI ให้เฉย ๆ ใครยิง endpoint ตรงก็ถึงได้
 * ด่านจริงจึงต้องอยู่ตรงนี้
 */
function require_admin(): array
{
    $user = require_login();
    if ($user['role'] !== 'admin') {
        fail('ต้องเป็นผู้ดูแลระบบเท่านั้นค่ะ', 403);
    }
    return $user;
}

/** ความยาวรหัสผ่านขั้นต่ำ ใช้ทั้งตอนสมัครและตอนเปลี่ยนรหัส */
const MIN_PASSWORD_LENGTH = 6;

/**
 * รหัสผ่านชั่วคราวแบบสุ่ม สำหรับบัญชีที่แอดมินสร้างให้หรือรีเซ็ตให้
 * ตัดตัวที่อ่านแล้วสับสนออก (0/O, 1/l/I) เพราะแอดมินต้องอ่านให้ลูกค้าฟังทางโทรศัพท์
 * เดิมบัญชีที่แอดมินสร้างใช้รหัสตายตัวที่อยู่ใน repo สาธารณะ ใครก็เดาได้
 */
function random_temp_password(int $length = 10): string
{
    // ตัวอักษรที่ใช้สุ่ม (ไม่มี 0 O 1 l I ที่อ่านสับสน)
    $chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $out = '';
    for ($i = 0; $i < $length; $i++) {
        // random_int ปลอดภัยพอสำหรับรหัสผ่าน (ไม่ใช่ rand ที่เดาได้)
        $out .= $chars[random_int(0, strlen($chars) - 1)];
    }
    return $out;
}

/* ------------------------------------------------------------------ */
/* เบอร์โทรศัพท์และที่อยู่จัดส่ง                                          */
/*                                                                     */
/* ตรวจได้แค่ "รูปแบบเป็นไปได้จริง" — เบอร์ต้องเป็นรูปแบบเบอร์ไทย          */
/* ที่อยู่ต้องเป็นตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ที่มีอยู่จริงและเข้ากัน   */
/* ยืนยันไม่ได้ว่าเบอร์เป็นของลูกค้าคนนั้นจริง (ต้องใช้ SMS OTP — ไม่ได้ทำ) */
/* หรือบ้านเลขที่มีอยู่จริง                                               */
/* ------------------------------------------------------------------ */

/**
 * ตรวจและจัดรูปเบอร์โทรไทย คืนเบอร์รูปแบบมาตรฐาน หรือ null ถ้าเป็นเบอร์ที่เป็นไปไม่ได้
 *   มือถือ 10 หลัก ขึ้นต้น 06 / 08 / 09        → 081-234-5678
 *   บ้าน/สำนักงาน 9 หลัก ขึ้นต้น 02–07          → 02-123-4567 (กรุงเทพฯ) / 053-123-456
 * รับ +66 / 66 นำหน้าได้ และไม่สนช่องว่าง - ( ) . ที่ผู้ใช้พิมพ์มา
 * ตรงกับ KpopStore.normalizePhone() ใน js/store.js
 */
function normalize_thai_phone(string $raw): ?string
{
    // เหลือแต่ตัวเลข (และ + นำหน้า)
    $d = preg_replace('/[\s\-().]/', '', $raw);
    // +66812345678 / 66812345678 → 0812345678
    if (preg_match('/^\+?66(\d{8,9})$/', $d, $m)) {
        $d = '0' . $m[1];
    }
    if (!preg_match('/^0\d{8,9}$/', $d)) {
        return null;
    }
    // เลขหลังเลข 0 เหมือนกันหมด (0000000000, 0888888888) หรือเรียงลำดับ = กรอกเล่น
    if (strlen(count_chars(substr($d, 1), 3)) === 1 || in_array($d, ['0123456789', '0987654321', '012345678'], true)) {
        return null;
    }
    if (strlen($d) === 10) {
        // มือถือ: ขึ้นต้น 06 08 09 เท่านั้น
        return preg_match('/^0[689]/', $d) ? substr($d, 0, 3) . '-' . substr($d, 3, 3) . '-' . substr($d, 6) : null;
    }
    // 9 หลัก = เบอร์บ้าน: 02 (กรุงเทพฯ) หรือ 03–07 (ต่างจังหวัด)
    if (!preg_match('/^0[2-7]/', $d)) {
        return null;
    }
    return $d[1] === '2'
        ? '02-' . substr($d, 2, 3) . '-' . substr($d, 5)
        : substr($d, 0, 3) . '-' . substr($d, 3, 3) . '-' . substr($d, 6);
}

/**
 * ข้อมูลตำบล/อำเภอ/จังหวัด/รหัสไปรษณีย์ทั้งประเทศ (ไฟล์เดียวกับที่หน้าเว็บใช้ทำช่องเลือก)
 *   p = รายชื่อจังหวัด · a = [อำเภอ, ลำดับจังหวัด] · z = { รหัสไปรษณีย์: [[ตำบล, ลำดับอำเภอ], ...] }
 * โหลดครั้งเดียวต่อคำขอ และโหลดเฉพาะ endpoint ที่ตรวจที่อยู่
 */
function thai_address_db(): array
{
    static $db = null;
    return $db ??= json_decode(file_get_contents(__DIR__ . '/../data/thai-address.json'), true);
}

/**
 * ตรวจที่อยู่แบบแยกช่อง คืน [ข้อมูลที่อยู่ที่ตรวจแล้ว, null] หรือ [null, ข้อความบอกผู้ใช้]
 * อำเภอและจังหวัดเอามาจากฐานข้อมูลตามตำบล+รหัสไปรษณีย์ ไม่เชื่อค่าที่หน้าเว็บส่งมา
 */
function validate_address(array $in): array
{
    // บ้านเลขที่ หมู่บ้าน ซอย ถนน — ยุบช่องว่างซ้อนให้เหลือช่องเดียว
    $line     = trim(preg_replace('/\s+/u', ' ', (string) ($in['addressLine'] ?? '')));
    $sub      = trim((string) ($in['subdistrict'] ?? ''));
    $district = trim((string) ($in['district'] ?? ''));
    $postcode = trim((string) ($in['postcode'] ?? ''));

    if (mb_strlen($line) < 5) {
        return [null, 'กรุณากรอกบ้านเลขที่ หมู่บ้าน ซอย ถนน ให้ครบค่ะ'];
    }
    if (mb_strlen($line) > 200) {
        return [null, 'ที่อยู่ยาวเกินไปค่ะ'];
    }
    if (!preg_match('/^\d{5}$/', $postcode)) {
        return [null, 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลักค่ะ'];
    }

    $db = thai_address_db();
    if (!isset($db['z'][$postcode])) {
        return [null, 'ไม่พบรหัสไปรษณีย์ ' . $postcode . ' ในประเทศไทยค่ะ'];
    }
    foreach ($db['z'][$postcode] as [$tambon, $ai]) {
        [$amphoe, $pi] = $db['a'][$ai];
        // ตำบลชื่อซ้ำในรหัสไปรษณีย์เดียวกัน (คนละอำเภอ) มีได้ — ถ้าหน้าเว็บส่งอำเภอมาด้วยต้องตรงกัน
        if ($tambon === $sub && ($district === '' || $district === $amphoe)) {
            return [[
                'addressLine' => $line,
                'subdistrict' => $tambon,
                'district'    => $amphoe,
                'province'    => $db['p'][$pi],
                'postcode'    => $postcode,
            ], null];
        }
    }
    return [null, 'กรุณาเลือกตำบล/แขวงให้ตรงกับรหัสไปรษณีย์ ' . $postcode . ' ค่ะ'];
}

/** ประกอบที่อยู่เต็มสำหรับจ่าหน้าพัสดุ (กรุงเทพฯ ใช้ แขวง/เขต · จังหวัดอื่นใช้ ต./อ./จ.) */
function compose_address(array $a): string
{
    return $a['province'] === 'กรุงเทพมหานคร'
        ? "{$a['addressLine']} แขวง{$a['subdistrict']} เขต{$a['district']} กรุงเทพมหานคร {$a['postcode']}"
        : "{$a['addressLine']} ต.{$a['subdistrict']} อ.{$a['district']} จ.{$a['province']} {$a['postcode']}";
}

/**
 * อ่านเบอร์โทร + ที่อยู่จากข้อมูลที่หน้าเว็บส่งมา ตรวจแล้วคืนค่าที่พร้อมบันทึก (ไม่ผ่าน = fail() จบคำขอ)
 * $required = true: ต้องกรอกครบ (สมัคร / แก้ข้อมูลส่วนตัว)
 * $required = false: เว้นว่างได้ แต่ถ้ากรอกต้องถูกต้อง (แอดมินสร้าง/แก้บัญชี)
 * คืน ['phone', 'address' (ข้อความเต็ม), 'addressLine', 'subdistrict', 'district', 'province', 'postcode']
 */
function contact_from_input(array $in, bool $required): array
{
    $rawPhone = trim((string) ($in['phone'] ?? ''));
    $phone = '';
    if ($rawPhone !== '' || $required) {
        $phone = normalize_thai_phone($rawPhone);
        if ($phone === null) {
            fail('เบอร์โทรศัพท์ไม่ถูกต้องค่ะ กรุณากรอกเบอร์มือถือ 10 หลัก (เช่น 081-234-5678) หรือเบอร์บ้าน 9 หลัก');
        }
    }

    $empty = ['addressLine' => '', 'subdistrict' => '', 'district' => '', 'province' => '', 'postcode' => ''];
    $touched = trim((string) ($in['addressLine'] ?? '')) !== '' || trim((string) ($in['postcode'] ?? '')) !== '';
    if (!$touched && !$required) {
        return ['phone' => $phone, 'address' => ''] + $empty;
    }
    [$addr, $error] = validate_address($in);
    if ($error !== null) {
        fail($error);
    }
    return ['phone' => $phone, 'address' => compose_address($addr)] + $addr;
}

/** บัญชีนี้มีเบอร์โทรและที่อยู่แบบแยกช่องที่ใช้จัดส่งได้หรือยัง (บัญชีเก่ามีแต่ที่อยู่แบบพิมพ์ยาว) */
function contact_complete(array $userRow): bool
{
    return normalize_thai_phone((string) ($userRow['phone'] ?? '')) !== null
        && ($userRow['postcode'] ?? '') !== '';
}

/* ------------------------------------------------------------------ */
/* รูปแบบวันเวลา                                                       */
/*                                                                     */
/* ทั้งระบบฝั่ง JS ใช้ 'YYYY-MM-DD HH:mm' แล้วเทียบกันเป็น "สตริง" ตรง ๆ  */
/* (เช่น หาเรทที่มีผล ณ ตอนนี้) ถ้าปล่อยวินาทีจาก DB ติดมาด้วย          */
/* การเทียบจะเพี้ยน จึงต้องตัดให้เหลือระดับนาทีเสมอ                      */
/* ------------------------------------------------------------------ */

/** 'YYYY-MM-DD HH:MM:SS' -> 'YYYY-MM-DD HH:mm' */
function stamp(?string $dt): ?string
{
    if ($dt === null || $dt === '') {
        return null;
    }
    return substr($dt, 0, 16);
}

/** เวลาปัจจุบันในรูปแบบเดียวกับที่ JS ใช้ */
function now_stamp(): string
{
    return date('Y-m-d H:i');
}

/* ------------------------------------------------------------------ */
/* แปลงแถว DB -> รูปทรงที่ js/store.js คาดหวัง                          */
/*                                                                     */
/* ต้องแคสต์ชนิดให้ตรงด้วย ไม่ใช่แค่เปลี่ยนชื่อคีย์ เพราะ PostgreSQL คืน  */
/* NUMERIC มาเป็นสตริง ถ้าปล่อยไว้ JS จะเอาไปบวกกันแล้วได้สตริงต่อกัน     */
/* ------------------------------------------------------------------ */

/** แถวสินค้าจาก DB → รูปทรงที่หน้าเว็บใช้ (camelCase + แปลงตัวเลขเป็น int/float) */
function map_product(array $r): array
{
    return [
        'id'            => $r['id'],
        'artist'        => $r['artist'],
        'title'         => $r['title'],
        'priceKRW'      => (int) $r['price_krw'],
        'serviceFee'    => (float) $r['service_fee'],
        'price'         => $r['price'] === null ? null : (float) $r['price'],
        'roundId'       => $r['round_id'],
        // null = รับไม่จำกัด ต้องคงเป็น null ห้ามแปลงเป็น 0 (0 = เต็มแล้ว)
        'quotaPerRound' => $r['quota_per_round'] === null ? null : (int) $r['quota_per_round'],
        'image'         => $r['image'],
        'status'        => $r['status'],
        'estDelivery'   => $r['est_delivery'],
        'desc'          => $r['description'],
        // ?? เผื่อ DB เก่าก่อนมีคอลัมน์ (ensure_schema_once เติมให้ตอนต้นคำขอ)
        'category'      => $r['category'] ?? 'album',
        'sizes'         => parse_sizes((string) ($r['sizes'] ?? '')),
        // ร้านต้นทางที่แอดมินไปกดสั่ง — ข้อมูลภายในร้าน ต้องตัดออกก่อนส่งให้คนที่ไม่ใช่แอดมิน (ดู bootstrap.php)
        'sourceUrl'     => $r['source_url'] ?? '',
    ];
}

/**
 * ไซซ์ของสินค้า เก็บในคอลัมน์เดียวคั่นด้วยคอมมา เช่น "S,M,L,XL" ('' = ไม่มีไซซ์ให้เลือก)
 * ราคาและโควตาใช้ร่วมกันทุกไซซ์ — ไซซ์เป็นแค่ข้อมูลว่าลูกค้าต้องการตัวไหน
 */
const MAX_SIZES = 20;
const MAX_SIZE_LENGTH = 32;

/** แยกข้อความไซซ์เป็นรายการ ตัดช่องว่าง ตัดตัวซ้ำ (ไม่ตรวจความยาว — ใช้ validate_sizes ตอนบันทึก) */
function parse_sizes(string $raw): array
{
    $sizes = [];
    // แยกด้วยคอมมา แล้วเก็บเฉพาะค่าที่ไม่ว่างและยังไม่ซ้ำ
    foreach (explode(',', $raw) as $s) {
        $s = trim($s);
        if ($s !== '' && !in_array($s, $sizes, true)) {
            $sizes[] = $s;
        }
    }
    return $sizes;
}

/** ไซซ์ที่ลูกค้าเลือกใช้กับสินค้านี้ได้ไหม — สินค้าไม่มีไซซ์ต้องส่งมาเป็น '' เท่านั้น */
function is_valid_size(array $productRow, string $size): bool
{
    $sizes = parse_sizes((string) ($productRow['sizes'] ?? ''));
    // มีรายการไซซ์ → ต้องเป็นหนึ่งในนั้น · ไม่มีไซซ์ → ต้องเป็นค่าว่าง
    return $sizes ? in_array($size, $sizes, true) : $size === '';
}

/**
 * หมวดหมู่สินค้า — เก็บเป็นรหัส ชื่อไทย/ไอคอนอยู่ที่ PRODUCT_CATEGORIES ใน js/store.js (ต้องตรงกัน)
 * สินค้าเดิมก่อนมีหมวดหมู่ทั้งหมดเป็นอัลบั้ม จึงใช้ album เป็นค่าตั้งต้น
 */
const PRODUCT_CATEGORIES = ['album', 'lightstick', 'photocard', 'clothing', 'popup', 'merch'];

/** แถวรอบพรีออเดอร์จาก DB → รูปทรงที่หน้าเว็บใช้ */
function map_round(array $r): array
{
    return [
        'id'          => $r['id'],
        'name'        => $r['name'],
        'type'        => $r['type'],
        'openAt'      => $r['open_at'],
        'closeAt'     => $r['close_at'],
        'status'      => $r['status'],
        'estDelivery' => $r['est_delivery'],
        'note'        => $r['note'],
    ];
}

/**
 * เรทต้องปัดให้เหลือ 6 ตำแหน่งตามชนิดคอลัมน์ DECIMAL(12,6)
 *
 * ถ้าแคสต์เป็น float เฉย ๆ แล้วส่งออกเป็น JSON จะได้ค่าอย่าง
 * 0.02649999999999999925059945837801933... เพราะ 0.0265 เก็บเป็นเลขฐานสองไม่ลงตัว
 * ซึ่งเลขชุดนั้นถูกเอาไปโชว์ให้ลูกค้าเห็นจริงในหน้ายืนยันการสั่งซื้อ
 */
function rate_value($value): float
{
    return round((float) $value, 6);
}

/** ผู้ใช้ — ไม่เคยส่ง password_hash ออกไปไม่ว่ากรณีใด */
function map_user(array $r): array
{
    return [
        'id'        => $r['id'],
        'name'      => $r['name'],
        'email'     => $r['email'],
        'phone'     => $r['phone'],
        // ที่อยู่เต็ม (จ่าหน้าพัสดุ) + แยกช่องไว้เติมกลับในฟอร์ม · ?? เผื่อ DB ก่อนมีคอลัมน์ (ensure_schema_once เติมให้)
        'address'     => $r['address'],
        'addressLine' => $r['address_line'] ?? '',
        'subdistrict' => $r['subdistrict'] ?? '',
        'district'    => $r['district'] ?? '',
        'province'    => $r['province'] ?? '',
        'postcode'    => $r['postcode'] ?? '',
        'role'      => $r['role'],
        'createdAt' => $r['created_at'],
    ];
}

/** รายการสินค้าในออเดอร์ (snapshot ตอนสั่ง: ชื่อ ราคา รูป ไซซ์) → รูปทรงที่หน้าเว็บใช้ */
function map_order_item(array $r): array
{
    return [
        'id'         => $r['product_id'],   // ฝั่ง JS ใช้ item.id เป็นรหัสสินค้า
        'title'      => $r['title'],
        'size'       => $r['size'] ?? '',
        'qty'        => (int) $r['qty'],
        'price'      => (float) $r['price'],
        'priceKRW'   => $r['price_krw'] === null ? null : (int) $r['price_krw'],
        'serviceFee' => $r['service_fee'] === null ? null : (float) $r['service_fee'],
        'image'      => $r['image'],
    ];
}

/**
 * ออเดอร์เต็มใบ
 * `status` (ข้อความไทย) ไม่ได้เก็บใน DB — สร้างจาก status_code ทุกครั้ง
 * เพื่อให้มีแหล่งความจริงเดียวเหมือนที่ js/store.js ตั้งใจไว้แต่แรก
 */
function map_order(array $r, array $items = []): array
{
    $code = $r['status_code'];
    return [
        'id'                 => $r['id'],
        'customerName'       => $r['customer_name'],
        'customerEmail'      => $r['customer_email'],
        'phone'              => $r['phone'],
        'address'            => $r['address'],
        'date'               => stamp($r['order_date']),
        'items'              => $items,
        'subtotal'           => (float) $r['subtotal'],
        'shippingFee'        => (float) $r['shipping_fee'],
        'total'              => (float) $r['total'],
        'statusCode'         => $code,
        // ข้อความไทยของสถานะสร้างจากรหัสเสมอ ไม่ได้เก็บใน DB
        'status'             => ORDER_STATUS[$code]['text'] ?? $code,
        'roundId'            => $r['round_id'],
        // เรทที่ล็อกไว้ตอนลูกค้าแนบสลิป
        'rateUsed'           => $r['rate_used'] === null ? null : rate_value($r['rate_used']),
        'rateLockedAt'       => stamp($r['rate_locked_at']),
        'slipImage'          => $r['slip_image'],
        'trackingNumber'     => $r['tracking_number'] ?? '',
        'adminNotes'         => $r['admin_notes'],
        'purchaseProofImage' => $r['purchase_proof_image'],
        'purchaseProofNote'  => $r['purchase_proof_note'],
        'cancelledAt'        => stamp($r['cancelled_at']),
        'refundedAt'         => stamp($r['refunded_at']),
        'refundNote'         => $r['refund_note'],
    ];
}

/**
 * ออเดอร์ฉบับตัดข้อมูลส่วนตัวออก
 *
 * ลูกค้าต้องได้เห็นออเดอร์ของคนอื่น "เท่าที่จำเป็นต่อการคำนวณโควตาคงเหลือ"
 * เท่านั้น — ไม่มีชื่อ อีเมล เบอร์ ที่อยู่ ยอดเงิน หรือสลิปติดไปด้วย
 * (getRemainingQuota ฝั่ง JS ไล่ดูจาก order.items[].qty กับ statusCode)
 */
function map_order_for_quota(array $r, array $items = []): array
{
    return [
        'id'         => $r['id'],
        'statusCode' => $r['status_code'],
        'roundId'    => $r['round_id'],
        // เหลือแค่รหัสสินค้ากับจำนวน — พอให้คำนวณโควตา ไม่มีไซซ์/ราคา
        'items'      => array_map(fn($i) => ['id' => $i['id'], 'qty' => $i['qty']], $items),
    ];
}

/** แถวแจ้งเตือนจาก DB → รูปทรงที่หน้าเว็บใช้ (is_read 0/1 → true/false) */
function map_notification(array $r): array
{
    return [
        'id'        => (int) $r['id'],
        'userEmail' => $r['user_email'],
        'title'     => $r['title'],
        'message'   => $r['message'],
        // ใช้ ?? เพราะ DB รุ่นเก่ายังไม่มีคอลัมน์นี้จนกว่าจะมีแจ้งเตือนใบแรกที่มี type (ดู push_notification)
        'type'      => $r['type'] ?? null,
        'ref'       => $r['ref'] ?? null,
        'date'      => stamp($r['created_at']),
        'read'      => (bool) $r['is_read'],
    ];
}

/** แถวตะกร้าจาก DB → รูปทรงที่หน้าเว็บใช้ (ไม่มีราคา ราคาคิดสดที่หน้าเว็บ) */
function map_cart_item(array $r): array
{
    return [
        'productId' => $r['product_id'],
        'size'      => $r['size'] ?? '',
        'qty'       => (int) $r['qty'],
        'addedAt'   => stamp($r['added_at']),
    ];
}

/* ------------------------------------------------------------------ */
/* คิวรีที่ใช้ซ้ำหลาย endpoint                                          */
/* ------------------------------------------------------------------ */

/** ดึงออเดอร์พร้อม items ทั้งหมด คืนเป็น [orderId => items[]] */
function fetch_items_by_order(array $orderIds): array
{
    if (!$orderIds) {
        return [];
    }
    // สร้าง ?,?,? ตามจำนวน id เพื่อใช้กับ IN (...) แบบ prepared statement
    $ph = implode(',', array_fill(0, count($orderIds), '?'));
    $st = db()->prepare("SELECT * FROM order_items WHERE order_id IN ($ph) ORDER BY id");
    $st->execute($orderIds);

    $byOrder = [];
    foreach ($st->fetchAll() as $row) {
        // จัดกลุ่มรายการสินค้าตามเลขออเดอร์
        $byOrder[$row['order_id']][] = map_order_item($row);
    }
    return $byOrder;
}

/** ออเดอร์ใบเดียวพร้อม items */
function fetch_order(string $orderId): ?array
{
    $st = db()->prepare('SELECT * FROM orders WHERE id = ?');
    $st->execute([$orderId]);
    $row = $st->fetch();
    if (!$row) {
        return null;
    }
    // ดึงรายการสินค้าของออเดอร์นี้มาประกอบ
    $items = fetch_items_by_order([$orderId]);
    return map_order($row, $items[$orderId] ?? []);
}

/**
 * โควตาคงเหลือของสินค้าหนึ่งตัว
 * คืน null = รับไม่จำกัด
 *
 * นับจากออเดอร์ที่ยังกินโควตาอยู่ "ในรอบเดียวกับที่สินค้าผูกอยู่ตอนนี้"
 * ให้ตรงกับ getRemainingQuota() ฝั่ง JS
 */
function remaining_quota(string $productId): ?int
{
    // อ่านเพดานโควตาและรอบปัจจุบันของสินค้า
    $st = db()->prepare('SELECT quota_per_round, round_id FROM products WHERE id = ?');
    $st->execute([$productId]);
    $p = $st->fetch();
    if (!$p || $p['quota_per_round'] === null) {
        return null;
    }

    // นับเฉพาะออเดอร์ที่สถานะยังกินโควตา (ยกเลิก/คืนเงินแล้วไม่นับ)
    $codes = quota_consuming_codes();
    $ph = implode(',', array_fill(0, count($codes), '?'));

    // รวมจำนวนที่สั่งไปแล้วของสินค้านี้ในรอบเดียวกัน (IS NOT DISTINCT FROM = เทียบเท่ากันได้แม้เป็น NULL)
    $sql = "SELECT COALESCE(SUM(oi.qty), 0)
              FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = ?
               AND o.round_id IS NOT DISTINCT FROM ?
               AND o.status_code IN ($ph)";
    $st = db()->prepare($sql);
    $st->execute(array_merge([$productId, $p['round_id']], $codes));

    // เหลือ = เพดาน − ที่สั่งไปแล้ว (ไม่ให้ติดลบ)
    return max(0, (int) $p['quota_per_round'] - (int) $st->fetchColumn());
}

/** เรทกลางคงที่ของร้าน (ดู CENTRAL_RATE ใน config.php) — ไม่ผูกกับฐานข้อมูลอีกต่อไป */
function current_rate(): array
{
    return [
        'rate'          => rate_value(CENTRAL_RATE),
        'effectiveFrom' => now_stamp(),
        'setBy'         => 'ระบบ',
        'note'          => 'เรทกลางคงที่ของร้าน',
    ];
}

/**
 * สถานะของรอบ ณ ตอนนี้ (ตรรกะเดียวกับ getRoundState ฝั่ง JS)
 * ค่าที่ร้านกดไว้เองชนะเสมอ ถ้าเป็น open ค่อยตัดสินจากช่วงวันที่
 */
function round_state(?array $round): string
{
    if (!$round) {
        return 'closed';
    }
    if (($round['status'] ?? 'open') !== 'open') {
        return $round['status'];
    }
    // เทียบวันนี้ (เวลาไทย) กับช่วงวันเปิด-ปิดรอบ — สตริง YYYY-MM-DD เทียบกันตรง ๆ ได้
    $today = date('Y-m-d');
    if ($today < $round['openAt'])  return 'upcoming';
    if ($today > $round['closeAt']) return 'closed';
    return 'open';
}

/** ดึงรอบหนึ่งรอบในรูปทรงฝั่ง JS */
function fetch_round(?string $roundId): ?array
{
    if ($roundId === null || $roundId === '') {
        return null;
    }
    $st = db()->prepare('SELECT * FROM rounds WHERE id = ?');
    $st->execute([$roundId]);
    $row = $st->fetch();
    return $row ? map_round($row) : null;
}

/* ------------------------------------------------------------------ */
/* แจ้งเตือน                                                           */
/* ------------------------------------------------------------------ */

/**
 * เพิ่มแจ้งเตือนหนึ่งใบ
 *
 * $type บอกว่าเป็นเรื่องอะไร และ $ref บอกว่าอ้างถึงอะไร (เลขออเดอร์ / id ผู้ใช้)
 * หน้าเว็บใช้คู่นี้ตัดสินว่ากดแจ้งเตือนแล้วพาไปหน้าไหน — ห้ามไปเดาจากหัวข้อภาษาไทย
 *   admin_new_order | admin_new_slip | admin_order_cancelled  (ref = เลขออเดอร์, กล่องร้าน)
 *   admin_password_request                                    (ref = id ผู้ใช้, กล่องร้าน)
 *   order                                                     (ref = เลขออเดอร์, กล่องลูกค้า)
 *   password_reset                                            (ไม่มี ref, กล่องลูกค้า)
 * ไม่ส่ง $type (เช่น ข่าวสารที่แอดมิน broadcast) = แจ้งเตือนทั่วไป กดแล้วไม่ไปไหน
 */
function push_notification(string $userEmail, string $title, string $message, ?string $type = null, ?string $ref = null): void
{
    $st = db()->prepare(
        'INSERT INTO notifications (user_email, title, message, type, ref, created_at, is_read)
         VALUES (?, ?, ?, ?, ?, ?, 0)'
    );
    $st->execute([$userEmail, $title, $message, $type, $ref, date('Y-m-d H:i:s')]);
}

/**
 * เติมโครงสร้างที่เพิ่มทีหลังให้ DB ที่สร้างไว้ก่อน (เช่นบน Supabase) — เรียกตอนต้นทุกคำขอ
 * ทำงานจริงแค่ครั้งแรกหลัง container/เซิร์ฟเวอร์เริ่ม แล้วจำไว้ด้วยไฟล์ใน temp ครั้งต่อไปเช็คแค่ไฟล์
 *
 * ทุกคำสั่งต้องรันซ้ำได้ (IF NOT EXISTS) เพราะ DB ที่สร้างจาก schema.sql ล่าสุดมีครบอยู่แล้ว
 * เพิ่มคอลัมน์ใหม่ในอนาคต: ใส่ใน schema.sql + เพิ่มบรรทัดที่นี่ + เปลี่ยนชื่อ SCHEMA_FLAG_FILE
 * ตอนนี้ยังว่าง — schema.sql ฉบับ PostgreSQL เป็นฉบับแรก มีทุกคอลัมน์ครบแล้ว
 */
function ensure_schema_once(): void
{
    // container นี้เคยเช็คแล้ว ไม่ต้องทำซ้ำ
    if (is_file(SCHEMA_FLAG_FILE)) {
        return;
    }
    // รันคำสั่งอัปเกรดทุกข้อ (ทุกข้อรันซ้ำได้ไม่พัง)
    foreach (SCHEMA_UPGRADES as $sql) {
        db()->exec($sql);
    }
    // จำไว้ว่าทำแล้ว (@ = ถ้าเขียนไฟล์ไม่ได้ก็ไม่เป็นไร แค่จะเช็คซ้ำรอบหน้า)
    @touch(SCHEMA_FLAG_FILE);
}

/* ------------------------------------------------------------------ */
/* อีเมล                                                               */
/*                                                                     */
/* ส่งผ่าน HTTPS API ของบริการส่งอีเมล ไม่พึ่ง SMTP                    */
/* (โฮสต์ฟรีหลายเจ้าปิดพอร์ต SMTP ขาออก)                               */
/* ตั้งค่าด้วย environment variable (Vercel → Settings → Environment):  */
/*   MAIL_PROVIDER  = brevo | resend                                   */
/*   MAIL_API_KEY   = API key ของบริการนั้น                             */
/*   MAIL_FROM      = อีเมลผู้ส่งที่ยืนยันกับบริการแล้ว                  */
/*   MAIL_FROM_NAME = ชื่อผู้ส่ง (ไม่ใส่ = KPOP STORE)                   */
/* ------------------------------------------------------------------ */

/** ตั้งค่าส่งอีเมลครบหรือยัง */
function mail_configured(): bool
{
    return in_array(getenv('MAIL_PROVIDER'), ['brevo', 'resend'], true)
        && getenv('MAIL_API_KEY') && getenv('MAIL_FROM');
}

/**
 * ส่งอีเมล คืน true เฉพาะเมื่อบริการส่งอีเมลรับไปจริง — คืน false = ผู้รับจะไม่ได้อีเมล ผู้เรียกต้องใช้ทางสำรอง
 *
 * ยังไม่ได้ตั้งค่าบนเครื่อง (ไม่ใช่ production): เขียนลงไฟล์ outbox ใน temp ให้เปิดลิงก์ทดสอบได้
 * แต่ยังคืน false เพราะไม่มีใครได้อีเมลจริง (เดิมคืน true แล้วคำขอลืมรหัสหายเงียบ ไม่ถึงทั้งลูกค้าและแอดมิน)
 */
function send_mail(string $toEmail, string $toName, string $subject, string $html, string $text): bool
{
    // ยังไม่ได้ตั้งค่าบริการอีเมล → ส่งจริงไม่ได้
    if (!mail_configured()) {
        if (!IS_PRODUCTION) {
            $entry = sprintf("=== %s\nTo: %s <%s>\nSubject: %s\n\n%s\n\n", date('Y-m-d H:i:s'), $toName, $toEmail, $subject, $text);
            file_put_contents(sys_get_temp_dir() . '/kpop-mail-outbox.log', $entry, FILE_APPEND);
            error_log("[kpop-mail] (dev outbox) {$subject} -> {$toEmail}");
        }
        return false;
    }

    $fromEmail = (string) getenv('MAIL_FROM');
    $fromName  = (string) (getenv('MAIL_FROM_NAME') ?: 'KPOP STORE');
    $key       = (string) getenv('MAIL_API_KEY');

    // แต่ละบริการใช้ URL, header และรูปแบบข้อมูลต่างกัน
    if (getenv('MAIL_PROVIDER') === 'brevo') {
        $url     = 'https://api.brevo.com/v3/smtp/email';
        $headers = ['api-key: ' . $key];
        $payload = [
            'sender'      => ['name' => $fromName, 'email' => $fromEmail],
            'to'          => [['email' => $toEmail, 'name' => $toName]],
            'subject'     => $subject,
            'htmlContent' => $html,
            'textContent' => $text,
        ];
    } else {
        $url     = 'https://api.resend.com/emails';
        $headers = ['Authorization: Bearer ' . $key];
        $payload = [
            'from'    => "{$fromName} <{$fromEmail}>",
            'to'      => [$toEmail],
            'subject' => $subject,
            'html'    => $html,
            'text'    => $text,
        ];
    }

    // ยิง HTTPS POST ไปที่บริการส่งอีเมล (รอไม่เกิน 10 วินาที)
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => array_merge($headers, ['Content-Type: application/json', 'Accept: application/json']),
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $body   = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    // 2xx = บริการรับอีเมลไปแล้ว
    if ($status >= 200 && $status < 300) {
        return true;
    }
    // ไม่ใส่ key ลง log — มีแค่สถานะกับข้อความตอบกลับของบริการ
    error_log('[kpop-mail] ส่งไม่สำเร็จ (' . getenv('MAIL_PROVIDER') . " HTTP {$status}) " . ($err ?: substr((string) $body, 0, 300)));
    return false;
}

/**
 * URL หน้าแรกของเว็บ สำหรับประกอบลิงก์ในอีเมล
 * บนเว็บจริงห้ามเชื่อ Host header — ใครก็ส่งมาเป็นโดเมนตัวเองได้ แล้วลิงก์รีเซ็ตในอีเมลจะชี้ไปเว็บปลอม
 * จึงใช้ APP_BASE_URL ถ้าตั้งไว้ ไม่งั้นใช้โดเมนหลักที่ Vercel ฉีดมาให้ (VERCEL_PROJECT_PRODUCTION_URL ไม่มี https:// นำหน้า
 * ต้องเปิด "Automatically expose System Environment Variables" ในโปรเจกต์ Vercel ก่อน)
 */
function app_base_url(): string
{
    // ลำดับความสำคัญ: APP_BASE_URL → โดเมนของ Vercel → (เฉพาะเครื่องพัฒนา) Host ของคำขอ
    if ($u = getenv('APP_BASE_URL')) {
        return rtrim($u, '/');
    }
    if ($d = getenv('VERCEL_PROJECT_PRODUCTION_URL')) {
        return 'https://' . $d;
    }
    if (IS_PRODUCTION) {
        throw new RuntimeException('ไม่รู้ URL ของเว็บ — ตั้ง APP_BASE_URL ใน environment');
    }
    $https = ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || !empty($_SERVER['HTTPS']);
    return ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

/** อีเมลกลางของร้าน ใช้เป็นปลายทางแจ้งเตือนฝั่งแอดมิน */
const SHOP_EMAIL = 'admin@kpopstore.com';
