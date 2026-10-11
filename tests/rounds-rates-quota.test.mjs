import { loadStore, eq, report } from './harness.mjs';

const day = o => { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().split('T')[0]; };

console.log('\n[1] ราคาจากวอน x เรท + ค่าบริการ ต้องเท่าราคาบาทที่เรทกลางของร้าน');
{
  const { K } = loadStore();
  eq('เรทปัจจุบัน', K.getCurrentRate().rate, 0.028);
  eq('BTS', K.getPriceTHB('bts'), 930);
  eq('NewJeans', K.getPriceTHB('newjeans'), 783);
  eq('BLACKPINK', K.getPriceTHB('blackpink'), 1353);
  eq('aespa', K.getPriceTHB('aespa'), 856);
  const b = K.getPriceBreakdown('bts');
  eq('breakdown วอน', b.krw, 27000);
  eq('breakdown แปลงแล้ว', b.converted, 756);
  eq('breakdown ค่าบริการ', b.serviceFee, 174);
}

console.log('\n[2] สถานะรอบคำนวณจากช่วงวันที่จริง');
{
  const { K } = loadStore();
  eq('รอบเว็บเกาหลีเปิดอยู่', K.getRoundState('round-kr'), 'open');
  eq('รอบชิปเปิดอยู่', K.getRoundState('round-ship'), 'open');

  await K.saveRound({ id: 'round-past', name: 'รอบที่ปิดไปแล้ว', openAt: day(-20), closeAt: day(-5), status: 'open' });
  eq('รอบที่เลยวันปิด', K.getRoundState('round-past'), 'closed');

  await K.saveRound({ id: 'round-future', name: 'รอบที่ยังไม่เปิด', openAt: day(5), closeAt: day(12), status: 'open' });
  eq('รอบที่ยังไม่ถึงวันเปิด', K.getRoundState('round-future'), 'upcoming');

  await K.saveRound({ id: 'round-kr', status: 'ordered' });
  eq('แอดมินตั้งสถานะเองมาก่อนวันที่', K.getRoundState('round-kr'), 'ordered');
}

console.log('\n[3] โควตาคำนวณสด + คืนเองเมื่อยกเลิก/ปฏิเสธสลิป');
{
  const { K } = loadStore();
  eq('BTS เพดาน 50 ใช้ไป 2', K.getRemainingQuota('bts'), 48);
  eq('NewJeans เพดาน 35 ใช้ไป 1', K.getRemainingQuota('newjeans'), 34);

  await K.rejectPayment('ORD-2026071301', 'ยอดไม่ตรง');
  eq('ปฏิเสธสลิปแล้วโควตาคืน', K.getRemainingQuota('newjeans'), 35);

  // ออเดอร์ BTS ตัวนี้อยู่สถานะ PREPARING = ร้านกดของไปแล้ว ลูกค้ายกเลิกเองไม่ได้
  eq('ยกเลิกออเดอร์ที่ร้านกดของแล้วไม่ผ่าน', (await K.cancelOrderCustomer('ORD-2026062815', 'เปลี่ยนใจ')).success, false);
  eq('โควตายังถูกจองอยู่', K.getRemainingQuota('bts'), 48);

  // ย้อนกลับไปสถานะที่ยังยกเลิกได้ แล้วยกเลิก -> โควตาต้องคืน
  await K.updateOrderStatus('ORD-2026062815', 'PAID_WAIT_ROUND');
  eq('ยกเลิกตอนยังไม่กดของได้', (await K.cancelOrderCustomer('ORD-2026062815', 'เปลี่ยนใจ')).success, true);
  eq('ลูกค้ายกเลิกแล้วโควตาคืน', K.getRemainingQuota('bts'), 50);
}

console.log('\n[4] โควตารีเซ็ตเมื่อย้ายสินค้าไปรอบใหม่');
{
  const { K } = loadStore();
  eq('ก่อนย้าย', K.getRemainingQuota('bts'), 48);
  await K.saveProduct({ id: 'bts', roundId: 'round-ship' });
  eq('ย้ายรอบแล้วโควตากลับเป็นเต็ม', K.getRemainingQuota('bts'), 50);
}

console.log('\n[5] โควตาว่าง null = รับไม่จำกัด');
{
  const { K } = loadStore();
  await K.saveProduct({ id: 'bts', quotaPerRound: null });
  eq('คืน null', K.getRemainingQuota('bts'), null);
}

console.log('\n[6] ตะกร้า: จำกัดตามโควตา และปฏิเสธรอบที่ปิด');
{
  const { K } = loadStore();
  eq('ตะกร้าเริ่มว่าง', K.getCartCount(), 0);
  eq('เพิ่มปกติ', (await K.addToCart('bts', 2)).success, true);
  eq('จำนวนในตะกร้า', K.getCartCount(), 2);

  const r = await K.addToCart('bts', 100);
  eq('เกินโควตาถูกปรับลง', r.qty, 48);
  eq('แจ้งว่าถูกปรับ', r.adjusted, true);

  await K.saveRound({ id: 'round-ship', openAt: day(-20), closeAt: day(-5) });
  eq('รอบปิดแล้วเพิ่มไม่ได้', (await K.addToCart('blackpink', 1)).success, false);
}

console.log('\n[7] ตะกร้าแยกกลุ่มตามรอบ และเก็บค่าส่งกลุ่มละครั้ง');
{
  const { K } = loadStore();
  await K.addToCart('bts', 1);
  await K.addToCart('blackpink', 1);
  const { groups } = K.getCartGroupedByRound();
  eq('แยกเป็น 2 กลุ่ม', groups.length, 2);
  const kr = groups.find(g => g.roundId === 'round-kr');
  eq('ค่าส่งกลุ่มละ 50', groups.every(g => g.shippingFee === 50), true);
  eq('ยอดรวมกลุ่ม round-kr = 930 + 50', kr.total, 980);
  eq('กลุ่มที่รอบเปิดสั่งได้', kr.orderable, true);
}

console.log('\n[8] เรทเป็นค่าคงที่ — ออเดอร์ล็อกเรทไว้ตอนสร้างและต้องนิ่งตลอด');
{
  const { K } = loadStore();
  await K.addToCart('bts', 1);

  const order = (await K.addOrder({
    customerName: 'ก', customerEmail: 'a@b.c', phone: '0', address: 'x',
    items: [{ id: 'bts', title: 'BTS', qty: 1, image: '' }], shippingFee: 50
  })).order;
  eq('ล็อกเรทไว้ในออเดอร์', order.rateUsed, 0.028);
  eq('ยอดออเดอร์', order.total, 980);
  eq('ผูกรอบให้อัตโนมัติ', order.roundId, 'round-kr');
  eq('ยอดออเดอร์นิ่งเมื่ออ่านกลับมา', K.getOrderById(order.id).total, 980);
  eq('เรทที่ใช้ยังเป็นตัวเดิม', K.getOrderById(order.id).rateUsed, 0.028);
}

console.log('\n[9] สั่งซื้อทันที (ไม่ผ่านตะกร้า) ต้องไม่ล้างตะกร้าทิ้ง');
{
  const { K } = loadStore();
  await K.addToCart('blackpink', 2);
  await K.addOrder({ customerName: 'ก', customerEmail: 'a@b.c', items: [{ id: 'bts', title: 'BTS', qty: 1 }], shippingFee: 50 });
  eq('ของในตะกร้ายังอยู่', K.getCartCount(), 2);

  await K.clearCartRound('round-ship');
  eq('ล้างเฉพาะรอบนั้น', K.getCartCount(), 0);
}

console.log('\n[10] ใบสรุปรอบสำหรับแอดมินไปกดของ');
{
  const { K } = loadStore();
  const s = K.getRoundSummary('round-kr');
  eq('มี 2 ออเดอร์ในรอบ', s.orderCount, 2);
  eq('รวม BTS 2 ชิ้น', s.items.find(i => i.id === 'bts').qty, 2);
  eq('เรียงจากมากไปน้อย', s.items[0].qty >= s.items[1].qty, true);
}

console.log('\n[10B] ป้าย OUT OF STOCK ต้องหยุดขายจริง ไม่ใช่แค่ป้ายสี');
{
  const { K } = loadStore();
  eq('ตอนแรกขายได้', K.isProductSellable('bts'), true);
  eq('เพิ่มลงตะกร้าได้', (await K.addToCart('bts', 1)).success, true);

  await K.saveProduct({ id: 'bts', status: 'OUT OF STOCK' });
  eq('ปิดการขายแล้ว', K.isProductSellable('bts'), false);

  const res = await K.addToCart('bts', 1);
  eq('เพิ่มลงตะกร้าไม่ได้', res.success, false);
  eq('บอกเหตุผลให้ลูกค้ารู้', res.message.includes('หมด'), true);

  // รอบยังเปิดและโควตายังเหลือ — ตัวที่บล็อกต้องเป็นป้ายสถานะเท่านั้น
  eq('รอบยังเปิดอยู่', K.isRoundOpen('round-kr'), true);
  eq('โควตายังเหลือ', K.getRemainingQuota('bts') > 0, true);
}

console.log('\n[11] สินค้าเก่าที่ไม่มีราคาวอน ต้องใช้ราคาบาทเดิม');
{
  const { K } = loadStore();
  const bd = K.getPriceBreakdown({ id: 'old', price: 500 });
  eq('ใช้ราคาบาทเดิม', bd.total, 500);
  eq('ทำเครื่องหมายว่าเป็นข้อมูลเก่า', bd.legacy, true);
}

console.log('\n[12] รายงานคำสั่งซื้อแยกตามสินค้า (getOrdersForProduct)');
{
  const { K } = loadStore();
  const btsRows = K.getOrdersForProduct('bts');
  eq('BTS มีคำสั่งซื้อ 1 รายการ', btsRows.length, 1);
  eq('รหัสคำสั่งซื้อถูกต้อง', btsRows[0].orderId, 'ORD-2026062815');
  eq('ชื่อลูกค้าถูกต้อง', btsRows[0].customerName, 'คุณสมชาย ใจดี');
  eq('จำนวนถูกต้อง', btsRows[0].qty, 2);
  eq('ยอดเงิน = ราคา x จำนวน', btsRows[0].amount, 1780);
  eq('ชื่อรอบถูกต้อง', btsRows[0].roundName, 'รอบพรีออเดอร์เว็บเกาหลี (Weverse / Ktown4u)');

  eq('สินค้าที่ไม่มีใครสั่งคืน array ว่าง', K.getOrdersForProduct('aespa').length, 0);
}

report();
