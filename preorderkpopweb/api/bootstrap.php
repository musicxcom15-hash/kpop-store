<?php
/**
 * ดึงข้อมูลทั้งหมดที่หน้าเว็บต้องใช้ในคำขอเดียว
 *
 * js/store.js เรียกไฟล์นี้ครั้งเดียวตอนโหลดหน้า แล้วเก็บผลไว้ในหน่วยความจำ
 * เมธอดอ่านค่าทุกตัว (getProducts, getRemainingQuota, getCartGroupedByRound ...)
 * จึงยังทำงานแบบ synchronous ได้เหมือนตอนใช้ localStorage
 * ทำให้โค้ดที่วาดหน้าจอในทุกหน้าไม่ต้องแก้แม้แต่บรรทัดเดียว
 *
 * เรื่องความเป็นส่วนตัว:
 * การคำนวณโควตาคงเหลือต้องมองเห็นออเดอร์ของ "ทุกคน" แต่ลูกค้าต้องไม่เห็น
 * ข้อมูลส่วนตัวของคนอื่น จึงส่งออเดอร์กลับไปสองระดับ
 *   - แอดมิน      : ทุกใบ ข้อมูลครบ
 *   - ลูกค้า       : ของตัวเองครบ + ของคนอื่นเหลือแค่ id/สถานะ/รอบ/จำนวน
 *   - ยังไม่ล็อกอิน : เฉพาะฉบับตัดข้อมูลส่วนตัว (พอให้หน้าแรกโชว์ว่าเต็มโควตาแล้ว)
 */

require_once __DIR__ . '/helpers.php';

// ใครกำลังเปิดหน้าเว็บ (null = ยังไม่ล็อกอิน) และเป็นแอดมินไหม
$user = current_user();
$isAdmin = $user && $user['role'] === 'admin';

/* --- สินค้า / รอบ : ข้อมูลสาธารณะ ทุกคนเห็นเหมือนกัน --- */
// สินค้าทั้งหมด เรียงตามรหัส
$products = array_map('map_product', db()->query('SELECT * FROM products ORDER BY id')->fetchAll());
// ยกเว้นลิงก์ร้านต้นทาง — เป็นข้อมูลภายในร้าน เห็นเฉพาะแอดมิน
if (!$isAdmin) {
    $products = array_map(fn($p) => array_diff_key($p, ['sourceUrl' => true]), $products);
}
// รอบพรีออเดอร์ทั้งหมด เรียงตามวันเปิด
$rounds   = array_map('map_round',   db()->query('SELECT * FROM rounds ORDER BY open_at')->fetchAll());

/* --- ออเดอร์ --- */
// ออเดอร์ทุกใบ ใหม่สุดก่อน + รายการสินค้าของทุกใบ (ดึงรวดเดียว ไม่ยิงทีละใบ)
$orderRows = db()->query('SELECT * FROM orders ORDER BY order_date DESC')->fetchAll();
$itemsByOrder = fetch_items_by_order(array_column($orderRows, 'id'));

$orders = [];
foreach ($orderRows as $row) {
    $items = $itemsByOrder[$row['id']] ?? [];
    // เป็นออเดอร์ของคนที่เปิดหน้าอยู่ไหม (เทียบอีเมลแบบไม่สนตัวพิมพ์)
    $isOwn = $user && strcasecmp($row['customer_email'], $user['email']) === 0;

    // แอดมินหรือเจ้าของ → ข้อมูลเต็ม · คนอื่น → เหลือแค่ที่ใช้คิดโควตา
    $orders[] = ($isAdmin || $isOwn)
        ? map_order($row, $items)
        : map_order_for_quota($row, $items);
}

/* --- แจ้งเตือน : เฉพาะของตัวเอง (แอดมินเห็นของกล่องร้านด้วย) --- */
$notifications = [];
if ($user) {
    // แจ้งเตือนของผู้ใช้คนนี้ ใหม่สุดก่อน
    $st = db()->prepare('SELECT * FROM notifications WHERE lower(user_email) = lower(?) ORDER BY created_at DESC, id DESC');
    $st->execute([$user['email']]);
    $notifications = array_map('map_notification', $st->fetchAll());
}

/* --- ตะกร้า : ผูกกับบัญชี ไม่ใช่เบราว์เซอร์อีกต่อไป --- */
$cart = [];
if ($user) {
    // สินค้าในตะกร้าของผู้ใช้คนนี้ ตามลำดับที่หยิบใส่
    $st = db()->prepare('SELECT * FROM cart_items WHERE user_id = ? ORDER BY added_at');
    $st->execute([$user['id']]);
    $cart = array_map('map_cart_item', $st->fetchAll());
}

/* --- รายชื่อผู้ใช้ : แอดมินเท่านั้น --- */
$users = [];
if ($isAdmin) {
    $users = array_map('map_user', db()->query('SELECT * FROM users ORDER BY created_at, id')->fetchAll());
} elseif ($user) {
    // ลูกค้าเห็นได้แค่ตัวเอง เพื่อให้ getUserByEmail ของตัวเองยังทำงาน
    $users = [map_user($user)];
}

// ส่งทุกอย่างกลับไปในคำตอบเดียว — js/store.js เก็บไว้ในหน่วยความจำแล้วค่อยวาดหน้า
ok([
    'currentUser'   => $user ? map_user($user) : null,
    'products'      => $products,
    'rounds'        => $rounds,
    'orders'        => $orders,
    'notifications' => $notifications,
    'cart'          => $cart,
    'users'         => $users,
]);
