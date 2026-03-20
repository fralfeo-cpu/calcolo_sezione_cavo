/**
 * drive.js - Google Drive Integration for ElectroSuite
 * Handles Auto-Save and Auto-Load via Google Identity Services (GIS) and REST API.
 */

const CLIENT_ID = '973187717006-revvk14cephvokm6vqil5dl19orarqsg.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
let accessToken = null;
let tokenClient;
let saveTimeout;

const FILENAME = 'electrosuite_full_archive.json';

// Initialize GIS
function initDrive() {
    if (typeof google === 'undefined') return;

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse.error !== undefined) {
                console.error("Auth Error:", tokenResponse);
                return;
            }
            accessToken = tokenResponse.access_token;
            // Save token for persistence
            localStorage.setItem('drive_access_token', accessToken);
            localStorage.setItem('drive_token_expires', Date.now() + (tokenResponse.expires_in * 1000));
            
            onAuthSuccess();
        },
    });

    // Try persistent login
    const savedToken = localStorage.getItem('drive_access_token');
    const expires = localStorage.getItem('drive_token_expires');
    if (savedToken && expires && Date.now() < parseInt(expires)) {
        accessToken = savedToken;
        onAuthSuccess();
    }

    const loginBtn = document.getElementById('btn-drive-login');
    if (loginBtn) {
        loginBtn.onclick = () => {
            tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
        };
    }

    const logoutBtn = document.getElementById('btn-drive-logout');
    if (logoutBtn) {
        logoutBtn.onclick = handleLogout;
    }
}

async function onAuthSuccess() {
    const loginBtn = document.getElementById('btn-drive-login');
    const logoutBtn = document.getElementById('btn-drive-logout');
    const statusEl = document.getElementById('cloud-status');
    
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'flex';
    if (statusEl) {
        statusEl.style.display = 'inline-block';
        statusEl.innerText = "Sincronizzazione...";
    }

    await loadFromDrive();
    if (statusEl) statusEl.innerText = "☁️ Sincronizzato";
    if (window.lucide) lucide.createIcons();
}

function handleLogout() {
    accessToken = null;
    localStorage.removeItem('drive_access_token');
    localStorage.removeItem('drive_token_expires');
    
    const loginBtn = document.getElementById('btn-drive-login');
    const logoutBtn = document.getElementById('btn-drive-logout');
    const statusEl = document.getElementById('cloud-status');
    
    if (loginBtn) loginBtn.style.display = 'flex';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (statusEl) statusEl.style.display = 'none';
    
    if (window.lucide) lucide.createIcons();
}

function triggerAutoSave() {
    if (!accessToken) return; 

    const statusEl = document.getElementById('cloud-status');
    if (statusEl) statusEl.innerText = "Salvataggio...";

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            await saveToDrive();
            if (statusEl) statusEl.innerText = "☁️ Salvato";
        } catch (e) {
            console.error("Auto-save failed", e);
            if (statusEl) statusEl.innerText = "❌ Errore";
            alert("Errore sincronizzazione Cloud: " + e.message);
            if (e.message.includes('401')) {
                handleLogout();
            }
        }
    }, 3000); 
}

async function saveToDrive() {
    if (!accessToken) return;

    // Package ONLY Archive and Presets (No UI State as requested)
    const fullData = {
        archivio: localStorage.getItem('archivio_elettrosuite'),
        presets_inverter: localStorage.getItem('preset_inverter'),
        presets_pannello: localStorage.getItem('preset_pannello'),
        timestamp: Date.now()
    };

    const data = JSON.stringify(fullData);
    const metadata = { name: FILENAME, parents: ['appDataFolder'] };
    const fileId = await findFileId();

    let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    let method = 'POST';

    if (fileId) {
        url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
        method = 'PATCH';
    }

    const boundary = '-------314159265358979323846';
    const multipartRequestBody =
        '--' + boundary + '\r\n' +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) + '\r\n' +
        '--' + boundary + '\r\n' +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        data + '\r\n' +
        '--' + boundary + '--';

    const response = await fetch(url, {
        method: method,
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'multipart/related; boundary=' + boundary
        },
        body: multipartRequestBody
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Drive ${method} failed (${response.status}): ${errorText.substring(0, 100)}`);
    }
}

async function loadFromDrive() {
    if (!accessToken) return;
    try {
        const fileId = await findFileId();
        if (!fileId) return;

        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });

        if (response.ok) {
            const cloudData = await response.json();
            
            // Sync LocalStorage only if data exists in cloud
            if (cloudData.archivio) localStorage.setItem('archivio_elettrosuite', cloudData.archivio);
            if (cloudData.presets_inverter) localStorage.setItem('preset_inverter', cloudData.presets_inverter);
            if (cloudData.presets_pannello) localStorage.setItem('preset_pannello', cloudData.presets_pannello);
            
            // Refresh Archive View / Presets
            if (typeof loadArchive === 'function') loadArchive();
            if (typeof initPresets === 'function') initPresets();
        }
    } catch (e) {
        console.error("Error loading from Drive", e);
    }
}

async function findFileId() {
    const response = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=' + encodeURIComponent(`name = '${FILENAME}' and trashed = false`), {
        headers: { 'Authorization': 'Bearer ' + accessToken }
    });
    const result = await response.json();
    return (result.files && result.files.length > 0) ? result.files[0].id : null;
}

// Initial check for Google GIS script availability
window.addEventListener('load', () => {
    // Give GIS extra time if needed, or check immediately
    if (typeof google !== 'undefined') {
        initDrive();
    } else {
        // Fallback or retry on script load
        const checkGSI = setInterval(() => {
            if (typeof google !== 'undefined') {
                initDrive();
                clearInterval(checkGSI);
            }
        }, 500);
        setTimeout(() => clearInterval(checkGSI), 5000);
    }
});
