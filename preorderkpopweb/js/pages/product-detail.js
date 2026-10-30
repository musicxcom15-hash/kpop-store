const urlParams = new URLSearchParams(window.location.search);
const productId = urlParams.get('id');

// จำนวนที่สั่งเกินกว่านี้ให้ถามยืนยันก่อน กันกรอกเลขผิด (เช่น พิมพ์ 999)
const CONFIRM_QTY_THRESHOLD = 10;

// โควตารับพรีออเดอร์คงเหลือของรอบนี้ (null = รับไม่จำกัด)
let quotaLeft = null;
let currentProduct = null;
let currentRound = null;
let roundState = 'closed';
// ไซซ์ที่ลูกค้าเลือก ('' = ยังไม่เลือก หรือสินค้าไม่มีไซซ์)
let selectedSize = '';

KpopStore.ready(function () {
    // หน้านี้เปิดให้ guest ดูได้เต็มหน้า (ราคา รอบพรีออเดอร์ นับถอยหลัง)
    // กำแพงล็อกอินย้ายไปอยู่ที่ปุ่ม "เพิ่มลงตะกร้า" และ "สั่งซื้อทันที" แทน
    // — คนที่ยังไม่มีบัญชีจะได้ตัดสินใจจากข้อมูลจริงก่อนสมัคร

    // ตรวจ id จาก URL ให้แน่ใจว่ามีสินค้าจริง แทนที่จะเงียบ ๆ ใช้สินค้าตัวแรกแทน
    // (บั๊กเดิม: ส่ง id ดิบจาก URL ต่อไปหน้า checkout โดยไม่ตรวจ)
    currentProduct = productId ? KpopStore.getProductById(productId) : null;
    if (!currentProduct) {
        alert('ไม่พบสินค้าที่คุณเลือก ระบบจะพากลับไปหน้ารายการสินค้าค่ะ');
        window.location.href = 'index.html';
        return;
    }

    currentRound = KpopStore.getRoundById(currentProduct.roundId);
    roundState = KpopStore.getRoundState(currentRound);

    const breakdown = KpopStore.getPriceBreakdown(currentProduct);

    // ศิลปิน · หมวดหมู่ และป้ายนับชาร์ตเฉพาะหมวดที่นับได้จริง (ตัดสินด้วย flag chart ไม่ใช่ชื่อหมวด)
    const category = KpopStore.getProductCategory(currentProduct);
    document.getElementById('display-artist').innerHTML =
        `${KpopStore.esc(currentProduct.artist)} · <i class="fa-solid ${category.icon}"></i> ${KpopStore.esc(category.label)}` +
        (category.chart ? ' <span class="badge bg-success ms-1" style="font-size: 0.7rem;">นับเข้าชาร์ต HANTEO & GAON</span>' : '');
    document.getElementById('display-title').innerText = currentProduct.title;
    document.getElementById('display-price').innerText = '฿' + breakdown.total.toLocaleString();
    document.getElementById('display-desc').innerText = currentProduct.desc || 'ไม่มีรายละเอียดเพิ่มเติม';
    document.getElementById('display-image').src = currentProduct.image;

    renderRoundInfo(breakdown);
    renderSizePicker();
    renderAdminSourceLink();

    quotaLeft = KpopStore.getRemainingQuota(currentProduct.id);
    // ต้องคืนค่าจำนวนก่อน setupQtyLimit() เพราะตัวนั้นเรียก applyQtyLimit() ต่อ
    // ซึ่งจะ clamp ค่าให้อยู่ในโควตาที่เหลือจริงให้เอง
    restoreQtyFromUrl();
    setupQtyLimit();
    applyRoundGating();

    updateRoundCountdown();
    setInterval(updateRoundCountdown, 1000);
});

const ROUND_STATE_TEXT = {
    open: ['success', 'เปิดรับอยู่'],
    upcoming: ['secondary', 'ยังไม่เปิดรับ'],
    closed: ['dark', 'ปิดรับแล้ว'],
    ordered: ['primary', 'ร้านกดสั่งกับเกาหลีแล้ว'],
    arrived: ['info', 'ของถึงไทยแล้ว'],
    shipped: ['success', 'ส่งครบแล้ว']
};

function renderRoundInfo(breakdown) {
    const [badge, label] = ROUND_STATE_TEXT[roundState] || ROUND_STATE_TEXT.closed;
    const stateEl = document.getElementById('display-round-state');
    stateEl.className = `badge bg-${badge} rounded-pill px-2 py-1`;
    stateEl.innerText = label;

    document.getElementById('display-round-name').innerText = currentRound ? currentRound.name : 'ยังไม่ได้ผูกรอบ';
    document.getElementById('display-preorder-period').innerText = currentRound
        ? `${currentRound.openAt} ถึง ${currentRound.closeAt}`
        : '-';
    document.getElementById('display-est-delivery').innerText =
        currentProduct.estDelivery || (currentRound && currentRound.estDelivery) || '-';

    document.getElementById('price-breakdown-text').innerHTML = breakdown.legacy
        ? 'สินค้านี้ตั้งราคาเป็นเงินบาทคงที่ ไม่ผูกกับเรทเงินวอน'
        : `₩${breakdown.krw.toLocaleString()} x เรท ${breakdown.rate}
                   = <strong>฿${breakdown.converted.toLocaleString()}</strong>
                   บวกค่าบริการหิ้ว ฿${breakdown.serviceFee.toLocaleString()}
                   = <strong class="text-danger">฿${breakdown.total.toLocaleString()}</strong>`;
}

// ปิดปุ่มสั่งซื้อเมื่อรอบยังไม่เปิด ปิดไปแล้ว หรือเต็มโควตา
function applyRoundGating() {
    const soldOut = quotaLeft !== null && quotaLeft <= 0;
    const unsellable = !KpopStore.isProductSellable(currentProduct);
    const blocked = roundState !== 'open' || soldOut || unsellable;
    if (!blocked) return;

    const [, label] = ROUND_STATE_TEXT[roundState] || ROUND_STATE_TEXT.closed;
    // เรียงตามความ "ตรงประเด็น" ที่สุดก่อน: ร้านปิดขายเอง > โควตาเต็ม > สถานะรอบ
    const reason = unsellable
        ? 'สินค้าหมดชั่วคราว'
        : (soldOut ? 'รอบนี้เต็มโควตาแล้ว' : label);

    ['addToCartBtn', 'buyNowBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = true;
        btn.classList.add('btn-secondary');
        btn.innerHTML = `<i class="fa-solid fa-ban me-2"></i> ${reason}`;
    });
}

// พา guest ไปล็อกอิน แต่จำสินค้าและจำนวนที่กรอกไว้ กลับมาแล้วกดต่อได้เลย
// ตั้งใจไม่สั่งซื้อ/ไม่หยิบลงตะกร้าให้อัตโนมัติหลังล็อกอิน — ผู้ใช้ต้องเป็นคนกดยืนยันเอง
function requireLoginForAction(qty) {
    const next = `product-detail.html?id=${encodeURIComponent(currentProduct.id)}&qty=${qty}` +
        (selectedSize ? `&size=${encodeURIComponent(selectedSize)}` : '');
    return KpopStore.requireLogin(
        'กรุณาเข้าสู่ระบบก่อนสั่งซื้อหรือเพิ่มลงตะกร้าค่ะ\nระบบจะพากลับมาที่สินค้าชิ้นนี้ให้อัตโนมัติ',
        next
    );
}

// อ่านจำนวนที่พ่วงกลับมากับ ?qty= หลังล็อกอินเสร็จ
// ไม่ต้อง validate เองตรงนี้ applyQtyLimit() จัดการให้ทีหลัง
function restoreQtyFromUrl() {
    const input = document.getElementById('qtyInput');
    const qtyParam = urlParams.get('qty');
    if (input && qtyParam) input.value = qtyParam;
}

// ลิงก์ร้านต้นทาง — เฉพาะแอดมิน
// bootstrap.php ส่ง sourceUrl มาให้แอดมินเท่านั้น เบราว์เซอร์ของลูกค้าจึงไม่มีข้อมูลนี้อยู่แล้ว
// เช็ค role ซ้ำตรงนี้เพื่อไม่ให้ปุ่มโผล่ผิดคน ถ้าวันหนึ่ง bootstrap เปลี่ยน
function renderAdminSourceLink() {
    const user = KpopStore.getCurrentUser();
    const box = document.getElementById('adminSourceLink');
    if (!box || !user || user.role !== 'admin' || !currentProduct.sourceUrl) return;

    box.innerHTML = `
        <a href="${KpopStore.esc(currentProduct.sourceUrl)}" target="_blank" rel="noopener noreferrer"
            class="btn btn-sm btn-outline-secondary rounded-pill px-3">
            <i class="fa-solid fa-arrow-up-right-from-square me-1"></i>เปิดร้านต้นทาง
            <span class="badge bg-secondary ms-1 fw-normal">เห็นเฉพาะแอดมิน</span>
        </a>`;
    box.style.display = '';
}

// --- ไซซ์ ---
// สินค้าที่มีไซซ์: ต้องเลือกก่อนใส่ตะกร้า/สั่งซื้อ ราคาเท่ากันทุกไซซ์ (เซิร์ฟเวอร์ตรวจซ้ำว่าไซซ์มีจริง)
function renderSizePicker() {
    const sizes = KpopStore.getProductSizes(currentProduct);
    const box = document.getElementById('sizePicker');
    if (!box || sizes.length === 0) return;

    // กลับมาจากหน้าล็อกอินพร้อม ?size= — ใช้ได้เฉพาะไซซ์ที่ยังมีอยู่จริง
    const fromUrl = urlParams.get('size') || '';
    selectedSize = sizes.includes(fromUrl) ? fromUrl : '';

    document.getElementById('sizeOptions').innerHTML = sizes.map(size => `
        <button type="button" class="size-option" data-size="${KpopStore.esc(size)}"
            onclick="selectSize(this.dataset.size)">${KpopStore.esc(size)}</button>`).join('');
    box.style.display = '';
    updateSizeButtons();
}

function selectSize(size) {
    selectedSize = size;
    document.getElementById('sizePicker').classList.remove('needs-size');
    updateSizeButtons();
}

function updateSizeButtons() {
    document.querySelectorAll('#sizeOptions .size-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.size === selectedSize);
    });
    document.getElementById('sizeChosenText').innerText = selectedSize ? `: ${selectedSize}` : '(กรุณาเลือก)';
}

// คืน true ถ้าพร้อมไปต่อ (ไม่มีไซซ์ให้เลือก หรือเลือกแล้ว)
function ensureSizeChosen() {
    if (KpopStore.getProductSizes(currentProduct).length === 0 || selectedSize) return true;
    const box = document.getElementById('sizePicker');
    box.classList.add('needs-size');
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    alert('กรุณาเลือกไซซ์ก่อนค่ะ');
    return false;
}

async function addCurrentToCart() {
    const input = document.getElementById('qtyInput');
    const qty = KpopStore.normalizeQty(input ? input.value : 1, quotaLeft);

    if (!ensureSizeChosen()) return;

    // ต้องกันก่อนเรียก addToCart เพราะ store ไม่ได้เช็กล็อกอินให้
    // และตะกร้าฝั่งเซิร์ฟเวอร์ผูกกับบัญชี ถ้าไม่กันจะได้แค่ข้อความ 401 เปล่า ๆ
    if (!requireLoginForAction(qty)) return;

    const res = await KpopStore.addToCart(currentProduct.id, qty, selectedSize);

    if (!res.success) {
        alert(res.message);
        return;
    }
    if (res.adjusted) {
        alert(`รอบนี้รับได้อีกไม่ถึงจำนวนที่ขอ ระบบปรับจำนวนในตะกร้าเป็น ${res.qty} ชิ้นค่ะ`);
    }

    if (KpopStore.renderNavbarAuth) KpopStore.renderNavbarAuth();
    if (confirm(`เพิ่ม "${KpopStore.formatItemName(currentProduct.title, selectedSize)}" ลงตะกร้าแล้ว (รวม ${res.qty} ชิ้น)\n\nไปที่ตะกร้าเลยไหมคะ?`)) {
        window.location.href = 'cart.html';
    }
}

// นับถอยหลังไป "วันปิดรอบจริง" ของรอบนี้
// ของเดิมนับถอยหลังไป 22:00 ทุกวันในฐานะรอบตัดยอด ซึ่งไม่ตรงกับธุรกิจ
// (22:00 คือเวลาที่เรทเงินวอนเปลี่ยน ไม่ใช่เวลาปิดรับออเดอร์)
function updateRoundCountdown() {
    const timerEl = document.getElementById('round-countdown-timer');
    const helperEl = document.getElementById('round-helper-text');
    if (!timerEl || !currentRound) return;

    if (roundState !== 'open') {
        const [, label] = ROUND_STATE_TEXT[roundState] || ROUND_STATE_TEXT.closed;
        timerEl.innerText = label;
        timerEl.className = 'font-monospace fw-bold text-secondary fs-5';
        helperEl.innerHTML = roundState === 'upcoming'
            ? `<i class="fa-solid fa-circle-info me-1 text-primary"></i>รอบนี้จะเปิดรับวันที่ ${currentRound.openAt} ค่ะ`
            : '<i class="fa-solid fa-triangle-exclamation me-1 text-warning"></i>รอบนี้ปิดรับแล้ว กรุณารอรอบถัดไปค่ะ';
        return;
    }

    // ปิดรับเมื่อสิ้นสุดวัน closeAt
    const closeAt = new Date(currentRound.closeAt + 'T23:59:59');
    const diffMs = closeAt - new Date();

    if (diffMs <= 0) {
        timerEl.innerText = 'ปิดรับแล้ว';
        return;
    }

    const days = Math.floor(diffMs / 86400000);
    const hours = Math.floor((diffMs % 86400000) / 3600000);
    const minutes = Math.floor((diffMs % 3600000) / 60000);
    const seconds = Math.floor((diffMs % 60000) / 1000);
    const pad = n => String(n).padStart(2, '0');

    timerEl.innerText = days > 0
        ? `${days} วัน ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
        : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

    helperEl.innerHTML = `<i class="fa-solid fa-circle-info me-1 text-primary"></i>` +
        `ปิดรับวันที่ <strong>${currentRound.closeAt}</strong> หลังจากนั้นร้านจะรวบรวมยอดไปกดสั่งกับเกาหลีค่ะ`;
}

// ตั้งค่าเพดานของช่องกรอกจำนวน + ข้อความบอกโควตาคงเหลือ
function setupQtyLimit() {
    const input = document.getElementById('qtyInput');
    const hint = document.getElementById('quotaHint');
    if (!input) return;

    if (quotaLeft !== null && quotaLeft > 0) {
        input.max = quotaLeft;
        if (hint) hint.innerText = `รอบนี้รับได้อีก ${quotaLeft} ชิ้น` + (KpopStore.getProductSizes(currentProduct).length ? ' (รวมทุกไซซ์)' : '');
    } else if (quotaLeft !== null && quotaLeft <= 0) {
        input.max = 1;
        input.disabled = true;
        if (hint) hint.innerText = 'รอบนี้เต็มโควตาแล้ว';
    } else {
        input.removeAttribute('max');
        if (hint) hint.innerText = '';
    }

    applyQtyLimit();
}

// ล้างค่าที่กรอกให้เป็นจำนวนเต็มบวกเสมอ และไม่เกินโควตาคงเหลือ
// คืนค่า true ถ้าค่าถูกปรับ เพื่อให้ผู้เรียกแจ้งผู้ใช้ได้
function applyQtyLimit() {
    const input = document.getElementById('qtyInput');
    if (!input) return false;

    const raw = input.value;
    const normalized = KpopStore.normalizeQty(raw, quotaLeft);
    // เทียบเป็นตัวเลข เพื่อไม่ให้ค่าอย่าง "01" หรือ "1.0" ถูกนับว่าถูกปรับ
    const wasAdjusted = Number(raw) !== normalized;

    input.value = normalized;
    return wasAdjusted;
}

function goToCheckout() {
    // ต้องอ่านค่าดิบไว้ก่อน applyQtyLimit() เพราะตัวนั้นเขียนทับค่าในช่องกรอก
    const input = document.getElementById('qtyInput');
    const rawValue = input ? input.value : 1;

    if (!ensureSizeChosen()) return;

    // เช็กล็อกอินก่อน dialog ยืนยันจำนวนใด ๆ
    // guest จะได้ไม่ต้องตอบ confirm ก่อนแล้วค่อยโดนเด้งออก
    if (!requireLoginForAction(KpopStore.normalizeQty(rawValue, quotaLeft))) return;

    if (quotaLeft !== null && quotaLeft <= 0) {
        alert('ขออภัย รอบพรีออเดอร์นี้เต็มโควตาแล้วค่ะ กรุณารอรอบถัดไป');
        return;
    }

    const wasAdjusted = applyQtyLimit();
    const qty = KpopStore.normalizeQty(rawValue, quotaLeft);

    if (wasAdjusted) {
        alert(`จำนวนที่กรอก (${rawValue || 'ว่าง'}) ใช้ไม่ได้ ระบบปรับให้เป็น ${qty} ชิ้นค่ะ\nกรุณาตรวจสอบอีกครั้งก่อนกดสั่งซื้อ`);
        return;
    }

    if (qty > CONFIRM_QTY_THRESHOLD &&
        !confirm(`คุณกำลังสั่งซื้อจำนวน ${qty} ชิ้น ยืนยันว่าต้องการจำนวนนี้จริงหรือไม่?`)) {
        return;
    }

    // ใช้ id ของสินค้าที่ยืนยันแล้วว่ามีจริงตอนโหลดหน้า ไม่ใช่ค่าดิบจาก URL
    window.location.href = `checkout.html?id=${encodeURIComponent(currentProduct.id)}&qty=${qty}` +
        (selectedSize ? `&size=${encodeURIComponent(selectedSize)}` : '');
}
