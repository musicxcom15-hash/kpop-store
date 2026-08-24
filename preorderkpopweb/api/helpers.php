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
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => IS_PRODUCTION
            ? 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลังค่ะ'
            : $e->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
});

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

/** แปลงค่าที่รับมาให้เป็น DATETIME ที่ MySQL รับได้ */
function to_datetime(?string $value): ?string
{
    if ($value === null || trim($value) === '') {
        return null;
    }
    $value = str_replace('T', ' ', trim($value));
    $ts = strtotime($value);
    return $ts === false ? null : date('Y-m-d H:i:s', $ts);
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
    ];
}

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

function map_rate(array $r): array
{
    return [
        'rate'          => rate_value($r['rate']),
        'effectiveFrom' => stamp($r['effective_from']),
        'setBy'         => $r['set_by'],
        'note'          => $r['note'],
    ];
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

/** เรทที่มีผลบังคับใช้อยู่ ณ ตอนนี้ */
function current_rate(): array
{
    $st = db()->query(
        'SELECT * FROM rates WHERE effective_from <= NOW() ORDER BY effective_from DESC, id DESC LIMIT 1'
    );
    $row = $st->fetch();
    if ($row) {
        return map_rate($row);
    }
    // ยังไม่มีเรทที่ถึงเวลา — ใช้แถวเก่าสุดไปก่อน ดีกว่าปล่อยให้ราคาเป็นศูนย์
    $row = db()->query('SELECT * FROM rates ORDER BY effective_from ASC, id ASC LIMIT 1')->fetch();
    return $row ? map_rate($row) : ['rate' => 0.0265, 'effectiveFrom' => now_stamp(), 'setBy' => 'system', 'note' => ''];
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

/** เพิ่มแจ้งเตือนหนึ่งใบ */
function push_notification(string $userEmail, string $title, string $message): void
{
    $st = db()->prepare(
        'INSERT INTO notifications (user_email, title, message, created_at, is_read)
         VALUES (?, ?, ?, ?, 0)'
    );
    $st->execute([$userEmail, $title, $message, date('Y-m-d H:i:s')]);
}

/** อีเมลกลางของร้าน ใช้เป็นปลายทางแจ้งเตือนฝั่งแอดมิน */
const SHOP_EMAIL = 'admin@kpopstore.com';
