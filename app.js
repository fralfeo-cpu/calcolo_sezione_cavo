const DB = DB_DATA.database_cavi_master;
let currentResult = null;

const POSA_LABELS = {
    "aria_tubo_muro_A1": "Metodo A1 (In tubo entro parete isolante)",
    "aria_tubo_B1": "Metodo B1 (Cavi unipolari entro tubo su parete o incassati)",
    "aria_tubo_B2": "Metodo B2 (Cavi multipolari entro tubo su parete o incassati)",
    "aria_muro_C": "Metodo C (Cavi fissati direttamente a parete o su passerella non perforata)",
    "interrato_tubo_D1": "Metodo D1 (In tubo protettivo interrato)",
    "interrato_diretto_D2": "Metodo D2 (Cavi posti direttamente nel terreno)",
    "aria_passerella_E": "Metodo E (Cavi multipolari su passerella perforata)",
    "aria_passerella_F": "Metodo F (Cavi unipolari a contatto tra loro su passerella perforata)",
    "aria_passerella_G": "Metodo G (Cavi unipolari distanziati tra loro su passerella perforata)",
    "aria_libera": "Posa in aria su passerelle, mensole o supporti distanziatori",
    "interrato_tubo": "Cavi posati entro tubi o condotti interrati",
    "interrato_diretto": "Cavi posati direttamente nel terreno (con eventuale letto di sabbia)"
};

function formatPosaName(key) {
    return POSA_LABELS[key] || key.replace(/_/g, ' ').toUpperCase();
}

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initUI();
    updateLists();
    performCalculation();
    loadExternalScripts();
});

function initUI() {
    // Theme toggle
    const savedTheme = localStorage.getItem('cs_theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.body.classList.add('dark-mode');
    }

    const themeBtn = document.getElementById('btn-theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const isDark = document.body.classList.toggle('dark-mode');
            localStorage.setItem('cs_theme', isDark ? 'dark' : 'light');
        });
    }

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            const target = item.getAttribute('data-target');
            document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
            document.getElementById(target).classList.remove('hidden');

            if (target === 'sec-archive') loadArchive();
        });
    });

    // Pills logic
    document.querySelectorAll('.pill-group').forEach(group => {
        const pills = group.querySelectorAll('.pill');
        pills.forEach(pill => {
            pill.addEventListener('click', (e) => {
                e.preventDefault();
                pills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');

                // Specific updates
                if (group.id === 'pill-input-type') {
                    const isP = pill.getAttribute('data-val') === 'p';
                    document.getElementById('lbl-load').textContent = isP ? 'Potenza' : 'Corrente Ib';
                    document.getElementById('unit-load').textContent = isP ? 'kW' : 'A';
                    document.getElementById('wrap-cosphi').style.display = isP ? 'block' : 'none';
                }
                if (group.id === 'pill-tens' || group.id === 'pill-mat') {
                    updateLists();
                }

                performCalculation();
            });
        });
    });

    // Accordion logic
    const accHeader = document.querySelector('.accordion-header');
    if (accHeader) {
        accHeader.addEventListener('click', () => {
            document.getElementById('acc-k').classList.toggle('open');
        });
    }

    // Input listeners
    const inputs = ['in-v', 'in-l', 'in-load', 'in-cosphi', 'in-dvmax', 'sel-iso', 'sel-posa', 'sel-temp', 'sel-group', 'sel-depth', 'sel-res', 'sel-n-cavi', 'ch-auto-parallel'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                if (id === 'sel-posa' || id === 'sel-iso') updateLists();
                performCalculation();
            });
        }
    });

    // Quick DV Check listeners
    const qInputs = ['q-sys', 'q-cat', 'q-v', 'q-ib', 'q-l', 'q-mat', 'q-sec'];
    qInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                if (id === 'q-cat' || id === 'q-mat') updateLists();
                checkQuickDV();
            });
        }
    });

    // Modal
    document.getElementById('btn-save').addEventListener('click', () => {
        document.getElementById('modal-save').classList.add('open');
    });
    document.getElementById('btn-modal-cancel').addEventListener('click', () => {
        document.getElementById('modal-save').classList.remove('open');
    });
    document.getElementById('btn-modal-confirm').addEventListener('click', saveProject);
    document.getElementById('btn-clear-archive').addEventListener('click', clearArchive);

    // Close any open select wrapper if clicked outside
    window.addEventListener('click', () => {
        document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
    });
}

function updateLists() {
    const tens = document.querySelector('#pill-tens .active').getAttribute('data-val');
    const mat = document.querySelector('#pill-mat .active').getAttribute('data-val');
    const iso = document.getElementById('sel-iso').value;

    // Update Posa based on Tens and Iso
    const posaSelect = document.getElementById('sel-posa');
    const currentPosaVal = posaSelect.value;
    let posaMethods = [];
    if (tens === 'bt_bassa_tensione') {
        const dbCat = DB.portate_bt_bassa_tensione[iso];
        if (dbCat && dbCat['rame']) {
            posaMethods = Object.keys(dbCat['rame']);
        }
    } else {
        const dbCat = DB.portate_mt_media_tensione.xlpe_epr_90C;
        if (dbCat && dbCat['rame']) {
            posaMethods = Object.keys(dbCat['rame']);
        }
    }

    posaSelect.innerHTML = posaMethods.map(m => `<option value="${m}" ${m === currentPosaVal ? 'selected' : ''}>${formatPosaName(m)}</option>`).join('');

    const posa = posaSelect.value || '';
    const env = posa.includes('interrato') ? 'terreno' : 'aria';

    document.getElementById('lbl-temp').textContent = env === 'terreno' ? 'Temperatura Terreno (°C) [K1]' : 'Temperatura Aria (°C) [K1]';
    document.getElementById('wrap-terra').style.display = env === 'terreno' ? 'flex' : 'none';

    // Update factor lists
    const kData = DB.fattori_correzione;

    // K1 Temp
    const tempSelect = document.getElementById('sel-temp');
    if (tens === 'bt_bassa_tensione') {
        const k1Key = env === 'terreno' ? 'k1_temperatura_terreno' : 'k1_temperatura_aria';
        const temps = Object.keys(kData[k1Key][iso] || {});
        tempSelect.innerHTML = temps.map(t => `<option value="${t}" ${t === '20' ? 'selected' : ''}>${t}</option>`).join('');
    } else {
        // Fallback or disable for MT since specific K tables aren't in this DB subset, assuming 1
        tempSelect.innerHTML = '<option value="20">20</option>';
    }

    // K2 Group
    const groupSelect = document.getElementById('sel-group');
    const groupKey = env === 'terreno' ? 'k2_raggruppamento_interrato' : 'k2_raggruppamento_aria';
    const groups = Object.keys(kData[groupKey] || {});
    groupSelect.innerHTML = groups.map(g => `<option value="${g}">${g}</option>`).join('');

    // K3 & K4
    const depthSelect = document.getElementById('sel-depth');
    const depths = Object.keys(kData.k3_profondita_interrato || {});
    depthSelect.innerHTML = depths.map(d => `<option value="${d}" ${d === '0.8' ? 'selected' : ''}>${d}</option>`).join('');

    const resSelect = document.getElementById('sel-res');
    const res = Object.keys(kData.k4_resistivita_terreno || {});
    resSelect.innerHTML = res.map(r => `<option value="${r}">${r}</option>`).join('');

    // Quick DV Sections
    const qSecSelect = document.getElementById('q-sec');
    const qCat = document.getElementById('q-cat').value;
    const qMat = document.getElementById('q-mat').value;
    if (DB.parametri_elettrici[qCat] && DB.parametri_elettrici[qCat][qMat]) {
        const currentSec = qSecSelect.value;
        const sections = Object.keys(DB.parametri_elettrici[qCat][qMat]).sort((a, b) => parseFloat(a) - parseFloat(b));
        qSecSelect.innerHTML = sections.map(s => `<option value="${s}" ${s === currentSec ? 'selected' : ''}>${s} mm²</option>`).join('');
    }

    upgradeSelects();
}

function upgradeSelects() {
    document.querySelectorAll('.custom-select-wrapper').forEach(w => w.remove());
    document.querySelectorAll('select.m3-select').forEach(s => s.classList.remove('upgraded'));

    // Disable custom selects on mobile to use native smooth dropdowns
    if (window.innerWidth <= 768) return;

    document.querySelectorAll('select.m3-select').forEach(select => {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        if (select.style.flex) wrapper.style.flex = select.style.flex;

        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        const span = document.createElement('span');
        span.textContent = select.options[select.selectedIndex]?.text || '';
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', 'chevron-down');

        trigger.appendChild(span);
        trigger.appendChild(icon);

        const optionsList = document.createElement('div');
        optionsList.className = 'custom-select-options';

        Array.from(select.options).forEach(opt => {
            const div = document.createElement('div');
            div.className = 'custom-option' + (opt.selected ? ' selected' : '');
            div.textContent = opt.text;
            div.addEventListener('click', (e) => {
                e.stopPropagation();

                // If the selection has actually changed
                if (select.value !== opt.value) {
                    select.value = opt.value;
                    select.dispatchEvent(new Event('input', { bubbles: true }));
                }

                span.textContent = opt.text;
                optionsList.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                div.classList.add('selected');
                wrapper.classList.remove('open');
            });
            optionsList.appendChild(div);
        });

        wrapper.appendChild(trigger);
        wrapper.appendChild(optionsList);

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.custom-select-wrapper').forEach(w => {
                if (w !== wrapper) w.classList.remove('open');
            });
            wrapper.classList.toggle('open');
        });

        select.classList.add('upgraded');
        select.parentNode.insertBefore(wrapper, select.nextSibling);
    });
    lucide.createIcons();
}

function calculateIb(p, v, cosphi, isTri) {
    if (isTri) return (p * 1000) / (Math.sqrt(3) * v * cosphi);
    return (p * 1000) / (v * cosphi);
}

function getKFactors(nConductors = 1) {
    const tens = document.querySelector('#pill-tens .active').getAttribute('data-val');
    if (tens !== 'bt_bassa_tensione') return { k1: 1, k2: 1, k3: 1, k4: 1 }; // simplified for MT

    const iso = document.getElementById('sel-iso').value;
    const posa = document.getElementById('sel-posa').value;
    const env = posa && posa.includes('interrato') ? 'terreno' : 'aria';
    const temp = document.getElementById('sel-temp').value;
    const group = document.getElementById('sel-group').value;

    const kData = DB.fattori_correzione;

    let k1 = 1;
    let k2 = 1;
    let k3 = 1;
    let k4 = 1;

    try {
        if (env === 'terreno') {
            k1 = kData.k1_temperatura_terreno[iso][temp] || 1;
            const effGroup = Math.min(parseInt(group) * nConductors, 5).toString(); // max table group for interrato is usually 5 or 6, clip to avoid undefined
            k2 = kData.k2_raggruppamento_interrato[group] || 1;
            // recalculate real K2 based on effGroup
            let matchedK2 = kData.k2_raggruppamento_interrato[effGroup];
            if (!matchedK2) {
                // get the highest available key
                const keys = Object.keys(kData.k2_raggruppamento_interrato).map(Number).sort((a, b) => b - a);
                matchedK2 = kData.k2_raggruppamento_interrato[keys[0]];
            }
            k2 = matchedK2 || 1;

            const depth = document.getElementById('sel-depth').value;
            k3 = kData.k3_profondita_interrato[depth] || 1;
            const res = document.getElementById('sel-res').value;
            k4 = kData.k4_resistivita_terreno[res] || 1;
        } else {
            k1 = kData.k1_temperatura_aria[iso][temp] || 1;
            const effGroup = Math.min(parseInt(group) * nConductors, 6).toString();
            let matchedK2 = kData.k2_raggruppamento_aria[effGroup];
            if (!matchedK2) {
                const keys = Object.keys(kData.k2_raggruppamento_aria).map(Number).sort((a, b) => b - a);
                matchedK2 = kData.k2_raggruppamento_aria[keys[0]];
            }
            k2 = matchedK2 || 1;
        }
    } catch (e) { }

    return { k1, k2, k3, k4 };
}

function performCalculation() {
    try {
        // FASE A
        const isTri = document.querySelector('#pill-sys .active').getAttribute('data-val') === 'tri';
        const v = parseFloat(document.getElementById('in-v').value) || (isTri ? 400 : 230);
        const l = parseFloat(document.getElementById('in-l').value) || 1;
        const dvMax = parseFloat(document.getElementById('in-dvmax').value) || 4;

        const inputType = document.querySelector('#pill-input-type .active').getAttribute('data-val');
        const load = parseFloat(document.getElementById('in-load').value) || 0;
        const cosphi = parseFloat(document.getElementById('in-cosphi').value) || 0.9;

        let ib = 0;
        if (inputType === 'p') ib = calculateIb(load, v, cosphi, isTri);
        else ib = load;

        if (ib <= 0) return setUIError();

        // FASE B
        const tens = document.querySelector('#pill-tens .active').getAttribute('data-val');
        const mat = document.querySelector('#pill-mat .active').getAttribute('data-val');
        const iso = document.getElementById('sel-iso').value;
        const posa = document.getElementById('sel-posa').value;

        let portateSchema;
        if (tens === 'bt_bassa_tensione') {
            portateSchema = DB.portate_bt_bassa_tensione[iso]?.[mat]?.[posa] || DB.portate_bt_bassa_tensione[iso]?.['rame']?.[posa];
        } else {
            portateSchema = DB.portate_mt_media_tensione.xlpe_epr_90C?.[mat]?.[posa] || DB.portate_mt_media_tensione.xlpe_epr_90C?.['rame']?.[posa];
        }

        if (!portateSchema) return setUIError();

        const paramElettrici = DB.parametri_elettrici[tens]?.[mat];
        if (!paramElettrici) return setUIError();

        const k = isTri ? Math.sqrt(3) : 2;
        const phi = Math.acos(cosphi);
        const sinphi = Math.sin(phi);

        const sezioni = Object.keys(portateSchema).sort((a, b) => parseFloat(a) - parseFloat(b));

        let validSection = null;
        let finalIz = 0;
        let finalDv = 0;
        let finalN = 1;

        const autoParallelEl = document.getElementById('ch-auto-parallel');
        const isAutoParallel = autoParallelEl && autoParallelEl.checked;
        const baseN = parseInt(document.getElementById('sel-n-cavi')?.value) || 1;
        const maxN = isAutoParallel ? 6 : baseN;

        for (let N = baseN; N <= maxN; N++) {
            const kF = getKFactors(N);
            const Ktot = kF.k1 * kF.k2 * kF.k3 * kF.k4;

            for (let s of sezioni) {
                // Salta le sezioni base (es. 1.5, 2.5) se non esistono nel database parametri elettrici del materiale scelto
                if (!paramElettrici[s]) continue;

                const i0 = portateSchema[s];
                const iz = i0 * Ktot * N;

                if (iz >= ib) {
                    // Criterio termico ok. FASE C: Verifica DV
                    const R = paramElettrici[s].R / N; // equivalent resistance for parallel wires
                    const X = paramElettrici[s].X / N; // equivalent reactance

                    const dvVolts = (k * l * ib * (R * cosphi + X * sinphi)) / 1000;
                    const dvPerc = (dvVolts / v) * 100;

                    if (dvPerc <= dvMax) {
                        validSection = s;
                        finalIz = iz;
                        finalDv = dvPerc;
                        finalN = N;
                        break;
                    }
                }
            }
            if (validSection) break;
        }

        if (validSection) {
            currentResult = {
                section: validSection,
                n: finalN,
                ib: ib,
                iz: finalIz,
                dv: finalDv,
                status: 'OK'
            };
            setUISuccess(currentResult);
        } else {
            currentResult = { ib, iz: 0, dv: 0, status: 'NOT_FOUND', section: '-' };
            setUIFatalError();
        }

    } catch (e) {
        console.error(e);
        setUIError();
    }
}

function setUISuccess(r) {
    document.getElementById('res-placeholder').classList.add('hidden');
    document.getElementById('res-data').classList.remove('hidden');

    const card = document.getElementById('main-result-card');
    card.classList.remove('error');
    card.classList.add('ok');

    document.getElementById('res-sec').textContent = r.n > 1 ? `${r.n} x ${r.section} mm²` : `${r.section} mm²`;
    document.getElementById('res-ib').textContent = r.ib.toFixed(2) + ' A';
    document.getElementById('res-iz').textContent = r.iz.toFixed(2) + ' A';
    document.getElementById('res-dv').textContent = r.dv.toFixed(2) + ' %';

    const st = document.getElementById('res-status');
    st.textContent = "VERIFICATO";
    st.style.color = "var(--success)";
}

function setUIFatalError() {
    document.getElementById('res-placeholder').classList.add('hidden');
    document.getElementById('res-data').classList.remove('hidden');

    const card = document.getElementById('main-result-card');
    card.classList.remove('ok');
    card.classList.add('error');

    document.getElementById('res-sec').textContent = `-- mm²`;
    document.getElementById('res-ib').textContent = currentResult.ib.toFixed(2) + ' A';
    document.getElementById('res-iz').textContent = '-- A';
    document.getElementById('res-dv').textContent = '> Max';

    const st = document.getElementById('res-status');
    st.textContent = "FUORI LIMITE";
    st.style.color = "var(--error)";
}

function setUIError() {
    document.getElementById('res-data').classList.add('hidden');
    document.getElementById('res-placeholder').classList.remove('hidden');
    const card = document.getElementById('main-result-card');
    card.classList.remove('ok', 'error');
}

function checkQuickDV() {
    const sys = document.getElementById('q-sys').value;
    const isTri = sys === 'tri';
    const v = parseFloat(document.getElementById('q-v').value) || 400;
    const ib = parseFloat(document.getElementById('q-ib').value) || 0;
    const l = parseFloat(document.getElementById('q-l').value) || 0;

    const cat = document.getElementById('q-cat').value;
    const mat = document.getElementById('q-mat').value;
    const sec = document.getElementById('q-sec').value;

    const resEl = document.getElementById('q-res');

    if (!ib || !l || !sec) {
        resEl.textContent = '-- %';
        return;
    }

    const paramElettrici = DB.parametri_elettrici[cat]?.[mat]?.[sec];
    if (!paramElettrici) {
        resEl.textContent = 'Err';
        return;
    }

    const R = paramElettrici.R;
    const X = paramElettrici.X;

    const cosphi = 0.9;
    const k = isTri ? Math.sqrt(3) : 2;
    const phi = Math.acos(cosphi);
    const sinphi = Math.sin(phi);

    const dvVolts = (k * l * ib * (R * cosphi + X * sinphi)) / 1000;
    const dvPerc = (dvVolts / v) * 100;

    resEl.textContent = dvPerc.toFixed(2) + ' %';
}

// ------ ARCHIVE & REPORT ------
function saveProject() {
    const name = document.getElementById('in-proj-name').value.trim();
    if (!name || !currentResult || currentResult.status !== 'OK') {
        alert("Inserisci un nome e assicurati che il calcolo sia valido.");
        return;
    }

    const proj = {
        id: Date.now(),
        name,
        date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString(),
        data: { ...currentResult }
    };

    let p = JSON.parse(localStorage.getItem('cs_archive') || '[]');
    p.unshift(proj);
    localStorage.setItem('cs_archive', JSON.stringify(p));

    document.getElementById('in-proj-name').value = '';
    document.getElementById('modal-save').classList.remove('open');
    loadArchive();
}

function loadArchive() {
    const list = document.getElementById('archive-list');
    if (!list) return;

    let p = JSON.parse(localStorage.getItem('cs_archive') || '[]');
    if (p.length === 0) {
        list.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--on-surface-variant)">Nessun progetto salvato.</div>`;
        return;
    }

    list.innerHTML = p.map(item => `
        <div class="archive-item">
            <div>
                <div class="archive-info-title">${item.name}</div>
                <div class="archive-info-sub">${item.date} | Sec: ${item.data.n > 1 ? item.data.n + 'x' + item.data.section : item.data.section} mm² | Iz: ${item.data.iz.toFixed(1)} A</div>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="icon-btn" style="color:var(--primary)" onclick="exportPDF(${item.id})"><i data-lucide="download"></i></button>
                <button class="icon-btn text-error" onclick="deleteProj(${item.id})"><i data-lucide="x"></i></button>
            </div>
        </div>
    `).join('');
    lucide.createIcons();
}

function deleteProj(id) {
    if (!confirm("Cancellare il progetto?")) return;
    let p = JSON.parse(localStorage.getItem('cs_archive') || '[]');
    p = p.filter(x => x.id !== id);
    localStorage.setItem('cs_archive', JSON.stringify(p));
    loadArchive();
}

function clearArchive() {
    if (!confirm("Svuotare intero archivio?")) return;
    localStorage.removeItem('cs_archive');
    loadArchive();
}

window.exportPDF = function (id) {
    if (!window.jspdf) return alert("Libreria PDF non caricata.");
    let p = JSON.parse(localStorage.getItem('cs_archive') || '[]');
    const proj = p.find(x => x.id === id);
    if (!proj) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFillColor(0, 91, 181);
    doc.rect(0, 0, 210, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text("Cable Sizer Pro V4", 20, 25);
    doc.setFontSize(10);
    doc.text("Report Calcolo", 20, 32);

    doc.setTextColor(30, 30, 30);
    doc.setFontSize(14);
    doc.text(`Progetto: ${proj.name}`, 20, 55);
    doc.setFontSize(10);
    doc.text(`Data: ${proj.date}`, 20, 62);

    let y = 80;
    const data = [
        ["Sezione Calcolata", proj.data.n > 1 ? `${proj.data.n} x ${proj.data.section} mm²` : proj.data.section + " mm²"],
        ["Corrente Ib", proj.data.ib.toFixed(2) + " A"],
        ["Portata Iz", proj.data.iz.toFixed(2) + " A"],
        ["Caduta Tensione", proj.data.dv.toFixed(2) + " %"],
    ];

    data.forEach(([l, v]) => {
        doc.setFontSize(11);
        doc.text(l, 20, y);
        doc.setFontSize(12);
        doc.text(v, 80, y);
        y += 10;
    });

    doc.save(`Report_${proj.name.replace(/\s+/g, '_')}.pdf`);
}
function loadExternalScripts() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js').catch(() => { });
    }
}
