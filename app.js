const DB = DB_DATA.database_cavi_master;
let currentResult = null;
let idProgettoAttivo = null; // null = nuovo progetto, altrimenti id da aggiornare

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

/**
 * Shows a brief spinner on a button, then executes the callback.
 * Gives immediate visual feedback even for instant calculations.
 */
function withLoading(btn, fn) {
    if (!btn) { fn(); return; }
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<div class="btn-spinner"></div> Calcolo...';
    btn.disabled = true;
    // Use a short delay so the spinner actually renders before the sync calc runs
    setTimeout(() => {
        try { fn(); } catch (e) { console.error(e); }
        btn.innerHTML = originalHTML;
        // Re-enable happens via validateForm, but ensure it removes disabled visually
        btn.disabled = false;
        // Re-initialize lucide icons inside the button if needed
        if (window.lucide) lucide.createIcons();
    }, 280);
}

const sezioniCommerciali = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];

function populateQuickCheckSections() {
    const qSecSelect = document.getElementById('q-sec');
    if (!qSecSelect) return;
    const currentVal = qSecSelect.value;
    qSecSelect.innerHTML = '<option value="" disabled selected>Seleziona...</option>';
    sezioniCommerciali.forEach(sec => {
        const option = document.createElement('option');
        option.value = sec;
        option.textContent = `${sec} mm²`;
        if (currentVal == sec) option.selected = true;
        qSecSelect.appendChild(option);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    populateQuickCheckSections();
    initUI();
    initPresets();
    updateLists();
    performCalculation();
    loadExternalScripts();
});

function initUI() {
    // Keep the top-bar spacer in sync with the actual bar height (handles mobile resize/rotation)
    const topBar = document.querySelector('.top-bar');
    const spacer = document.getElementById('top-bar-spacer');
    if (topBar && spacer) {
        const syncSpacer = () => { spacer.style.height = topBar.offsetHeight + 'px'; };
        syncSpacer();
        new ResizeObserver(syncSpacer).observe(topBar);
    }

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

    // ── History-API Navigation ──────────────────────────────────────
    // Push a state whenever we navigate, so Android/iOS back button
    // returns to the previous section instead of closing the app.

    function navigateTo(targetId, addToHistory = true) {
        document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
        const section = document.getElementById(targetId);
        if (section) section.classList.remove('hidden');

        // Always scroll to top when changing section
        window.scrollTo({ top: 0, behavior: 'instant' });

        if (addToHistory) {
            history.pushState({ section: targetId }, '', '#' + targetId);
        }

        if (targetId === 'sec-archive') loadArchive();
        else if (targetId !== 'sec-fotovoltaico') resetModule(targetId);
    }

    // Handle hardware/browser back button ──────────────────────────
    window.addEventListener('popstate', (e) => {
        const targetId = e.state?.section || 'sec-home';
        navigateTo(targetId, false); // don't re-push the state
    });

    // Set initial history entry so first back-press goes to home, not exits
    history.replaceState({ section: 'sec-home' }, '', '#sec-home');

    // Dashboard card clicks ────────────────────────────────────────
    document.querySelectorAll('.dash-card').forEach(card => {
        card.addEventListener('click', () => {
            navigateTo(card.getAttribute('data-target'));
        });
    });

    // "← Home" back buttons ────────────────────────────────────────
    document.querySelectorAll('.btn-home').forEach(btn => {
        btn.addEventListener('click', () => {
            // Use native history.back() so the pushState stack unwinds cleanly
            history.back();
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
                    // Show the kW/kVA selector only when input type is "Potenza"
                    const selUnit = document.getElementById('sel-unit-potenza');
                    if (selUnit) selUnit.style.display = isP ? '' : 'none';
                    // Show cos phi only when input type is Potenza AND unit is kW
                    const unitIsKva = selUnit && selUnit.value === 'kva';
                    document.getElementById('wrap-cosphi').style.display = (isP && !unitIsKva) ? 'block' : 'none';
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
                        
                        const cardProt = document.getElementById('card-prot');
                        if (cardProt) cardProt.style.display = 'none';
                        
                        // Obbligo isolamento in Media Tensione
                        const selIso = document.getElementById('sel-iso');
                        if (selIso) {
                            selIso.value = 'epr_xlpe_90C';
                            selIso.disabled = true;
                        }
                    } else {
                        pillMono.style.opacity = '1';
                        pillMono.style.pointerEvents = 'auto';

                        const cardProt = document.getElementById('card-prot');
                        if (cardProt) cardProt.style.display = 'block';

                        // Sblocca isolamento in Bassa Tensione
                        const selIso = document.getElementById('sel-iso');
                        if (selIso) selIso.disabled = false;

                        // Set Auto Voltages for BT
                        const currentSys = pillSysWrapper.querySelector('.active').getAttribute('data-val');
                        if (currentSys === 'mono') inV.value = 230;
                        if (currentSys === 'tri') inV.value = 400;
                    }
                    updateLists();
                    if (typeof validateForm === 'function') validateForm('sec-calc');
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

    // Unit Potenza selector (kW / kVA): toggle cos-phi visibility
    const selUnitPotenza = document.getElementById('sel-unit-potenza');
    if (selUnitPotenza) {
        selUnitPotenza.addEventListener('change', () => {
            const inputType = document.querySelector('#pill-input-type .active')?.getAttribute('data-val');
            const isKva = selUnitPotenza.value === 'kva';
            // cos phi not needed for apparent power (kVA already includes it)
            if (inputType === 'p') {
                document.getElementById('wrap-cosphi').style.display = isKva ? 'none' : 'block';
            }
            validateForm('sec-calc');
        });
    }

    // Checkbox auto parallel
    const apCheck = document.getElementById('ch-auto-parallel');
    if (apCheck) apCheck.addEventListener('change', () => validateForm('sec-calc'));

    // Calc buttons – with loading spinner feedback
    const btnCalc = document.getElementById('btn-calc');
    if (btnCalc) btnCalc.addEventListener('click', () => withLoading(btnCalc, performCalculation));

    const btnCalcDv = document.getElementById('btn-calc-dv');
    if (btnCalcDv) btnCalcDv.addEventListener('click', () => withLoading(btnCalcDv, calculateQuickDV));

    const btnCalcPv = document.getElementById('btn-calc-pv');
    if (btnCalcPv) btnCalcPv.addEventListener('click', () => {
        withLoading(btnCalcPv, () => { if (typeof calculatePV === 'function') calculatePV(); });
    });

    // PV Inputs listeners to enable "Calcola Impianto" button
    const pvInputIds = ['in-pv-vmaxdc', 'in-pv-nmppt', 'in-pv-imax', 'in-pv-mpptmin', 'in-pv-mpptmax', 'in-pv-pmaxcc', 'in-pv-pac', 'in-pv-wp', 'in-pv-beta', 'in-pv-voc', 'in-pv-isc', 'in-pv-vmp', 'in-pv-ntot', 'in-pv-lcavo', 'in-pv-tmin', 'in-pv-tmax', 'in-pv-gamma'];
    pvInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => validateForm('sec-fotovoltaico'));
    });

    // Archive Tabs Logic
    const archiveTabs = document.querySelectorAll('.archive-tab');
    const archiveContents = document.querySelectorAll('.archive-tab-content');
    archiveTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            archiveTabs.forEach(t => t.classList.remove('active'));
            archiveContents.forEach(c => c.classList.add('hidden'));
            
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab');
            document.getElementById(targetId)?.classList.remove('hidden');
        });
    });

    // Unified Save Request Handler
    const handleSaveRequest = () => {
        if (idProgettoAttivo !== null) {
            saveProject(true); // Update mode
        } else {
            document.getElementById('modal-save').classList.add('open'); // Insert mode
        }
    };
    // Preset dropdown listeners
    document.getElementById('sel-preset-inverter')?.addEventListener('change', (e) => loadPreset('inverter', e.target.value));
    document.getElementById('sel-preset-pannello')?.addEventListener('change', (e) => loadPreset('pannello', e.target.value));

    const btnSavePv = document.getElementById('btn-save-pv');
    if (btnSavePv) btnSavePv.addEventListener('click', handleSaveRequest);
    document.getElementById('btn-save')?.addEventListener('click', handleSaveRequest);
    document.getElementById('btn-modal-cancel').addEventListener('click', () => {
        document.getElementById('modal-save').classList.remove('open');
    });
    document.getElementById('btn-modal-confirm').addEventListener('click', saveProject);
    document.getElementById('btn-clear-archive')?.addEventListener('click', clearArchive);

    // Preset Buttons Listeners
    document.getElementById('btn-save-preset-inv')?.addEventListener('click', salvaPresetInverter);
    document.getElementById('btn-del-preset-inv')?.addEventListener('click', () => deletePreset('inverter'));
    document.getElementById('btn-save-preset-pan')?.addEventListener('click', salvaPresetPannello);
    document.getElementById('btn-del-preset-pan')?.addEventListener('click', () => deletePreset('pannello'));

    // Close any open select wrapper if clicked outside
    window.addEventListener('click', () => {
        document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
    });

    // JSON Import/Export listeners (Archive)
    document.querySelectorAll('.btn-export-json').forEach(btn => {
        btn.addEventListener('click', (e) => exportArchivioJSON(e.target.dataset.type));
    });
    document.querySelectorAll('.input-import-json').forEach(input => {
        input.addEventListener('change', (e) => importArchivioJSON(e.target.dataset.type, e.target));
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
        // Reset active project state so next save is treated as new insert
        if (typeof resetActiveProject === 'function') resetActiveProject();
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
        // Reset active project state so next save is treated as new insert
        const btnSavePv = document.getElementById('btn-save-pv');
        if (btnSavePv) btnSavePv.title = 'Salva Progetto PV';
        if (typeof resetActiveProject === 'function') resetActiveProject();
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
        // gamma (in-pv-gamma) is optional, not in required list
        const pvRequired = ['in-pv-vmaxdc', 'in-pv-nmppt', 'in-pv-imax', 'in-pv-mpptmin', 'in-pv-mpptmax', 'in-pv-pmaxcc', 'in-pv-wp', 'in-pv-beta', 'in-pv-voc', 'in-pv-isc', 'in-pv-vmp', 'in-pv-ntot', 'in-pv-lcavo', 'in-pv-tmin', 'in-pv-tmax'];
        pvRequired.forEach(id => {
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
    const k1Key = env === 'terreno' ? 'k1_temperatura_terreno' : 'k1_temperatura_aria';
    const activeIso = (tens === 'mt_media_tensione') ? 'epr_xlpe_90C' : iso;
    const temps = Object.keys(kData[k1Key][activeIso] || {});
    tempSelect.innerHTML = temps.map(t => `<option value="${t}" ${t === '30' ? 'selected' : ''}>${t}</option>`).join('');

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

    // Quick DV Sections is now globally populated via populateQuickCheckSections() on load

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
            if (select.disabled) return;
            document.querySelectorAll('.custom-select-wrapper').forEach(w => {
                if (w !== wrapper) w.classList.remove('open');
            });
            wrapper.classList.toggle('open');
        });

        if (select.disabled) wrapper.classList.add('disabled');

        select.classList.add('upgraded');
        select.parentNode.insertBefore(wrapper, select.nextSibling);
    });
    lucide.createIcons();
}

function calculateIb(p, v, cosphi, isTri, isKva = false) {
    if (isKva) {
        // Apparent power S: cos phi already embedded, do not divide by it again
        if (isTri) return (p * 1000) / (Math.sqrt(3) * v);
        return (p * 1000) / v;
    }
    // Active power P: divide by cos phi
    if (isTri) return (p * 1000) / (Math.sqrt(3) * v * cosphi);
    return (p * 1000) / (v * cosphi);
}

function getKFactors(nConductors = 1) {
    const tens = document.querySelector('#pill-tens .active').getAttribute('data-val');
    const iso = (tens === 'mt_media_tensione') ? 'epr_xlpe_90C' : document.getElementById('sel-iso').value;

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
        const unitaPotenza = document.getElementById('sel-unit-potenza')?.value || 'kw';
        const isKva = unitaPotenza === 'kva';

        let ib = 0;
        if (inputType === 'p') ib = calculateIb(load, v, cosphi, isTri, isKva);
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
        const inArray = [2, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250];

        let validSection = null;
        let finalIz = 0;
        let finalDv = 0;
        let finalN = 1;
        let finalKF = null;
        let finalIn = null;
        let firstValidSection = null; // Track if we had to increase

        const autoParallelEl = document.getElementById('ch-auto-parallel');
        const isAutoParallel = autoParallelEl && autoParallelEl.checked;
        const baseN = parseInt(document.getElementById('sel-n-cavi')?.value) || 1;
        const maxN = isAutoParallel ? 20 : baseN;
        const protType = document.querySelector('#pill-prot .active').getAttribute('data-val');

        for (let N = baseN; N <= maxN; N++) {
            const kF = getKFactors(N);
            const Ktot = kF.k1 * kF.k2 * kF.k3 * kF.k4;

            for (let s of sezioni) {
                if (!paramElettrici[s]) continue;

                const i0 = portateSchema[s];
                const iz = i0 * Ktot * N;

                if (iz >= ib) {
                    if (!firstValidSection) firstValidSection = s;

                    // Scelta In minima e Coordinamento
                    let In = null;
                    let isCoordOk = false;

                    if (tens === 'mt_media_tensione') {
                        In = 'ANSI_51';
                        isCoordOk = true; 
                    } else {
                        for (let val of inArray) {
                            if (val >= ib) {
                                In = val;
                                break;
                            }
                        }

                        if (In === null) continue; // ib troppo grande

                        if (protType === 'mcb') {
                            isCoordOk = In <= iz;
                        } else {
                            isCoordOk = In <= 0.9 * iz;
                        }
                    }

                    if (!isCoordOk) continue; // Auto-Aumento alla sezione successiva

                    // Verifica DV
                    const R = paramElettrici[s].R / N; 
                    const X = paramElettrici[s].X / N; 

                    const dvVolts = (k * l * ib * (R * cosphi + X * sinphi)) / 1000;
                    const dvPerc = (dvVolts / v) * 100;

                    if (dvPerc <= dvMax) {
                        validSection = s;
                        finalIz = iz;
                        finalDv = dvPerc;
                        finalN = N;
                        finalKF = kF;
                        finalIn = In;
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
                In: finalIn,
                protType: protType,
                hasAutoIncreased: (validSection !== firstValidSection),
                kFactors: {
                    k1: finalKF.k1,
                    k2: finalKF.k2,
                    k3: finalKF.k3,
                    k4: finalKF.k4,
                    ktot: finalKF.k1 * finalKF.k2 * finalKF.k3 * finalKF.k4
                },
                inputs: {
                    v, l, cosphi, isTri, posa, mat, iso
                },
                status: 'OK'
            };
            setUISuccess(currentResult);
        } else {
            let statusLabel = 'NOT_FOUND';
            if (!isAutoParallel) {
                statusLabel = 'SECTION_INSUFFICIENT';
            } else if (isAutoParallel && maxN === 20) {
                statusLabel = 'OUT_OF_SCALE';
            }
            
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
            warningEl.className = 'res-warning-banner';
            warningEl.innerHTML = `<i data-lucide="alert-circle" style="width:18px;height:18px;"></i> Attenzione: La potenza richiede un elevato numero di cavi in parallelo (${r.n}). Valutare l'aumento della Tensione o l'uso di condotti a sbarre.`;
            warningEl.classList.remove('hidden');
            if (window.lucide) lucide.createIcons();
        } else {
            warningEl.classList.add('hidden');
        }
    }

    const multiplier = r.inputs.isTri ? '3x' : '';
    const displaySec = (r.n > 1) 
        ? (r.inputs.isTri ? `${r.n}x(${multiplier}${r.section})` : `${r.n}x${r.section}`)
        : `${multiplier}${r.section}`;
    document.getElementById('res-sec').textContent = `${displaySec} mm²`;
    
    // Protezione
    const protLbl = document.getElementById('res-prot-lbl');
    if (protLbl) {
        protLbl.textContent = r.protType === 'mcb' ? 'Taglia MCB' : 'Taglia Fusibile';
    }
    const resIn = document.getElementById('res-in');
    if (resIn) {
        resIn.textContent = `In = ${r.In} A`;
        resIn.style.color = '#005FB8';
    }

    // Auto-Aumento Avviso
    const warnInc = document.getElementById('res-warn-increase');
    if (warnInc) {
        if (r.hasAutoIncreased) {
            document.getElementById('res-warn-increase-text').textContent = `Sezione aumentata a ${r.section} mm² per garantire il coordinamento con la protezione commerciale.`;
            warnInc.classList.remove('hidden');
        } else {
            warnInc.classList.add('hidden');
        }
        if (window.lucide) lucide.createIcons();
    }

    // Protezione Visibility Toggles for MT vs BT
    const pSysTens = r.inputs.v > 1000 ? 'MT' : 'BT'; // using voltage as proxy for MT/BT check safely from r obj
    
    const formulaContainer = document.getElementById('res-formula');
    const statusMsg = document.getElementById('f-status-msg');
    const mtRelayMsg = document.getElementById('f-mt-relay-msg');
    const statusIcon = document.getElementById('f-status-icon');
    const statusText = document.getElementById('f-status-text');

    if (pSysTens === 'MT') {
        if (formulaContainer) formulaContainer.classList.add('hidden');
        if (statusMsg) statusMsg.classList.add('hidden');
        if (mtRelayMsg) mtRelayMsg.classList.remove('hidden');
        if (resIn) resIn.textContent = `Impostazione a progetto`;
        const protLbl = document.getElementById('res-prot-lbl');
        if (protLbl) protLbl.textContent = 'Relè Programmabile';
        
        let coordCheckStr = '--';
    } else {
        if (formulaContainer) formulaContainer.classList.remove('hidden');
        if (statusMsg) statusMsg.classList.remove('hidden');
        if (mtRelayMsg) mtRelayMsg.classList.add('hidden');
        
        // Formula Visiva Rendering per BT
        document.getElementById('f-val-ib').textContent = r.ib.toFixed(2) + ' A';
        document.getElementById('f-val-in').textContent = r.In + ' A';
        
        let effectiveIz = r.iz;
        const fLblIz = document.getElementById('f-lbl-iz');
        if (r.protType === 'fuse') {
            effectiveIz = 0.9 * r.iz;
            if (fLblIz) fLblIz.innerHTML = `0.9 &middot; Iz`;
        } else {
            if (fLblIz) fLblIz.textContent = `Portata (Iz)`;
        }
        document.getElementById('f-val-iz').textContent = effectiveIz.toFixed(2) + ' A';

        // Stato Normativo BT
        let isCoordOk = false;
        if (r.protType === 'mcb') {
            isCoordOk = (r.In <= r.iz) && (r.ib <= r.In);
        } else {
            isCoordOk = (r.In <= 0.9 * r.iz) && (r.ib <= r.In);
        }

        if (isCoordOk) {
            statusMsg.className = 'formula-status success';
            statusIcon.setAttribute('data-lucide', 'check-circle-2');
            statusText.textContent = "Condizione normativa rispettata con successo.";
        } else {
            statusMsg.className = 'formula-status error';
            statusIcon.setAttribute('data-lucide', 'x-circle');
            statusText.textContent = "Errore di coordinamento. Modificare la sezione o la protezione.";
        }
    }
    
    if (window.lucide) lucide.createIcons();

    // Griglia Valori Standard
    const valIb = document.getElementById('res-ib');
    if (valIb) valIb.textContent = r.ib.toFixed(2) + ' A';
    const valIz = document.getElementById('res-iz');
    if (valIz) valIz.textContent = r.iz.toFixed(2) + ' A';
    const valDv = document.getElementById('res-dv');
    if (valDv) valDv.textContent = r.dv.toFixed(2) + ' %';

    const st = document.getElementById('res-status');
    st.textContent = "VERIFICATO";
    st.style.color = "var(--success)";

    // Visualizzazione Fattori K
    const kContainer = document.getElementById('res-k-factors');
    if (kContainer && r.kFactors) {
        const isInterrata = r.inputs.posa && r.inputs.posa.includes('interrato');
        const k = r.kFactors;
        if (isInterrata) {
            kContainer.innerHTML = `k1: ${k.k1.toFixed(3)} | k2: ${k.k2.toFixed(3)} | k3: ${k.k3.toFixed(3)} | k4: ${k.k4.toFixed(3)} | <span style="color:var(--primary); font-weight:bold;">Ktot: ${k.ktot.toFixed(3)}</span>`;
        } else {
            kContainer.innerHTML = `k1: ${k.k1.toFixed(3)} | k2: ${k.k2.toFixed(3)} | <span style="color:var(--primary); font-weight:bold;">Ktot: ${k.ktot.toFixed(3)}</span>`;
        }
        kContainer.classList.remove('hidden');
    }

    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
        btnSave.disabled = false;
        btnSave.style.opacity = '1';
        btnSave.style.pointerEvents = 'auto';
    }
}

function setUIFatalError() {
    document.getElementById('res-placeholder').classList.add('hidden');
    document.getElementById('res-data').classList.remove('hidden');

    const card = document.getElementById('main-result-card');
    card.classList.remove('ok');
    card.classList.add('error');

    const warningEl = document.getElementById('res-warning');
    if (warningEl) {
        if (currentResult.status === 'OUT_OF_SCALE') {
            warningEl.className = 'res-error-banner';
            warningEl.innerHTML = `<i data-lucide="alert-triangle" style="width:18px;height:18px;"></i> Limite massimo consentito (Cavi in parallelo > Max) superato.`;
            warningEl.classList.remove('hidden');
        } else if (currentResult.status === 'SECTION_INSUFFICIENT') {
            warningEl.className = 'res-error-banner';
            warningEl.innerHTML = `<i data-lucide="alert-triangle" style="width:18px;height:18px;"></i> Sezione massima insufficiente. Attivare Auto-Parallelo o aumentare il numero di cavi.`;
            warningEl.classList.remove('hidden');
        } else {
            warningEl.className = 'res-error-banner';
            warningEl.innerHTML = `<i data-lucide="alert-triangle" style="width:18px;height:18px;"></i> Nessuna sezione commerciale idonea trovata per questi parametri.`;
            warningEl.classList.remove('hidden');
        }
        if (window.lucide) lucide.createIcons();
    }

    document.getElementById('res-sec').textContent = 
        currentResult.status === 'OUT_OF_SCALE' ? "Fuori Scala" : 
        currentResult.status === 'SECTION_INSUFFICIENT' ? "Sezione Insuff." : "Non Trovato";
    const valIb = document.getElementById('res-ib');
    if (valIb) valIb.textContent = currentResult.ib.toFixed(2) + ' A';
    const valIz = document.getElementById('res-iz');
    if (valIz) valIz.textContent = '--';
    const valDv = document.getElementById('res-dv');
    if (valDv) valDv.textContent = '--';

    const st = document.getElementById('res-status');
    if (st) {
        st.textContent = "ESITO NEGATIVO";
        st.style.color = "var(--error)";
    }

    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
        btnSave.disabled = true;
        btnSave.style.opacity = '0.5';
        btnSave.style.pointerEvents = 'none';
    }
}

function setUIError() {
    document.getElementById('res-data').classList.add('hidden');
    document.getElementById('res-placeholder').classList.remove('hidden');
    const card = document.getElementById('main-result-card');
    card.classList.remove('ok', 'error');

    const warningEl = document.getElementById('res-warning');
    if (warningEl) warningEl.classList.add('hidden');
}

// ── Helper: show/hide compatibility error card ──────────────────────────────
function pvShowCompatError(title, msg) {
    const errCard = document.getElementById('pv-compat-error-card');
    const titleEl = document.getElementById('pv-compat-error-title');
    const msgEl   = document.getElementById('pv-compat-error-msg');
    if (!errCard) return;
    if (titleEl) titleEl.textContent = title;
    if (msgEl)   msgEl.textContent   = msg;
    errCard.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function pvHideCompatError() {
    const errCard = document.getElementById('pv-compat-error-card');
    if (errCard) errCard.classList.add('hidden');
}

function calculatePV() {
    try {
        // ── Read inputs ──────────────────────────────────────────────
        const vmaxdc = parseFloat(document.getElementById('in-pv-vmaxdc')?.value);
        const nmppt  = parseInt(document.getElementById('in-pv-nmppt')?.value)  || 1;
        const imax   = parseFloat(document.getElementById('in-pv-imax')?.value);
        const mpptmin= parseFloat(document.getElementById('in-pv-mpptmin')?.value);
        const mpptmax= parseFloat(document.getElementById('in-pv-mpptmax')?.value);
        const pmaxcc = parseFloat(document.getElementById('in-pv-pmaxcc')?.value);
        const pac    = parseFloat(document.getElementById('in-pv-pac')?.value);

        const wp   = parseFloat(document.getElementById('in-pv-wp')?.value);
        const beta = parseFloat(document.getElementById('in-pv-beta')?.value);
        const gammaRaw = document.getElementById('in-pv-gamma')?.value;
        const gamma = (gammaRaw !== '' && gammaRaw !== null && !isNaN(parseFloat(gammaRaw)))
                      ? parseFloat(gammaRaw) : null;
        const voc  = parseFloat(document.getElementById('in-pv-voc')?.value);
        const isc  = parseFloat(document.getElementById('in-pv-isc')?.value);
        const vmp  = parseFloat(document.getElementById('in-pv-vmp')?.value);

        const ntot  = parseInt(document.getElementById('in-pv-ntot')?.value);
        const lcavo = parseFloat(document.getElementById('in-pv-lcavo')?.value);
        const tmin  = parseFloat(document.getElementById('in-pv-tmin')?.value);
        const tmax  = parseFloat(document.getElementById('in-pv-tmax')?.value);

        if ([vmaxdc, nmppt, imax, mpptmin, mpptmax, pmaxcc, wp, beta, voc, isc, vmp, ntot, lcavo, tmin, tmax].some(isNaN)) return;

        // ── Temperature corrections (STC = 25°C) ────────────────────
        const TSTC = 25;
        const voc_tmin = voc * (1 + (beta / 100) * (tmin - TSTC));  // max Voc (cold)
        const vmp_tmax = vmp * (1 + (beta / 100) * (tmax - TSTC));  // min Vmp (hot)
        const voc_tmax = voc * (1 + (beta / 100) * (tmax - TSTC));  // Voc at hottest

        // ── String range limits ──────────────────────────────────────
        const nmax_vmaxdc = Math.floor(vmaxdc / voc_tmin);
        const nmax_mppt   = Math.floor(mpptmax / vmp_tmax);
        const nmax = Math.min(nmax_vmaxdc, nmax_mppt);
        const nmin = Math.ceil(mpptmin / vmp_tmax);

        // ── MPPT distribution ───────────────────────────────────────
        const baseStringa = Math.floor(ntot / nmppt);
        let resto = ntot % nmppt;
        const isAsymmetric = resto !== 0;
        const mpptConfig = [];
        let restoCopy = resto;
        for (let i = 0; i < nmppt; i++) {
            let n_mod = baseStringa;
            if (restoCopy > 0) { n_mod++; restoCopy--; }
            const vsez_str = n_mod * voc_tmin;
            const vstr_str = n_mod * vmp_tmax;
            mpptConfig.push({
                mppt: i + 1,
                moduli: n_mod,
                vstr: n_mod * vmp,        // at STC (for display)
                vstr_hot: vstr_str,       // Vmp at Tmax (for under-voltage check)
                vsez: vsez_str,           // Voc at Tmin (for over-voltage check)
                valid: (n_mod >= nmin && n_mod <= nmax)
            });
        }

        pvHideCompatError();

        // ══════════════════════════════════════════════════════════════
        // BLOCCO SICUREZZA: 5 Test di Compatibilità Elettrica
        // ══════════════════════════════════════════════════════════════

        // TEST 1 – Over-Current
        if (isc > imax) {
            pvShowCompatError(
                '⚡ ERRORE CRITICO – Sovracorrente',
                `ERRORE CRITICO: Corrente Modulo (${isc.toFixed(2)} A) incompatibile. Supera la corrente massima ammessa dall'inverter (${imax.toFixed(2)} A).`
            );
            pvResetResultCard();
            return;
        }

        // TEST 2 – Over-Voltage (stringa più lunga = MPPT 1, ha n_mod_max = baseStringa+1 se asimmetrico)
        const nmax_stringa = mpptConfig[0].moduli; // prima stringa (più lunga se asimmetrico)
        const vstringa_freddo = nmax_stringa * voc_tmin;
        if (vstringa_freddo > vmaxdc) {
            pvShowCompatError(
                '🔥 PERICOLO DISTRUZIONE – Sovratensione',
                `PERICOLO DISTRUZIONE: A ${tmin}°C la tensione della stringa (${vstringa_freddo.toFixed(0)} V) eccede il limite dell'Inverter (${vmaxdc} V).`
            );
            pvResetResultCard();
            return;
        }

        // TEST 3 – Under-Voltage (stringa più corta = MPPT ultimo, ha n_mod_min = baseStringa)
        const nmin_stringa = mpptConfig[mpptConfig.length - 1].moduli; // ultima = più corta
        const vstringa_caldo = nmin_stringa * vmp_tmax;
        if (vstringa_caldo < mpptmin) {
            pvShowCompatError(
                '🌡️ INCOMPATIBILITÀ MPPT – Sottotensione',
                `INCOMPATIBILITÀ MPPT: A ${tmax}°C la tensione scende sotto la soglia MPPT (${vstringa_caldo.toFixed(0)} V < ${mpptmin} V). L'inverter non produrrà energia.`
            );
            pvResetResultCard();
            return;
        }

        // TEST 4 – Power Saturation
        const ptot = (ntot * wp) / 1000;
        if (ptot > pmaxcc) {
            pvShowCompatError(
                '🔋 SOVRACCARICO POTENZA',
                `SOVRACCARICO POTENZA: Il campo fotovoltaico (${ptot.toFixed(2)} kW) supera la potenza CC massima gestibile dall'inverter (${pmaxcc} kW).`
            );
            pvResetResultCard();
            return;
        }

        // TEST 5 – Asymmetry Feasibility
        // Se distribuzione asimmetrica, verifica che OGNI MPPT rispetti i limiti di tensione
        if (isAsymmetric) {
            const badMppt = mpptConfig.find(cfg => !cfg.valid);
            if (badMppt) {
                pvShowCompatError(
                    '⚖️ CONFIGURAZIONE IMPOSSIBILE',
                    `CONFIGURAZIONE IMPOSSIBILE: Non è possibile dividere i ${ntot} moduli su ${nmppt} MPPT rispettando i limiti di tensione su tutti gli ingressi. ` +
                    `L'MPPT ${badMppt.mppt} richiederebbe ${badMppt.moduli} moduli (range consentito: ${nmin}–${nmax}).`
                );
                pvResetResultCard();
                return;
            }
        }

        // ── Tutti i test superati: si procede con i risultati ───────
        pvHideCompatError();

        // ── DC Cable Sizing (max ΔV = 1.5%) ────────────────────────
        const vstr_max = mpptConfig[0].moduli * vmp; // STC for cable design
        const maxDvVolts   = 0.015 * vstr_max;
        const requiredSection = (2 * lcavo * isc) / (56 * maxDvVolts);
        const commercialSections = [4, 6, 10, 16, 25, 35];
        let cableSec = commercialSections.find(s => s >= requiredSection);
        if (!cableSec) cableSec = '>35';
        let dvReal = 0;
        if (typeof cableSec === 'number') {
            const dvRealVolts = (2 * lcavo * isc) / (56 * cableSec);
            dvReal = (dvRealVolts / vstr_max) * 100;
        }

        // ── Fuse: 1.5 · Isc (per spec) ──────────────────────────────
        const fuseMin = 1.5 * isc;
        const commercialFuses = [10, 12, 15, 20, 25, 30, 32, 40];
        let fuse = commercialFuses.find(f => f >= fuseMin) || parseFloat(fuseMin.toFixed(1));

        // ── SPD: Ucpv > Voc_max della stringa più lunga ──────────────
        // v_sez = tensione massima assoluta = Voc@Tmin della stringa più lunga
        const v_sez = mpptConfig[0].vsez;

        // ── Rapporto DC/AC (usa Potenza Nominale AC se presente, sennò Pmaxcc) ──────────
        const dcacFn = () => {
            if (!isNaN(pac) && pac > 0) return (ptot / pac).toFixed(2);
            if (pmaxcc > 0) return (ptot / pmaxcc).toFixed(2);
            return '--';
        };
        const dcac = dcacFn();

        // ── Save result ──────────────────────────────────────────────
        const isRangeValid = nmax >= nmin;
        currentResult = {
            type: 'pv',
            status: 'OK',
            nmin, nmax, ntot, nmppt, mpptConfig, isAsymmetric,
            voc_tmin, voc_tmax, vmp_tmax,
            ptot, pmaxcc, dcac,
            cableSec, dvReal, fuse, v_sez, isc,
            // Compatibility check results (for PDF)
            compatTests: {
                overCurrent:   { pass: true, label: 'Over-Current (Isc ≤ Imax)'      },
                overVoltage:   { pass: true, label: 'Over-Voltage a Tmin'             },
                underVoltage:  { pass: true, label: 'Under-Voltage a Tmax (MPPT)'    },
                powerSat:      { pass: true, label: 'Power Saturation (Ptot ≤ Pmaxcc)'},
                asymmetry:     { pass: true, label: 'Asimmetria Fattibile'            }
            },
            inputs: { vmaxdc, nmppt, mpptmin, mpptmax, imax, pmaxcc, pac, wp, beta, gamma, voc, isc, vmp, ntot, lcavo, tmin, tmax }
        };

        // ── Update UI ────────────────────────────────────────────────
        const resData    = document.getElementById('pv-res-data');
        const placeholder= document.getElementById('pv-res-placeholder');
        const card       = document.getElementById('pv-result-card');
        const warning    = document.getElementById('pv-res-warning');
        if (!resData || !placeholder || !card) return;

        placeholder.classList.add('hidden');
        resData.classList.remove('hidden');
        card.classList.remove('ok', 'error');
        card.classList.add('ok');

        // Dati generali
        const kwpStr = ptot.toFixed(2) + ' kWp';
        document.getElementById('pv-res-kwp').textContent  = kwpStr;
        const kwp2El = document.getElementById('pv-res-kwp2');
        if (kwp2El) kwp2El.textContent = kwpStr;
        const dcacEl = document.getElementById('pv-res-dcac');
        if (dcacEl) dcacEl.textContent = dcac;

        // Architecture summary
        document.getElementById('pv-res-arch-text').textContent = isAsymmetric
            ? `${nmppt} MPPT · Configurazione Asimmetrica`
            : `${nmppt} MPPT · ${mpptConfig[0].moduli} moduli/stringa · Simmetrica`;

        // Thermal limits grid
        document.getElementById('pv-res-range').textContent    = `${nmin} → ${nmax} mod.`;
        document.getElementById('pv-res-voc-tmin').textContent = voc_tmin.toFixed(2) + ' V';
        document.getElementById('pv-res-vmp-tmax').textContent = vmp_tmax.toFixed(2) + ' V';
        const statusEl = document.getElementById('pv-res-status');
        if (statusEl) {
            statusEl.textContent = 'VERIFICATA ✓';
            statusEl.style.color = 'var(--success)';
        }

        // Quadro CC
        document.getElementById('pv-res-cavo').textContent    = cableSec + ' mm² (Cu)';
        document.getElementById('pv-res-dv-cavo').textContent = (typeof cableSec === 'number') ? dvReal.toFixed(2) + ' %' : '-- %';
        document.getElementById('pv-res-fuse').textContent    = fuse + ' A · 1000V DC';
        document.getElementById('pv-res-sez').textContent     = '> ' + v_sez.toFixed(0) + ' V';
        document.getElementById('pv-res-isc-str').textContent = isc.toFixed(2) + ' A';
        document.getElementById('pv-res-vstr').textContent    = vstr_max.toFixed(1) + ' V';

        // Dynamic MPPT rows — one row per MPPT with Voc_max detail
        const dynContainer = document.getElementById('pv-mppt-dynamic-rows');
        if (dynContainer) {
            dynContainer.innerHTML = '';
            mpptConfig.forEach(cfg => {
                const badge = isAsymmetric
                    ? `MPPT ${cfg.mppt}`
                    : (cfg.mppt === 1 ? 'SIMMETRICA' : `MPPT ${cfg.mppt}`);
                const bgColor = isAsymmetric ? 'var(--primary)' : 'var(--success)';
                dynContainer.innerHTML += `
                    <div class="mppt-row">
                        <div class="mppt-badge" style="background:${bgColor};color:#fff;">${badge}</div>
                        <div class="mppt-details">
                            <span class="mppt-text">1 stringa da <strong>${cfg.moduli}</strong> moduli</span>
                            <span class="mppt-voc">Voc_max: ${cfg.vsez.toFixed(0)} V</span>
                        </div>
                    </div>
                `;
                if (!isAsymmetric) return; // for symmetric, show only first row
            });
            if (!isAsymmetric && mpptConfig.length > 1) {
                // Append note for symmetric
                dynContainer.innerHTML += `<div class="mppt-warning" style="color:var(--success);border-color:var(--success);"><i data-lucide="check-circle-2" style="width:13px;height:13px;"></i> Tutte le ${nmppt} stringhe identiche</div>`;
            }
            if (window.lucide) lucide.createIcons();
        }

        if (warning) warning.classList.add('hidden');

        const btnSavePv = document.getElementById('btn-save-pv');
        if (btnSavePv) {
            btnSavePv.disabled = false;
            btnSavePv.style.opacity = '1';
            btnSavePv.style.pointerEvents = 'auto';
        }
    } catch (e) {
        console.error('Calc PV error:', e);
    }
}

// Reset result card when a blocking error is shown
function pvResetResultCard() {
    const resData    = document.getElementById('pv-res-data');
    const placeholder= document.getElementById('pv-res-placeholder');
    const card       = document.getElementById('pv-result-card');
    if (resData) resData.classList.add('hidden');
    if (placeholder) placeholder.classList.add('hidden');
    if (card) card.classList.remove('ok', 'error');
    currentResult = null;
    const btnSavePv = document.getElementById('btn-save-pv');
    if (btnSavePv) {
        btnSavePv.disabled = true;
        btnSavePv.style.opacity = '0.5';
        btnSavePv.style.pointerEvents = 'none';
    }
}

// ══════════════════════════════════════════════════════════════
// PRESET SYSTEM: INVERTER & PANNELLO
// ══════════════════════════════════════════════════════════════

function getPresets(type) {
    try {
        const data = localStorage.getItem(`preset_${type}`);
        return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
}

function savePresets(type, presets) {
    localStorage.setItem(`preset_${type}`, JSON.stringify(presets));
}

function initPresets() {
    const invSelect = document.getElementById('sel-preset-inverter');
    const panSelect = document.getElementById('sel-preset-pannello');
    
    // Populate Inverter
    if (invSelect) {
        invSelect.innerHTML = '<option value="">-- Carica preset --</option>';
        getPresets('inverter').forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            invSelect.appendChild(opt);
        });
        // We ensure we only add the change listener once, or remove existing.
        // Easiest is to clone the node or just avoid duplicating listeners if we are re-populating.
        // Since we re-populate by setting innerHTML, we don't need to worry about multiple change listeners 
        // IF we attach it in initUI. Wait, no, we attach to the select element.
        // It's safer to attach the listener in initUI, but wait, the innerHTML doesn't destroy the select element itself, just the options.
    }
    
    // Populate Pannello
    if (panSelect) {
        panSelect.innerHTML = '<option value="">-- Carica preset --</option>';
        getPresets('pannello').forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            panSelect.appendChild(opt);
        });
    }
}

function salvaPresetInverter() {
    const name = prompt("Inserisci nome modello Inverter:");
    if (!name || name.trim() === '') return;
    
    const preset = {
        id: 'inv_' + Date.now(),
        name: name.trim(),
        vmaxdc: document.getElementById('in-pv-vmaxdc')?.value,
        mpptmin: document.getElementById('in-pv-mpptmin')?.value,
        mpptmax: document.getElementById('in-pv-mpptmax')?.value,
        imax: document.getElementById('in-pv-imax')?.value,
        pmaxcc: document.getElementById('in-pv-pmaxcc')?.value,
        pac: document.getElementById('in-pv-pac')?.value,
        nmppt: document.getElementById('in-pv-nmppt')?.value
    };
    
    const presets = getPresets('inverter');
    presets.push(preset);
    savePresets('inverter', presets);
    initPresets();
    document.getElementById('sel-preset-inverter').value = preset.id;
    showToast("Preset Inverter salvato!");
}

function salvaPresetPannello() {
    const name = prompt("Inserisci nome modello Pannello FV:");
    if (!name || name.trim() === '') return;
    
    const preset = {
        id: 'pan_' + Date.now(),
        name: name.trim(),
        wp: document.getElementById('in-pv-wp')?.value,
        voc: document.getElementById('in-pv-voc')?.value,
        vmp: document.getElementById('in-pv-vmp')?.value,
        isc: document.getElementById('in-pv-isc')?.value,
        beta: document.getElementById('in-pv-beta')?.value,
        gamma: document.getElementById('in-pv-gamma')?.value
    };
    
    const presets = getPresets('pannello');
    presets.push(preset);
    savePresets('pannello', presets);
    initPresets();
    document.getElementById('sel-preset-pannello').value = preset.id;
    showToast("Preset Pannello salvato!");
}

function loadPreset(type, id) {
    if (!id) return;
    const presets = getPresets(type);
    const preset = presets.find(p => p.id === id);
    if (!preset) return;
    
    if (type === 'inverter') {
        if (preset.vmaxdc !== undefined) document.getElementById('in-pv-vmaxdc').value = preset.vmaxdc;
        if (preset.mpptmin !== undefined) document.getElementById('in-pv-mpptmin').value = preset.mpptmin;
        if (preset.mpptmax !== undefined) document.getElementById('in-pv-mpptmax').value = preset.mpptmax;
        if (preset.imax !== undefined) document.getElementById('in-pv-imax').value = preset.imax;
        if (preset.pmaxcc !== undefined) document.getElementById('in-pv-pmaxcc').value = preset.pmaxcc;
        if (preset.pac !== undefined) document.getElementById('in-pv-pac').value = preset.pac;
        if (preset.nmppt !== undefined) document.getElementById('in-pv-nmppt').value = preset.nmppt;
    } else if (type === 'pannello') {
        if (preset.wp !== undefined) document.getElementById('in-pv-wp').value = preset.wp;
        if (preset.voc !== undefined) document.getElementById('in-pv-voc').value = preset.voc;
        if (preset.vmp !== undefined) document.getElementById('in-pv-vmp').value = preset.vmp;
        if (preset.isc !== undefined) document.getElementById('in-pv-isc').value = preset.isc;
        if (preset.beta !== undefined) document.getElementById('in-pv-beta').value = preset.beta;
        if (preset.gamma !== undefined) document.getElementById('in-pv-gamma').value = preset.gamma;
    }
    validateForm('sec-fotovoltaico');
}

function deletePreset(type) {
    const select = document.getElementById(`sel-preset-${type}`);
    const id = select.value;
    if (!id) {
        alert("Seleziona prima un preset da eliminare.");
        return;
    }
    if (!confirm("Eliminare questo preset?")) return;
    
    let presets = getPresets(type);
    presets = presets.filter(p => p.id !== id);
    savePresets(type, presets);
    initPresets();
    showToast("Preset eliminato!");
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
    const card = resEl.closest('.result-card');

    if (!ib || !l || !sec || !v || !cat || !mat) {
        resEl.textContent = '-- %';
        resEl.style.color = "var(--primary)";
        if (card) card.classList.remove('error', 'ok');
        return;
    }

    const paramElettrici = DB.parametri_elettrici[cat]?.[mat]?.[sec];
    if (!paramElettrici) {
        resEl.textContent = 'Err. DB';
        resEl.style.color = "var(--error)";
        if (card) {
            card.classList.remove('ok');
            card.classList.add('error');
        }
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
    const isError = dvPerc > 4;
    resEl.style.color = isError ? "var(--error)" : "var(--success)";
    
    if (card) {
        card.classList.remove('ok', 'error');
        card.classList.add(isError ? 'error' : 'ok');
    }
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


// pvInputIds is accessible here because it is defined inside initUI() – replicate the list
const PV_INPUT_IDS_ALL = ['in-pv-vmaxdc', 'in-pv-nmppt', 'in-pv-imax', 'in-pv-mpptmin', 'in-pv-mpptmax', 'in-pv-pmaxcc', 'in-pv-wp', 'in-pv-beta', 'in-pv-voc', 'in-pv-isc', 'in-pv-vmp', 'in-pv-ntot', 'in-pv-lcavo', 'in-pv-tmin', 'in-pv-tmax', 'in-pv-gamma'];

function buildUiState() {
    const uiState = {};
    const selects  = ['sel-iso', 'sel-posa', 'sel-temp', 'sel-group', 'sel-depth', 'sel-res', 'sel-n-cavi', 'sel-unit-potenza'];
    const inputIds = ['in-v', 'in-l', 'in-load', 'in-cosphi', 'in-dvmax', ...PV_INPUT_IDS_ALL];
    const pills    = ['pill-sys', 'pill-input-type', 'pill-tens', 'pill-mat'];
    selects.forEach(id  => { const el = document.getElementById(id); if (el) uiState[id] = el.value; });
    inputIds.forEach(id => { const el = document.getElementById(id); if (el) uiState[id] = el.value; });
    pills.forEach(id    => { const el = document.querySelector(`#${id} .active`); if (el) uiState[id] = el.getAttribute('data-val'); });
    uiState['ch-auto-parallel'] = document.getElementById('ch-auto-parallel')?.checked || false;
    return uiState;
}

function buildSafeData(uiState) {
    if (currentResult.type === 'pv') {
        return {
            ...currentResult,
            unitaPotenza: 'kw'
        };
    }

    return {
        type: currentResult.type,
        status: currentResult.status,
        section: currentResult.section,
        n: currentResult.n,
        ib: currentResult.ib,
        iz: currentResult.iz,
        dv: currentResult.dv,
        In: currentResult.In,
        protType: currentResult.protType,
        hasAutoIncreased: currentResult.hasAutoIncreased,
        unitaPotenza: uiState['sel-unit-potenza'] || 'kw',
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
            load: parseFloat(document.getElementById('in-load')?.value) || 0,
            cosphi: currentResult.inputs.cosphi,
            isTri: currentResult.inputs.isTri,
            posa: uiState['sel-posa'],
            mat: uiState['pill-mat'],
            iso: uiState['sel-iso']
        } : null
    };
}

function saveProject(isUpdate = false) {
    try {
        if (!currentResult || currentResult.status !== 'OK') {
            alert("Assicurati che il calcolo sia valido prima di salvare.");
            return;
        }

        const uiState = buildUiState();
        const safeData = buildSafeData(uiState);
        let p = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');

        if (isUpdate && idProgettoAttivo !== null) {
            // ── UPDATE MODE ────────────────────────────────────────────────
            const idx = p.findIndex(x => x.id === idProgettoAttivo);
            if (idx !== -1) {
                p[idx].data = safeData;
                p[idx].uiState = uiState;
                p[idx].date = new Date().toLocaleDateString('it-IT') + ' ' + new Date().toLocaleTimeString('it-IT');
                localStorage.setItem('archivio_elettrosuite', JSON.stringify(p));
                showToast('Progetto aggiornato nell\u2019archivio');
            } else {
                showToast('Progetto non trovato, crea un nuovo salvataggio.');
            }
        } else {
            // ── INSERT MODE ────────────────────────────────────────────────
            const name = document.getElementById('in-proj-name').value.trim();
            if (!name) {
                alert("Inserisci un nome per il progetto.");
                return;
            }
            const newId = Date.now();
            const proj = {
                id: newId,
                name,
                date: new Date().toLocaleDateString('it-IT') + ' ' + new Date().toLocaleTimeString('it-IT'),
                data: safeData,
                uiState: uiState
            };
            p.unshift(proj);
            localStorage.setItem('archivio_elettrosuite', JSON.stringify(p));

            // Set active state so subsequent saves become updates
            idProgettoAttivo = newId;
            const btnSave = document.getElementById('btn-save');
            if (btnSave) btnSave.title = 'Aggiorna Progetto';
            const btnSavePvUpdate = document.getElementById('btn-save-pv');
            if (btnSavePvUpdate) btnSavePvUpdate.title = 'Aggiorna Progetto PV';

            document.getElementById('in-proj-name').value = '';
            document.getElementById('modal-save').classList.remove('open');
            showToast('Progetto salvato nell\u2019archivio');
        }

        loadArchive();
    } catch (err) {
        console.error('Errore salvataggio:', err);
        document.getElementById('modal-save').classList.remove('open');
        showToast('Errore durante il salvataggio: ' + err.message);
    }
}

function resetActiveProject() {
    idProgettoAttivo = null;
    const btnSave = document.getElementById('btn-save');
    if (btnSave) btnSave.title = 'Salva Progetto';
}

function loadArchive() {
    const listCavi = document.getElementById('archive-list');
    const listFv = document.getElementById('archive-list-fv');
    const listPreset = document.getElementById('archive-list-preset');

    if (!listCavi || !listFv || !listPreset) return;

    listCavi.innerHTML = '';
    listFv.innerHTML = '';
    listPreset.innerHTML = '';

    // -- Render Progetti (Cavi / FV) --
    let data = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
    let projCavi = data.filter(p => !p.data?.type || p.data.type !== 'pv');
    let projFv = data.filter(p => p.data?.type === 'pv');

    const createEmpty = (msg) => `<div class="archive-empty" style="padding:2rem; text-align:center; color:var(--on-surface-variant)">${msg}</div>`;

    if (projCavi.length === 0) {
        listCavi.innerHTML = createEmpty('Nessun progetto Cavi registrato.');
    } else {
        projCavi.reverse().forEach(p => {
            const multiplier = (p.data.inputs && p.data.inputs.isTri) ? '3x' : '';
            const nCavi = p.data.n || 1;
            const displaySec = (nCavi > 1)
                ? ((p.data.inputs && p.data.inputs.isTri) ? `${nCavi}x(${multiplier}${p.data.section})` : `${nCavi}x${p.data.section}`)
                : `${multiplier}${p.data.section}`;
            const detailStr = `Sec: ${displaySec} mm² | Iz: ${(p.data.iz||0).toFixed(1)} A`;
            listCavi.innerHTML += `
            <div class="archive-item">
                <div class="archive-item-content" onclick="restoreProject(${p.id})">
                    <div>
                        <div class="archive-info-title"><i data-lucide="cable" style="width: 16px; height: 16px; margin-right: 6px; display: inline-block; color:var(--primary);"></i>${p.name || 'Senza Nome'}</div>
                        <div class="archive-info-sub">${p.date || ''} | ${detailStr}</div>
                    </div>
                </div>
                <div style="display:flex; gap:8px;">
                     <button class="icon-btn" style="color:var(--success)" onclick="restoreProject(${p.id})" title="Ripristina nel Calcolatore"><i data-lucide="refresh-cw"></i></button>
                     <button class="icon-btn" style="color:var(--primary)" onclick="exportPDF(${p.id})" title="Esporta PDF"><i data-lucide="download"></i></button>
                     <button class="icon-btn text-error" onclick="deleteProj(${p.id})" title="Elimina"><i data-lucide="x"></i></button>
                </div>
            </div>`;
        });
    }

    if (projFv.length === 0) {
        listFv.innerHTML = createEmpty('Nessun progetto Fotovoltaico.');
    } else {
        projFv.reverse().forEach(p => {
             listFv.innerHTML += `
            <div class="archive-item">
                <div class="archive-item-content" onclick="restoreProject(${p.id})">
                    <div>
                        <div class="archive-info-title"><i data-lucide="sun" style="width: 16px; height: 16px; margin-right: 6px; display: inline-block; color:var(--primary);"></i>${p.name || 'Senza Nome'}</div>
                        <div class="archive-info-sub">${p.date || ''} | PV String Range: ${p.data.nmin} - ${p.data.nmax} Moduli</div>
                    </div>
                </div>
                <div style="display:flex; gap:8px;">
                     <button class="icon-btn" style="color:var(--success)" onclick="restoreProject(${p.id})" title="Ripristina nel Calcolatore"><i data-lucide="refresh-cw"></i></button>
                     <button class="icon-btn" style="color:var(--primary)" onclick="exportPDF(${p.id})" title="Esporta PDF"><i data-lucide="download"></i></button>
                     <button class="icon-btn text-error" onclick="deleteProj(${p.id})" title="Elimina"><i data-lucide="x"></i></button>
                </div>
            </div>`;
        });
    }

    // -- Render Preset Componenti --
    const presetInv = getPresets('inverter');
    const presetPan = getPresets('pannello');
    
    if (presetInv.length === 0 && presetPan.length === 0) {
        listPreset.innerHTML = createEmpty('Nessun preset personalizzato.');
    } else {
        presetInv.forEach(inv => {
            listPreset.innerHTML += `
            <div class="archive-item">
                <div class="archive-item-content" onclick="restorePresetInv('${inv.id}')">
                    <div>
                        <div class="archive-info-title"><i data-lucide="cpu" style="width: 16px; height: 16px; margin-right: 6px; display: inline-block; color:var(--primary);"></i>${inv.name}</div>
                        <div class="archive-info-sub">Inverter Preset</div>
                    </div>
                </div>
                <div style="display:flex; gap:8px;">
                     <button class="icon-btn text-error" onclick="deletePresetGlobal('${inv.id}')" title="Elimina"><i data-lucide="x"></i></button>
                </div>
            </div>`;
        });
        presetPan.forEach(pan => {
             listPreset.innerHTML += `
            <div class="archive-item">
                <div class="archive-item-content" onclick="restorePresetPan('${pan.id}')">
                    <div>
                        <div class="archive-info-title"><i data-lucide="layout-grid" style="width: 16px; height: 16px; margin-right: 6px; display: inline-block; color:var(--primary);"></i>${pan.name}</div>
                        <div class="archive-info-sub">Pannello Preset</div>
                    </div>
                </div>
                <div style="display:flex; gap:8px;">
                     <button class="icon-btn text-error" onclick="deletePresetGlobal('${pan.id}')" title="Elimina"><i data-lucide="x"></i></button>
                </div>
            </div>`;
        });
    }

    if (window.lucide) lucide.createIcons();
}

function restoreProject(id) {
    let p = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
    const proj = p.find(x => x.id === id);
    if (!proj) return;

    const isPv = proj.data.type === 'pv';
    const targetSection = isPv ? 'sec-fotovoltaico' : 'sec-calc';

    // Switch to target tab
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(targetSection).classList.remove('hidden');
    history.pushState({ section: targetSection }, '', '#' + targetSection);

    const ui = proj.uiState;
    if (!ui) {
        alert("Progetto vecchio, dati di ripristino non disponibili.");
        return;
    }

    // Phase 1: Set Pills (Only for Cable Calc)
    if (!isPv) {
        ['pill-sys', 'pill-input-type', 'pill-tens', 'pill-mat'].forEach(pillId => {
            if (ui[pillId]) {
                const group = document.getElementById(pillId);
                if(group) {
                    group.querySelectorAll('.pill').forEach(btn => btn.classList.remove('active'));
                    const targetBtn = group.querySelector(`[data-val="${ui[pillId]}"]`);
                    if (targetBtn) targetBtn.classList.add('active');
                }
            }
        });

        // Phase 2: Populate dynamic selects
        updateLists();

        // Phase 2b: Restore unit selector early
        const selUnit = document.getElementById('sel-unit-potenza');
        if (selUnit && ui['sel-unit-potenza']) {
            selUnit.value = ui['sel-unit-potenza'];
            selUnit.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // Phase 3: Set all saved inputs and selects, then fire change events
    Object.keys(ui).forEach(key => {
        const el = document.getElementById(key);
        if (el && el.tagName === 'INPUT' && el.type !== 'checkbox') {
            el.value = ui[key];
            if(isPv) el.dispatchEvent(new Event('input', { bubbles: true })); // Trigger event for validation later
        } else if (el && el.tagName === 'SELECT') {
            el.value = ui[key];
            if(isPv) el.dispatchEvent(new Event('input', { bubbles: true })); 
        } else if (key === 'ch-auto-parallel') {
            const check = document.getElementById('ch-auto-parallel');
            if (check) { check.checked = ui[key]; check.dispatchEvent(new Event('change')); }
        }
    });

    // Phase 4: Validate and recalculate
    if(isPv) {
        calculatePV();
    } else {
        validateForm('sec-calc');
        performCalculation();
    }

    // Phase 5: Set active project state (Insert/Update logic)
    idProgettoAttivo = proj.id;
    const btnSave = document.getElementById('btn-save');
    if (btnSave) btnSave.title = 'Aggiorna Progetto';

    showToast('Progetto "' + proj.name + '" ripristinato. Usa Salva per aggiornarlo.');
}

function deleteProj(id) {
    if (!confirm("Cancellare il progetto?")) return;
    let p = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
    p = p.filter(x => x.id !== Number(id));
    localStorage.setItem('archivio_elettrosuite', JSON.stringify(p));
    loadArchive();
}

// Global scope window wrappers for HTML inline onclick within Preset Archive lists
window.restorePresetInv = function(id) { loadPreset('inverter', id); navigateTo('sec-fotovoltaico'); showToast("Preset Inverter caricato!"); };
window.restorePresetPan = function(id) { loadPreset('pannello', id); navigateTo('sec-fotovoltaico'); showToast("Preset Pannello caricato!"); };
window.deletePresetGlobal = function(id) {
    if(id.startsWith('inv_')) {
        let arr = getPresets('inverter').filter(x => x.id !== id);
        savePresets('inverter', arr);
    } else {
        let arr = getPresets('pannello').filter(x => x.id !== id);
        savePresets('pannello', arr);
    }
    loadArchive();
    initPresets(); // Refresh dropdowns
};

// Event Listeners for Clear buttons are assigned via HTML generally, but let's wire them cleanly:
document.querySelectorAll('.btn-clear-archive').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const type = e.currentTarget.getAttribute('data-type');
        clearArchiveByType(type);
    });
});

function clearArchiveByType(type) {
    if (!type) { // Fallback (global id="btn-clear-archive" mostly unused now)
        if (!confirm("Svuotare intero archivio progetti (esclusi Preset)?")) return;
        localStorage.removeItem('archivio_elettrosuite');
        loadArchive();
        return;
    }

    if (type === 'preset') {
        if (!confirm("Vuoi eliminare TUTTI i preset personalizzati (Inverter e Pannelli)?")) return;
        localStorage.removeItem('preset_inverter');
        localStorage.removeItem('preset_pannello');
        initPresets();
    } else {
        if (!confirm(`Vuoi svuotare i progetti ${type === 'cavi' ? 'Linee' : 'Fotovoltaico'}?`)) return;
        let data = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
        if (type === 'cavi') data = data.filter(p => p.data?.type === 'pv');
        else if (type === 'fv') data = data.filter(p => !p.data?.type || p.data.type !== 'pv');
        localStorage.setItem('archivio_elettrosuite', JSON.stringify(data));
    }
    loadArchive();
}

function clearArchive() {
    clearArchiveByType(null);
}

function exportArchivioJSON(type) {
    let exportData = null;
    let filename = `ElectroSuite_Backup_${type}.json`;

    if (type === 'preset') {
        exportData = {
            inverter: getPresets('inverter'),
            pannello: getPresets('pannello')
        };
        if (exportData.inverter.length === 0 && exportData.pannello.length === 0) {
            alert("Nessun preset da esportare."); return;
        }
    } else {
        let allProjs = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
        if (type === 'cavi') exportData = allProjs.filter(p => !p.data?.type || p.data.type !== 'pv');
        else if (type === 'fv') exportData = allProjs.filter(p => p.data?.type === 'pv');
        
        if (!exportData || exportData.length === 0) {
            alert("Nessun progetto da esportare per questa categoria."); return;
        }
    }

    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importArchivioJSON(type, inputElement) {
    const file = inputElement.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (type === 'preset') {
                if (imported.inverter && Array.isArray(imported.inverter)) {
                    let oldInv = getPresets('inverter');
                    savePresets('inverter', [...oldInv, ...imported.inverter]);
                }
                if (imported.pannello && Array.isArray(imported.pannello)) {
                    let oldPan = getPresets('pannello');
                    savePresets('pannello', [...oldPan, ...imported.pannello]);
                }
                initPresets();
            } else {
                if (!Array.isArray(imported)) throw new Error("Formato progetto JSON invalido");
                let oldProjs = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
                // Create new unified array using spread
                localStorage.setItem('archivio_elettrosuite', JSON.stringify([...oldProjs, ...imported]));
            }
            showToast("Importazione completata con successo!");
            loadArchive(); // Refresh currently viewed archive
        } catch (err) {
            alert("Errore nell'importazione: il file JSON potrebbe essere corrotto o incompatibile.\n" + err);
        }
        inputElement.value = ""; // Reset input
    };
    reader.readAsText(file);
}

window.exportPDF = function (id) {
    let p = JSON.parse(localStorage.getItem('archivio_elettrosuite') || '[]');
    const proj = p.find(x => x.id === Number(id));
    if (!proj) {
        alert("Progetto non trovato nell'archivio.");
        return;
    }
    generaPDF(proj);
}

// Genera PDF dal calcolatore attivo (Cavi)
document.getElementById('btn-export-pdf')?.addEventListener('click', generateActivePdf);

// Genera PDF dal calcolatore attivo (PV)
document.getElementById('btn-export-pdf-pv')?.addEventListener('click', generateActivePdf);

function generateActivePdf() {
    if (!currentResult || currentResult.status !== 'OK') {
        alert("Nessun calcolo valido da esportare.");
        return;
    }
    const name = prompt("Inserisci un nome per il report:", "Progetto_Corrente");
    if (!name) return;

    // Build temporary proj object
    const uiState = {};
    const selects = ['sel-iso', 'sel-posa', 'sel-temp', 'sel-group', 'sel-depth', 'sel-res', 'sel-n-cavi'];
    const inputIds = ['in-v', 'in-l', 'in-load', 'in-cosphi', 'in-dvmax'];
    const pills = ['pill-sys', 'pill-input-type', 'pill-tens', 'pill-mat'];

    selects.forEach(id => { const el = document.getElementById(id); if (el) uiState[id] = el.value; });
    inputIds.forEach(id => { const el = document.getElementById(id); if (el) uiState[id] = el.value; });
    pills.forEach(id => {
        const el = document.querySelector(`#${id} .active`);
        if (el) uiState[id] = el.getAttribute('data-val');
    });

    const tempProj = {
        name: name,
        date: new Date().toLocaleDateString('it-IT') + ' ' + new Date().toLocaleTimeString('it-IT'),
        data: currentResult, // Note: currentResult has all needed data
        uiState: uiState
    };
    
    // Polyfill inputs if missing (since active result object might map them differently)
    if (!tempProj.data.inputs) {
        tempProj.data.inputs = {
            v: uiState['in-v'],
            l: uiState['in-l'],
            cosphi: uiState['in-cosphi'],
            isTri: uiState['pill-sys'] === 'tri',
            posa: uiState['sel-posa'],
            mat: uiState['pill-mat'],
            iso: uiState['sel-iso']
        };
    }

    generaPDF(tempProj);
}

function generaPDF(proj) {
    try {
    // Support both window.jspdf (UMD) namespace
    const jsPDFLib = (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : (window.jsPDF || null);
    if (!jsPDFLib) {
        alert('Libreria jsPDF non disponibile. Controlla la connessione e ricarica la pagina.');
        return;
    }
    const doc = new jsPDFLib();

    // -- Header --
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text("ElectroSuite v4.0 - Report di Calcolo Elettrico", 15, 20);

    // -- Data/Time --
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    
    // Splitting date and project name onto separate lines for better readability
    // Left side:
    doc.text(`Data: ${proj.date}`, 15, 27);
    // Right side:
    const projText = `Progetto: ${proj.name}`;
    const projWidth = doc.getTextWidth(projText);
    doc.text(projText, 195 - projWidth, 27);

    // -- Horizontal Line --
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(15, 32, 195, 32);

    let startY = 40;

    // --- ENCODING HELPER ---
    // Fixes jsPDF problems with Unicode logic / Math symbols
    const safeStr = (str) => {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/≤/g, '<=')
            .replace(/≥/g, '>=')
            .replace(/ΔV/g, 'Delta V');
            // Nota: ° viene preservato (solitamente supportato se Helvetica windows-1252 style, altrimenti farebbe replace(/°C/g, ' gradi C'))
    };

    if (proj.data.type === 'pv') {
        const d = proj.data;
        // Tabella 1: Dati Inverter & Modulo
        doc.autoTable({
            startY: startY,
            head: [['Parametro', 'Valore', 'Unità']],
            body: [
                ['V max DC (Inverter)',           d.inputs.vmaxdc,             'V'],
                ['Range MPPT – Min / Max',        `${d.inputs.mpptmin} – ${d.inputs.mpptmax}`, 'V'],
                ['Corrente Max MPPT (Imax)',       d.inputs.imax,               'A'],
                ['Potenza Max Ingresso CC',        d.inputs.pmaxcc,             'kW'],
                ...(d.inputs.pac != null && !isNaN(d.inputs.pac) ? [['Potenza Nominale CA', d.inputs.pac, 'kW']] : []),
                ['N° MPPT',                       d.inputs.nmppt,               '-'],
                ['Potenza Modulo (Wp)',            d.inputs.wp,                 'Wp'],
                ['Voc / Vmp Pannello',            `${d.inputs.voc} V / ${d.inputs.vmp} V`, '-'],
                ['Isc Pannello',                  d.inputs.isc,                'A'],
                ['Coeff. Temp. β (Voc)',          d.inputs.beta,               '%/°C'],
                ...(d.inputs.gamma != null ? [['Coeff. Temp. γ (Pmax)', d.inputs.gamma, '%/°C']] : []),
                ['Temperature Progetto',          `Tmin: ${d.inputs.tmin}°C – Tmax: ${d.inputs.tmax}°C`, '-'],
                ['N° Moduli Totali',              d.inputs.ntot,               'mod.'],
                ['Lunghezza Cavi CC',             d.inputs.lcavo,              'm'],
            ],
            theme: 'striped',
            headStyles: { fillColor: [15, 76, 129] },
            margin: { left: 15, right: 15 }
        });

        // Tabella 2: Dichiarazione di Compatibilità Elettrica
        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Verifica di Compatibilità Elettrica', 'Esito', 'Dettaglio']],
            body: [
                ['Over-Current (Isc <= Imax MPPT)',
                 'SUPERATA',
                 safeStr(`Isc = ${d.inputs.isc} A <= Imax = ${d.inputs.imax} A`)],
                ['Over-Voltage a Tmin (Vstringa <= Vmax DC)',
                 'SUPERATA',
                 safeStr(`Vstr_max = ${(d.mpptConfig[0].vsez).toFixed(0)} V <= ${d.inputs.vmaxdc} V`)],
                ['Under-Voltage a Tmax (Vstringa >= Vmppt_min)',
                 'SUPERATA',
                 safeStr(`Vstr_min = ${(d.mpptConfig[d.mpptConfig.length-1].vstr_hot != null ? d.mpptConfig[d.mpptConfig.length-1].vstr_hot : d.mpptConfig[d.mpptConfig.length-1].moduli * d.vmp_tmax).toFixed(0)} V >= ${d.inputs.mpptmin} V`)],
                ['Power Saturation (Ptot <= Pmaxcc)',
                 'SUPERATA',
                 safeStr(`Ptot = ${d.ptot.toFixed(2)} kW <= Pmaxcc = ${d.inputs.pmaxcc} kW`)],
                ['Asimmetria Fattibile (tutti nei limiti)',
                 'SUPERATA',
                 d.isAsymmetric ? `Distribuzione asimmetrica verificata` : 'Configurazione simmetrica']
            ],
            theme: 'grid',
            headStyles: { fillColor: [25, 129, 85] },
            bodyStyles: { fontSize: 9 },
            columnStyles: {
                0: { cellWidth: 70 },
                1: { fontStyle: 'bold', textColor: [25, 129, 85], cellWidth: 30 },
                2: { cellWidth: 80 }
            },
            styles: { overflow: 'linebreak', cellWidth: 'wrap' },
            margin: { left: 15, right: 15 }
        });

        // Tabella 3: Dettaglio MPPT
        const mpptRows = d.mpptConfig.map(cfg => [
            `MPPT ${cfg.mppt}`,
            `1 stringa da ${cfg.moduli} moduli`,
            `${cfg.vsez != null ? cfg.vsez.toFixed(0) : '--'} V`,
            `${(cfg.moduli * (d.inputs ? d.inputs.vmp : 0)).toFixed(0)} V`
        ]);
        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Ingresso', 'Configurazione', 'Voc_max (a Tmin)', 'Vmp (STC)']],
            body: mpptRows,
            theme: 'striped',
            headStyles: { fillColor: [230, 126, 34] },
            margin: { left: 15, right: 15 }
        });

        // Tabella 4: Dimensionamento Quadro CC
        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Elemento Quadro CC', 'Specifica']],
            body: [
                ['Potenza Totale Generatore',         `${d.ptot.toFixed(2)} kWp (DC/AC = ${d.dcac || '--'})`],
                [safeStr('Cavo Solare (ΔV <= 1.5%)'), `${d.cableSec} mm2 - Delta V = ${typeof d.cableSec === 'number' ? d.dvReal.toFixed(2) : '--'} %`],
                ['Fusibile Stringa (1.5 * Isc)',      `${d.fuse} A - 1000V DC`],
                ['SPD (Ucpv > Voc_max stringa)',      `> ${d.v_sez.toFixed(0)} V`],
                ['Isc per Stringa',                   `${d.isc.toFixed(2)} A`],
            ],
            theme: 'grid',
            headStyles: { fillColor: [80, 40, 120] },
            styles: { overflow: 'linebreak' },
            margin: { left: 15, right: 15 }
        });

        if (d.isAsymmetric) {
            let asymY = doc.lastAutoTable.finalY + 6;
            doc.setFontSize(8);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(80, 80, 80);
            doc.text(`Nota: Configurazione asimmetrica – i ${d.inputs.ntot} moduli non si dividono equamente su ${d.inputs.nmppt} MPPT.`, 15, asymY);
        }

    } else {
        const d = proj.data;
        const paramIns = proj.data.inputs || {};
        const pSys = paramIns.isTri ? 'Trifase' : 'Monofase';
        // Unit of measurement for power (kw | kva) — defaults to kw for older saved projects
        const unitaPotenza = d.unitaPotenza || (proj.uiState && proj.uiState['sel-unit-potenza']) || 'kw';
        const isKva = unitaPotenza === 'kva';
        const unitLabel = isKva ? 'kVA' : 'kW';
        // Dynamic formula string for Ib
        let pSysForm;
        if (isKva) {
            pSysForm = paramIns.isTri
                ? 'Ib = S / (sqrt(3) * V)  [potenza apparente, cos(phi) non applicato]'
                : 'Ib = S / V  [potenza apparente, cos(phi) non applicato]';
        } else {
            pSysForm = paramIns.isTri
                ? 'Ib = P / (sqrt(3) * V * cos(phi))'
                : 'Ib = P / (V * cos(phi))';
        }

        // Tabella 1: Dati di Sistema
        doc.autoTable({
            startY: startY,
            head: [['Parametro', 'Valore', 'Unità']],
            body: [
                ['Architettura del sistema', pSys, '-'],
                ['Tensione di Esercizio', paramIns.v ? paramIns.v : '--', 'V'],
                ['Lunghezza Tratta', paramIns.l ? paramIns.l : '--', 'm'],
                ...(paramIns.load != null ? [['Potenza / Carico Immesso', paramIns.load, unitLabel]] : []),
                ...(!isKva ? [['Fattore di Potenza cos(phi)', paramIns.cosphi != null ? paramIns.cosphi : '--', '-']] : [])
            ],
            theme: 'striped',
            headStyles: { fillColor: [15, 76, 129] },
            margin: { left: 15, right: 15 }
        });

        // Tabella 2: Posa
        const posaVal = paramIns.posa || '';
        let rawPosaDesc = proj.uiState && proj.uiState['sel-posa-text'] ? proj.uiState['sel-posa-text'] : formatPosaName(posaVal);
        // Clean HTML/Formatting from posa description
        let posaDesc = rawPosaDesc.replace(/<[^>]*>?/gm, '').trim();
        let matDesc = paramIns.mat === 'rame' ? 'Rame' : 'Alluminio';
        let isoDesc = paramIns.iso === 'pvc_70C' ? 'PVC (70°C)' : 'EPR / XLPE (90°C)';

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
            styles: { overflow: 'linebreak' },
            margin: { left: 15, right: 15 }
        });

        // Tabella 3: Fattori K — dinamica per tipo posa
        const isInterrata = posaVal && posaVal.includes('interrato');
        const kArr = [];
        if (d.kFactors) {
            const tempCond = proj.uiState ? (proj.uiState['sel-temp'] + '°C') : '--';
            const groupCond = proj.uiState ? ('Gruppo ' + proj.uiState['sel-group']) : '--';

            kArr.push(['K1', 'Temperatura ambiente', tempCond, typeof d.kFactors.k1 === 'number' ? d.kFactors.k1.toFixed(3) : '--']);
            kArr.push(['K2', 'Raggruppamento circuiti', groupCond, typeof d.kFactors.k2 === 'number' ? d.kFactors.k2.toFixed(3) : '--']);

            if (isInterrata) {
                const depthCond = proj.uiState ? (proj.uiState['sel-depth'] + ' m') : '--';
                const resCond = proj.uiState ? (proj.uiState['sel-res'] + ' K\u00B7m/W') : '--';
                kArr.push(['K3', 'Profondità di posa', depthCond, typeof d.kFactors.k3 === 'number' ? d.kFactors.k3.toFixed(3) : '--']);
                kArr.push(['K4', 'Resistività termica terreno', resCond, typeof d.kFactors.k4 === 'number' ? d.kFactors.k4.toFixed(3) : '--']);
            }

            kArr.push([{ content: 'Ktot', styles: { fontStyle: 'bold' } }, { content: isInterrata ? 'Coefficiente Globale (K1*K2*K3*K4)' : 'Coefficiente Globale (K1*K2)', colSpan: 2, styles: { fontStyle: 'bold' } }, { content: typeof d.kFactors.ktot === 'number' ? d.kFactors.ktot.toFixed(3) : '--', styles: { fontStyle: 'bold' } }]);
        } else {
            kArr.push(['K Globale', 'Fattori Standard', '--', '1.000']);
        }

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Fattore', 'Significato', 'Valore Impostato', 'Valore K']],
            body: kArr,
            theme: 'striped',
            headStyles: { fillColor: [15, 76, 129] },
            styles: { overflow: 'linebreak' },
            margin: { left: 15, right: 15 }
        });

        // Tabella 4: Risultati finali
        const multiplier = paramIns.isTri ? '3x' : '';
        const nCavi = d.n || 1;
        const displaySec = (nCavi > 1)
            ? (paramIns.isTri ? `${nCavi}x(${multiplier}${d.section})` : `${nCavi}x${d.section}`)
            : `${multiplier}${d.section}`;
        const sezioneStr = displaySec + ' mm2';
        
        let valIn = (d.In !== undefined && d.In !== null) ? d.In : (d.in || null);
        let inStr = valIn != null ? valIn + ' A' : 'N/A';
        let coordCheckStr = 'N/A';
        let protTypeStr = 'N/A'; // declared here to avoid ReferenceError

        // MT Bypass override
        const pSysTens = (paramIns.v || 0) > 1000 ? 'MT' : 'BT';
        if (pSysTens === 'MT') {
            protTypeStr = 'Relè Programmabile (ANSI 51)';
            inStr = 'Impostazione a progetto';
            coordCheckStr = 'Verifica portata termica Iz >= Ib superata.';
        } else {
            protTypeStr = d.protType === 'mcb' ? 'Interruttore (MCB)' : (d.protType === 'fuse' ? 'Fusibile gG' : 'N/A');
            if (d.protType === 'mcb') {
                const ibStr = typeof d.ib === 'number' ? d.ib.toFixed(2) : 'N/A';
                const izStr = typeof d.iz === 'number' ? d.iz.toFixed(2) : 'N/A';
                coordCheckStr = `Verificato: Ib <= In <= Iz (${ibStr} <= ${valIn != null ? valIn : 'N/A'} <= ${izStr})`;
            } else if (d.protType === 'fuse') {
                const ibStr = typeof d.ib === 'number' ? d.ib.toFixed(2) : 'N/A';
                const reducedIz = typeof d.iz === 'number' ? (0.9 * d.iz).toFixed(2) : 'N/A';
                coordCheckStr = `Verificato: Ib <= In <= 0.9*Iz (${ibStr} <= ${valIn != null ? valIn : 'N/A'} <= ${reducedIz})`;
            }
        }

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 10,
            head: [['Esito Calcolo e Coordinamento', 'Valore']],
            body: [
                ['Corrente di Impiego (Ib)', typeof d.ib === 'number' ? d.ib.toFixed(2) + ' A' : '--'],
                ['Portata Corretta del Cavo (Iz)', typeof d.iz === 'number' ? d.iz.toFixed(2) + ' A' : '--'],
                ['Caduta di Tensione (Delta V)', typeof d.dv === 'number' ? d.dv.toFixed(2) + ' %' : '--'],
                ['Sezione Commerciale Adottata', sezioneStr],
                ['Dispositivo di Protezione', protTypeStr],
                ['Taglia (In)', inStr],
                ['Esito Coordinamento', coordCheckStr]
            ],
            theme: 'grid',
            headStyles: { fillColor: [10, 50, 85] },
            margin: { left: 15, right: 15 },
            styles: { font: "helvetica" }
        });

        // Metodologia e Formule
        let formulasY = doc.lastAutoTable.finalY + 15;
        
        // Add page if methodology doesn't fit
        if (formulasY > 250) {
            doc.addPage();
            formulasY = 20;
        }

        doc.setFontSize(14);
        doc.setTextColor(15, 76, 129);
        doc.setFont("helvetica", "bold");
        doc.text("Metodologia e Formule di Calcolo", 15, formulasY);
        
        doc.setFontSize(10);
        doc.setTextColor(80, 80, 80);
        doc.setFont("helvetica", "normal");
        
        const maxWidth = doc.internal.pageSize.getWidth() - 28; // 14px margins each side
        const formulaLines = [
            `1. Corrente d'impiego: ${pSysForm}`,
            `2. Portata corretta alla posa: Iz = I0 * Ktot * N`,
            `3. Caduta di Tensione: Delta V [%] = 100 * (K * L * Ib * ((R/N) * cos(phi) + (X/N) * sin(phi))) / V`,
            `4. Coordinamento CEI 64-8 (Solo BT): Ib <= In <= Iz (oppure <= 0.9 * Iz per fusibili).`
        ];
        
        let yPos = formulasY + 8;
        formulaLines.forEach(line => {
            const splitLines = doc.splitTextToSize(line, maxWidth);
            doc.text(splitLines, 14, yPos);
            yPos += splitLines.length * 6; // altezzaRiga = 6
        });
        
        if (d.hasAutoIncreased) {
             doc.setFont("helvetica", "italic");
             doc.setTextColor(230, 81, 0); // Orange highlight
             const noteText = "NOTA: La sezione del cavo è stata aumentata automaticamente per garantire il coordinamento con la taglia commerciale d'interruttore selezionata.";
             const splitNote = doc.splitTextToSize(noteText, maxWidth);
             doc.text(splitNote, 14, yPos + 2);
        }
    }

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "normal");
    doc.text("Generato da ElectroSuite v4.0 - Software e Algoritmi proprietari", 105, 285, null, null, "center");

    doc.save(`ElectroSuite_${proj.name.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
        console.error("Errore PDF:", error);
        alert("Errore durante la generazione del PDF: " + error.message);
    }
}
function loadExternalScripts() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js').catch(() => { });
    }
}
