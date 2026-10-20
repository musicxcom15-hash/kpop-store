const FALLBACK_IMAGE = 'images/mapsoul7.jpg';

const ROUND_STATE_META = {
    open: { badge: 'success', text: 'เปิดรับอยู่' },
    upcoming: { badge: 'secondary', text: 'ยังไม่เปิดรับ' },
    closed: { badge: 'dark', text: 'ปิดรับแล้ว' },
    ordered: { badge: 'primary', text: 'ร้านกดสั่งกับเกาหลีแล้ว' },
    arrived: { badge: 'info', text: 'ของถึงไทยแล้ว' },
    shipped: { badge: 'success', text: 'ส่งครบแล้ว' }
};

KpopStore.ready(function () {
    // guest เพิ่มของลงตะกร้าไม่ได้แล้ว (กันที่ปุ่มในหน้ารายละเอียดสินค้า) ตะกร้าจึงว่างเสมอ
    // กันตั้งแต่เปิดหน้าชัดกว่าปล่อยให้เห็นตะกร้าว่างแล้วค่อยไปเจอกำแพงตอน checkout
    if (!KpopStore.requireLogin('กรุณาเข้าสู่ระบบก่อนดูตะกร้าพรีออเดอร์ค่ะ')) return;
    renderCart();
});

// ใช้ตัวกลางจาก ui.js ตัวเดียวทั้งระบบ
const esc = KpopStore.esc;
const escArg = KpopStore.escArg;

function baht(value) {
    return '฿' + (Number(value) || 0).toLocaleString('th-TH');
}

function renderCart() {
    const { rate, groups } = KpopStore.getCartGroupedByRound();

    document.getElementById('cartRateBanner').innerHTML = `
                <div class="fw-bold mb-1"><i class="fa-solid fa-money-bill-transfer me-1 text-warning"></i>
                    ราคาในตะกร้าคำนวณจากเรทกลางของร้าน ₩1,000 = ฿${(rate.rate * 1000).toFixed(2)}
                </div>
                <div class="text-secondary">
                    <strong>ยอดของคุณจะถูกล็อกเมื่อแนบสลิป</strong>
                </div>
            `;

    const container = document.getElementById('cartContainer');

    if (groups.length === 0) {
        container.innerHTML = `
                    <div class="text-center py-5 bg-white rounded-4 border p-5">
                        <i class="fa-solid fa-cart-shopping fs-1 text-muted opacity-50 d-block mb-3"></i>
                        <h5 class="fw-bold">ตะกร้ายังว่างอยู่</h5>
                        <p class="text-muted">เลือกอัลบั้มที่อยากได้แล้วกด "เพิ่มลงตะกร้า" ได้เลยค่ะ</p>
                        <a href="index.html" class="btn btn-dark-custom text-decoration-none">เลือกชมสินค้า</a>
                    </div>
                `;
        KpopStore.renderNavbarAuth();
        return;
    }

    container.innerHTML = groups.map(renderRoundGroup).join('') + `
                <div class="alert alert-light border small text-muted mt-2">
                    <i class="fa-solid fa-circle-info me-1 text-primary"></i>
                    สินค้าคนละรอบต้องชำระเงินแยกกัน เพราะของแต่ละรอบมาถึงไทยคนละเวลา
                    จึงรวมพัสดุส่งครั้งเดียวไม่ได้ (ค่าส่งจึงคิดแยกรอบละ ฿50)
                </div>
            `;

    KpopStore.renderNavbarAuth();
}

function renderRoundGroup(group) {
    const meta = ROUND_STATE_META[group.state] || ROUND_STATE_META.closed;
    const round = group.round;

    return `
                <div class="round-card ${group.orderable ? '' : 'is-blocked'}">
                    <div class="round-head d-flex justify-content-between align-items-center flex-wrap gap-2">
                        <div>
                            <div class="fw-bold">
                                <i class="fa-solid fa-layer-group me-2 text-danger"></i>${esc(round ? round.name : 'ไม่ระบุรอบ')}
                                <span class="badge bg-${meta.badge} rounded-pill ms-1" style="font-size:0.72rem;">${meta.text}</span>
                            </div>
                            <div class="text-muted mt-1" style="font-size: 0.82rem;">
                                ${round ? `เปิดรับ ${esc(round.openAt)} ถึง ${esc(round.closeAt)}` : ''}
                                ${round && round.estDelivery ? ` · คาดว่าได้รับ ${esc(round.estDelivery)}` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="p-3">
                        ${group.items.map(item => renderCartItem(item)).join('')}

                        <div class="border-top pt-3 mt-2">
                            <div class="d-flex justify-content-between mb-1" style="font-size: 0.92rem;">
                                <span class="text-muted">ค่าสินค้ารวม</span>
                                <span>${baht(group.subtotal)}</span>
                            </div>
                            <div class="d-flex justify-content-between mb-2" style="font-size: 0.92rem;">
                                <span class="text-muted">ค่าจัดส่งในไทย (รอบนี้)</span>
                                <span>${baht(group.shippingFee)}</span>
                            </div>
                            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 border-top pt-2">
                                <div>
                                    <div class="text-muted" style="font-size: 0.82rem;">ยอดชำระประมาณการรอบนี้</div>
                                    <div class="fw-bold fs-4 text-danger">${baht(group.total)}</div>
                                </div>
                                ${group.orderable
                            ? `<button class="btn btn-dark-custom" onclick="checkoutRound('${escArg(group.roundId)}')">
                                           <i class="fa-solid fa-credit-card me-2"></i>ชำระเงินรอบนี้
                                       </button>`
                            : `<button class="btn btn-secondary" disabled>
                                           <i class="fa-solid fa-ban me-2"></i>${group.state === 'open' ? 'มีรายการเกินโควตา' : meta.text}
                                       </button>`}
                            </div>
                        </div>
                    </div>
                </div>
            `;
}

function renderCartItem(item) {
    const p = item.product;
    const bd = item.breakdown;

    return `
                <div class="d-flex align-items-center gap-3 py-3 border-bottom flex-wrap">
                    <img src="${esc(p.image)}" class="cart-item-img" alt="${esc(p.title)}"
                        onerror="this.onerror=null; this.src='${FALLBACK_IMAGE}'">

                    <div class="flex-grow-1" style="min-width: 180px;">
                        <div class="fw-bold" style="font-size: 0.95rem;">${esc(p.title)}</div>
                        <div class="text-muted" style="font-size: 0.8rem;">
                            ${bd.legacy
                        ? 'ราคาบาทคงที่'
                        : `₩${bd.krw.toLocaleString()} x ${bd.rate} = ฿${bd.converted.toLocaleString()} + ค่าบริการ ฿${bd.serviceFee.toLocaleString()}`}
                        </div>
                        <div class="mt-1" style="font-size: 0.8rem;">
                            ${item.remaining === null
                        ? '<span class="text-muted">รับไม่จำกัด</span>'
                        : (item.overQuota
                            ? `<span class="text-danger fw-bold"><i class="fa-solid fa-triangle-exclamation me-1"></i>รอบนี้เหลือรับได้แค่ ${item.remaining} ชิ้น กรุณาลดจำนวน</span>`
                            : `<span class="text-muted">รอบนี้รับได้อีก ${item.remaining} ชิ้น</span>`)}
                        </div>
                    </div>

                    <div class="text-center">
                        <label class="text-muted d-block" style="font-size: 0.75rem;" for="qty_${esc(p.id)}">จำนวน</label>
                        <input type="number" class="qty-input" id="qty_${esc(p.id)}" value="${item.qty}" min="1" step="1"
                            onchange="changeQty('${escArg(p.id)}', this.value)">
                    </div>

                    <div class="text-end" style="min-width: 110px;">
                        <div class="fw-bold text-danger">${baht(item.lineTotal)}</div>
                        <button class="btn btn-sm btn-link text-decoration-none text-muted p-0 mt-1"
                            onclick="removeItem('${escArg(p.id)}')" style="font-size: 0.8rem;">
                            <i class="fa-regular fa-trash-can me-1"></i>ลบ
                        </button>
                    </div>
                </div>
            `;
}

async function changeQty(productId, value) {
    const res = await KpopStore.updateCartQty(productId, value);
    if (!res.success) {
        alert(res.message);
        renderCart();
        return;
    }
    if (res.adjusted) {
        alert('จำนวนเกินโควตาที่รอบนี้รับได้ ระบบปรับให้เป็น ' + res.qty + ' ชิ้นค่ะ');
    }
    renderCart();
}

async function removeItem(productId) {
    await KpopStore.removeFromCart(productId);
    renderCart();
}

// ส่งไปหน้า checkout พร้อมบอกว่าเป็นการเช็คเอาต์ "ทั้งรอบ" ไม่ใช่สินค้าเดี่ยว
function checkoutRound(roundId) {
    window.location.href = 'checkout.html?round=' + encodeURIComponent(roundId);
}
