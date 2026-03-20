/**
 * drive.js - Google Drive Integration for ElectroSuite
 * Handles Auto-Save and Auto-Load via Google Identity Services (GIS) and REST API.
 */

const CLIENT_ID = '973187717006-revvk14cephvokm6vqil5dl19orarqsg.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
let accessToken = null;
let tokenClient;
let saveTimeout;

const FILENAME = 'electrosuite_save.json';

// Initialize GIS
function initDrive() {
    if (typeof google === 'undefined') {
        console.warn("Google Identity Services script not loaded yet.");
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (tokenResponse) => {
            if (tokenResponse.error !== undefined) {
                console.error("Auth Error:", tokenResponse);
                return;
            }
            accessToken = tokenResponse.access_token;
            onAuthSuccess();
        },
    });

    const loginBtn = document.getElementById('btn-drive-login');
    if (loginBtn) {
        loginBtn.onclick = () => {
            if (accessToken === null) {
                tokenClient.requestAccessToken({ prompt: 'consent' });
            } else {
                tokenClient.requestAccessToken({ prompt: '' });
            }
        };
    }
}

async function onAuthSuccess() {
    // Hide login button, show status
    const loginBtn = document.getElementById('btn-drive-login');
    const statusEl = document.getElementById('cloud-status');
    if (loginBtn) loginBtn.style.display = 'none';
    if (statusEl) {
        statusEl.style.display = 'inline-block';
        statusEl.innerText = "Caricamento...";
    }

    // Auto-Load on start
    await loadFromDrive();
    if (statusEl) statusEl.innerText = "☁️ Sincronizzato";
}

/**
 * Triggers a debounced auto-save to Google Drive.
 */
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
            if (statusEl) statusEl.innerText = "❌ Errore Salvataggio";
        }
    }, 3000);
}

/**
 * Saves the current application state (form values) to Google Drive.
 */
async function saveToDrive() {
    if (!accessToken) return;

    // Use current buildUiState from app.js if available
    const uiState = typeof buildUiState === 'function' ? buildUiState() : {};
    const data = JSON.stringify(uiState);

    const metadata = {
        name: FILENAME,
        parents: ['appDataFolder']
    };

    // First, find if the file exists to get the ID for update, or create new
    const fileId = await findFileId();

    let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    let method = 'POST';

    if (fileId) {
        url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
        method = 'PATCH';
    }

    const boundary = 'foo_bar_baz';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        data +
        close_delim;

    const response = await fetch(url, {
        method: method,
        headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'multipart/related; boundary=' + boundary
        },
        body: multipartRequestBody
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error('Drive upload failed: ' + err);
    }
}

/**
 * Loads the application state from Google Drive and populates the form.
 */
async function loadFromDrive() {
    if (!accessToken) return;

    try {
        const fileId = await findFileId();
        if (!fileId) {
            console.log("No cloud save found.");
            return;
        }

        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });

        if (response.ok) {
            const cloudState = await response.json();
            if (typeof applyCloudState === 'function') {
                applyCloudState(cloudState);
            } else {
                console.error("applyCloudState not defined in app.js");
            }
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
