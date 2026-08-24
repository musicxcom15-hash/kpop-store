<?php
/**
 * คำสั่งซื้อ — สร้าง / ยกเลิก / ส่งสลิปใหม่ / เปลี่ยนสถานะ / คืนเงิน / ลบ
 *
 * พฤติกรรมทุกอย่างตรงกับเมธอดชุดเดิมใน js/store.js (addOrder, cancelOrderCustomer,
 * updateOrderStatus, approvePayment, rejectPayment, markPurchaseFailed,
 * markRefunded, updateOrderSlip, deleteOrder) รวมถึงข้อความแจ้งเตือน
 *
 * กติกาที่ห้ามเชื่อฝั่ง JS และต้องตรวจซ้ำที่นี่:
 *   - รอบต้องเปิดอยู่จริง
 *   - โควตาต้องพอจริง
 *   - ราคาและยอดรวมคำนวณใหม่จากราคาในฐานข้อมูล ไม่ใช่ตัวเลขที่เบราว์เซอร์ส่งมา
 *   - เจ้าของออเดอร์เท่านั้นที่ยกเลิก/ส่งสลิปใหม่ได้ ที่เหลือเป็นสิทธิ์แอดมิน
 */

require_once __DIR__ . '/helpers.php';

$in = body();

/** ราคาต่อชิ้นของสินค้า ณ เรทที่กำหนด (ตรงกับ getPriceBreakdown ฝั่ง JS) */
function price_breakdown(array $product, float $rate): array
{
    $krw = (int) $product['price_krw'];
    $serviceFee = (float) $product['service_fee'];

    // สินค้ายุคเก่าที่ตั้งราคาเป็นบาทคงที่ ไม่ผูกกับเรทเงินวอน
    if ($krw <= 0) {
        return ['krw' => null, 'serviceFee' => 0.0, 'total' => (float) ($product['price'] ?? 0)];
    }

    $converted = ceil($krw * $rate);
    return ['krw' => $krw, 'serviceFee' => $serviceFee, 'total' => $converted + $serviceFee];
}

/** ตัวเลขแบบมีคอมมา ให้ข้อความแจ้งเตือนหน้าตาเหมือนที่ JS สร้าง (toLocaleString) */
function money(float $n): string
{
    return number_format($n, fmod($n, 1) === 0.0 ? 0 : 2);
}

/** เขียนสถานะ + ฟิลด์อื่น ๆ ลงออเดอร์ (คู่กับ _writeOrderStatus ฝั่ง JS) */
function write_order_status(string $orderId, string $statusCode, array $fields = []): ?array
{
    $allowed = [
        'trackingNumber'     => 'tracking_number',
        'adminNotes'         => 'admin_notes',
        'purchaseProofImage' => 'purchase_proof_image',
        'purchaseProofNote'  => 'purchase_proof_note',
        'cancelledAt'        => 'cancelled_at',
        'refundedAt'         => 'refunded_at',
        'refundNote'         => 'refund_note',
    ];

    $sets = ['status_code = ?'];
    $args = [$statusCode];

    foreach ($fields as $key => $value) {
        // null = "ผู้เรียกไม่ได้ส่งค่านี้มา ไม่ต้องแตะของเดิม"
        // สตริงว่าง = "ตั้งใจล้างค่า" (แอดมินลบเลขพัสดุที่พิมพ์ผิดออก)
        if ($value === null || !isset($allowed[$key])) {
            continue;
        }
        $sets[] = $allowed[$key] . ' = ?';
        $args[] = $value;
    }

    $args[] = $orderId;
    $st = db()->prepare('UPDATE orders SET ' . implode(', ', $sets) . ' WHERE id = ?');
    $st->execute($args);

    return fetch_order($orderId);
}

/** ออเดอร์ที่มีอยู่จริง ไม่งั้นจบเลย */
function must_find_order(string $orderId): array
{
    $order = fetch_order($orderId);
    if (!$order) {
        fail('ไม่พบคำสั่งซื้อนี้ในระบบ');
    }
    return $order;
}

switch (action()) {

    /* ================================================================
     * สร้างคำสั่งซื้อ — จุดที่ลูกค้าโอนเงินมาแล้วจริง ห้ามพลาดที่สุด
     * ============================================================== */
    case 'create': {
        $user = require_login();

        $items = $in['items'] ?? [];
        if (!is_array($items) || !$items) {
            fail('ไม่มีรายการสินค้าในคำสั่งซื้อค่ะ');
        }

        $slipImage = trim((string) ($in['slipImage'] ?? ''));
        if ($slipImage === '') {
            fail('กรุณาแนบสลิปการโอนเงินค่ะ');
        }

        // === จุดล็อกราคา ===
        // เรียกตอนลูกค้าแนบสลิปแล้ว จึงเป็นจุดที่ "แช่แข็ง" เรทและราคาบาท
        $rate = current_rate();
        $lockedRate = (float) $rate['rate'];
        $nowSql = date('Y-m-d H:i:s');

        $db = db();
        $db->beginTransaction();

        try {
            $resolved = [];
            $roundId  = null;

            foreach ($items as $raw) {
                $productId = (string) ($raw['id'] ?? '');
                $qty = max(1, (int) floor((float) ($raw['qty'] ?? 1)));

                // ล็อกแถวสินค้าไว้จนจบ transaction กันสองคนแย่งโควตาชิ้นสุดท้ายพร้อมกัน
                $st = $db->prepare('SELECT * FROM products WHERE id = ? FOR UPDATE');
                $st->execute([$productId]);
                $product = $st->fetch();
                if (!$product) {
                    throw new RuntimeException('ไม่พบสินค้า "' . $productId . '" ในระบบค่ะ');
                }
                if (strtoupper((string) $product['status']) === 'OUT OF STOCK') {
                    throw new RuntimeException('สินค้า "' . $product['title'] . '" ปิดการขายชั่วคราวค่ะ');
                }

                $round = fetch_round($product['round_id']);
                if (round_state($round) !== 'open') {
                    throw new RuntimeException(
                        'รอบพรีออเดอร์ของ "' . $product['title'] . '" ปิดรับแล้วค่ะ'
                    );
                }

                $remaining = remaining_quota($productId);
                if ($remaining !== null && $remaining < $qty) {
                    throw new RuntimeException(
                        'ขออภัย "' . $product['title'] . '" รอบนี้รับได้อีกเพียง ' . $remaining .
                        " ชิ้น ไม่พอกับจำนวนที่สั่ง ({$qty} ชิ้น)"
                    );
                }

                // ราคาคิดใหม่จากฐานข้อมูลเสมอ ไม่ใช้ตัวเลขที่เบราว์เซอร์ส่งมา
                $bd = price_breakdown($product, $lockedRate);

                $resolved[] = [
                    'productId'  => $productId,
                    'title'      => $product['title'],
                    'qty'        => $qty,
                    'price'      => $bd['total'],
                    'priceKRW'   => $bd['krw'],
                    'serviceFee' => $bd['serviceFee'],
                    'image'      => $product['image'],
                ];

                // ผูกออเดอร์เข้ารอบของสินค้าชิ้นแรก
                // (ตะกร้าเช็คเอาต์แยกตามรอบอยู่แล้ว ทุกชิ้นจึงอยู่รอบเดียวกันเสมอ)
                $roundId ??= $product['round_id'];
            }

            $shippingFee = isset($in['shippingFee']) && is_numeric($in['shippingFee']) && $in['shippingFee'] >= 0
                ? (float) $in['shippingFee']
                : 50.0;

            $subtotal = 0.0;
            foreach ($resolved as $r) {
                $subtotal += $r['price'] * $r['qty'];
            }
            $total = $subtotal + $shippingFee;

            // สร้างรหัสออเดอร์ที่ไม่ชนของเดิม (ของเดิมสุ่ม 3 หลักโดยไม่ตรวจซ้ำเลย)
            $orderId = '';
            for ($try = 0; $try < 30; $try++) {
                $candidate = 'ORD-' . date('Ymd') . random_int(100, 999);
                $st = $db->prepare('SELECT id FROM orders WHERE id = ?');
                $st->execute([$candidate]);
                if (!$st->fetch()) {
                    $orderId = $candidate;
                    break;
                }
            }
            if ($orderId === '') {
                throw new RuntimeException('ระบบออกเลขคำสั่งซื้อไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ');
            }

            $st = $db->prepare(
                'INSERT INTO orders
                    (id, customer_email, customer_name, phone, address, order_date,
                     subtotal, shipping_fee, total, status_code, round_id,
                     rate_used, rate_locked_at, slip_image, tracking_number, admin_notes)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
            );
            $st->execute([
                $orderId,
                $user['email'],
                (string) ($in['customerName'] ?? $user['name']),
                (string) ($in['phone'] ?? $user['phone']),
                (string) ($in['address'] ?? $user['address']),
                $nowSql,
                $subtotal, $shippingFee, $total,
                'PENDING_SLIP',
                $roundId ?? 'round-legacy',
                $lockedRate, $nowSql,
                $slipImage,
                '',
                'ลูกค้าส่งสลิปแจ้งชำระเงินแล้ว',
            ]);

            $st = $db->prepare(
                'INSERT INTO order_items (order_id, product_id, title, qty, price, price_krw, service_fee, image)
                 VALUES (?,?,?,?,?,?,?,?)'
            );
            foreach ($resolved as $r) {
                $st->execute([
                    $orderId, $r['productId'], $r['title'], $r['qty'],
                    $r['price'], $r['priceKRW'], $r['serviceFee'], $r['image'],
                ]);
            }

            $customerName = (string) ($in['customerName'] ?? $user['name']);
            push_notification(
                SHOP_EMAIL,
                "มีคำสั่งซื้อใหม่ #{$orderId}",
                "ลูกค้า {$customerName} ส่งสลิปชำระเงินจำนวน ฿" . money($total) . ' บาท'
            );
            push_notification(
                $user['email'],
                "ส่งหลักฐานชำระเงินเรียบร้อย #{$orderId}",
                'ขอบคุณสำหรับการสั่งซื้อ ระบบกำลังเสนอสลิปชำระเงินให้ผู้ดูแลระบบตรวจสอบค่ะ'
            );

            $db->commit();
            ok(['order' => fetch_order($orderId)]);

        } catch (RuntimeException $e) {
            $db->rollBack();
            fail($e->getMessage());
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }
    }

    /* ================================================================
     * ลูกค้ายกเลิกเอง
     * ============================================================== */
    case 'cancel': {
        $user  = require_login();
        $order = must_find_order((string) ($in['orderId'] ?? ''));

        if (strcasecmp($order['customerEmail'], $user['email']) !== 0 && $user['role'] !== 'admin') {
            fail('ยกเลิกได้เฉพาะคำสั่งซื้อของตัวเองค่ะ', 403);
        }

        $meta = ORDER_STATUS[$order['statusCode']];
        if (!$meta['canCancel']) {
            fail($meta['group'] === 'cancelled'
                ? 'คำสั่งซื้อนี้ถูกยกเลิกไปแล้ว'
                : 'ไม่สามารถยกเลิกได้เนื่องจากพัสดุถูกจัดส่งออกไปแล้ว กรุณาติดต่อผู้ดูแลระบบค่ะ');
        }

        $reason = trim((string) ($in['reason'] ?? '')) ?: 'ยกเลิกโดยลูกค้า';

        // ไม่ต้องคืนโควตาเอง — พอสถานะเป็น CANCELLED_USER (quota = false)
        // การคำนวณโควตาจะไม่นับใบนี้อีก โควตาจึงคืนเข้าระบบทันที
        $updated = write_order_status($order['id'], 'CANCELLED_USER', [
            'adminNotes'  => "ลูกค้ายกเลิกคำสั่งซื้อ: {$reason}",
            'cancelledAt' => date('Y-m-d H:i:s'),
        ]);

        push_notification(SHOP_EMAIL, "ลูกค้ายกเลิกคำสั่งซื้อ #{$order['id']}",
            "ลูกค้า {$order['customerName']} ได้ทำการยกเลิกคำสั่งซื้อ #{$order['id']} (เหตุผล: {$reason})");
        push_notification($order['customerEmail'], "ยกเลิกคำสั่งซื้อเรียบร้อย #{$order['id']}",
            "ยกเลิกคำสั่งซื้อ #{$order['id']} เรียบร้อยแล้ว");

        ok(['order' => $updated]);
    }

    /* ================================================================
     * ลูกค้าส่งสลิปใบใหม่ — เท่ากับ "ขอจองใหม่" ต้องผ่านด่านเดียวกับตอนสั่งครั้งแรก
     * ============================================================== */
    case 'reupload-slip': {
        $user  = require_login();
        $order = must_find_order((string) ($in['orderId'] ?? ''));

        if (strcasecmp($order['customerEmail'], $user['email']) !== 0 && $user['role'] !== 'admin') {
            fail('ส่งสลิปได้เฉพาะคำสั่งซื้อของตัวเองค่ะ', 403);
        }
        if (!ORDER_STATUS[$order['statusCode']]['canReuploadSlip']) {
            fail('คำสั่งซื้อนี้ส่งสลิปใบใหม่ไม่ได้แล้ว (อาจถูกยกเลิกหรือจัดส่งไปแล้ว)');
        }

        $slip = trim((string) ($in['slipImage'] ?? ''));
        if ($slip === '') {
            fail('กรุณาแนบสลิปการโอนเงินค่ะ');
        }

        if (round_state(fetch_round($order['roundId'])) !== 'open') {
            fail("รอบพรีออเดอร์ของคำสั่งซื้อนี้ปิดรับแล้ว ไม่สามารถส่งสลิปใบใหม่ได้ค่ะ\n" .
                 'กรุณาติดต่อผู้ดูแลระบบเพื่อขอคืนเงินหรือย้ายไปรอบถัดไป');
        }

        foreach ($order['items'] as $item) {
            $remaining = remaining_quota($item['id']);
            if ($remaining !== null && $remaining < (int) $item['qty']) {
                fail("ขออภัย \"{$item['title']}\" รอบนี้รับได้อีกเพียง {$remaining} ชิ้น " .
                     "ไม่พอสำหรับจำนวนในคำสั่งซื้อนี้ ({$item['qty']} ชิ้น)\nกรุณาติดต่อผู้ดูแลระบบค่ะ");
            }
        }

        $st = db()->prepare('UPDATE orders SET slip_image = ? WHERE id = ?');
        $st->execute([$slip, $order['id']]);

        $updated = write_order_status($order['id'], 'PENDING_SLIP', [
            'adminNotes' => 'ลูกค้าอัปโหลดสลิปการโอนเงินใบใหม่เข้ามาเรียบร้อยแล้ว รอผู้ขายตรวจสอบ',
        ]);

        push_notification(SHOP_EMAIL, "ลูกค้าแนบสลิปใหม่ #{$order['id']}",
            "ลูกค้า {$order['customerName']} ได้ส่งสลิปชำระเงินใบใหม่สำหรับคำสั่งซื้อ #{$order['id']}");
        push_notification($order['customerEmail'], "ส่งสลิปใบใหม่เรียบร้อย #{$order['id']}",
            'ส่งหลักฐานการโอนเงินใบใหม่เรียบร้อยแล้ว รอผู้ขายตรวจสอบความถูกต้องค่ะ');

        ok(['order' => $updated]);
    }

    /* ================================================================
     * แอดมินเปลี่ยนสถานะ
     * ============================================================== */
    case 'status': {
        require_admin();
        $order = must_find_order((string) ($in['orderId'] ?? ''));

        $code = (string) ($in['statusCode'] ?? '');
        if (!isset(ORDER_STATUS[$code])) {
            fail('สถานะที่ส่งมาไม่ถูกต้อง');
        }

        $tracking = $in['trackingNumber'] ?? null;
        $proofImg = $in['purchaseProofImage'] ?? null;

        $updated = write_order_status($order['id'], $code, [
            'trackingNumber'     => $tracking,
            'adminNotes'         => $in['adminNotes'] ?? null,
            'purchaseProofImage' => $proofImg,
            'purchaseProofNote'  => $in['purchaseProofNote'] ?? null,
        ]);

        // ใช้ข้อความไทยจากตารางสถานะ ไม่ใช่โค้ดดิบที่ลูกค้าอ่านไม่รู้เรื่อง
        $msg = "สถานะคำสั่งซื้อ #{$order['id']} ของคุณเปลี่ยนเป็น \"" . ORDER_STATUS[$code]['text'] . '"';
        if (!empty($proofImg)) {
            $msg .= ' [แอดมินแนบหลักฐานการกดสั่งซื้อเรียบร้อย]';
        }
        if (!empty($tracking)) {
            $msg .= " (หมายเลขติดตามพัสดุ: {$tracking})";
        }
        push_notification($order['customerEmail'], "อัปเดตสถานะคำสั่งซื้อ #{$order['id']}", $msg);

        ok(['order' => $updated]);
    }

    /* ---------------------------------------------------------- */
    case 'approve': {
        require_admin();
        $order = must_find_order((string) ($in['orderId'] ?? ''));

        $notes = trim((string) ($in['adminNotes'] ?? ''))
            ?: 'ตรวจสอบสลิปและอนุมัติยอดชำระเงินเรียบร้อยแล้ว';

        // อนุมัติแล้วเข้าคิว "รอปิดรอบ" ยังไม่ใช่ขั้นแพ็กของ เพราะร้านยังไม่ได้ไปกดของ
        $updated = write_order_status($order['id'], 'PAID_WAIT_ROUND', ['adminNotes' => $notes]);

        push_notification($order['customerEmail'], "อัปเดตสถานะคำสั่งซื้อ #{$order['id']}",
            "สถานะคำสั่งซื้อ #{$order['id']} ของคุณเปลี่ยนเป็น \"" . ORDER_STATUS['PAID_WAIT_ROUND']['text'] . '"');

        ok(['order' => $updated]);
    }

    /* ---------------------------------------------------------- */
    case 'reject': {
        require_admin();
        $order = must_find_order((string) ($in['orderId'] ?? ''));

        $reason = trim((string) ($in['reason'] ?? ''))
            ?: 'สลิปไม่ถูกต้อง หรือยอดเงินไม่ตรงกับสัญญาสั่งซื้อ';

        $updated = write_order_status($order['id'], 'SLIP_REJECTED', [
            'adminNotes' => "ปฏิเสธการชำระเงิน: {$reason}",
        ]);

        push_notification($order['customerEmail'], "อัปเดตสถานะคำสั่งซื้อ #{$order['id']}",
            "สถานะคำสั่งซื้อ #{$order['id']} ของคุณเปลี่ยนเป็น \"" . ORDER_STATUS['SLIP_REJECTED']['text'] . '"');

        ok(['order' => $updated]);
    }

    /* ================================================================
     * ร้านกดของที่เกาหลีไม่สำเร็จ — ลูกค้าจ่ายถูกต้องแล้ว เงินอยู่ที่ร้าน ต้องคืน
     * ต่างจากการปฏิเสธสลิปโดยสิ้นเชิง ปลายทางคือ REFUND_PENDING เสมอ
     * เขียนทอดเดียวเพื่อไม่ให้ลูกค้าได้แจ้งเตือนรัว 3 ใบต่อเหตุการณ์เดียว
     * ============================================================== */
    case 'purchase-failed': {
        require_admin();
        $order = must_find_order((string) ($in['orderId'] ?? ''));

        $reason = trim((string) ($in['reason'] ?? ''))
            ?: 'สินค้าหมดจากเว็บ Official ก่อนร้านกดสั่งสำเร็จ';
        $amount = money((float) $order['total']);

        $updated = write_order_status($order['id'], 'REFUND_PENDING', [
            'adminNotes' => "ร้านกดสั่งไม่สำเร็จ: {$reason} — รอดำเนินการคืนเงิน ฿{$amount}",
        ]);

        push_notification($order['customerEmail'], "ต้องขออภัย ร้านกดสั่ง #{$order['id']} ไม่สำเร็จ",
            "{$reason} — ทางร้านจะคืนเงินเต็มจำนวน ฿{$amount} ให้ค่ะ");

        ok(['order' => $updated]);
    }

    /* ---------------------------------------------------------- */
    case 'refunded': {
        require_admin();
        $order = must_find_order((string) ($in['orderId'] ?? ''));

        $note = trim((string) ($in['note'] ?? ''));
        $updated = write_order_status($order['id'], 'REFUNDED', [
            'adminNotes' => $note !== '' ? $note : 'คืนเงินให้ลูกค้าเรียบร้อยแล้ว',
            'refundedAt' => date('Y-m-d H:i:s'),
            'refundNote' => $note,
        ]);

        push_notification($order['customerEmail'], "คืนเงินคำสั่งซื้อ #{$order['id']} เรียบร้อยแล้ว",
            'ทางร้านโอนคืน ฿' . money((float) $order['total']) . ' เรียบร้อยแล้วค่ะ' .
            ($note !== '' ? " ({$note})" : ''));

        ok(['order' => $updated]);
    }

    /* ---------------------------------------------------------- */
    /* ลบถาวร — order_items ตามไปด้วยผ่าน ON DELETE CASCADE          */
    case 'delete': {
        require_admin();
        $orderId = (string) ($in['orderId'] ?? '');
        must_find_order($orderId);

        $st = db()->prepare('DELETE FROM orders WHERE id = ?');
        $st->execute([$orderId]);

        ok();
    }

    /* ---------------------------------------------------------- */
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
