// CableSizer Pro - Core Logic
let db = null;
let currentProjects = JSON.parse(localStorage.getItem('cablesizer_projects') || '[]');

// --- UI Elements ---
const sections = document.querySelectorAll('main > section');
const navItems = document.querySelectorAll('.nav-item');
const themeToggle = document.getElementById('theme-toggle');

// --- Initialization ---
async function init() {
    try {
        const response = await fetch('database.json');
        db = await response.json();
        console.log('Database loaded', db);
        renderTables();
        renderArchive();
        setupEventListeners();
        lucide.createIcons();

        // PWA Registration
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('service-worker.js')
                .then(() => console.log('Service Worker Registered'));
        }
    } catch (err) {
        console.error('Initialisation failed', err);
    }
}

// --- Navigation ---
function switchSection(id) {
    sections.forEach(s => s.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    navItems.forEach(n => {
        n.classList.toggle('active', n.dataset.sec === id);
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
        // deltaV = k * L * Ib * (R*cosphi + X*sinphi) * 10^-3
        const dvVolt = k * l * ib * (r * cosphi + x * sinphi) * 1e-3;
        const dvPercent = (dvVolt / v) * 100;
        return { volt: dvVolt, percent: dvPercent };
    }

    static sizeCable(params) {
        const { v, ib, l, cosphi, isTrifase, material, iso, posa, kFactors, dvMax } = params;
        const matData = db.materiali_conduttori[material];
        const sectionsKeys = Object.keys(matData.sezioni).sort((a, b) => parseFloat(a) - parseFloat(b));

        // Cavi unipolari o multipolari? Nel dubbio usiamo multi (più conservativo)
        const tipoCavo = "multi";
        const nConduttori = isTrifase ? "3x" : "2x";

        let finalS = null;
        let finalIz = 0;
        let finalDV = 0;

        for (let sKey of sectionsKeys) {
            const sVal = parseFloat(sKey);
            if (material === 'alluminio' && sVal < 10) continue;

            const sData = matData.sezioni[sKey];
            const i0 = sData.i0[iso][nConduttori];
            const iz = this.calculateIz(i0, kFactors);

            if (iz >= ib) {
                // Controllo Caduta Tensione
                const r = sData[tipoCavo].R;
                const x = sData[tipoCavo].X;
                const dv = this.calculateDeltaV(v, ib, l, r, x, cosphi, isTrifase);

                if (dv.percent <= dvMax) {
                    finalS = sKey;
                    finalIz = iz;
                    finalDV = dv.percent;
                    break;
                }
            }
        }

        return { section: finalS, iz: finalIz, dv: finalDV };
    }
}

// --- UI Handlers ---
function setupEventListeners() {
    // Nav
    navItems.forEach(item => {
        item.addEventListener('click', () => switchSection(item.dataset.sec));
    });

    // Theme
    themeToggle.addEventListener('click', () => {
        const current = document.body.getAttribute('data-theme');
        const next = current === 'light' ? 'dark' : 'light';
        document.body.setAttribute('data-theme', next);
        themeToggle.innerHTML = `<i data-lucide="${next === 'light' ? 'moon' : 'sun'}"></i>`;
        lucide.createIcons();
    });

    // Toggles Section 1
    setupToggles('sys-toggle');
    setupToggles('load-toggle', (val) => {
        document.getElementById('group-cosphi').classList.toggle('hidden', val === 'ib');
        document.getElementById('label-load').innerText = val === 'ib' ? 'Corrente Ib (A)' : 'Potenza P (kW)';
    });
    setupToggles('mat-toggle');

    // Select Posa
    const selectPosa = document.getElementById('select-posa');
    selectPosa.addEventListener('change', renderKFactors);
    renderKFactors(); // Initial

    // Auto calculate on input
    const inputs = ['input-v', 'input-load', 'input-cosphi', 'input-l', 'input-dvmax', 'select-iso'];
    inputs.forEach(id => document.getElementById(id).addEventListener('input', performCalculation));
    document.getElementById('select-posa').addEventListener('change', performCalculation);
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
    const posa = document.getElementById('select-posa').value;
    const container = document.getElementById('k-factors-container');
    container.innerHTML = '';

    if (posa === 'aria') {
        container.innerHTML = `
            <div class="form-group">
                <label>K1 (Temp. Aria)</label>
                <select id="k1-select" class="k-input">
                    <option value="1.12" data-lab="20°C">20°C</option>
                    <option value="1.00" data-lab="30°C" selected>30°C</option>
                    <option value="0.87" data-lab="40°C">40°C</option>
                </select>
            </div>
            <div class="form-group">
                <label>K2 (Raggruppamento)</label>
                <select id="k2-select" class="k-input">
                    <option value="1.0">1 Circuito</option>
                    <option value="0.8">2 Circuiti</option>
                    <option value="0.7">3 Circuiti</option>
                    <option value="0.5">9+ Circuiti</option>
                </select>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="form-group"><label>K1 (Temp. Terra)</label><select id="k1-select" class="k-input"><option value="1.1">10°C</option><option value="1.0" selected>20°C</option><option value="0.89">30°C</option></select></div>
            <div class="form-group"><label>K2 (Raggruppamento)</label><select id="k2-select" class="k-input"><option value="1.0">1 Circuito</option><option value="0.85">2 Circuiti</option></select></div>
            <div class="form-group"><label>K3 (Profondità)</label><select id="k3-select" class="k-input"><option value="1.02">0.5m</option><option value="1.00" selected>0.8m</option><option value="0.98">1.0m</option></select></div>
            <div class="form-group"><label>K4 (Resistività)</label><select id="k4-select" class="k-input"><option value="1.08">1.0 - Umido</option><option value="1.00" selected>1.5 - Standard</option><option value="0.90">2.0 - Secco</option></select></div>
        `;
    }
    document.querySelectorAll('.k-input').forEach(el => el.addEventListener('change', performCalculation));
}

function performCalculation() {
    const v = parseFloat(document.getElementById('input-v').value);
    const loadVal = parseFloat(document.getElementById('input-load').value);
    const l = parseFloat(document.getElementById('input-l').value);
    if (!v || !loadVal || !l) return;

    const isTrifase = document.querySelector('#sys-toggle .active').dataset.val === 'tri';
    const isP = document.querySelector('#load-toggle .active').dataset.val === 'p';
    const cosphi = parseFloat(document.getElementById('input-cosphi').value);
    const material = document.querySelector('#mat-toggle .active').dataset.val;
    const iso = document.getElementById('select-iso').value;
    const dvMax = parseFloat(document.getElementById('input-dvmax').value);

    let ib = isP ? CalculationEngine.calculateIb(loadVal, v, cosphi, isTrifase) : loadVal;

    const kSelectors = document.querySelectorAll('.k-input');
    const kFactors = Array.from(kSelectors).map(s => parseFloat(s.value));

    const result = CalculationEngine.sizeCable({
        v, ib, l, cosphi, isTrifase, material, iso,
        posa: document.getElementById('select-posa').value,
        kFactors, dvMax
    });

    displayResults(ib, result, dvMax);
}

function displayResults(ib, result, dvMax) {
    const card = document.getElementById('results-card');
    card.classList.remove('hidden');

    document.getElementById('res-ib').innerText = `${ib.toFixed(2)} A`;
    if (result.section) {
        document.getElementById('res-section').innerText = `${result.section} mm²`;
        document.getElementById('res-iz').innerText = `${result.iz.toFixed(2)} A`;
        document.getElementById('res-dv').innerText = `${result.dv.toFixed(2)} %`;

        const bar = document.getElementById('dv-bar');
        const width = Math.min((result.dv / dvMax) * 100, 100);
        bar.style.width = `${width}%`;
        bar.className = `dv-bar ${result.dv > dvMax ? 'dv-fail' : 'dv-ok'}`;
    } else {
        document.getElementById('res-section').innerText = `NON TROVATA`;
        document.getElementById('res-iz').innerText = `-`;
        document.getElementById('res-dv').innerText = `-`;
    }
}

// --- Section 2: Solo ΔV ---
function performQuickDV() {
    const container = document.getElementById('dv-quick-container');
    container.innerHTML = `
        <div class="form-group"><label>Sistema</label><select id="q-sys"><option value="mono">Monofase</option><option value="tri">Trifase</option></select></div>
        <div class="form-group"><label>Tensione (V)</label><input type="number" id="q-v" value="230"></div>
        <div class="form-group"><label>Corrente Ib (A)</label><input type="number" id="q-ib" placeholder="Es. 10"></div>
        <div class="form-group"><label>Lunghezza (m)</label><input type="number" id="q-l" placeholder="Es. 30"></div>
        <div class="form-group"><label>Materiale</label><select id="q-mat"><option value="rame">Rame</option><option value="alluminio">Alluminio</option></select></div>
        <div class="form-group"><label>Sezione (mm²)</label><select id="q-s"></select></div>
        <div id="q-res" class="card" style="grid-column: 1 / -1; margin-top: 1rem; border-style: dashed; text-align: center;">
            <p>Caduta: <span id="q-res-v" class="result-value">- V</span> (<span id="q-res-p">- %</span>)</p>
        </div>
    `;

    const matSelect = document.getElementById('q-mat');
    const sSelect = document.getElementById('q-s');

    function updateSections() {
        const mat = matSelect.value;
        const sections = Object.keys(db.materiali_conduttori[mat].sezioni).sort((a, b) => parseFloat(a) - parseFloat(b));
        sSelect.innerHTML = sections.map(s => `<option value="${s}">${s} mm²</option>`).join('');
    }

    matSelect.addEventListener('change', updateSections);
    updateSections();

    function calc() {
        const v = parseFloat(document.getElementById('q-v').value);
        const ib = parseFloat(document.getElementById('q-ib').value);
        const l = parseFloat(document.getElementById('q-l').value);
        const s = sSelect.value;
        const isTri = document.getElementById('q-sys').value === 'tri';
        const mat = matSelect.value;

        if (!v || !ib || !l || !s) return;

        const sData = db.materiali_conduttori[mat].sezioni[s];
        const res = CalculationEngine.calculateDeltaV(v, ib, l, sData.multi.R, sData.multi.X, 0.9, isTri);

        document.getElementById('q-res-v').innerText = `${res.volt.toFixed(2)} V`;
        document.getElementById('q-res-p').innerText = `${res.percent.toFixed(2)} %`;
    }

    container.querySelectorAll('input, select').forEach(el => el.addEventListener('input', calc));
}

// --- Persistence & PDF ---
function saveProject() {
    const name = prompt('Nome del progetto:');
    if (!name) return;

    const v = document.getElementById('input-v').value;
    const load = document.getElementById('input-load').value;
    const section = document.getElementById('res-section').innerText;

    const project = {
        name,
        date: new Date().toLocaleDateString(),
        v, load, section: section.split(' ')[0],
        details: {
            ib: document.getElementById('res-ib').innerText,
            iz: document.getElementById('res-iz').innerText,
            dv: document.getElementById('res-dv').innerText
        }
    };

    currentProjects.unshift(project);
    localStorage.setItem('cablesizer_projects', JSON.stringify(currentProjects));
    renderArchive();
    alert('Progetto salvato con successo!');
}

async function generatePDF(index) {
    const p = currentProjects[index];
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Layout Semplice
    doc.setFontSize(22);
    doc.setTextColor(242, 204, 13); // Primary Yellow
    doc.text('REPORT DIMENSIONAMENTO CAVI', 20, 30);

    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text(`Progetto: ${p.name}`, 20, 45);
    doc.text(`Data: ${p.date}`, 20, 52);

    doc.line(20, 60, 190, 60);

    doc.setFontSize(14);
    doc.text('DATI DI INPUT E RISULTATI', 20, 75);

    doc.setFontSize(12);
    doc.text(`Tensione di Lavoro: ${p.v} V`, 20, 90);
    doc.text(`Carico Ib: ${p.details.ib}`, 20, 100);
    doc.text(`Sezione Calcolata: ${p.section} mmq`, 20, 110);
    doc.text(`Portata Cavo Iz: ${p.details.iz}`, 20, 120);
    doc.text(`Caduta di Tensione: ${p.details.dv}`, 20, 130);

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text('Generato con CableSizer Pro - Conformità CEI 64-8', 20, 280);

    doc.save(`${p.name}_Report.pdf`);
}

// In Section 4 render:
function renderArchive() {
    const container = document.getElementById('archive-list');
    if (currentProjects.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding: 2rem; color: var(--on-surface-variant)">Nessun progetto salvato.</p>';
        return;
    }
    container.innerHTML = currentProjects.map((p, i) => `
        <div class="card project-card">
            <div class="project-info">
                <h4>${p.name}</h4>
                <p>${p.date} - ${p.section} mm²</p>
            </div>
            <div class="project-actions">
                <button class="icon-btn" onclick="generatePDF(${i})" title="Report PDF"><i data-lucide="file-text"></i></button>
                <button class="icon-btn" onclick="deleteProject(${i})" title="Elimina"><i data-lucide="trash-2"></i></button>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

// Setup extra
document.getElementById('btn-save').addEventListener('click', saveProject);
performQuickDV();

// Start
init();
