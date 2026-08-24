<?php
/**
 * การเชื่อมต่อฐานข้อมูล (PDO)
 *
 * ค่าคอนฟิกทั้งหมดอยู่ในไฟล์นี้ไฟล์เดียว ย้ายเครื่องแล้วแก้ที่นี่ที่เดียวจบ
 *
 * ไฟล์นี้ต้องรันได้สองที่โดยไม่ต้องแก้อะไร
 *   - เครื่องพัฒนา (MAMP)  : ไม่มี environment variable → ใช้ค่า default ด้านล่าง
 *   - Railway (production) : MySQL service ผูกค่า MYSQL* มาให้ทาง environment
 *
 * ใช้ define() ไม่ใช่ const เพราะ `const X = getenv(...)` เป็น parse error
 * (constant expression ของ PHP เรียกฟังก์ชันไม่ได้) ชื่อค่าคงที่ยังเหมือนเดิมทุกตัว
 */

define('DB_HOST', getenv('MYSQLHOST') ?: '127.0.0.1');
define('DB_NAME', getenv('MYSQLDATABASE') ?: 'kpop_store');
define('DB_USER', getenv('MYSQLUSER') ?: 'root');
// เช็ก !== false แทน ?: เพราะรหัสผ่านที่เป็นสตริงว่างก็เป็นค่าที่ตั้งใจตั้งได้
define('DB_PASS', getenv('MYSQLPASSWORD') !== false ? getenv('MYSQLPASSWORD') : 'root');

/**
 * เรื่องพอร์ต (เฉพาะตอนรันบน MAMP):
 * MAMP บนเครื่องนี้ให้พอร์ตไม่คงที่ บางครั้งเปิดมาที่ 3306 บางครั้ง 3307
 * (ตัว mysqld ที่รันจริงไม่ได้ยึดตาม my.ini เสมอไป) ถ้าฮาร์ดโค้ดไว้ตัวเดียว
 * จะเจออาการ "เมื่อวานใช้ได้ วันนี้ใช้ไม่ได้" จึงไล่ลองตามลำดับแล้วจำตัวที่ต่อติด
 * ดูพอร์ตจริงได้จากหน้าต่าง MAMP > MySQL หรือจาก phpMyAdmin
 *
 * บน Railway พอร์ตมาจาก environment แน่นอนอยู่แล้ว จึงไม่ต้องเดา
 */
define('DB_PORTS', getenv('MYSQLPORT') ? [(int) getenv('MYSQLPORT')] : [3307, 3306]);

/** true เมื่อรันบนเว็บจริง ใช้ตัดสินว่าจะบอกรายละเอียด error กับผู้ใช้แค่ไหน */
define('IS_PRODUCTION', getenv('APP_ENV') === 'production');

/**
 * คืน PDO ตัวเดิมเสมอ (สร้างครั้งเดียวต่อ 1 request)
 *
 * @throws PDOException เมื่อต่อไม่ได้ทุกพอร์ต พร้อมข้อความที่บอกวิธีแก้
 */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $options = [
        // ให้ error เป็น exception ไม่ใช่ค่า false เงียบ ๆ
        // สำคัญกับงานที่เกี่ยวกับเงิน — ถ้าเขียนไม่ลงต้องรู้ทันที ไม่ใช่บอกลูกค้าว่าสำเร็จ
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        // ปิด emulation เพื่อให้ prepared statement เป็นของจริงที่ฝั่งเซิร์ฟเวอร์
        // ไม่ใช่การต่อสตริงในไดรเวอร์ ซึ่งเป็นการป้องกัน SQL injection ที่แท้จริง
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::ATTR_TIMEOUT            => 5,
        /**
         * ตรึงเขตเวลาของ connection ไว้ที่เวลาไทย
         *
         * ทุกคอลัมน์ DATETIME ในระบบเก็บ "เวลาไทย" ที่ PHP เขียนลงไปด้วย date()
         * แต่เซิร์ฟเวอร์ MySQL ที่โฮสต์ให้ (รวมถึงของ Railway) เดินเป็น UTC
         * current_rate() ใน helpers.php เทียบ `effective_from <= NOW()` ตรง ๆ
         * ถ้าไม่ตั้งค่านี้ เรทที่แอดมินเพิ่งตั้งจะยังไม่มีผลไปอีก 7 ชั่วโมง
         * และจุดตัดเรท 22:00 จะเพี้ยนทั้งระบบ
         */
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '+07:00'",
    ];

    $lastError = null;

    foreach (DB_PORTS as $port) {
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', DB_HOST, $port, DB_NAME);
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
            return $pdo;
        } catch (PDOException $e) {
            $lastError = $e;
            // ต่อพอร์ตติดแต่ไม่มีฐานข้อมูลชื่อนี้ = เจอ MySQL ตัวถูกแล้ว แค่ยังไม่ได้ import
            // ไม่ต้องไล่พอร์ตต่อ เพราะข้อความที่ถูกต้องคือ "ยังไม่ได้ import"
            if ($e->getCode() === 1049) {
                break;
            }
        }
    }

    // บนเว็บจริง ข้อความชี้ทางแก้ไม่มีประโยชน์กับลูกค้า และการบอก host/port/ชื่อ DB
    // ออกไปหน้าเว็บคือการยื่นข้อมูลให้คนที่กำลังหาช่องอยู่ — รายละเอียดไปอยู่ใน log แทน
    if (IS_PRODUCTION) {
        error_log('[kpop-api] เชื่อมต่อฐานข้อมูลไม่ได้: ' . ($lastError ? $lastError->getMessage() : 'ไม่ทราบสาเหตุ'));
        throw new PDOException('ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลังค่ะ', 0, $lastError);
    }

    $ports = implode(' หรือ ', DB_PORTS);
    $hint = ($lastError && $lastError->getCode() === 1049)
        ? "ยังไม่มีฐานข้อมูล '" . DB_NAME . "' — กรุณา import ไฟล์ database/kpop_store.sql ใน phpMyAdmin ก่อนค่ะ"
        : "ต่อ MySQL ไม่ได้ (ลองพอร์ต {$ports} แล้ว) — กรุณาตรวจว่าเปิด MAMP และกด Start Servers แล้ว "
          . 'ถ้าพอร์ตไม่ตรง ให้แก้ DB_PORTS ใน api/config.php';

    throw new PDOException($hint, 0, $lastError);
}
