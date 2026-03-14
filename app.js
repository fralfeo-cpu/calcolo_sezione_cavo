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

    // Dashboard / Navigation Routing
    document.querySelectorAll('.dash-card').forEach(card => {
        card.addEventListener('click', () => {
            const target = card.getAttribute('data-target');
            document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
            document.getElementById(target).classList.remove('hidden');

            if (target !== 'sec-archive' && target !== 'sec-fotovoltaico') {
                resetModule(target);
            }
            if (target === 'sec-archive') loadArchive();
        });
    });

    document.querySelectorAll('.btn-home').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-target'); // should be 'sec-home'
            document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
            document.getElementById(target).classList.remove('hidden');
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

                if (group.id === 'pill-tens') {
                    const isMT = pill.getAttribute('data-val') === 'mt_media_tensione';
                    const pillSysWrapper = document.getElementById('pill-sys');
                    const pillMono = pillSysWrapper.querySelector('[data-val="mono"]');
                    const pillTri = pillSysWrapper.querySelector('[data-val="tri"]');
                    const inV = document.getElementById('in-v');

                    if (isMT) {
                        pillMono.style.opacity = '0.5';
                        pillMono.style.pointerEvents = 'none';
                        pillMono.classList.remove('active');
                        pillTri.classList.add('active');
                        inV.value = 20000; // Default MT voltage
                    } else {
                        pillMono.style.opacity = '1';
                        pillMono.style.pointerEvents = 'auto';

                        // Set Auto Voltages for BT
                        const currentSys = pillSysWrapper.querySelector('.active').getAttribute('data-val');
                        if (currentSys === 'mono') inV.value = 230;
                        if (currentSys === 'tri') inV.value = 400;
                    }
                    updateLists();
                }

                if (group.id === 'pill-sys') {
                    const pillTensWrapper = document.getElementById('pill-tens');
                    const isMT = pillTensWrapper.querySelector('.active').getAttribute('data-val') === 'mt_media_tensione';
                    const inV = document.getElementById('in-v');
                    if (!isMT) {
                        const currentSys = pill.getAttribute('data-val');
                        if (currentSys === 'mono') inV.value = 230;
                        if (currentSys === 'tri') inV.value = 400;
                    }
                }

                if (group.id === 'pill-mat') {
                    updateLists();
                }

                validateForm('sec-calc');
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

    // Input listeners for main calculation
    const inputs = ['in-v', 'in-l', 'in-load', 'in-cosphi', 'in-dvmax', 'sel-iso', 'sel-posa', 'sel-temp', 'sel-group', 'sel-depth', 'sel-res', 'sel-n-cavi'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                if (id === 'sel-posa' || id === 'sel-iso') updateLists();
                validateForm('sec-calc');
            });
        }
    });

    // Checkbox auto parallel
    const apCheck = document.getElementById('ch-auto-parallel');
    if (apCheck) apCheck.addEventListener('change', () => validateForm('sec-calc'));

    // Calc buttons
    const btnCalc = document.getElementById('btn-calc');
    if (btnCalc) btnCalc.addEventListener('click', performCalculation);

    const btnCalcDv = document.getElementById('btn-calc-dv');
    if (btnCalcDv) btnCalcDv.addEventListener('click', calculateQuickDV);

    const btnCalcPv = document.getElementById('btn-calc-pv');
    if (btnCalcPv) btnCalcPv.addEventListener('click', () => {
        if (typeof calculatePV === 'function') calculatePV();
    });

    // PV Save button also opens the modal
    const btnSavePv = document.getElementById('btn-save-pv');
    if (btnSavePv) btnSavePv.addEventListener('click', showSaveModal);

    // Quick DV Check listeners
    const qInputs = ['q-sys', 'q-cat', 'q-v', 'q-ib', 'q-l', 'q-mat', 'q-sec'];
    qInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                if (id === 'q-cat' || id === 'q-mat') updateLists();
                validateForm('sec-dv');
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

function resetModule(targetId) {
    const section = document.getElementById(targetId);
    if (!section) return;

    // Reset numeric inputs
    section.querySelectorAll('input[type="number"], input[type="text"]').forEach(input => {
        if (input.id === 'in-cosphi') {
            input.value = "0.9";
        } else if (input.id === 'in-dvmax') {
            input.value = "4";
        } else if (input.id === 'in-v') {
            const isTri = document.querySelector('#pill-sys .active')?.getAttribute('data-val') === 'tri';
            const isMT = document.querySelector('#pill-tens .active')?.getAttribute('data-val') === 'mt_media_tensione';
            if (isMT) input.value = "20000";
            else input.value = isTri ? "400" : "230";
        } else {
            input.value = "";
        }
    });

    // Reset selects
    section.querySelectorAll('select').forEach(select => {
        // Special selects that shouldn't be reset to 0 index (placeholder) but to standard defaults
        if (select.id === 'sel-n-cavi') {
            select.value = "1";
        } else if (select.id === 'sel-iso') {
            select.selectedIndex = 0;
        } else {
            select.selectedIndex = 0; // The disabled placeholder
        }

        if (select.classList.contains('upgraded')) {
            // Need to update custom select wrapper UI text manually
            const wrapper = select.nextElementSibling;
            if (wrapper && wrapper.classList.contains('custom-select-wrapper')) {
                const triggerSpan = wrapper.querySelector('.custom-select-trigger span');
                const selectedText = select.options[select.selectedIndex]?.text || '';
                if (triggerSpan) triggerSpan.textContent = selectedText;

                // Clear selection states in custom dropdown list
                wrapper.querySelectorAll('.custom-option').forEach(o => {
                    o.classList.remove('selected');
                    if (o.textContent === selectedText) o.classList.add('selected');
                });
            }
        }
    });

    // Reset checkboxes
    section.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
    });

    // Reset specific UI states
    if (targetId === 'sec-calc') {
        document.getElementById('res-data').classList.add('hidden');
        document.getElementById('res-placeholder').classList.remove('hidden');
        const card = document.getElementById('main-result-card');
        if (card) card.classList.remove('ok', 'error');
        const warningEl = document.getElementById('res-warning');
        if (warningEl) warningEl.classList.add('hidden');
        document.getElementById('btn-calc').disabled = true;
    } else if (targetId === 'sec-dv') {
        document.getElementById('q-res').textContent = '-- %';
        document.getElementById('q-res').style.color = 'var(--primary)';
        document.getElementById('btn-calc-dv').disabled = true;
    } else if (targetId === 'sec-fotovoltaico') {
        document.getElementById('pv-res-data').classList.add('hidden');
        document.getElementById('pv-res-placeholder').classList.remove('hidden');
        const card = document.getElementById('pv-result-card');
        if (card) card.classList.remove('ok', 'error');
        const warningEl = document.getElementById('pv-res-warning');
        if (warningEl) warningEl.classList.add('hidden');
        document.getElementById('btn-calc-pv').disabled = true;
    }
}

function validateForm(targetId) {
    let isValid = true;
    const section = document.getElementById(targetId);
    if (!section) return;

    if (targetId === 'sec-calc') {
        const reqIds = ['in-v', 'in-l', 'in-load', 'in-dvmax', 'sel-iso', 'sel-posa', 'sel-n-cavi'];
        // if input type is P, cosphi is needed
        const inputType = document.querySelector('#pill-input-type .active')?.getAttribute('data-val');
        if (inputType === 'p') reqIds.push('in-cosphi');

        reqIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.value === "" || el.value === null) isValid = false;
        });

        // K factors select check if visible
        const env = document.getElementById('sel-posa')?.value?.includes('interrato') ? 'terreno' : 'aria';
        if (env === 'terreno') {
            ['sel-temp', 'sel-group', 'sel-depth', 'sel-res'].forEach(id => {
                const el = document.getElementById(id);
                if (!el || el.value === "") isValid = false;
            });
        } else {
            ['sel-temp', 'sel-group'].forEach(id => {
                const el = document.getElementById(id);
                if (!el || el.value === "") isValid = false;
            });
        }

        const btnCalc = document.getElementById('btn-calc');
        if (btnCalc) btnCalc.disabled = !isValid;

    } else if (targetId === 'sec-dv') {
        const reqIds = ['q-v', 'q-ib', 'q-l', 'q-cat', 'q-mat', 'q-sec'];
        reqIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.value === "" || el.value === null || el.value === "Seleziona...") isValid = false;
        });

        const btnCalcDv = document.getElementById('btn-calc-dv');
        if (btnCalcDv) btnCalcDv.disabled = !isValid;
    } else if (targetId === 'sec-fotovoltaico') {
        const pvInputs = ['in-pv-vmaxdc', 'in-pv-imax', 'in-pv-mpptmin', 'in-pv-mpptmax', 'in-pv-wp', 'in-pv-beta', 'in-pv-voc', 'in-pv-isc', 'in-pv-vmp', 'in-pv-tmin', 'in-pv-tmax'];
        pvInputs.forEach(id => {
            const el = document.getElementById(id);
            if (!el || el.value === "" || el.value === null) isValid = false;
        });

        const btnCalcPv = document.getElementById('btn-calc-pv');
        if (btnCalcPv) btnCalcPv.disabled = !isValid;
    }
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
    if (qCat && qMat && DB.parametri_elettrici[qCat] && DB.parametri_elettrici[qCat][qMat]) {
        const currentSec = qSecSelect.value;
        const sections = Object.keys(DB.parametri_elettrici[qCat][qMat]).sort((a, b) => parseFloat(a) - parseFloat(b));
        qSecSelect.innerHTML = `<option value="" disabled>Seleziona...</option>` + sections.map(s => `<option value="${s}" ${s === currentSec ? 'selected' : ''}>${s} mm²</option>`).join('');
    } else {
        qSecSelect.innerHTML = `<option value="" disabled selected>Seleziona...</option>`;
    }

    upgradeSelects();
}

function upgradeSelects() {
    document.querySelectorAll('.custom-select-wrapper').forEach(w => w.remove());
    document.querySelectorAll('select.m3-select').forEach(s => s.classList.remove('upgraded'));

    // ALWAYS use native dropdowns on mobile to prevent scrolling/touch issues 
    const isMobile = window.matchMedia("(max-width: 768px)").matches || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (isMobile) {
        document.querySelectorAll('select.m3-select').forEach(s => {
            s.style.display = 'block'; // Ensure native select is visible
            s.style.appearance = 'auto'; // Re-enable drop arrow styling
            // Ensure inputs bubble changes correctly
            s.addEventListener('change', () => s.dispatchEvent(new Event('input', { bubbles: true })));
        });
        return;
    }

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
        let finalKF = null;

        const autoParallelEl = document.getElementById('ch-auto-parallel');
        const isAutoParallel = autoParallelEl && autoParallelEl.checked;
        const baseN = parseInt(document.getElementById('sel-n-cavi')?.value) || 1;
        const maxN = isAutoParallel ? 20 : baseN;

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
                        finalKF = kF;
                        break;
                    }
                }
            }
            if (validSection) break;
        }

        if (validSection) {
            currentResult = {
                type: 'cable',
                section: validSection,
                n: finalN,
                ib: ib,
                iz: finalIz,
                dv: finalDv,
                kFactors: {
                    k1: finalKF.k1,
                    k2: finalKF.k2,
                    k3: finalKF.k3,
                    k4: finalKF.k4,
                    ktot: finalKF.k1 * finalKF.k2 * finalKF.k3 * finalKF.k4
                },
                inputs: {
                    v, l, cosphi, isTri
                },
                status: 'OK'
            };
            setUISuccess(currentResult);
        } else {
            const statusLabel = (isAutoParallel && maxN === 20) ? 'OUT_OF_SCALE' : 'NOT_FOUND';
            currentResult = { ib, iz: 0, dv: 0, status: statusLabel, section: '-' };
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

    const warningEl = document.getElementById('res-warning');
    if (warningEl) {
        if (r.n > 10) {
            warningEl.textContent = `Attenzione: La potenza richiesta richiede un numero elevato di conduttori in parallelo (${r.n}). Valutare l'aumento della Tensione di esercizio o l'uso di sbarre.`;
            warningEl.classList.remove('hidden');
        } else {
            warningEl.classList.add('hidden');
        }
    }

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

    const warningEl = document.getElementById('res-warning');
    if (warningEl) warningEl.classList.add('hidden');

    document.getElementById('res-sec').textContent = `-- mm²`;
    document.getElementById('res-ib').textContent = currentResult.ib.toFixed(2) + ' A';
    document.getElementById('res-iz').textContent = '-- A';
    document.getElementById('res-dv').textContent = '> Max';

    const st = document.getElementById('res-status');
    if (currentResult.status === 'OUT_OF_SCALE') {
        st.textContent = "POTENZA FUORI SCALA";
    } else {
        st.textContent = "FUORI LIMITE";
    }
    st.style.color = "var(--error)";
}

function setUIError() {
    document.getElementById('res-data').classList.add('hidden');
    document.getElementById('res-placeholder').classList.remove('hidden');
    const card = document.getElementById('main-result-card');
    card.classList.remove('ok', 'error');

    const warningEl = document.getElementById('res-warning');
    if (warningEl) warningEl.classList.add('hidden');
}

function calculatePV() {
    try {
        const vmaxdc = parseFloat(document.getElementById('in-pv-vmaxdc')?.value);
        const imax = parseFloat(document.getElementById('in-pv-imax')?.value);
        const mpptmin = parseFloat(document.getElementById('in-pv-mpptmin')?.value);
        const mpptmax = parseFloat(document.getElementById('in-pv-mpptmax')?.value);
        const wp = parseFloat(document.getElementById('in-pv-wp')?.value);
        const beta = parseFloat(document.getElementById('in-pv-beta')?.value);
        const voc = parseFloat(document.getElementById('in-pv-voc')?.value);
        const isc = parseFloat(document.getElementById('in-pv-isc')?.value);
        const vmp = parseFloat(document.getElementById('in-pv-vmp')?.value);
        const tmin = parseFloat(document.getElementById('in-pv-tmin')?.value);
        const tmax = parseFloat(document.getElementById('in-pv-tmax')?.value);

        if ([vmaxdc, imax, mpptmin, mpptmax, wp, beta, voc, isc, vmp, tmin, tmax].some(isNaN)) return;

        const TSTC = 25;
        // Temperature corrections
        const voc_tmin = voc * (1 + (beta / 100) * (tmin - TSTC));
        const voc_tmax = voc * (1 + (beta / 100) * (tmax - TSTC));
        const vmp_tmax = vmp * (1 + (beta / 100) * (tmax - TSTC));

        // Nmax by Vmaxdc and Voc at Tmin
        const nmax_vmaxdc = Math.floor(vmaxdc / voc_tmin);
        // Nmax by MPPT max and Vmp at Tmax
        const nmax_mppt = Math.floor(mpptmax / vmp_tmax);
        const nmax = Math.min(nmax_vmaxdc, nmax_mppt);

        // Nmin by MPPT min and Vmp at Tmax
        const nmin = Math.ceil(mpptmin / vmp_tmax);

        const iscWarning = isc > imax;

        currentResult = {
            type: 'pv',
            status: nmax >= nmin ? 'OK' : 'NOT_FOUND',
            nmin, nmax, voc_tmin, voc_tmax, vmp_tmax,
            iscw: iscWarning,
            inputs: { vmaxdc, imax, mpptmin, mpptmax, wp, beta, voc, isc, vmp, tmin, tmax }
        };

        const resData = document.getElementById('pv-res-data');
        const placeholder = document.getElementById('pv-res-placeholder');
        const card = document.getElementById('pv-result-card');
        const warning = document.getElementById('pv-res-warning');

        if (!resData || !placeholder || !card) return;

        placeholder.classList.add('hidden');
        resData.classList.remove('hidden');
        card.classList.remove('ok', 'error');
        card.classList.add(nmax >= nmin ? 'ok' : 'error');

        if (warning) {
            if (iscWarning) {
                warning.textContent = 'Attenzione: Isc pannello (' + isc + ' A) supera Imax MPPT inverter (' + imax + ' A)!';
                warning.classList.remove('hidden');
            } else {
                warning.classList.add('hidden');
            }
        }

        const nminEl = document.getElementById('pv-res-nmin');
        const nmaxEl = document.getElementById('pv-res-nmax');
        const vocMinEl = document.getElementById('pv-res-voc-tmin');
        const vmpMaxEl = document.getElementById('pv-res-vmp-tmax');
        const statusEl = document.getElementById('pv-res-status');

        if (nminEl) nminEl.textContent = nmin;
        if (nmaxEl) nmaxEl.textContent = nmax;
        if (vocMinEl) vocMinEl.textContent = voc_tmin.toFixed(2) + ' V';
        if (vmpMaxEl) vmpMaxEl.textContent = vmp_tmax.toFixed(2) + ' V';
        if (statusEl) {
            statusEl.textContent = nmax >= nmin ? 'VERIFICATO' : 'RANGE INVALIDO';
            statusEl.style.color = nmax >= nmin ? 'var(--success)' : 'var(--error)';
        }
    } catch (e) {
        console.error('Calc PV error:', e);
    }
}

function calculateQuickDV() {
    const sys = document.getElementById('q-sys').value;
    const isTri = sys === 'tri';
    const v = parseFloat(document.getElementById('q-v').value);
    const ib = parseFloat(document.getElementById('q-ib').value);
    const l = parseFloat(document.getElementById('q-l').value);

    const cat = document.getElementById('q-cat').value;
    const mat = document.getElementById('q-mat').value;
    const sec = document.getElementById('q-sec').value;

    const resEl = document.getElementById('q-res');

    if (!ib || !l || !sec || !v || !cat || !mat) {
        resEl.textContent = '-- %';
        resEl.style.color = "var(--primary)";
        return;
    }

    const paramElettrici = DB.parametri_elettrici[cat]?.[mat]?.[sec];
    if (!paramElettrici) {
        resEl.textContent = 'Err. DB';
        resEl.style.color = "var(--error)";
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
    resEl.style.color = dvPerc > 4 ? "var(--error)" : "var(--success)";
}

// ------ TOAST NOTIFICATION ------
function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i data-lucide="check-circle" style="color: var(--success)"></i> ${message}`;
    container.appendChild(toast);
    lucide.createIcons();

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ------ ARCHIVE & REPORT ------
function showSaveModal() {
    document.getElementById('modal-save').classList.add('open');
}


function saveProject() {
    const name = document.getElementById('in-proj-name').value.trim();
    if (!name || !currentResult || currentResult.status !== 'OK') {
        alert("Inserisci un nome e assicurati che il calcolo sia valido.");
        return;
    }

    try {
        // Save full UI state along with results
        const uiState = {};
        const selects = ['sel-iso', 'sel-posa', 'sel-temp', 'sel-group', 'sel-depth', 'sel-res', 'sel-n-cavi'];
        const inputIds = ['in-v', 'in-l', 'in-load', 'in-cosphi', 'in-dvmax'];
        const pills = ['pill-sys', 'pill-input-type', 'pill-tens', 'pill-mat'];

        selects.forEach(id => {
            const el = document.getElementById(id);
            if (el) uiState[id] = el.value;
        });
        inputIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) uiState[id] = el.value;
        });
        pills.forEach(id => {
            const el = document.querySelector(`#${id} .active`);
            if (el) uiState[id] = el.getAttribute('data-val');
        });

        const isAutoParallel = document.getElementById('ch-auto-parallel')?.checked || false;
        uiState['ch-auto-parallel'] = isAutoParallel;

        // Serialize only plain scalars from currentResult to avoid circular refs
        const safeData = {
            type: currentResult.type,
            status: currentResult.status,
            section: currentResult.section,
            n: currentResult.n,
            ib: currentResult.ib,
            iz: currentResult.iz,
            dv: currentResult.dv,
            kFactors: currentResult.kFactors ? {
                k1: currentResult.kFactors.k1,
                k2: currentResult.kFactors.k2,
                k3: currentResult.kFactors.k3,
                k4: currentResult.kFactors.k4,
                ktot: currentResult.kFactors.ktot
            } : null,
            inputs: currentResult.inputs ? {
                v: currentResult.inputs.v,
                l: currentResult.inputs.l,
                cosphi: currentResult.inputs.cosphi,
                isTri: currentResult.inputs.isTri,
                posa: uiState['sel-posa'],
                mat: uiState['pill-mat'],
                iso: uiState['sel-iso']
            } : null
        };

        const proj = {
            id: Date.now(),
            name,
            date: new Date().toLocaleDateString('it-IT') + ' ' + new Date().toLocaleTimeString('it-IT'),
            data: safeData,
            uiState: uiState
        };

        let p = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
        p.unshift(proj);
        localStorage.setItem('archivio_elettrosuite', JSON.stringify(p));

        document.getElementById('in-proj-name').value = '';
        document.getElementById('modal-save').classList.remove('open');
        showToast("Progetto salvato con successo nell'archivio");
        loadArchive();
    } catch (err) {
        console.error('Errore salvataggio:', err);
        document.getElementById('modal-save').classList.remove('open');
        showToast('Errore durante il salvataggio: ' + err.message);
    }
}

function loadArchive() {
    const list = document.getElementById('archive-list');
    if (!list) return;

    let p = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
    if (p.length === 0) {
        list.innerHTML = `<div style="padding:2rem; text-align:center; color:var(--on-surface-variant)">Nessun progetto salvato.</div>`;
        return;
    }

    list.innerHTML = p.map(item => {
        if (item.data.type === 'pv') {
            return `
            <div class="archive-item">
                <div>
                    <div class="archive-info-title"><i data-lucide="sun" style="width: 14px; height: 14px; margin-right: 4px; display: inline-block;"></i>${item.name}</div>
                    <div class="archive-info-sub">${item.date} | PV String Range: ${item.data.nmin} - ${item.data.nmax} Moduli</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="icon-btn" style="color:var(--primary)" onclick="exportPDF(${item.id})" title="Esporta PDF"><i data-lucide="download"></i></button>
                    <button class="icon-btn text-error" onclick="deleteProj(${item.id})" title="Elimina"><i data-lucide="x"></i></button>
                </div>
            </div>
            `;
        } else {
            return `
            <div class="archive-item">
                <div>
                    <div class="archive-info-title"><i data-lucide="calculator" style="width: 14px; height: 14px; margin-right: 4px; display: inline-block;"></i>${item.name}</div>
                    <div class="archive-info-sub">${item.date} | Sec: ${item.data.n > 1 ? item.data.n + 'x' + item.data.section : item.data.section} mm² | Iz: ${item.data.iz.toFixed(1)} A</div>
                </div>
                <div style="display:flex; gap:8px;">
                    <button class="icon-btn" style="color:var(--success)" onclick="restoreProject(${item.id})" title="Ripristina nel Calcolatore"><i data-lucide="refresh-cw"></i></button>
                    <button class="icon-btn" style="color:var(--primary)" onclick="exportPDF(${item.id})" title="Esporta PDF"><i data-lucide="download"></i></button>
                    <button class="icon-btn text-error" onclick="deleteProj(${item.id})" title="Elimina"><i data-lucide="x"></i></button>
                </div>
            </div>
            `;
        }
    }).join('');
    lucide.createIcons();
}

function restoreProject(id) {
    let p = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
    const proj = p.find(x => x.id === id);
    if (!proj || proj.data.type === 'pv') return; // For now only restore cable calc

    // Switch to calc tab
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById('sec-calc').classList.remove('hidden');

    const ui = proj.uiState;
    if (!ui) {
        alert("Progetto vecchio, dati di ripristino non disponibili.");
        return;
    }

    // Set Pills Phase 1
    ['pill-sys', 'pill-input-type', 'pill-tens', 'pill-mat'].forEach(pillId => {
        if (ui[pillId]) {
            const group = document.getElementById(pillId);
            group.querySelectorAll('.pill').forEach(btn => btn.classList.remove('active'));
            const targetBtn = group.querySelector(`[data-val="${ui[pillId]}"]`);
            if (targetBtn) targetBtn.classList.add('active');
        }
    });

    // Update Lists Phase 2 (so that selects populate correctly)
    updateLists();

    // Set Inputs Phase 3
    Object.keys(ui).forEach(key => {
        const el = document.getElementById(key);
        if (el && el.tagName === 'INPUT' && el.type !== 'checkbox') {
            el.value = ui[key];
        } else if (el && el.tagName === 'SELECT') {
            el.value = ui[key];
        } else if (key === 'ch-auto-parallel') {
            const check = document.getElementById('ch-auto-parallel');
            if (check) check.checked = ui[key];
        }
    });

    // Fire validation and calculate
    validateForm('sec-calc');
    performCalculation();
    showToast("Progetto ripristinato con successo");
}

function deleteProj(id) {
    if (!confirm("Cancellare il progetto?")) return;
    let p = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
    p = p.filter(x => x.id !== id);
    localStorage.setItem('archivio_elettrosuite', JSON.stringify(p));
    loadArchive();
}

function clearArchive() {
    if (!confirm("Svuotare intero archivio?")) return;
    localStorage.removeItem('archivio_elettrosuite');
    // Also remove the old archive if it exists
    localStorage.removeItem('cs_archive');
    loadArchive();
}

window.exportPDF = function (id) {
    if (!window.jspdf || !window.jspdf.jsPDF) return alert("Libreria jsPDF non caricata.");
    let p = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
    const proj = p.find(x => x.id === id);
    if (!proj) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // -- Header --
    doc.setFillColor(15, 76, 129); // Corporate Blue: #0F4C81
    doc.rect(0, 0, 210, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("Report di Calcolo Elettrico - ElectroSuite v2.0", 15, 22);

    // -- Data/Time --
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Generato il: ${proj.date}`, 15, 45);
    doc.setFont("helvetica", "bold");
    doc.text(`Progetto: ${proj.name}`, 15, 52);

    let startY = 60;

    if (proj.data.type === 'pv') {
        const d = proj.data;
        // PV Layout
        doc.autoTable({
            startY: startY,
            head: [['Parametro', 'Valore', 'Unità']],
            body: [
                ['V max DC (Inverter)', d.inputs.vmaxdc, 'V'],
                ['Range MPPT (Inverter)', `${d.inputs.mpptmin} - ${d.inputs.mpptmax}`, 'V'],
                ['I max MPPT (Inverter)', d.inputs.imax, 'A'],
                ['Tensioni Pannello', `Voc = ${d.inputs.voc} V, Vmp = ${d.inputs.vmp} V`, '-'],
                ['Corrente Pannello (Isc)', d.inputs.isc, 'A'],
                ['Potenza Modulo', d.inputs.wp, 'Wp'],
                ['Estrapolazione Termica', `Tmin: ${d.inputs.tmin}°C, Tmax: ${d.inputs.tmax}°C`, '-']
            ],
            theme: 'striped',
            headStyles: { fillColor: [15, 76, 129] },
            margin: { left: 15, right: 15 }
        });

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Esito Calcolo', 'Valore']],
            body: [
                ['Configurazione Ottimale', `Da ${d.nmin} a ${d.nmax} moduli per stringa`],
                ['Voc al Freddo (Tmin)', d.voc_tmin.toFixed(2) + ' V'],
                ['Vmp al Caldo (Tmax)', d.vmp_tmax.toFixed(2) + ' V'],
                ['Tensione Stringa Max', (d.nmax * d.voc_tmin).toFixed(2) + ' V']
            ],
            theme: 'grid',
            headStyles: { fillColor: [25, 129, 85] }, // Success green header
            margin: { left: 15, right: 15 }
        });

        if (d.iscw) {
            doc.setTextColor(230, 126, 34);
            doc.setFont("helvetica", "bold");
            doc.text("ATTENZIONE: La corrente Isc del pannello supera la Imax MPPT.", 15, doc.lastAutoTable.finalY + 10);
        }

    } else {
        const d = proj.data;

        // Tabella 1: Dati di Sistema
        const sysLabel = d.inputs && d.inputs.isTri ? 'Trifase' : 'Monofase';
        doc.autoTable({
            startY: startY,
            head: [['Parametro', 'Valore', 'Unita']],
            body: [
                ['Architettura del sistema', sysLabel, '-'],
                ['Tensione di Esercizio', d.inputs ? d.inputs.v : '--', 'V'],
                ['Lunghezza Tratta', d.inputs ? d.inputs.l : '--', 'm'],
                ['Fattore di Potenza cos(phi)', d.inputs ? d.inputs.cosphi : '--', '-']
            ],
            theme: 'striped',
            headStyles: { fillColor: [15, 76, 129] },
            margin: { left: 15, right: 15 }
        });

        // Tabella 2: Posa
        const posaVal = d.inputs ? d.inputs.posa : '';
        let posaDesc = POSA_LABELS[posaVal] || posaVal || '--';
        let matDesc = d.inputs && d.inputs.mat === 'rame' ? 'Rame' : 'Alluminio';
        let isoDesc = d.inputs && d.inputs.iso === 'pvc_70C' ? 'PVC (70 gradi C)' : 'EPR / XLPE (90 gradi C)';

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Dettaglio Costruttivo', 'Specifica']],
            body: [
                ['Metodo di Posa', posaDesc],
                ['Materiale Conduttore', matDesc],
                ['Materiale Isolante', isoDesc]
            ],
            theme: 'striped',
            headStyles: { fillColor: [15, 76, 129] },
            margin: { left: 15, right: 15 }
        });

        // Tabella 3: Fattori K — dinamica per tipo posa
        const isInterrata = posaVal && posaVal.includes('interrato');
        const kArr = [];
        if (d.kFactors) {
            // Retrieve condition labels from saved uiState (if available) for context
            const tempCond = proj.uiState ? (proj.uiState['sel-temp'] + ' gradi C') : '--';
            const groupCond = proj.uiState ? ('Gruppo ' + proj.uiState['sel-group']) : '--';

            kArr.push(['K1 (Temperatura)', tempCond, typeof d.kFactors.k1 === 'number' ? d.kFactors.k1.toFixed(3) : '--']);
            kArr.push(['K2 (Raggruppamento)', groupCond, typeof d.kFactors.k2 === 'number' ? d.kFactors.k2.toFixed(3) : '--']);

            if (isInterrata) {
                const depthCond = proj.uiState ? (proj.uiState['sel-depth'] + ' m') : '--';
                const resCond = proj.uiState ? (proj.uiState['sel-res'] + ' Ohm*m') : '--';
                kArr.push(['K3 (Profondita)', depthCond, typeof d.kFactors.k3 === 'number' ? d.kFactors.k3.toFixed(3) : '--']);
                kArr.push(['K4 (Resistivita Terreno)', resCond, typeof d.kFactors.k4 === 'number' ? d.kFactors.k4.toFixed(3) : '--']);
            }

            kArr.push([{ content: 'Coefficiente Globale Ktot', colSpan: 2, styles: { fontStyle: 'bold' } }, { content: typeof d.kFactors.ktot === 'number' ? d.kFactors.ktot.toFixed(3) : '--', styles: { fontStyle: 'bold' } }]);
        } else {
            kArr.push(['K Globale', 'Fattori Standard', '1.000']);
        }

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Fattore', 'Condizione Applicata', 'Valore']],
            body: kArr,
            theme: 'striped',
            headStyles: { fillColor: [15, 76, 129] },
            margin: { left: 15, right: 15 }
        });

        // Tabella 4: Risultati finali
        const sezioneStr = (d.n && d.n > 1) ? (d.n + ' x ' + d.section + ' mm2') : (d.section + ' mm2');
        const resArr = [
            ['Corrente di Impiego (Ib)', typeof d.ib === 'number' ? d.ib.toFixed(2) + ' A' : '--'],
            ['Portata Corretta (Iz)', typeof d.iz === 'number' ? d.iz.toFixed(2) + ' A' : '--'],
            ['Caduta di Tensione (Delta V)', typeof d.dv === 'number' ? d.dv.toFixed(2) + ' %' : '--'],
            ['Sezione Commerciale Adottata', sezioneStr]
        ];

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Esito Calcolo e Verifiche', 'Valore']],
            body: resArr,
            theme: 'grid',
            headStyles: { fillColor: [10, 50, 85] },
            margin: { left: 15, right: 15 }
        });
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "normal");
    doc.text("Generato da ElectroSuite v2.0 - Motore Autotable", 105, 285, null, null, "center");

    doc.save(`ElectroSuite_${proj.name.replace(/\s+/g, '_')}.pdf`);
}
function loadExternalScripts() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js').catch(() => { });
    }
}
