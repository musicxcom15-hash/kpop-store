// ชื่อสินค้า/ศิลปินมาจากการพิมพ์ของแอดมิน ต้องล้างก่อนต่อเป็น HTML
const esc = KpopStore.esc;

// หมวดที่เลือกอยู่ ('' = ทั้งหมด)
let selectedCategory = '';

KpopStore.ready(function () {
    renderRateBanner();
    renderCategoryChips();
    renderCatalog();
});

// ปุ่มกรองหมวดหมู่ — โชว์เฉพาะหมวดที่มีสินค้าจริง ถ้ามีหมวดเดียว (เช่นมีแต่อัลบั้ม) ไม่ต้องโชว์ปุ่มเลย
function renderCategoryChips() {
    const box = document.getElementById('categoryChips');
    if (!box) return;

    const counts = {};
    KpopStore.getProducts().forEach(p => {
        const code = KpopStore.getProductCategory(p).code;
        counts[code] = (counts[code] || 0) + 1;
    });
    const present = Object.keys(KpopStore.PRODUCT_CATEGORIES).filter(code => counts[code]);
    if (present.length < 2) {
        box.innerHTML = '';
        return;
    }

    const chip = (code, label, icon, count) => `
        <button type="button" class="btn btn-sm rounded-pill px-3 ${selectedCategory === code ? 'btn-dark' : 'btn-outline-secondary'}"
            onclick="selectCategory('${code}')">
            ${icon ? `<i class="fa-solid ${icon} me-1"></i>` : ''}${esc(label)} <span class="opacity-75">(${count})</span>
        </button>`;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    box.innerHTML = chip('', 'ทั้งหมด', '', total) +
        present.map(code => {
            const c = KpopStore.PRODUCT_CATEGORIES[code];
            return chip(code, c.label, c.icon, counts[code]);
        }).join('');
}

function selectCategory(code) {
    selectedCategory = code;
    renderCategoryChips();
    renderCatalog();
}

function renderCatalog() {
    const grid = document.getElementById('productsCatalogGrid');
    if (!grid) return;

    const products = KpopStore.getProducts();
    const search = (document.getElementById('storeSearchInput')?.value || '').toLowerCase();

    const filtered = products.filter(p => {
        if (selectedCategory && KpopStore.getProductCategory(p).code !== selectedCategory) return false;
        return !search || p.title.toLowerCase().includes(search) || p.artist.toLowerCase().includes(search);
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="col-12 text-center py-5 text-muted"><i class="fa-solid fa-magnifying-glass fs-1 opacity-50 d-block mb-3"></i>ไม่พบรายการสินค้าที่ค้นหา</div>`;
        return;
    }

    const rate = KpopStore.getCurrentRate();

    grid.innerHTML = filtered.map(p => {
        const price = KpopStore.getPriceTHB(p, rate.rate);
        const round = KpopStore.getRoundById(p.roundId);
        const state = KpopStore.getRoundState(round);
        const open = state === 'open';
        const remaining = KpopStore.getRemainingQuota(p.id);
        const soldOut = remaining !== null && remaining <= 0;
        // ป้าย OUT OF STOCK ที่แอดมินตั้ง = ปิดการขายจริง ไม่ใช่แค่ป้ายสี
        const sellable = KpopStore.isProductSellable(p);
        const buyable = open && !soldOut && sellable;

        return `
                <div class="col">
                    <div class="card product-card h-100" ${buyable ? '' : 'style="opacity:0.72;"'}>
                        <span class="badge-pink">${esc(p.status) || 'PRE-ORDER'}</span>
                        <img src="${esc(p.image)}" class="card-img-top product-img" alt="${esc(p.title)}" onerror="this.onerror=null; this.src='images/mapsoul7.jpg'">
                        <div class="card-body d-flex flex-column">
                            <div class="artist-name">${esc(p.artist)} · <i class="fa-solid ${KpopStore.getProductCategory(p).icon}"></i> ${esc(KpopStore.getProductCategory(p).label)}</div>
                            <h5 class="product-title">${esc(p.title)}</h5>
                            <div class="mb-2" style="font-size: 0.75rem;">
                                ${renderRoundChip(round, state)}
                                ${soldOut ? '<span class="badge bg-dark rounded-pill ms-1">เต็มโควตารอบนี้</span>' : ''}
                                ${!sellable ? '<span class="badge bg-secondary rounded-pill ms-1">หมดชั่วคราว</span>' : ''}
                            </div>
                            <div class="d-flex justify-content-between align-items-center mt-auto">
                                <div>
                                    <div class="price">฿${price.toLocaleString()}</div>
                                    <div class="small text-success fw-semibold" style="font-size: 0.72rem;"><i class="fa-solid fa-circle-check me-1"></i>รวมค่าส่งเกาหลี+ภาษีแล้ว (ไม่เก็บรอบ 2)</div>
                                </div>
                                ${buyable
                            ? `<a href="product-detail.html?id=${p.id}" class="btn btn-dark-custom text-decoration-none">ดูเพิ่มเติม</a>`
                            : `<a href="product-detail.html?id=${p.id}" class="btn btn-outline-secondary btn-sm rounded-pill px-3 text-decoration-none">ดูรายละเอียด</a>`}
                            </div>
                        </div>
                    </div>
                </div>
                `;
    }).join('');
}

// ป้ายบอกว่าสินค้าชิ้นนี้อยู่รอบไหนและรอบนั้นเปิดรับอยู่หรือยัง
function renderRoundChip(round, state) {
    if (!round) return '<span class="badge bg-light text-muted border rounded-pill">ยังไม่ระบุรอบ</span>';

    const map = {
        open: ['success', 'เปิดรับถึง ' + esc(round.closeAt)],
        upcoming: ['secondary', 'เปิดรับ ' + esc(round.openAt)],
        closed: ['dark', 'ปิดรับรอบนี้แล้ว'],
        ordered: ['primary', 'ร้านกดสั่งไปแล้ว'],
        arrived: ['info', 'ของถึงไทยแล้ว'],
        shipped: ['success', 'ส่งครบแล้ว']
    };
    const [badge, label] = map[state] || map.closed;
    return `<span class="badge bg-${badge} rounded-pill">${label}</span>`;
}

// แถบเรทราคากลาง ให้ลูกค้ารู้ว่าราคาที่เห็นมาจากเรทไหน (ตัวเลขมาจาก CENTRAL_RATE เสมอ ไม่ hardcode)
function renderRateBanner() {
    const box = document.getElementById('todayRateBanner');
    if (!box) return;
    const rate = KpopStore.getCurrentRate();
    box.innerHTML = `
                <i class="fa-solid fa-money-bill-transfer me-1"></i>
                เรทราคากลาง <strong>₩1,000 = ฿${(rate.rate * 1000).toFixed(2)}</strong>
                <span class="opacity-75">· ราคาทุกชิ้นคิดจากเรทนี้ ยอดจะถูกล็อกเมื่อคุณแนบสลิป</span>
            `;
}
