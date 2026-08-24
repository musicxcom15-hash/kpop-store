<?php
/**
 * เข้าสู่ระบบ / สมัครสมาชิก / ออกจากระบบ / แก้ข้อมูลส่วนตัว
 *
 * เปลี่ยนจากระบบ demo เดิม (รหัสอะไรก็เข้าได้ และอีเมลใหม่สร้างบัญชีให้อัตโนมัติ)
 * มาเป็นการตรวจรหัสผ่านจริงด้วย password_verify() กับ hash ที่เก็บใน DB
 *
 * ข้อความตอบกลับตอนล็อกอินไม่ผ่านตั้งใจให้เหมือนกันทั้งกรณี "ไม่มีอีเมลนี้"
 * และ "รหัสผิด" เพื่อไม่ให้ใครใช้หน้าล็อกอินไล่เดาว่าอีเมลไหนมีบัญชีอยู่บ้าง
 */

require_once __DIR__ . '/helpers.php';

const LOGIN_FAILED_MESSAGE = 'อีเมลหรือรหัสผ่านไม่ถูกต้องค่ะ';

switch (action()) {

    /* ---------------------------------------------------------- */
    case 'login': {
        $in    = body();
        $email = trim((string) ($in['email'] ?? ''));
        $pass  = (string) ($in['password'] ?? '');

        if ($email === '' || $pass === '') {
            fail('กรุณากรอกอีเมลและรหัสผ่านค่ะ');
        }

        $st = db()->prepare('SELECT * FROM users WHERE email = ?');
        $st->execute([$email]);
        $row = $st->fetch();

        if (!$row || !password_verify($pass, $row['password_hash'])) {
            fail(LOGIN_FAILED_MESSAGE);
        }

        // กัน session fixation: ออกไอดี session ใหม่หลังยืนยันตัวตนผ่าน
        session_regenerate_id(true);
        $_SESSION['user_id'] = $row['id'];

        ok(['user' => map_user($row)]);
    }

    /* ---------------------------------------------------------- */
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
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            fail('รูปแบบอีเมลไม่ถูกต้องค่ะ');
        }
        if (strlen($pass) < 6) {
            fail('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษรค่ะ');
        }

        // อีเมลคือคีย์ที่ผูกออเดอร์กับเจ้าของ ถ้าปล่อยให้ซ้ำได้
        // การสมัครด้วยอีเมลแอดมินจะกลายเป็นการยึดบัญชี
        $st = db()->prepare('SELECT id FROM users WHERE email = ?');
        $st->execute([$email]);
        if ($st->fetch()) {
            fail("อีเมล {$email} มีบัญชีอยู่ในระบบแล้วค่ะ\nกรุณาเข้าสู่ระบบด้วยอีเมลนี้แทน");
        }

        $id = 'u-' . time() . '-' . bin2hex(random_bytes(3));
        $st = db()->prepare(
            'INSERT INTO users (id, name, email, password_hash, phone, address, role, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );

        try {
            $st->execute([
                $id, $name, $email,
                password_hash($pass, PASSWORD_BCRYPT),
                $phone, $address, 'customer', date('Y-m-d'),
            ]);
        } catch (PDOException $e) {
            // ชนกับ UNIQUE ตอนมีคนสมัครอีเมลเดียวกันพร้อมกัน
            if ($e->getCode() === '23000') {
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
    case 'logout': {
        $_SESSION = [];
        session_destroy();
        ok();
    }

    /* ---------------------------------------------------------- */
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
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
