import { loadStore, eq, report } from './harness.mjs';

const day = o => { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().split('T')[0]; };
const p2 = n => String(n).padStart(2, '0');
// "มีผลทันที" = ประทับเวลาปัจจุบัน ไม่ใช่วันที่ย้อนหลังไกล ๆ
// (เรทที่มีผลย้อนไปปี 2000 ย่อมแพ้เรทที่มีผลเมื่อ 7 วันก่อน ซึ่งถูกต้องแล้ว)
const nowStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

console.log('\n[1] ราคาจากวอน x เรท + ค่าบริการ ต้องเท่าราคาบาทเดิมที่เรทตั้งต้น');
{
  const { K } = loadStore();
  eq('เรทปัจจุบัน', K.getCurrentRate().rate, 0.0265);
  eq('BTS', K.getPriceTHB('bts'), 890);
  eq('NewJeans', K.getPriceTHB('newjeans'), 750);
  eq('BLACKPINK', K.getPriceTHB('blackpink'), 1290);
  eq('aespa', K.getPriceTHB('aespa'), 820);
  const b = K.getPriceBreakdown('bts');
  eq('breakdown วอน', b.krw, 27000);
  eq('breakdown แปลงแล้ว', b.converted, 716);
  eq('breakdown ค่าบริการ', b.serviceFee, 174);
}

console.log('\n[2] ตั้งเรทใหม่ให้มีผลทันที ราคาต้องขยับตาม');
{
  const { K } = loadStore();
  const before = K.getPriceTHB('bts');
  await K.setRate(0.0300, nowStamp(), 'admin', 'ทดสอบ');
  const after = K.getPriceTHB('bts');
  eq('เรทใหม่มีผล', K.getCurrentRate().rate, 0.03);
  eq('ราคาขยับขึ้น', after > before, true);
  eq('ราคาใหม่ = ceil(27000*0.03)+174', after, Math.ceil(27000 * 0.03) + 174);
}

console.log('\n[3] เรทที่ตั้งให้มีผล 22:00 ต้องยังไม่กระทบตอนนี้');
{
  const { K } = loadStore();
  const before = K.getPriceTHB('bts');
  await K.setRate(0.0500);
  eq('ราคายังไม่เปลี่ยนก่อนถึงเวลา', K.getPriceTHB('bts'), before);
  eq('บันทึกเป็น 22:00', K.getRates()[0].effectiveFrom.endsWith('22:00'), true);
}

console.log('\n[4] สถานะรอบคำนวณจากช่วงวันที่จริง');
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

console.log('\n[5] โควตาคำนวณสด + คืนเองเมื่อยกเลิก/ปฏิเสธสลิป');
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

console.log('\n[6] โควตารีเซ็ตเมื่อย้ายสินค้าไปรอบใหม่');
{
  const { K } = loadStore();
  eq('ก่อนย้าย', K.getRemainingQuota('bts'), 48);
  await K.saveProduct({ id: 'bts', roundId: 'round-ship' });
  eq('ย้ายรอบแล้วโควตากลับเป็นเต็ม', K.getRemainingQuota('bts'), 50);
}

console.log('\n[7] โควตาว่าง null = รับไม่จำกัด');
{
  const { K } = loadStore();
  await K.saveProduct({ id: 'bts', quotaPerRound: null });
  eq('คืน null', K.getRemainingQuota('bts'), null);
}

console.log('\n[8] ตะกร้า: จำกัดตามโควตา และปฏิเสธรอบที่ปิด');
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

console.log('\n[9] ตะกร้าแยกกลุ่มตามรอบ และเก็บค่าส่งกลุ่มละครั้ง');
{
  const { K } = loadStore();
  await K.addToCart('bts', 1);
  await K.addToCart('blackpink', 1);
  const { groups } = K.getCartGroupedByRound();
  eq('แยกเป็น 2 กลุ่ม', groups.length, 2);
  const kr = groups.find(g => g.roundId === 'round-kr');
  eq('ค่าส่งกลุ่มละ 50', groups.every(g => g.shippingFee === 50), true);
  eq('ยอดรวมกลุ่ม round-kr = 890 + 50', kr.total, 940);
  eq('กลุ่มที่รอบเปิดสั่งได้', kr.orderable, true);
}

console.log('\n[10] ราคาในตะกร้าขยับตามเรท แต่ยอดในออเดอร์ที่จ่ายแล้วต้องนิ่ง');
{
  const { K } = loadStore();
  await K.addToCart('bts', 1);
  const beforeCart = K.getCartGroupedByRound().groups[0].subtotal;

  const order = (await K.addOrder({
    customerName: 'ก', customerEmail: 'a@b.c', phone: '0', address: 'x',
    items: [{ id: 'bts', title: 'BTS', qty: 1, image: '' }], shippingFee: 50
  })).order;
  eq('ล็อกเรทไว้ในออเดอร์', order.rateUsed, 0.0265);
  eq('ยอดออเดอร์', order.total, 940);
  eq('ผูกรอบให้อัตโนมัติ', order.roundId, 'round-kr');

  await K.setRate(0.0400, nowStamp());
  const afterCart = K.getCartGroupedByRound().groups[0].subtotal;
  eq('ราคาในตะกร้าขยับ', afterCart > beforeCart, true);
  eq('ยอดออเดอร์เดิมไม่ขยับ', K.getOrderById(order.id).total, 940);
  eq('เรทที่ใช้ยังเป็นตัวเดิม', K.getOrderById(order.id).rateUsed, 0.0265);
}

console.log('\n[11] สั่งซื้อทันที (ไม่ผ่านตะกร้า) ต้องไม่ล้างตะกร้าทิ้ง');
{
  const { K } = loadStore();
  await K.addToCart('blackpink', 2);
  await K.addOrder({ customerName: 'ก', customerEmail: 'a@b.c', items: [{ id: 'bts', title: 'BTS', qty: 1 }], shippingFee: 50 });
  eq('ของในตะกร้ายังอยู่', K.getCartCount(), 2);

  await K.clearCartRound('round-ship');
  eq('ล้างเฉพาะรอบนั้น', K.getCartCount(), 0);
}

console.log('\n[12] ใบสรุปรอบสำหรับแอดมินไปกดของ');
{
  const { K } = loadStore();
  const s = K.getRoundSummary('round-kr');
  eq('มี 2 ออเดอร์ในรอบ', s.orderCount, 2);
  eq('รวม BTS 2 ชิ้น', s.items.find(i => i.id === 'bts').qty, 2);
  eq('เรียงจากมากไปน้อย', s.items[0].qty >= s.items[1].qty, true);
}

console.log('\n[12B] ป้าย OUT OF STOCK ต้องหยุดขายจริง ไม่ใช่แค่ป้ายสี');
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

console.log('\n[13] สินค้าเก่าที่ไม่มีราคาวอน ต้องใช้ราคาบาทเดิม');
{
  const { K } = loadStore();
  const bd = K.getPriceBreakdown({ id: 'old', price: 500 });
  eq('ใช้ราคาบาทเดิม', bd.total, 500);
  eq('ทำเครื่องหมายว่าเป็นข้อมูลเก่า', bd.legacy, true);
}

report();
