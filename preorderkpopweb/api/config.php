<?php
/**
 * การเชื่อมต่อฐานข้อมูล (PDO → PostgreSQL / Supabase)
 *
 * ค่าคอนฟิกทั้งหมดอยู่ในไฟล์นี้ไฟล์เดียว ย้ายเครื่องแล้วแก้ที่นี่ที่เดียวจบ
 *
 * อ่านที่อยู่ฐานข้อมูลจาก environment variable DATABASE_URL รูปแบบเดียวกับที่ Supabase ให้มา
 *   postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require
 *   - Railway (production) : ตั้งใน Variables ของ service web = Connection string ของ Supabase
 *   - Docker บนเครื่อง     : docker-compose.yml ตั้งให้แล้ว (ชี้ไปที่ container db)
 *   - ไม่ตั้งเลย          : ใช้ Postgres บนเครื่องตัวเองที่ 127.0.0.1:5432 (ค่า default ด้านล่าง)
 *
 * บน Supabase ให้ใช้ "Session pooler" (พอร์ต 5432) — ต่อผ่าน IPv4 ได้ และรองรับ prepared statement
 * ถ้าใช้ "Transaction pooler" (พอร์ต 6543) ระบบจะสลับไปใช้ prepared statement แบบจำลองให้เอง
 * (pooler แบบนั้นส่งคำสั่งแต่ละคำสั่งไปคนละ connection ได้ prepared statement ของจริงจึงหาย)
 *
 * ใช้ define() ไม่ใช่ const เพราะ `const X = getenv(...)` เป็น parse error
 * (constant expression ของ PHP เรียกฟังก์ชันไม่ได้)
 */

define('DATABASE_URL', getenv('DATABASE_URL') ?: 'postgresql://postgres:postgres@127.0.0.1:5432/kpop_store');

/** true เมื่อรันบนเว็บจริง ใช้ตัดสินว่าจะบอกรายละเอียด error กับผู้ใช้แค่ไหน */
define('IS_PRODUCTION', getenv('APP_ENV') === 'production');

/**
 * เรทเงินวอนกลางของร้าน (บาทต่อ 1 วอน) — ค่าคงที่ ไม่มีหน้าแอดมินให้ตั้งเองแล้ว
 * ต้องการเปลี่ยนเรทให้แก้ค่านี้แล้ว deploy ใหม่
 */
define('CENTRAL_RATE', 0.028);

/**
 * แยก DATABASE_URL เป็น [dsn, user, password, port]
 * รหัสผ่านที่มีอักขระพิเศษต้อง URL-encode มาใน URL (Supabase ให้มาแบบนั้นอยู่แล้ว) จึงต้อง decode กลับ
 */
function db_config(): array
{
    // แยก URL เป็นส่วน ๆ: host, port, user, pass, path (= ชื่อฐานข้อมูล), query (= sslmode)
    $url = parse_url(DATABASE_URL);
    if ($url === false || !isset($url['host'])) {
        throw new PDOException('DATABASE_URL ไม่ถูกรูปแบบ (ต้องเป็น postgresql://user:pass@host:port/dbname)');
    }

    parse_str($url['query'] ?? '', $query);
    $port = (int) ($url['port'] ?? 5432);
    $name = ltrim(rawurldecode($url['path'] ?? '/postgres'), '/') ?: 'postgres';
    // Supabase บังคับ SSL — ถ้า URL ไม่ได้บอก ใช้ prefer (ได้ SSL ถ้าปลายทางรองรับ)
    $sslmode = $query['sslmode'] ?? 'prefer';

    $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s;sslmode=%s', $url['host'], $port, $name, $sslmode);

    return [
        $dsn,
        rawurldecode($url['user'] ?? 'postgres'),
        rawurldecode($url['pass'] ?? ''),
        $port,
    ];
}

/**
 * คืน PDO ตัวเดิมเสมอ (สร้างครั้งเดียวต่อ 1 request)
 *
 * เวลาทุกคอลัมน์เป็น TIMESTAMP แบบไม่มีเขตเวลา เก็บ "เวลาไทย" ที่ PHP เขียนลงไปด้วย date()
 * (date.timezone = Asia/Bangkok ใน Dockerfile) SQL ไม่ได้ใช้ NOW()/CURRENT_DATE เลย
 * จึงไม่ต้อง SET TIME ZONE ให้เสีย 1 รอบเครือข่ายต่อคำขอ
 *
 * @throws PDOException เมื่อต่อไม่ได้ พร้อมข้อความที่บอกวิธีแก้ (เฉพาะตอนไม่ใช่ production)
 */
function db(): PDO
{
    // static = จำการเชื่อมต่อไว้ใช้ซ้ำตลอดคำขอนี้ ไม่ต่อใหม่ทุกครั้งที่เรียก db()
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    try {
        // ต่อฐานข้อมูลด้วยค่าจาก DATABASE_URL
        [$dsn, $user, $pass, $port] = db_config();
        $pdo = new PDO($dsn, $user, $pass, [
            // ให้ error เป็น exception ไม่ใช่ค่า false เงียบ ๆ
            // สำคัญกับงานที่เกี่ยวกับเงิน — ถ้าเขียนไม่ลงต้องรู้ทันที ไม่ใช่บอกลูกค้าว่าสำเร็จ
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // prepared statement ของจริงที่ฝั่งเซิร์ฟเวอร์ ยกเว้นต่อผ่าน transaction pooler ของ Supabase (ดูหัวไฟล์)
            // แบบจำลองก็ยัง escape ค่าให้ถูกต้อง ไม่ได้เปิดช่อง SQL injection
            // DB_EMULATE_PREPARES=1 บังคับโหมดนี้ได้ (ใช้ทดสอบบนเครื่อง หรือ pooler ที่ไม่ได้อยู่พอร์ต 6543)
            PDO::ATTR_EMULATE_PREPARES   => $port === 6543 || getenv('DB_EMULATE_PREPARES') === '1',
            PDO::ATTR_TIMEOUT            => 5,
        ]);
        return $pdo;
    } catch (PDOException $e) {
        $lastError = $e;
    }

    // บนเว็บจริง ข้อความชี้ทางแก้ไม่มีประโยชน์กับลูกค้า และการบอก host/port/ชื่อ DB
    // ออกไปหน้าเว็บคือการยื่นข้อมูลให้คนที่กำลังหาช่องอยู่ — รายละเอียดไปอยู่ใน log แทน
    if (IS_PRODUCTION) {
        error_log('[kpop-api] เชื่อมต่อฐานข้อมูลไม่ได้: ' . $lastError->getMessage());
        throw new PDOException('ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งในภายหลังค่ะ', 0, $lastError);
    }

    // 3D000 = มี Postgres แต่ยังไม่มีฐานข้อมูลชื่อนี้
    $hint = str_contains($lastError->getMessage(), '3D000') || str_contains($lastError->getMessage(), 'does not exist')
        ? 'ยังไม่มีฐานข้อมูลตามที่ระบุใน DATABASE_URL — สร้างฐานข้อมูลแล้วรัน database/schema.sql (และ seed.sql บนเครื่องพัฒนา) ก่อนค่ะ'
        : 'ต่อ PostgreSQL ไม่ได้ — ตรวจว่า DATABASE_URL ถูกต้องและฐานข้อมูลเปิดอยู่ (Docker: docker compose up -d) '
          . '[' . $lastError->getMessage() . ']';

    throw new PDOException($hint, 0, $lastError);
}
