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

// ตะกร้าผูกกับบัญชี — ต้องล็อกอินก่อนทุกคำสั่ง
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
    // ปัดเศษลงเป็นจำนวนเต็ม แล้วบังคับให้อย่างน้อย 1
    $n = (int) floor((float) $value);
    if ($n < 1) {
        $n = 1;
    }
    if ($max !== null && $max >= 1) {
        $n = min($n, $max);
    }
    return $n;
}

/**
 * จำนวนของสินค้านี้ในตะกร้า "ไซซ์อื่น" — โควตานับรวมทุกไซซ์
 * ถ้าไม่หักส่วนนี้ ลูกค้าใส่ M เต็มโควตาแล้วใส่ L ได้อีกเต็มโควตา
 */
function other_sizes_qty(string $userId, string $productId, string $size): int
{
    $st = db()->prepare('SELECT COALESCE(SUM(qty), 0) FROM cart_items WHERE user_id = ? AND product_id = ? AND size <> ?');
    $st->execute([$userId, $productId, $size]);
    return (int) $st->fetchColumn();
}

// เลือกงานตาม ?action=
switch (action()) {

    /* ---------------------------------------------------------- */
    // ใส่สินค้าลงตะกร้า (สินค้า+ไซซ์เดิมที่มีอยู่แล้ว → บวกจำนวนเพิ่ม)
    case 'add': {
        $productId = (string) ($in['productId'] ?? '');
        $size      = trim((string) ($in['size'] ?? ''));
        $addQty    = normalize_qty($in['qty'] ?? 1);

        // ตรวจสินค้า: มีจริง · ไม่ได้ปิดขาย · ไซซ์ถูกต้อง · รอบเปิดอยู่ · โควตายังเหลือ
        $st = db()->prepare('SELECT * FROM products WHERE id = ?');
        $st->execute([$productId]);
        $product = $st->fetch();
        if (!$product) {
            fail('ไม่พบสินค้านี้ในระบบค่ะ', 200, ['cart' => cart_of($user['id'])]);
        }
        if (strtoupper((string) $product['status']) === 'OUT OF STOCK') {
            fail('สินค้านี้ปิดการขายชั่วคราวค่ะ (หมดชั่วคราว)', 200, ['cart' => cart_of($user['id'])]);
        }
        if (!is_valid_size($product, $size)) {
            fail($size === '' ? 'กรุณาเลือกไซซ์ก่อนค่ะ' : 'ไม่มีไซซ์นี้สำหรับสินค้านี้ค่ะ',
                 200, ['cart' => cart_of($user['id'])]);
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
        // โควตาที่เหลือให้ไซซ์นี้ = โควตารอบ - ไซซ์อื่นที่อยู่ในตะกร้าแล้ว
        if ($remaining !== null) {
            $remaining -= other_sizes_qty($user['id'], $productId, $size);
            if ($remaining <= 0) {
                fail('ในตะกร้ามีสินค้านี้ (ไซซ์อื่น) ครบจำนวนที่รอบนี้รับได้แล้วค่ะ',
                     200, ['cart' => cart_of($user['id'])]);
            }
        }

        // จำนวนที่ขอ = ของเดิมในตะกร้า + ที่เพิ่งกดเพิ่ม
        $st = db()->prepare('SELECT qty FROM cart_items WHERE user_id = ? AND product_id = ? AND size = ?');
        $st->execute([$user['id'], $productId, $size]);
        $existing  = (int) ($st->fetchColumn() ?: 0);
        $requested = $existing + $addQty;

        // clamp เองแทน normalize_qty($v, $max) เพราะเมื่อ max = 0 ตัวนั้นจะถือว่า "ไม่มีเพดาน"
        $finalQty = $remaining !== null ? min($requested, $remaining) : $requested;

        $st = db()->prepare(
            'INSERT INTO cart_items (user_id, product_id, size, qty, added_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (user_id, product_id, size) DO UPDATE SET qty = EXCLUDED.qty'
        );
        // ยังไม่มีบรรทัดนี้ = เพิ่มใหม่ · มีแล้ว (ชน unique user+สินค้า+ไซซ์) = แก้จำนวนแทน (ON CONFLICT ด้านบน)
        $st->execute([$user['id'], $productId, $size, $finalQty, date('Y-m-d H:i:s')]);

        ok([
            'qty'      => $finalQty,
            'adjusted' => $finalQty !== $requested,
            'cart'     => cart_of($user['id']),
        ]);
    }

    /* ---------------------------------------------------------- */
    // แก้จำนวนของบรรทัดเดิมในตะกร้า (ปรับลงให้ไม่เกินโควตา)
    case 'update': {
        $productId = (string) ($in['productId'] ?? '');
        $size      = trim((string) ($in['size'] ?? ''));

        $st = db()->prepare('SELECT qty FROM cart_items WHERE user_id = ? AND product_id = ? AND size = ?');
        $st->execute([$user['id'], $productId, $size]);
        if ($st->fetchColumn() === false) {
            fail('ไม่พบสินค้านี้ในตะกร้า', 200, ['cart' => cart_of($user['id'])]);
        }

        $remaining = remaining_quota($productId);
        if ($remaining !== null) {
            $remaining -= other_sizes_qty($user['id'], $productId, $size);
        }
        $requested = normalize_qty($in['qty'] ?? 1);
        // ไม่เกินที่เหลือ แต่ต่ำสุด 1 (ถ้าเต็มแล้ว ลูกค้าต้องลบเอง ระบบไม่ลบให้)
        $finalQty  = $remaining !== null ? min($requested, max(1, $remaining)) : $requested;

        $st = db()->prepare('UPDATE cart_items SET qty = ? WHERE user_id = ? AND product_id = ? AND size = ?');
        $st->execute([$finalQty, $user['id'], $productId, $size]);

        ok([
            'qty'      => $finalQty,
            'adjusted' => $finalQty !== $requested,
            'cart'     => cart_of($user['id']),
        ]);
    }

    /* ---------------------------------------------------------- */
    // ลบบรรทัดสินค้า+ไซซ์นั้นออกจากตะกร้า
    case 'remove': {
        $st = db()->prepare('DELETE FROM cart_items WHERE user_id = ? AND product_id = ? AND size = ?');
        $st->execute([$user['id'], (string) ($in['productId'] ?? ''), trim((string) ($in['size'] ?? ''))]);
        ok(['cart' => cart_of($user['id'])]);
    }

    /* ---------------------------------------------------------- */
    /* ล้างเฉพาะสินค้าของรอบที่เพิ่งเช็คเอาต์ไป ของรอบอื่นต้องยังอยู่    */
    case 'clear-round': {
        $roundId = (string) ($in['roundId'] ?? '');
        $st = db()->prepare(
            'DELETE FROM cart_items ci
              USING products p
              WHERE p.id = ci.product_id AND ci.user_id = ? AND p.round_id = ?'
        );
        $st->execute([$user['id'], $roundId]);
        ok(['cart' => cart_of($user['id'])]);
    }

    /* ---------------------------------------------------------- */
    // action ที่ไม่รู้จัก
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
