// ทดสอบ API ทุก endpoint ที่เขียนฐานข้อมูล กับเว็บที่รันอยู่จริง (ไม่ต้องใช้ Chrome)
//
//   node tests/e2e/api.mjs http://localhost:8080
//
// สร้างข้อมูลทดสอบ (ผู้ใช้/รอบ/สินค้า/ออเดอร์) แล้วลบทิ้งตอนจบ — จึงยอมรันกับ localhost เท่านั้น
// เว้นแต่ตั้ง API_TEST_ALLOW_REMOTE=1 (ไม่แนะนำกับเว็บจริง)
// บัญชีแอดมินใช้ค่าจาก seed.sql ถ้าไม่ได้ตั้ง API_ADMIN_EMAIL / API_ADMIN_PASSWORD
//
// เน้นจุดที่พึ่งพาภาษา SQL ของฐานข้อมูล: อีเมลไม่สนตัวพิมพ์, upsert ตะกร้า, ลบตะกร้าตามรอบ,
// โควตารวมทุกไซซ์, rate limit ของลืมรหัสผ่าน, ล็อกแถวตอนสร้างออเดอร์, แจ้งเตือนตามอีเมล

const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/$/, '');
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && process.env.API_TEST_ALLOW_REMOTE !== '1') {
    console.error('ปฏิเสธ: สคริปต์นี้สร้าง/ลบข้อมูลจริง รันได้กับ localhost เท่านั้น (ตั้ง API_TEST_ALLOW_REMOTE=1 ถ้าตั้งใจ)');
    process.exit(2);
}
const ADMIN_EMAIL = process.env.API_ADMIN_EMAIL || 'admin@kpopstore.com';
const ADMIN_PASSWORD = process.env.API_ADMIN_PASSWORD || 'admin123';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
    ok ? pass++ : fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`);
};

// session ของ PHP ต่อ client — login() ส่ง Set-Cookie สองรอบ (session_regenerate_id) ต้องเก็บตัวล่าสุด
class Client {
    cookie = '';
    async call(path, body) {
        const res = await fetch(`${BASE}/api/${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const sid = res.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => c.startsWith('PHPSESSID=')).pop();
        if (sid) this.cookie = sid;
        const text = await res.text();
        try { return Object.assign(JSON.parse(text), { _status: res.status }); }
        catch { return { success: false, _status: res.status, message: text.slice(0, 200) }; }
    }
    post(path, body = {}) { return this.call(path, body); }
    boot() { return this.call('bootstrap.php'); }
}

const day = n => { const d = new Date(Date.now() + n * 86400000 + 7 * 3600000); return d.toISOString().slice(0, 10); };
const stamp = Date.now();
const MIXED_EMAIL = `Api.Test.${stamp}@Example.COM`;
const ids = { round: `round-apitest-${stamp}`, product: `prod-apitest-${stamp}`, orders: [], users: [] };

const admin = new Client();
const cust = new Client();

try {
    // ---------- อ่านแบบไม่ล็อกอิน ----------
    const anon = await new Client().boot();
    check('bootstrap (ไม่ล็อกอิน) สำเร็จ', anon.success === true, anon.message);
    check('สินค้ามี sizes เป็น array และไม่มี sourceUrl', anon.products.every(p => Array.isArray(p.sizes) && !('sourceUrl' in p)));

    // ---------- สมัคร / ล็อกอิน: อีเมลไม่สนตัวพิมพ์ ----------
    let r = await cust.post('auth.php?action=register', { name: 'ทดสอบ API', email: MIXED_EMAIL, password: 'secret1', phone: '0800000000', address: 'กทม.' });
    check('สมัครด้วยอีเมลตัวพิมพ์ผสม', r.success === true, r.message);
    ids.users.push(r.user && r.user.id);
    r = await new Client().post('auth.php?action=register', { name: 'ซ้ำ', email: MIXED_EMAIL.toLowerCase(), password: 'secret1' });
    check('สมัครซ้ำด้วยอีเมลเดียวกันแต่ตัวเล็ก → ถูกปฏิเสธ', r.success === false);
    await cust.post('auth.php?action=logout');
    r = await cust.post('auth.php?action=login', { email: MIXED_EMAIL.toUpperCase(), password: 'secret1' });
    check('ล็อกอินด้วยอีเมลตัวใหญ่ทั้งหมดได้', r.success === true, r.message);
    r = await cust.post('auth.php?action=profile', { name: 'ทดสอบ API (แก้แล้ว)', phone: '0811111111', address: 'เชียงใหม่' });
    check('แก้โปรไฟล์', r.success === true, r.message);

    // ---------- รหัสผ่าน ----------
    const anonC = new Client();
    r = await anonC.post('auth.php?action=forgot', { email: MIXED_EMAIL.toLowerCase() });
    const r2 = await anonC.post('auth.php?action=forgot', { email: MIXED_EMAIL });
    check('ลืมรหัสผ่าน 2 ครั้งติด (ผ่าน rate limit query) ไม่ error', r.success === true && r2.success === true, r.message || r2.message);
    r = await anonC.post('auth.php?action=reset-token-status', { token: 'f'.repeat(64) });
    check('ลิงก์รีเซ็ตมั่ว → invalid_link', r.success === false && r.code === 'invalid_link', JSON.stringify(r));
    r = await cust.post('auth.php?action=change-password', { currentPassword: 'secret1', newPassword: 'secret2' });
    check('เปลี่ยนรหัสผ่าน', r.success === true, r.message);
    await cust.post('auth.php?action=logout');
    r = await cust.post('auth.php?action=login', { email: MIXED_EMAIL, password: 'secret2' });
    check('ล็อกอินด้วยรหัสใหม่', r.success === true, r.message);

    // ---------- แอดมิน: รอบ + สินค้ามีไซซ์ ----------
    r = await admin.post('auth.php?action=login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check('แอดมินล็อกอิน', r.success === true && r.user.role === 'admin', r.message);
    r = await admin.post('rounds.php?action=save', { id: ids.round, name: 'รอบทดสอบ API', type: 'shipping', openAt: day(-1), closeAt: day(5), status: 'open', estDelivery: '', note: '' });
    check('สร้างรอบ', r.success === true, r.message);
    r = await admin.post('products.php?action=save', {
        id: ids.product, artist: 'BRAND', title: 'API Tee', category: 'clothing', sizes: ['S', 'M', 'L'],
        sourceUrl: 'https://example.com/tee', priceKRW: 30000, serviceFee: 200, roundId: ids.round,
        quotaPerRound: 5, status: 'PRE-ORDER', image: 'images/mapsoul7.jpg', estDelivery: '', desc: ''
    });
    check('สร้างสินค้ามีไซซ์', r.success === true, r.message);
    const adminBoot = await admin.boot();
    const tee = adminBoot.products.find(p => p.id === ids.product);
    check('แอดมินเห็นไซซ์และ sourceUrl', tee && tee.sizes.join(',') === 'S,M,L' && tee.sourceUrl === 'https://example.com/tee');

    // ---------- ตะกร้า ----------
    await cust.post('cart.php?action=add', { productId: ids.product, size: 'M', qty: 2 });
    r = await cust.post('cart.php?action=add', { productId: ids.product, size: 'M', qty: 1 });
    check('ใส่ไซซ์เดิมซ้ำ → รวมจำนวน (upsert)', r.success === true && r.qty === 3, JSON.stringify(r));
    r = await cust.post('cart.php?action=add', { productId: ids.product, size: 'L', qty: 5 });
    check('ไซซ์ L ถูกปรับเหลือ 2 (โควตารวม 5)', r.success === true && r.qty === 2 && r.adjusted === true, JSON.stringify(r));
    r = await cust.post('cart.php?action=update', { productId: ids.product, size: 'M', qty: 1 });
    check('แก้จำนวนไซซ์ M', r.success === true && r.qty === 1, JSON.stringify(r));
    r = await cust.post('cart.php?action=remove', { productId: ids.product, size: 'L' });
    check('ลบไซซ์ L', r.success === true && r.cart.filter(c => c.productId === ids.product).map(c => c.size).join() === 'M');
    r = await cust.post('cart.php?action=add', { productId: ids.product, size: 'XL', qty: 1 });
    check('ไซซ์ที่ไม่มี → ปฏิเสธ', r.success === false);

    // ---------- ออเดอร์ ----------
    r = await cust.post('orders.php?action=create', { items: [{ id: ids.product, size: 'M', qty: 1 }, { id: ids.product, size: 'L', qty: 1 }], slipImage: 'images/placeholder-slip.svg', shippingFee: 50 });
    check('สร้างออเดอร์ 2 ไซซ์', r.success === true && r.order.items.length === 2, r.message);
    const o1 = r.order; ids.orders.push(o1 && o1.id);
    check('ยอดเงินคิดจากเซิร์ฟเวอร์: (ceil(30000×0.028)+200)×2+50 = 2130', o1 && o1.total === 2130, o1 && String(o1.total));
    r = await cust.post('cart.php?action=clear-round', { roundId: ids.round });
    check('ล้างตะกร้าเฉพาะรอบ (DELETE ... USING)', r.success === true && !r.cart.some(c => c.productId === ids.product));
    r = await cust.post('orders.php?action=create', { items: [{ id: ids.product, size: 'S', qty: 4 }], slipImage: 'images/placeholder-slip.svg' });
    check('โควตาเหลือ 3 (5-2) สั่ง 4 → ปฏิเสธ', r.success === false && /3/.test(r.message || ''), r.message);

    // ---------- แอดมินเปลี่ยนสถานะ ----------
    r = await admin.post('orders.php?action=approve', { orderId: o1.id, adminNotes: 'ok' });
    check('อนุมัติสลิป', r.success === true, r.message);
    r = await admin.post('orders.php?action=status', { orderId: o1.id, statusCode: 'ORDERED_KR', trackingNumber: 'TH123', adminNotes: 'กดสั่งแล้ว' });
    check('เปลี่ยนสถานะ + เลขพัสดุ', r.success === true, r.message);
    r = await cust.post('orders.php?action=cancel', { orderId: o1.id, reason: 'ลองยกเลิก' });
    check('ลูกค้ายกเลิกหลังร้านกดสั่งแล้ว → ปฏิเสธ', r.success === false);
    r = await admin.post('orders.php?action=purchase-failed', { orderId: o1.id, reason: 'ของหมด' });
    check('ซื้อไม่สำเร็จ', r.success === true, r.message);
    r = await admin.post('orders.php?action=refunded', { orderId: o1.id, note: 'โอนคืนแล้ว' });
    check('คืนเงินแล้ว', r.success === true && r.order && r.order.statusCode === 'REFUNDED', r.message);

    r = await cust.post('orders.php?action=create', { items: [{ id: ids.product, size: 'S', qty: 1 }], slipImage: 'images/placeholder-slip.svg' });
    const o2 = r.order; ids.orders.push(o2 && o2.id);
    check('ออเดอร์ที่ 2 (โควตาคืนจากใบที่คืนเงินแล้ว)', r.success === true, r.message);
    r = await admin.post('orders.php?action=reject', { orderId: o2.id, reason: 'สลิปไม่ชัด' });
    check('ปฏิเสธสลิป', r.success === true, r.message);
    r = await cust.post('orders.php?action=reupload-slip', { orderId: o2.id, slipImage: 'images/placeholder-slip.svg' });
    check('ส่งสลิปใหม่', r.success === true && r.order && r.order.statusCode === 'PENDING_SLIP', r.message);
    r = await cust.post('orders.php?action=cancel', { orderId: o2.id, reason: 'เปลี่ยนใจ' });
    check('ลูกค้ายกเลิกเอง', r.success === true, r.message);

    // ---------- แจ้งเตือน (อีเมลในออเดอร์เป็นตัวพิมพ์ผสม) ----------
    let cb = await cust.boot();
    const myNoti = cb.notifications || [];
    check('ลูกค้าเห็นแจ้งเตือนของตัวเอง', myNoti.length >= 3, String(myNoti.length));
    const unread = myNoti.find(n => !n.read);
    r = await cust.post('notifications.php?action=read-one', { id: unread && unread.id });
    check('อ่านแจ้งเตือนใบเดียว', r.success === true, r.message);
    r = await cust.post('notifications.php?action=read', {});
    cb = await cust.boot();
    check('อ่านทั้งหมด', r.success === true && cb.notifications.every(n => n.read), r.message);
    r = await admin.post('notifications.php?action=send', { userEmail: MIXED_EMAIL.toLowerCase(), title: 'ทดสอบ', message: 'ข้อความทดสอบ' });
    cb = await cust.boot();
    check('แอดมินส่งแจ้งเตือนถึงอีเมลตัวเล็ก → ลูกค้าเห็น', r.success === true && cb.notifications.some(n => n.title === 'ทดสอบ'), r.message);

    // ---------- จัดการผู้ใช้ ----------
    r = await admin.post('users.php?action=save', { name: 'ผู้ใช้ทดสอบ', email: `api.new.${stamp}@example.com`, phone: '', address: '', role: 'customer' });
    check('แอดมินสร้างผู้ใช้ (ได้รหัสชั่วคราว)', r.success === true && !!r.defaultPassword, r.message);
    ids.users.push(r.id);
    r = await admin.post('users.php?action=save', { name: 'ชน', email: MIXED_EMAIL.toLowerCase(), phone: '', address: '', role: 'customer' });
    check('สร้างผู้ใช้ด้วยอีเมลซ้ำ (ต่างตัวพิมพ์) → ปฏิเสธ', r.success === false);
    r = await admin.post('users.php?action=reset-password', { id: ids.users[0] });
    check('แอดมินรีเซ็ตรหัสให้ลูกค้า', r.success === true && !!r.tempPassword, r.message);
} catch (e) {
    fail++;
    console.log('FAIL  สคริปต์หยุดกลางทาง —', e.message);
} finally {
    // ล้างข้อมูลทดสอบ (ออเดอร์ → สินค้า → รอบ → ผู้ใช้)
    for (const id of ids.orders.filter(Boolean)) await admin.post('orders.php?action=delete', { orderId: id });
    const dp = await admin.post('products.php?action=delete', { id: ids.product });
    const dr = await admin.post('rounds.php?action=delete', { id: ids.round });
    for (const id of ids.users.filter(Boolean)) await admin.post('users.php?action=delete', { id });
    const left = await admin.boot();
    const clean = left.success && !left.products.some(p => p.id === ids.product) && !left.rounds.some(x => x.id === ids.round)
        && !(left.users || []).some(u => ids.users.includes(u.id)) && !left.orders.some(o => ids.orders.includes(o.id));
    check('ล้างข้อมูลทดสอบครบ', clean, `product:${dp.success} round:${dr.success}`);
    console.log(`\nสรุป: PASS ${pass} / FAIL ${fail}`);
    process.exit(fail ? 1 : 0);
}
