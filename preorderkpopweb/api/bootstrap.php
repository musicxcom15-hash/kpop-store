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

$user = current_user();
$isAdmin = $user && $user['role'] === 'admin';

/* --- สินค้า / รอบ / เรท : ข้อมูลสาธารณะ ทุกคนเห็นเหมือนกัน --- */
$products = array_map('map_product', db()->query('SELECT * FROM products ORDER BY id')->fetchAll());
$rounds   = array_map('map_round',   db()->query('SELECT * FROM rounds ORDER BY open_at')->fetchAll());
$rates    = array_map('map_rate',
    db()->query('SELECT * FROM rates ORDER BY effective_from DESC, id DESC')->fetchAll());

/* --- ออเดอร์ --- */
$orderRows = db()->query('SELECT * FROM orders ORDER BY order_date DESC')->fetchAll();
$itemsByOrder = fetch_items_by_order(array_column($orderRows, 'id'));

$orders = [];
foreach ($orderRows as $row) {
    $items = $itemsByOrder[$row['id']] ?? [];
    $isOwn = $user && strcasecmp($row['customer_email'], $user['email']) === 0;

    $orders[] = ($isAdmin || $isOwn)
        ? map_order($row, $items)
        : map_order_for_quota($row, $items);
}

/* --- แจ้งเตือน : เฉพาะของตัวเอง (แอดมินเห็นของกล่องร้านด้วย) --- */
$notifications = [];
if ($user) {
    $st = db()->prepare('SELECT * FROM notifications WHERE user_email = ? ORDER BY created_at DESC, id DESC');
    $st->execute([$user['email']]);
    $notifications = array_map('map_notification', $st->fetchAll());
}

/* --- ตะกร้า : ผูกกับบัญชี ไม่ใช่เบราว์เซอร์อีกต่อไป --- */
$cart = [];
if ($user) {
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

ok([
    'currentUser'   => $user ? map_user($user) : null,
    'products'      => $products,
    'rounds'        => $rounds,
    'rates'         => $rates,
    'orders'        => $orders,
    'notifications' => $notifications,
    'cart'          => $cart,
    'users'         => $users,
]);
