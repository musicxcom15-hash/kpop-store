import { loadStore, eq, report } from './harness.mjs';

console.log('\n[1] สถานะใหม่ตกกลุ่มถูกต้อง (เคสที่ระบบเดิมจะพลาด)');
{
  const { K } = loadStore();
  eq('ORDERED_KR -> processing', K.getStatusGroup({ statusCode: 'ORDERED_KR' }), 'processing');
  // ข้อความมีคำว่า "สำเร็จ" อยู่ ระบบเดิมที่ใช้ includes() จะจับเป็นกลุ่ม shipped
  eq('PURCHASE_FAILED -> refund ไม่ใช่ shipped', K.getStatusGroup({ statusCode: 'PURCHASE_FAILED' }), 'refund');
  eq('REFUND_PENDING -> refund', K.getStatusGroup({ statusCode: 'REFUND_PENDING' }), 'refund');
  eq('REFUNDED -> refund', K.getStatusGroup({ statusCode: 'REFUNDED' }), 'refund');
  eq('ข้อความ PURCHASE_FAILED มีคำว่าสำเร็จจริง',
     K.ORDER_STATUS.PURCHASE_FAILED.text.includes('สำเร็จ'), true);
}

console.log('\n[2] หลังร้านกดสั่งกับเกาหลีแล้ว ลูกค้ายกเลิกเองไม่ได้');
{
  const { K } = loadStore();
  eq('PAID_WAIT_ROUND ยกเลิกได้', K.canCancelOrder({ statusCode: 'PAID_WAIT_ROUND' }), true);
  eq('ROUND_CLOSED ยกเลิกได้', K.canCancelOrder({ statusCode: 'ROUND_CLOSED' }), true);
  eq('ORDERED_KR ยกเลิกไม่ได้ (ร้านจ่ายเงินไปแล้ว)', K.canCancelOrder({ statusCode: 'ORDERED_KR' }), false);
  eq('PREPARING ยกเลิกไม่ได้ (อยู่หลังกดของแล้ว)', K.canCancelOrder({ statusCode: 'PREPARING' }), false);

  // เรียกผ่าน API จริง ไม่ใช่แค่เช็ค flag
  await K.updateOrderStatus('ORD-2026071301', 'ORDERED_KR');
  const res = await K.cancelOrderCustomer('ORD-2026071301', 'เปลี่ยนใจ');
  eq('cancelOrderCustomer ต้องถูกปฏิเสธ', res.success, false);
  eq('สถานะต้องไม่เปลี่ยน', K.getOrderById('ORD-2026071301').statusCode, 'ORDERED_KR');
}

console.log('\n[3] flow กดของไม่สำเร็จ -> คืนเงิน');
{
  const { K } = loadStore();
  const before = K.getRemainingQuota('newjeans');
  eq('ก่อนหน้า โควตาถูกใช้ไป 1', before, 34);

  await K.markPurchaseFailed('ORD-2026071301', 'ของหมดที่ Weverse');
  const o = K.getOrderById('ORD-2026071301');
  eq('สถานะเป็นรอคืนเงิน', o.statusCode, 'REFUND_PENDING');
  eq('อยู่กลุ่ม refund', K.getStatusGroup(o), 'refund');
  eq('โควตาคืนเข้ารอบทันที', K.getRemainingQuota('newjeans'), 35);
  eq('ไม่ถูกนับเป็นรายได้แล้ว', K.countsAsRevenue(o), false);

  const notis = K.getNotifications('user@kpopstore.com');
  eq('แจ้งลูกค้าว่ากดไม่สำเร็จ', notis.some(n => n.title.includes('ไม่สำเร็จ')), true);

  await K.markRefunded('ORD-2026071301', 'โอนคืนแล้ว 12:00');
  const done = K.getOrderById('ORD-2026071301');
  eq('สถานะคืนเงินแล้ว', done.statusCode, 'REFUNDED');
  eq('บันทึกเวลาคืนเงิน', typeof done.refundedAt === 'string' && done.refundedAt.length > 0, true);
  eq('บันทึกหมายเหตุ', done.refundNote, 'โอนคืนแล้ว 12:00');
  eq('แจ้งลูกค้าว่าคืนเงินแล้ว',
     K.getNotifications('user@kpopstore.com').some(n => n.title.includes('คืนเงิน')), true);
}

console.log('\n[4] ยอดขายรวมต้องลดลงเมื่อคืนเงิน (บั๊กบัญชีเดิม)');
{
  const { K } = loadStore();
  const sum = () => K.getOrders().filter(o => K.countsAsRevenue(o)).reduce((s, o) => s + (o.total || 0), 0);

  const before = sum();
  const amount = K.getOrderById('ORD-2026071301').total;
  await K.markPurchaseFailed('ORD-2026071301');
  await K.markRefunded('ORD-2026071301');
  eq('ยอดขายลดลงเท่ายอดที่คืน', before - sum(), amount);
}

console.log('\n[5] ทุกสถานะมีข้อมูลครบสำหรับ UI');
{
  const { K } = loadStore();
  const statuses = K.listStatuses();
  eq('มี 12 สถานะ', statuses.length, 12);
  const bad = statuses.filter(s => !s.text || !s.short || !s.group || !s.badge || !s.icon);
  eq('ทุกสถานะมี text/short/group/badge/icon ครบ', bad.map(s => s.code), []);
  const groups = [...new Set(statuses.map(s => s.group))].sort();
  eq('กลุ่มทั้งหมด', groups, ['cancelled', 'pending', 'processing', 'refund', 'shipped']);
}

console.log('\n[6] migration เดิมยังทำงาน หลังเพิ่มสถานะใหม่');
{
  const legacy = [
    { id: 'A', status: 'รอตรวจสอบชำระเงิน', items: [], total: 100 },
    { id: 'B', status: 'จัดส่งสำเร็จ', items: [], total: 100 },
    { id: 'C', status: 'ยกเลิกคำสั่งซื้อโดยลูกค้า', items: [], total: 100 }
  ];
  const { raw } = loadStore(legacy);
  eq('A', raw().find(o => o.id === 'A').statusCode, 'PENDING_SLIP');
  eq('B', raw().find(o => o.id === 'B').statusCode, 'DELIVERED');
  eq('C', raw().find(o => o.id === 'C').statusCode, 'CANCELLED_USER');
}

report();
