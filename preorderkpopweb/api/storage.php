<?php
/**
 * ที่เก็บไฟล์อัปโหลด (สลิป · รูปสินค้า · หลักฐานการกดสั่ง)
 *
 *   - เว็บจริง (Vercel): Supabase Storage — container ของ Vercel ไม่มีดิสก์ถาวร ไฟล์ที่เขียนลงเครื่องหายเมื่อ container ปิด
 *   - เครื่องพัฒนา (Docker): โฟลเดอร์ preorderkpopweb/uploads/ เหมือนเดิม (ไม่ต้องมีบัญชี Supabase)
 *
 * เลือกจาก environment variable — ตั้งครบสองตัวนี้เมื่อไหร่ใช้ Supabase Storage:
 *   SUPABASE_URL          https://<project-ref>.supabase.co
 *   SUPABASE_SECRET_KEY   secret key (sb_secret_...) หรือ service_role key รุ่นเก่า — ความลับ ห้ามอยู่ในโค้ด/หน้าเว็บ
 *   SUPABASE_STORAGE_BUCKET  (ไม่บังคับ) ชื่อ bucket ค่าตั้งต้น uploads — ต้องเป็น Public bucket
 *
 * ฐานข้อมูลเก็บสิ่งที่ storage_put() คืนมา: URL เต็มของ Supabase หรือ 'uploads/...' บนเครื่อง
 * หน้าเว็บเอาไปใส่ src ของรูปได้ตรง ๆ ทั้งสองแบบ
 *
 * ไฟล์นี้ไม่พึ่ง helpers.php (สคริปต์ย้ายไฟล์ใน database/tools/ เรียกใช้ตรง ๆ จาก command line)
 */

require_once __DIR__ . '/config.php';

const LOCAL_UPLOAD_DIR = __DIR__ . '/../uploads';

function storage_configured(): bool
{
    return getenv('SUPABASE_URL') && getenv('SUPABASE_SECRET_KEY');
}

function storage_bucket(): string
{
    return getenv('SUPABASE_STORAGE_BUCKET') ?: 'uploads';
}

/** URL สาธารณะของไฟล์ใน bucket (bucket ต้องตั้งเป็น Public) */
function storage_public_url(string $name): string
{
    return rtrim(getenv('SUPABASE_URL'), '/') . '/storage/v1/object/public/' . storage_bucket() . '/' . rawurlencode($name);
}

/**
 * เก็บไฟล์ แล้วคืนค่าที่ใช้บันทึกลงฐานข้อมูล / ใส่ src ของรูป
 * $name ต้องเป็นชื่อไฟล์ที่ระบบตั้งเอง (ห้ามใช้ชื่อจากผู้ใช้)
 *
 * @throws RuntimeException เมื่อเก็บไม่สำเร็จ
 */
function storage_put(string $name, string $binary, string $mime): string
{
    if (!storage_configured()) {
        if (!is_dir(LOCAL_UPLOAD_DIR) && !mkdir(LOCAL_UPLOAD_DIR, 0775, true) && !is_dir(LOCAL_UPLOAD_DIR)) {
            throw new RuntimeException('สร้างโฟลเดอร์เก็บรูปไม่สำเร็จ กรุณาตรวจสอบสิทธิ์เขียนไฟล์ค่ะ');
        }
        if (file_put_contents(LOCAL_UPLOAD_DIR . '/' . $name, $binary) === false) {
            throw new RuntimeException('บันทึกไฟล์รูปไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ');
        }
        // path สัมพัทธ์กับรากเว็บ ใช้ใส่ src ได้ตรง ๆ เหมือน 'images/...'
        return 'uploads/' . $name;
    }

    $key = getenv('SUPABASE_SECRET_KEY');
    $headers = ['apikey: ' . $key, 'Content-Type: ' . $mime, 'x-upsert: false'];
    // key รุ่นใหม่ (sb_secret_...) ไม่ใช่ JWT ต้องส่งทาง apikey อย่างเดียว
    // service_role รุ่นเก่าเป็น JWT ส่ง Authorization คู่ไปด้วยตามตัวอย่างในเอกสารของ Supabase
    if (str_starts_with($key, 'eyJ')) {
        $headers[] = 'Authorization: Bearer ' . $key;
    }

    $ch = curl_init(rtrim(getenv('SUPABASE_URL'), '/') . '/storage/v1/object/' . storage_bucket() . '/' . rawurlencode($name));
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $binary,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
    ]);
    $body   = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error  = curl_error($ch);
    curl_close($ch);

    if ($status < 200 || $status >= 300) {
        // รายละเอียดจาก Supabase (เช่น key ผิด / ไม่มี bucket) ลง log ไม่ส่งให้ผู้ใช้
        error_log("[kpop-storage] อัปโหลด $name ไม่สำเร็จ: HTTP $status $error " . substr((string) $body, 0, 300));
        throw new RuntimeException('บันทึกไฟล์รูปไม่สำเร็จ กรุณาลองใหม่อีกครั้งค่ะ');
    }

    return storage_public_url($name);
}

/**
 * ขนาดรวมของไฟล์อัปโหลดทั้งหมด [bytes, จำนวนไฟล์] — ใช้ในการ์ดพื้นที่จัดเก็บหน้าแอดมิน
 * บน Supabase อ่านจากตาราง storage.objects (ต่อเป็นเจ้าของฐานข้อมูลอยู่แล้ว ไม่ต้องยิง API)
 */
function storage_usage(): array
{
    if (storage_configured()) {
        try {
            $st = db()->prepare(
                "SELECT COALESCE(SUM((metadata->>'size')::bigint), 0), COUNT(*) FROM storage.objects WHERE bucket_id = ?"
            );
            $st->execute([storage_bucket()]);
            [$bytes, $files] = $st->fetch(PDO::FETCH_NUM);
            return [(int) $bytes, (int) $files];
        } catch (PDOException $e) {
            // การ์ดตัวเลขในหน้าแอดมินไม่ควรทำให้ทั้งหน้าพัง (เช่น ฐานข้อมูลไม่ใช่ของ Supabase จึงไม่มี schema storage)
            error_log('[kpop-storage] อ่านขนาดไฟล์ไม่ได้: ' . $e->getMessage());
            return [0, 0];
        }
    }

    $bytes = 0;
    $files = 0;
    foreach (is_dir(LOCAL_UPLOAD_DIR) ? (scandir(LOCAL_UPLOAD_DIR) ?: []) : [] as $entry) {
        $path = LOCAL_UPLOAD_DIR . '/' . $entry;
        if ($entry[0] !== '.' && is_file($path)) {
            $bytes += filesize($path) ?: 0;
            $files++;
        }
    }
    return [$bytes, $files];
}
