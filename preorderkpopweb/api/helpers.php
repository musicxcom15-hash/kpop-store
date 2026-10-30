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

require_once __DIR__ . '/config.php';

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

/**
 * คุกกี้ session ต้องตั้งค่าก่อน session_start() เท่านั้น เรียกทีหลังไม่มีผล
 *
 * secure: Railway ตัด TLS ทิ้งที่ขอบเครือข่ายแล้วส่งต่อเข้ามาเป็น HTTP ธรรมดา
 * $_SERVER['HTTPS'] จึงว่างเปล่าทั้งที่ผู้ใช้เข้าผ่าน https จริง ต้องดูจาก
 * header ที่ proxy แปะมาแทน — ถ้าตั้ง secure ตายตัวเป็น true จะล็อกอินบน
 * localhost (http) ไม่ได้เลย
 */
if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'httponly' => true,               // JS อ่านคุกกี้นี้ไม่ได้
        'samesite' => 'Lax',              // กัน CSRF ขั้นพื้นฐาน (ทุก request เป็น same-origin อยู่แล้ว)
        'secure'   => (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
                      || (($_SERVER['HTTPS'] ?? '') !== ''),
    ]);
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
// ข้อมูลผู้ใช้/ออเดอร์ห้ามถูกแคช
header('Cache-Control: no-store');

/**
 * ข้อผิดพลาดที่ไม่ได้ดักไว้ต้องออกไปเป็น JSON เสมอ
 *
 * ถ้าปล่อยให้ PHP พ่น fatal error เป็น HTML ออกไป ฝั่งเบราว์เซอร์จะ parse JSON ไม่ผ่าน
 * แล้วผู้ใช้จะเห็นแค่หน้าค้างโดยไม่รู้ว่าเกิดอะไรขึ้น (เคสที่เจอบ่อยสุดคือลืมเปิด MAMP
 * หรือยังไม่ได้ import ฐานข้อมูล ซึ่งทั้งคู่แก้ได้ง่ายถ้ารู้สาเหตุ)
 *
 * แต่บนเว็บจริงข้อความพวกนั้นไม่ช่วยลูกค้า และมักพ่วงชื่อโฮสต์ พอร์ต ชื่อฐานข้อมูล
 * หรือ path ของไฟล์ออกไปด้วย ซึ่งเป็นข้อมูลตั้งต้นชั้นดีให้คนที่กำลังหาช่องอยู่
 * บน production จึงตอบข้อความกลาง ๆ แล้วเก็บของจริงไว้ใน log (ดูได้ที่แท็บ Logs ของ Railway)
 */
set_exception_handler(function (Throwable $e): void {
    error_log('[kpop-api] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    // คอลัมน์หาย (เช่น import .sql รุ่นเก่าทับตอน container ยังรัน) — ลืมว่าเคยเช็คแล้ว คำขอถัดไปจะเติมให้เอง
    if ($e instanceof PDOException && $e->getCode() === '42S22') {
        @unlink(SCHEMA_FLAG_FILE);
    }
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => IS_PRODUCTION
            ? 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลังค่ะ'
            : $e->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
});

// ก่อน endpoint ใดจะเปิด transaction — เติมตาราง/คอลัมน์ใหม่ให้ DB ที่ import ไว้ก่อน (ทำจริงครั้งเดียวต่อ container)
// เปลี่ยนชื่อไฟล์ (v2, v3, ...) ทุกครั้งที่เพิ่มของใน ensure_schema() เพื่อให้ container ที่เคยเช็คแล้วเช็คใหม่
define('SCHEMA_FLAG_FILE', sys_get_temp_dir() . '/kpop-schema-v3');
ensure_schema_once();

/* ------------------------------------------------------------------ */
/* ตาราง ORDER_STATUS — ต้องตรงกับ js/store.js เป๊ะ                    */
/*                                                                     */
/*   revenue         นับเข้ายอดขายรวมหรือไม่                            */
/*   quota           กินโควตารับพรีออเดอร์ของรอบอยู่หรือไม่               */
/*   canCancel       ลูกค้ากดยกเลิกเองได้หรือไม่                         */
/*   canReuploadSlip ลูกค้าส่งสลิปใบใหม่ได้หรือไม่                       */
/* ------------------------------------------------------------------ */
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
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
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
    $chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $out = '';
    for ($i = 0; $i < $length; $i++) {
        $out .= $chars[random_int(0, strlen($chars) - 1)];
    }
    return $out;
}

/* ------------------------------------------------------------------ */
/* รูปแบบวันเวลา                                                       */
/*                                                                     */
/* ทั้งระบบฝั่ง JS ใช้ 'YYYY-MM-DD HH:mm' แล้วเทียบกันเป็น "สตริง" ตรง ๆ  */
/* (เช่น หาเรทที่มีผล ณ ตอนนี้) ถ้าปล่อยวินาทีจาก MySQL ติดมาด้วย       */
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
/* ต้องแคสต์ชนิดให้ตรงด้วย ไม่ใช่แค่เปลี่ยนชื่อคีย์ เพราะ MySQL คืน       */
/* DECIMAL มาเป็นสตริง ถ้าปล่อยไว้ JS จะเอาไปบวกกันแล้วได้สตริงต่อกัน     */
/* ------------------------------------------------------------------ */

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
        'quotaPerRound' => $r['quota_per_round'] === null ? null : (int) $r['quota_per_round'],
        'image'         => $r['image'],
        'status'        => $r['status'],
        'estDelivery'   => $r['est_delivery'],
        'desc'          => $r['description'],
        // ?? เผื่อ DB เก่าก่อนมีคอลัมน์ (ensure_product_category_column เติมให้ตอนต้นคำขอ)
        'category'      => $r['category'] ?? 'album',
    ];
}

/**
 * หมวดหมู่สินค้า — เก็บเป็นรหัส ชื่อไทย/ไอคอนอยู่ที่ PRODUCT_CATEGORIES ใน js/store.js (ต้องตรงกัน)
 * สินค้าเดิมก่อนมีหมวดหมู่ทั้งหมดเป็นอัลบั้ม จึงใช้ album เป็นค่าตั้งต้น
 */
const PRODUCT_CATEGORIES = ['album', 'lightstick', 'photocard', 'merch'];

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
        'address'   => $r['address'],
        'role'      => $r['role'],
        'createdAt' => $r['created_at'],
    ];
}

function map_order_item(array $r): array
{
    return [
        'id'         => $r['product_id'],   // ฝั่ง JS ใช้ item.id เป็นรหัสสินค้า
        'title'      => $r['title'],
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
        'status'             => ORDER_STATUS[$code]['text'] ?? $code,
        'roundId'            => $r['round_id'],
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
        'items'      => array_map(fn($i) => ['id' => $i['id'], 'qty' => $i['qty']], $items),
    ];
}

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

function map_cart_item(array $r): array
{
    return [
        'productId' => $r['product_id'],
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
    $ph = implode(',', array_fill(0, count($orderIds), '?'));
    $st = db()->prepare("SELECT * FROM order_items WHERE order_id IN ($ph) ORDER BY id");
    $st->execute($orderIds);

    $byOrder = [];
    foreach ($st->fetchAll() as $row) {
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
    $st = db()->prepare('SELECT quota_per_round, round_id FROM products WHERE id = ?');
    $st->execute([$productId]);
    $p = $st->fetch();
    if (!$p || $p['quota_per_round'] === null) {
        return null;
    }

    $codes = quota_consuming_codes();
    $ph = implode(',', array_fill(0, count($codes), '?'));

    $sql = "SELECT COALESCE(SUM(oi.qty), 0)
              FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
             WHERE oi.product_id = ?
               AND o.round_id <=> ?
               AND o.status_code IN ($ph)";
    $st = db()->prepare($sql);
    $st->execute(array_merge([$productId, $p['round_id']], $codes));

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
    $insert = function () use ($userEmail, $title, $message, $type, $ref): void {
        $st = db()->prepare(
            'INSERT INTO notifications (user_email, title, message, type, ref, created_at, is_read)
             VALUES (?, ?, ?, ?, ?, ?, 0)'
        );
        $st->execute([$userEmail, $title, $message, $type, $ref, date('Y-m-d H:i:s')]);
    };

    try {
        $insert();
    } catch (PDOException $e) {
        // ทางสำรองเผื่อ ensure_schema_once() ยังไม่ได้ทำงาน: 42S22 = unknown column
        // ห้าม ALTER ระหว่าง transaction เพราะ MySQL จะ commit ของที่ค้างอยู่ให้ทันที (เช่นออเดอร์ที่สร้างไม่เสร็จ)
        if ($e->getCode() !== '42S22' || db()->inTransaction()) {
            throw $e;
        }
        ensure_notification_columns();
        $insert();
    }
}

/**
 * อัปเกรดโครงสร้างตารางที่ต้องมีให้ DB รุ่นเก่า (เช่นบน Railway ที่ import ไว้ก่อน) — เรียกตอนต้นทุกคำขอ
 * ทำงานจริงแค่ครั้งแรกหลัง container/เซิร์ฟเวอร์เริ่ม แล้วจำไว้ด้วยไฟล์ใน temp ครั้งต่อไปเช็คแค่ไฟล์
 * ต้องเรียกก่อนเปิด transaction ใด ๆ เพราะ ALTER TABLE ทำให้ MySQL commit transaction ที่ค้างอยู่
 */
function ensure_schema_once(): void
{
    if (is_file(SCHEMA_FLAG_FILE)) {
        return;
    }
    ensure_notification_columns();
    ensure_password_resets_table();
    ensure_product_category_column();
    @touch(SCHEMA_FLAG_FILE);
}

/** คอลัมน์หมวดหมู่สินค้า — DB ที่ import ก่อนมีหมวดหมู่ ได้ค่า album ให้สินค้าเดิมทุกชิ้น */
function ensure_product_category_column(): void
{
    $has = db()->query(
        "SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'category'"
    )->fetchColumn();
    if ((int) $has === 0) {
        db()->exec("ALTER TABLE products ADD COLUMN `category` VARCHAR(32) NOT NULL DEFAULT 'album' AFTER title");
    }
}

/**
 * ตารางลิงก์รีเซ็ตรหัสผ่าน (ต้องตรงกับ database/*.sql)
 * เก็บแค่ hash ของ token — ถ้า DB หลุด คนได้ไปก็เอาไปเปิดลิงก์ไม่ได้
 * ไม่ใส่ foreign key: ถ้า collation ของ users บน DB เก่าไม่ตรง การสร้างจะล้มแล้วพาทุกคำขอล้มตาม
 * (users.php ลบ token ของผู้ใช้ที่ถูกลบเองแทน)
 */
function ensure_password_resets_table(): void
{
    db()->exec(
        'CREATE TABLE IF NOT EXISTS password_resets (
            id         INT         NOT NULL AUTO_INCREMENT,
            user_id    VARCHAR(50) NOT NULL,
            token_hash CHAR(64)    NOT NULL,
            expires_at DATETIME    NOT NULL,
            used_at    DATETIME    NULL,
            created_at DATETIME    NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_reset_token (token_hash),
            KEY idx_reset_user (user_id, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

/* ------------------------------------------------------------------ */
/* อีเมล                                                               */
/*                                                                     */
/* Railway แพ็กเกจ Free/Hobby ปิด SMTP ("SMTP is only available on the */
/* Pro plan and above") จึงส่งผ่าน HTTPS API ของบริการส่งอีเมลแทน      */
/* ตั้งค่าด้วย environment variable (ใน Railway → Variables ของ web):    */
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
 * จึงใช้ APP_BASE_URL ถ้าตั้งไว้ ไม่งั้นใช้โดเมนที่ Railway ฉีดมาให้ (RAILWAY_PUBLIC_DOMAIN)
 */
function app_base_url(): string
{
    if ($u = getenv('APP_BASE_URL')) {
        return rtrim($u, '/');
    }
    if ($d = getenv('RAILWAY_PUBLIC_DOMAIN')) {
        return 'https://' . $d;
    }
    if (IS_PRODUCTION) {
        throw new RuntimeException('ไม่รู้ URL ของเว็บ — ตั้ง APP_BASE_URL ใน environment');
    }
    $https = ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || !empty($_SERVER['HTTPS']);
    return ($https ? 'https://' : 'http://') . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

/** เติมคอลัมน์ type/ref ให้ตาราง notifications ที่สร้างจาก .sql รุ่นเก่า (เรียกซ้ำได้ ไม่เพิ่มซ้ำ) */
function ensure_notification_columns(): void
{
    $have = db()->query(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'"
    )->fetchAll(PDO::FETCH_COLUMN);

    if (!in_array('type', $have, true)) {
        db()->exec('ALTER TABLE notifications ADD COLUMN `type` VARCHAR(32) NULL AFTER message');
    }
    if (!in_array('ref', $have, true)) {
        db()->exec('ALTER TABLE notifications ADD COLUMN `ref` VARCHAR(64) NULL AFTER `type`');
    }
}

/** อีเมลกลางของร้าน ใช้เป็นปลายทางแจ้งเตือนฝั่งแอดมิน */
const SHOP_EMAIL = 'admin@kpopstore.com';
