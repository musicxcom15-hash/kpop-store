// ทดสอบรายงานยอดสั่งรายวันของสินค้า (ไม่นับออเดอร์ที่ยกเลิก · สินค้าไม่มีออเดอร์ได้อาร์เรย์ว่าง)
// และสรุปรายได้รายวันทั้งร้าน (getDailyRevenue)
// รันเดี่ยว: node tests/daily-orders.test.mjs · รันทั้งหมด: npm test
//
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

console.log('\n[4] สรุปรายได้รายวัน: แยกค่าสินค้า / ค่าบริการ / ค่าส่ง');
{
  // ชิ้นละ 600 = ค่าสินค้า 500 + ค่าบริการ 100 · ค่าส่ง 50 ต่อออเดอร์
  const rev = (id, day, qty, statusCode) => ({
    id, customerName: 'ทดสอบ', date: day + ' 10:00', statusCode, shippingFee: 50,
    items: [{ id: 'bts', title: 'BTS', price: 600, serviceFee: 100, qty }], total: 600 * qty + 50
  });
  const { K } = loadStore([
    rev('A', '2026-08-01', 2, 'PAID_WAIT_ROUND'),
    rev('B', '2026-08-01', 1, 'DELIVERED'),
    rev('C', '2026-08-01', 3, 'PENDING_SLIP'),
    rev('D', '2026-08-01', 5, 'CANCELLED_USER'),
    rev('E', '2026-08-02', 1, 'REFUNDED'),
    rev('F', '2026-08-03', 1, 'ORDERED_KR')
  ]);
  const rows = K.getDailyRevenue();
  eq('วันที่คืนเงินอย่างเดียวไม่โผล่', rows.map(d => d.day).join(','), '2026-08-01,2026-08-03');
  const d = rows[0];
  eq('นับ 2 ออเดอร์ที่ยืนยันแล้ว', d.orders, 2);
  eq('3 ชิ้น', d.items, 3);
  eq('ยอดรับเงิน', d.total, 1900);
  eq('ค่าบริการ', d.serviceFee, 300);
  eq('ค่าส่ง', d.shipping, 100);
  eq('ค่าสินค้า = ยอด - ค่าบริการ - ค่าส่ง', d.goods, 1500);
  eq('สลิปรอตรวจแยกไว้ ไม่นับเป็นรายได้', [d.pendingOrders, d.pendingTotal].join('/'), '1/1850');
}

console.log('\n[5] ออเดอร์เก่าที่ไม่มีค่าบริการ -> นับเป็นค่าสินค้าทั้งหมด');
{
  const { K } = loadStore([mk('A', '2026-08-01', 2, 'DELIVERED')]);
  const d = K.getDailyRevenue()[0];
  eq('ค่าบริการ 0', d.serviceFee, 0);
  eq('ค่าสินค้าเท่ายอด', d.goods, 200);
}

report();
