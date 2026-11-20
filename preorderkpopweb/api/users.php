<?php
/**
 * จัดการผู้ใช้จากหน้าแอดมิน
 *
 * ฟอร์มแอดมินไม่มีช่องรหัสผ่าน — ตอนเพิ่มบัญชีใหม่จึงสุ่มรหัสชั่วคราวให้
 * แล้วแจ้งกลับไปแสดงให้แอดมินเห็นครั้งเดียว (ตอนแก้บัญชีเดิมจะไม่แตะรหัสผ่าน)
 * reset-password ใช้หลักเดียวกันตอนลูกค้าลืมรหัส
 */

require_once __DIR__ . '/helpers.php';

// ทุกคำสั่งในไฟล์นี้เป็นของแอดมินเท่านั้น
$admin = require_admin();
$in    = body();

/** ผู้ใช้ทั้งหมด (ส่งกลับไปให้หน้าแอดมินอัปเดตตารางทันที) */
function all_users(): array
{
    return array_map('map_user', db()->query('SELECT * FROM users ORDER BY created_at, id')->fetchAll());
}

// เลือกงานตาม ?action=
switch (action()) {

    /* ---------------------------------------------------------- */
    // เพิ่มหรือแก้บัญชี: มี id อยู่ในระบบแล้ว = แก้ · ไม่มี = เพิ่มใหม่
    case 'save': {
        $id      = trim((string) ($in['id'] ?? ''));
        $name    = trim((string) ($in['name'] ?? ''));
        $email   = trim((string) ($in['email'] ?? ''));
        $role    = (string) ($in['role'] ?? 'customer');

        if ($name === '' || $email === '') {
            fail('กรุณากรอกชื่อและอีเมลค่ะ', 200, ['users' => all_users()]);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            fail('รูปแบบอีเมลไม่ถูกต้องค่ะ', 200, ['users' => all_users()]);
        }
        // บทบาทแปลก ๆ ถือเป็นลูกค้าไว้ก่อน (ปลอดภัยกว่า)
        if (!in_array($role, ['admin', 'customer'], true)) {
            $role = 'customer';
        }
        // แอดมินเว้นเบอร์/ที่อยู่ว่างได้ (ลูกค้ากรอกเองทีหลัง) แต่ถ้ากรอกต้องถูกต้อง
        $contact = contact_from_input($in, false);

        // อีเมลซ้ำกับ "คนอื่น" ไม่ได้ (แก้ของตัวเองโดยไม่เปลี่ยนอีเมลต้องผ่าน)
        $st = db()->prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id <> ?');
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
            // ช่องที่เว้นว่าง = คงของเดิมไว้ (ไม่ลบที่อยู่ที่ลูกค้ากรอกไว้เพราะแอดมินไม่ได้แตะ)
            $sets = ['name = ?', 'email = ?', 'role = ?'];
            $args = [$name, $email, $role];
            if ($contact['phone'] !== '') {
                $sets[] = 'phone = ?';
                $args[] = $contact['phone'];
            }
            if ($contact['postcode'] !== '') {
                array_push($sets, 'address = ?', 'address_line = ?', 'subdistrict = ?', 'district = ?', 'province = ?', 'postcode = ?');
                array_push($args, $contact['address'], $contact['addressLine'], $contact['subdistrict'],
                    $contact['district'], $contact['province'], $contact['postcode']);
            }
            $args[] = $id;
            $st = db()->prepare('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?');
            $st->execute($args);

            ok(['users' => all_users(), 'id' => $id]);
        }

        if ($id === '') {
            $id = 'u-' . time() . '-' . bin2hex(random_bytes(3));
        }

        // บัญชีใหม่ได้รหัสชั่วคราวแบบสุ่ม แอดมินเห็นครั้งเดียวเพื่อแจ้งลูกค้า
        $temp = random_temp_password();
        $st = db()->prepare(
            'INSERT INTO users (id, name, email, password_hash, phone, address, role, created_at,
                                address_line, subdistrict, district, province, postcode)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
        );
        $st->execute([
            $id, $name, $email,
            password_hash($temp, PASSWORD_BCRYPT),
            $contact['phone'], $contact['address'], $role, date('Y-m-d'),
            $contact['addressLine'], $contact['subdistrict'], $contact['district'], $contact['province'], $contact['postcode'],
        ]);

        ok([
            'users'           => all_users(),
            'id'              => $id,
            'defaultPassword' => $temp,
        ]);
    }

    /* ---------------------------------------------------------- */
    // ลบบัญชี
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

        // ลบบัญชี (ตะกร้าของบัญชีนี้ถูกลบตามด้วย foreign key ON DELETE CASCADE)
        $st = db()->prepare('DELETE FROM users WHERE id = ?');
        $st->execute([$id]);
        // password_resets ไม่มี foreign key (ดู database/schema.sql) จึงต้องลบลิงก์ค้างเอง
        $st = db()->prepare('DELETE FROM password_resets WHERE user_id = ?');
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
    /* ลูกค้าลืมรหัสผ่าน: ตั้งรหัสชั่วคราวใหม่ แล้วส่งกลับให้แอดมินเห็นครั้งเดียวเพื่อแจ้งลูกค้า */
    // รีเซ็ตรหัสผ่านให้ลูกค้า (ตอบรหัสชั่วคราวกลับไปให้แอดมินแจ้งลูกค้า)
    case 'reset-password': {
        $id = (string) ($in['id'] ?? '');

        $st = db()->prepare('SELECT * FROM users WHERE id = ?');
        $st->execute([$id]);
        $target = $st->fetch();
        if (!$target) {
            fail('ไม่พบบัญชีนี้ในระบบ', 200, ['users' => all_users()]);
        }
        // รหัสของตัวเองต้องเปลี่ยนผ่าน change-password ที่ยืนยันรหัสเดิม ไม่ใช่รีเซ็ตทับ
        if ($target['id'] === $admin['id']) {
            fail('รหัสผ่านของตัวเองให้เปลี่ยนที่เมนูบัญชี → เปลี่ยนรหัสผ่าน แทนค่ะ');
        }

        // สุ่มรหัสชั่วคราวใหม่ แล้วบันทึกเป็น hash
        $temp = random_temp_password();
        $st = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $st->execute([password_hash($temp, PASSWORD_BCRYPT), $id]);

        // แจ้งลูกค้า (type password_reset — กดแล้วเปิดหน้าต่างเปลี่ยนรหัสผ่าน)
        push_notification($target['email'], 'รหัสผ่านของคุณถูกรีเซ็ตแล้ว',
            'ร้านได้ตั้งรหัสผ่านชั่วคราวให้คุณตามคำขอ กดที่นี่เพื่อเปลี่ยนรหัสผ่านใหม่ทันที', 'password_reset');

        ok(['users' => all_users(), 'tempPassword' => $temp]);
    }

    /* ---------------------------------------------------------- */
    // action ที่ไม่รู้จัก
    default:
        fail('ไม่รู้จักคำสั่งนี้', 400);
}
