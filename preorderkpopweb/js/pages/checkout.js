// เช็คเอาต์รองรับ 2 ทาง:
//   ?round=<roundId>  มาจากตะกร้า — รวมทุกชิ้นในรอบนั้นเป็นออเดอร์เดียว จ่ายค่าส่งครั้งเดียว
//   ?id=&qty=&size=   มาจากปุ่ม "สั่งซื้อทันที" ในหน้าสินค้า — ชิ้นเดียว ไม่ผ่านตะกร้า
const urlParams = new URLSearchParams(window.location.search);
const checkoutRoundId = urlParams.get('round');
const productId = urlParams.get('id');
const sizeParam = urlParams.get('size') || '';
const esc = KpopStore.esc;

const shippingFee = 50;

let checkoutItems = [];   // [{ product, qty, size }]
let checkoutRound = null;
let fromCart = false;
let subtotalAmount = 0;
let totalAmount = 0;
// เรทตอนเปิดหน้า ใช้เทียบว่าเรทเปลี่ยนระหว่างที่ลูกค้ากรอกฟอร์มหรือไม่
let quotedRate = null;

// ออเดอร์ผูกกับอีเมลของผู้ใช้ (o.customerEmail) หน้านี้จึงต้องรู้ว่าใครสั่งเสมอ
// ของเดิมมี fallback ยัดอีเมลของ "คุณสมชาย" (บัญชีลูกค้าจริง) ให้คนที่ไม่ได้ล็อกอิน
// ออเดอร์ของคนแปลกหน้าจึงไปโผล่ในหน้าประวัติของลูกค้าคนนั้นพร้อมชื่อ ที่อยู่ และเบอร์โทร
function requireLogin() {
    return KpopStore.requireLogin(
        'กรุณาเข้าสู่ระบบก่อนทำรายการสั่งซื้อค่ะ\nระบบจะพากลับมาที่หน้านี้ให้อัตโนมัติหลังเข้าสู่ระบบ'
    );
}

KpopStore.ready(function () {
    if (!requireLogin()) return;

    quotedRate = KpopStore.getCurrentRate();

    if (checkoutRoundId) {
        loadFromCart();
    } else {
        loadSingleProduct();
    }

    if (checkoutItems.length === 0) return;

    checkoutRound = KpopStore.getRoundById(checkoutItems[0].product.roundId);
    renderCheckoutSummary();
    renderCheckoutAddress();
});

function loadFromCart() {
    fromCart = true;
    const group = KpopStore.getCartGroupedByRound(shippingFee).groups
        .find(g => g.roundId === checkoutRoundId);

    if (!group || group.items.length === 0) {
        alert('ไม่พบสินค้าของรอบนี้ในตะกร้าค่ะ');
        window.location.href = 'cart.html';
        return;
    }
    if (!group.orderable) {
        alert('รอบนี้ยังสั่งซื้อไม่ได้ค่ะ กรุณาตรวจสอบสถานะรอบและจำนวนในตะกร้าอีกครั้ง');
        window.location.href = 'cart.html';
        return;
    }

    checkoutItems = group.items.map(i => ({ product: i.product, qty: i.qty, size: i.size }));
}

function loadSingleProduct() {
    const product = productId ? KpopStore.getProductById(productId) : null;
    if (!product) {
        alert('ไม่พบสินค้าที่คุณเลือกค่ะ');
        window.location.href = 'index.html';
        return;
    }
    // ลิงก์ที่ไม่มีไซซ์ หรือไซซ์ที่ถูกลบไปแล้ว → กลับไปเลือกในหน้าสินค้า
    if (!KpopStore.isValidSize(product, sizeParam)) {
        alert('กรุณาเลือกไซซ์ในหน้าสินค้าก่อนค่ะ');
        window.location.href = 'product-detail.html?id=' + encodeURIComponent(product.id);
        return;
    }

    const quotaLeft = KpopStore.getRemainingQuota(product.id);
    const requested = KpopStore.normalizeQty(urlParams.get('qty'));

    if (!KpopStore.isProductSellable(product)) {
        alert('ขออภัย สินค้านี้ปิดการขายชั่วคราวค่ะ');
        blockSubmit('สินค้าหมดชั่วคราว');
        checkoutItems = [{ product, qty: requested, size: sizeParam }];
        return;
    }
    if (!KpopStore.isRoundOpen(product.roundId)) {
        blockSubmit('รอบพรีออเดอร์นี้ปิดรับแล้ว');
        checkoutItems = [{ product, qty: requested, size: sizeParam }];
        return;
    }
    if (quotaLeft !== null && quotaLeft <= 0) {
        alert('ขออภัย รอบพรีออเดอร์นี้เต็มโควตาแล้วค่ะ ทางร้านรับหิ้วเพิ่มไม่ไหวในรอบนี้');
        blockSubmit('ปิดรับพรีออเดอร์รอบนี้ (เต็มโควตา)');
        checkoutItems = [{ product, qty: requested, size: sizeParam }];
        return;
    }

    const qty = (quotaLeft !== null) ? Math.min(requested, quotaLeft) : requested;
    if (qty !== requested) {
        alert(`รอบนี้ทางร้านรับพรีออเดอร์ได้อีก ${qty} ชิ้น ระบบจึงปรับจำนวนในคำสั่งซื้อให้เป็น ${qty} ชิ้นค่ะ`);
    }

    checkoutItems = [{ product, qty, size: sizeParam }];
}

function blockSubmit(reason) {
    const btn = document.getElementById('submitOrderBtn');
    if (!btn) return;
    btn.disabled = true;
    btn.classList.add('btn-secondary');
    btn.innerHTML = `<i class="fa-solid fa-ban me-2"></i> ${reason}`;
}

function renderCheckoutSummary() {
    subtotalAmount = 0;

    document.getElementById('checkout-items').innerHTML = checkoutItems.map(entry => {
        const bd = KpopStore.getPriceBreakdown(entry.product, quotedRate.rate);
        const lineTotal = bd.total * entry.qty;
        subtotalAmount += lineTotal;

        return `
                    <div class="d-flex align-items-center mb-3">
                        <img src="${entry.product.image}" alt="${entry.product.title}" class="summary-item-img me-3"
                            onerror="this.onerror=null; this.src='images/mapsoul7.jpg'">
                        <div class="flex-grow-1">
                            <h6 class="mb-1" style="font-size: 0.95rem;">${esc(entry.product.title)}</h6>
                            ${entry.size ? `<span class="badge bg-light text-dark border mb-1">ไซซ์ ${esc(entry.size)}</span>` : ''}
                            <span class="text-muted d-block" style="font-size: 0.85rem;">จำนวน ${entry.qty} x ฿${bd.total.toLocaleString()}</span>
                            <span class="text-muted" style="font-size: 0.76rem;">
                                ${bd.legacy ? 'ราคาบาทคงที่' : `₩${bd.krw.toLocaleString()} x ${bd.rate} + ค่าบริการ ฿${bd.serviceFee.toLocaleString()}`}
                            </span>
                        </div>
                        <div style="font-weight: 500;">฿${lineTotal.toLocaleString()}</div>
                    </div>
                `;
    }).join('');

    totalAmount = subtotalAmount + shippingFee;

    document.getElementById('checkout-subtotal').innerText = '฿' + subtotalAmount.toLocaleString();
    document.getElementById('checkout-shipping').innerText = '฿' + shippingFee.toLocaleString();
    document.getElementById('checkout-total').innerText = '฿' + totalAmount.toLocaleString();

    document.getElementById('checkout-round-info').innerHTML = `
                <div class="fw-bold text-dark mb-1"><i class="fa-solid fa-layer-group me-1 text-danger"></i>
                    ${checkoutRound ? checkoutRound.name : 'รอบพรีออเดอร์'}
                </div>
                <div class="text-secondary">
                    ${checkoutRound ? 'ปิดรับ ' + checkoutRound.closeAt : ''}
                    ${checkoutRound && checkoutRound.estDelivery ? ' · คาดว่าได้รับ ' + checkoutRound.estDelivery : ''}
                    <br>คำนวณด้วยเรท <strong>${quotedRate.rate}</strong> (₩1,000 = ฿${(quotedRate.rate * 1000).toFixed(2)})
                    — ยอดนี้จะถูกล็อกทันทีที่คุณกดยืนยันและแนบสลิป
                </div>
            `;
}

function renderCheckoutAddress() {
    // หน้านี้บังคับล็อกอินตั้งแต่ DOMContentLoaded แล้ว จึงมี currentUser เสมอ
    const currentUser = KpopStore.getCurrentUser();
    const addrBox = document.querySelector('.checkout-card');
    if (addrBox && currentUser) {
        addrBox.innerHTML = `
                        <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
                            <h5 class="m-0 fw-bold" style="font-size: 1.1rem;"><i class="fa-solid fa-location-dot me-2 text-danger"></i>ที่อยู่สำหรับจัดส่ง</h5>
                            <button type="button" class="btn btn-sm btn-outline-primary rounded-pill px-3" onclick="KpopStore.openProfileModal()"><i class="fa-solid fa-user-pen me-1"></i> แก้ไขที่อยู่ / ข้อมูลติดต่อ</button>
                        </div>
                        <p class="mb-1" style="font-weight: 500;">ชื่อผู้รับ: ${currentUser.name}</p>
                        <p class="text-muted mb-1" style="font-size: 0.95rem;">เบอร์โทรศัพท์: ${currentUser.phone || 'ยังไม่ได้ระบุ'}</p>
                        <p class="text-muted mb-0" style="font-size: 0.95rem;">${currentUser.address || 'ยังไม่ได้ระบุที่อยู่ (คลิกปุ่มแก้ไขที่อยู่ด้านบน)'}</p>
                    `;
    }
}

function previewCheckoutSlip(input) {
    const previewBox = document.getElementById('slipPreviewBox');
    const previewImg = document.getElementById('slipPreviewImg');
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            previewImg.src = e.target.result;
            previewBox.classList.remove('d-none');
        };
        reader.readAsDataURL(input.files[0]);
    } else {
        previewBox.classList.add('d-none');
    }
}

function submitCheckoutOrder() {
    if (checkoutItems.length === 0) return;

    // เช็คซ้ำตอนกดยืนยัน เผื่อ session หมดไประหว่างกรอกฟอร์ม (เช่น ล็อกเอาต์อีกแท็บ)
    if (!requireLogin()) return;

    // รอบต้องยังเปิดอยู่ ณ วินาทีที่กดยืนยัน ไม่ใช่แค่ตอนเปิดหน้า
    if (!KpopStore.isRoundOpen(checkoutItems[0].product.roundId)) {
        alert('รอบพรีออเดอร์นี้ปิดรับไปแล้วค่ะ ไม่สามารถส่งคำสั่งซื้อได้');
        blockSubmit('รอบนี้ปิดรับแล้ว');
        return;
    }

    // สินค้าอาจถูกแอดมินปิดการขายระหว่างที่ลูกค้ากรอกฟอร์ม
    for (const entry of checkoutItems) {
        if (!KpopStore.isProductSellable(entry.product)) {
            alert(`ขออภัย "${entry.product.title}" ปิดการขายชั่วคราวแล้วค่ะ`);
            blockSubmit('สินค้าหมดชั่วคราว');
            return;
        }
    }

    // ตรวจโควตาทุกชิ้นอีกรอบ เผื่อมีคนอื่นสั่งตัดหน้าระหว่างที่กรอกฟอร์ม
    // โควตาใช้ร่วมกันทุกไซซ์ จึงรวมจำนวนต่อสินค้าก่อนเทียบ
    const qtyByProduct = new Map();
    checkoutItems.forEach(e => qtyByProduct.set(e.product, (qtyByProduct.get(e.product) || 0) + e.qty));
    for (const [product, qty] of qtyByProduct) {
        const remaining = KpopStore.getRemainingQuota(product.id);
        if (remaining === null) continue;
        if (remaining <= 0) {
            alert(`ขออภัย "${product.title}" เต็มโควตารอบนี้แล้วค่ะ`);
            return;
        }
        if (qty > remaining) {
            alert(`ขออภัย "${product.title}" รอบนี้รับได้อีกเพียง ${remaining} ชิ้น ไม่พอสำหรับจำนวนที่สั่ง (${qty} ชิ้น)`);
            return;
        }
    }

    // เรทอาจเปลี่ยนไปแล้ว (ร้าน deploy CENTRAL_RATE ใหม่) ระหว่างที่ลูกค้ากรอกฟอร์ม
    // ต้องแสดงยอดใหม่ให้เห็นก่อน แล้วให้กดยืนยันอีกครั้ง
    // ห้ามบันทึกเงียบ ๆ ด้วยยอดที่ลูกค้าไม่เคยเห็น
    const liveRate = KpopStore.getCurrentRate();
    if (liveRate.rate !== quotedRate.rate) {
        const oldTotal = totalAmount;
        quotedRate = liveRate;
        renderCheckoutSummary();
        alert(
            `เรทเงินวอนเพิ่งเปลี่ยนเป็น ${liveRate.rate} ระหว่างที่คุณกรอกข้อมูลค่ะ\n\n` +
            `ยอดชำระเดิม ฿${oldTotal.toLocaleString()}\n` +
            `ยอดชำระใหม่ ฿${totalAmount.toLocaleString()}\n\n` +
            `กรุณาตรวจสอบยอดใหม่แล้วกดยืนยันอีกครั้งค่ะ`
        );
        return;
    }

    const fileInput = document.getElementById('formFile');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
        alert('กรุณาเลือกและแนบไฟล์สลิปหลักฐานการโอนเงิน (Slip Upload) ก่อนดำเนินการสั่งซื้อค่ะ');
        fileInput.focus();
        return;
    }

    const termsCheck = document.getElementById('acceptTermsCheckbox');
    if (termsCheck && !termsCheck.checked) {
        alert('กรุณาทำเครื่องหมายยอมรับเงื่อนไขและข้อตกลงความรับผิดชอบก่อนทำการสั่งซื้อสินค้าค่ะ');
        return;
    }

    const btn = document.getElementById('submitOrderBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin me-2"></i> กำลังบีบอัดสลิปและบันทึกการสั่งซื้อ...`;

    // ผ่าน requireLogin() มาแล้วจึงมี currentUser เสมอ
    const currentUser = KpopStore.getCurrentUser();

    const proceedWithSlip = async (slipDataUrl) => {
        const orderData = {
            customerName: currentUser.name,
            customerEmail: currentUser.email,
            phone: currentUser.phone || '',
            address: currentUser.address || '',
            // ส่งเฉพาะ id กับ qty พอ — addOrder จะล็อกเรทแล้วคิดราคาจาก ₩ ให้เอง
            // ทำให้ยอดที่บันทึกมาจากแหล่งเดียวเสมอ ไม่มีทางเพี้ยนจากที่หน้าจอคำนวณไว้
            items: checkoutItems.map(entry => ({
                id: entry.product.id,
                title: entry.product.title,
                size: entry.size || '',
                qty: entry.qty,
                image: entry.product.image
            })),
            shippingFee: shippingFee,
            slipImage: slipDataUrl
        };

        const result = await KpopStore.addOrder(orderData);

        // ลูกค้าโอนเงินมาแล้วก่อนถึงจุดนี้ ถ้าบันทึกไม่ลงห้ามบอกว่าสำเร็จเด็ดขาด
        // และห้ามล้างตะกร้า เพื่อให้ลูกค้ากดยืนยันซ้ำได้
        if (!result.success) {
            btn.disabled = false;
            btn.innerHTML = 'ยืนยันการสั่งซื้อและแจ้งชำระเงิน';
            alert('บันทึกคำสั่งซื้อไม่สำเร็จค่ะ\n\n' + result.message +
                '\n\nยังไม่มีการบันทึกคำสั่งซื้อนี้ กรุณาลองใหม่อีกครั้ง');
            return;
        }

        const createdOrder = result.order;

        // ล้างเฉพาะรอบที่เพิ่งจ่าย ของรอบอื่นในตะกร้าต้องอยู่ต่อ
        if (fromCart) await KpopStore.clearCartRound(checkoutRoundId);

        alert(
            `สั่งซื้อและแนบสลิปแจ้งชำระเงินเรียบร้อยแล้ว!\n` +
            `หมายเลขคำสั่งซื้อของคุณคือ #${createdOrder.id}\n` +
            `ยอดชำระ ฿${(createdOrder.total || 0).toLocaleString()} (ล็อกที่เรท ${createdOrder.rateUsed})`
        );
        window.location.href = 'order-history.html';
    };

    // Compress slip image to prevent localStorage quota overflow
    KpopStore.compressSlipImage(fileInput.files[0], function (compressedDataUrl) {
        if (!compressedDataUrl) {
            btn.disabled = false;
            btn.innerHTML = 'ยืนยันการสั่งซื้อและแจ้งชำระเงิน';
            alert('เกิดข้อผิดพลาดในการอ่านไฟล์สลิป กรุณาลองเลือกรูปภาพใหม่อีกครั้งค่ะ');
            return;
        }
        proceedWithSlip(compressedDataUrl);
    });
}
