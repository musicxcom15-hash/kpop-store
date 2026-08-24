import { loadStore, eq, report } from './harness.mjs';

console.log('\n[1] ลบออเดอร์แล้วหายจากระบบจริง');
{
  const { K } = loadStore();
  const before = K.getOrders().length;
  const res = await K.deleteOrder('ORD-2026070102');

  eq('ลบสำเร็จ', res.success, true);
  eq('จำนวนออเดอร์ลดลง 1', K.getOrders().length, before - 1);
  eq('หาไม่เจอแล้ว', K.getOrderById('ORD-2026070102'), undefined);
  eq('ออเดอร์อื่นต้องยังอยู่', K.getOrderById('ORD-2026071301').id, 'ORD-2026071301');
}

console.log('\n[2] ลบออเดอร์ที่ยังกินโควตา -> โควตาคืนเอง');
{
  const { K } = loadStore();
  // ORD-2026062815 = BTS x2 สถานะ PREPARING (ยังกินโควตา)
  eq('ก่อนลบ BTS เหลือ 48', K.getRemainingQuota('bts'), 48);
  eq('ออเดอร์นี้ยังกินโควตาจริง', K.isQuotaConsuming(K.getOrderById('ORD-2026062815')), true);

  await K.deleteOrder('ORD-2026062815');
  eq('ลบแล้วโควตาคืนเป็น 50', K.getRemainingQuota('bts'), 50);
}

console.log('\n[3] ลบออเดอร์ที่ยกเลิกไปแล้ว -> โควตาต้องไม่เปลี่ยน');
{
  const { K } = loadStore();
  await K.rejectPayment('ORD-2026071301', 'สลิปไม่ตรง');
  const afterReject = K.getRemainingQuota('newjeans');
  eq('ปฏิเสธแล้วโควตาคืนไปก่อนหน้า', afterReject, 35);
  eq('ออเดอร์นี้ไม่กินโควตาแล้ว', K.isQuotaConsuming(K.getOrderById('ORD-2026071301')), false);

  await K.deleteOrder('ORD-2026071301');
  eq('ลบแล้วโควตาเท่าเดิม ไม่บวกซ้ำ', K.getRemainingQuota('newjeans'), afterReject);
}

console.log('\n[4] ยอดขายรวมและใบสรุปรอบอัปเดตตาม');
{
  const { K } = loadStore();
  const revenue = () => K.getOrders().filter(o => K.countsAsRevenue(o)).reduce((s, o) => s + (o.total || 0), 0);

  const before = revenue();
  const amount = K.getOrderById('ORD-2026062815').total;
  const summaryBefore = K.getRoundSummary('round-kr');

  await K.deleteOrder('ORD-2026062815');

  eq('ยอดขายลดลงเท่ายอดที่ลบ', before - revenue(), amount);
  const summaryAfter = K.getRoundSummary('round-kr');
  eq('จำนวนออเดอร์ในใบสรุปรอบลดลง', summaryAfter.orderCount, summaryBefore.orderCount - 1);
  eq('BTS หายจากใบสรุปรอบ', summaryAfter.items.some(i => i.id === 'bts'), false);
}

console.log('\n[5] ลบ id ที่ไม่มีอยู่ ต้องไม่พังและไม่ลบมั่ว');
{
  const { K } = loadStore();
  const before = K.getOrders().length;
  const res = await K.deleteOrder('ORD-ไม่มีอยู่จริง');

  eq('success = false', res.success, false);
  eq('มีข้อความบอก', res.message.length > 0, true);
  eq('ไม่มีออเดอร์ไหนหายไป', K.getOrders().length, before);
}

console.log('\n[6] บันทึกไม่ลง ต้องบอกว่าล้มเหลว ไม่ใช่บอกว่าสำเร็จ');
{
  const { K, storage } = loadStore();
  const before = K.getOrders().length;

  storage._startFailing();
  const res = await K.deleteOrder('ORD-2026070102');

  eq('success = false', res.success, false);
  eq('มีข้อความบอก', res.message.length > 0, true);
  eq('ข้อมูลในหน่วยความจำต้องไม่ถูกลบไปด้วย', K.getOrders().length, before);
}

console.log('\n[7] ลบทุกออเดอร์แล้วระบบต้องยังทำงานได้');
{
  const { K } = loadStore();
  // ใช้ for...of เพราะ deleteOrder เป็น async แล้ว — await ใน forEach ไม่ทำงาน
  for (const o of K.getOrders().slice()) await K.deleteOrder(o.id);

  eq('ไม่เหลือออเดอร์', K.getOrders().length, 0);
  eq('โควตากลับเป็นเต็มทุกตัว', K.getRemainingQuota('bts'), 50);
  eq('ใบสรุปรอบว่างแต่ไม่พัง', K.getRoundSummary('round-kr').orderCount, 0);
  eq('ยังสั่งซื้อใหม่ได้', (await K.addOrder({
    customerName: 'ก', customerEmail: 'a@b.c',
    items: [{ id: 'bts', title: 'BTS', qty: 1 }], shippingFee: 50
  })).order.total, 940);
}

report();
