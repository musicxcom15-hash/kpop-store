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

        // ลืมรหัสผ่าน: ส่งคำขอเข้ากล่องแจ้งเตือนร้าน (ระบบไม่มีการส่งอีเมล) แล้วบอกขั้นต่อไปในหน้าต่างเดิม
        openForgotPasswordModal(prefillEmail) {
            let modalEl = document.getElementById('globalForgotPasswordModal');
            if (!modalEl) {
                document.body.insertAdjacentHTML('beforeend', `
                    <div class="modal fade" id="globalForgotPasswordModal" tabindex="-1" aria-hidden="true" style="z-index: 1060;">
                        <div class="modal-dialog modal-dialog-centered">
                            <div class="modal-content border-0 shadow-lg" style="border-radius: 16px;">
                                <div class="modal-header bg-light">
                                    <h5 class="modal-title fw-bold text-dark"><i class="fa-solid fa-key me-2" style="color: #ff3399;"></i>ลืมรหัสผ่าน</h5>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                                </div>
                                <div class="modal-body p-4">
                                    <form id="forgotPasswordForm" onsubmit="KpopStore.handleForgotPasswordSubmit(event)">
                                        <p class="text-secondary" style="font-size: 0.88rem;">
                                            กรอกอีเมลที่ใช้สมัคร ระบบจะส่งคำขอถึงร้าน แล้วร้านจะ<strong>โทรแจ้งรหัสผ่านชั่วคราว</strong>
                                            ไปที่เบอร์ที่คุณให้ไว้ตอนสมัคร
                                        </p>
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" style="font-size: 0.88rem;">อีเมลบัญชีผู้ใช้</label>
                                            <input type="email" id="forgotEmail" class="form-control" required placeholder="name@example.com">
                                        </div>
                                        <div class="d-flex justify-content-end gap-2">
                                            <button type="button" class="btn btn-light rounded-pill px-4" data-bs-dismiss="modal">ยกเลิก</button>
                                            <button type="submit" id="forgotSubmitBtn" class="btn btn-dark rounded-pill px-4 fw-bold">ส่งคำขอ</button>
                                        </div>
                                    </form>
                                    <div id="forgotPasswordDone" class="d-none text-center py-2">
                                        <i class="fa-solid fa-circle-check text-success d-block mb-3" style="font-size: 2.5rem;"></i>
                                        <p id="forgotPasswordDoneText" class="text-secondary mb-4" style="font-size: 0.9rem;"></p>
                                        <button type="button" class="btn btn-dark rounded-pill px-4" data-bs-dismiss="modal">ตกลง</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `);
                modalEl = document.getElementById('globalForgotPasswordModal');
            }

            document.getElementById('forgotPasswordForm').classList.remove('d-none');
            document.getElementById('forgotPasswordDone').classList.add('d-none');
            document.getElementById('forgotEmail').value = prefillEmail || '';
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        },
        async handleForgotPasswordSubmit(e) {
            e.preventDefault();
            const btn = document.getElementById('forgotSubmitBtn');
            btn.disabled = true;
            const res = await this.requestPasswordReset(document.getElementById('forgotEmail').value.trim());
            btn.disabled = false;
            if (!res.success) {
                alert(res.message || 'ส่งคำขอไม่สำเร็จค่ะ กรุณาลองใหม่อีกครั้ง');
                return;
            }
            document.getElementById('forgotPasswordForm').classList.add('d-none');
            document.getElementById('forgotPasswordDoneText').innerText = res.message;
            document.getElementById('forgotPasswordDone').classList.remove('d-none');
        },

        // เปลี่ยนรหัสผ่านเอง (ต้องยืนยันรหัสเดิม) — ใช้หลังได้รหัสชั่วคราวจากร้าน หรือเปลี่ยนตามปกติ
        openChangePasswordModal() {
            if (!this.getCurrentUser()) {
                window.location.href = 'login.html';
                return;
            }
            let modalEl = document.getElementById('globalChangePasswordModal');
            if (!modalEl) {
                document.body.insertAdjacentHTML('beforeend', `
                    <div class="modal fade" id="globalChangePasswordModal" tabindex="-1" aria-hidden="true" style="z-index: 1060;">
                        <div class="modal-dialog modal-dialog-centered">
                            <div class="modal-content border-0 shadow-lg" style="border-radius: 16px;">
                                <div class="modal-header bg-light">
                                    <h5 class="modal-title fw-bold text-dark"><i class="fa-solid fa-lock me-2 text-primary"></i>เปลี่ยนรหัสผ่าน</h5>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                                </div>
                                <div class="modal-body p-4">
                                    <form id="changePasswordForm" onsubmit="KpopStore.handleChangePasswordSubmit(event)">
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" style="font-size: 0.88rem;">รหัสผ่านปัจจุบัน (หรือรหัสชั่วคราวที่ได้จากร้าน)</label>
                                            <input type="password" id="cpCurrent" class="form-control" required autocomplete="current-password">
                                        </div>
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" style="font-size: 0.88rem;">รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)</label>
                                            <input type="password" id="cpNew" class="form-control" required minlength="6" autocomplete="new-password">
                                        </div>
                                        <div class="mb-3">
                                            <label class="form-label fw-bold" style="font-size: 0.88rem;">ยืนยันรหัสผ่านใหม่</label>
                                            <input type="password" id="cpConfirm" class="form-control" required minlength="6" autocomplete="new-password">
                                        </div>
                                        <div class="d-flex justify-content-end gap-2 mt-4">
                                            <button type="button" class="btn btn-light rounded-pill px-4" data-bs-dismiss="modal">ยกเลิก</button>
                                            <button type="submit" id="cpSubmitBtn" class="btn btn-primary rounded-pill px-4 fw-bold">บันทึกรหัสผ่านใหม่</button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        </div>
                    </div>
                `);
                modalEl = document.getElementById('globalChangePasswordModal');
            }
            document.getElementById('changePasswordForm').reset();
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        },
        async handleChangePasswordSubmit(e) {
            e.preventDefault();
            const current = document.getElementById('cpCurrent').value;
            const next = document.getElementById('cpNew').value;
            if (next !== document.getElementById('cpConfirm').value) {
                alert('รหัสผ่านใหม่กับช่องยืนยันไม่ตรงกันค่ะ');
                return;
            }
            const btn = document.getElementById('cpSubmitBtn');
            btn.disabled = true;
            const res = await this.changePassword(current, next);
            btn.disabled = false;
            if (!res.success) {
                alert('เปลี่ยนรหัสผ่านไม่สำเร็จค่ะ\n\n' + res.message);
                return;
            }
            bootstrap.Modal.getInstance(document.getElementById('globalChangePasswordModal')).hide();
            alert('เปลี่ยนรหัสผ่านเรียบร้อยแล้วค่ะ ครั้งหน้าให้เข้าสู่ระบบด้วยรหัสผ่านใหม่');
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
                                            <li><strong>ราคาคำนวณจากเรทราคากลางของร้าน</strong> ยอดที่ต้องชำระจะถูกล็อกเมื่อคุณแนบสลิป หากร้านปรับเรทภายหลังก็ไม่กระทบคำสั่งซื้อของคุณ</li>
                                            <li><strong>หากเว็บไซต์เกาหลียกเลิกรอบ หรือสินค้าหมดก่อนที่ร้านจะกดสั่งสำเร็จ ทางร้านจะคืนเงินให้เต็มจำนวน</strong> โดยจะปรับสถานะคำสั่งซื้อเป็น "รอคืนเงิน" และแจ้งให้ทราบทันที</li>
                                        </ul>
                                    </div>

                                    <div class="p-3 bg-white border rounded-3" style="font-size: 0.82rem; line-height: 1.5;">
                                        <div class="fw-bold text-dark mb-1"><i class="fa-solid fa-shield-halved me-1 text-warning"></i> มาตรฐานและเงื่อนไขการให้บริการ</div>
                                        <ul class="m-0 text-secondary ps-3">
                                            <li>อัตราแลกเปลี่ยน KRW/THB ใช้เรทราคากลางที่ร้านกำหนด ราคาบนเว็บคำนวณจากเรทนี้ทุกชิ้น</li>
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

                    <button class="btn btn-outline-dark border-0 d-flex align-items-center gap-2" type="button" id="userMenu"
                        onclick="KpopStore.openAccountDrawer()" aria-controls="kpopAccountDrawer" aria-label="เปิดเมนูบัญชีของฉัน"
                        style="border-radius: 25px; padding: 5px 12px; background: #f8f9fa;">
                        <i class="fa-solid fa-circle-user fs-5 ${isAdmin ? 'text-danger' : 'text-primary'}"></i>
                        <span class="d-none d-md-inline font-weight-500" style="font-size: 0.88rem;">${esc(currentUser.name)}</span>
                        ${isAdmin ? '<span class="badge bg-danger ms-1" style="font-size: 0.65rem;">ADMIN</span>' : ''}
                        <i class="fa-solid fa-bars text-secondary ms-1" style="font-size: 0.8rem;"></i>
                    </button>
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

        // แผงบัญชีด้านข้าง (เลื่อนออกจากขวา) แทน dropdown เดิมใต้ชื่อผู้ใช้
        // วาดเนื้อหาใหม่ทุกครั้งที่เปิด ตัวเลขตะกร้า/ออเดอร์/แจ้งเตือนจึงเป็นค่าล่าสุดเสมอ
        openAccountDrawer() {
            const currentUser = this.getCurrentUser();
            if (!currentUser) {
                window.location.href = 'login.html';
                return;
            }

            if (!document.getElementById('kpopAccountDrawerStyle')) {
                const style = document.createElement('style');
                style.id = 'kpopAccountDrawerStyle';
                style.innerHTML = `
                    .kpop-account-drawer { width: 360px !important; max-width: 88vw; color: #fff;
                        background: linear-gradient(160deg, #2a1428 0%, #1a1a24 55%); border-left: 1px solid rgba(255, 51, 153, 0.25); }
                    .kpop-account-drawer .drawer-avatar { width: 56px; height: 56px; border-radius: 50%; background: rgba(255, 255, 255, 0.12);
                        display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 600; flex-shrink: 0; }
                    .kpop-account-drawer .drawer-email { color: rgba(255, 255, 255, 0.6); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                    .kpop-account-drawer .drawer-divider { border-color: rgba(255, 255, 255, 0.15); opacity: 1; margin: 18px 0; }
                    .kpop-account-drawer .drawer-stat { font-size: 0.95rem; color: rgba(255, 255, 255, 0.85); }
                    .kpop-account-drawer .drawer-stat strong { color: #fff; font-size: 1.05rem; margin-right: 4px; }
                    .kpop-account-drawer .btn-neon { flex: 1; color: #fff; background: transparent; border: 2px solid #ff3399; border-radius: 8px;
                        padding: 9px 8px; font-size: 0.9rem; box-shadow: 0 0 10px rgba(255, 51, 153, 0.55), inset 0 0 6px rgba(255, 51, 153, 0.25);
                        transition: background 0.2s, box-shadow 0.2s; }
                    .kpop-account-drawer .btn-neon:hover { background: rgba(255, 51, 153, 0.18); color: #fff; box-shadow: 0 0 16px rgba(255, 51, 153, 0.8); }
                    .kpop-account-drawer .drawer-note { color: #fff; font-size: 0.8rem; text-decoration: underline; font-style: italic; }
                    .kpop-account-drawer .drawer-menu a, .kpop-account-drawer .drawer-menu button { display: flex; align-items: center; gap: 12px;
                        width: 100%; padding: 11px 10px; color: #fff; background: none; border: 0; border-radius: 8px; text-align: left;
                        text-decoration: none; font-size: 0.95rem; }
                    .kpop-account-drawer .drawer-menu a:hover, .kpop-account-drawer .drawer-menu button:hover { background: rgba(255, 255, 255, 0.07); }
                    .kpop-account-drawer .drawer-menu i { width: 22px; text-align: center; font-size: 1.05rem; color: rgba(255, 255, 255, 0.85); }
                `;
                document.head.appendChild(style);
            }

            let el = document.getElementById('kpopAccountDrawer');
            if (!el) {
                el = document.createElement('div');
                el.id = 'kpopAccountDrawer';
                el.className = 'offcanvas offcanvas-end kpop-account-drawer';
                el.tabIndex = -1;
                el.setAttribute('aria-labelledby', 'kpopAccountDrawerLabel');
                document.body.appendChild(el);
            }

            const isAdmin = currentUser.role === 'admin';
            const myOrders = this.getOrders().filter(o => o.customerEmail && o.customerEmail.toLowerCase() === currentUser.email.toLowerCase());
            const pendingSlips = myOrders.filter(o => this.getStatusMeta(o).group === 'pending').length;
            const unread = this.getUnreadNotificationCount(currentUser.email);
            const initial = String(currentUser.name || currentUser.email || '?').trim().charAt(0).toUpperCase();

            // บรรทัดเตือนสั้น ๆ ใต้ปุ่ม: แจ้งเตือนที่ยังไม่อ่านสำคัญกว่า ถ้าไม่มีค่อยบอกออเดอร์ที่รอร้านตรวจสลิป
            const note = unread > 0
                ? `<a href="order-history.html" class="drawer-note">มีการแจ้งเตือนใหม่ ${unread} รายการ</a>`
                : (pendingSlips > 0 ? `<a href="order-history.html" class="drawer-note">${pendingSlips} คำสั่งซื้อ, กำลังรอร้านตรวจสอบสลิป</a>` : '');

            el.innerHTML = `
                <div class="offcanvas-body p-4">
                    <div class="d-flex align-items-center gap-3">
                        <div class="drawer-avatar">${esc(initial)}</div>
                        <div class="flex-grow-1" style="min-width: 0;">
                            <div id="kpopAccountDrawerLabel" class="fw-bold text-truncate" style="font-size: 1.05rem;">${esc(currentUser.name)}</div>
                            <div class="drawer-email">${esc(currentUser.email)}</div>
                            <span class="badge ${isAdmin ? 'bg-danger' : 'bg-primary'} mt-1" style="font-size: 0.65rem;">${isAdmin ? 'ADMIN' : 'CUSTOMER'}</span>
                        </div>
                        <button type="button" class="btn-close btn-close-white align-self-start" data-bs-dismiss="offcanvas" aria-label="ปิด"></button>
                    </div>

                    <hr class="drawer-divider">

                    <div class="d-flex gap-4 mb-3">
                        <div class="drawer-stat"><i class="fa-solid fa-receipt me-2"></i><strong>${myOrders.length}</strong>คำสั่งซื้อ</div>
                        <div class="drawer-stat"><i class="fa-solid fa-cart-shopping me-2"></i><strong>${this.getCartCount()}</strong>ชิ้นในตะกร้า</div>
                    </div>
                    <div class="d-flex gap-3 mb-3">
                        <a href="cart.html" class="btn btn-neon text-decoration-none">ตะกร้าของฉัน</a>
                        <button type="button" class="btn btn-neon" data-bs-dismiss="offcanvas" onclick="KpopStore.goToAllProducts()">สินค้าทั้งหมด</button>
                    </div>
                    ${note}

                    <hr class="drawer-divider">

                    <nav class="drawer-menu">
                        <button type="button" data-bs-dismiss="offcanvas" onclick="KpopStore.openProfileModal()"><i class="fa-regular fa-circle-user"></i>บัญชีของฉัน (ข้อมูลส่วนตัว / ที่อยู่)</button>
                        <button type="button" data-bs-dismiss="offcanvas" onclick="KpopStore.openChangePasswordModal()"><i class="fa-solid fa-key"></i>เปลี่ยนรหัสผ่าน</button>
                        <a href="order-history.html"><i class="fa-solid fa-list-check"></i>การสั่งซื้อของฉัน</a>
                        <a href="cart.html"><i class="fa-solid fa-cart-shopping"></i>ตะกร้าพรีออเดอร์</a>
                        <button type="button" data-bs-dismiss="offcanvas" onclick="KpopStore.openHowToOrderModal()"><i class="fa-regular fa-circle-question"></i>วิธีการสั่งซื้อ</button>
                        ${isAdmin ? '<a href="admin.html"><i class="fa-solid fa-gauge-high" style="color: #ff6b9d;"></i>ระบบผู้ดูแลระบบ (Admin)</a>' : ''}
                        <button type="button" onclick="KpopStore.logout()"><i class="fa-solid fa-door-open"></i>ออกจากระบบ</button>
                    </nav>
                </div>
            `;

            bootstrap.Offcanvas.getOrCreateInstance(el).show();
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
                        <a href="${currentUser ? 'javascript:void(0)' : 'login.html'}" ${currentUser ? 'onclick="KpopStore.openAccountDrawer()"' : ''} class="text-decoration-none ${currentPath.includes('login') || currentPath.includes('register') ? 'text-pink font-weight-bold' : 'text-secondary'}" style="font-size: 0.75rem;">
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

// แถบแจ้งเมื่อโหลดข้อมูลจากเซิร์ฟเวอร์ไม่ได้ (เช่น DB บน Railway เพิ่งตื่น)
// สถานะ loading ปกติไม่แสดงอะไร จะได้ไม่กะพริบทุกครั้งที่เปิดหน้า — โผล่เฉพาะตอนต้องลองซ้ำหรือพลาดจริง
KpopStore.onLoadStatus(function (status) {
    const old = document.getElementById('kpopLoadStatusBar');
    if (old) old.remove();
    if (status.state !== 'retrying' && status.state !== 'failed') return;

    const failed = status.state === 'failed';
    const bar = document.createElement('div');
    bar.id = 'kpopLoadStatusBar';
    bar.setAttribute('role', 'status');
    bar.className = 'alert ' + (failed ? 'alert-danger' : 'alert-warning') +
        ' d-flex align-items-center justify-content-center flex-wrap gap-2 m-0 rounded-0 py-2 px-3 shadow-sm';
    bar.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; z-index: 2000; font-size: 0.9rem;';
    bar.innerHTML = failed
        ? '<span><i class="fa-solid fa-triangle-exclamation me-2"></i>โหลดข้อมูลไม่สำเร็จ ' +
          KpopStore.esc(status.message) + '</span>' +
          '<button type="button" class="btn btn-sm btn-light rounded-pill px-3" onclick="location.reload()">' +
          '<i class="fa-solid fa-rotate-right me-1"></i>ลองใหม่</button>'
        : '<span><i class="fa-solid fa-spinner fa-spin me-2"></i>กำลังเชื่อมต่อเซิร์ฟเวอร์ อาจใช้เวลาสักครู่…</span>';
    document.body.appendChild(bar);
});

// Auto boot on DOM load
// ใช้ KpopStore.ready() แทน DOMContentLoaded ตรง ๆ เพื่อรอให้ข้อมูลจากเซิร์ฟเวอร์
// มาถึงก่อน ไม่งั้น navbar จะวาดตอนที่ยังไม่รู้ว่าใครล็อกอินอยู่ แล้วกะพริบเป็นสถานะ guest
KpopStore.ready(function () {
    KpopStore.renderNavbarAuth();
    KpopStore.renderMobileBottomNav();
});

})(window);
