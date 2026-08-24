<?php
/**
 * จัดการสินค้า (เฉพาะแอดมิน)
 *
 * saveProduct เป็น upsert เหมือนของเดิม — มี id อยู่แล้วคือแก้ ไม่มีคือเพิ่มใหม่
 * deleteProduct ปฏิเสธถ้ายังมีออเดอร์ค้างอยู่ เพราะออเดอร์นั้นจะอ้างถึงสินค้าที่ไม่มีตัวตน
 * ทำให้โควตาอ่านได้ 0 และราคากลายเป็น ฿0 ทั้งที่ลูกค้ายังรอของอยู่
 */

require_once __DIR__ . '/helpers.php';

require_admin();
$in = body();

/** สินค้าทั้งหมดในรูปทรงฝั่ง JS (ส่งกลับไปให้ cache อัปเดตทันที) */
function all_products(): array
{
    return array_map('map_product', db()->query('SELECT * FROM products ORDER BY id')->fetchAll());
}

switch (action()) {

    /* ---------------------------------------------------------- */
    case 'save': {
        $id      = trim((string) ($in['id'] ?? ''));
        $artist  = trim((string) ($in['artist'] ?? ''));
        $title   = trim((string) ($in['title'] ?? ''));
        $roundId = trim((string) ($in['roundId'] ?? ''));

        if ($artist === '' || $title === '') {
            fail('กรุณากรอกชื่อศิลปินและชื่อสินค้าค่ะ', 200, ['products' => all_products()]);
        }
        if ($roundId === '' || !fetch_round($roundId)) {
            fail('กรุณาเลือกรอบพรีออเดอร์ที่มีอยู่จริงค่ะ', 200, ['products' => all_products()]);
        }

        $status = strtoupper(trim((string) ($in['status'] ?? 'PRE-ORDER')));
        if (!in_array($status, ['PRE-ORDER', 'OUT OF STOCK'], true)) {
            $status = 'PRE-ORDER';
        }

        // '' หรือ null = รับไม่จำกัด ห้ามแปลงเป็น 0 เพราะ 0 แปลว่า "เต็มแล้ว"
        $quotaRaw = $in['quotaPerRound'] ?? null;
        $quota = ($quotaRaw === null || $quotaRaw === '') ? null : max(0, (int) $quotaRaw);

        $priceKRW   = max(0, (int) ($in['priceKRW'] ?? 0));
        $serviceFee = max(0, (float) ($in['serviceFee'] ?? 0));
        $priceRaw   = $in['price'] ?? null;
        $price      = ($priceRaw === null || $priceRaw === '') ? null : (float) $priceRaw;

        $image       = trim((string) ($in['image'] ?? ''));
        $estDelivery = trim((string) ($in['estDelivery'] ?? ''));
        $desc        = (string) ($in['desc'] ?? '');

        if ($id === '') {
            $id = 'prod-' . time() . '-' . bin2hex(random_bytes(3));
        }

        $st = db()->prepare('SELECT id FROM products WHERE id = ?');
        $st->execute([$id]);
        $exists = (bool) $st->fetch();

        if ($exists) {
            $st = db()->prepare(
                'UPDATE products SET artist = ?, title = ?, price_krw = ?, service_fee = ?, price = ?,
                                     round_id = ?, quota_per_round = ?, image = ?, status = ?,
                                     est_delivery = ?, description = ?
                 WHERE id = ?'
            );
            $st->execute([$artist, $title, $priceKRW, $serviceFee, $price, $roundId, $quota,
                          $image, $status, $estDelivery, $desc, $id]);
        } else {
            $st = db()->prepare(
                'INSERT INTO products (id, artist, title, price_krw, service_fee, price, round_id,
                                       quota_per_round, image, status, est_delivery, description)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
            );
            $st->execute([$id, $artist, $title, $priceKRW, $serviceFee, $price, $roundId, $quota,
                          $image, $status, $estDelivery, $desc]);
        }

        ok(['products' => all_products(), 'id' => $id]);
    }

    /* ---------------------------------------------------------- */
    case 'delete': {
        $id = (string) ($in['id'] ?? '');

        // ออเดอร์ที่ยัง "อยู่ระหว่างดำเนินการ" คือกลุ่ม pending/processing หรือกำลังจัดส่ง
        $blockingCodes = array_keys(array_filter(
            ORDER_STATUS,
            fn($m, $c) => in_array($m['group'], ['pending', 'processing'], true) || $c === 'SHIPPING',
            ARRAY_FILTER_USE_BOTH
        ));
        $ph = implode(',', array_fill(0, count($blockingCodes), '?'));

        $st = db()->prepare(
            "SELECT DISTINCT o.id
               FROM orders o
               JOIN order_items oi ON oi.order_id = o.id
              WHERE oi.product_id = ? AND o.status_code IN ($ph)"
        );
        $st->execute(array_merge([$id], $blockingCodes));
        $blocking = $st->fetchAll(PDO::FETCH_COLUMN);

        if ($blocking) {
            $codes = implode(', ', $blocking);
            fail(
                'ลบไม่ได้ เพราะยังมีคำสั่งซื้อค้างอยู่ ' . count($blocking) . " รายการ\n" .
                "เลขที่: {$codes}\n\n" .
                "ถ้าต้องการปิดการขาย ให้แก้สินค้าแล้วเปลี่ยนป้ายสถานะเป็น OUT OF STOCK แทน\n" .
                'ข้อมูลของลูกค้าที่สั่งไว้แล้วจะได้ไม่เสียหาย',
                200,
                ['products' => all_products()]
            );
        }

        $st = db()->prepare('DELETE FROM products WHERE id = ?');
        $st->execute([$id]);

        ok(['products' => all_products()]);
    }

    /* ---------------------------------------------------------- */
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
