import { loadStore, eq, report } from './harness.mjs';

const mk = (id, day, qty, statusCode) => ({
  id, customerName: 'ทดสอบ', date: day + ' 10:00', statusCode,
  items: [{ id: 'bts', title: 'BTS', price: 100, qty }], total: 100 * qty
});

console.log('\n[1] รวมยอดสั่งเป็นรายวัน เรียงเก่า->ใหม่ พร้อมยอดสะสม');
{
  const { K } = loadStore([
    mk('A', '2026-08-01', 2, 'PAID_WAIT_ROUND'),
    mk('B', '2026-08-01', 3, 'PENDING_SLIP'),
    mk('C', '2026-08-03', 1, 'DELIVERED')
  ]);
  const rows = K.getDailyOrdersForProduct('bts');
  eq('มี 2 วัน', rows.length, 2);
  eq('วันแรกเรียงก่อน', rows[0].day, '2026-08-01');
  eq('วันแรก 5 ชิ้น', rows[0].qty, 5);
  eq('วันแรก 2 ออเดอร์', rows[0].orders, 2);
  eq('วันแรกยอดเงิน', rows[0].amount, 500);
  eq('สะสมวันแรก', rows[0].cumulativeQty, 5);
  eq('สะสมวันที่สอง', rows[1].cumulativeQty, 6);
}

console.log('\n[2] ออเดอร์ที่ไม่กินโควตา (ยกเลิก) ไม่ถูกนับ');
{
  const { K } = loadStore([
    mk('A', '2026-08-01', 2, 'PAID_WAIT_ROUND'),
    mk('B', '2026-08-01', 9, 'CANCELLED_USER'),
    mk('C', '2026-08-02', 4, 'SLIP_REJECTED')
  ]);
  const rows = K.getDailyOrdersForProduct('bts');
  eq('เหลือวันเดียว', rows.length, 1);
  eq('นับเฉพาะ 2 ชิ้น', rows[0].qty, 2);
}

console.log('\n[3] สินค้าที่ไม่มีออเดอร์ -> อาร์เรย์ว่าง');
{
  const { K } = loadStore([]);
  eq('ว่าง', K.getDailyOrdersForProduct('bts').length, 0);
}

report();
