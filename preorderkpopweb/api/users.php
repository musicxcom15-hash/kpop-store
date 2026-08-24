<?php
/**
 * จัดการผู้ใช้จากหน้าแอดมิน
 *
 * ฟอร์มแอดมินไม่มีช่องรหัสผ่าน — ตอนเพิ่มบัญชีใหม่จึงตั้งรหัสตั้งต้นให้
 * แล้วแจ้งกลับไปแสดงให้แอดมินเห็นครั้งเดียว (ตอนแก้บัญชีเดิมจะไม่แตะรหัสผ่าน)
 */

require_once __DIR__ . '/helpers.php';

$admin = require_admin();
$in    = body();

/** รหัสผ่านตั้งต้นสำหรับบัญชีที่แอดมินสร้างให้ */
const DEFAULT_NEW_USER_PASSWORD = 'kpop123456';

function all_users(): array
{
    return array_map('map_user', db()->query('SELECT * FROM users ORDER BY created_at, id')->fetchAll());
}

switch (action()) {

    /* ---------------------------------------------------------- */
    case 'save': {
        $id      = trim((string) ($in['id'] ?? ''));
        $name    = trim((string) ($in['name'] ?? ''));
        $email   = trim((string) ($in['email'] ?? ''));
        $phone   = trim((string) ($in['phone'] ?? ''));
        $address = trim((string) ($in['address'] ?? ''));
        $role    = (string) ($in['role'] ?? 'customer');

        if ($name === '' || $email === '') {
            fail('กรุณากรอกชื่อและอีเมลค่ะ', 200, ['users' => all_users()]);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            fail('รูปแบบอีเมลไม่ถูกต้องค่ะ', 200, ['users' => all_users()]);
        }
        if (!in_array($role, ['admin', 'customer'], true)) {
            $role = 'customer';
        }

        // อีเมลซ้ำกับ "คนอื่น" ไม่ได้ (แก้ของตัวเองโดยไม่เปลี่ยนอีเมลต้องผ่าน)
        $st = db()->prepare('SELECT id FROM users WHERE email = ? AND id <> ?');
        $st->execute([$email, $id]);
        if ($st->fetch()) {
            fail("อีเมล {$email} ถูกใช้ไปแล้วโดยบัญชีอื่นค่ะ", 200, ['users' => all_users()]);
        }

        if ($id !== '') {
            $st = db()->prepare('SELECT id FROM users WHERE id = ?');
            $st->execute([$id]);
            $exists = (bool) $st->fetch();
        } else {
            $exists = false;
        }

        if ($exists) {
            // ไม่แตะ password_hash ตอนแก้ไข — แอดมินไม่ควรเผลอรีเซ็ตรหัสลูกค้าจากการแก้ที่อยู่
            $st = db()->prepare(
                'UPDATE users SET name = ?, email = ?, phone = ?, address = ?, role = ? WHERE id = ?'
            );
            $st->execute([$name, $email, $phone, $address, $role, $id]);

            ok(['users' => all_users(), 'id' => $id]);
        }

        if ($id === '') {
            $id = 'u-' . time() . '-' . bin2hex(random_bytes(3));
        }

        $st = db()->prepare(
            'INSERT INTO users (id, name, email, password_hash, phone, address, role, created_at)
             VALUES (?,?,?,?,?,?,?,?)'
        );
        $st->execute([
            $id, $name, $email,
            password_hash(DEFAULT_NEW_USER_PASSWORD, PASSWORD_BCRYPT),
            $phone, $address, $role, date('Y-m-d'),
        ]);

        ok([
            'users'           => all_users(),
            'id'              => $id,
            'defaultPassword' => DEFAULT_NEW_USER_PASSWORD,
        ]);
    }

    /* ---------------------------------------------------------- */
    case 'delete': {
        $id = (string) ($in['id'] ?? '');

        $st = db()->prepare('SELECT * FROM users WHERE id = ?');
        $st->execute([$id]);
        $target = $st->fetch();
        if (!$target) {
            fail('ไม่พบบัญชีนี้ในระบบ', 200, ['users' => all_users()]);
        }

        // กันลบแอดมินคนสุดท้าย ไม่งั้นจะไม่มีใครเข้าหลังบ้านได้อีกเลย
        if ($target['role'] === 'admin') {
            $remaining = (int) db()->query("SELECT COUNT(*) FROM users WHERE role = 'admin'")->fetchColumn();
            if ($remaining <= 1) {
                fail('ลบไม่ได้ เพราะนี่คือบัญชีผู้ดูแลระบบคนสุดท้ายค่ะ', 200, ['users' => all_users()]);
            }
        }

        $st = db()->prepare('DELETE FROM users WHERE id = ?');
        $st->execute([$id]);

        // ลบบัญชีตัวเอง = ต้องหลุดออกจากระบบด้วย (พฤติกรรมเดิมของ deleteUser)
        $selfDeleted = $target['id'] === $admin['id'];
        if ($selfDeleted) {
            $_SESSION = [];
            session_destroy();
        }

        ok(['users' => $selfDeleted ? [] : all_users(), 'selfDeleted' => $selfDeleted]);
    }

    /* ---------------------------------------------------------- */
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
