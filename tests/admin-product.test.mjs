import { loadStore, eq, report } from './harness.mjs';

/**
 * ครอบพฤติกรรมของแท็บ "จัดการสินค้า" ฝั่งแอดมิน
 * เน้น 2 เรื่องที่เคยพลาด: บันทึก/ลบไม่สำเร็จต้องไม่บอกว่าสำเร็จ
 * และห้ามลบสินค้าที่ลูกค้ายังสั่งค้างอยู่
 */

console.log('\n[1] ลบสินค้าที่ยังมีออเดอร์ค้างอยู่ ต้องถูกปฏิเสธ');
{
    const { K } = loadStore();
    // ORD-2026062815 = BTS x2 สถานะ PREPARING (ยังกินโควตา)
    const blocking = K.getActiveOrdersForProduct('bts');
    eq('มีออเดอร์ค้าง 1 ใบ', blocking.length, 1);
    eq('เป็นใบที่คาดไว้', blocking[0].id, 'ORD-2026062815');

    const res = await K.deleteProduct('bts');
    eq('success = false', res.success, false);
    eq('ข้อความบอกเลขที่ออเดอร์', res.message.includes('ORD-2026062815'), true);
    eq('ข้อความแนะทางออก OUT OF STOCK', res.message.includes('OUT OF STOCK'), true);
    eq('สินค้าต้องยังอยู่', K.getProductById('bts').id, 'bts');
    eq('ราคายังอ่านได้ปกติ', K.getPriceTHB('bts') > 0, true);
    eq('โควตายังอ่านได้ปกติ', K.getRemainingQuota('bts'), 48);
}

console.log('\n[2] ลบสินค้าที่ไม่มีออเดอร์ค้าง ต้องลบได้');
{
    const { K } = loadStore();
    const fresh = {
        id: 'prod-test', artist: 'ITZY', title: 'CHECKMATE',
        priceKRW: 25000, serviceFee: 170, roundId: 'round-kr',
        quotaPerRound: 10, status: 'PRE-ORDER', image: 'images/mapsoul7.jpg'
    };
    await K.saveProduct(fresh);
    eq('เพิ่มสินค้าใหม่แล้ว', !!K.getProductById('prod-test'), true);

    const res = await K.deleteProduct('prod-test');
    eq('success = true', res.success, true);
    eq('ไม่มีข้อความ error', res.message, '');
    eq('สินค้าหายจริง', K.getProductById('prod-test'), undefined);
    eq('สินค้าอื่นต้องไม่หาย', !!K.getProductById('bts'), true);
}

console.log('\n[3] ออเดอร์ที่ยกเลิกแล้วต้องไม่กันการลบ');
{
    const { K } = loadStore();
    // ORD-2026071301 = NewJeans สถานะรอตรวจสลิป (ลูกค้ายกเลิกเองได้)
    await K.cancelOrderCustomer('ORD-2026071301', 'เปลี่ยนใจ');

    eq('ไม่เหลือออเดอร์ค้าง', K.getActiveOrdersForProduct('newjeans').length, 0);
    const res = await K.deleteProduct('newjeans');
    eq('ลบได้แล้ว', res.success, true);
    eq('สินค้าหายจริง', K.getProductById('newjeans'), undefined);
}

console.log('\n[3B] ออเดอร์ที่จัดส่งสำเร็จแล้วต้องไม่กันการลบตลอดกาล');
{
    const { K } = loadStore();
    // ORD-2026070102 = BLACKPINK สถานะจัดส่งสำเร็จ — ยังกินโควตาของรอบอยู่ แต่จบธุระกับลูกค้าแล้ว
    eq('ใบนี้ยังกินโควตา', K.isQuotaConsuming(K.getOrderById('ORD-2026070102')), true);
    eq('แต่ไม่นับว่าค้าง', K.isOrderInProgress(K.getOrderById('ORD-2026070102')), false);
    eq('ไม่มีออเดอร์ค้าง', K.getActiveOrdersForProduct('blackpink').length, 0);
    eq('ลบได้', (await K.deleteProduct('blackpink')).success, true);
}

console.log('\n[4] ลบตอนพื้นที่เต็ม ต้องบอกว่าล้มเหลว ไม่ใช่บอกว่าสำเร็จ');
{
    const { K, storage } = loadStore();
    // blackpink มีแต่ออเดอร์ที่จัดส่งสำเร็จแล้ว จึงไม่ติดเงื่อนไขออเดอร์ค้าง
    const target = 'blackpink';
    const blockedBefore = K.getActiveOrdersForProduct(target).length;
    eq('สินค้าเป้าหมายไม่มีออเดอร์ค้าง', blockedBefore, 0);

    storage._startFailing();
    const res = await K.deleteProduct(target);

    eq('success = false', res.success, false);
    eq('มีข้อความบอก', res.message.length > 0, true);
    eq('ข้อความพูดถึงพื้นที่เต็ม', res.message.includes('พื้นที่'), true);
    eq('ข้อมูลต้องไม่ถูกลบจริง', !!K.getProductById(target), true);
}

console.log('\n[5] getUsedQuota ต้องสอดคล้องกับ getRemainingQuota');
{
    const { K } = loadStore();
    const p = K.getProductById('bts');
    eq('จองไปแล้ว 2 ชิ้น', K.getUsedQuota('bts'), 2);
    eq('เพดาน - จอง = คงเหลือ', p.quotaPerRound - K.getUsedQuota('bts'), K.getRemainingQuota('bts'));

    eq('สินค้าที่ไม่มีในระบบ -> 0', K.getUsedQuota('ไม่มีอยู่จริง'), 0);
}

console.log('\n[6] ตั้งเพดานต่ำกว่ายอดจอง โควตาคงเหลือถูกตัดที่ 0 แต่ยอดจองต้องยังบอกความจริง');
{
    const { K } = loadStore();
    const p = K.getProductById('bts');
    await K.saveProduct({ ...p, quotaPerRound: 1 });

    eq('คงเหลือถูกตัดที่ 0', K.getRemainingQuota('bts'), 0);
    // ตัวเลขนี้คือสิ่งที่ทำให้ตารางแอดมินขึ้นป้าย "เกินโควตา" ได้
    eq('ยอดจองยังเป็น 2 ตามจริง', K.getUsedQuota('bts'), 2);
    eq('จองเกินเพดานจริง', K.getUsedQuota('bts') > 1, true);
}

console.log('\n[7] ย้ายรอบแล้วออเดอร์เดิมหลุดจากการนับโควตา (เหตุผลที่ต้องเตือนก่อนย้าย)');
{
    const { K } = loadStore();
    const p = K.getProductById('bts');
    eq('ก่อนย้าย เหลือ 48', K.getRemainingQuota('bts'), 48);

    await K.saveProduct({ ...p, roundId: 'round-ship' });
    eq('ย้ายรอบแล้ว เหลือเต็ม 50', K.getRemainingQuota('bts'), 50);
    eq('ยอดจองในรอบใหม่เป็น 0', K.getUsedQuota('bts'), 0);
    // ออเดอร์ยังอยู่ครบ ไม่ได้หายไปไหน แค่ไม่ถูกนับในรอบใหม่
    eq('ออเดอร์ยังอยู่ในระบบ', !!K.getOrderById('ORD-2026062815'), true);
}

console.log('\n[8] saveRound / deleteRound ต้องรายงานผลจริง');
{
    const { K } = loadStore();
    const ok = await K.saveRound({ id: 'round-kr', note: 'แก้โน้ต' });
    eq('บันทึกรอบสำเร็จ', ok.success, true);
    eq('คืน rounds กลับมาด้วย', Array.isArray(ok.rounds), true);
    eq('ข้อมูลถูกบันทึกจริง', K.getRoundById('round-kr').note, 'แก้โน้ต');
}
{
    const { K, storage } = loadStore();
    storage._startFailing();

    const failedSave = await K.saveRound({ id: 'round-kr', note: 'ไม่ควรลง' });
    eq('พื้นที่เต็ม -> saveRound success = false', failedSave.success, false);
    eq('มีข้อความอธิบาย', failedSave.message.length > 0, true);

    const failedDelete = await K.deleteRound('round-ship');
    eq('พื้นที่เต็ม -> deleteRound success = false', failedDelete.success, false);
    eq('รอบต้องยังอยู่', !!K.getRoundById('round-ship'), true);
}

console.log('\n[9] saveProducts ก็ต้องรายงานผลเหมือนกัน');
{
    const { K } = loadStore();
    const res = K.saveProducts(K.getProducts());
    eq('success = true', res.success, true);

    const bad = K.saveProducts('ไม่ใช่ array');
    eq('ข้อมูลผิดชนิด -> success = false', bad.success, false);
    eq('คืนของเดิมกลับมา', Array.isArray(bad.products), true);
}

console.log('\n[10] อีเมลซ้ำต้องยึดบัญชีคนอื่นไม่ได้');
{
    const { K } = loadStore();
    const before = K.getUsers().length;

    // สมัครด้วยอีเมลของแอดมิน = พยายามยึดบัญชี
    const res = await K.saveUser({ id: 'u-new', name: 'คนแปลกหน้า', email: 'admin@kpopstore.com', role: 'customer' });
    eq('success = false', res.success, false);
    eq('บอกว่าอีเมลถูกใช้แล้ว', res.message.includes('ถูกใช้งาน'), true);
    eq('ไม่มีผู้ใช้เพิ่ม', K.getUsers().length, before);
    eq('บัญชีแอดมินยังเป็น admin', K.getUserByEmail('admin@kpopstore.com').role, 'admin');
    eq('ชื่อแอดมินไม่ถูกเขียนทับ', K.getUserByEmail('admin@kpopstore.com').name.includes('ผู้ดูแล'), true);
}

console.log('\n[11] แก้โปรไฟล์ตัวเองต้องไม่ติดด่านอีเมลซ้ำ');
{
    const { K } = loadStore();
    const me = K.getUserByEmail('user@kpopstore.com');

    const res = await K.saveUser({ ...me, name: 'ชื่อใหม่', address: 'ที่อยู่ใหม่' });
    eq('success = true', res.success, true);
    eq('ชื่อถูกเปลี่ยนจริง', K.getUserByEmail('user@kpopstore.com').name, 'ชื่อใหม่');
}

console.log('\n[12] ลบบัญชีที่กำลังล็อกอินอยู่ ต้องเตะออกจากระบบด้วย');
{
    const { K } = loadStore();
    await K.login('user@kpopstore.com', 'อะไรก็ได้');
    eq('ล็อกอินอยู่', !!K.getCurrentUser(), true);

    const me = K.getUserByEmail('user@kpopstore.com');
    eq('ลบสำเร็จ', (await K.deleteUser(me.id)).success, true);
    eq('session ถูกล้าง', K.getCurrentUser(), null);
}

console.log('\n[13] บัญชีที่สร้างอัตโนมัติต้องไม่ได้สิทธิ์แอดมิน');
{
    const { K } = loadStore();
    // เดิมใช้ email.includes('admin') ตัดสิน อีเมลแบบนี้จึงได้สิทธิ์แอดมินฟรี ๆ
    const res = await K.login('myadmin@evil.com', 'อะไรก็ได้');
    eq('ล็อกอินผ่าน (โหมด demo)', res.success, true);
    eq('แต่ต้องเป็น customer เท่านั้น', res.user.role, 'customer');
}

report();
