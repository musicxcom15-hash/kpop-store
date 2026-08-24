/**
 * กำแพงล็อกอินกลาง (KpopStore.requireLogin / getSafeNextUrl ใน ui.js)
 *
 * เดิมหน้ารายละเอียดสินค้าบังคับล็อกอินตั้งแต่เปิดหน้า guest จึงดูสินค้าไม่ได้เลย
 * ตอนนี้ย้ายกำแพงไปไว้ที่ปุ่ม "เพิ่มลงตะกร้า" / "สั่งซื้อทันที" แทน
 * เทสต์ชุดนี้คุมพฤติกรรมของตัวกลางที่ทุกหน้าเรียกใช้ร่วมกัน
 */

import { loadUi, eq, section, report } from './harness.mjs';

section('[1] ล็อกอินอยู่แล้ว ต้องผ่านไปทำงานต่อได้ ไม่เด้ง ไม่เตือน');
{
    const { K, alerts, navigations } = loadUi();
    await K.login('user@kpopstore.com', '123456');

    eq('requireLogin คืน true', K.requireLogin('ข้อความใด ๆ'), true);
    eq('ไม่มีการเปลี่ยนหน้า', navigations, []);
    eq('ไม่มี alert', alerts, []);
}

section('[2] guest ต้องถูกเตือนแล้วเด้งไปล็อกอิน พร้อม next กลับมาหน้าเดิม');
{
    const { K, alerts, navigations } = loadUi({
        pathname: '/product-detail.html',
        search: '?id=p001'
    });

    eq('requireLogin คืน false', K.requireLogin('กรุณาเข้าสู่ระบบก่อนค่ะ'), false);
    eq('เตือนด้วยข้อความที่ส่งเข้าไป', alerts, ['กรุณาเข้าสู่ระบบก่อนค่ะ']);
    eq('เด้งไป login พร้อม next ของหน้าเดิม',
        navigations,
        ['login.html?next=' + encodeURIComponent('product-detail.html?id=p001')]);
}

section('[3] ส่ง nextUrl เองได้ เพื่อจำจำนวนที่ผู้ใช้กรอกค้างไว้');
{
    // เคสจริง: guest กรอก 3 ชิ้นแล้วกด "เพิ่มลงตะกร้า" ต้องกลับมาที่สินค้าตัวเดิมพร้อมจำนวนเดิม
    const { K, navigations } = loadUi({ pathname: '/product-detail.html', search: '?id=p001' });

    K.requireLogin('เตือน', 'product-detail.html?id=p001&qty=3');

    eq('next พ่วง qty กลับมาด้วย',
        navigations,
        ['login.html?next=' + encodeURIComponent('product-detail.html?id=p001&qty=3')]);
}

section('[4] getSafeNextUrl รับเฉพาะ path ภายในเว็บ');
{
    const rel = loadUi({ search: '?next=' + encodeURIComponent('product-detail.html?id=p001&qty=3') });
    eq('path ธรรมดาผ่าน', rel.K.getSafeNextUrl(), 'product-detail.html?id=p001&qty=3');

    const none = loadUi({ search: '' });
    eq('ไม่มี next คืน null', none.K.getSafeNextUrl(), null);
}

section('[5] กัน open redirect — next ที่พาออกนอกเว็บต้องถูกทิ้ง');
{
    // ถ้าหลุด ผู้ใช้ที่กดลิงก์จากคนอื่นจะถูกพาไปหน้าล็อกอินปลอมหลังกดเข้าสู่ระบบ
    const cases = [
        ['https://evil.com', 'URL เต็ม'],
        ['//evil.com', 'protocol-relative'],
        ['/etc/passwd', 'path จาก root'],
        ['../../package.json', 'ไต่ออกนอกโฟลเดอร์'],
        ['javascript:alert(1)', 'javascript: scheme']
    ];

    for (const [value, label] of cases) {
        const { K } = loadUi({ search: '?next=' + encodeURIComponent(value) });
        eq(label + ' ต้องถูกปฏิเสธ', K.getSafeNextUrl(), null);
    }
}

section('[6] ตะกร้ายังไม่ผูกกับผู้ใช้ กำแพงจึงต้องอยู่ที่ปุ่ม ไม่ใช่ที่ store');
{
    // ยืนยันสมมติฐานที่หน้า product-detail พึ่งพา: addToCart ไม่เช็กล็อกอินให้
    // ถ้าวันหนึ่ง store เปลี่ยนไปเช็กเอง เทสต์นี้จะเตือนให้กลับมาทบทวนกำแพงที่ปุ่ม
    const { K } = loadUi();
    const product = K.getProducts()[0];
    const res = await K.addToCart(product.id, 1);

    eq('guest เรียก addToCart ตรง ๆ ยังสำเร็จ', res.success, true);
    eq('ของเข้าตะกร้าจริง', K.getCartCount(), 1);
}

report();
