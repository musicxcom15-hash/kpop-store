import { loadStore, eq, report } from './harness.mjs';

console.log('\n[1] migration: ออเดอร์เก่าที่มีแต่ข้อความไทย ต้องได้ statusCode');
{
  const legacy = [
    { id:'A', status:'รอตรวจสอบชำระเงิน', items:[], total:100 },
    { id:'B', status:'กำลังจัดเตรียมสินค้า', items:[], total:100 },
    { id:'C', status:'กำลังจัดส่งสินค้า', items:[], total:100 },
    { id:'D', status:'จัดส่งสำเร็จ', items:[], total:100 },
    { id:'E', status:'ยกเลิกคำสั่งซื้อ / สลิปไม่ถูกต้อง', items:[], total:100 },
    { id:'F', status:'ยกเลิกคำสั่งซื้อโดยลูกค้า', items:[], total:100 },
    { id:'G', status:'ข้อความประหลาดที่ไม่เคยมีในตาราง', items:[], total:100 }
  ];
  const { raw } = loadStore(legacy);
  eq('A', raw().find(o=>o.id==='A').statusCode, 'PENDING_SLIP');
  eq('B', raw().find(o=>o.id==='B').statusCode, 'PREPARING');
  eq('C', raw().find(o=>o.id==='C').statusCode, 'SHIPPING');
  eq('D', raw().find(o=>o.id==='D').statusCode, 'DELIVERED');
  eq('E', raw().find(o=>o.id==='E').statusCode, 'SLIP_REJECTED');
  eq('F ลูกค้ายกเลิก ต้องไม่ปนกับสลิปไม่ผ่าน', raw().find(o=>o.id==='F').statusCode, 'CANCELLED_USER');
  eq('G ข้อความไม่รู้จัก fallback', raw().find(o=>o.id==='G').statusCode, 'PENDING_SLIP');
}

console.log('\n[2] กฎ canCancel / canReuploadSlip ต้องตรงกับพฤติกรรมเดิม');
{
  const { K } = loadStore([]);
  const cases = [
    ['PENDING_SLIP',   true,  true],
    // เปลี่ยนโดยตั้งใจ: PREPARING อยู่หลังร้านกดของที่เกาหลีแล้ว จึงยกเลิกไม่ได้
    ['PREPARING',      false, false],
    ['SHIPPING',       false, false],
    ['DELIVERED',      false, false],
    ['SLIP_REJECTED',  false, true],
    ['CANCELLED_USER', false, false]
  ];
  for (const [code, cancel, reup] of cases) {
    eq(`${code} canCancel`, K.canCancelOrder({ statusCode: code }), cancel);
    eq(`${code} canReuploadSlip`, K.canReuploadSlip({ statusCode: code }), reup);
  }
}

console.log('\n[3] ยกเลิกออเดอร์ -> statusCode กับ status ต้องตรงกัน');
{
  const { K, raw } = loadStore([{ id:'X', customerEmail:'a@b.c', customerName:'ก', status:'รอตรวจสอบชำระเงิน', items:[{id:'bts',qty:2}], total:100 }]);
  const r = await K.cancelOrderCustomer('X', 'เปลี่ยนใจ');
  eq('ยกเลิกสำเร็จ', r.success, true);
  const o = raw().find(x=>x.id==='X');
  eq('statusCode', o.statusCode, 'CANCELLED_USER');
  eq('status text ตรงกับตาราง', o.status, 'ยกเลิกคำสั่งซื้อโดยลูกค้า');
  eq('ยกเลิกซ้ำต้องไม่ผ่าน', (await K.cancelOrderCustomer('X')).success, false);
}

console.log('\n[4] ยกเลิกออเดอร์ที่จัดส่งแล้วต้องไม่ผ่าน');
{
  const { K } = loadStore([{ id:'Y', status:'จัดส่งสำเร็จ', items:[], total:100 }]);
  eq('บล็อกการยกเลิก', (await K.cancelOrderCustomer('Y')).success, false);
}

console.log('\n[5] อนุมัติ/ปฏิเสธสลิป');
{
  const { K, raw } = loadStore([{ id:'Z', customerEmail:'a@b.c', status:'รอตรวจสอบชำระเงิน', items:[], total:100 }]);
  await K.approvePayment('Z');
  eq('อนุมัติ -> รอปิดรอบ (ไม่กระโดดไปแพ็กของ)', raw().find(o=>o.id==='Z').statusCode, 'PAID_WAIT_ROUND');
  await K.rejectPayment('Z', 'ยอดไม่ตรง');
  eq('ปฏิเสธ -> SLIP_REJECTED', raw().find(o=>o.id==='Z').statusCode, 'SLIP_REJECTED');
  eq('ปฏิเสธแล้วส่งสลิปใหม่ได้', K.canReuploadSlip(raw().find(o=>o.id==='Z')), true);
}

console.log('\n[6] ออเดอร์ที่ลูกค้ายกเลิกเอง ห้ามส่งสลิปใหม่ (บั๊ก 5.5 เดิม)');
{
  const { K, raw } = loadStore([{ id:'W', customerEmail:'a@b.c', customerName:'ก', status:'รอตรวจสอบชำระเงิน', items:[], total:100 }]);
  await K.cancelOrderCustomer('W');
  eq('updateOrderSlip ต้องไม่สำเร็จ', (await K.updateOrderSlip('W', 'data:image/jpeg;base64,xxx')).success, false);
  eq('สถานะต้องยังเป็นยกเลิก', raw().find(o=>o.id==='W').statusCode, 'CANCELLED_USER');
}

console.log('\n[6B] ล้างเลขพัสดุ/หมายเหตุด้วยค่าว่างต้องล้างได้จริง');
{
  const { K, raw } = loadStore([{ id:'T', customerEmail:'a@b.c', status:'กำลังจัดส่งสินค้า', items:[], total:100, trackingNumber:'TH999', adminNotes:'เดิม' }]);

  // ไม่ส่งค่ามา = ไม่แตะของเดิม
  await K.updateOrderStatus('T', 'SHIPPING');
  eq('ไม่ส่งค่ามาต้องไม่ล้างของเดิม', raw().find(o=>o.id==='T').trackingNumber, 'TH999');

  // ส่งค่าว่างมา = ตั้งใจล้าง (แอดมินพิมพ์เลขผิดแล้วลบทิ้ง)
  await K.updateOrderStatus('T', 'SHIPPING', '', '');
  eq('ค่าว่างต้องล้างเลขพัสดุ', raw().find(o=>o.id==='T').trackingNumber, '');
  eq('ค่าว่างต้องล้างหมายเหตุ', raw().find(o=>o.id==='T').adminNotes, '');
}

console.log('\n[6C] กดของไม่สำเร็จ ต้องแจ้งเตือนลูกค้าใบเดียว');
{
  const { K } = loadStore();
  const before = K.getNotifications('user@kpopstore.com').length;

  await K.markPurchaseFailed('ORD-2026071301', 'ของหมด');
  const added = K.getNotifications('user@kpopstore.com').length - before;

  eq('เพิ่มแจ้งเตือนใบเดียว (เดิม 3 ใบ)', added, 1);
  eq('สถานะไปที่รอคืนเงินเลย', K.getOrderById('ORD-2026071301').statusCode, 'REFUND_PENDING');
}

console.log('\n[6D] id ของแจ้งเตือนต้องไม่ซ้ำแม้สร้างรัวในมิลลิวินาทีเดียว');
{
  const { K } = loadStore([]);
  for (let i = 0; i < 20; i++) await K.addNotification({ userEmail: 'a@b.c', title: 't', message: 'm' });

  const ids = K.getNotifications('a@b.c').map(n => n.id);
  eq('20 ใบต้องได้ 20 id ที่ไม่ซ้ำกัน', new Set(ids).size, 20);
}

console.log('\n[7] ยอดขาย: countsAsRevenue');
{
  const { K } = loadStore([]);
  eq('PENDING_SLIP นับ', K.countsAsRevenue({statusCode:'PENDING_SLIP'}), true);
  eq('DELIVERED นับ', K.countsAsRevenue({statusCode:'DELIVERED'}), true);
  eq('SLIP_REJECTED ไม่นับ', K.countsAsRevenue({statusCode:'SLIP_REJECTED'}), false);
  eq('CANCELLED_USER ไม่นับ (เดิมหลุดเข้ามาเป็นรายได้)', K.countsAsRevenue({statusCode:'CANCELLED_USER'}), false);
}

report();
