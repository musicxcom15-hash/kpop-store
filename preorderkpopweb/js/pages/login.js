// ปุ่มสั่งซื้อ/เพิ่มลงตะกร้า และหน้าที่บังคับล็อกอิน ส่ง ?next= มาเพื่อให้เด้งกลับไปที่เดิม
// ตัวกรอง path (กัน open redirect) อยู่ที่ KpopStore.getSafeNextUrl() ใน ui.js
function getSafeNextUrl() {
    return KpopStore.getSafeNextUrl();
}

// ถ้าผู้ใช้ยังไม่มีบัญชี เขาจะกดไปหน้าสมัครสมาชิกจากตรงนี้
// ต้องพ่วง next ต่อไปด้วย ไม่งั้นสมัครเสร็จจะถูกโยนไปหน้าแรกแทนที่จะกลับไปสินค้าที่ค้างไว้
KpopStore.ready(function () {
    const next = getSafeNextUrl();
    const link = document.getElementById('goRegisterLink');
    if (next && link) link.href = 'register.html?next=' + encodeURIComponent(next);
});

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPassword').value;

    const res = await KpopStore.login(email, pass);
    if (!res.success) {
        alert(res.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        return;
    }

    const next = getSafeNextUrl();
    if (next) {
        alert(`ยินดีต้อนรับคุณ ${res.user.name} ระบบจะพากลับไปหน้าที่ค้างไว้ค่ะ`);
        window.location.href = next;
        return;
    }

    if (res.user.role === 'admin') {
        alert('ยินดีต้อนรับ ผู้ดูแลระบบ (Admin) เข้าสู่ระบบสำเร็จ!');
        window.location.href = 'admin.html';
    } else {
        alert(`ยินดีต้อนรับคุณ ${res.user.name} เข้าสู่ระบบสำเร็จ!`);
        window.location.href = 'index.html';
    }
}
