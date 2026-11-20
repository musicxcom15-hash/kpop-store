// หน้าสมัครสมาชิก (register.html)
//
// ใส่ช่องที่อยู่แบบแยก (รหัสไปรษณีย์ → ตำบล → อำเภอ/จังหวัดขึ้นเอง) ตอนเปิดหน้า
KpopStore.ready(function () {
    document.getElementById('regAddressFields').innerHTML = KpopStore.addressFieldsHtml('regAddr');
    KpopStore.bindAddressFields('regAddr', {});
});

// กดสมัคร: ตรวจรหัสผ่าน 2 ช่องให้ตรงกันและยาวพอ → สร้างบัญชี → พากลับหน้าที่ค้างไว้
async function handleRegister(e) {
    e.preventDefault();
    const pass = document.getElementById('regPassword').value;
    const confirmPass = document.getElementById('regConfirmPassword').value;

    if (pass !== confirmPass) {
        alert('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
        return;
    }
    if (pass.length < 6) {
        alert('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษรค่ะ');
        return;
    }
    // เบอร์โทรต้องเป็นรูปแบบเบอร์ไทย และที่อยู่ต้องครบทุกช่อง (เซิร์ฟเวอร์ตรวจซ้ำอีกชั้น)
    const phone = KpopStore.normalizePhone(document.getElementById('regPhone').value);
    if (!phone) {
        alert('เบอร์โทรศัพท์ไม่ถูกต้องค่ะ\nกรุณากรอกเบอร์มือถือ 10 หลัก (เช่น 081-234-5678) หรือเบอร์บ้าน 9 หลัก');
        return;
    }
    const addr = KpopStore.readAddressFields('regAddr');
    if (addr.error) {
        alert(addr.error);
        return;
    }

    // สมัครสมาชิกเป็นคำสั่งเดียวที่ฝั่งเซิร์ฟเวอร์: สร้างบัญชี + เก็บรหัสผ่านแบบ hash
    // + เปิด session ให้ในคราวเดียว
    //
    // การตรวจอีเมลซ้ำอยู่ที่ฐานข้อมูล (UNIQUE) ไม่ใช่ที่นี่ เพราะผู้ใช้ที่ยังไม่ล็อกอิน
    // มองไม่เห็นรายชื่อบัญชีคนอื่นอยู่แล้ว และการเช็คฝั่งเบราว์เซอร์กันคนสมัคร
    // พร้อมกันสองคนไม่ได้
    const res = await KpopStore.register(Object.assign({
        name: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        phone: phone
    }, addr.fields), pass);

    const next = KpopStore.getSafeNextUrl();

    if (!res.success) {
        alert('สมัครสมาชิกไม่สำเร็จค่ะ\n\n' + res.message);
        // อีเมลถูกใช้แล้ว = ผู้ใช้น่าจะมีบัญชีอยู่ พาไปหน้าล็อกอินพร้อมปลายทางเดิม
        if (res.message && res.message.indexOf('มีบัญชีอยู่ในระบบแล้ว') !== -1) {
            window.location.href = next
                ? 'login.html?next=' + encodeURIComponent(next)
                : 'login.html';
        }
        return;
    }

    // มาจากปุ่มสั่งซื้อ/เพิ่มลงตะกร้าที่ค้างไว้ ก็พากลับไปที่สินค้าตัวเดิม
    alert('สมัครสมาชิกเรียบร้อยแล้วค่ะ!');
    window.location.href = next || 'index.html';
}
