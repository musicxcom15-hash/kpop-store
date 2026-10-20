let currentActiveSlipOrderId = null;

// ใช้ตัวกลางจาก ui.js ตัวเดียวทั้งระบบ
// (เดิมแต่ละหน้านิยามเอง และ escArg ของหน้านี้ทำไม่ครบ — ค่าที่มี " ทำ attribute แตกได้)
const esc = KpopStore.esc;
const escArg = KpopStore.escArg;

KpopStore.ready(function () {
    checkAdminAuth();
});

function checkAdminAuth() {
    const user = KpopStore.getCurrentUser();
    if (!user || user.role !== 'admin') {
        document.getElementById('adminGuardContainer').style.display = 'block';
        document.getElementById('adminMainContainer').style.display = 'none';
    } else {
        document.getElementById('adminGuardContainer').style.display = 'none';
        document.getElementById('adminMainContainer').style.display = 'block';
        document.getElementById('adminNameDisplay').innerText = user.name;

        // Render initial data
        populateStatusSelects();
        renderAdminDashboard();
        renderSlipsTable();
        renderOrdersTable();
        renderProductsTable();
        renderStorageUsage();
        renderRoundsTable();
        renderUsersTable();
        populateNotificationUserSelect();
        populateReportProductSelect();
    }
}

// เติม dropdown สถานะทั้ง 2 ตัวจากตารางกลาง เพิ่มสถานะใหม่ในอนาคตแล้วโผล่เองทั้งคู่
function populateStatusSelects() {
    const statuses = KpopStore.listStatuses();

    const filterSelect = document.getElementById('orderStatusFilter');
    filterSelect.innerHTML = `<option value="ALL">สถานะทั้งหมด</option>` +
        statuses.map(s => `<option value="${s.code}">${s.text}</option>`).join('');

    const editSelect = document.getElementById('editOrderStatusSelect');
    editSelect.innerHTML = statuses
        .map((s, i) => `<option value="${s.code}">${i + 1}. ${s.text}</option>`)
        .join('');
}

function switchTab(tabId) {
    const tabBtn = document.getElementById(tabId);
    if (tabBtn) {
        const bsTab = new bootstrap.Tab(tabBtn);
        bsTab.show();
    }
}

// --- DASHBOARD RENDERER ---
function renderAdminDashboard() {
    const orders = KpopStore.getOrders();
    const products = KpopStore.getProducts();

    // ยอดขายรวม — นับเฉพาะสถานะที่ flag revenue = true ในตาราง KpopStore.ORDER_STATUS
    // เดิมกรองออกด้วยข้อความไทย 2 ตัวตายตัว สถานะยกเลิกแบบอื่นจึงหลุดเข้ามาเป็นรายได้
    const totalSales = orders
        .filter(o => KpopStore.countsAsRevenue(o))
        .reduce((sum, o) => sum + (o.total || 0), 0);

    const pendingSlips = orders.filter(o => KpopStore.getStatusMeta(o).group === 'pending').length;

    document.getElementById('kpiTotalSales').innerText = '฿' + totalSales.toLocaleString();
    document.getElementById('kpiTotalOrders').innerText = orders.length;
    document.getElementById('kpiPendingSlips').innerText = pendingSlips;
    document.getElementById('kpiTotalProducts').innerText = products.length;
    document.getElementById('badgePendingSlips').innerText = pendingSlips;

    // เรทและรอบที่เปิดอยู่
    const rate = KpopStore.getCurrentRate();
    document.getElementById('dashRateValue').innerText = `${rate.rate}  (₩1,000 = ฿${(rate.rate * 1000).toFixed(2)})`;
    document.getElementById('dashRateMeta').innerText = 'เรทกลางคงที่ของร้าน';

    const openRounds = KpopStore.getRounds().filter(r => KpopStore.getRoundState(r) === 'open');
    document.getElementById('dashOpenRounds').innerHTML = openRounds.length === 0
        ? '<span class="text-muted" style="font-size:0.88rem;">ไม่มีรอบที่เปิดรับอยู่ — ลูกค้าสั่งซื้อไม่ได้จนกว่าจะเปิดรอบใหม่</span>'
        : openRounds.map(r => `
                    <button class="btn btn-sm btn-outline-dark rounded-pill px-3 text-start" onclick="switchTab('tab-rounds-tab')">
                        <i class="fa-solid fa-circle text-success me-1" style="font-size:0.55rem;"></i>
                        ${esc(r.name)}
                        <span class="text-muted ms-1" style="font-size:0.78rem;">ปิดรับ ${esc(r.closeAt)}</span>
                    </button>
                `).join('');

    // Render Recent 5 Orders Table
    const recentOrders = orders.slice(0, 5);
    const tbody = document.getElementById('dashRecentOrdersTable');
    tbody.innerHTML = recentOrders.map(o => `
                <tr>
                    <td class="fw-bold">${esc(o.id)}</td>
                    <td>${esc(o.customerName)}</td>
                    <td style="font-size:0.85rem;">${(o.items || []).map(i => `${esc(i.title)} (x${Number(i.qty) || 0})`).join(', ')}</td>
                    <td class="fw-bold text-danger">฿${(o.total || 0).toLocaleString()}</td>
                    <td>${renderStatusBadge(o)}</td>
                </tr>
            `).join('');

    // แผงสัดส่วนสถานะ — สร้างจากตารางสถานะ ไม่ hardcode รายชื่ออีก
    // ซ่อนสถานะที่ยังไม่มีออเดอร์ เพื่อไม่ให้แถบรกเมื่อสถานะเยอะขึ้น
    const total = orders.length || 1;
    const breakdown = KpopStore.listStatuses()
        .map(s => Object.assign({}, s, {
            count: orders.filter(o => KpopStore.getStatusMeta(o).text === s.text).length
        }))
        .filter(s => s.count > 0);

    document.getElementById('statusBreakdownContainer').innerHTML = breakdown.length === 0
        ? '<div class="text-muted" style="font-size: 0.9rem;">ยังไม่มีคำสั่งซื้อในระบบ</div>'
        : breakdown.map(s => `
                    <div>
                        <div class="d-flex justify-content-between text-muted fs-6 mb-1">
                            <span><i class="fa-solid ${s.icon} me-1"></i>${s.text}</span>
                            <strong>${s.count} รายการ</strong>
                        </div>
                        <div class="progress" style="height: 8px;">
                            <div class="progress-bar bg-${s.badge}" style="width: ${(s.count / total) * 100}%"></div>
                        </div>
                    </div>
                `).join('');

    renderDailyProductOrders();
}

// ยอดสั่งรายวันของสินค้าที่เลือก — dropdown สร้างใหม่เฉพาะตอนยังว่าง/สินค้าเปลี่ยน เพื่อไม่ทิ้งค่าที่แอดมินเลือกไว้
function renderDailyProductOrders() {
    const sel = document.getElementById('dailyProductSelect');
    const products = KpopStore.getProducts();
    if (sel.options.length !== products.length) {
        const totals = {};
        products.forEach(p => {
            totals[p.id] = KpopStore.getDailyOrdersForProduct(p.id).reduce((s, d) => s + d.qty, 0);
        });
        const sorted = products.slice().sort((a, b) => totals[b.id] - totals[a.id]);
        sel.innerHTML = sorted.map(p =>
            `<option value="${esc(String(p.id))}">${esc(p.title || p.name || p.id)} (${totals[p.id]} ชิ้น)</option>`
        ).join('');
    }

    const summary = document.getElementById('dailyProductSummary');
    const tbody = document.getElementById('dailyProductTable');
    if (!sel.value) {
        summary.innerText = '';
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center">ยังไม่มีสินค้า</td></tr>';
        return;
    }

    let rows = KpopStore.getDailyOrdersForProduct(sel.value);
    const totalQty = rows.length ? rows[rows.length - 1].cumulativeQty : 0;
    const product = products.find(p => String(p.id) === sel.value);
    const cap = product && product.quotaPerRound;
    summary.innerText = `รวมทั้งหมด ${totalQty} ชิ้น` +
        (cap !== null && cap !== undefined && isFinite(Number(cap)) ? ` / โควตา ${Number(cap)} ชิ้นต่อรอบ` : '');

    const range = Number(document.getElementById('dailyRangeSelect').value);
    if (range > 0) {
        const from = new Date();
        from.setDate(from.getDate() - range + 1);
        const fromDay = from.getFullYear() + '-' + String(from.getMonth() + 1).padStart(2, '0') + '-' + String(from.getDate()).padStart(2, '0');
        rows = rows.filter(d => d.day >= fromDay);
    }

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center">ไม่มียอดสั่งในช่วงนี้</td></tr>';
        return;
    }
    const maxQty = Math.max.apply(null, rows.map(d => d.qty)) || 1;
    // แสดงวันล่าสุดก่อน
    tbody.innerHTML = rows.slice().reverse().map(d => `
                <tr>
                    <td class="fw-bold">${esc(d.day)}</td>
                    <td>
                        <div class="fw-bold">${d.qty}</div>
                        <div class="progress" style="height:6px;"><div class="progress-bar bg-info" style="width:${(d.qty / maxQty) * 100}%"></div></div>
                    </td>
                    <td>${d.orders}</td>
                    <td class="text-danger fw-bold">฿${d.amount.toLocaleString()}</td>
                    <td>${d.cumulativeQty}</td>
                </tr>
            `).join('');
}

// รับได้ทั้ง order object และข้อความสถานะ — สี/ไอคอน/ข้อความย่อมาจากตารางกลาง
function renderStatusBadge(order) {
    const meta = KpopStore.getStatusMeta(order);
    const cssByGroup = {
        pending: 'badge-status-pending',
        processing: 'badge-status-processing',
        shipped: meta.badge === 'success' ? 'badge-status-success' : 'badge-status-shipping',
        cancelled: 'badge-status-rejected',
        refund: 'badge-status-refund'
    };
    const css = cssByGroup[meta.group] || 'badge-status-rejected';
    return `<span class="${css}"><i class="fa-solid ${meta.icon} me-1"></i>${meta.short}</span>`;
}

// --- SLIPS TABLE RENDERER ---
function renderSlipsTable() {
    const pendingOrders = KpopStore.getOrders().filter(o => KpopStore.getStatusMeta(o).group === 'pending');
    const tbody = document.getElementById('slipsTableBody');

    if (pendingOrders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-5"><i class="fa-solid fa-circle-check fs-1 d-block mb-2 text-success opacity-50"></i>ไม่มีรายการสลิปที่ค้างตรวจสอบในขณะนี้</td></tr>`;
        return;
    }

    tbody.innerHTML = pendingOrders.map(o => `
                <tr>
                    <td class="fw-bold text-primary">${esc(o.id)}</td>
                    <td>
                        <div class="fw-bold">${esc(o.customerName)}</div>
                        <small class="text-muted">${esc(o.customerEmail)}</small>
                    </td>
                    <td class="fw-bold text-danger">฿${(o.total || 0).toLocaleString()}</td>
                    <td>
                        ${o.slipImage
                    ? `<img src="${esc(o.slipImage)}" class="slip-preview-thumb" onclick="inspectSlip('${escArg(o.id)}')" title="คลิกเพื่อขยายสลิป">`
                    : `<span class="badge bg-secondary">ยังไม่แนบสลิป</span>`}
                    </td>
                    <td class="text-muted" style="font-size:0.85rem;">${esc(o.date)}</td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-warning rounded-pill px-3 fw-bold me-1" onclick="inspectSlip('${escArg(o.id)}')"><i class="fa-solid fa-magnifying-glass me-1"></i> ตรวจสอบสลิป</button>
                    </td>
                </tr>
            `).join('');
}

function inspectSlip(orderId) {
    const order = KpopStore.getOrderById(orderId);
    if (!order) return;

    currentActiveSlipOrderId = orderId;

    // ออเดอร์ที่ไม่มีสลิปต้องไม่ถูกอนุมัติ
    // ของเดิมใส่รูปสำรองจาก Unsplash ทำให้แอดมินเห็น "สลิป" ที่ไม่มีอยู่จริง
    // แล้วกดอนุมัติยอดเงินทั้งที่ไม่เคยมีหลักฐานการโอนเลย
    const slipImg = document.getElementById('modalSlipImage');
    const approveBtn = document.getElementById('slipApproveBtn');
    const noSlipWarn = document.getElementById('slipMissingWarning');

    if (order.slipImage) {
        slipImg.src = order.slipImage;
        slipImg.classList.remove('d-none');
        if (noSlipWarn) noSlipWarn.classList.add('d-none');
        if (approveBtn) approveBtn.disabled = false;
    } else {
        slipImg.removeAttribute('src');
        slipImg.classList.add('d-none');
        if (noSlipWarn) noSlipWarn.classList.remove('d-none');
        if (approveBtn) approveBtn.disabled = true;
    }

    document.getElementById('modalSlipOrderId').innerText = '#' + order.id;
    document.getElementById('modalSlipCustomer').innerText = order.customerName;
    document.getElementById('modalSlipDate').innerText = 'วันที่สั่งซื้อ: ' + order.date;
    document.getElementById('modalSlipTotal').innerText = '฿' + (order.total || 0).toLocaleString();
    document.getElementById('modalSlipPhone').innerText = order.phone || '-';
    document.getElementById('slipDecisionNotes').value = '';

    const modal = new bootstrap.Modal(document.getElementById('slipModal'));
    modal.show();
}

async function executeApprovePayment() {
    if (!currentActiveSlipOrderId) return;

    // กันการอนุมัติออเดอร์ที่ไม่มีสลิป แม้ปุ่มจะถูก disable ไว้แล้ว
    const target = KpopStore.getOrderById(currentActiveSlipOrderId);
    if (target && !target.slipImage) {
        alert('อนุมัติไม่ได้ค่ะ คำสั่งซื้อนี้ยังไม่มีหลักฐานการโอนเงินแนบมา');
        return;
    }

    const notes = document.getElementById('slipDecisionNotes').value || 'อนุมัติสลิปและยืนยันยอดเงินเรียบร้อย';
    if (!await KpopStore.approvePayment(currentActiveSlipOrderId, notes)) {
        alert('บันทึกไม่สำเร็จค่ะ ติดต่อฐานข้อมูลไม่ได้หรือคำสั่งซื้อถูกลบไปแล้ว กรุณารีเฟรชแล้วลองใหม่');
        return;
    }

    bootstrap.Modal.getInstance(document.getElementById('slipModal')).hide();
    renderAdminDashboard();
    renderSlipsTable();
    renderOrdersTable();
    alert('อนุมัติการชำระเงินเรียบร้อยแล้ว! ระบบได้ส่งการแจ้งเตือนไปยังลูกค้าเรียบร้อยแล้วค่ะ');
}

async function executeRejectPayment() {
    if (!currentActiveSlipOrderId) return;
    const notes = document.getElementById('slipDecisionNotes').value || 'สลิปโอนเงินไม่ถูกต้อง หรือยอดเงินไม่ตรงกับคำสั่งซื้อ';
    if (!await KpopStore.rejectPayment(currentActiveSlipOrderId, notes)) {
        alert('บันทึกไม่สำเร็จค่ะ ติดต่อฐานข้อมูลไม่ได้หรือคำสั่งซื้อถูกลบไปแล้ว กรุณารีเฟรชแล้วลองใหม่');
        return;
    }

    bootstrap.Modal.getInstance(document.getElementById('slipModal')).hide();
    renderAdminDashboard();
    renderSlipsTable();
    renderOrdersTable();
    alert('ปฏิเสธการชำระเงินเรียบร้อยแล้วค่ะ');
}

// --- ORDER MANAGEMENT RENDERER ---
function renderOrdersTable() {
    const orders = KpopStore.getOrders();
    const tbody = document.getElementById('ordersMasterTableBody');

    if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-5">ยังไม่มีรายการสั่งซื้อในระบบ</td></tr>`;
        return;
    }

    // เก็บ statusCode ไว้บนแถวเพื่อให้การกรองไม่ต้องเดาจากข้อความที่แสดง
    tbody.innerHTML = orders.map(o => `
                <tr data-status-code="${KpopStore.getStatusCode(o)}">
                    <td class="fw-bold">${esc(o.id)}</td>
                    <td class="text-muted" style="font-size:0.85rem;">${esc(o.date)}</td>
                    <td>
                        <div class="fw-bold">${esc(o.customerName)}</div>
                        <small class="text-muted">${esc(o.phone)}</small>
                    </td>
                    <td style="font-size:0.85rem;">${(o.items || []).map(i => `${esc(i.title)} (x${Number(i.qty) || 0})`).join(', ')}</td>
                    <td class="fw-bold text-danger">฿${(o.total || 0).toLocaleString()}</td>
                    <td>${renderStatusBadge(o)}</td>
                    <td><small class="font-monospace text-primary fw-bold">${esc(o.trackingNumber) || '-'}</small></td>
                    <td class="text-end text-nowrap">
                        <button class="btn btn-sm btn-outline-dark rounded-pill px-3 me-1" onclick="openOrderEditModal('${escArg(o.id)}')"><i class="fa-solid fa-pen me-1"></i> ปรับสถานะ</button>
                        <button class="btn btn-sm btn-outline-danger rounded-pill px-3" onclick="removeOrder('${escArg(o.id)}')" title="ลบคำสั่งซื้อถาวร"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
}

// ลบออเดอร์ถาวร — ใช้ล้างข้อมูลเก่าเพื่อคืนพื้นที่ localStorage
async function removeOrder(orderId) {
    const order = KpopStore.getOrderById(orderId);
    if (!order) return;

    const meta = KpopStore.getStatusMeta(order);
    // ออเดอร์ที่ยังกินโควตา = ลูกค้าจ่ายเงินแล้วและกระบวนการยังไม่จบ
    // ลบทิ้งตอนนี้แปลว่าลบหลักฐานการซื้อของลูกค้าไปด้วย ต้องเตือนให้หนักกว่าปกติ
    const stillActive = KpopStore.isQuotaConsuming(order);

    let message =
        `ลบคำสั่งซื้อนี้ถาวร?\n\n` +
        `เลขที่: ${order.id}\n` +
        `ลูกค้า: ${order.customerName}\n` +
        `ยอดเงิน: ฿${(order.total || 0).toLocaleString()}\n` +
        `สถานะ: ${meta.text}\n\n`;

    message += stillActive
        ? '⚠️ คำสั่งซื้อนี้ยังไม่จบกระบวนการ ลูกค้าชำระเงินไว้แล้วและยังรออยู่\n' +
          'ถ้าลบ ลูกค้าจะไม่เห็นคำสั่งซื้อนี้ในหน้าประวัติอีก และโควตาของรอบจะถูกคืนกลับ\n' +
          'ถ้าตั้งใจจะยกเลิกหรือคืนเงิน ให้ใช้ปุ่ม "ปรับสถานะ" แทนการลบ'
        : 'คำสั่งซื้อนี้จบกระบวนการแล้ว การลบจะคืนพื้นที่เก็บข้อมูล (รวมรูปสลิปที่แนบไว้)';

    if (!confirm(message)) return;

    const res = await KpopStore.deleteOrder(orderId);
    if (!res.success) {
        alert('ลบไม่สำเร็จค่ะ\n\n' + res.message);
        return;
    }

    // โควตา ยอดขาย และใบสรุปรอบ คำนวณจากออเดอร์ทั้งนั้น จึงต้องวาดใหม่ทุกส่วน
    renderOrdersTable();
    renderSlipsTable();
    renderAdminDashboard();
    renderProductsTable();
    renderRoundsTable();
    renderStorageUsage();
    alert('ลบคำสั่งซื้อเรียบร้อยแล้วค่ะ');
}

function filterOrdersTable() {
    const search = document.getElementById('orderSearchInput').value.toLowerCase();
    const statusFilter = document.getElementById('orderStatusFilter').value;
    const rows = document.querySelectorAll('#ordersMasterTableBody tr');

    rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        const matchSearch = !search || text.includes(search);
        // กรองจาก statusCode บนแถว ไม่ใช่ข้อความที่แสดง
        // (เดิมเทียบข้อความในแถว ซึ่งพังทันทีที่ป้ายสถานะใช้คำย่อไม่ตรงกับค่าใน dropdown)
        const matchStatus = statusFilter === 'ALL' || row.dataset.statusCode === statusFilter;

        if (matchSearch && matchStatus) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

let currentModalProofImg = null;

function openOrderEditModal(orderId) {
    const order = KpopStore.getOrderById(orderId);
    if (!order) return;

    document.getElementById('editOrderIdHidden').value = order.id;
    document.getElementById('displayEditOrderId').value = order.id + ' (' + order.customerName + ')';
    document.getElementById('editOrderStatusSelect').value = KpopStore.getStatusCode(order);
    document.getElementById('editOrderTrackingInput').value = order.trackingNumber || '';
    document.getElementById('editOrderNotesInput').value = order.adminNotes || '';
    document.getElementById('editOrderProofNoteInput').value = order.purchaseProofNote || '';
    document.getElementById('editOrderProofFileInput').value = '';

    currentModalProofImg = order.purchaseProofImage || null;
    const container = document.getElementById('proofPreviewContainer');
    if (currentModalProofImg) {
        document.getElementById('editOrderProofPreviewImg').src = currentModalProofImg;
        document.getElementById('displayProofNoteText').innerText = order.purchaseProofNote || 'รูปหลักฐานการสั่งซื้อ';
        container.classList.remove('d-none');
        container.classList.add('d-flex');
    } else {
        container.classList.add('d-none');
        container.classList.remove('d-flex');
    }

    const modal = new bootstrap.Modal(document.getElementById('orderEditModal'));
    modal.show();
}

function removeOrderProofImage() {
    currentModalProofImg = null;
    const container = document.getElementById('proofPreviewContainer');
    container.classList.add('d-none');
    container.classList.remove('d-flex');
}

async function markOrderPurchaseFailed() {
    const orderId = document.getElementById('editOrderIdHidden').value;
    const order = KpopStore.getOrderById(orderId);
    if (!order) return;

    const reason = prompt(
        'ระบุสาเหตุที่กดสั่งไม่สำเร็จ (ลูกค้าจะเห็นข้อความนี้)',
        'สินค้าหมดจากเว็บ Official ก่อนร้านกดสั่งสำเร็จ'
    );
    if (reason === null) return;

    if (!confirm(`ยืนยันว่าคำสั่งซื้อ #${orderId} กดของไม่สำเร็จ?\n\nระบบจะเปลี่ยนสถานะเป็น "รอคืนเงิน" คืนโควตาเข้ารอบ และแจ้งลูกค้าว่าจะคืนเงินเต็มจำนวน ฿${(order.total || 0).toLocaleString()}`)) {
        return;
    }

    if (!await KpopStore.markPurchaseFailed(orderId, reason.trim() || undefined)) {
        alert('บันทึกไม่สำเร็จค่ะ ติดต่อฐานข้อมูลไม่ได้ สถานะยังไม่ถูกเปลี่ยน');
        return;
    }

    refreshOrderViews();
    alert('บันทึกเรียบร้อยแล้วค่ะ ออเดอร์นี้อยู่ในสถานะรอคืนเงิน');
}

async function markOrderRefunded() {
    const orderId = document.getElementById('editOrderIdHidden').value;
    const order = KpopStore.getOrderById(orderId);
    if (!order) return;

    const note = prompt(
        `ยืนยันว่าคืนเงิน ฿${(order.total || 0).toLocaleString()} ให้ลูกค้าแล้ว\nระบุหมายเหตุ (เช่น ช่องทางและเวลาที่โอนคืน)`,
        'โอนคืนเข้าบัญชีเดิมของลูกค้าเรียบร้อยแล้ว'
    );
    if (note === null) return;

    if (!await KpopStore.markRefunded(orderId, note.trim())) {
        alert('บันทึกไม่สำเร็จค่ะ ติดต่อฐานข้อมูลไม่ได้ สถานะยังไม่ถูกเปลี่ยน');
        return;
    }

    refreshOrderViews();
    alert('บันทึกการคืนเงินเรียบร้อยแล้วค่ะ');
}

function refreshOrderViews() {
    bootstrap.Modal.getInstance(document.getElementById('orderEditModal')).hide();
    renderAdminDashboard();
    renderSlipsTable();
    renderOrdersTable();
    renderRoundsTable();
    renderProductsTable();
}

function saveOrderStatusChanges() {
    const orderId = document.getElementById('editOrderIdHidden').value;
    const status = document.getElementById('editOrderStatusSelect').value;
    const tracking = document.getElementById('editOrderTrackingInput').value;
    const notes = document.getElementById('editOrderNotesInput').value;
    const proofNote = document.getElementById('editOrderProofNoteInput').value;
    const fileInput = document.getElementById('editOrderProofFileInput');

    const applyChanges = async (finalProofImg) => {
        // ค่าว่างจากฟอร์ม = ตั้งใจล้าง (เช่น พิมพ์เลขพัสดุผิดแล้วอยากลบทิ้ง)
        // store แยกกรณี undefined (ไม่ได้ส่งมา) กับ '' (ล้างค่า) ให้แล้ว
        if (!await KpopStore.updateOrderStatus(orderId, status, tracking, notes, finalProofImg, proofNote)) {
            alert('บันทึกไม่สำเร็จค่ะ\n\nอาจติดต่อฐานข้อมูลไม่ได้ หรืออัปโหลดรูปหลักฐานไม่สำเร็จ\n' +
                'กรุณาตรวจสอบการเชื่อมต่อ แล้วบันทึกใหม่อีกครั้ง');
            renderStorageUsage();
            return;
        }

        bootstrap.Modal.getInstance(document.getElementById('orderEditModal')).hide();
        renderAdminDashboard();
        renderSlipsTable();
        renderOrdersTable();
        renderStorageUsage();
        alert('อัปเดตสถานะคำสั่งซื้อและแนบหลักฐานการสั่งซื้อเรียบร้อยแล้วค่ะ!');
    };

    if (fileInput.files && fileInput.files[0]) {
        // หลักฐานการกดสั่งเป็นสกรีนช็อตแนวนอน ไม่ใช่สลิปแนวตั้ง จึงใช้ตัวย่อของรูปสินค้า
        KpopStore.compressProductImage(fileInput.files[0], async function (compressedDataUrl) {
            if (!compressedDataUrl) {
                alert('อ่านไฟล์รูปหลักฐานไม่สำเร็จค่ะ ไฟล์อาจเสียหายหรือไม่ใช่รูปภาพ\nระบบจะบันทึกส่วนอื่นโดยใช้รูปเดิมไว้ก่อน');
            }
            await applyChanges(compressedDataUrl || currentModalProofImg);
        });
    } else {
        applyChanges(currentModalProofImg);
    }
}

// --- PRODUCTS MANAGEMENT RENDERER ---
function renderProductsTable() {
    const products = KpopStore.getProducts();
    const tbody = document.getElementById('productsTableBody');

    if (products.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-5">ยังไม่มีสินค้าในระบบ — กด "เพิ่มสินค้าใหม่" เพื่อเริ่มต้น</td></tr>`;
        return;
    }

    tbody.innerHTML = products.map(p => {
        const bd = KpopStore.getPriceBreakdown(p);
        const remaining = KpopStore.getRemainingQuota(p.id);
        const used = KpopStore.getUsedQuota(p.id);
        const round = KpopStore.getRoundById(p.roundId);
        const state = KpopStore.getRoundState(round);

        // จองเกินเพดานได้จริงถ้าแอดมินลดโควตาทีหลัง — ต้องบอกให้เห็น
        // ไม่ใช่ขึ้นแค่ "เหลือ 0" ซึ่งดูเหมือนขายพอดีเป๊ะ
        const overBooked = remaining !== null && used > Number(p.quotaPerRound);
        const quotaCell = remaining === null
            ? '<span class="badge bg-light text-dark border">ไม่จำกัด</span>'
            : (overBooked
                ? `<span class="badge bg-danger">เกินโควตา</span>
                           <div class="small text-danger mt-1">จองแล้ว ${used} / เพดาน ${p.quotaPerRound} ชิ้น</div>`
                : `เหลือ <strong>${remaining}</strong> / ${p.quotaPerRound} ชิ้น`);

        return `
                <tr>
                    <td><img src="${esc(p.image || PRODUCT_IMAGE_FALLBACK)}" class="product-thumb" alt="${esc(p.title)}"
                             onerror="this.onerror=null; this.src='${PRODUCT_IMAGE_FALLBACK}';"></td>
                    <td><span class="badge bg-secondary">${esc(p.artist)}</span></td>
                    <td>
                        <div class="fw-bold">${esc(p.title)}</div>
                        <small class="text-muted">${round ? esc(round.name) : 'ยังไม่ผูกรอบ'} ${renderRoundStateBadge(state)}</small>
                    </td>
                    <td>
                        <div class="fw-bold text-danger">฿${bd.total.toLocaleString()}</div>
                        <small class="text-muted">${bd.legacy ? 'ราคาบาทคงที่ (ยังไม่ได้กรอกราคาวอน)' : '₩' + bd.krw.toLocaleString() + ' + ค่าบริการ ฿' + bd.serviceFee}</small>
                    </td>
                    <td>${quotaCell}</td>
                    <td><span class="badge bg-pink text-white" style="background:#ff3399;">${esc(p.status)}</span></td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-secondary rounded-pill me-1 px-3" onclick="switchTab('tab-report-tab'); showProductOrders('${escArg(p.id)}')" title="ดูคำสั่งซื้อของสินค้านี้"><i class="fa-solid fa-list-ul"></i></button>
                        <button class="btn btn-sm btn-outline-primary rounded-pill me-1 px-3" onclick="openEditProductModal('${escArg(p.id)}')"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-sm btn-outline-danger rounded-pill px-3" onclick="deleteProduct('${escArg(p.id)}')"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
                `;
    }).join('');
}

// รายงานคำสั่งซื้อแยกตามสินค้า — ตอบคำถาม "สินค้านี้มีใครสั่งไปบ้าง" แยกเป็นรายออเดอร์
// (ต่างจาก "ใบสรุปรอบ" ที่รวมยอดของทุกสินค้าในรอบเดียวเข้าด้วยกัน)
let currentProductOrdersId = null;

function populateReportProductSelect() {
    const select = document.getElementById('reportProductSelect');
    const selected = select.value;
    select.innerHTML = '<option value="">-- เลือกสินค้า --</option>' +
        KpopStore.getProducts().map(p => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('');
    if (selected) select.value = selected;
}

function showProductOrders(productId) {
    currentProductOrdersId = productId || null;
    const select = document.getElementById('reportProductSelect');
    if (select) select.value = productId || '';

    const card = document.getElementById('productOrdersCard');
    if (!productId) {
        card.style.display = 'none';
        return;
    }

    const product = KpopStore.getProductById(productId);
    const rows = KpopStore.getOrdersForProduct(productId);

    const totalQty = rows.reduce((sum, r) => sum + r.qty, 0);
    const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);

    document.getElementById('productOrdersSubtitle').innerText =
        `${product ? product.title : productId} · ${rows.length} คำสั่งซื้อ · รวม ${totalQty} ชิ้น · ยอดรวม ฿${totalAmount.toLocaleString()}`;

    document.getElementById('productOrdersBody').innerHTML = rows.length === 0
        ? '<div class="text-muted">ยังไม่มีคำสั่งซื้อสินค้านี้</div>'
        : `
                    <div class="table-responsive">
                        <table class="table custom-table align-middle">
                            <thead>
                                <tr>
                                    <th>รหัสคำสั่งซื้อ</th>
                                    <th>ลูกค้า</th>
                                    <th class="text-end">จำนวน</th>
                                    <th class="text-end">ยอดเงิน</th>
                                    <th>รอบ</th>
                                    <th>สถานะ</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map(r => `
                                    <tr>
                                        <td class="fw-bold">${esc(r.orderId)}</td>
                                        <td>${esc(r.customerName)}</td>
                                        <td class="text-end fw-bold fs-5 text-danger">${r.qty}</td>
                                        <td class="text-end fw-bold">฿${r.amount.toLocaleString()}</td>
                                        <td style="font-size:0.85rem;">${esc(r.roundName)}</td>
                                        <td>${renderStatusBadge(r.order)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;

    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ดาวน์โหลดรายงานที่กำลังเปิดดูอยู่เป็น .xlsx — คอลัมน์เดียวกับตารางบนจอ ใช้ไลบรารี SheetJS (xlsx.js)
function exportProductOrdersExcel() {
    if (!currentProductOrdersId) return;
    const product = KpopStore.getProductById(currentProductOrdersId);
    const rows = KpopStore.getOrdersForProduct(currentProductOrdersId);

    if (rows.length === 0) {
        alert('สินค้านี้ยังไม่มีคำสั่งซื้อ ไม่มีอะไรให้ดาวน์โหลดค่ะ');
        return;
    }

    const data = rows.map(r => ({
        'รหัสคำสั่งซื้อ': r.orderId,
        'ลูกค้า': r.customerName,
        'จำนวน': r.qty,
        'ยอดเงิน (บาท)': r.amount,
        'รอบ': r.roundName,
        'สถานะ': KpopStore.getStatusMeta(r.order).text
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 16 }, { wch: 24 }, { wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 22 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'รายงาน');

    const safeTitle = (product ? product.title : currentProductOrdersId)
        .replace(/[\\/:*?"<>|]/g, '-')
        .slice(0, 80);
    XLSX.writeFile(wb, `รายงานคำสั่งซื้อ-${safeTitle}.xlsx`);
}

// ---- รูปสินค้า ----
const PRODUCT_IMAGE_FALLBACK = 'images/mapsoul7.jpg';

function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

function setProductImagePreview(src, sizeHint) {
    document.getElementById('pImagePreview').src = src || PRODUCT_IMAGE_FALLBACK;
    document.getElementById('pImageSizeHint').innerText = sizeHint || '';
}

function handleProductImageUpload(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    if (!/^image\//.test(file.type)) {
        alert('กรุณาเลือกไฟล์รูปภาพ (PNG, JPG หรือ WebP) เท่านั้นค่ะ');
        input.value = '';
        return;
    }

    document.getElementById('pImageSizeHint').innerText = 'กำลังย่อรูป...';

    KpopStore.compressProductImage(file, function (dataUrl) {
        if (!dataUrl) {
            alert('อ่านไฟล์รูปไม่สำเร็จค่ะ ไฟล์อาจเสียหายหรือไม่ใช่รูปภาพ กรุณาลองไฟล์อื่น');
            input.value = '';
            setProductImagePreview(document.getElementById('pImage').value, '');
            return;
        }

        // ไฟล์ที่อัปโหลดทับค่าใน URL เพราะเป็นสิ่งที่แอดมินเพิ่งเลือกล่าสุด
        document.getElementById('pImage').value = dataUrl;
        setProductImagePreview(dataUrl, 'ประมาณ ' + formatBytes(dataUrl.length));
    });
}

function onProductImageUrlInput() {
    const url = document.getElementById('pImage').value.trim();
    // พิมพ์ URL เองแปลว่าไม่ได้ใช้ไฟล์ที่เลือกไว้แล้ว
    document.getElementById('pImageFile').value = '';
    setProductImagePreview(url, '');
}

function clearProductImage() {
    document.getElementById('pImage').value = '';
    document.getElementById('pImageFile').value = '';
    setProductImagePreview(PRODUCT_IMAGE_FALLBACK, 'ใช้รูปสำรองของระบบ');
}

// ---- พื้นที่เก็บข้อมูล ----
// แสดงให้แอดมินเห็นก่อนที่จะเต็มจนบันทึกไม่ได้ ไม่ใช่ให้รู้ตอนพังไปแล้ว
function renderStorageUsage() {
    const box = document.getElementById('storageUsageBox');
    if (!box) return;

    const usage = KpopStore.getStorageUsage();
    const tone = usage.percent >= 90 ? 'danger' : (usage.percent >= 70 ? 'warning' : 'secondary');
    const warn = usage.percent >= 90
        ? ' — ใกล้เต็มแล้ว ควรใช้ URL รูปภาพแทนการอัปโหลด หรือลบข้อมูลเก่าออก'
        : (usage.percent >= 70 ? ' — เริ่มใช้พื้นที่เยอะ ระวังอัปโหลดรูปเพิ่ม' : '');

    box.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-1" style="font-size: 0.78rem;">
                    <span class="text-muted"><i class="fa-solid fa-database me-1"></i>พื้นที่เก็บข้อมูลในเบราว์เซอร์</span>
                    <span class="text-${tone} fw-bold">${formatBytes(usage.bytes)} / ${formatBytes(usage.limit)} (${usage.percent}%)${warn}</span>
                </div>
                <div class="progress" style="height: 6px;">
                    <div class="progress-bar bg-${tone}" style="width: ${usage.percent}%"></div>
                </div>
            `;
}

// เติม dropdown รอบในฟอร์มสินค้า พร้อมบอกสถานะรอบให้แอดมินเห็นตอนเลือก
function populateRoundSelect(selectedId) {
    const select = document.getElementById('pRoundId');
    const rounds = KpopStore.getRounds();
    select.innerHTML = rounds.map(r => {
        const state = KpopStore.getRoundState(r);
        return `<option value="${esc(r.id)}">${esc(r.name)} — ${roundStateLabel(state)}</option>`;
    }).join('');
    if (selectedId) select.value = selectedId;
}

// แสดงราคาขายแบบสดขณะแอดมินพิมพ์ เพื่อไม่ต้องเปิดเครื่องคิดเลขเอง
function updateProductPricePreview() {
    const krw = parseFloat(document.getElementById('pPriceKRW').value) || 0;
    const fee = parseFloat(document.getElementById('pServiceFee').value) || 0;
    const rate = KpopStore.getCurrentRate();
    const bd = KpopStore.getPriceBreakdown({ priceKRW: krw, serviceFee: fee, price: 0 }, rate.rate);

    document.getElementById('pPricePreview').innerText = '฿' + bd.total.toLocaleString();
    document.getElementById('pPricePreviewNote').innerText =
        `₩${krw.toLocaleString()} x ${rate.rate} = ฿${bd.converted.toLocaleString()} บวกค่าบริการ ฿${fee.toLocaleString()}`;
}

function openAddProductModal() {
    document.getElementById('productModalTitle').innerHTML = '<i class="fa-solid fa-plus me-2 text-pink"></i>เพิ่มสินค้าใหม่';
    document.getElementById('pId').value = '';
    document.getElementById('pArtist').value = '';
    document.getElementById('pTitle').value = '';
    document.getElementById('pPriceKRW').value = '25000';
    document.getElementById('pServiceFee').value = '170';
    document.getElementById('pQuota').value = '50';
    document.getElementById('pStatus').value = 'PRE-ORDER';
    document.getElementById('pImage').value = PRODUCT_IMAGE_FALLBACK;
    document.getElementById('pImageFile').value = '';
    setProductImagePreview(PRODUCT_IMAGE_FALLBACK, '');
    document.getElementById('pEstDelivery').value = '';
    document.getElementById('pDesc').value = '';
    populateRoundSelect();
    updateProductPricePreview();

    const modal = new bootstrap.Modal(document.getElementById('productFormModal'));
    modal.show();
}

function openEditProductModal(productId) {
    const p = KpopStore.getProductById(productId);
    if (!p) return;

    document.getElementById('productModalTitle').innerHTML = '<i class="fa-solid fa-pen me-2 text-pink"></i>แก้ไขสินค้า';
    document.getElementById('pId').value = p.id;
    document.getElementById('pArtist').value = p.artist;
    document.getElementById('pTitle').value = p.title;
    document.getElementById('pPriceKRW').value = p.priceKRW || '';
    document.getElementById('pServiceFee').value = p.serviceFee || 0;
    // ว่าง = รับไม่จำกัด จึงต้องแยก null ออกจาก 0 ให้ชัด
    document.getElementById('pQuota').value = (p.quotaPerRound === null || p.quotaPerRound === undefined) ? '' : p.quotaPerRound;
    document.getElementById('pStatus').value = p.status || 'PRE-ORDER';
    document.getElementById('pImage').value = p.image || '';
    document.getElementById('pImageFile').value = '';
    // รูปที่อัปโหลดไว้จะเป็น data URI ยาวมาก บอกขนาดให้เห็นว่ากินพื้นที่เท่าไหร่
    setProductImagePreview(
        p.image,
        (p.image && p.image.indexOf('data:') === 0) ? 'รูปที่อัปโหลด ประมาณ ' + formatBytes(p.image.length) : ''
    );
    document.getElementById('pEstDelivery').value = p.estDelivery || '';
    document.getElementById('pDesc').value = p.desc || '';
    populateRoundSelect(p.roundId);
    updateProductPricePreview();

    const modal = new bootstrap.Modal(document.getElementById('productFormModal'));
    modal.show();
}

async function saveProductForm(e) {
    e.preventDefault();
    const id = document.getElementById('pId').value || ('prod-' + Date.now());
    const quotaRaw = document.getElementById('pQuota').value.trim();

    const product = {
        id: id,
        artist: document.getElementById('pArtist').value,
        title: document.getElementById('pTitle').value,
        priceKRW: parseFloat(document.getElementById('pPriceKRW').value) || 0,
        serviceFee: parseFloat(document.getElementById('pServiceFee').value) || 0,
        roundId: document.getElementById('pRoundId').value,
        // ช่องว่าง = รับไม่จำกัด (null) ไม่ใช่ 0 ซึ่งแปลว่าเต็มโควตา
        quotaPerRound: quotaRaw === '' ? null : (parseInt(quotaRaw, 10) || 0),
        status: document.getElementById('pStatus').value,
        // เว้นว่างได้ ระบบจะใช้รูปสำรองแทน ไม่ปล่อยให้รูปแตก
        image: document.getElementById('pImage').value.trim() || PRODUCT_IMAGE_FALLBACK,
        estDelivery: document.getElementById('pEstDelivery').value,
        desc: document.getElementById('pDesc').value
    };

    // ตอนแก้ของเดิม การเปลี่ยน 2 ค่านี้กระทบออเดอร์ที่ลูกค้าสั่งค้างไว้แล้ว จึงต้องเตือนก่อน
    const isEditing = !!document.getElementById('pId').value;
    if (isEditing) {
        const existing = KpopStore.getProductById(id);
        const activeOrders = KpopStore.getActiveOrdersForProduct(id);

        // โควตานับจากออเดอร์ "ในรอบเดียวกับสินค้า" พอย้ายรอบ ออเดอร์เดิมจึงหลุดจากการนับ
        // ตัวเลขคงเหลือจะเด้งกลับเต็มทั้งที่ของยังไม่ได้ส่ง = ขายเกินได้โดยไม่รู้ตัว
        if (existing && activeOrders.length > 0 && existing.roundId !== product.roundId) {
            const ok = confirm(
                `สินค้านี้มีคำสั่งซื้อค้างอยู่ ${activeOrders.length} รายการในรอบเดิม\n\n` +
                'ถ้าย้ายไปรอบใหม่ ออเดอร์เหล่านั้นจะไม่ถูกนับในโควตาของรอบใหม่\n' +
                'ทำให้ยอดคงเหลือดูเหมือนว่างมากกว่าความเป็นจริง\n\nยืนยันจะย้ายรอบหรือไม่?'
            );
            if (!ok) return;
        }

        // เพดานที่ต่ำกว่ายอดจองจริงทำให้ตารางขึ้น "เกินโควตา" ซึ่งอาจไม่ใช่สิ่งที่ตั้งใจ
        const used = KpopStore.getUsedQuota(id);
        if (product.quotaPerRound !== null && product.quotaPerRound < used) {
            const ok = confirm(
                `ตอนนี้มีลูกค้าจองไปแล้ว ${used} ชิ้น แต่กำลังตั้งเพดานเป็น ${product.quotaPerRound} ชิ้น\n\n` +
                'ระบบจะไม่ยกเลิกออเดอร์ที่รับไปแล้ว แต่จะแสดงว่าสินค้านี้รับเกินโควตา\n\nยืนยันหรือไม่?'
            );
            if (!ok) return;
        }
    }

    // ต้องเช็คก่อนแจ้งว่าสำเร็จ — รูปที่อัปโหลดอาจทำให้ localStorage เต็มจนเขียนไม่ลง
    const result = await KpopStore.saveProduct(product);
    if (!result.success) {
        alert('บันทึกไม่สำเร็จค่ะ\n\n' + result.message);
        renderStorageUsage();
        return;
    }

    bootstrap.Modal.getInstance(document.getElementById('productFormModal')).hide();
    renderProductsTable();
    renderRoundsTable();
    renderAdminDashboard();
    renderStorageUsage();
    populateReportProductSelect();
    alert('บันทึกข้อมูลสินค้าเรียบร้อยแล้วค่ะ!');
}

async function deleteProduct(id) {
    if (!confirm('คุณแน่ใจหรือไม่ที่จะลบรายการสินค้านี้ออกจากระบบ?')) return;

    // ต้องเช็คก่อนแจ้ง — ลบไม่สำเร็จได้ 2 กรณี: ยังมีออเดอร์ค้าง หรือพื้นที่เก็บข้อมูลเต็ม
    const result = await KpopStore.deleteProduct(id);
    if (!result.success) {
        alert('ลบไม่สำเร็จค่ะ\n\n' + result.message);
        return;
    }

    renderProductsTable();
    renderAdminDashboard();
    renderStorageUsage();
    populateReportProductSelect();
    if (currentProductOrdersId === id) showProductOrders('');
    alert('ลบสินค้าเรียบร้อยแล้วค่ะ');
}

// --- ROUNDS ---
const ROUND_STATE_LABEL = {
    upcoming: { text: 'ยังไม่เปิดรับ', badge: 'secondary' },
    open: { text: 'เปิดรับอยู่', badge: 'success' },
    closed: { text: 'ปิดรับแล้ว', badge: 'dark' },
    ordered: { text: 'กดสั่งกับเกาหลีแล้ว', badge: 'primary' },
    arrived: { text: 'ของถึงไทยแล้ว', badge: 'info' },
    shipped: { text: 'ส่งครบแล้ว', badge: 'success' }
};

function roundStateLabel(state) {
    return (ROUND_STATE_LABEL[state] || ROUND_STATE_LABEL.closed).text;
}

function renderRoundStateBadge(state) {
    const meta = ROUND_STATE_LABEL[state] || ROUND_STATE_LABEL.closed;
    return `<span class="badge bg-${meta.badge} rounded-pill" style="font-size:0.72rem;">${meta.text}</span>`;
}

function renderRoundsTable() {
    const rounds = KpopStore.getRounds();
    const products = KpopStore.getProducts();
    const tbody = document.getElementById('roundsTableBody');

    if (rounds.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-5">ยังไม่มีรอบในระบบ</td></tr>`;
        return;
    }

    tbody.innerHTML = rounds.map(r => {
        const state = KpopStore.getRoundState(r);
        const productCount = products.filter(p => p.roundId === r.id).length;
        const summary = KpopStore.getRoundSummary(r.id);
        const totalQty = summary.items.reduce((s, i) => s + i.qty, 0);

        return `
                <tr>
                    <td>
                        <div class="fw-bold">${esc(r.name)}</div>
                        <small class="text-muted">${esc(r.estDelivery) || '-'}</small>
                    </td>
                    <td><span class="badge bg-light text-dark border">${r.type === 'shipping' ? 'หิ้ว/ชิปรวม' : 'เว็บเกาหลี'}</span></td>
                    <td style="font-size:0.85rem;">${esc(r.openAt)} ถึง ${esc(r.closeAt)}</td>
                    <td>${renderRoundStateBadge(state)}</td>
                    <td>${productCount} รายการ</td>
                    <td>
                        <div class="fw-bold">${totalQty} ชิ้น</div>
                        <small class="text-muted">${summary.orderCount} ออเดอร์ · ฿${summary.grandTotal.toLocaleString()}</small>
                    </td>
                    <td class="text-end text-nowrap">
                        <button class="btn btn-sm btn-outline-primary rounded-pill me-1 px-3" onclick="showRoundSummary('${escArg(r.id)}')" title="ใบสรุปรอบ"><i class="fa-solid fa-clipboard-list"></i></button>
                        <button class="btn btn-sm btn-outline-dark rounded-pill me-1 px-3" onclick="openEditRoundModal('${escArg(r.id)}')"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-sm btn-outline-danger rounded-pill px-3" onclick="deleteRound('${escArg(r.id)}')"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
                `;
    }).join('');
}

function openAddRoundModal() {
    const today = new Date().toISOString().split('T')[0];
    const inTwoWeeks = new Date();
    inTwoWeeks.setDate(inTwoWeeks.getDate() + 14);

    document.getElementById('roundModalTitle').innerHTML = '<i class="fa-solid fa-calendar-plus me-2 text-danger"></i>สร้างรอบพรีออเดอร์ใหม่';
    document.getElementById('rId').value = '';
    document.getElementById('rName').value = '';
    document.getElementById('rType').value = 'korean-site';
    document.getElementById('rOpenAt').value = today;
    document.getElementById('rCloseAt').value = inTwoWeeks.toISOString().split('T')[0];
    document.getElementById('rStatus').value = 'open';
    document.getElementById('rEstDelivery').value = '';
    document.getElementById('rNote').value = '';

    new bootstrap.Modal(document.getElementById('roundFormModal')).show();
}

function openEditRoundModal(roundId) {
    const r = KpopStore.getRoundById(roundId);
    if (!r) return;

    document.getElementById('roundModalTitle').innerHTML = '<i class="fa-solid fa-pen me-2 text-danger"></i>แก้ไขรอบพรีออเดอร์';
    document.getElementById('rId').value = r.id;
    document.getElementById('rName').value = r.name || '';
    document.getElementById('rType').value = r.type || 'korean-site';
    document.getElementById('rOpenAt').value = r.openAt || '';
    document.getElementById('rCloseAt').value = r.closeAt || '';
    document.getElementById('rStatus').value = r.status || 'open';
    document.getElementById('rEstDelivery').value = r.estDelivery || '';
    document.getElementById('rNote').value = r.note || '';

    new bootstrap.Modal(document.getElementById('roundFormModal')).show();
}

async function saveRoundForm(e) {
    e.preventDefault();
    const openAt = document.getElementById('rOpenAt').value;
    const closeAt = document.getElementById('rCloseAt').value;

    if (closeAt < openAt) {
        alert('วันปิดรับต้องไม่มาก่อนวันเปิดรับค่ะ');
        return;
    }

    const result = await KpopStore.saveRound({
        id: document.getElementById('rId').value || ('round-' + Date.now()),
        name: document.getElementById('rName').value,
        type: document.getElementById('rType').value,
        openAt: openAt,
        closeAt: closeAt,
        status: document.getElementById('rStatus').value,
        estDelivery: document.getElementById('rEstDelivery').value,
        note: document.getElementById('rNote').value
    });

    if (!result.success) {
        alert('บันทึกไม่สำเร็จค่ะ\n\n' + result.message);
        renderStorageUsage();
        return;
    }

    bootstrap.Modal.getInstance(document.getElementById('roundFormModal')).hide();
    renderRoundsTable();
    renderProductsTable();
    renderAdminDashboard();
    alert('บันทึกรอบพรีออเดอร์เรียบร้อยแล้วค่ะ!');
}

async function deleteRound(roundId) {
    const attached = KpopStore.getProducts().filter(p => p.roundId === roundId);
    if (attached.length > 0) {
        alert(`ลบไม่ได้ค่ะ ยังมีสินค้า ${attached.length} รายการผูกอยู่กับรอบนี้\nกรุณาย้ายสินค้าไปรอบอื่นก่อน`);
        return;
    }
    if (confirm('ยืนยันลบรอบนี้ออกจากระบบ?')) {
        const result = await KpopStore.deleteRound(roundId);
        if (!result.success) {
            alert('ลบไม่สำเร็จค่ะ\n\n' + result.message);
            return;
        }
        renderRoundsTable();
        renderProductsTable();
    }
}

// ใบสรุปรอบ = สิ่งที่แอดมินถือไปกดสั่งที่เว็บเกาหลี รวมจำนวนต่อสินค้าให้แล้ว
function showRoundSummary(roundId) {
    const round = KpopStore.getRoundById(roundId);
    const summary = KpopStore.getRoundSummary(roundId);
    const card = document.getElementById('roundSummaryCard');

    document.getElementById('roundSummarySubtitle').innerText =
        `${round ? round.name : roundId} · ${summary.orderCount} ออเดอร์ที่ยังไม่ถูกยกเลิก · ยอดรับจากลูกค้ารวม ฿${summary.grandTotal.toLocaleString()}`;

    document.getElementById('roundSummaryBody').innerHTML = summary.items.length === 0
        ? '<div class="text-muted">ยังไม่มีออเดอร์ในรอบนี้</div>'
        : `
                    <div class="table-responsive">
                        <table class="table custom-table align-middle">
                            <thead>
                                <tr>
                                    <th>สินค้าที่ต้องกดสั่ง</th>
                                    <th class="text-end">จำนวนรวม</th>
                                    <th class="text-end">ราคาวอน/ชิ้น</th>
                                    <th class="text-end">รวมวอนที่ต้องจ่าย</th>
                                    <th class="text-end">ยอดที่รับจากลูกค้า</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${summary.items.map(i => `
                                    <tr>
                                        <td class="fw-bold">${esc(i.title)}</td>
                                        <td class="text-end fw-bold fs-5 text-danger">${i.qty}</td>
                                        <td class="text-end">${i.priceKRW ? '₩' + i.priceKRW.toLocaleString() : '-'}</td>
                                        <td class="text-end fw-bold">${i.priceKRW ? '₩' + (i.priceKRW * i.qty).toLocaleString() : '-'}</td>
                                        <td class="text-end">฿${i.amountTHB.toLocaleString()}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;

    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth' });
}

function closeRoundSummary() {
    document.getElementById('roundSummaryCard').style.display = 'none';
}

// --- USER MANAGEMENT RENDERER ---
function renderUsersTable() {
    const users = KpopStore.getUsers();
    const tbody = document.getElementById('usersTableBody');

    tbody.innerHTML = users.map(u => `
                <tr>
                    <td class="fw-bold">${esc(u.name)}</td>
                    <td>${esc(u.email)}</td>
                    <td>${esc(u.phone) || '-'}</td>
                    <td style="font-size:0.85rem; max-width: 250px;">${esc(u.address) || '-'}</td>
                    <td>
                        <span class="badge ${u.role === 'admin' ? 'bg-danger' : 'bg-primary'}">${esc(String(u.role || '').toUpperCase())}</span>
                    </td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-primary rounded-pill me-1 px-3" onclick="openEditUserModal('${escArg(u.id)}')"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn btn-sm btn-outline-danger rounded-pill px-3" onclick="deleteUser('${escArg(u.id)}')"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
}

function populateNotificationUserSelect() {
    const users = KpopStore.getUsers();
    const select = document.getElementById('notiTargetUser');
    select.innerHTML = `<option value="ALL">ลูกค้าทุกคนในระบบ (Broadcast All)</option>` +
        users.map(u => `<option value="${esc(u.email)}">${esc(u.name)} (${esc(u.email)})</option>`).join('');
}

function openAddUserModal() {
    document.getElementById('userModalTitle').innerHTML = '<i class="fa-solid fa-user-plus me-2 text-success"></i>เพิ่มผู้ใช้งานใหม่';
    document.getElementById('uId').value = '';
    document.getElementById('uName').value = '';
    document.getElementById('uEmail').value = '';
    document.getElementById('uPhone').value = '';
    document.getElementById('uAddress').value = '';
    document.getElementById('uRole').value = 'customer';

    const modal = new bootstrap.Modal(document.getElementById('userFormModal'));
    modal.show();
}

function openEditUserModal(userId) {
    const u = KpopStore.getUsers().find(x => x.id === userId);
    if (!u) return;

    document.getElementById('userModalTitle').innerHTML = '<i class="fa-solid fa-pen me-2 text-success"></i>แก้ไขข้อมูลผู้ใช้งาน';
    document.getElementById('uId').value = u.id;
    document.getElementById('uName').value = u.name;
    document.getElementById('uEmail').value = u.email;
    document.getElementById('uPhone').value = u.phone || '';
    document.getElementById('uAddress').value = u.address || '';
    document.getElementById('uRole').value = u.role || 'customer';

    const modal = new bootstrap.Modal(document.getElementById('userFormModal'));
    modal.show();
}

async function saveUserForm(e) {
    e.preventDefault();
    const user = {
        id: document.getElementById('uId').value || ('u-' + Date.now()),
        name: document.getElementById('uName').value,
        email: document.getElementById('uEmail').value,
        phone: document.getElementById('uPhone').value,
        address: document.getElementById('uAddress').value,
        role: document.getElementById('uRole').value
    };

    const result = await KpopStore.saveUser(user);
    if (!result.success) {
        alert('บันทึกไม่สำเร็จค่ะ\n\n' + result.message);
        return;
    }

    bootstrap.Modal.getInstance(document.getElementById('userFormModal')).hide();
    renderUsersTable();
    populateNotificationUserSelect();
    alert('บันทึกข้อมูลผู้ใช้งานเรียบร้อยแล้วค่ะ!');
}

async function deleteUser(id) {
    if (!confirm('คุณแน่ใจหรือไม่ที่จะลบผู้ใช้งานนี้?')) return;

    const result = await KpopStore.deleteUser(id);
    if (!result.success) {
        alert('ลบไม่สำเร็จค่ะ\n\n' + result.message);
        return;
    }

    renderUsersTable();
    populateNotificationUserSelect();

    // ถ้าเผลอลบบัญชีตัวเอง store จะเคลียร์ session ให้ หน้านี้จึงต้องกลับไปด่านตรวจสิทธิ์
    checkAdminAuth();
}

// --- BROADCAST NOTIFICATION DISPATCHER ---
async function sendBroadcastNotification(e) {
    e.preventDefault();
    const target = document.getElementById('notiTargetUser').value;
    const title = document.getElementById('notiTitleInput').value;
    const message = document.getElementById('notiMessageInput').value;

    // ส่ง 'ALL' ไปครั้งเดียวแล้วให้ฝั่งเซิร์ฟเวอร์ insert รวดเดียวใน transaction
    // ของเดิมวนเรียกทีละคน = ยิงคำขอเท่าจำนวนผู้ใช้ทั้งระบบ
    const res = await KpopStore.addNotification({
        userEmail: target,
        title: title,
        message: message
    });

    if (!res) {
        alert('ส่งการแจ้งเตือนไม่สำเร็จค่ะ กรุณาลองใหม่อีกครั้ง');
        return;
    }

    alert(target === 'ALL'
        ? 'ส่งการแจ้งเตือนไปยังผู้ใช้งานทุกคนเรียบร้อยแล้วค่ะ!'
        : `ส่งการแจ้งเตือนไปยัง ${target} เรียบร้อยแล้วค่ะ!`);

    document.getElementById('broadcastForm').reset();
}
