/**
 * KPOP STORE - Centralized Data Store & Utilities (localStorage)
 */
(function (global) {
    const STORAGE_KEYS = {
        PRODUCTS: 'kpop_products',
        USERS: 'kpop_users',
        ORDERS: 'kpop_orders',
        NOTIFICATIONS: 'kpop_notifications',
        CURRENT_USER: 'kpop_current_user',
        CART: 'kpop_cart',
        ROUNDS: 'kpop_rounds',
        RATES: 'kpop_rates'
    };

    // เวลาที่เรทเงินวอนเปลี่ยนรอบ (ร้านประกาศเรทใหม่ทุกวันตอน 22:00)
    const RATE_CUTOFF_HOUR = 22;

    // รูปแบบวันเวลาทั้งระบบใช้ 'YYYY-MM-DD HH:mm' เพื่อให้เทียบเป็นสตริงได้ตรง ๆ
    function pad2(n) { return String(n).padStart(2, '0'); }

    function formatStamp(date) {
        const d = date || new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
            ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    function formatDay(date) {
        const d = date || new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function dayOffset(days) {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return formatDay(d);
    }

    // สถานะคำสั่งซื้อ — แหล่งความจริงเดียวของทั้งระบบ
    // `text` มีไว้ "แสดงผล" เท่านั้น ห้ามเอาไปตัดสิน logic
    // เดิมโค้ดตัดสินสถานะด้วยข้อความไทยกระจายอยู่ 22 จุดใน 4 ไฟล์ ทั้งเทียบตรง ๆ และ includes()
    // ซึ่งพังทันทีที่ข้อความมีคำซ้อนกัน (เช่น "กดไม่สำเร็จ" มีคำว่า "สำเร็จ" อยู่ข้างใน)
    //
    // ความหมายของแต่ละ flag:
    //   revenue         - นับเข้ายอดขายรวมในแดชบอร์ดหรือไม่
    //   quota           - กินโควตารับพรีออเดอร์ของรอบอยู่หรือไม่
    //   canCancel       - ลูกค้ากดยกเลิกเองได้หรือไม่
    //   canReuploadSlip - ลูกค้าส่งสลิปใบใหม่ได้หรือไม่
    const ORDER_STATUS = {
        PENDING_SLIP: {
            text: 'รอตรวจสอบชำระเงิน', short: 'รอตรวจสลิป',
            group: 'pending', badge: 'warning', icon: 'fa-hourglass-half',
            revenue: true, quota: true, canCancel: true, canReuploadSlip: true
        },
        PAID_WAIT_ROUND: {
            text: 'ชำระเงินแล้ว รอปิดรอบ', short: 'รอปิดรอบ',
            group: 'processing', badge: 'info', icon: 'fa-hourglass-half',
            revenue: true, quota: true, canCancel: true, canReuploadSlip: false
        },
        ROUND_CLOSED: {
            text: 'ปิดรอบแล้ว รอร้านกดสั่ง', short: 'รอร้านกดสั่ง',
            group: 'processing', badge: 'info', icon: 'fa-cart-flatbed',
            revenue: true, quota: true, canCancel: true, canReuploadSlip: false
        },
        // ตั้งแต่จุดนี้ร้านจ่ายเงินให้เกาหลีไปแล้ว ลูกค้ายกเลิกเองไม่ได้อีก
        // ถ้าปล่อยให้ยกเลิกได้ ร้านเสียเงินจริงโดยไม่มีทางเรียกคืน
        ORDERED_KR: {
            text: 'ร้านกดสั่งกับเกาหลีแล้ว', short: 'กดสั่งแล้ว',
            group: 'processing', badge: 'primary', icon: 'fa-cart-shopping',
            revenue: true, quota: true, canCancel: false, canReuploadSlip: false
        },
        // ขั้นนี้คือ "ของถึงไทยแล้ว กำลังแพ็ก" — อยู่หลัง ORDERED_KR เสมอ
        // คงข้อความเดิมไว้เพื่อให้ข้อมูลเก่า migrate เข้าตัวนี้ได้ตรง ๆ
        // canCancel เป็น false เพราะมาถึงขั้นนี้ร้านจ่ายเงินให้เกาหลีไปแล้ว
        PREPARING: {
            text: 'กำลังจัดเตรียมสินค้า', short: 'กำลังเตรียมพัสดุ',
            group: 'processing', badge: 'info', icon: 'fa-box-open',
            revenue: true, quota: true, canCancel: false, canReuploadSlip: false
        },
        SHIPPING: {
            text: 'กำลังจัดส่งสินค้า', short: 'กำลังจัดส่ง',
            group: 'shipped', badge: 'primary', icon: 'fa-truck-fast',
            revenue: true, quota: true, canCancel: false, canReuploadSlip: false
        },
        DELIVERED: {
            text: 'จัดส่งสำเร็จ', short: 'จัดส่งสำเร็จ',
            group: 'shipped', badge: 'success', icon: 'fa-circle-check',
            revenue: true, quota: true, canCancel: false, canReuploadSlip: false
        },
        SLIP_REJECTED: {
            text: 'ยกเลิกคำสั่งซื้อ / สลิปไม่ถูกต้อง', short: 'ยกเลิก/สลิปไม่ผ่าน',
            group: 'cancelled', badge: 'danger', icon: 'fa-circle-xmark',
            revenue: false, quota: false, canCancel: false, canReuploadSlip: true
        },
        CANCELLED_USER: {
            text: 'ยกเลิกคำสั่งซื้อโดยลูกค้า', short: 'ลูกค้ายกเลิก',
            group: 'cancelled', badge: 'danger', icon: 'fa-ban',
            revenue: false, quota: false, canCancel: false, canReuploadSlip: false
        },
        // กลุ่มคืนเงิน: ลูกค้าจ่ายถูกต้องทุกอย่าง แต่ร้านกดของไม่ได้
        // ต้องแยกจากกลุ่ม cancelled ให้ชัด ไม่งั้นลูกค้าจะเข้าใจว่าสลิปตัวเองมีปัญหา
        PURCHASE_FAILED: {
            text: 'ร้านกดสั่งไม่สำเร็จ (ของหมดที่เกาหลี)', short: 'กดของไม่สำเร็จ',
            group: 'refund', badge: 'danger', icon: 'fa-circle-exclamation',
            revenue: false, quota: false, canCancel: false, canReuploadSlip: false
        },
        REFUND_PENDING: {
            text: 'รอคืนเงิน', short: 'รอคืนเงิน',
            group: 'refund', badge: 'warning', icon: 'fa-rotate-left',
            revenue: false, quota: false, canCancel: false, canReuploadSlip: false
        },
        REFUNDED: {
            text: 'คืนเงินเรียบร้อยแล้ว', short: 'คืนเงินแล้ว',
            group: 'refund', badge: 'secondary', icon: 'fa-circle-check',
            revenue: false, quota: false, canCancel: false, canReuploadSlip: false
        }
    };

    // ข้อความไทย → code (ใช้ตอน migrate ข้อมูลเก่าที่ยังไม่มี statusCode)
    const STATUS_TEXT_TO_CODE = Object.keys(ORDER_STATUS).reduce(function (map, code) {
        map[ORDER_STATUS[code].text] = code;
        return map;
    }, {});

    // ข้อความที่ไม่ตรงกับตารางเป๊ะ ๆ ให้เดาด้วยกฎ includes() ชุดเดิม "ครั้งเดียว" แล้วบันทึก code ทับ
    // ลำดับสำคัญ: ต้องเช็คยกเลิกก่อนเสมอ เพราะข้อความยกเลิกบางอันมีคำว่า "จัดส่ง"/"สำเร็จ" ปนอยู่
    function guessStatusCode(text) {
        const s = String(text || '');
        if (STATUS_TEXT_TO_CODE[s]) return STATUS_TEXT_TO_CODE[s];
        if (s.includes('โดยลูกค้า')) return 'CANCELLED_USER';
        if (s.includes('ยกเลิก') || s.includes('ไม่ถูกต้อง') || s.includes('ปฏิเสธ')) return 'SLIP_REJECTED';
        if (s.includes('สำเร็จ')) return 'DELIVERED';
        if (s.includes('จัดส่ง')) return 'SHIPPING';
        if (s.includes('จัดเตรียม') || s.includes('ชำระแล้ว') || s.includes('อนุมัติ')) return 'PREPARING';
        return 'PENDING_SLIP';
    }

    // Default Seed Data
    const DEFAULT_PRODUCTS = [
        {
            id: 'bts',
            artist: 'BTS',
            title: 'BTS - Map of the Soul: 7 Album (Pre-order)',
            priceKRW: 27000,
            serviceFee: 174,
            price: 890,          // ราคาบาทสำรอง เผื่อยังไม่มีเรทในระบบ
            roundId: 'round-kr',
            quotaPerRound: 50,
            image: 'images/mapsoul7.jpg',
            status: 'PRE-ORDER',
            estDelivery: '7 - 14 วัน หลังปิดรอบประจำวัน',
            desc: 'อัลบั้มเต็มชุดที่ 4 จาก BTS "Map of the Soul: 7" ฉลองครบรอบ 7 ปีของวง ภายในเซ็ตประกอบด้วย Photobook เล่มใหญ่, CD, Lyric Book, Mini Book, Photocard, Postcard, Sticker และ Coloring Paper'
        },
        {
            id: 'newjeans',
            artist: 'NEWJEANS',
            title: 'NewJeans - Get Up Album Set (Pre-order)',
            priceKRW: 22000,
            serviceFee: 167,
            price: 750,
            roundId: 'round-kr',
            quotaPerRound: 35,
            image: 'images/getup.jpg',
            status: 'PRE-ORDER',
            estDelivery: '7 - 14 วัน หลังปิดรอบประจำวัน',
            desc: 'เซ็ตอัลบั้ม EP ที่ 2 "Get Up" จาก NewJeans มาพร้อมกับแพ็กเกจสุดพิเศษ ดีไซน์มินิมอลน่าสะสม ในเซ็ตประกอบด้วย Photobook, CD, Photocard, และโปสเตอร์ขนาดมินิ (สุ่มลาย)'
        },
        {
            id: 'blackpink',
            artist: 'BLACKPINK',
            title: 'BLACKPINK - BORN PINK Limited Vinyl',
            priceKRW: 42000,
            serviceFee: 177,
            price: 1290,
            roundId: 'round-ship',
            quotaPerRound: 20,
            image: 'images/placeholder-album.svg',
            status: 'PRE-ORDER',
            estDelivery: '10 - 18 วัน หลังปิดรอบประจำวัน',
            desc: 'ไวนิลอัลบั้ม BORN PINK ผลิตจำนวนจำกัด มาพร้อมกับ Photobook ฉบับพิเศษและแผ่นไวนิลสีชมพูพาสเทล'
        },
        {
            id: 'aespa',
            artist: 'AESPA',
            title: 'aespa - Armageddon 1st Album',
            priceKRW: 24500,
            serviceFee: 170,
            price: 820,
            roundId: 'round-ship',
            quotaPerRound: 40,
            image: 'images/placeholder-album.svg',
            status: 'PRE-ORDER',
            estDelivery: '7 - 14 วัน หลังปิดรอบประจำวัน',
            desc: 'อัลบั้มเต็มชุดแรกจาก aespa มาพร้อมโปสการ์ดและโฟโต้การ์ดสุ่มสุดเอ็กซ์คลูซีฟ'
        }
    ];

    // รอบพรีออเดอร์ = หน้าต่างรับสั่งที่ผูกกับรอบของเว็บเกาหลี หรือรอบชิปรวมของร้าน
    // ไม่ใช่ "รอบตัดยอดรายวัน" — วันเปิด/ปิดกำหนดเป็นช่วงวันที่จริง
    // seed ใช้วันที่แบบสัมพัทธ์กับวันนี้ เพื่อให้ข้อมูลตัวอย่างมีรอบที่เปิดอยู่เสมอ
    const DEFAULT_ROUNDS = [
        {
            id: 'round-kr',
            name: 'รอบพรีออเดอร์เว็บเกาหลี (Weverse / Ktown4u)',
            type: 'korean-site',
            openAt: dayOffset(-3),
            closeAt: dayOffset(4),
            status: 'open',
            estDelivery: 'ประมาณ 3-5 สัปดาห์หลังปิดรอบ',
            note: 'ร้านจะรวบรวมยอดแล้วกดสั่งกับเว็บ Official หลังปิดรอบ'
        },
        {
            id: 'round-ship',
            name: 'รอบหิ้วหน้าร้าน + ชิปรวมกลับไทย',
            type: 'shipping',
            openAt: dayOffset(-1),
            closeAt: dayOffset(9),
            status: 'open',
            estDelivery: 'ประมาณ 2-3 สัปดาห์หลังปิดรอบ',
            note: 'รอบนี้ร้านเดินทางไปหิ้วหน้าร้านที่เกาหลีเอง'
        },
        {
            id: 'round-legacy',
            name: 'รอบทั่วไป (ข้อมูลก่อนมีระบบรอบ)',
            type: 'korean-site',
            openAt: '2000-01-01',
            closeAt: '2999-12-31',
            status: 'open',
            estDelivery: '7 - 14 วัน',
            note: 'รอบสำรองสำหรับสินค้า/ออเดอร์ที่สร้างไว้ก่อนระบบรอบจะมี'
        }
    ];

    // ประวัติเรทเงินวอน เก็บเป็นรายการที่มี effectiveFrom เพื่อย้อนดูได้ว่าออเดอร์ไหนใช้เรทอะไร
    // getCurrentRate() หยิบรายการล่าสุดที่ถึงเวลาแล้ว จุดตัด 22:00 จึงเกิดขึ้นเองโดยไม่ต้องมี cron
    const DEFAULT_RATES = [
        {
            rate: 0.0265,
            effectiveFrom: dayOffset(-7) + ' ' + pad2(RATE_CUTOFF_HOUR) + ':00',
            setBy: 'admin@kpopstore.com',
            note: 'เรทตั้งต้นของระบบ'
        }
    ];

    const DEFAULT_USERS = [
        {
            id: 'u-admin',
            name: 'ผู้ดูแลระบบ (Admin)',
            email: 'admin@kpopstore.com',
            phone: '080-000-0000',
            address: 'ศูนย์ประสานงาน KPOP STORE กรุงเทพมหานคร',
            role: 'admin',
            createdAt: '2026-01-01'
        },
        {
            id: 'u-customer1',
            name: 'คุณสมชาย ใจดี',
            email: 'user@kpopstore.com',
            phone: '081-234-5678',
            address: '123/45 หมู่บ้านตัวอย่าง ซ.สุขุมวิท 1 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
            role: 'customer',
            createdAt: '2026-06-15'
        },
        {
            id: 'u-customer2',
            name: 'คุณโซมี รักเคป็อป',
            email: 'somi@kpopstore.com',
            phone: '089-876-5432',
            address: '88/9 คอนโดสยาม ถนนพญาไท เขตราชเทวี กรุงเทพมหานคร 10400',
            role: 'customer',
            createdAt: '2026-07-01'
        }
    ];

    const DEFAULT_ORDERS = [
        {
            id: 'ORD-2026071301',
            customerName: 'คุณสมชาย ใจดี',
            customerEmail: 'user@kpopstore.com',
            phone: '081-234-5678',
            address: '123/45 หมู่บ้านตัวอย่าง ซ.สุขุมวิท 1 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
            date: '2026-07-13 14:30',
            items: [
                {
                    id: 'newjeans',
                    title: 'NewJeans - Get Up Album Set (Pre-order)',
                    qty: 1,
                    price: 750,
                    image: 'images/getup.jpg'
                }
            ],
            subtotal: 750,
            shippingFee: 50,
            total: 800,
            status: 'รอตรวจสอบชำระเงิน',
            statusCode: 'PENDING_SLIP',
            roundId: 'round-kr',
            rateUsed: 0.0265,
            rateLockedAt: '2026-07-13 14:30',
            slipImage: 'images/placeholder-slip.svg',
            trackingNumber: '',
            adminNotes: 'รอตรวจสอบสลิปจากลูกค้า'
        },
        {
            id: 'ORD-2026062815',
            customerName: 'คุณสมชาย ใจดี',
            customerEmail: 'user@kpopstore.com',
            phone: '081-234-5678',
            address: '123/45 หมู่บ้านตัวอย่าง ซ.สุขุมวิท 1 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
            date: '2026-06-28 10:15',
            items: [
                {
                    id: 'bts',
                    title: 'BTS - Map of the Soul: 7 Album (Pre-order)',
                    qty: 2,
                    price: 890,
                    image: 'images/mapsoul7.jpg'
                }
            ],
            subtotal: 1780,
            shippingFee: 50,
            total: 1830,
            status: 'กำลังจัดเตรียมสินค้า',
            statusCode: 'PREPARING',
            roundId: 'round-kr',
            rateUsed: 0.0265,
            rateLockedAt: '2026-06-28 10:15',
            slipImage: 'images/placeholder-slip.svg',
            trackingNumber: 'TH0192837465TH',
            adminNotes: 'อนุมัติสลิปเรียบร้อยแล้ว อยู่ระหว่างแพ็กพัสดุ',
            purchaseProofImage: 'images/placeholder-slip.svg',
            purchaseProofNote: 'กดสั่งซื้อสำเร็จจาก Weverse Shop Official เรียบร้อยแล้ว (Order #WV-982301)'
        },
        {
            id: 'ORD-2026070102',
            customerName: 'คุณโซมี รักเคป็อป',
            customerEmail: 'somi@kpopstore.com',
            phone: '089-876-5432',
            address: '88/9 คอนโดสยาม ถนนพญาไท เขตราชเทวี กรุงเทพมหานคร 10400',
            date: '2026-07-01 18:20',
            items: [
                {
                    id: 'blackpink',
                    title: 'BLACKPINK - BORN PINK Limited Vinyl',
                    qty: 1,
                    price: 1290,
                    image: 'images/placeholder-album.svg'
                }
            ],
            subtotal: 1290,
            shippingFee: 50,
            total: 1340,
            status: 'จัดส่งสำเร็จ',
            statusCode: 'DELIVERED',
            roundId: 'round-ship',
            rateUsed: 0.0265,
            rateLockedAt: '2026-07-01 18:20',
            slipImage: 'images/placeholder-slip.svg',
            trackingNumber: 'KERRY-8829104',
            adminNotes: 'จัดส่งสำเร็จเรียบร้อย',
            purchaseProofImage: 'images/placeholder-slip.svg',
            purchaseProofNote: 'ซื้อหิ้วหน้าร้าน YG SELECT Pop-up Store เรียบร้อย'
        }
    ];

    const DEFAULT_NOTIFICATIONS = [
        {
            id: 1,
            userEmail: 'user@kpopstore.com',
            title: 'อัปเดตสถานะคำสั่งซื้อ #ORD-2026062815',
            message: 'คำสั่งซื้อของคุณปรับสถานะเป็น "กำลังจัดเตรียมสินค้า" เลขพัสดุ: TH0192837465TH',
            date: '2026-06-29 09:00',
            read: false
        },
        {
            id: 2,
            userEmail: 'user@kpopstore.com',
            title: 'ได้รับการแจ้งชำระเงิน #ORD-2026071301',
            message: 'ขอบคุณสำหรับการสั่งซื้อ ระบบกำลังเสนอสลิปให้ผู้ดูแลระบบตรวจสอบค่ะ',
            date: '2026-07-13 14:31',
            read: true
        }
    ];

    /* ================================================================
     * ชั้นเก็บข้อมูล
     *
     * ข้อมูลจริงอยู่ใน MySQL แล้ว แต่โค้ดที่วาดหน้าจอทุกหน้าเรียกเมธอดอ่านค่า
     * แบบ synchronous กลางลูป Array.map() ที่ประกอบ HTML อยู่หลายจุด
     * (เช่น admin.html เรียก 4 เมธอดต่อสินค้า 1 ตัว) ถ้าเปลี่ยนให้เป็น async
     * ต้องรื้อการวาดหน้าจอใหม่ทั้งระบบ
     *
     * จึงใช้วิธี: ดึงข้อมูลทั้งหมดจาก api/bootstrap.php "ครั้งเดียว" ตอนเปิดหน้า
     * เก็บไว้ใน CACHE แล้วให้เมธอดอ่านค่าทุกตัวอ่านจาก CACHE เหมือนเดิมเป๊ะ
     * ส่วนการเขียนยิงไปที่ API แล้วดึงข้อมูลใหม่มาทับ CACHE
     *
     * มีสองโหมด:
     *   - เบราว์เซอร์ (มี KpopApi) : CACHE มาจากเซิร์ฟเวอร์
     *   - Node/ชุดทดสอบ (ไม่มี)    : CACHE มาจาก localStorage จำลอง เขียนกลับด้วย
     *                              ทำให้ตรรกะธุรกิจถูกทดสอบด้วยโค้ดจริงชุดเดิมได้
     * ============================================================== */

    const HAS_API = typeof global.KpopApi !== 'undefined' && typeof global.fetch === 'function';

    // ข้อมูลทั้งหมดของหน้านี้ เก็บตาม STORAGE_KEYS เดิม
    const CACHE = Object.create(null);

    function getJSON(key, defaultVal) {
        if (HAS_API) {
            return (key in CACHE) ? CACHE[key] : defaultVal;
        }

        // โหมด Node/ชุดทดสอบ: อ่านจาก localStorage ใหม่ทุกครั้งเหมือนเดิมเป๊ะ
        // สำคัญ: ต้องคืน "สำเนาใหม่" ทุกครั้ง ไม่ใช่ตัวอ้างอิงเดิม เพราะผู้เรียกหลายจุด
        // แก้ค่าในอาร์เรย์ที่ได้ไปก่อน แล้วค่อยเรียก setJSON — ถ้าคืนตัวอ้างอิงเดิม
        // การแก้จะติดค้างอยู่แม้ setJSON จะล้มเหลว (เช่นตอนพื้นที่เต็ม)
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : defaultVal;
        } catch (e) {
            console.error('Error reading localStorage key:', key, e);
            return defaultVal;
        }
    }

    // คืน true/false แทนที่จะกลืน error เงียบ ๆ
    // ผู้เรียกทุกจุดเช็คค่านี้ก่อนแจ้งผู้ใช้ว่า "บันทึกสำเร็จ" อยู่แล้ว
    function setJSON(key, val) {
        if (HAS_API) {
            CACHE[key] = val;   // การบันทึกจริงเกิดที่ API ไม่ใช่ที่นี่
            return true;
        }
        try {
            localStorage.setItem(key, JSON.stringify(val));
            return true;
        } catch (e) {
            console.error('Error writing localStorage key:', key, e);
            return false;
        }
    }

    /* --- การซิงก์กับเซิร์ฟเวอร์ (ใช้เฉพาะโหมดเบราว์เซอร์) --- */

    let hydratePromise = null;

    // ขนาดโฟลเดอร์ uploads/ สำหรับการ์ดในหน้าแอดมิน (เติมตอน hydrate เฉพาะแอดมิน)
    // ค่า limit ตั้งต้นต้องตรงกับ SOFT_LIMIT ใน api/stats.php
    // (ใช้ค่าคงที่ตรงนี้ ไม่อ้าง STORAGE_LIMIT_BYTES เพราะตัวนั้นประกาศทีหลังในไฟล์)
    let uploadStats = { bytes: 0, limit: 500 * 1024 * 1024, percent: 0, files: 0 };

    /** ดึงข้อมูลทั้งหมดจากเซิร์ฟเวอร์มาทับ CACHE */
    async function hydrate() {
        if (!HAS_API) return { success: true };

        const res = await global.KpopApi.get('bootstrap.php');
        if (!res || !res.success) {
            console.error('โหลดข้อมูลจากเซิร์ฟเวอร์ไม่สำเร็จ:', res && res.message);
            return res || { success: false, message: 'โหลดข้อมูลไม่สำเร็จ' };
        }

        CACHE[STORAGE_KEYS.PRODUCTS]      = res.products      || [];
        CACHE[STORAGE_KEYS.ROUNDS]        = res.rounds        || [];
        CACHE[STORAGE_KEYS.RATES]         = res.rates         || [];
        CACHE[STORAGE_KEYS.ORDERS]        = res.orders        || [];
        CACHE[STORAGE_KEYS.USERS]         = res.users         || [];
        CACHE[STORAGE_KEYS.NOTIFICATIONS] = res.notifications || [];
        CACHE[STORAGE_KEYS.CART]          = res.cart          || [];
        CACHE[STORAGE_KEYS.CURRENT_USER]  = res.currentUser   || null;

        // ตัวเลขพื้นที่ไฟล์อัปโหลด ใช้เฉพาะการ์ดในหน้าแอดมิน จึงไม่ดึงให้ลูกค้าเปล่า ๆ
        if (res.currentUser && res.currentUser.role === 'admin') {
            const stats = await global.KpopApi.get('stats.php');
            if (stats && stats.success) {
                uploadStats = {
                    bytes: stats.bytes, limit: stats.limit,
                    percent: stats.percent, files: stats.files
                };
            }
        }

        return { success: true };
    }

    /**
     * ส่งคำสั่งเขียนไปเซิร์ฟเวอร์ แล้วดึงข้อมูลใหม่มาทับ CACHE เมื่อสำเร็จ
     *
     * ตั้งใจ re-hydrate ทั้งก้อนแทนที่จะไล่แก้ CACHE ทีละจุด เพราะการเขียนหนึ่งครั้ง
     * กระทบหลายอย่างพร้อมกัน (สร้างออเดอร์ = โควตาลด + ตะกร้าเปลี่ยน + แจ้งเตือนเพิ่ม)
     * การไล่แก้เองมีโอกาสตกหล่นสูงกว่าค่าคำขอเพิ่มอีกหนึ่งครั้งบนเครื่องตัวเอง
     */
    async function apiWrite(path, payload) {
        const res = await global.KpopApi.post(path, payload);
        if (res && res.success) {
            await hydrate();
        }
        return res || { success: false, message: global.KpopApi.OFFLINE_MESSAGE };
    }

    // เพดานของ localStorage ไม่มี API มาตรฐานให้ถาม เบราว์เซอร์ส่วนใหญ่ให้ราว 5MB ต่อ origin
    const STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;

    // ตัวนับสำหรับสร้าง id แจ้งเตือนที่ไม่ซ้ำกันแม้จะสร้างหลายใบในมิลลิวินาทีเดียว
    let notificationSeq = 0;
    function nextNotificationId() {
        notificationSeq += 1;
        return 'n-' + Date.now() + '-' + notificationSeq;
    }

    // ข้อความเดียวกันทุกจุดที่บันทึกไม่ลง เพื่อไม่ให้แต่ละหน้าบอกผู้ใช้คนละอย่าง
    const STORAGE_FULL_MESSAGE =
        'พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม บันทึกไม่สำเร็จ\n' +
        'ลองใช้ URL รูปภาพแทนการอัปโหลดไฟล์ หรือลบออเดอร์/สินค้าเก่าที่ไม่ใช้แล้วออกก่อน';

    // Initialize Store
    //
    // ใช้เฉพาะโหมด Node/ชุดทดสอบเท่านั้น — ในเบราว์เซอร์ข้อมูลตั้งต้นและการ migrate
    // ย้ายไปอยู่ใน database/kpop_store.sql แล้ว (ดู README)
    function initStore() {
        if (HAS_API) return;

        if (!localStorage.getItem(STORAGE_KEYS.PRODUCTS)) {
            setJSON(STORAGE_KEYS.PRODUCTS, DEFAULT_PRODUCTS);
        }
        if (!localStorage.getItem(STORAGE_KEYS.USERS)) {
            setJSON(STORAGE_KEYS.USERS, DEFAULT_USERS);
        }
        if (!localStorage.getItem(STORAGE_KEYS.ORDERS)) {
            setJSON(STORAGE_KEYS.ORDERS, DEFAULT_ORDERS);
        }
        if (!localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS)) {
            setJSON(STORAGE_KEYS.NOTIFICATIONS, DEFAULT_NOTIFICATIONS);
        }
        if (!localStorage.getItem(STORAGE_KEYS.ROUNDS)) {
            setJSON(STORAGE_KEYS.ROUNDS, DEFAULT_ROUNDS);
        }
        if (!localStorage.getItem(STORAGE_KEYS.RATES)) {
            setJSON(STORAGE_KEYS.RATES, DEFAULT_RATES);
        }
        // ผู้เข้าเว็บครั้งแรกต้อง "ยังไม่ล็อกอิน" เสมอ
        // ของเดิมล็อกอินให้เป็นคุณสมชาย (บัญชีลูกค้าจริงในระบบ) โดยอัตโนมัติ
        // ทำให้คนแปลกหน้าเห็นออเดอร์ ที่อยู่ และเบอร์โทรของลูกค้าคนนั้นทันทีที่เปิดเว็บ
        if (localStorage.getItem(STORAGE_KEYS.CURRENT_USER) === null) {
            setJSON(STORAGE_KEYS.CURRENT_USER, null);
        }

        migrateOrderStatuses();
        migrateProductsToRounds();
    }

    // สินค้าที่บันทึกไว้ก่อนมีระบบรอบจะไม่มี roundId / quotaPerRound
    // ผูกเข้ารอบสำรอง และแปลง stock (ตัวนับคงเหลือแบบเก่า) มาเป็นเพดานโควตาต่อรอบ
    // ราคายังคงใช้ price บาทเดิมได้ เพราะ getPriceBreakdown มี fallback ให้อยู่แล้ว
    function migrateProductsToRounds() {
        const products = getJSON(STORAGE_KEYS.PRODUCTS, null);
        if (!Array.isArray(products)) return;

        let changed = false;
        products.forEach(function (p) {
            if (!p.roundId) {
                p.roundId = 'round-legacy';
                changed = true;
            }
            if (p.quotaPerRound === undefined) {
                p.quotaPerRound = (typeof p.stock === 'number') ? p.stock : null;
                changed = true;
            }
        });

        if (changed) setJSON(STORAGE_KEYS.PRODUCTS, products);
    }

    // ออเดอร์ที่ค้างอยู่ใน localStorage จากเวอร์ชันก่อนมีแต่ข้อความไทย ยังไม่มี statusCode
    // เติม code ให้ครั้งเดียวแล้วปรับข้อความให้ตรงกับตาราง เพื่อให้ทั้งระบบอ่านค่าเดียวกัน
    function migrateOrderStatuses() {
        const orders = getJSON(STORAGE_KEYS.ORDERS, null);
        if (!Array.isArray(orders)) return;

        let changed = false;
        orders.forEach(function (o) {
            if (!o.statusCode || !ORDER_STATUS[o.statusCode]) {
                o.statusCode = guessStatusCode(o.status);
                o.status = ORDER_STATUS[o.statusCode].text;
                changed = true;
            }
        });

        if (changed) setJSON(STORAGE_KEYS.ORDERS, orders);
    }

    initStore();

    // Store API
    const KpopStore = {
        // --- Products ---
        getProducts() {
            return getJSON(STORAGE_KEYS.PRODUCTS, DEFAULT_PRODUCTS);
        },
        getProductById(id) {
            return this.getProducts().find(p => p.id === id);
        },
        // คืน { success, products, message } — ผู้เรียกต้องเช็ค success ก่อนแจ้งผู้ใช้ว่าบันทึกแล้ว
        // เพราะรูปสินค้าที่อัปโหลดอาจทำให้ localStorage เต็มและเขียนไม่ลง
        async saveProduct(product) {
            if (HAS_API) {
                // รูปที่เพิ่งย่อมาใหม่เป็น data URL ต้องอัปโหลดเป็นไฟล์ก่อน แล้วเก็บแค่ path
                // ถ้าเป็น path เดิมอยู่แล้ว uploadImage คืนค่าเดิมกลับมาโดยไม่ยิงคำขอ
                const up = await global.KpopApi.uploadImage(product.image, 'product');
                if (!up.success) {
                    return { success: false, products: this.getProducts(), message: up.message };
                }

                const res = await apiWrite('products.php?action=save',
                    Object.assign({}, product, { image: up.path }));
                return { success: !!res.success, products: this.getProducts(), message: res.message || '' };
            }

            const products = this.getProducts();
            const index = products.findIndex(p => p.id === product.id);
            if (index >= 0) {
                products[index] = { ...products[index], ...product };
            } else {
                products.push(product);
            }

            if (!setJSON(STORAGE_KEYS.PRODUCTS, products)) {
                return { success: false, products: this.getProducts(), message: STORAGE_FULL_MESSAGE };
            }

            return { success: true, products: products, message: '' };
        },
        // เขียนทับสินค้าทั้งชุดรวดเดียว — ไม่มีหน้าไหนเรียกใช้ และไม่มี endpoint รองรับ
        // เก็บไว้ให้ชุดทดสอบเท่านั้น ถ้าเผลอเรียกในเบราว์เซอร์ต้องรู้ตัวทันที
        // ไม่ใช่เขียนลง CACHE เงียบ ๆ แล้วหายไปตอนรีเฟรช
        saveProducts(products) {
            if (HAS_API) {
                return { success: false, products: this.getProducts(),
                         message: 'saveProducts ใช้กับฐานข้อมูลไม่ได้ กรุณาใช้ saveProduct ทีละรายการค่ะ' };
            }
            if (!Array.isArray(products)) {
                return { success: false, products: this.getProducts(), message: 'ข้อมูลสินค้าไม่ถูกต้อง' };
            }
            if (!setJSON(STORAGE_KEYS.PRODUCTS, products)) {
                return { success: false, products: this.getProducts(), message: STORAGE_FULL_MESSAGE };
            }
            return { success: true, products: products, message: '' };
        },

        // ป้ายสถานะสินค้า (PRE-ORDER / OUT OF STOCK) ที่แอดมินตั้งในฟอร์ม
        // เดิมเป็นแค่ป้ายสีบนการ์ด ไม่มีใครอ่านค่านี้ไปตัดสินอะไรเลย
        // ทั้งที่ข้อความตอนลบสินค้าไม่สำเร็จบอกแอดมินว่า "ถ้าจะปิดการขายให้เปลี่ยนเป็น OUT OF STOCK"
        // — คำแนะนำนั้นจึงเป็นข้อมูลผิดมาตลอด ตอนนี้ทำให้เป็นจริงแล้ว
        isProductSellable(productOrId) {
            const p = (typeof productOrId === 'object') ? productOrId : this.getProductById(productOrId);
            if (!p) return false;
            return String(p.status || '').toUpperCase() !== 'OUT OF STOCK';
        },

        // โควตาคงเหลือคำนวณสดจากออเดอร์ในรอบปัจจุบัน ไม่ใช่ตัวนับที่เขียนทับไปเรื่อย ๆ
        // วิธีนี้แก้ 3 อาการของเดิมพร้อมกัน:
        //   1. โควตาไม่เคยรีเซ็ตข้ามรอบ (สินค้าตายถาวรเมื่อขายครบเพดาน)
        //   2. rejectPayment ไม่คืนโควตา ทำให้ของค้างระบบตลอดกาล
        //   3. ตัวเลขเพี้ยนถ้าเขียนทับซ้อนกัน
        // คืน null = รับไม่จำกัด
        getRemainingQuota(productId) {
            const p = this.getProductById(productId);
            if (!p) return 0;

            const cap = Number(p.quotaPerRound);
            if (p.quotaPerRound === null || p.quotaPerRound === undefined || !isFinite(cap)) return null;

            return Math.max(0, cap - this.getUsedQuota(productId));
        },

        // จำนวนที่ถูกจองไปแล้วในรอบปัจจุบันของสินค้านี้
        // แยกออกมาจาก getRemainingQuota เพราะฟอร์มแอดมินต้องรู้ "ยอดที่จองไปแล้ว" ตรง ๆ
        // เพื่อเตือนตอนตั้งเพดานต่ำกว่ายอดจริง ซึ่งตัวเลข "คงเหลือ" บอกไม่ได้ (ถูกตัดที่ 0)
        getUsedQuota(productId) {
            const p = this.getProductById(productId);
            if (!p) return 0;

            return this.getOrders()
                .filter(o => o.roundId === p.roundId && this.isQuotaConsuming(o))
                .reduce((sum, o) => sum + (o.items || [])
                    .filter(i => String(i.id) === String(productId))
                    .reduce((s, i) => s + (Number(i.qty) || 0), 0), 0);
        },

        // ออเดอร์ที่ยังอยู่ในกระบวนการและอ้างถึงสินค้านี้
        // ใช้กันไม่ให้ลบสินค้าที่ลูกค้ายังรอของอยู่ จนราคาและโควตาในระบบเพี้ยน
        //
        // ใช้ isQuotaConsuming ตรง ๆ ไม่ได้ เพราะใบที่ "จัดส่งสำเร็จ" ยังกินโควตาของรอบอยู่
        // (ถูกต้องแล้วสำหรับการนับโควตา) แต่จบธุระกับลูกค้าไปแล้ว ไม่ควรกันการลบสินค้าตลอดกาล
        // เกณฑ์ "ค้าง" ที่นี่คือ ลูกค้ายังรอของอยู่จริง = กลุ่ม pending/processing หรือกำลังส่งของ
        isOrderInProgress(orderOrCode) {
            const group = this.getStatusGroup(orderOrCode);
            return group === 'pending' || group === 'processing' ||
                this.getStatusCode(orderOrCode) === 'SHIPPING';
        },

        getActiveOrdersForProduct(productId) {
            return this.getOrders().filter(o =>
                this.isOrderInProgress(o) &&
                (o.items || []).some(i => String(i.id) === String(productId))
            );
        },

        // --- Quantity ---
        // แปลงจำนวนที่ผู้ใช้กรอก (หรือแก้มาจาก URL) ให้เป็นจำนวนเต็มบวกเสมอ
        // ถ้าไม่ล้างค่าตรงนี้ จำนวนติดลบจะทำให้ยอดเงินติดลบ และทำให้โควตาพรีออเดอร์ "เพิ่มขึ้น" แทนที่จะลด
        normalizeQty(value, max) {
            const num = Math.floor(Number(value));
            const limit = Math.floor(Number(max));
            const hasLimit = isFinite(limit) && limit >= 1;

            // ค่าขยะ / ติดลบ / ศูนย์ → 1
            if (Number.isNaN(num) || num < 1) return 1;
            // มีเพดาน → ตัดที่เพดาน (ครอบคลุมค่ามหาศาลอย่าง Infinity ด้วย)
            if (hasLimit) return Math.min(num, limit);
            // ไม่มีเพดานแต่ค่าไม่จำกัด → ถือเป็นค่าขยะ
            return isFinite(num) ? num : 1;
        },
        // คืน { success, products, message } — ผู้เรียกต้องเช็ค success ก่อนแจ้งว่าลบแล้ว
        // ลบสินค้าที่ยังมีออเดอร์ค้างอยู่ไม่ได้ เพราะออเดอร์นั้นจะอ้างถึงสินค้าที่ไม่มีตัวตน
        // ทำให้โควตาอ่านได้ 0 และราคากลายเป็น ฿0 ทั้งที่ลูกค้ายังรอของอยู่
        async deleteProduct(id) {
            if (HAS_API) {
                const res = await apiWrite('products.php?action=delete', { id: id });
                return { success: !!res.success, products: this.getProducts(), message: res.message || '' };
            }

            const blocking = this.getActiveOrdersForProduct(id);
            if (blocking.length > 0) {
                const codes = blocking.map(o => o.id).join(', ');
                return {
                    success: false,
                    products: this.getProducts(),
                    message: `ลบไม่ได้ เพราะยังมีคำสั่งซื้อค้างอยู่ ${blocking.length} รายการ\n` +
                        `เลขที่: ${codes}\n\n` +
                        'ถ้าต้องการปิดการขาย ให้แก้สินค้าแล้วเปลี่ยนป้ายสถานะเป็น OUT OF STOCK แทน\n' +
                        'ข้อมูลของลูกค้าที่สั่งไว้แล้วจะได้ไม่เสียหาย'
                };
            }

            const products = this.getProducts().filter(p => p.id !== id);
            if (!setJSON(STORAGE_KEYS.PRODUCTS, products)) {
                return { success: false, products: this.getProducts(), message: STORAGE_FULL_MESSAGE };
            }

            return { success: true, products: products, message: '' };
        },

        // --- Storage ---
        // รวมขนาดเฉพาะคีย์ของระบบนี้ เพื่อให้แอดมินเห็นว่าใกล้เต็มหรือยัง
        // นับเป็นจำนวนอักขระ (UTF-16 ใช้ 2 ไบต์/ตัว แต่เบราว์เซอร์คิดโควตาต่างกันไป
        // ตัวเลขนี้จึงเป็นค่าประมาณสำหรับเตือนล่วงหน้า ไม่ใช่ค่าที่แม่นยำระดับไบต์)
        // เมื่อข้อมูลย้ายมาอยู่ใน MySQL แล้ว โควตา localStorage หมดความหมาย
        // การ์ดนี้จึงเปลี่ยนไปรายงานขนาดโฟลเดอร์ uploads/ แทน ซึ่งเป็นทรัพยากร
        // ที่โตขึ้นเรื่อย ๆ จริงจากสลิปและรูปสินค้าที่แอดมินอัปโหลด
        //
        // ค่าถูกดึงมาพร้อมกับ hydrate() ตอนเปิดหน้า จึงยังอ่านแบบ synchronous ได้
        // เหมือนเดิม ไม่ต้องแก้จุดที่เรียกในหน้า admin
        getStorageUsage() {
            if (HAS_API) {
                return uploadStats;
            }

            let bytes = 0;
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (!key || key.indexOf('kpop_') !== 0) continue;
                    bytes += key.length + (localStorage.getItem(key) || '').length;
                }
            } catch (e) {
                console.error('Error reading storage usage', e);
            }

            return {
                bytes: bytes,
                limit: STORAGE_LIMIT_BYTES,
                percent: Math.min(100, Math.round((bytes / STORAGE_LIMIT_BYTES) * 100))
            };
        },

        // --- Rounds ---
        getRounds() {
            return getJSON(STORAGE_KEYS.ROUNDS, DEFAULT_ROUNDS);
        },
        getRoundById(id) {
            return this.getRounds().find(r => r.id === id) || null;
        },
        // คืน { success, rounds, message } เช่นเดียวกับ saveProduct — ต้องเช็คก่อนแจ้งว่าสำเร็จ
        async saveRound(round) {
            if (HAS_API) {
                const res = await apiWrite('rounds.php?action=save', round);
                return { success: !!res.success, rounds: this.getRounds(), message: res.message || '' };
            }

            const rounds = this.getRounds();
            const index = rounds.findIndex(r => r.id === round.id);
            if (index >= 0) {
                rounds[index] = { ...rounds[index], ...round };
            } else {
                if (!round.id) round.id = 'round-' + Date.now();
                rounds.push(round);
            }
            if (!setJSON(STORAGE_KEYS.ROUNDS, rounds)) {
                return { success: false, rounds: this.getRounds(), message: STORAGE_FULL_MESSAGE };
            }
            return { success: true, rounds: rounds, message: '' };
        },
        async deleteRound(id) {
            if (HAS_API) {
                const res = await apiWrite('rounds.php?action=delete', { id: id });
                return { success: !!res.success, rounds: this.getRounds(), message: res.message || '' };
            }

            const rounds = this.getRounds().filter(r => r.id !== id);
            if (!setJSON(STORAGE_KEYS.ROUNDS, rounds)) {
                return { success: false, rounds: this.getRounds(), message: STORAGE_FULL_MESSAGE };
            }
            return { success: true, rounds: rounds, message: '' };
        },

        // สถานะรอบที่ใช้จริง = สถานะที่แอดมินตั้งไว้ ถ้ายังเป็น open ค่อยตัดสินจากช่วงวันที่
        // คืนค่า: upcoming | open | closed | ordered | arrived | shipped
        getRoundState(roundOrId) {
            const round = (typeof roundOrId === 'string') ? this.getRoundById(roundOrId) : roundOrId;
            if (!round) return 'closed';
            if (round.status && round.status !== 'open') return round.status;

            const today = formatDay();
            if (round.openAt && today < round.openAt) return 'upcoming';
            if (round.closeAt && today > round.closeAt) return 'closed';
            return 'open';
        },
        isRoundOpen(roundOrId) {
            return this.getRoundState(roundOrId) === 'open';
        },
        // สรุปยอดที่ต้องไปกดสั่งของรอบนั้น รวมจำนวนต่อสินค้าให้แอดมินถือไปกดทีเดียว
        getRoundSummary(roundId) {
            const orders = this.getOrders().filter(o => o.roundId === roundId && this.isQuotaConsuming(o));
            const byProduct = {};
            let grandTotal = 0;

            orders.forEach(o => {
                grandTotal += Number(o.total) || 0;
                (o.items || []).forEach(i => {
                    const key = String(i.id);
                    if (!byProduct[key]) {
                        byProduct[key] = { id: key, title: i.title, qty: 0, amountTHB: 0, priceKRW: Number(i.priceKRW) || 0 };
                    }
                    byProduct[key].qty += Number(i.qty) || 0;
                    byProduct[key].amountTHB += (Number(i.price) || 0) * (Number(i.qty) || 0);
                });
            });

            return {
                roundId,
                orderCount: orders.length,
                grandTotal,
                items: Object.keys(byProduct).map(k => byProduct[k]).sort((a, b) => b.qty - a.qty)
            };
        },

        // --- Exchange rate ---
        getRates() {
            const rates = getJSON(STORAGE_KEYS.RATES, DEFAULT_RATES);
            return rates.slice().sort((a, b) => String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)));
        },
        // เรทที่มีผล ณ เวลาหนึ่ง = รายการล่าสุดที่ effectiveFrom ไม่เกินเวลานั้น
        // (รูปแบบ 'YYYY-MM-DD HH:mm' เทียบเป็นสตริงได้ตรง ๆ)
        getRateAt(stamp) {
            const at = stamp || formatStamp();
            const rates = this.getRates();
            return rates.find(r => String(r.effectiveFrom) <= at) || rates[rates.length - 1] || DEFAULT_RATES[0];
        },
        getCurrentRate() {
            return this.getRateAt(formatStamp());
        },
        async setRate(rate, effectiveFrom, setBy, note) {
            const value = Number(rate);
            if (!isFinite(value) || value <= 0) {
                return { success: false, message: 'เรทต้องเป็นตัวเลขมากกว่า 0' };
            }

            if (HAS_API) {
                const res = await apiWrite('rates.php?action=add', {
                    rate: value,
                    effectiveFrom: effectiveFrom || this.getNextRateCutoff(),
                    setBy: setBy,
                    note: note || ''
                });
                return res.success
                    ? { success: true, rate: this.getRates()[0] }
                    : { success: false, message: res.message || 'บันทึกเรทไม่สำเร็จ' };
            }

            const rates = getJSON(STORAGE_KEYS.RATES, DEFAULT_RATES);
            const record = {
                rate: value,
                effectiveFrom: effectiveFrom || this.getNextRateCutoff(),
                setBy: setBy || 'admin',
                note: note || ''
            };
            rates.push(record);
            if (!setJSON(STORAGE_KEYS.RATES, rates)) {
                return { success: false, message: STORAGE_FULL_MESSAGE };
            }

            return { success: true, rate: record };
        },
        // จุดตัด 22:00 ถัดไป — ถ้าตอนนี้ยังไม่ถึง 22:00 ก็คือ 22:00 ของวันนี้
        getNextRateCutoff() {
            const now = new Date();
            const cutoff = new Date();
            cutoff.setHours(RATE_CUTOFF_HOUR, 0, 0, 0);
            if (cutoff <= now) cutoff.setDate(cutoff.getDate() + 1);
            return formatStamp(cutoff);
        },

        // --- Pricing ---
        // ราคาบาท = (ราคาวอน x เรท) + ค่าบริการหิ้ว
        // ปัดเศษส่วนที่แปลงจากวอนขึ้นเสมอ เพื่อไม่ให้ร้านขาดทุนจากเศษสตางค์
        getPriceBreakdown(productOrId, rate) {
            const p = (typeof productOrId === 'object') ? productOrId : this.getProductById(productOrId);
            if (!p) return null;

            const rateValue = (typeof rate === 'number' && rate > 0) ? rate : this.getCurrentRate().rate;
            const krw = Number(p.priceKRW);
            const serviceFee = Number(p.serviceFee) || 0;

            // สินค้าที่ยังไม่ได้กรอกราคาวอน (ข้อมูลเก่า) ให้ใช้ราคาบาทเดิมไปก่อน
            if (!isFinite(krw) || krw <= 0) {
                const legacyTHB = Number(p.price) || 0;
                return { krw: null, rate: rateValue, converted: legacyTHB, serviceFee: 0, total: legacyTHB, legacy: true };
            }

            const converted = Math.ceil(krw * rateValue);
            return { krw, rate: rateValue, converted, serviceFee, total: converted + serviceFee, legacy: false };
        },
        getPriceTHB(productOrId, rate) {
            const breakdown = this.getPriceBreakdown(productOrId, rate);
            return breakdown ? breakdown.total : 0;
        },

        // --- Users ---
        getUsers() {
            return getJSON(STORAGE_KEYS.USERS, DEFAULT_USERS);
        },
        getUserByEmail(email) {
            return this.getUsers().find(u => u.email.toLowerCase() === (email || '').toLowerCase());
        },
        // คืน { success, users, message } — ผู้เรียกต้องเช็ค success ก่อนแจ้งว่าบันทึกแล้ว
        //
        // อีเมลคือคีย์ที่ใช้ผูกออเดอร์กับเจ้าของ (o.customerEmail) จึงห้ามซ้ำเด็ดขาด
        // ของเดิมจับคู่ด้วย id "หรือ" อีเมล แล้ว merge ทับทันที ผลคือสมัครสมาชิกด้วยอีเมล
        // ที่มีคนใช้แล้วจะเขียนทับบัญชีเดิมทั้งใบ (สมัครด้วย admin@kpopstore.com = ยึดบัญชีแอดมิน)
        async saveUser(user) {
            if (HAS_API) {
                const res = await apiWrite('users.php?action=save', user);
                return {
                    success: !!res.success,
                    users: this.getUsers(),
                    message: res.message || '',
                    defaultPassword: res.defaultPassword
                };
            }

            const users = this.getUsers();
            const email = String(user.email || '').toLowerCase();

            // เทียบด้วย id ก่อนเสมอ เพื่อให้การแก้โปรไฟล์ตัวเอง (updateProfile ส่ง id เดิมมา)
            // ไม่ไปติดด่านอีเมลซ้ำของตัวเอง
            const index = users.findIndex(u => u.id === user.id);
            const emailOwner = users.find(u => String(u.email || '').toLowerCase() === email);

            if (emailOwner && emailOwner.id !== user.id) {
                return {
                    success: false,
                    users: users,
                    message: `อีเมล ${user.email} ถูกใช้งานโดยบัญชีอื่นอยู่แล้ว กรุณาใช้อีเมลอื่นค่ะ`
                };
            }

            if (index >= 0) {
                users[index] = { ...users[index], ...user };
            } else {
                if (!user.id) user.id = 'u-' + Date.now();
                users.push(user);
            }

            if (!setJSON(STORAGE_KEYS.USERS, users)) {
                return { success: false, users: this.getUsers(), message: STORAGE_FULL_MESSAGE };
            }

            return { success: true, users: users, message: '' };
        },
        async deleteUser(userId) {
            if (HAS_API) {
                const res = await apiWrite('users.php?action=delete', { id: userId });
                return { success: !!res.success, users: this.getUsers(), message: res.message || '' };
            }

            const users = this.getUsers().filter(u => u.id !== userId);
            if (!setJSON(STORAGE_KEYS.USERS, users)) {
                return { success: false, users: this.getUsers(), message: STORAGE_FULL_MESSAGE };
            }

            // ถ้าลบบัญชีที่กำลังล็อกอินอยู่ ต้องเตะออกจากระบบด้วย
            // ไม่งั้น session จะยังถือ user ที่ไม่มีตัวตนแล้วไปเรื่อย ๆ
            const current = this.getCurrentUser();
            if (current && current.id === userId) {
                setJSON(STORAGE_KEYS.CURRENT_USER, null);
            }

            return { success: true, users: users, message: '' };
        },

        // --- Auth & Session ---
        getCurrentUser() {
            return getJSON(STORAGE_KEYS.CURRENT_USER, null);
        },
        // ในเบราว์เซอร์: ตรวจรหัสผ่านจริงที่เซิร์ฟเวอร์ด้วย password_verify()
        // กับ hash ที่เก็บใน MySQL — ไม่มีการสร้างบัญชีอัตโนมัติอีกแล้ว
        //
        // โค้ดใต้บรรทัด HAS_API เป็นโหมด demo เดิม เหลือไว้ให้ชุดทดสอบใน Node ใช้
        // (ทดสอบตรรกะอย่าง "บัญชีที่สร้างอัตโนมัติต้องไม่ได้สิทธิ์แอดมิน" ต่อได้)
        async login(email, password) {
            if (HAS_API) {
                const res = await apiWrite('auth.php?action=login', { email, password });
                return res.success
                    ? { success: true, user: res.user }
                    : { success: false, message: res.message || 'เข้าสู่ระบบไม่สำเร็จ' };
            }

            // Admin simulation login
            if (email === 'admin@kpopstore.com' && (password === 'admin123' || password === 'admin')) {
                const adminUser = this.getUsers().find(u => u.role === 'admin') || DEFAULT_USERS[0];
                setJSON(STORAGE_KEYS.CURRENT_USER, adminUser);
                return { success: true, user: adminUser };
            }

            const users = this.getUsers();
            const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
            if (user) {
                setJSON(STORAGE_KEYS.CURRENT_USER, user);
                return { success: true, user: user };
            }

            // If user doesn't exist, auto create customer for convenience in demo
            // role เป็น customer เสมอ — เดิมใช้ email.includes('admin') ตัดสิน
            // ใครก็ตามที่พิมพ์อีเมลอย่าง myadmin@x.com จึงได้สิทธิ์แอดมินฟรี ๆ
            const newUser = {
                id: 'u-' + Date.now(),
                name: email.split('@')[0],
                email: email,
                phone: '081-000-0000',
                address: '123 ถนนตัวอย่าง แขวงปทุมวัน เขตปทุมวัน กรุงเทพฯ',
                role: 'customer',
                createdAt: formatDay()
            };

            const saved = await this.saveUser(newUser);
            if (!saved.success) return { success: false, message: saved.message };

            setJSON(STORAGE_KEYS.CURRENT_USER, newUser);
            return { success: true, user: newUser };
        },

        /**
         * สมัครสมาชิก (ของใหม่ — เดิมหน้า register เรียก saveUser แล้วต่อด้วย login)
         * ตอนนี้ต้องมีรหัสผ่านจริง จึงต้องเป็นคำสั่งเดียวที่ฝั่งเซิร์ฟเวอร์
         * สร้างบัญชี + ตั้ง hash + เปิด session ให้ในคราวเดียว
         */
        async register(user, password) {
            if (HAS_API) {
                const res = await apiWrite('auth.php?action=register', {
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    address: user.address,
                    password: password
                });
                return res.success
                    ? { success: true, user: res.user, message: '' }
                    : { success: false, message: res.message || 'สมัครสมาชิกไม่สำเร็จ' };
            }

            // โหมดทดสอบ: ไม่มีรหัสผ่านให้เก็บ ใช้เส้นทางเดิม
            const saved = await this.saveUser(user);
            if (!saved.success) return { success: false, message: saved.message };

            setJSON(STORAGE_KEYS.CURRENT_USER, user);
            return { success: true, user: user, message: '' };
        },

        // ล้าง session อย่างเดียว ไม่ยุ่งกับหน้าจอ — ส่วนที่ alert และเปลี่ยนหน้าอยู่ใน ui.js
        async clearSession() {
            if (HAS_API) {
                const res = await global.KpopApi.post('auth.php?action=logout', {});
                CACHE[STORAGE_KEYS.CURRENT_USER] = null;
                CACHE[STORAGE_KEYS.CART] = [];
                CACHE[STORAGE_KEYS.NOTIFICATIONS] = [];
                return !!(res && res.success);
            }
            return setJSON(STORAGE_KEYS.CURRENT_USER, null);
        },
        async updateProfile(updatedData) {
            let currentUser = this.getCurrentUser();
            if (!currentUser) return { success: false, message: 'กรุณาเข้าสู่ระบบก่อนค่ะ' };

            if (HAS_API) {
                const res = await apiWrite('auth.php?action=profile', {
                    name: updatedData.name,
                    phone: updatedData.phone,
                    address: updatedData.address
                });
                return res.success
                    ? { success: true, user: res.user, message: '' }
                    : { success: false, message: res.message || 'บันทึกไม่สำเร็จ' };
            }

            currentUser = { ...currentUser, ...updatedData };

            // ต้องเช็คก่อนบอกว่าบันทึกแล้ว — อาจติดอีเมลซ้ำหรือพื้นที่เต็ม
            const saved = await this.saveUser(currentUser);
            if (!saved.success) return { success: false, message: saved.message };

            if (!setJSON(STORAGE_KEYS.CURRENT_USER, currentUser)) {
                return { success: false, message: STORAGE_FULL_MESSAGE };
            }

            return { success: true, user: currentUser };
        },
        // --- Order status ---
        // ทุกที่ในระบบต้องถามสถานะผ่านชุดนี้ ห้ามเทียบข้อความไทยเองอีก
        ORDER_STATUS: ORDER_STATUS,

        // รับได้ทั้ง order object, statusCode หรือข้อความไทยเดิม (เผื่อข้อมูลเก่าที่ยังไม่ถูก migrate)
        getStatusMeta(orderOrCode) {
            if (orderOrCode && typeof orderOrCode === 'object') {
                return ORDER_STATUS[orderOrCode.statusCode] || ORDER_STATUS[guessStatusCode(orderOrCode.status)];
            }
            const key = String(orderOrCode || '');
            return ORDER_STATUS[key] || ORDER_STATUS[guessStatusCode(key)];
        },
        getStatusCode(orderOrCode) {
            if (orderOrCode && typeof orderOrCode === 'object') {
                return ORDER_STATUS[orderOrCode.statusCode] ? orderOrCode.statusCode : guessStatusCode(orderOrCode.status);
            }
            const key = String(orderOrCode || '');
            return ORDER_STATUS[key] ? key : guessStatusCode(key);
        },
        getStatusText(orderOrCode) {
            return this.getStatusMeta(orderOrCode).text;
        },
        getStatusGroup(orderOrCode) {
            return this.getStatusMeta(orderOrCode).group;
        },
        isQuotaConsuming(orderOrCode) {
            return this.getStatusMeta(orderOrCode).quota;
        },
        countsAsRevenue(orderOrCode) {
            return this.getStatusMeta(orderOrCode).revenue;
        },
        canCancelOrder(orderOrCode) {
            return this.getStatusMeta(orderOrCode).canCancel;
        },
        canReuploadSlip(orderOrCode) {
            return this.getStatusMeta(orderOrCode).canReuploadSlip;
        },
        // ใช้สร้าง dropdown / แผงสัดส่วนในหน้าแอดมิน แทนการ hardcode รายชื่อสถานะ
        listStatuses() {
            return Object.keys(ORDER_STATUS).map(function (code) {
                return Object.assign({ code: code }, ORDER_STATUS[code]);
            });
        },
        // เขียนสถานะลงออเดอร์ให้ statusCode กับ status ตรงกันเสมอ
        applyStatus(order, statusCodeOrText) {
            const code = ORDER_STATUS[statusCodeOrText] ? statusCodeOrText : guessStatusCode(statusCodeOrText);
            order.statusCode = code;
            order.status = ORDER_STATUS[code].text;
            return code;
        },

        // --- Orders ---
        getOrders() {
            return getJSON(STORAGE_KEYS.ORDERS, DEFAULT_ORDERS);
        },
        getOrderById(id) {
            return this.getOrders().find(o => o.id === id);
        },
        // ลบออเดอร์ถาวร ใช้สำหรับล้างข้อมูลเก่าเพื่อคืนพื้นที่ localStorage
        // (สลิปที่แนบมาเป็น base64 ทำให้ออเดอร์เป็นข้อมูลที่กินพื้นที่มากที่สุดในระบบ)
        // โควตาของสินค้าคืนเองอัตโนมัติ เพราะ getRemainingQuota คำนวณสดจากออเดอร์ที่เหลืออยู่
        async deleteOrder(orderId) {
            if (HAS_API) {
                const res = await apiWrite('orders.php?action=delete', { orderId: orderId });
                return { success: !!res.success, orders: this.getOrders(), message: res.message || '' };
            }

            const orders = this.getOrders();
            const remaining = orders.filter(o => o.id !== orderId);

            if (remaining.length === orders.length) {
                return { success: false, orders: orders, message: 'ไม่พบคำสั่งซื้อนี้ในระบบ' };
            }

            if (!setJSON(STORAGE_KEYS.ORDERS, remaining)) {
                return {
                    success: false,
                    orders: this.getOrders(),
                    message: 'พื้นที่เก็บข้อมูลของเบราว์เซอร์มีปัญหา ลบไม่สำเร็จ'
                };
            }

            return { success: true, orders: remaining, message: '' };
        },
        async addOrder(orderData) {
            if (HAS_API) {
                // สลิปที่เพิ่งย่อมาเป็น data URL ต้องกลายเป็นไฟล์จริงก่อนบันทึกออเดอร์
                const up = await global.KpopApi.uploadImage(orderData.slipImage, 'slip');
                if (!up.success) {
                    return { success: false, order: null, message: up.message };
                }

                // ส่งแค่ id กับ qty ไป — ราคาและยอดรวมให้เซิร์ฟเวอร์คิดใหม่จากฐานข้อมูล
                // ไม่เชื่อตัวเลขที่มาจากเบราว์เซอร์ เพราะเป็นข้อมูลเรื่องเงิน
                const res = await apiWrite('orders.php?action=create', {
                    items: (orderData.items || []).map(i => ({ id: i.id, qty: i.qty })),
                    customerName: orderData.customerName,
                    phone: orderData.phone,
                    address: orderData.address,
                    shippingFee: orderData.shippingFee,
                    slipImage: up.path
                });

                return res.success
                    ? { success: true, order: res.order, message: '' }
                    : { success: false, order: null, message: res.message || 'บันทึกคำสั่งซื้อไม่สำเร็จ' };
            }

            const orders = this.getOrders();
            const now = new Date();
            const dateStr = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0') + ' ' +
                String(now.getHours()).padStart(2, '0') + ':' +
                String(now.getMinutes()).padStart(2, '0');

            const orderId = 'ORD-' + now.getFullYear() +
                String(now.getMonth() + 1).padStart(2, '0') +
                String(now.getDate()).padStart(2, '0') +
                Math.floor(100 + Math.random() * 900);

            const newOrder = {
                id: orderId,
                date: dateStr,
                statusCode: 'PENDING_SLIP',
                trackingNumber: '',
                adminNotes: 'ลูกค้าส่งสลิปแจ้งชำระเงินแล้ว',
                ...orderData
            };

            // ล็อกให้ statusCode กับ status ตรงกันเสมอ แม้ผู้เรียกจะส่ง status มาเองใน orderData
            this.applyStatus(newOrder, newOrder.statusCode || newOrder.status);

            // === จุดล็อกราคา ===
            // addOrder ถูกเรียกตอนลูกค้าแนบสลิปแล้ว จึงเป็นจุดที่ "แช่แข็ง" เรทและราคาบาท
            // หลังจากนี้เรทเงินวอนจะขยับยังไงก็ไม่กระทบยอดของออเดอร์ใบนี้อีก
            const lockedRate = this.getCurrentRate();
            newOrder.rateUsed = lockedRate.rate;
            newOrder.rateLockedAt = dateStr;

            // ล้างจำนวนสินค้าให้เป็นจำนวนเต็มบวกก่อนบันทึก แล้วคำนวณยอดเงินใหม่จากค่าที่ล้างแล้ว
            // เพื่อไม่ให้ค่าที่ผู้ใช้แก้มาจาก URL (เช่น ?qty=-5) ทำให้ยอดเงินติดลบ
            if (Array.isArray(newOrder.items)) {
                newOrder.items = newOrder.items.map(item => {
                    const qty = this.normalizeQty(item.qty);
                    const product = this.getProductById(item.id);
                    // คิดราคาจากวอน x เรทที่ล็อกไว้ ถ้าหาสินค้าไม่เจอ (ถูกลบ) ใช้ราคาที่ผู้เรียกส่งมา
                    const breakdown = product ? this.getPriceBreakdown(product, lockedRate.rate) : null;
                    return {
                        ...item,
                        qty: qty,
                        price: breakdown ? breakdown.total : (Number(item.price) || 0),
                        priceKRW: breakdown ? breakdown.krw : (Number(item.priceKRW) || null),
                        serviceFee: breakdown ? breakdown.serviceFee : (Number(item.serviceFee) || 0)
                    };
                });

                const shippingFee = (typeof newOrder.shippingFee === 'number' && newOrder.shippingFee >= 0)
                    ? newOrder.shippingFee
                    : 50;
                const subtotal = newOrder.items.reduce(
                    (sum, i) => sum + (Number(i.price) || 0) * i.qty, 0
                );

                newOrder.shippingFee = shippingFee;
                newOrder.subtotal = subtotal;
                newOrder.total = subtotal + shippingFee;
            }

            // ผูกออเดอร์เข้ารอบของสินค้าชิ้นแรก
            // (ตะกร้าเช็คเอาต์แยกตามรอบอยู่แล้ว ทุกชิ้นในออเดอร์เดียวจึงอยู่รอบเดียวกันเสมอ)
            if (!newOrder.roundId) {
                const firstItem = (newOrder.items || [])[0];
                const firstProduct = firstItem ? this.getProductById(firstItem.id) : null;
                newOrder.roundId = (firstProduct && firstProduct.roundId) || 'round-legacy';
            }

            orders.unshift(newOrder);

            // จุดที่ห้ามพลาดที่สุดของทั้งระบบ:
            // ลูกค้าโอนเงินมาแล้วจริง ๆ ก่อนจะมาถึงบรรทัดนี้ ถ้าเขียนไม่ลงแล้วเรายังบอกว่า
            // "สั่งซื้อสำเร็จ" ออเดอร์จะหายไปตอนรีเฟรชโดยที่เงินออกจากบัญชีลูกค้าไปแล้ว
            // (สลิป base64 คือตัวที่ทำให้ localStorage เต็มได้จริง)
            if (!setJSON(STORAGE_KEYS.ORDERS, orders)) {
                return { success: false, order: null, message: STORAGE_FULL_MESSAGE };
            }

            // ไม่ต้องตัดโควตาตรงนี้แล้ว — getRemainingQuota คำนวณสดจากออเดอร์ในรอบ
            // พอออเดอร์ถูกบันทึกไป โควตาก็ลดเองโดยอัตโนมัติ

            // ไม่ล้างตะกร้าที่นี่ — ปุ่ม "สั่งซื้อทันที" ไม่ได้ผ่านตะกร้า
            // ถ้าล้างตรงนี้ ของที่ลูกค้าเก็บไว้ในตะกร้ารอบอื่นจะหายไปด้วย
            // หน้า checkout เป็นคนเรียก clearCartRound() เองหลังเช็คเอาต์จากตะกร้าสำเร็จ

            // Notify Admin
            this.addNotification({
                userEmail: 'admin@kpopstore.com',
                title: `มีคำสั่งซื้อใหม่ #${orderId}`,
                message: `ลูกค้า ${newOrder.customerName} ส่งสลิปชำระเงินจำนวน ฿${(Number(newOrder.total) || 0).toLocaleString()} บาท`
            });

            // Notify Customer
            this.addNotification({
                userEmail: newOrder.customerEmail,
                title: `ส่งหลักฐานชำระเงินเรียบร้อย #${orderId}`,
                message: `ขอบคุณสำหรับการสั่งซื้อ ระบบกำลังเสนอสลิปชำระเงินให้ผู้ดูแลระบบตรวจสอบค่ะ`
            });

            return { success: true, order: newOrder, message: '' };
        },
        async cancelOrderCustomer(orderId, cancelReason = 'ยกเลิกโดยลูกค้า') {
            if (HAS_API) {
                const res = await apiWrite('orders.php?action=cancel',
                    { orderId: orderId, reason: cancelReason });
                return res.success
                    ? { success: true, order: res.order }
                    : { success: false, message: res.message || 'ยกเลิกไม่สำเร็จ' };
            }

            const orders = this.getOrders();
            const order = orders.find(o => o.id === orderId);
            if (!order) return { success: false, message: 'ไม่พบคำสั่งซื้อ' };

            const meta = this.getStatusMeta(order);
            if (!meta.canCancel) {
                if (meta.group === 'cancelled') {
                    return { success: false, message: 'คำสั่งซื้อนี้ถูกยกเลิกไปแล้ว' };
                }
                return { success: false, message: 'ไม่สามารถยกเลิกได้เนื่องจากพัสดุถูกจัดส่งออกไปแล้ว กรุณาติดต่อผู้ดูแลระบบค่ะ' };
            }

            this.applyStatus(order, 'CANCELLED_USER');
            order.adminNotes = `ลูกค้ายกเลิกคำสั่งซื้อ: ${cancelReason}`;
            order.cancelledAt = formatStamp();

            if (!setJSON(STORAGE_KEYS.ORDERS, orders)) {
                return { success: false, message: STORAGE_FULL_MESSAGE };
            }

            // ไม่ต้องคืนโควตาเอง — พอสถานะกลายเป็น CANCELLED_USER (quota = false)
            // getRemainingQuota จะไม่นับออเดอร์นี้อีก โควตาจึงคืนเข้าระบบทันที

            this.addNotification({
                userEmail: 'admin@kpopstore.com',
                title: `ลูกค้ายกเลิกคำสั่งซื้อ #${orderId}`,
                message: `ลูกค้า ${order.customerName} ได้ทำการยกเลิกคำสั่งซื้อ #${orderId} (เหตุผล: ${cancelReason})`
            });

            this.addNotification({
                userEmail: order.customerEmail,
                title: `ยกเลิกคำสั่งซื้อเรียบร้อย #${orderId}`,
                message: `ยกเลิกคำสั่งซื้อ #${orderId} เรียบร้อยแล้ว`
            });

            return { success: true, order };
        },
        // ย่อรูปก่อนเก็บลง localStorage เพราะพื้นที่มีจำกัด (ประมาณ 5MB ต่อ origin)
        // options: { maxWidth, maxHeight, quality }
        // callback(dataUrl) — ได้ null ถ้าอ่านไฟล์ไม่สำเร็จ
        compressImage(file, options, callback) {
            if (!file) return callback(null);

            const opts = options || {};
            const maxWidth = opts.maxWidth || 900;
            const maxHeight = opts.maxHeight || 1200;
            const quality = (typeof opts.quality === 'number') ? opts.quality : 0.75;

            const reader = new FileReader();
            reader.onload = function (e) {
                const img = new Image();
                img.onload = function () {
                    let width = img.width;
                    let height = img.height;

                    // ย่อตามด้านที่ยาวกว่า เพื่อคงสัดส่วนเดิมไว้
                    if (width > height) {
                        if (width > maxWidth) {
                            height *= maxWidth / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width *= maxHeight / height;
                            height = maxHeight;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    canvas.getContext('2d').drawImage(img, 0, 0, width, height);

                    callback(canvas.toDataURL('image/jpeg', quality));
                };
                // ไฟล์ที่เบราว์เซอร์ decode เป็นรูปไม่ได้ (เช่นเลือก PDF มา) จะเข้าทางนี้
                img.onerror = function () {
                    callback(null);
                };
                img.src = e.target.result;
            };
            reader.onerror = function () {
                callback(null);
            };
            reader.readAsDataURL(file);
        },

        // สลิปเป็นรูปแนวตั้ง ต้องอ่านตัวเลขออก จึงให้ความสูงเยอะกว่า
        compressSlipImage(file, callback) {
            return this.compressImage(file, { maxWidth: 900, maxHeight: 1200, quality: 0.75 }, callback);
        },

        // รูปสินค้าแสดงเป็นการ์ดจัตุรัส (object-fit: cover) 800x800 จึงพอ
        compressProductImage(file, callback) {
            return this.compressImage(file, { maxWidth: 800, maxHeight: 800, quality: 0.8 }, callback);
        },
        // เขียนสถานะลงออเดอร์แล้วบันทึก "โดยไม่ยิงแจ้งเตือน"
        // แยกออกมาเพื่อให้ flow ที่ต้องเปลี่ยนสถานะหลายทอด (เช่น markPurchaseFailed)
        // ไม่ยิงแจ้งเตือนซ้ำซ้อนให้ลูกค้าทีละ 3 ใบต่อเหตุการณ์เดียว
        //
        // ฟิลด์ที่เป็น undefined = "ไม่ได้ส่งมา ไม่ต้องแตะ"
        // ฟิลด์ที่เป็นสตริงว่าง = "ตั้งใจล้างค่า" (แอดมินลบเลขพัสดุที่พิมพ์ผิดออก)
        // เดิมใช้ `if (trackingNumber)` ทำให้ล้างค่าไม่ได้เลย ต้องอยู่กับเลขพัสดุผิด ๆ ตลอดไป
        _writeOrderStatus(orderId, status, fields) {
            const orders = this.getOrders();
            const order = orders.find(o => o.id === orderId);
            if (!order) return null;

            const f = fields || {};
            this.applyStatus(order, status);

            // เขียนทุกฟิลด์ที่ส่งมาแบบทั่วไป ไม่ไล่เช็คทีละชื่อ
            // (ถ้า hardcode รายชื่อไว้ ฟิลด์ใหม่อย่าง refundedAt จะถูกทิ้งเงียบ ๆ โดยไม่มีใครรู้)
            Object.keys(f).forEach(function (key) {
                if (f[key] === undefined) return;
                // รูปหลักฐานเป็น null = "ผู้เรียกไม่ได้แนบรูปมา" ไม่ใช่ "ให้ลบรูปเดิมทิ้ง"
                if (key === 'purchaseProofImage' && f[key] === null) return;
                order[key] = f[key];
            });

            if (!setJSON(STORAGE_KEYS.ORDERS, orders)) return null;

            return order;
        },

        // status รับได้ทั้ง statusCode และข้อความไทยเดิม (โค้ดเก่าบางที่ยังส่งข้อความมา)
        // คืน null เมื่อไม่พบออเดอร์ หรือเขียนลง localStorage ไม่สำเร็จ — ผู้เรียกต้องเช็คก่อนแจ้งว่าสำเร็จ
        async updateOrderStatus(orderId, status, trackingNumber, adminNotes, purchaseProofImage, purchaseProofNote) {
            if (HAS_API) {
                // หลักฐานการกดสั่งที่แอดมินเพิ่งแนบเป็น data URL ต้องกลายเป็นไฟล์ก่อน
                let proofPath = purchaseProofImage;
                if (purchaseProofImage) {
                    const up = await global.KpopApi.uploadImage(purchaseProofImage, 'proof');
                    if (!up.success) return null;
                    proofPath = up.path;
                }

                const res = await apiWrite('orders.php?action=status', {
                    orderId: orderId,
                    statusCode: this.getStatusCode(status),
                    trackingNumber: trackingNumber === undefined ? null : trackingNumber,
                    adminNotes: adminNotes === undefined ? null : adminNotes,
                    purchaseProofImage: proofPath || null,
                    purchaseProofNote: purchaseProofNote === undefined ? null : purchaseProofNote
                });
                return res.success ? res.order : null;
            }

            const order = this._writeOrderStatus(orderId, status, {
                trackingNumber, adminNotes, purchaseProofImage, purchaseProofNote
            });
            if (!order) return null;

            // Send notification to customer
            // ใช้ order.status (ข้อความไทยที่ applyStatus เขียนให้) ไม่ใช่ค่าที่รับเข้ามา
            // เพราะผู้เรียกอาจส่ง statusCode มา ซึ่งลูกค้าอ่านไม่รู้เรื่อง
            let msg = `สถานะคำสั่งซื้อ #${orderId} ของคุณเปลี่ยนเป็น "${order.status}"`;
            if (purchaseProofImage) {
                msg += ` [แอดมินแนบหลักฐานการกดสั่งซื้อเรียบร้อย]`;
            }
            if (trackingNumber) {
                msg += ` (หมายเลขติดตามพัสดุ: ${trackingNumber})`;
            }

            this.addNotification({
                userEmail: order.customerEmail,
                title: `อัปเดตสถานะคำสั่งซื้อ #${orderId}`,
                message: msg
            });

            return order;
        },
        // อนุมัติสลิปแล้วออเดอร์เข้าคิวรอปิดรอบ ยังไม่ใช่ขั้นแพ็กของ
        // (ของเดิมกระโดดไป "กำลังจัดเตรียมสินค้า" ทันที ทั้งที่ร้านยังไม่ได้ไปกดของเลย)
        // ส่ง undefined (ไม่ใช่ '') เป็น trackingNumber เพราะ '' มีความหมายว่า "ล้างค่า"
        async approvePayment(orderId, adminNotes = 'ตรวจสอบสลิปและอนุมัติยอดชำระเงินเรียบร้อยแล้ว') {
            if (HAS_API) {
                const res = await apiWrite('orders.php?action=approve',
                    { orderId: orderId, adminNotes: adminNotes });
                return res.success ? res.order : null;
            }
            return this.updateOrderStatus(orderId, 'PAID_WAIT_ROUND', undefined, adminNotes);
        },
        async rejectPayment(orderId, reason = 'สลิปไม่ถูกต้อง หรือยอดเงินไม่ตรงกับสัญญาสั่งซื้อ') {
            if (HAS_API) {
                const res = await apiWrite('orders.php?action=reject',
                    { orderId: orderId, reason: reason });
                return res.success ? res.order : null;
            }
            return this.updateOrderStatus(orderId, 'SLIP_REJECTED', undefined, `ปฏิเสธการชำระเงิน: ${reason}`);
        },

        // ร้านกดของที่เกาหลีไม่สำเร็จ (ของหมด/เว็บล่ม/เกินลิมิตต่อบัญชี)
        // ต่างจากการปฏิเสธสลิปโดยสิ้นเชิง — ลูกค้าจ่ายถูกต้องแล้ว เงินอยู่ที่ร้าน ต้องคืน
        //
        // ปลายทางของเคสนี้คือ REFUND_PENDING เสมอ จึงเขียนสถานะ "ทอดเดียว" ด้วย _writeOrderStatus
        // ของเดิมเขียน PURCHASE_FAILED ก่อนแล้วค่อยทับด้วย REFUND_PENDING ผ่าน updateOrderStatus
        // ทั้งสองรอบ ทำให้ลูกค้าได้แจ้งเตือน 3 ใบรัวติดกันสำหรับเหตุการณ์เดียว
        // (สถานะ PURCHASE_FAILED ยังอยู่ในตารางให้แอดมินเลือกเองจาก dropdown ได้)
        async markPurchaseFailed(orderId, reason = 'สินค้าหมดจากเว็บ Official ก่อนร้านกดสั่งสำเร็จ') {
            if (HAS_API) {
                const res = await apiWrite('orders.php?action=purchase-failed',
                    { orderId: orderId, reason: reason });
                return res.success ? res.order : null;
            }

            const target = this.getOrderById(orderId);
            if (!target) return null;

            const amount = (Number(target.total) || 0).toLocaleString();
            const order = this._writeOrderStatus(orderId, 'REFUND_PENDING', {
                adminNotes: `ร้านกดสั่งไม่สำเร็จ: ${reason} — รอดำเนินการคืนเงิน ฿${amount}`
            });
            if (!order) return null;

            this.addNotification({
                userEmail: order.customerEmail,
                title: `ต้องขออภัย ร้านกดสั่ง #${orderId} ไม่สำเร็จ`,
                message: `${reason} — ทางร้านจะคืนเงินเต็มจำนวน ฿${amount} ให้ค่ะ`
            });

            return order;
        },

        async markRefunded(orderId, note = '') {
            if (HAS_API) {
                const res = await apiWrite('orders.php?action=refunded',
                    { orderId: orderId, note: note });
                return res.success ? res.order : null;
            }

            const orders = this.getOrders();
            const target = orders.find(o => o.id === orderId);
            if (!target) return null;

            // เขียนรอบเดียว: บันทึกข้อมูลการคืนเงินลงออเดอร์แล้วเปลี่ยนสถานะพร้อมกัน
            // ของเดิมเขียน 2 รอบ (setJSON ครั้งแรกไม่เช็คผลด้วย) ถ้ารอบแรกพลาด
            // จะได้สถานะ "คืนเงินแล้ว" โดยไม่มีบันทึกว่าคืนเมื่อไหร่
            const order = this._writeOrderStatus(orderId, 'REFUNDED', {
                adminNotes: note || 'คืนเงินให้ลูกค้าเรียบร้อยแล้ว',
                refundedAt: formatStamp(),
                refundNote: note
            });
            if (!order) return null;

            this.addNotification({
                userEmail: order.customerEmail,
                title: `คืนเงินคำสั่งซื้อ #${orderId} เรียบร้อยแล้ว`,
                message: `ทางร้านโอนคืน ฿${(Number(order.total) || 0).toLocaleString()} เรียบร้อยแล้วค่ะ${note ? ' (' + note + ')' : ''}`
            });

            return order;
        },
        // คืน { success, order, message } — ผู้เรียกต้องเช็ค success ก่อนแจ้งว่าส่งสลิปแล้ว
        async updateOrderSlip(orderId, newSlipDataUrl) {
            if (HAS_API) {
                const up = await global.KpopApi.uploadImage(newSlipDataUrl, 'slip');
                if (!up.success) {
                    return { success: false, order: null, message: up.message };
                }

                const res = await apiWrite('orders.php?action=reupload-slip',
                    { orderId: orderId, slipImage: up.path });
                return res.success
                    ? { success: true, order: res.order, message: '' }
                    : { success: false, order: null, message: res.message || 'ส่งสลิปไม่สำเร็จ' };
            }

            const orders = this.getOrders();
            const order = orders.find(o => o.id === orderId);
            if (!order) return { success: false, order: null, message: 'ไม่พบคำสั่งซื้อนี้ในระบบ' };

            // ห้ามส่งสลิปใหม่กับออเดอร์ที่ลูกค้ายกเลิกเอง (โควตาถูกคืนเข้าระบบไปแล้ว)
            // หรือออเดอร์ที่จัดส่งออกไปแล้ว — เงื่อนไขอยู่ใน canReuploadSlip ของตารางสถานะ
            if (!this.canReuploadSlip(order)) {
                return {
                    success: false,
                    order: null,
                    message: 'คำสั่งซื้อนี้ส่งสลิปใบใหม่ไม่ได้แล้ว (อาจถูกยกเลิกหรือจัดส่งไปแล้ว)'
                };
            }

            // ออเดอร์ที่ถูกปฏิเสธสลิปมีสถานะ quota = false คือคืนโควตาเข้ารอบไปแล้ว
            // การส่งสลิปใหม่จึงเท่ากับ "ขอจองใหม่" ต้องผ่านด่านเดียวกับการสั่งซื้อครั้งแรก
            // ไม่งั้นลูกค้าส่งสลิปใหม่หลังรอบปิด/โควตาเต็มได้ แล้วร้านรับของเกินที่กดไหว
            if (!this.isRoundOpen(order.roundId)) {
                return {
                    success: false,
                    order: null,
                    message: 'รอบพรีออเดอร์ของคำสั่งซื้อนี้ปิดรับแล้ว ไม่สามารถส่งสลิปใบใหม่ได้ค่ะ\n' +
                        'กรุณาติดต่อผู้ดูแลระบบเพื่อขอคืนเงินหรือย้ายไปรอบถัดไป'
                };
            }

            for (const item of (order.items || [])) {
                const remaining = this.getRemainingQuota(item.id);
                if (remaining === null) continue;
                if (remaining < (Number(item.qty) || 0)) {
                    return {
                        success: false,
                        order: null,
                        message: `ขออภัย "${item.title}" รอบนี้รับได้อีกเพียง ${remaining} ชิ้น ` +
                            `ไม่พอสำหรับจำนวนในคำสั่งซื้อนี้ (${item.qty} ชิ้น)\n` +
                            'กรุณาติดต่อผู้ดูแลระบบค่ะ'
                    };
                }
            }

            order.slipImage = newSlipDataUrl;
            this.applyStatus(order, 'PENDING_SLIP');
            order.adminNotes = 'ลูกค้าอัปโหลดสลิปการโอนเงินใบใหม่เข้ามาเรียบร้อยแล้ว รอผู้ขายตรวจสอบ';

            if (!setJSON(STORAGE_KEYS.ORDERS, orders)) {
                return { success: false, order: null, message: STORAGE_FULL_MESSAGE };
            }

            this.addNotification({
                userEmail: 'admin@kpopstore.com',
                title: `ลูกค้าแนบสลิปใหม่ #${orderId}`,
                message: `ลูกค้า ${order.customerName} ได้ส่งสลิปชำระเงินใบใหม่สำหรับคำสั่งซื้อ #${orderId}`
            });

            this.addNotification({
                userEmail: order.customerEmail,
                title: `ส่งสลิปใบใหม่เรียบร้อย #${orderId}`,
                message: `ส่งหลักฐานการโอนเงินใบใหม่เรียบร้อยแล้ว รอผู้ขายตรวจสอบความถูกต้องค่ะ`
            });

            return { success: true, order: order, message: '' };
        },

        // --- Cart ---
        // ตะกร้าเก็บแค่ productId + qty และ "ไม่เก็บราคา" โดยตั้งใจ
        // เพราะราคาบาทขึ้นกับเรทที่เปลี่ยนทุก 22:00 และจะถูกล็อกตอนแนบสลิปเท่านั้น
        // ของที่ค้างในตะกร้าข้ามวันจึงคิดราคาใหม่ตามเรทล่าสุดเสมอ
        getCart() {
            const cart = getJSON(STORAGE_KEYS.CART, []);
            return Array.isArray(cart) ? cart : [];
        },
        getCartCount() {
            return this.getCart().reduce((sum, c) => sum + (Number(c.qty) || 0), 0);
        },
        async addToCart(productId, qty) {
            if (HAS_API) {
                const res = await apiWrite('cart.php?action=add', { productId: productId, qty: qty });
                return res.success
                    ? { success: true, qty: res.qty, adjusted: !!res.adjusted }
                    : { success: false, message: res.message || 'เพิ่มลงตะกร้าไม่สำเร็จ' };
            }

            const product = this.getProductById(productId);
            if (!product) return { success: false, message: 'ไม่พบสินค้านี้ในระบบค่ะ' };
            if (!this.isProductSellable(product)) {
                return { success: false, message: 'สินค้านี้ปิดการขายชั่วคราวค่ะ (หมดชั่วคราว)' };
            }
            if (!this.isRoundOpen(product.roundId)) {
                return { success: false, message: 'รอบพรีออเดอร์ของสินค้านี้ปิดรับแล้วค่ะ' };
            }

            const remaining = this.getRemainingQuota(productId);
            if (remaining !== null && remaining <= 0) {
                return { success: false, message: 'รอบนี้เต็มโควตาแล้วค่ะ กรุณารอรอบถัดไป' };
            }

            const cart = this.getCart();
            const existing = cart.find(c => String(c.productId) === String(productId));
            const requested = (existing ? Number(existing.qty) || 0 : 0) + this.normalizeQty(qty);
            // clamp เองแทน normalizeQty(v, max) เพราะเมื่อ max = 0 ตัวนั้นจะถือว่า "ไม่มีเพดาน"
            const finalQty = (remaining !== null) ? Math.min(requested, remaining) : requested;

            if (existing) {
                existing.qty = finalQty;
            } else {
                cart.push({ productId: String(productId), qty: finalQty, addedAt: formatStamp() });
            }

            if (!setJSON(STORAGE_KEYS.CART, cart)) {
                return { success: false, message: STORAGE_FULL_MESSAGE };
            }

            return { success: true, qty: finalQty, adjusted: finalQty !== requested };
        },
        async updateCartQty(productId, qty) {
            if (HAS_API) {
                const res = await apiWrite('cart.php?action=update', { productId: productId, qty: qty });
                return res.success
                    ? { success: true, qty: res.qty, adjusted: !!res.adjusted }
                    : { success: false, message: res.message || 'แก้จำนวนไม่สำเร็จ' };
            }

            const cart = this.getCart();
            const entry = cart.find(c => String(c.productId) === String(productId));
            if (!entry) return { success: false, message: 'ไม่พบสินค้านี้ในตะกร้า' };

            const remaining = this.getRemainingQuota(productId);

            // โควตาหมดพอดี = แก้จำนวนไม่ได้เลย
            // ของเดิมใช้ Math.max(remaining, 1) ทำให้ยัดเป็น 1 ชิ้นแล้วบอกว่า "ปรับให้แล้ว"
            // ทั้งที่รอบนั้นรับเพิ่มไม่ได้สักชิ้น
            if (remaining !== null && remaining <= 0) {
                return { success: false, qty: entry.qty, message: 'รอบนี้เต็มโควตาแล้วค่ะ ปรับจำนวนเพิ่มไม่ได้' };
            }

            const requested = this.normalizeQty(qty);
            const finalQty = (remaining !== null) ? Math.min(requested, remaining) : requested;

            entry.qty = finalQty;
            if (!setJSON(STORAGE_KEYS.CART, cart)) {
                return { success: false, message: STORAGE_FULL_MESSAGE };
            }

            return { success: true, qty: finalQty, adjusted: finalQty !== requested };
        },
        async removeFromCart(productId) {
            if (HAS_API) {
                await apiWrite('cart.php?action=remove', { productId: productId });
                return this.getCart();
            }

            const cart = this.getCart().filter(c => String(c.productId) !== String(productId));
            setJSON(STORAGE_KEYS.CART, cart);
            return cart;
        },
        // ล้างเฉพาะของในรอบที่เพิ่งเช็คเอาต์ไป ของรอบอื่นต้องยังอยู่ในตะกร้า
        async clearCartRound(roundId) {
            if (HAS_API) {
                await apiWrite('cart.php?action=clear-round', { roundId: roundId });
                return this.getCart();
            }

            const cart = this.getCart().filter(c => {
                const p = this.getProductById(c.productId);
                return !p || p.roundId !== roundId;
            });
            setJSON(STORAGE_KEYS.CART, cart);
            return cart;
        },

        // จัดกลุ่มตะกร้าตามรอบ — ของคนละรอบถึงไทยคนละเวลา จึงรวมค่าส่งกันไม่ได้
        // ราคาทุกบรรทัดคำนวณสดจากเรทปัจจุบัน (ยังไม่ล็อกจนกว่าจะแนบสลิป)
        getCartGroupedByRound(shippingFeePerRound) {
            const shippingFee = (typeof shippingFeePerRound === 'number') ? shippingFeePerRound : 50;
            const rate = this.getCurrentRate();
            const groups = [];

            this.getCart().forEach(entry => {
                const product = this.getProductById(entry.productId);
                if (!product) return; // สินค้าถูกลบไปแล้ว ข้ามไป

                const roundId = product.roundId || 'round-legacy';
                let group = groups.find(g => g.roundId === roundId);
                if (!group) {
                    const round = this.getRoundById(roundId);
                    group = {
                        roundId,
                        round,
                        state: this.getRoundState(round),
                        items: [],
                        subtotal: 0,
                        shippingFee,
                        total: 0
                    };
                    groups.push(group);
                }

                const breakdown = this.getPriceBreakdown(product, rate.rate);
                const remaining = this.getRemainingQuota(product.id);
                const qty = Number(entry.qty) || 0;
                const lineTotal = breakdown.total * qty;

                group.items.push({
                    product,
                    qty,
                    breakdown,
                    lineTotal,
                    remaining,
                    overQuota: remaining !== null && qty > remaining
                });
                group.subtotal += lineTotal;
            });

            groups.forEach(g => {
                g.orderable = g.state === 'open' && g.items.every(i => !i.overQuota);
                g.total = g.subtotal + g.shippingFee;
            });

            return { rate, groups };
        },

        // --- Notifications ---
        getNotifications(userEmail) {
            const notifications = getJSON(STORAGE_KEYS.NOTIFICATIONS, DEFAULT_NOTIFICATIONS);
            if (!userEmail) return notifications;
            return notifications.filter(n => n.userEmail.toLowerCase() === userEmail.toLowerCase());
        },
        getUnreadNotificationCount(userEmail) {
            return this.getNotifications(userEmail).filter(n => !n.read).length;
        },
        async addNotification(noti) {
            if (HAS_API) {
                // ส่ง 'ALL' ไปครั้งเดียวแล้วให้ฝั่งเซิร์ฟเวอร์ insert รวดเดียวใน transaction
                // (ของเดิมหน้าแอดมินวนเรียกทีละคน = ยิงคำขอเท่าจำนวนผู้ใช้ทั้งระบบ)
                const res = await apiWrite('notifications.php?action=send', {
                    userEmail: noti.userEmail,
                    title: noti.title,
                    message: noti.message
                });
                return res.success ? noti : null;
            }

            const notifications = getJSON(STORAGE_KEYS.NOTIFICATIONS, DEFAULT_NOTIFICATIONS);
            const newNoti = {
                // ใช้ตัวนับต่อท้ายเวลา เพราะ Date.now() อย่างเดียวซ้ำได้จริง:
                // addOrder สร้างแจ้งเตือน 2 ใบติดกัน และ broadcast สร้างทีละหลายสิบใบในลูปเดียว
                id: nextNotificationId(),
                // เวลาเครื่องเหมือนทั้งระบบ — ของเดิมใช้ toISOString() ซึ่งเป็น UTC
                // ทำให้เวลาที่แสดงเพี้ยนไป 7 ชั่วโมง และเรียงเทียบกับ order.date ไม่ได้
                date: formatStamp(),
                read: false,
                ...noti
            };
            notifications.unshift(newNoti);

            // แจ้งเตือนไม่ใช่เส้นทางเงิน ถ้าเขียนไม่ลงก็แค่คืน null ให้ผู้เรียกรู้ ไม่ต้องล้มทั้ง flow
            if (!setJSON(STORAGE_KEYS.NOTIFICATIONS, notifications)) return null;

            return newNoti;
        },
        async markNotificationsAsRead(userEmail) {
            if (HAS_API) {
                // ฝั่งเซิร์ฟเวอร์ใช้อีเมลของ session เอง ไม่รับค่าที่ส่งมา
                // ไม่งั้นใครก็สั่งให้กล่องแจ้งเตือนของคนอื่นถูกทำเครื่องหมายว่าอ่านแล้วได้
                await apiWrite('notifications.php?action=read', {});
                return;
            }

            const notifications = getJSON(STORAGE_KEYS.NOTIFICATIONS, DEFAULT_NOTIFICATIONS);
            notifications.forEach(n => {
                if (n.userEmail.toLowerCase() === userEmail.toLowerCase()) {
                    n.read = true;
                }
            });
            setJSON(STORAGE_KEYS.NOTIFICATIONS, notifications);
        },

        /* ============================================================
         * การเริ่มทำงานของหน้า
         * ========================================================== */

        /**
         * เรียกแทน document.addEventListener('DOMContentLoaded', fn) ในทุกหน้า
         *
         * รับประกันว่า CACHE ถูกเติมจากเซิร์ฟเวอร์เรียบร้อยแล้ว "ก่อน" โค้ดวาดหน้าจอ
         * ของหน้านั้นจะเริ่มทำงาน โค้ดข้างในจึงยังเป็น synchronous ล้วนเหมือนเดิมทุกบรรทัด
         *
         * เรียกจากหลายที่ในหน้าเดียวกันได้ — ใช้ promise ตัวเดิม ไม่ยิงซ้ำ
         */
        ready(fn) {
            if (!hydratePromise) {
                hydratePromise = HAS_API ? hydrate() : Promise.resolve({ success: true });
            }

            const run = () => hydratePromise.then(() => {
                try {
                    return fn();
                } catch (e) {
                    console.error('เกิดข้อผิดพลาดตอนเริ่มหน้า:', e);
                }
            });

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', run);
            } else {
                run();
            }

            return hydratePromise;
        },

        /** ดึงข้อมูลใหม่จากเซิร์ฟเวอร์มาทับ CACHE (ใช้ตอนอยากรีเฟรชโดยไม่โหลดหน้าใหม่) */
        refresh() {
            return hydrate();
        },

    };

    // Attach to window
    global.KpopStore = KpopStore;


})(window);
