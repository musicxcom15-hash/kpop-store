// หน้าเปิดจากลิงก์ในอีเมล: reset-password.html?token=…
// เช็คลิงก์ตั้งแต่เปิดหน้า (หมดอายุ/ใช้ไปแล้วจะได้รู้ก่อนกรอก) แล้วค่อยให้ตั้งรหัสใหม่
const resetToken = new URLSearchParams(window.location.search).get('token') || '';

KpopStore.ready(async function () {
    const res = await KpopStore.checkResetToken(resetToken);
    if (!res.success) {
        showInvalidLink(res.message);
        return;
    }
    document.getElementById('resetSubtitle').innerText = 'สำหรับบัญชี ' + res.email;
    document.getElementById('resetPasswordForm').classList.remove('d-none');
});

function showInvalidLink(message) {
    document.getElementById('resetSubtitle').innerText = '';
    document.getElementById('resetInvalidText').innerText = message;
    document.getElementById('resetInvalid').classList.remove('d-none');
    document.getElementById('resetPasswordForm').classList.add('d-none');
}

async function handleResetSubmit(e) {
    e.preventDefault();
    const next = document.getElementById('resetNew').value;
    if (next !== document.getElementById('resetConfirm').value) {
        alert('รหัสผ่านใหม่กับช่องยืนยันไม่ตรงกันค่ะ');
        return;
    }

    const btn = document.getElementById('resetSubmitBtn');
    btn.disabled = true;
    const res = await KpopStore.resetPasswordWithToken(resetToken, next);
    btn.disabled = false;

    if (!res.success) {
        // ลิงก์อาจหมดอายุระหว่างกรอก — บอกให้ขอใหม่ ไม่ใช่ปล่อยให้กดซ้ำไปเรื่อย ๆ
        if (res.code === 'invalid_link') {
            showInvalidLink(res.message);
        } else {
            alert('ตั้งรหัสผ่านไม่สำเร็จค่ะ\n\n' + res.message);
        }
        return;
    }

    alert('ตั้งรหัสผ่านใหม่เรียบร้อยแล้วค่ะ กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
    window.location.href = 'login.html';
}
