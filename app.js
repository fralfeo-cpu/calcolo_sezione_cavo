// CableSizer Pro - Core Logic
let db = null;
let currentProjects = JSON.parse(localStorage.getItem('cablesizer_projects') || '[]');

// --- UI Elements ---
const navItems = document.querySelectorAll('.nav-item');
const themeToggle = document.getElementById('theme-toggle');

// --- Initialization ---
function init() {
    try {
        db = DB_DATA; // Use embedded data

        setupEventListeners();
        renderTables();
        renderArchive();
        lucide.createIcons();

        // PWA Registration
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('service-worker.js').catch(console.error);
        }

        // Initial Calculation
        performCalculation();
    } catch (err) {
        console.error('Initialisation failed', err);
        alert('Errore nell\'inizializzazione dell\'app.');
    }
}

// --- Navigation ---
function switchSection(targetId) {
    const sections = document.querySelectorAll('main > section');
    sections.forEach(s => s.classList.add('hidden'));

    const target = document.getElementById(targetId);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo(0, 0);
    }

    navItems.forEach(n => {
        n.classList.toggle('active', n.dataset.sec === targetId);
    });
}

// --- Calculation Engine ---
class CalculationEngine {
    static calculateIb(p_kw, v, cosphi, isTrifase) {
        if (!p_kw) return 0;
        const p_w = p_kw * 1000;
        if (isTrifase) {
            return p_w / (Math.sqrt(3) * v * cosphi);
        } else {
            return p_w / (v * cosphi);
        }
    }

    static calculateIz(i0, kFactors) {
        return i0 * kFactors.reduce((acc, k) => acc * k, 1);
    }

    static calculateDeltaV(v, ib, l, r, x, cosphi, isTrifase) {
        const k = isTrifase ? Math.sqrt(3) : 2;
        const sinphi = Math.sqrt(1 - Math.pow(cosphi, 2));
        const dvVolt = k * l * ib * (r * cosphi + x * sinphi) * 1e-3;
        const dvPercent = (dvVolt / v) * 100;
        return { volt: dvVolt, percent: dvPercent };
    }

    static sizeCable(params) {
        const { v, ib, l, cosphi, isTrifase, material, iso, metodo, kFactors, dvMax } = params;
        if (!db) return null;

        const matData = db.materiali_conduttori[material];
        const sectionsKeys = Object.keys(matData.sezioni).sort((a, b) => parseFloat(a) - parseFloat(b));

        const tipoCavo = "multi";
        const nConduttori = isTrifase ? "3x" : "2x";

        for (let sKey of sectionsKeys) {
            const sVal = parseFloat(sKey);
            if (material === 'alluminio' && sVal < 10) continue;

            const sData = matData.sezioni[sKey];

            // Check if method exists for this section
            if (!sData.i0[metodo]) continue;

            const i0 = sData.i0[metodo][iso][nConduttori];
            const iz = this.calculateIz(i0, kFactors);

            if (iz >= ib) {
                const r = sData[tipoCavo].R;
                const x = sData[tipoCavo].X;
                const dv = this.calculateDeltaV(v, ib, l, r, x, cosphi, isTrifase);

                if (dv.percent <= dvMax) {
                    return { section: sKey, iz: iz, dv: dv.percent, r, x };
                }
            }
        }
        return null;
    }
}

// --- Event Listeners and UI ---
function setupEventListeners() {
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            switchSection(item.dataset.sec);
        });
    });

    themeToggle.addEventListener('click', () => {
        const isLight = document.body.getAttribute('data-theme') === 'light';
        const next = isLight ? 'dark' : 'light';
        document.body.setAttribute('data-theme', next);
        themeToggle.innerHTML = `<i data-lucide="${next === 'light' ? 'moon' : 'sun'}"></i>`;
        lucide.createIcons();
    });

    setupToggles('sys-toggle');
    setupToggles('load-toggle', (val) => {
        document.getElementById('group-cosphi').classList.toggle('hidden', val === 'ib');
        document.getElementById('label-load').innerText = val === 'ib' ? 'Corrente Ib (A)' : 'Potenza P (kW)';
    });
    setupToggles('mat-toggle');

    document.getElementById('select-posa').addEventListener('change', () => {
        renderKFactors();
        performCalculation();
    });

    document.getElementById('select-iso').addEventListener('change', performCalculation);

    // Auto-update on inputs
    ['input-v', 'input-load', 'input-cosphi', 'input-l', 'input-dvmax'].forEach(id => {
        document.getElementById(id).addEventListener('input', performCalculation);
    });

    renderKFactors();
    performQuickDV();
}

function setupToggles(id, callback) {
    const container = document.getElementById(id);
    const btns = container.querySelectorAll('.toggle-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (callback) callback(btn.dataset.val);
            performCalculation();
        });
    });
}

function renderKFactors() {
    const metodo = document.getElementById('select-posa').value;
    const isInterrata = metodo.startsWith('D');
    const container = document.getElementById('k-factors-container');
    container.innerHTML = '';

    if (!isInterrata) {
        container.innerHTML = `
            <div class="form-group"><label>K1 (Temp. Aria)</label>
                <select id="k1-select" class="k-input">
                    <option value="1.12">20°C</option><option value="1.00" selected>30°C</option><option value="0.87">40°C</option><option value="0.71">50°C</option>
                </select>
            </div>
            <div class="form-group"><label>K2 (Raggruppamento)</label>
                <select id="k2-select" class="k-input">
                    <option value="1.0">1 Circuito</option><option value="0.8">2 Cir.</option><option value="0.7">3 Cir.</option><option value="0.6">5 Cir.</option><option value="0.5">9+ Cir.</option>
                </select>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="form-group"><label>K1 (Temp. Terra)</label>
                <select id="k1-select" class="k-input"><option value="1.1">10°C</option><option value="1.0" selected>20°C</option><option value="0.89">30°C</option></select>
            </div>
            <div class="form-group"><label>K2 (Raggruppamento)</label>
                <select id="k2-select" class="k-input"><option value="1.0">1 Cavo</option><option value="0.85">2 Cavi</option><option value="0.75">3 Cavi</option></select>
            </div>
            <div class="form-group"><label>K3 (Profondità)</label>
                <select id="k3-select" class="k-input"><option value="1.02">0.5m</option><option value="1.00" selected>0.8m</option><option value="0.98">1.0m</option></select>
            </div>
            <div class="form-group"><label>K4 (Resistività)</label>
                <select id="k4-select" class="k-input"><option value="1.08">1.0 Umido</option><option value="1.00" selected>1.5 Std</option><option value="0.90">2.0 Secco</option></select>
            </div>
        `;
    }
    document.querySelectorAll('.k-input').forEach(el => el.addEventListener('change', performCalculation));
}

function performCalculation() {
    if (!db) return;
    const v = parseFloat(document.getElementById('input-v').value) || 230;
    const loadVal = parseFloat(document.getElementById('input-load').value) || 0;
    const l = parseFloat(document.getElementById('input-l').value) || 0;

    const isTrifase = document.querySelector('#sys-toggle .active').dataset.val === 'tri';
    const isP = document.querySelector('#load-toggle .active').dataset.val === 'p';
    const cosphi = parseFloat(document.getElementById('input-cosphi').value) || 0.9;
    const material = document.querySelector('#mat-toggle .active').dataset.val;
    const iso = document.getElementById('select-iso').value;
    const metodo = document.getElementById('select-posa').value;
    const dvMax = parseFloat(document.getElementById('input-dvmax').value) || 4;

    let ib = isP ? CalculationEngine.calculateIb(loadVal, v, cosphi, isTrifase) : loadVal;
    const kFactors = Array.from(document.querySelectorAll('.k-input')).map(s => parseFloat(s.value));

    const result = CalculationEngine.sizeCable({ v, ib, l, cosphi, isTrifase, material, iso, metodo, kFactors, dvMax });

    const resCard = document.getElementById('results-card');
    if (ib > 0 && l > 0) {
        resCard.classList.remove('hidden');
        displayResults(ib, result, dvMax);
    } else {
        resCard.classList.add('hidden');
    }
}

function displayResults(ib, result, dvMax) {
    document.getElementById('res-ib').innerText = `${ib.toFixed(2)} A`;
    if (result) {
        document.getElementById('res-section').innerText = `${result.section} mm²`;
        document.getElementById('res-iz').innerText = `${result.iz.toFixed(2)} A`;
        document.getElementById('res-dv').innerText = `${result.dv.toFixed(2)} %`;

        const bar = document.getElementById('dv-bar');
        const width = Math.min((result.dv / dvMax) * 100, 100);
        bar.style.width = `${width}%`;
        bar.className = `dv-bar ${result.dv > dvMax ? 'dv-fail' : 'dv-ok'}`;
    } else {
        document.getElementById('res-section').innerText = `SEZIONE NON TROVATA`;
        document.getElementById('res-iz').innerText = `N/A`;
        document.getElementById('res-dv').innerText = `N/A`;
    }
}

function performQuickDV() {
    const container = document.getElementById('dv-quick-container');
    container.innerHTML = `
        <div class="form-group"><label>Stato</label><select id="q-sys"><option value="mono">Monofase</option><option value="tri">Trifase</option></select></div>
        <div class="form-group"><label>Tensione (V)</label><input type="number" id="q-v" value="230"></div>
        <div class="form-group"><label>Ib (A)</label><input type="number" id="q-ib" value="16"></div>
        <div class="form-group"><label>L (m)</label><input type="number" id="q-l" value="50"></div>
        <div class="form-group"><label>Materiale</label><select id="q-mat"><option value="rame">Rame</option><option value="alluminio">Alluminio</option></select></div>
        <div class="form-group"><label>Sezione (mm²)</label><select id="q-s"></select></div>
        <div id="q-res" class="card" style="grid-column: 1 / -1; margin-top: 1rem; border-style: dashed; text-align: center; border-color: var(--primary);">
            <p>Caduta: <span id="q-res-v" class="result-value">- V</span> (<span id="q-res-p">- %</span>)</p>
        </div>
    `;

    const matSelect = document.getElementById('q-mat');
    const sSelect = document.getElementById('q-s');

    function updateSections() {
        const mat = matSelect.value;
        const sections = Object.keys(db.materiali_conduttori[mat].sezioni).sort((a, b) => parseFloat(a) - parseFloat(b));
        sSelect.innerHTML = sections.map(s => `<option value="${s}">${s} mm²</option>`).join('');
        calc();
    }

    matSelect.addEventListener('change', updateSections);
    updateSections();

    function calc() {
        if (!db) return;
        const v = parseFloat(document.getElementById('q-v').value) || 230;
        const ib = parseFloat(document.getElementById('q-ib').value) || 0;
        const l = parseFloat(document.getElementById('q-l').value) || 0;
        const s = sSelect.value;
        const isTri = document.getElementById('q-sys').value === 'tri';
        const mat = matSelect.value;

        if (!s) return;
        const sData = db.materiali_conduttori[mat].sezioni[s];
        const res = CalculationEngine.calculateDeltaV(v, ib, l, sData.multi.R, sData.multi.X, 0.9, isTri);

        document.getElementById('q-res-v').innerText = `${res.volt.toFixed(2)} V`;
        document.getElementById('q-res-p').innerText = `${res.percent.toFixed(1)} %`;
    }

    container.querySelectorAll('input, select').forEach(el => el.addEventListener('input', calc));
}

function saveProject() {
    const name = prompt('Nome del progetto:');
    if (!name) return;
    const project = {
        name, date: new Date().toLocaleDateString(),
        v: document.getElementById('input-v').value,
        load: document.getElementById('input-load').value,
        section: document.getElementById('res-section').innerText.split(' ')[0],
        details: { ib: document.getElementById('res-ib').innerText, iz: document.getElementById('res-iz').innerText, dv: document.getElementById('res-dv').innerText }
    };
    currentProjects.unshift(project);
    localStorage.setItem('cablesizer_projects', JSON.stringify(currentProjects));
    renderArchive();
}

function renderArchive() {
    const list = document.getElementById('archive-list');
    if (!currentProjects.length) { list.innerHTML = '<p style="text-align:center; padding: 2rem; color: var(--on-surface-variant)">Nessun progetto salvato.</p>'; return; }
    list.innerHTML = currentProjects.map((p, i) => `
        <div class="card project-card">
            <div class="project-info"><h4>${p.name}</h4><p>${p.date} - ${p.section} mm²</p></div>
            <div class="project-actions">
                <button class="icon-btn" onclick="generatePDF(${i})"><i data-lucide="file-text"></i></button>
                <button class="icon-btn" onclick="deleteProject(${i})"><i data-lucide="trash-2"></i></button>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

function deleteProject(i) {
    if (confirm('Eliminare il progetto?')) { currentProjects.splice(i, 1); localStorage.setItem('cablesizer_projects', JSON.stringify(currentProjects)); renderArchive(); }
}

async function generatePDF(i) {
    const p = currentProjects[i];
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(22); doc.setTextColor(242, 204, 13); doc.text('REPORT DIMENSIONAMENTO', 20, 30);
    doc.setFontSize(12); doc.setTextColor(0); doc.text(`Progetto: ${p.name}`, 20, 50); doc.text(`Data: ${p.date}`, 20, 58);
    doc.line(20, 65, 190, 65);
    doc.text(`Tensione: ${p.v} V`, 20, 80); doc.text(`Corrente Ib: ${p.details.ib}`, 20, 90); doc.text(`Sezione: ${p.section} mm²`, 20, 100);
    doc.text(`Portata Iz: ${p.details.iz}`, 20, 110); doc.text(`C.d.T. %: ${p.details.dv}`, 20, 120);
    doc.save(`${p.name}_Report.pdf`);
}

window.deleteProject = deleteProject;
window.generatePDF = generatePDF;
document.getElementById('btn-save').addEventListener('click', saveProject);
init();
