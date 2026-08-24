<?php
/**
 * จัดการรอบพรีออเดอร์ (เฉพาะแอดมิน)
 * ลบรอบที่ยังมีสินค้าผูกอยู่ไม่ได้ — ฐานข้อมูลก็กันไว้อีกชั้นด้วย FK ON DELETE RESTRICT
 */

require_once __DIR__ . '/helpers.php';

require_admin();
$in = body();

function all_rounds(): array
{
    return array_map('map_round', db()->query('SELECT * FROM rounds ORDER BY open_at')->fetchAll());
}

switch (action()) {

    /* ---------------------------------------------------------- */
    case 'save': {
        $id      = trim((string) ($in['id'] ?? ''));
        $name    = trim((string) ($in['name'] ?? ''));
        $openAt  = trim((string) ($in['openAt'] ?? ''));
        $closeAt = trim((string) ($in['closeAt'] ?? ''));

        if ($name === '' || $openAt === '' || $closeAt === '') {
            fail('กรุณากรอกชื่อรอบและช่วงวันเปิด-ปิดให้ครบค่ะ', 200, ['rounds' => all_rounds()]);
        }
        if ($closeAt < $openAt) {
            fail('วันปิดรอบต้องไม่มาก่อนวันเปิดรอบค่ะ', 200, ['rounds' => all_rounds()]);
        }

        $type = (string) ($in['type'] ?? 'korean-site');
        if (!in_array($type, ['korean-site', 'shipping'], true)) {
            $type = 'korean-site';
        }

        $status = (string) ($in['status'] ?? 'open');
        if (!in_array($status, ['open', 'upcoming', 'closed', 'ordered', 'arrived', 'shipped'], true)) {
            $status = 'open';
        }

        $estDelivery = trim((string) ($in['estDelivery'] ?? ''));
        $note        = (string) ($in['note'] ?? '');

        if ($id === '') {
            $id = 'round-' . time() . '-' . bin2hex(random_bytes(3));
        }

        $st = db()->prepare('SELECT id FROM rounds WHERE id = ?');
        $st->execute([$id]);

        if ($st->fetch()) {
            $st = db()->prepare(
                'UPDATE rounds SET name = ?, type = ?, open_at = ?, close_at = ?, status = ?,
                                   est_delivery = ?, note = ?
                 WHERE id = ?'
            );
            $st->execute([$name, $type, $openAt, $closeAt, $status, $estDelivery, $note, $id]);
        } else {
            $st = db()->prepare(
                'INSERT INTO rounds (id, name, type, open_at, close_at, status, est_delivery, note)
                 VALUES (?,?,?,?,?,?,?,?)'
            );
            $st->execute([$id, $name, $type, $openAt, $closeAt, $status, $estDelivery, $note]);
        }

        ok(['rounds' => all_rounds(), 'id' => $id]);
    }

    /* ---------------------------------------------------------- */
    case 'delete': {
        $id = (string) ($in['id'] ?? '');

        $st = db()->prepare('SELECT COUNT(*) FROM products WHERE round_id = ?');
        $st->execute([$id]);
        $count = (int) $st->fetchColumn();

        if ($count > 0) {
            fail("ลบรอบนี้ไม่ได้ เพราะยังมีสินค้าผูกอยู่ {$count} รายการ\n" .
                 'กรุณาย้ายสินค้าไปรอบอื่นก่อนค่ะ', 200, ['rounds' => all_rounds()]);
        }

        $st = db()->prepare('DELETE FROM rounds WHERE id = ?');
        $st->execute([$id]);

        ok(['rounds' => all_rounds()]);
    }

    /* ---------------------------------------------------------- */
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
