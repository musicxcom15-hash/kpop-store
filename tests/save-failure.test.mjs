/**
 * บันทึกไม่ลงต้องไม่บอกว่าสำเร็จ + ด่านของการส่งสลิปใบใหม่
 *
 * เคสพวกนี้คือจุดที่ "เงินออกจากบัญชีลูกค้าไปแล้ว" ถ้าระบบบอกว่าสำเร็จทั้งที่เขียนไม่ลง
 * ออเดอร์จะหายตอนรีเฟรชโดยไม่มีใครรู้ตัว จึงต้องมีเทสต์คุมไว้ทุกเส้นทาง
 */
import { loadStore, eq, report } from './harness.mjs';

const SLIP = 'data:image/jpeg;base64,xxx';

function newOrderData(qty = 1) {
    return {
        customerName: 'ก', customerEmail: 'a@b.c', phone: '0', address: 'x',
        items: [{ id: 'bts', title: 'BTS', qty }], shippingFee: 50, slipImage: SLIP
    };
}

console.log('\n[1] addOrder ตอนพื้นที่เต็ม ต้องไม่สร้างออเดอร์ผี');
{
    const { K, storage } = loadStore();
    const before = K.getOrders().length;

    storage._startFailing();
    const res = await K.addOrder(newOrderData());

    eq('success = false', res.success, false);
    eq('ไม่คืน order กลับมา', res.order, null);
    eq('มีข้อความอธิบายให้ลูกค้าอ่าน', typeof res.message === 'string' && res.message.length > 0, true);
    eq('จำนวนออเดอร์ในระบบไม่เพิ่ม', K.getOrders().length, before);
}

console.log('\n[2] addOrder ปกติต้องคืน { success, order }');
{
    const { K } = loadStore();
    const res = await K.addOrder(newOrderData());

    eq('success = true', res.success, true);
    eq('ได้ออเดอร์กลับมา', typeof res.order === 'object' && !!res.order.id, true);
    eq('ยอดถูกคิดจากเรทที่ล็อก', res.order.total, 940);
    // seed มีออเดอร์ BTS 2 ชิ้นในรอบเดียวกันอยู่แล้ว บวกใบใหม่อีก 1 → 50 - 3
    eq('โควตาถูกตัดจริง', K.getRemainingQuota('bts'), 47);
}

console.log('\n[3] ส่งสลิปใบใหม่ตอนพื้นที่เต็ม ต้องไม่เปลี่ยนสถานะ');
{
    const { K, storage } = loadStore();
    await K.rejectPayment('ORD-2026071301', 'ยอดไม่ตรง');
    eq('เตรียมสถานะเป็น SLIP_REJECTED', K.getOrderById('ORD-2026071301').statusCode, 'SLIP_REJECTED');

    storage._startFailing();
    const res = await K.updateOrderSlip('ORD-2026071301', SLIP);

    eq('success = false', res.success, false);
    eq('สถานะต้องไม่ขยับ', K.getOrderById('ORD-2026071301').statusCode, 'SLIP_REJECTED');
}

console.log('\n[4] ส่งสลิปใบใหม่ตอนรอบปิดแล้ว ต้องถูกปฏิเสธ');
{
    // ออเดอร์นี้อยู่รอบ round-kr — ปิดรอบทิ้งแล้วค่อยลองส่งสลิป
    const { K } = loadStore();
    await K.rejectPayment('ORD-2026071301', 'ยอดไม่ตรง');
    await K.saveRound({ id: 'round-kr', status: 'closed' });

    const res = await K.updateOrderSlip('ORD-2026071301', SLIP);
    eq('success = false', res.success, false);
    eq('บอกเหตุผลว่ารอบปิด', res.message.includes('ปิดรับ'), true);
    eq('สถานะยังเป็น SLIP_REJECTED', K.getOrderById('ORD-2026071301').statusCode, 'SLIP_REJECTED');
}

console.log('\n[5] ส่งสลิปใบใหม่ตอนโควตาไม่พอ ต้องถูกปฏิเสธ');
{
    const { K } = loadStore();
    // ออเดอร์เดิมสั่ง newjeans 1 ชิ้น · ปฏิเสธสลิปเพื่อคืนโควตาเข้ารอบ
    await K.rejectPayment('ORD-2026071301', 'ยอดไม่ตรง');
    eq('โควตาคืนกลับมาแล้ว', K.getRemainingQuota('newjeans'), 35);

    // แล้วตั้งเพดานเหลือ 0 เพื่อจำลองว่าคนอื่นจองเต็มไปหมดระหว่างนั้น
    await K.saveProduct({ id: 'newjeans', quotaPerRound: 0 });

    const res = await K.updateOrderSlip('ORD-2026071301', SLIP);
    eq('success = false', res.success, false);
    eq('สถานะยังเป็น SLIP_REJECTED', K.getOrderById('ORD-2026071301').statusCode, 'SLIP_REJECTED');
}

console.log('\n[6] ส่งสลิปใบใหม่ตามปกติต้องผ่านและกลับไปรอตรวจ');
{
    const { K } = loadStore();
    await K.rejectPayment('ORD-2026071301', 'ยอดไม่ตรง');

    const res = await K.updateOrderSlip('ORD-2026071301', SLIP);
    eq('success = true', res.success, true);
    eq('กลับไปรอตรวจสลิป', K.getOrderById('ORD-2026071301').statusCode, 'PENDING_SLIP');
    eq('สลิปถูกเปลี่ยนจริง', K.getOrderById('ORD-2026071301').slipImage, SLIP);
    eq('กินโควตาอีกครั้ง', K.getRemainingQuota('newjeans'), 34);
}

console.log('\n[7] เขียนไม่ลงในเส้นทางอื่น ๆ ต้องรายงานตรงกัน');
{
    const { K, storage } = loadStore();
    storage._startFailing();

    eq('cancelOrderCustomer', (await K.cancelOrderCustomer('ORD-2026071301')).success, false);
    eq('updateOrderStatus คืน null', await K.updateOrderStatus('ORD-2026071301', 'SHIPPING'), null);
    eq('approvePayment คืน null', await K.approvePayment('ORD-2026071301'), null);
    eq('markRefunded คืน null', await K.markRefunded('ORD-2026071301'), null);
    eq('setRate', (await K.setRate(0.03)).success, false);
    eq('saveUser', (await K.saveUser({ id: 'u-x', name: 'x', email: 'x@y.z' })).success, false);
    eq('addToCart', (await K.addToCart('bts', 1)).success, false);
}

report();
