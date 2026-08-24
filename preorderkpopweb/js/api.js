/**
 * KPOP STORE — ตัวห่อการเรียก API หลังบ้าน
 *
 * ต้องโหลด "ก่อน" js/store.js
 *
 * ทุก endpoint ตอบกลับด้วยรูปทรงเดียวกันคือ { success, message, ... }
 * ซึ่งเป็นรูปเดียวกับที่เมธอดใน store.js เคยคืนตอนยังใช้ localStorage
 * โค้ดฝั่งหน้าเว็บที่เช็ค res.success อยู่แล้วทุกจุดจึงใช้ต่อได้โดยไม่ต้องแก้
 */
(function (global) {
    'use strict';

    const BASE = 'api/';

    // ข้อความเดียวที่ใช้ตอนคุยกับเซิร์ฟเวอร์ไม่ได้เลย
    // (เน็ตหลุด, เซิร์ฟเวอร์ล่ม, PHP ตายกลางคัน — บนเครื่องตัวเองมักเป็นเพราะลืมเปิด MAMP)
    const OFFLINE_MESSAGE =
        'ติดต่อเซิร์ฟเวอร์ไม่ได้ค่ะ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต แล้วลองใหม่อีกครั้ง';

    /**
     * ยิงคำขอแล้วคืน JSON เสมอ — ไม่โยน exception ออกไปให้ผู้เรียกต้อง try/catch
     *
     * เหตุผล: จุดเรียกทุกจุดในโปรเจกต์เขียนแบบ `if (!res.success) { alert(res.message) }`
     * อยู่แล้ว ถ้าปล่อยให้ throw ขึ้นไป โค้ดเดิมจะพังทั้งหมดและผู้ใช้จะเห็นหน้าค้าง
     * โดยไม่มีข้อความบอกว่าเกิดอะไรขึ้น
     */
    async function request(path, options) {
        let res;
        try {
            res = await fetch(BASE + path, Object.assign({
                // ต้องส่ง cookie ไปด้วย ไม่งั้น PHP session จำไม่ได้ว่าใครล็อกอินอยู่
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' }
            }, options));
        } catch (e) {
            console.error('เรียก API ไม่สำเร็จ:', path, e);
            return { success: false, message: OFFLINE_MESSAGE };
        }

        let data;
        try {
            data = await res.json();
        } catch (e) {
            // ปกติเกิดตอน PHP พ่น warning/error ออกมาปนกับ JSON
            console.error('อ่านคำตอบจาก API ไม่ได้:', path, e);
            return {
                success: false,
                message: 'เซิร์ฟเวอร์ตอบกลับมาในรูปแบบที่อ่านไม่ได้ค่ะ (ดูรายละเอียดใน Console)'
            };
        }

        return data;
    }

    global.KpopApi = {
        OFFLINE_MESSAGE: OFFLINE_MESSAGE,

        get(path) {
            return request(path, { method: 'GET' });
        },

        post(path, payload) {
            return request(path, {
                method: 'POST',
                body: JSON.stringify(payload || {})
            });
        },

        /**
         * อัปโหลดรูปแล้วคืน path ที่เก็บจริงบนเซิร์ฟเวอร์
         *
         * รับได้ทั้ง data URL (รูปที่เพิ่งย่อมาใหม่) และ path เดิม
         * ถ้าเป็น path เดิมอยู่แล้วจะคืนค่าเดิมกลับไปโดยไม่ยิงคำขอ
         * ผู้เรียกจึงส่งค่าอะไรมาก็ได้โดยไม่ต้องแยกเคสเอง
         *
         * @returns {Promise<{success:boolean, path?:string, message?:string}>}
         */
        async uploadImage(dataUrl, kind) {
            if (!dataUrl) return { success: true, path: '' };
            if (!String(dataUrl).startsWith('data:')) {
                return { success: true, path: dataUrl };
            }
            return this.post('upload.php', { dataUrl: dataUrl, kind: kind || 'img' });
        }
    };

})(window);
