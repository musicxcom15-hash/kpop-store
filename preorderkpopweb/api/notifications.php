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

// ข้อมูลที่หน้าเว็บส่งมา (JSON)
$in = body();

// เลือกงานตาม ?action=
switch (action()) {

    /* ---------------------------------------------------------- */
    // แอดมินส่งแจ้งเตือน (ข่าวสารทั่วไป ไม่มี type จึงกดแล้วไม่พาไปไหน)
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

        // ALL = ส่งถึงผู้ใช้ทุกคนในระบบ · ไม่งั้นส่งถึงอีเมลที่เลือก
        $recipients = $target === 'ALL'
            ? db()->query('SELECT email FROM users')->fetchAll(PDO::FETCH_COLUMN)
            : [$target];

        if (!$recipients) {
            fail('ไม่พบผู้รับในระบบค่ะ');
        }

        $db = db();
        // เพิ่มทุกใบใน transaction เดียว — สำเร็จทั้งหมดหรือไม่เพิ่มเลย
        $db->beginTransaction();
        try {
            $st = $db->prepare(
                'INSERT INTO notifications (user_email, title, message, created_at, is_read)
                 VALUES (?,?,?,?,0)'
            );
            $now = date('Y-m-d H:i:s');
            // prepare ครั้งเดียว แล้ว execute ซ้ำทีละผู้รับ
            foreach ($recipients as $email) {
                $st->execute([$email, $title, $message, $now]);
            }
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }

        // ตอบจำนวนคนที่ได้รับ
        ok(['sent' => count($recipients)]);
    }

    /* ---------------------------------------------------------- */
    // ทำเครื่องหมายว่าอ่านแล้วทั้งกล่อง แล้วส่งรายการล่าสุดกลับไป
    case 'read': {
        $user = require_login();

        // อ่านได้เฉพาะกล่องของตัวเอง — ไม่รับอีเมลจาก body มาใช้ตรง ๆ
        // ไม่งั้นใครก็สั่งให้กล่องคนอื่นถูกทำเครื่องหมายว่าอ่านแล้วได้
        $st = db()->prepare('UPDATE notifications SET is_read = 1 WHERE lower(user_email) = lower(?)');
        $st->execute([$user['email']]);

        $st = db()->prepare('SELECT * FROM notifications WHERE lower(user_email) = lower(?) ORDER BY created_at DESC, id DESC');
        $st->execute([$user['email']]);

        ok(['notifications' => array_map('map_notification', $st->fetchAll())]);
    }

    /* ---------------------------------------------------------- */
    /* กดแจ้งเตือนใบเดียว (ก่อนพาไปหน้าที่เกี่ยวข้อง) — WHERE ผูกอีเมลของ session ไว้ กดของคนอื่นไม่ได้ */
    // (int) กันค่า id แปลก ๆ — ถ้าไม่ใช่ตัวเลขจะกลายเป็น 0 ซึ่งไม่ตรงแถวไหนเลย
    case 'read-one': {
        $user = require_login();
        $st = db()->prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND lower(user_email) = lower(?)');
        $st->execute([(int) ($in['id'] ?? 0), $user['email']]);
        ok();
    }

    /* ---------------------------------------------------------- */
    // action ที่ไม่รู้จัก
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
