<?php
/**
 * เก็บ PHP session ในตาราง sessions ของฐานข้อมูล แทนไฟล์ในเครื่อง
 *
 * ทำไม: บน Vercel แต่ละคำขออาจไปตก container คนละตัว และ container ปิดตัวเองเมื่อว่าง
 * ไฟล์ session จึงหายหรือมองไม่เห็นข้ามตัว (ลูกค้าจะหลุดล็อกอินแบบสุ่ม)
 * ผลพลอยได้: deploy ใหม่แล้วไม่มีใครหลุดล็อกอินอีก (เดิมบน Railway หลุดทุกครั้ง)
 *
 * ประหยัดรอบเครือข่าย (ฐานข้อมูลอยู่คนละเครื่องกับเว็บ):
 *   - ผู้เยี่ยมชมที่ไม่ได้ล็อกอิน (session ว่าง) ไม่ถูกเขียนลงตารางเลย
 *   - ข้อมูลไม่เปลี่ยน → ไม่เขียน เว้นแต่ใกล้หมดอายุ ค่อยต่ออายุให้
 *
 * อายุ session = session.gc_maxlifetime (ค่าตั้งต้นของ PHP 1440 วินาที) นับจากครั้งล่าสุดที่ถูกเขียน/ต่ออายุ
 * ไม่มีการล็อกแถวระหว่างคำขอพร้อมกัน — ระบบนี้เขียน session แค่ตอนล็อกอิน/ออก จึงไม่ชนกัน
 */
class DbSessionHandler implements SessionHandlerInterface
{
    /** ข้อมูลตอนอ่าน — ใช้ตัดสินว่าต้องเขียนกลับไหม */
    private ?string $loaded = null;
    private int $loadedAge = 0;

    /** อายุ session เป็นวินาที (อย่างน้อย 1 นาที) */
    private function lifetime(): int
    {
        return max(60, (int) ini_get('session.gc_maxlifetime'));
    }

    /** ไม่ต้องเปิดอะไร — ใช้การเชื่อมต่อฐานข้อมูลเดิมของคำขอ */
    public function open(string $path, string $name): bool
    {
        return true;
    }

    /** ไม่มีอะไรต้องปิด */
    public function close(): bool
    {
        return true;
    }

    /** อ่านข้อมูล session ตาม id ในคุกกี้ (เฉพาะที่ยังไม่หมดอายุ) */
    public function read(string $id): string|false
    {
        $st = db()->prepare('SELECT data, updated_at FROM sessions WHERE id = ? AND updated_at > ?');
        $st->execute([$id, date('Y-m-d H:i:s', time() - $this->lifetime())]);
        $row = $st->fetch();

        $this->loaded = $row ? $row['data'] : null;
        $this->loadedAge = $row ? time() - strtotime($row['updated_at']) : 0;
        return $this->loaded ?? '';
    }

    /** บันทึก session ตอนจบคำขอ (ข้ามได้ถ้าไม่จำเป็น — ดูเงื่อนไขด้านล่าง) */
    public function write(string $id, string $data): bool
    {
        // ไม่ได้ล็อกอินและไม่เคยมีแถว — ไม่ต้องสร้างแถวให้ทุกคนที่แวะมาดูหน้าร้าน
        if ($data === '' && $this->loaded === null) {
            return true;
        }
        // ไม่เปลี่ยน และยังเหลืออายุเกินครึ่ง — ข้ามได้
        if ($data === $this->loaded && $this->loadedAge < $this->lifetime() / 2) {
            return true;
        }

        $st = db()->prepare(
            'INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at'
        );
        $st->execute([$id, $data, date('Y-m-d H:i:s')]);
        return true;
    }

    /** ลบ session ทิ้ง (ตอนออกจากระบบ / ตอนเปลี่ยน id หลังล็อกอิน) */
    public function destroy(string $id): bool
    {
        db()->prepare('DELETE FROM sessions WHERE id = ?')->execute([$id]);
        return true;
    }

    /** PHP เรียกเป็นครั้งคราว: ลบ session ที่หมดอายุแล้วทิ้ง */
    public function gc(int $max_lifetime): int|false
    {
        $st = db()->prepare('DELETE FROM sessions WHERE updated_at < ?');
        $st->execute([date('Y-m-d H:i:s', time() - $max_lifetime)]);
        return $st->rowCount();
    }
}
