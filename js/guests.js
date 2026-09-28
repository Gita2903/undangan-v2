import QRCode from 'qrcode';

const tokenKey = 'invitation-admin-token';
const loginPanel = document.getElementById('admin-login');
const manager = document.getElementById('guest-manager');
const guestList = document.getElementById('guest-list');
const message = document.getElementById('guest-message');
const qrPanel = document.getElementById('qr-print');

const apiUrl = (path) => new URL(path, document.body.getAttribute('data-url') || `${window.location.origin}/`);

async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = sessionStorage.getItem(tokenKey);
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    if (options.body) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(apiUrl(path), { ...options, headers });
    const body = await response.json();
    if (!response.ok) {
        throw new Error(body?.error?.[0] || `Request failed (${response.status})`);
    }
    return body.data;
}

function setLoginError(text) {
    document.getElementById('login-error').textContent = text;
}

function setGuestMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle('error-message', isError);
}

async function showQr(guest, token) {
    document.getElementById('qr-guest-name').textContent = guest.name;
    document.getElementById('qr-group-name').textContent = guest.group_name || 'Undangan perorangan';
    qrPanel.hidden = false;
    await QRCode.toCanvas(document.getElementById('qr-canvas'), token, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#18211d', light: '#ffffff' },
    });
    qrPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function actionButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function guestStatus(guest) {
    const status = document.createElement('span');
    status.className = 'guest-status';
    if (guest.revoked_at) {
        status.classList.add('revoked');
        status.textContent = 'Dicabut';
    } else if (guest.checked_in_at) {
        status.classList.add('checked');
        status.textContent = 'Sudah masuk';
    } else {
        status.textContent = 'Belum hadir';
    }
    return status;
}

async function loadGuests() {
    guestList.replaceChildren();
    try {
        const { guests } = await api('/api/checkin/invitations');
        document.getElementById('guest-count').textContent = `${guests.length} tamu terdaftar`;
        document.getElementById('empty-state').hidden = guests.length > 0;

        guests.forEach((guest) => {
            const row = document.createElement('tr');
            const nameCell = document.createElement('td');
            const groupCell = document.createElement('td');
            const statusCell = document.createElement('td');
            const actionCell = document.createElement('td');
            const actions = document.createElement('div');
            nameCell.textContent = guest.name;
            groupCell.textContent = guest.group_name || '-';
            statusCell.appendChild(guestStatus(guest));
            actions.className = 'row-actions';

            if (guest.checked_in_at) {
                const checkinTime = document.createElement('small');
                checkinTime.className = 'd-block text-secondary mt-1';
                checkinTime.textContent = new Date(guest.checked_in_at).toLocaleString('id-ID');
                statusCell.appendChild(checkinTime);
            }

            if (!guest.checked_in_at) {
                const issueLabel = guest.revoked_at ? 'Aktifkan & QR baru' : 'QR baru';
                actions.appendChild(actionButton(issueLabel, 'btn btn-outline-dark btn-sm', async () => {
                    if (!window.confirm(`Terbitkan QR baru untuk ${guest.name}? QR sebelumnya akan tidak berlaku.`)) {
                        return;
                    }
                    try {
                        const result = await api(`/api/checkin/invitations/${guest.uuid}/rotate`, { method: 'POST' });
                        await showQr(result.guest, result.token);
                        setGuestMessage(`QR baru untuk ${guest.name} berhasil diterbitkan.`);
                        await loadGuests();
                    } catch (error) {
                        setGuestMessage(error.message, true);
                    }
                }));

                if (!guest.revoked_at) {
                    actions.appendChild(actionButton('Cabut', 'btn btn-outline-danger btn-sm', async () => {
                        if (!window.confirm(`Cabut undangan ${guest.name}?`)) {
                            return;
                        }
                        try {
                            await api(`/api/checkin/invitations/${guest.uuid}`, { method: 'DELETE' });
                            await loadGuests();
                        } catch (error) {
                            setGuestMessage(error.message, true);
                        }
                    }));
                }
            }

            actionCell.className = 'text-end';
            actionCell.appendChild(actions);
            row.append(nameCell, groupCell, statusCell, actionCell);
            guestList.appendChild(row);
        });
    } catch (error) {
        if (/401|Unauthorized|Token/i.test(error.message)) {
            sessionStorage.removeItem(tokenKey);
            manager.hidden = true;
            loginPanel.hidden = false;
            setLoginError('Sesi admin berakhir. Silakan masuk lagi.');
            return;
        }
        setGuestMessage(error.message, true);
    }
}

function showAdmin() {
    loginPanel.hidden = true;
    manager.hidden = false;
    loadGuests();
}

async function login(event) {
    event.preventDefault();
    setLoginError('');
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const { token } = await api('/api/session', {
            method: 'POST',
            body: JSON.stringify({
                email: document.getElementById('admin-email').value,
                password: document.getElementById('admin-password').value,
            }),
        });
        sessionStorage.setItem(tokenKey, token);
        showAdmin();
    } catch (error) {
        setLoginError(error.message);
    } finally {
        button.disabled = false;
    }
}

async function createGuest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById('create-guest');
    button.disabled = true;
    setGuestMessage('Membuat undangan...');
    try {
        const result = await api('/api/checkin/invitations', {
            method: 'POST',
            body: JSON.stringify({
                name: document.getElementById('guest-name').value,
                group_name: document.getElementById('group-name').value,
            }),
        });
        await showQr(result.guest, result.token);
        form.reset();
        setGuestMessage(`QR undangan ${result.guest.name} siap diunduh atau dicetak.`);
        await loadGuests();
    } catch (error) {
        setGuestMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
}

document.getElementById('login-form').addEventListener('submit', login);
document.getElementById('guest-form').addEventListener('submit', createGuest);
document.getElementById('refresh-guests').addEventListener('click', loadGuests);
document.getElementById('admin-logout').addEventListener('click', () => {
    sessionStorage.removeItem(tokenKey);
    manager.hidden = true;
    loginPanel.hidden = false;
});
document.getElementById('close-qr').addEventListener('click', () => { qrPanel.hidden = true; });
document.getElementById('print-qr').addEventListener('click', () => window.print());
document.getElementById('download-qr').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `${document.getElementById('qr-guest-name').textContent.replace(/[^a-z0-9-_]+/gi, '-')}-qr.png`;
    link.href = document.getElementById('qr-canvas').toDataURL('image/png');
    link.click();
});

if (sessionStorage.getItem(tokenKey)) {
    showAdmin();
} else {
    loginPanel.hidden = false;
}
