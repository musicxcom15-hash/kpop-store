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

    // สมัครสมาชิกเป็นคำสั่งเดียวที่ฝั่งเซิร์ฟเวอร์: สร้างบัญชี + เก็บรหัสผ่านแบบ hash
    // + เปิด session ให้ในคราวเดียว
    //
    // การตรวจอีเมลซ้ำอยู่ที่ฐานข้อมูล (UNIQUE) ไม่ใช่ที่นี่ เพราะผู้ใช้ที่ยังไม่ล็อกอิน
    // มองไม่เห็นรายชื่อบัญชีคนอื่นอยู่แล้ว และการเช็คฝั่งเบราว์เซอร์กันคนสมัคร
    // พร้อมกันสองคนไม่ได้
    const res = await KpopStore.register({
        name: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        phone: document.getElementById('regPhone').value,
        address: document.getElementById('regAddress').value
    }, pass);

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
