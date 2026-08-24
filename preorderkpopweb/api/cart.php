<?php
/**
 * ตะกร้าพรีออเดอร์
 *
 * ตะกร้าผูกกับบัญชีผู้ใช้ (เดิมเก็บใน localStorage ของเบราว์เซอร์ ทำให้คนละบัญชี
 * บนเครื่องเดียวกันใช้ตะกร้าใบเดียวกัน) ทุก endpoint จึงบังคับล็อกอิน
 *
 * กติกาโควตา/รอบเปิด ตรวจซ้ำที่นี่ด้วย ไม่เชื่อฝั่ง JS อย่างเดียว
 */

require_once __DIR__ . '/helpers.php';

$user = require_login();
$in   = body();

/** คืนตะกร้าปัจจุบันของผู้ใช้ ในรูปทรงที่ฝั่ง JS ใช้ */
function cart_of(string $userId): array
{
    $st = db()->prepare('SELECT * FROM cart_items WHERE user_id = ? ORDER BY added_at');
    $st->execute([$userId]);
    return array_map('map_cart_item', $st->fetchAll());
}

/** บังคับให้เป็นจำนวนเต็มบวก และไม่เกินเพดาน (ตรงกับ normalizeQty ฝั่ง JS) */
function normalize_qty($value, ?int $max = null): int
{
    $n = (int) floor((float) $value);
    if ($n < 1) {
        $n = 1;
    }
    if ($max !== null && $max >= 1) {
        $n = min($n, $max);
    }
    return $n;
}

switch (action()) {

    /* ---------------------------------------------------------- */
    case 'add': {
        $productId = (string) ($in['productId'] ?? '');
        $addQty    = normalize_qty($in['qty'] ?? 1);

        $st = db()->prepare('SELECT * FROM products WHERE id = ?');
        $st->execute([$productId]);
        $product = $st->fetch();
        if (!$product) {
            fail('ไม่พบสินค้านี้ในระบบค่ะ', 200, ['cart' => cart_of($user['id'])]);
        }
        if (strtoupper((string) $product['status']) === 'OUT OF STOCK') {
            fail('สินค้านี้ปิดการขายชั่วคราวค่ะ (หมดชั่วคราว)', 200, ['cart' => cart_of($user['id'])]);
        }

        $round = fetch_round($product['round_id']);
        if (round_state($round) !== 'open') {
            fail('รอบพรีออเดอร์ของสินค้านี้ยังไม่เปิดรับ หรือปิดรับไปแล้วค่ะ',
                 200, ['cart' => cart_of($user['id'])]);
        }

        $remaining = remaining_quota($productId);
        if ($remaining !== null && $remaining <= 0) {
            fail('รอบนี้เต็มโควตาแล้วค่ะ กรุณารอรอบถัดไป', 200, ['cart' => cart_of($user['id'])]);
        }

        // จำนวนที่ขอ = ของเดิมในตะกร้า + ที่เพิ่งกดเพิ่ม
        $st = db()->prepare('SELECT qty FROM cart_items WHERE user_id = ? AND product_id = ?');
        $st->execute([$user['id'], $productId]);
        $existing  = (int) ($st->fetchColumn() ?: 0);
        $requested = $existing + $addQty;

        // clamp เองแทน normalize_qty($v, $max) เพราะเมื่อ max = 0 ตัวนั้นจะถือว่า "ไม่มีเพดาน"
        $finalQty = $remaining !== null ? min($requested, $remaining) : $requested;

        $st = db()->prepare(
            'INSERT INTO cart_items (user_id, product_id, qty, added_at)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE qty = VALUES(qty)'
        );
        $st->execute([$user['id'], $productId, $finalQty, date('Y-m-d H:i:s')]);

        ok([
            'qty'      => $finalQty,
            'adjusted' => $finalQty !== $requested,
            'cart'     => cart_of($user['id']),
        ]);
    }

    /* ---------------------------------------------------------- */
    case 'update': {
        $productId = (string) ($in['productId'] ?? '');

        $st = db()->prepare('SELECT qty FROM cart_items WHERE user_id = ? AND product_id = ?');
        $st->execute([$user['id'], $productId]);
        if ($st->fetchColumn() === false) {
            fail('ไม่พบสินค้านี้ในตะกร้า', 200, ['cart' => cart_of($user['id'])]);
        }

        $remaining = remaining_quota($productId);
        $requested = normalize_qty($in['qty'] ?? 1);
        $finalQty  = $remaining !== null ? min($requested, max(1, $remaining)) : $requested;

        $st = db()->prepare('UPDATE cart_items SET qty = ? WHERE user_id = ? AND product_id = ?');
        $st->execute([$finalQty, $user['id'], $productId]);

        ok([
            'qty'      => $finalQty,
            'adjusted' => $finalQty !== $requested,
            'cart'     => cart_of($user['id']),
        ]);
    }

    /* ---------------------------------------------------------- */
    case 'remove': {
        $st = db()->prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?');
        $st->execute([$user['id'], (string) ($in['productId'] ?? '')]);
        ok(['cart' => cart_of($user['id'])]);
    }

    /* ---------------------------------------------------------- */
    /* ล้างเฉพาะสินค้าของรอบที่เพิ่งเช็คเอาต์ไป ของรอบอื่นต้องยังอยู่    */
    case 'clear-round': {
        $roundId = (string) ($in['roundId'] ?? '');
        $st = db()->prepare(
            'DELETE ci FROM cart_items ci
               JOIN products p ON p.id = ci.product_id
              WHERE ci.user_id = ? AND p.round_id = ?'
        );
        $st->execute([$user['id'], $roundId]);
        ok(['cart' => cart_of($user['id'])]);
    }

    /* ---------------------------------------------------------- */
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
