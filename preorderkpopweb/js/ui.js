/**
 * KPOP STORE - ส่วนแสดงผลกลาง (navbar, modal, แถบล่างมือถือ)
 *
 * แยกออกมาจาก store.js ซึ่งเป็น data layer ล้วน ๆ
 * ไฟล์นี้ผูกเมธอดกลับเข้า KpopStore ตัวเดิม จุดเรียกใช้แบบ onclick="KpopStore.xxx()"
 * ในทุกหน้าจึงใช้ได้เหมือนเดิมโดยไม่ต้องแก้
 *
 * ต้องโหลด หลัง js/store.js เสมอ
 */
(function (global) {
    if (!global.KpopStore) {
        console.error('ui.js ต้องถูกโหลดหลัง store.js');
        return;
    }

    // --- ตัวช่วยกัน HTML พัง (ใช้ร่วมกันทุกหน้า) ---
    // ข้อมูลที่ลูกค้าและแอดมินพิมพ์เข้ามา (ชื่อ ที่อยู่ หมายเหตุ ชื่อสินค้า) ถูกเอาไปต่อเป็น HTML
    // หลายสิบจุด ถ้าไม่ล้างก่อน อักขระอย่าง < " ' จะทำให้หน้าเพี้ยนหรือถูกฝังสคริปต์ได้
    // เดิมแต่ละหน้านิยาม esc/escArg เองคนละชุด และบางชุดทำไม่ครบ
    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // สำหรับค่าที่ถูกวางในสตริง JS ภายใน attribute เช่น onclick="fn('...')"
    // ต้อง escape ทั้งชั้น JS (backslash, quote) แล้วส่งต่อให้ esc จัดการชั้น HTML อีกที
    function escArg(value) {
        return esc(String(value === null || value === undefined ? '' : value)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'"));
    }

    Object.assign(global.KpopStore, {
        esc: esc,
        escArg: escArg,

        // --- กำแพงล็อกอินกลาง ---
        // เดิม pattern "alert แล้วพาไป login.html?next=" ถูกคัดลอกไว้ในแต่ละหน้า
        // (product-detail, checkout) แก้ทีต้องไล่แก้ทุกไฟล์ และหลุดง่ายเวลาเพิ่มหน้าใหม่
        //
        // nextUrl ส่งเองได้ เพื่อพ่วง state ที่ผู้ใช้กรอกค้างไว้กลับมาด้วย (เช่น &qty=)
        // ถ้าไม่ส่งจะใช้ URL ของหน้าปัจจุบัน
        requireLogin(message, nextUrl) {
            if (this.getCurrentUser()) return true;
            alert(message || 'กรุณาเข้าสู่ระบบก่อนค่ะ\nระบบจะพากลับมาที่หน้านี้ให้อัตโนมัติหลังเข้าสู่ระบบ');
            const back = nextUrl || (window.location.pathname.split('/').pop() + window.location.search);
            window.location.href = 'login.html?next=' + encodeURIComponent(back);
            return false;
        },

        // อ่าน ?next= ของหน้าปัจจุบัน โดยรับเฉพาะ path ภายในเว็บเท่านั้น
        // ถ้าปล่อยให้เป็น URL เต็ม (http://, //evil.com) จะกลายเป็น open redirect
        // ที่พาผู้ใช้ไปเว็บปลอมหลังกดล็อกอินได้
        getSafeNextUrl() {
            const next = new URLSearchParams(window.location.search).get('next');
            if (!next) return null;
            // ตัด URL เต็ม, path จาก root และ path ที่ไต่ออกนอกโฟลเดอร์เว็บ
            if (/^[a-z][a-z0-9+.-]*:/i.test(next) || next.startsWith('/') || next.includes('..')) {
                return null;
            }
            return next;
        },

        // ออกจากระบบ = ล้าง session (store.js) + แจ้งผู้ใช้และพากลับหน้าแรก (ที่นี่)
        async logout() {
            await this.clearSession();
            alert('ออกจากระบบเรียบร้อยแล้วค่ะ');
            window.location.href = 'index.html';
        },

        openProfileModal() {
            const currentUser = this.getCurrentUser();
            if (!currentUser) {
                alert('กรุณาเข้าสู่ระบบก่อนทำการแก้ไขข้อมูลส่วนตัวค่ะ');
                window.location.href = 'login.html';
                return;
            }

            let modalEl = document.getElementById('globalProfileModal');
            if (!modalEl) {
                const modalHtml = `
                    <div class="modal fade" id="globalProfileModal" tabindex="-1" aria-hidden="true" style="z-index: 1060;">
                        <div class="modal-dialog modal-dialog-centered">
                            <div class="modal-content border-0 shadow-lg" style="border-radius: 16px;">
                                <div class="modal-header bg-light">
                                    <h5 class="modal-title fw-bold text-dark"><i class="fa-solid fa-user-pen me-2 text-primary"></i>แก้ไขข้อมูลส่วนตัวและที่อยู่จัดส่ง</h5>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                                </div>
                                <div class="modal-body p-4">
                                    <form id="globalProfileForm" onsubmit="KpopStore.handleProfileSubmit(event)">
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" style="font-size: 0.88rem;">อีเมลบัญชีผู้ใช้</label>
                                            <input type="email" id="profileEmail" class="form-control bg-light" disabled>
                                        </div>
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" style="font-size: 0.88rem;">ชื่อ - นามสกุล ผู้รับพัสดุ</label>
                                            <input type="text" id="profileName" class="form-control" required placeholder="ระบุชื่อและนามสกุลผู้รับ">
                                        </div>
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" style="font-size: 0.88rem;">เบอร์โทรศัพท์ติดต่อ</label>
                                            <input type="tel" id="profilePhone" class="form-control" placeholder="08X-XXX-XXXX" required>
                                        </div>
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" style="font-size: 0.88rem;">ที่อยู่จัดส่งพัสดุ (ปัจจุบัน / ย้ายที่อยู่ใหม่)</label>
                                            <textarea id="profileAddress" class="form-control" rows="3" placeholder="บ้านเลขที่, ซอย, ถนน, ตำบล/แขวง, อำเภอ/เขต, จังหวัด, รหัสไปรษณีย์" required></textarea>
                                        </div>
                                        <div class="d-flex justify-content-end gap-2 mt-4">
                                            <button type="button" class="btn btn-light rounded-pill px-4" data-bs-dismiss="modal">ยกเลิก</button>
                                            <button type="submit" class="btn btn-primary rounded-pill px-4 fw-bold">บันทึกข้อมูลส่วนตัว</button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                document.body.insertAdjacentHTML('beforeend', modalHtml);
                modalEl = document.getElementById('globalProfileModal');
            }

            document.getElementById('profileEmail').value = currentUser.email || '';
            document.getElementById('profileName').value = currentUser.name || '';
            document.getElementById('profilePhone').value = currentUser.phone || '';
            document.getElementById('profileAddress').value = currentUser.address || '';

            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        },
        async handleProfileSubmit(e) {
            e.preventDefault();
            const name = document.getElementById('profileName').value;
            const phone = document.getElementById('profilePhone').value;
            const address = document.getElementById('profileAddress').value;

            const res = await this.updateProfile({ name, phone, address });
            if (!res.success) {
                alert('บันทึกไม่สำเร็จค่ะ\n\n' + res.message);
                return;
            }
            if (res.success) {
                const modalEl = document.getElementById('globalProfileModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();

                alert('บันทึกข้อมูลส่วนตัวและที่อยู่ใหม่เรียบร้อยแล้วค่ะ!');
                
                this.renderNavbarAuth();
                if (typeof renderCustomerProfile === 'function') renderCustomerProfile();
                if (typeof renderCheckoutAddress === 'function') renderCheckoutAddress();
            }
        },

        // Navigation actions
        goToAllProducts() {
            const currentPath = window.location.pathname;
            if (currentPath.endsWith('index.html') || currentPath.endsWith('/') || currentPath === '') {
                const searchInput = document.getElementById('storeSearchInput');
                if (searchInput) {
                    searchInput.value = '';
                    if (typeof renderCatalog === 'function') renderCatalog();
                }
                const catalogGrid = document.getElementById('productsCatalogGrid');
                if (catalogGrid) {
                    catalogGrid.scrollIntoView({ behavior: 'smooth' });
                }
            } else {
                window.location.href = 'index.html#productsCatalogGrid';
            }
        },

        openHowToOrderModal() {
            let modalEl = document.getElementById('globalHowToOrderModal');
            if (!modalEl) {
                const modalHtml = `
                    <div class="modal fade" id="globalHowToOrderModal" tabindex="-1" aria-hidden="true" style="z-index: 1060;">
                        <div class="modal-dialog modal-dialog-centered modal-lg">
                            <div class="modal-content border-0 shadow-lg" style="border-radius: 18px;">
                                <div class="modal-header bg-dark text-white p-3">
                                    <h5 class="modal-title fw-bold m-0"><i class="fa-solid fa-circle-question text-pink me-2"></i>ขั้นตอนการสั่งพรีออเดอร์ (How to Order)</h5>
                                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                                </div>
                                <div class="modal-body p-4" style="background: #fafafa;">
                                    <div class="row g-3 mb-4">
                                        <div class="col-md-6">
                                            <div class="p-3 bg-white rounded-3 border h-100 shadow-sm d-flex gap-3 align-items-start">
                                                <div class="badge rounded-circle p-3 text-white fw-bold fs-5" style="background: #ff3399; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">1</div>
                                                <div>
                                                    <h6 class="fw-bold mb-1 text-dark">เลือกอัลบั้มพรีออเดอร์</h6>
                                                    <p class="text-muted m-0" style="font-size: 0.85rem; line-height: 1.4;">เลือกสินค้าอัลบั้มศิลปิน K-POP แท้ 100% จากเกาหลี ระบุจำนวนที่ต้องการ แล้วกดปุ่ม "ดูเพิ่มเติม" หรือ "สั่งซื้อทันที"</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="col-md-6">
                                            <div class="p-3 bg-white rounded-3 border h-100 shadow-sm d-flex gap-3 align-items-start">
                                                <div class="badge rounded-circle p-3 text-white fw-bold fs-5" style="background: #3366ff; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">2</div>
                                                <div>
                                                    <h6 class="fw-bold mb-1 text-dark">ตรวจสอบที่อยู่ & ข้อตกลง</h6>
                                                    <p class="text-muted m-0" style="font-size: 0.85rem; line-height: 1.4;">ตรวจสอบชื่อ-เบอร์โทร และที่อยู่จัดส่งพัสดุ (กดแก้ไขย้ายที่อยู่ได้ตลอดเวลา) พร้อมทำเครื่องหมายยอมรับเงื่อนไขพรีออเดอร์</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="col-md-6">
                                            <div class="p-3 bg-white rounded-3 border h-100 shadow-sm d-flex gap-3 align-items-start">
                                                <div class="badge rounded-circle p-3 text-white fw-bold fs-5" style="background: #28a745; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">3</div>
                                                <div>
                                                    <h6 class="fw-bold mb-1 text-dark">โอนเงิน & แนบสลิป (Slip Upload)</h6>
                                                    <p class="text-muted m-0" style="font-size: 0.85rem; line-height: 1.4;">สแกน QR Code หรือโอนเงินผ่านบัญชีธนาคารร้านค้า แล้วทำการแนบภาพหลักฐานการโอนเงิน (สลิป) เพื่อยืนยันคำสั่งซื้อ</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="col-md-6">
                                            <div class="p-3 bg-white rounded-3 border h-100 shadow-sm d-flex gap-3 align-items-start">
                                                <div class="badge rounded-circle p-3 text-white fw-bold fs-5" style="background: #ff9900; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">4</div>
                                                <div>
                                                    <h6 class="fw-bold mb-1 text-dark">รอร้านตรวจสอบ & แจ้งเลขพัสดุ</h6>
                                                    <p class="text-muted m-0" style="font-size: 0.85rem; line-height: 1.4;">ผู้ขายจะตรวจสอบสลิปการโอนเงิน (Manual Verification) และอัปเดตสถานะพร้อมแจ้ง Tracking Number ในหน้าประวัติคำสั่งซื้อ</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="p-3 bg-white border rounded-3 mb-3" style="font-size: 0.82rem; line-height: 1.5; border-left: 4px solid #ff9900 !important;">
                                        <div class="fw-bold text-dark mb-1"><i class="fa-solid fa-scale-balanced me-1 text-warning"></i> สถานะของร้านค้า (โปรดอ่านก่อนสั่งซื้อ)</div>
                                        <ul class="m-0 text-secondary ps-3">
                                            <li><strong>ทางร้านเป็นเพียงตัวกลางรับสั่งซื้อและจัดส่งให้ลูกค้า</strong> ไม่ใช่ผู้ผลิตสินค้า และไม่ใช่ตัวแทนจำหน่ายอย่างเป็นทางการจากเว็บไซต์เกาหลี</li>
                                            <li><strong>ราคาที่แสดงเป็นราคาประมาณการ</strong> ตามเรทเงินวอนของวันนั้น ยอดที่ต้องชำระจริงจะถูกล็อกเมื่อคุณแนบสลิป หลังจากนั้นเรทจะขยับอย่างไรก็ไม่กระทบคำสั่งซื้อของคุณ</li>
                                            <li><strong>หากเว็บไซต์เกาหลียกเลิกรอบ หรือสินค้าหมดก่อนที่ร้านจะกดสั่งสำเร็จ ทางร้านจะคืนเงินให้เต็มจำนวน</strong> โดยจะปรับสถานะคำสั่งซื้อเป็น "รอคืนเงิน" และแจ้งให้ทราบทันที</li>
                                        </ul>
                                    </div>

                                    <div class="p-3 bg-white border rounded-3" style="font-size: 0.82rem; line-height: 1.5;">
                                        <div class="fw-bold text-dark mb-1"><i class="fa-solid fa-shield-halved me-1 text-warning"></i> มาตรฐานและเงื่อนไขการให้บริการ</div>
                                        <ul class="m-0 text-secondary ps-3">
                                            <li>อัตราแลกเปลี่ยน KRW/THB กำหนดโดยร้านค้าด้วยตนเอง (Manual Input) และปรับรอบใหม่ทุกวันเวลา 22:00 น.</li>
                                            <li>ระบบใช้การแนบสลิปการโอนเงิน (Slip Upload) และตรวจสอบโดยผู้ขาย (Manual Verification)</li>
                                            <li>การรับพรีออเดอร์แบ่งเป็นรอบตามรอบของเว็บไซต์เกาหลีหรือรอบขนส่งรวม สินค้าคนละรอบจะถึงมือลูกค้าคนละเวลาและคิดค่าจัดส่งแยกกัน</li>
                                            <li>สินค้าพรีออเดอร์ของแท้ 100% นับเข้าชาร์ต HANTEO & GAON ทุกอัลบั้ม</li>
                                        </ul>
                                    </div>
                                </div>
                                <div class="modal-footer bg-light p-2 px-3">
                                    <button type="button" class="btn btn-dark rounded-pill px-4 btn-sm fw-bold" data-bs-dismiss="modal">รับทราบ</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                document.body.insertAdjacentHTML('beforeend', modalHtml);
                modalEl = document.getElementById('globalHowToOrderModal');
            }

            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        },

        // --- Utility UI Injectors ---
        renderNavbarAuth() {
            const currentUser = this.getCurrentUser();
            const navContainer = document.querySelector('nav .container');
            if (!navContainer) return;

            // Check unread count
            const unreadCount = currentUser ? this.getUnreadNotificationCount(currentUser.email) : 0;

            // Header auth controls
            let authHtml = '';
            if (currentUser) {
                const isAdmin = currentUser.role === 'admin';
                authHtml = `
                    <div class="dropdown me-2">
                        <button class="btn btn-light position-relative rounded-circle p-2" type="button" id="notiDropdown" data-bs-toggle="dropdown" aria-expanded="false" style="width: 40px; height: 40px;">
                            <i class="fa-regular fa-bell text-secondary fs-5"></i>
                            ${unreadCount > 0 ? `<span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" style="font-size:0.65rem;">${unreadCount}</span>` : ''}
                        </button>
                        <div class="dropdown-menu dropdown-menu-end p-0 shadow-lg" aria-labelledby="notiDropdown" style="width: 320px; max-height: 400px; overflow-y: auto; border-radius: 12px; border: none;">
                            <div class="p-3 bg-light border-bottom d-flex justify-content-between align-items-center">
                                <h6 class="m-0 fw-bold"><i class="fa-solid fa-bell me-2 text-danger"></i>การแจ้งเตือน</h6>
                                <button class="btn btn-sm btn-link text-decoration-none p-0 text-muted" onclick="KpopStore.markNotificationsAsRead('${escArg(currentUser.email)}').then(function () { location.reload(); });" style="font-size: 0.75rem;">อ่านทั้งหมด</button>
                            </div>
                            <div class="list-group list-group-flush">
                                ${this.renderNotificationListHtml(currentUser.email)}
                            </div>
                        </div>
                    </div>

                    <div class="dropdown">
                        <button class="btn btn-outline-dark border-0 dropdown-toggle d-flex align-items-center gap-2" type="button" id="userMenu" data-bs-toggle="dropdown" aria-expanded="false" style="border-radius: 25px; padding: 5px 12px; background: #f8f9fa;">
                            <i class="fa-solid fa-circle-user fs-5 ${isAdmin ? 'text-danger' : 'text-primary'}"></i>
                            <span class="d-none d-md-inline font-weight-500" style="font-size: 0.88rem;">${esc(currentUser.name)}</span>
                            ${isAdmin ? '<span class="badge bg-danger ms-1" style="font-size: 0.65rem;">ADMIN</span>' : ''}
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end shadow border-0" aria-labelledby="userMenu" style="border-radius: 12px;">
                            <li class="px-3 py-2 border-bottom">
                                <div class="fw-bold" style="font-size: 0.9rem;">${esc(currentUser.name)}</div>
                                <small class="text-muted">${esc(currentUser.email)}</small>
                            </li>
                            ${isAdmin ? '<li><a class="dropdown-item py-2 fw-bold text-danger" href="admin.html"><i class="fa-solid fa-gauge-high me-2"></i>ระบบผู้ดูแลระบบ (Admin)</a></li>' : ''}
                            <li><button class="dropdown-item py-2" onclick="KpopStore.openProfileModal()"><i class="fa-solid fa-user-pen me-2 text-primary"></i>แก้ไขข้อมูลส่วนตัว / ที่อยู่</button></li>
                            <li><a class="dropdown-item py-2" href="order-history.html"><i class="fa-solid fa-clock-rotate-left me-2 text-secondary"></i>ประวัติคำสั่งซื้อ</a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><button class="dropdown-item py-2 text-danger" onclick="KpopStore.logout()"><i class="fa-solid fa-right-from-bracket me-2"></i>ออกจากระบบ</button></li>
                        </ul>
                    </div>
                `;
            } else {
                const isRegisterPage = window.location.pathname.endsWith('register.html') || window.location.href.includes('register.html');
                const regClass = isRegisterPage ? "btn btn-dark-custom me-2 text-decoration-none" : "btn btn-outline-dark-custom me-2 text-decoration-none";
                const loginClass = isRegisterPage ? "btn btn-outline-dark-custom text-decoration-none" : "btn btn-dark-custom text-decoration-none";

                authHtml = `
                    <a href="register.html" class="${regClass}">
                        <i class="fa-solid fa-user-plus me-1" style="font-size: 0.8rem;"></i> สมัครสมาชิก
                    </a>
                    <a href="login.html" class="${loginClass}">
                        <i class="fa-solid fa-right-to-bracket me-1" style="font-size: 0.85rem;"></i> เข้าสู่ระบบ
                    </a>
                `;
            }

            // Find or update right navbar container
            let rightNav = navContainer.querySelector('.d-flex.align-items-center:last-child');
            if (rightNav) {
                const userOrders = currentUser
                    ? this.getOrders().filter(o => o.customerEmail && o.customerEmail.toLowerCase() === currentUser.email.toLowerCase())
                    : [];
                const cartCount = this.getCartCount();

                // แยกไอคอนตะกร้าออกจากไอคอนประวัติ
                // เดิมมีไอคอนเดียวใช้ class cart-badge แต่นับจำนวน "ออเดอร์" แล้วลิงก์ไปหน้าประวัติ
                rightNav.innerHTML = `
                    <a href="cart.html" class="text-dark me-3 position-relative text-decoration-none" title="ตะกร้าพรีออเดอร์">
                        <i class="fa-solid fa-cart-shopping fs-5 text-secondary"></i>
                        ${cartCount > 0 ? `<span class="cart-badge" title="จำนวนชิ้นในตะกร้า">${cartCount}</span>` : ''}
                    </a>
                    <a href="order-history.html" class="text-dark me-3 position-relative text-decoration-none" title="ประวัติคำสั่งซื้อของฉัน (Order History)">
                        <i class="fa-solid fa-receipt fs-5 text-secondary"></i>
                        ${userOrders.length > 0 ? `<span class="cart-badge" title="จำนวนคำสั่งซื้อ">${userOrders.length}</span>` : ''}
                    </a>
                    ${authHtml}
                `;
            }
        },

        renderNotificationListHtml(userEmail) {
            const notis = this.getNotifications(userEmail);
            if (!notis || notis.length === 0) {
                return `<div class="p-4 text-center text-muted" style="font-size: 0.85rem;"><i class="fa-regular fa-bell-slash d-block fs-3 mb-2 opacity-50"></i>ไม่มีการแจ้งเตือนในขณะนี้</div>`;
            }
            // ข้อความแจ้งเตือนมีชื่อลูกค้าและหมายเหตุที่คนพิมพ์เองปนอยู่
            // (เช่น "ลูกค้า <ชื่อ> ส่งสลิป...") จึงต้องล้างก่อนต่อเป็น HTML
            return notis.slice(0, 5).map(n => `
                <div class="list-group-item p-3 ${!n.read ? 'bg-light' : ''}">
                    <div class="d-flex w-100 justify-content-between align-items-center mb-1">
                        <strong class="mb-0 text-dark" style="font-size: 0.85rem;">${esc(n.title)}</strong>
                        <small class="text-muted" style="font-size: 0.7rem;">${n.date ? esc(String(n.date).split(' ')[0]) : ''}</small>
                    </div>
                    <p class="mb-1 text-secondary" style="font-size: 0.8rem; line-height: 1.4;">${esc(n.message)}</p>
                </div>
            `).join('');
        },

        // Mobile App Layout Bottom Navigation Bar Component
        renderMobileBottomNav() {
            const existingNav = document.getElementById('mobileAppBottomBar');
            if (existingNav) return;

            const currentUser = this.getCurrentUser();
            const isAdmin = currentUser && currentUser.role === 'admin';
            const currentPath = window.location.pathname;

            const mobileBarHtml = `
                <div id="mobileAppBottomBar" class="d-md-none fixed-bottom bg-white border-top shadow-lg py-2 px-3">
                    <div class="d-flex justify-content-around align-items-center text-center">
                        <a href="index.html" class="text-decoration-none ${currentPath.includes('index.html') || currentPath === '/' ? 'text-pink font-weight-bold' : 'text-secondary'}" style="font-size: 0.75rem;">
                            <i class="fa-solid fa-house fs-5 d-block mb-1"></i>หน้าแรก
                        </a>
                        <a href="cart.html" class="text-decoration-none ${currentPath.includes('cart') ? 'text-pink font-weight-bold' : 'text-secondary'}" style="font-size: 0.75rem;">
                            <i class="fa-solid fa-cart-shopping fs-5 d-block mb-1"></i>ตะกร้า
                        </a>
                        <a href="order-history.html" class="text-decoration-none ${currentPath.includes('order-history') ? 'text-pink font-weight-bold' : 'text-secondary'}" style="font-size: 0.75rem;">
                            <i class="fa-solid fa-receipt fs-5 d-block mb-1"></i>คำสั่งซื้อ
                        </a>
                        ${isAdmin ? `
                        <a href="admin.html" class="text-decoration-none ${currentPath.includes('admin') ? 'text-danger fw-bold' : 'text-secondary'}" style="font-size: 0.75rem;">
                            <i class="fa-solid fa-shield-halved fs-5 d-block mb-1 text-danger"></i>แอดมิน
                        </a>
                        ` : ''}
                        <a href="${currentUser ? 'order-history.html' : 'login.html'}" class="text-decoration-none ${currentPath.includes('login') || currentPath.includes('register') ? 'text-pink font-weight-bold' : 'text-secondary'}" style="font-size: 0.75rem;">
                            <i class="fa-solid fa-user fs-5 d-block mb-1"></i>${currentUser ? 'บัญชี' : 'เข้าสู่ระบบ'}
                        </a>
                    </div>
                </div>
            `;

            document.body.insertAdjacentHTML('beforeend', mobileBarHtml);

            // Add bottom body padding on mobile so content isn't covered by bottom bar
            const style = document.createElement('style');
            style.innerHTML = `
                @media (max-width: 767.98px) {
                    body { padding-bottom: 70px !important; }
                    .text-pink { color: #ff3399 !important; }
                }
            `;
            document.head.appendChild(style);
        }
    });

// Auto boot on DOM load
// ใช้ KpopStore.ready() แทน DOMContentLoaded ตรง ๆ เพื่อรอให้ข้อมูลจากเซิร์ฟเวอร์
// มาถึงก่อน ไม่งั้น navbar จะวาดตอนที่ยังไม่รู้ว่าใครล็อกอินอยู่ แล้วกะพริบเป็นสถานะ guest
KpopStore.ready(function () {
    KpopStore.renderNavbarAuth();
    KpopStore.renderMobileBottomNav();
});

})(window);
