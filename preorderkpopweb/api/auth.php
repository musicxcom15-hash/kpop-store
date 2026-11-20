<?php
/**
 * เข้าสู่ระบบ / สมัครสมาชิก / ออกจากระบบ / แก้ข้อมูลส่วนตัว
 *
 * เปลี่ยนจากระบบ demo เดิม (รหัสอะไรก็เข้าได้ และอีเมลใหม่สร้างบัญชีให้อัตโนมัติ)
 * มาเป็นการตรวจรหัสผ่านจริงด้วย password_verify() กับ hash ที่เก็บใน DB
 *
 * ข้อความตอบกลับตอนล็อกอินไม่ผ่านตั้งใจให้เหมือนกันทั้งกรณี "ไม่มีอีเมลนี้"
 * และ "รหัสผิด" เพื่อไม่ให้ใครใช้หน้าล็อกอินไล่เดาว่าอีเมลไหนมีบัญชีอยู่บ้าง
 *
 * ลืมรหัสผ่าน: ส่งลิงก์รีเซ็ตทางอีเมล
 *   forgot → สร้าง token สุ่ม (เก็บแค่ hash, ใช้ได้ครั้งเดียว, หมดอายุ 30 นาที) → ส่งอีเมลลิงก์
 *   reset-password.html?token=… → reset-token-status (เช็คลิงก์) → reset-with-token (ตั้งรหัสใหม่)
 * ถ้าบนเว็บจริงยังไม่ได้ตั้งค่าส่งอีเมล (หรือส่งพลาด) ใช้ทางสำรองเดิม: แจ้งเตือนเข้ากล่องร้าน
 *   → แอดมินกดรีเซ็ตใน users.php → โทรแจ้งรหัสชั่วคราว → ลูกค้าเปลี่ยนรหัสเองที่ change-password
 */

require_once __DIR__ . '/helpers.php';

// ข้อความล็อกอินไม่ผ่าน (ใช้ข้อความเดียวทั้งกรณีไม่มีอีเมลและรหัสผิด)
const LOGIN_FAILED_MESSAGE = 'อีเมลหรือรหัสผ่านไม่ถูกต้องค่ะ';
// ลิงก์รีเซ็ตรหัสผ่านใช้ได้กี่นาที
const RESET_TOKEN_TTL_MINUTES = 30;
const RESET_LINK_INVALID_MESSAGE = 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง หมดอายุ หรือถูกใช้ไปแล้วค่ะ กรุณาขอลิงก์ใหม่';

/** แถว token ที่ยังใช้ได้ (ยังไม่หมดอายุและยังไม่ถูกใช้) หรือ null */
function find_valid_reset(string $token): ?array
{
    // token ที่ระบบสร้างเป็นเลขฐานสิบหก 64 ตัวเสมอ — รูปแบบอื่นไม่ต้องถามฐานข้อมูล
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) {
        return null;
    }
    $st = db()->prepare(
        'SELECT r.*, u.email, u.name FROM password_resets r JOIN users u ON u.id = r.user_id
         WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?'
    );
    // ฐานข้อมูลเก็บแค่ hash ของ token จึงต้อง hash ก่อนค้น · เทียบเวลาหมดอายุกับตอนนี้
    $st->execute([hash('sha256', $token), date('Y-m-d H:i:s')]);
    $row = $st->fetch();
    return $row ?: null;
}

/** ปิดบังอีเมลก่อนแสดงบนหน้ารีเซ็ต เช่น so***@gmail.com */
function mask_email(string $email): string
{
    // แยกชื่อหน้า @ กับโดเมน แล้วโชว์แค่ 2 ตัวแรกของชื่อ ที่เหลือเป็น *
    [$local, $domain] = explode('@', $email, 2) + [1 => ''];
    return mb_substr($local, 0, 2) . str_repeat('*', max(3, mb_strlen($local) - 2)) . '@' . $domain;
}

// เลือกงานตาม ?action= ใน URL (เช่น auth.php?action=login)
switch (action()) {

    /* ---------------------------------------------------------- */
    // เข้าสู่ระบบ: รับอีเมล + รหัสผ่าน
    case 'login': {
        $in    = body();
        $email = trim((string) ($in['email'] ?? ''));
        $pass  = (string) ($in['password'] ?? '');

        if ($email === '' || $pass === '') {
            fail('กรุณากรอกอีเมลและรหัสผ่านค่ะ');
        }

        // หาบัญชีจากอีเมล (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
        $st = db()->prepare('SELECT * FROM users WHERE lower(email) = lower(?)');
        $st->execute([$email]);
        $row = $st->fetch();

        // ไม่มีบัญชี หรือรหัสไม่ตรงกับ hash → ตอบข้อความเดียวกัน
        if (!$row || !password_verify($pass, $row['password_hash'])) {
            fail(LOGIN_FAILED_MESSAGE);
        }

        // กัน session fixation: ออกไอดี session ใหม่หลังยืนยันตัวตนผ่าน
        session_regenerate_id(true);
        // จำว่า session นี้คือผู้ใช้คนไหน (ถูกเก็บลงตาราง sessions ตอนจบคำขอ)
        $_SESSION['user_id'] = $row['id'];

        ok(['user' => map_user($row)]);
    }

    /* ---------------------------------------------------------- */
    // สมัครสมาชิก: ตรวจข้อมูล → สร้างบัญชีลูกค้า → ล็อกอินให้ทันที
    case 'register': {
        $in      = body();
        $name    = trim((string) ($in['name'] ?? ''));
        $email   = trim((string) ($in['email'] ?? ''));
        $pass    = (string) ($in['password'] ?? '');
        $phone   = trim((string) ($in['phone'] ?? ''));
        $address = trim((string) ($in['address'] ?? ''));

        if ($name === '' || $email === '' || $pass === '') {
            fail('กรุณากรอกชื่อ อีเมล และรหัสผ่านให้ครบค่ะ');
        }
        // ตรวจรูปแบบอีเมลด้วยตัวตรวจของ PHP
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            fail('รูปแบบอีเมลไม่ถูกต้องค่ะ');
        }
        if (strlen($pass) < MIN_PASSWORD_LENGTH) {
            fail('รหัสผ่านต้องยาวอย่างน้อย ' . MIN_PASSWORD_LENGTH . ' ตัวอักษรค่ะ');
        }

        // อีเมลคือคีย์ที่ผูกออเดอร์กับเจ้าของ ถ้าปล่อยให้ซ้ำได้
        // การสมัครด้วยอีเมลแอดมินจะกลายเป็นการยึดบัญชี
        $st = db()->prepare('SELECT id FROM users WHERE lower(email) = lower(?)');
        $st->execute([$email]);
        if ($st->fetch()) {
            fail("อีเมล {$email} มีบัญชีอยู่ในระบบแล้วค่ะ\nกรุณาเข้าสู่ระบบด้วยอีเมลนี้แทน");
        }

        // id ผู้ใช้: u-<เวลา>-<สุ่ม 6 หลัก> ไม่ชนกันแม้สมัครวินาทีเดียวกัน
        $id = 'u-' . time() . '-' . bin2hex(random_bytes(3));
        $st = db()->prepare(
            'INSERT INTO users (id, name, email, password_hash, phone, address, role, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );

        try {
            $st->execute([
                $id, $name, $email,
                // เก็บรหัสผ่านเป็น bcrypt hash เท่านั้น ไม่เก็บรหัสจริง
                password_hash($pass, PASSWORD_BCRYPT),
                $phone, $address, 'customer', date('Y-m-d'),
            ]);
        } catch (PDOException $e) {
            // ชนกับ UNIQUE ตอนมีคนสมัครอีเมลเดียวกันพร้อมกัน (23505 = unique_violation)
            if ($e->getCode() === '23505') {
                fail("อีเมล {$email} มีบัญชีอยู่ในระบบแล้วค่ะ");
            }
            throw $e;
        }

        // สมัครเสร็จให้ล็อกอินต่อเลย เหมือนพฤติกรรมเดิมของหน้า register
        session_regenerate_id(true);
        $_SESSION['user_id'] = $id;

        $st = db()->prepare('SELECT * FROM users WHERE id = ?');
        $st->execute([$id]);
        ok(['user' => map_user($st->fetch())]);
    }

    /* ---------------------------------------------------------- */
    // ออกจากระบบ: ล้างข้อมูล session แล้วลบแถว session ทิ้ง
    case 'logout': {
        $_SESSION = [];
        session_destroy();
        ok();
    }

    /* ---------------------------------------------------------- */
    // แก้ข้อมูลส่วนตัว (ชื่อ เบอร์ ที่อยู่) ของผู้ที่ล็อกอินอยู่
    case 'profile': {
        $user = require_login();
        $in   = body();

        $name    = trim((string) ($in['name'] ?? ''));
        $phone   = trim((string) ($in['phone'] ?? ''));
        $address = trim((string) ($in['address'] ?? ''));

        if ($name === '') {
            fail('กรุณากรอกชื่อ-นามสกุลผู้รับพัสดุค่ะ');
        }

        // แก้ได้เฉพาะข้อมูลติดต่อของตัวเอง — อีเมลกับ role เปลี่ยนที่นี่ไม่ได้
        // ไม่งั้นลูกค้าจะยกระดับตัวเองเป็นแอดมินได้ด้วยการยิง endpoint นี้
        $st = db()->prepare('UPDATE users SET name = ?, phone = ?, address = ? WHERE id = ?');
        $st->execute([$name, $phone, $address, $user['id']]);

        $st = db()->prepare('SELECT * FROM users WHERE id = ?');
        $st->execute([$user['id']]);
        ok(['user' => map_user($st->fetch())]);
    }

    /* ---------------------------------------------------------- */
    // เปลี่ยนรหัสผ่าน (ต้องล็อกอินและรู้รหัสเดิม)
    case 'change-password': {
        $user    = require_login();
        $in      = body();
        $current = (string) ($in['currentPassword'] ?? '');
        $new     = (string) ($in['newPassword'] ?? '');

        // ต้องยืนยันรหัสเดิมเสมอ — ใครเจอเครื่องที่ล็อกอินค้างไว้จะได้ยึดบัญชีไม่ได้
        if (!password_verify($current, $user['password_hash'])) {
            fail('รหัสผ่านปัจจุบันไม่ถูกต้องค่ะ');
        }
        if (strlen($new) < MIN_PASSWORD_LENGTH) {
            fail('รหัสผ่านใหม่ต้องยาวอย่างน้อย ' . MIN_PASSWORD_LENGTH . ' ตัวอักษรค่ะ');
        }
        if ($new === $current) {
            fail('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิมค่ะ');
        }

        $st = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        // บันทึก hash ของรหัสใหม่
        $st->execute([password_hash($new, PASSWORD_BCRYPT), $user['id']]);
        ok();
    }

    /* ---------------------------------------------------------- */
    // ลืมรหัสผ่าน: สร้างลิงก์รีเซ็ตแล้วส่งอีเมล (ไม่ต้องล็อกอิน)
    case 'forgot': {
        $email = trim((string) (body()['email'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            fail('รูปแบบอีเมลไม่ถูกต้องค่ะ');
        }

        // ตอบข้อความเดียวกันเสมอไม่ว่าจะมีบัญชีหรือไม่ — กันการไล่เดาว่าอีเมลไหนมีบัญชี
        $reply = 'ถ้าอีเมลนี้มีบัญชีอยู่ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปที่อีเมลแล้วค่ะ '
               . '(ลิงก์ใช้ได้ ' . RESET_TOKEN_TTL_MINUTES . ' นาที หากไม่พบให้ดูในโฟลเดอร์สแปม '
               . 'ถ้ายังไม่ได้รับภายใน 10 นาที ร้านจะติดต่อกลับทางเบอร์โทรที่ให้ไว้)';

        $st = db()->prepare('SELECT * FROM users WHERE lower(email) = lower(?)');
        $st->execute([$email]);
        $target = $st->fetch();
        // ไม่มีบัญชีนี้ — ตอบเหมือนสำเร็จ ไม่บอกว่าไม่มี
        if (!$target) {
            ok(['message' => $reply]);
        }

        // endpoint นี้ไม่ต้องล็อกอิน — จำกัดอีเมลละ 1 ลิงก์ต่อ 2 นาที และ 5 ลิงก์ต่อชั่วโมง กันใช้ถล่มกล่องอีเมลคนอื่น
        $st = db()->prepare(
            'SELECT COUNT(*) FILTER (WHERE created_at >= ?) AS recent, COUNT(*) AS hour FROM password_resets WHERE user_id = ? AND created_at >= ?'
        );
        $st->execute([date('Y-m-d H:i:s', time() - 120), $target['id'], date('Y-m-d H:i:s', time() - 3600)]);
        $rate = $st->fetch();
        if ((int) $rate['recent'] > 0 || (int) $rate['hour'] >= 5) {
            ok(['message' => $reply]);
        }

        // token สุ่ม 256 บิต — ตัวจริงอยู่ในลิงก์ที่ส่งทางอีเมลเท่านั้น ฐานข้อมูลเก็บแค่ hash
        $token = bin2hex(random_bytes(32));
        $st = db()->prepare('INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)');
        $st->execute([$target['id'], hash('sha256', $token),
            date('Y-m-d H:i:s', time() + RESET_TOKEN_TTL_MINUTES * 60), date('Y-m-d H:i:s')]);

        // ประกอบลิงก์จาก URL ที่ตั้งไว้ (ไม่ใช้ Host ของคำขอ กันลิงก์ปลอม)
        $link = app_base_url() . '/reset-password.html?token=' . $token;
        // ชื่อมาจากผู้ใช้ ต้อง escape ก่อนใส่ใน HTML ของอีเมล
        $name = htmlspecialchars($target['name'], ENT_QUOTES, 'UTF-8');
        // ส่งอีเมล 2 แบบในฉบับเดียว: HTML (มีปุ่ม) และข้อความล้วน
        $sent = send_mail($target['email'], $target['name'], 'ตั้งรหัสผ่านใหม่ — KPOP STORE',
            "<div style=\"font-family:Tahoma,sans-serif;font-size:15px;line-height:1.6;color:#222\">
                <p>สวัสดีค่ะ {$name}</p>
                <p>เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี KPOP STORE ของคุณ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่
                (ลิงก์ใช้ได้ " . RESET_TOKEN_TTL_MINUTES . " นาที และใช้ได้ครั้งเดียว)</p>
                <p><a href=\"{$link}\" style=\"display:inline-block;background:#ff3399;color:#fff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:bold\">ตั้งรหัสผ่านใหม่</a></p>
                <p style=\"font-size:13px;color:#666\">ถ้ากดปุ่มไม่ได้ ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:<br>{$link}</p>
                <p style=\"font-size:13px;color:#666\">ถ้าคุณไม่ได้ขอตั้งรหัสผ่านใหม่ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ</p>
            </div>",
            "สวัสดีค่ะ {$target['name']}\n\nตั้งรหัสผ่านใหม่สำหรับบัญชี KPOP STORE ได้ที่ลิงก์นี้ (ใช้ได้ "
            . RESET_TOKEN_TTL_MINUTES . " นาที ครั้งเดียว):\n{$link}\n\nถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ");

        // ลูกค้าจะไม่ได้อีเมล (ยังไม่ตั้งค่าบริการอีเมล หรือบริการขัดข้อง) — อย่าให้คำขอหายเงียบ ส่งเข้ากล่องร้านด้วย
        if (!$sent) {
            push_notification(SHOP_EMAIL, "คำขอรีเซ็ตรหัสผ่าน: {$target['name']}",
                "{$target['email']} · โทร " . ($target['phone'] ?: '-')
                . ' — ส่งอีเมลลิงก์ให้ลูกค้าไม่ได้ (ยังไม่ได้ตั้งค่าบริการอีเมล หรือบริการขัดข้อง) '
                . 'กดเพื่อไปรีเซ็ตรหัสผ่าน แล้วโทรแจ้งรหัสชั่วคราวให้ลูกค้า',
                'admin_password_request', $target['id']);
        }

        ok(['message' => $reply]);
    }

    /* ---------------------------------------------------------- */
    /* หน้า reset-password.html เช็คก่อนว่าลิงก์ยังใช้ได้ไหม จะได้บอกตั้งแต่เปิดหน้า ไม่ใช่หลังกรอกรหัสเสร็จ */
    // ตอบอีเมลแบบปิดบังบางส่วน ให้หน้าเว็บโชว์ว่ากำลังตั้งรหัสให้บัญชีไหน
    case 'reset-token-status': {
        $reset = find_valid_reset((string) (body()['token'] ?? ''));
        if (!$reset) {
            fail(RESET_LINK_INVALID_MESSAGE, 200, ['code' => 'invalid_link']);
        }
        ok(['email' => mask_email($reset['email'])]);
    }

    /* ---------------------------------------------------------- */
    // ตั้งรหัสใหม่จากลิงก์ในอีเมล
    case 'reset-with-token': {
        $in    = body();
        $reset = find_valid_reset((string) ($in['token'] ?? ''));
        if (!$reset) {
            fail(RESET_LINK_INVALID_MESSAGE, 200, ['code' => 'invalid_link']);
        }
        $new = (string) ($in['newPassword'] ?? '');
        if (strlen($new) < MIN_PASSWORD_LENGTH) {
            fail('รหัสผ่านใหม่ต้องยาวอย่างน้อย ' . MIN_PASSWORD_LENGTH . ' ตัวอักษรค่ะ');
        }

        $db = db();
        // ทำ 3 อย่างใน transaction เดียว: เปลี่ยนรหัส, ปิดลิงก์ทั้งหมด, แจ้งเตือนเจ้าของบัญชี
        $db->beginTransaction();
        try {
            $st = $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $st->execute([password_hash($new, PASSWORD_BCRYPT), $reset['user_id']]);
            // ลิงก์นี้และลิงก์อื่นที่ยังไม่ได้ใช้ของบัญชีเดียวกันใช้ไม่ได้อีก
            $st = $db->prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL');
            $st->execute([date('Y-m-d H:i:s'), $reset['user_id']]);
            push_notification($reset['email'], 'เปลี่ยนรหัสผ่านเรียบร้อย',
                'รหัสผ่านของบัญชีนี้ถูกตั้งใหม่ผ่านลิงก์ทางอีเมล ถ้าคุณไม่ได้ทำเอง กรุณาติดต่อร้านทันที');
            $db->commit();
        } catch (Throwable $e) {
            // ขั้นไหนพลาดให้ยกเลิกทั้งหมด ไม่ให้เหลือสภาพครึ่ง ๆ กลาง ๆ
            $db->rollBack();
            throw $e;
        }

        ok(['email' => $reset['email']]);
    }

    /* ---------------------------------------------------------- */
    // action ที่ไม่รู้จัก
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
