<?php
/**
 * แจ้งเตือน
 *
 *  send  — แอดมินส่งหาคนเดียวหรือส่งทั้งหมด (userEmail = 'ALL')
 *          ของเดิมหน้าแอดมินวนเรียกทีละคน ทำให้ยิงคำขอเท่าจำนวนผู้ใช้
 *          ตอนนี้ส่งครั้งเดียวแล้วให้ฝั่งนี้ insert รวดเดียวใน transaction
 *  read  — ผู้ใช้กด "อ่านทั้งหมด" ของกล่องตัวเอง
 */

require_once __DIR__ . '/helpers.php';

$in = body();

switch (action()) {

    /* ---------------------------------------------------------- */
    case 'send': {
        require_admin();

        $title   = trim((string) ($in['title'] ?? ''));
        $message = trim((string) ($in['message'] ?? ''));
        $target  = trim((string) ($in['userEmail'] ?? ''));

        if ($title === '' || $message === '') {
            fail('กรุณากรอกหัวข้อและข้อความแจ้งเตือนค่ะ');
        }
        if ($target === '') {
            fail('กรุณาเลือกผู้รับค่ะ');
        }

        $recipients = $target === 'ALL'
            ? db()->query('SELECT email FROM users')->fetchAll(PDO::FETCH_COLUMN)
            : [$target];

        if (!$recipients) {
            fail('ไม่พบผู้รับในระบบค่ะ');
        }

        $db = db();
        $db->beginTransaction();
        try {
            $st = $db->prepare(
                'INSERT INTO notifications (user_email, title, message, created_at, is_read)
                 VALUES (?,?,?,?,0)'
            );
            $now = date('Y-m-d H:i:s');
            foreach ($recipients as $email) {
                $st->execute([$email, $title, $message, $now]);
            }
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }

        ok(['sent' => count($recipients)]);
    }

    /* ---------------------------------------------------------- */
    case 'read': {
        $user = require_login();

        // อ่านได้เฉพาะกล่องของตัวเอง — ไม่รับอีเมลจาก body มาใช้ตรง ๆ
        // ไม่งั้นใครก็สั่งให้กล่องคนอื่นถูกทำเครื่องหมายว่าอ่านแล้วได้
        $st = db()->prepare('UPDATE notifications SET is_read = 1 WHERE user_email = ?');
        $st->execute([$user['email']]);

        $st = db()->prepare('SELECT * FROM notifications WHERE user_email = ? ORDER BY created_at DESC, id DESC');
        $st->execute([$user['email']]);

        ok(['notifications' => array_map('map_notification', $st->fetchAll())]);
    }

    /* ---------------------------------------------------------- */
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
