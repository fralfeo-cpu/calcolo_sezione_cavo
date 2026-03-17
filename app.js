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
    if (typeof updateParallelSpacingVisibility === 'function') updateParallelSpacingVisibility();
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

    // Accordion logic (Generic for all cards with .accordion class)
    document.querySelectorAll('.accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const accordion = header.closest('.accordion');
            if (accordion) {
                accordion.classList.toggle('open');
            }
        });
    });

    // Input listeners for main calculation
    const inputs = ['in-v', 'in-l', 'in-load', 'in-cosphi', 'in-dvmax', 'sel-iso', 'sel-posa', 'sel-temp', 'sel-group', 'sel-depth', 'sel-res', 'sel-n-cavi', 'sel-parallel-spacing'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                if (id === 'sel-posa' || id === 'sel-iso') updateLists();
                if (id === 'sel-n-cavi') updateParallelSpacingVisibility();
                validateForm('sec-calc');
            });
        }
    });

    const chAutoParallel = document.getElementById('ch-auto-parallel');
    if (chAutoParallel) {
        chAutoParallel.addEventListener('change', () => {
            updateParallelSpacingVisibility();
            validateForm('sec-calc');
        });
    }

    function updateParallelSpacingVisibility() {
        const nCavi = parseInt(document.getElementById('sel-n-cavi')?.value) || 1;
        const isAuto = document.getElementById('ch-auto-parallel')?.checked || false;
        const wrap = document.getElementById('wrap-parallel-spacing');
        if (wrap) {
            if (nCavi > 1 || isAuto) {
                wrap.classList.remove('hidden-anim');
                wrap.style.display = 'block';
                // Trigger reflow for animation
                void wrap.offsetWidth;
                wrap.classList.add('visible-anim');
            } else {
                wrap.classList.remove('visible-anim');
                wrap.classList.add('hidden-anim');
                // Wait for animation to finish before hiding display
                setTimeout(() => {
                    if (wrap.classList.contains('hidden-anim')) {
                        wrap.style.display = 'none';
                    }
                }, 300);
            }
        }
    }

    // Re-initialize Lucide icons to render both static and dynamic icons
    if (window.lucide) {
        window.lucide.createIcons();
    }

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
    const pvInputIds = PV_INPUT_IDS_ALL;
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
    const currentTemp = tempSelect.value;
    const k1Key = env === 'terreno' ? 'k1_temperatura_terreno' : 'k1_temperatura_aria';
    const activeIso = (tens === 'mt_media_tensione') ? 'epr_xlpe_90C' : iso;
    const temps = Object.keys(kData[k1Key][activeIso] || {});
    tempSelect.innerHTML = temps.map(t => {
        const isSelected = currentTemp ? (t === currentTemp) : (t === '30');
        return `<option value="${t}" ${isSelected ? 'selected' : ''}>${t}</option>`;
    }).join('');

    // K2 Group
    const groupSelect = document.getElementById('sel-group');
    const currentGroup = groupSelect.value;
    const groupKey = env === 'terreno' ? 'k2_raggruppamento_interrato' : 'k2_raggruppamento_aria';
    const groups = Object.keys(kData[groupKey] || {});
    groupSelect.innerHTML = groups.map(g => {
        const isSelected = currentGroup ? (g === currentGroup) : false;
        return `<option value="${g}" ${isSelected ? 'selected' : ''}>${g}</option>`;
    }).join('');

    // K3 & K4
    const depthSelect = document.getElementById('sel-depth');
    const currentDepth = depthSelect.value;
    const depths = Object.keys(kData.k3_profondita_interrato || {});
    depthSelect.innerHTML = depths.map(d => {
        const isSelected = currentDepth ? (d === currentDepth) : (d === '0.8');
        return `<option value="${d}" ${isSelected ? 'selected' : ''}>${d}</option>`;
    }).join('');

    const resSelect = document.getElementById('sel-res');
    const currentRes = resSelect.value;
    const res = Object.keys(kData.k4_resistivita_terreno || {});
    resSelect.innerHTML = res.map(r => {
        const isSelected = currentRes ? (r === currentRes) : false;
        return `<option value="${r}" ${isSelected ? 'selected' : ''}>${r}</option>`;
    }).join('');

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

/**
 * Utility to sync custom select UI when underlying native select is changed programmatically
 */
function syncCustomSelects(selectId) {
    const select = document.getElementById(selectId);
    if (!select || !select.classList.contains('upgraded')) return;

    const wrapper = select.nextElementSibling;
    if (wrapper && wrapper.classList.contains('custom-select-wrapper')) {
        const span = wrapper.querySelector('.custom-select-trigger span');
        if (span) span.textContent = select.options[select.selectedIndex]?.text || '';

        wrapper.querySelectorAll('.custom-option').forEach(o => {
            o.classList.remove('selected');
            if (o.textContent === (select.options[select.selectedIndex]?.text || '')) {
                o.classList.add('selected');
            }
        });
    }
}function performCalculation() {
    const inputs = {
        isTri: document.querySelector('#pill-sys .active').getAttribute('data-val') === 'tri',
        v: parseFloat(document.getElementById('in-v').value) || (document.querySelector('#pill-sys .active').getAttribute('data-val') === 'tri' ? 400 : 230),
        l: parseFloat(document.getElementById('in-l').value) || 1,
        dvMax: parseFloat(document.getElementById('in-dvmax').value) || 4,
        inputType: document.querySelector('#pill-input-type .active').getAttribute('data-val'),
        load: parseFloat(document.getElementById('in-load').value) || 0,
        cosphi: parseFloat(document.getElementById('in-cosphi').value) || 0.9,
        unitaPotenza: document.getElementById('sel-unit-potenza')?.value || 'kw',
        tens: document.querySelector('#pill-tens .active').getAttribute('data-val'),
        mat: document.querySelector('#pill-mat .active').getAttribute('data-val'),
        iso: document.getElementById('sel-iso').value,
        posa: document.getElementById('sel-posa').value,
        baseN: parseInt(document.getElementById('sel-n-cavi')?.value) || 1,
        isAutoParallel: document.getElementById('ch-auto-parallel')?.checked || false,
        spacing: document.getElementById('sel-parallel-spacing')?.value || 'touching',
        protType: document.querySelector('#pill-prot .active').getAttribute('data-val'),
        temp: document.getElementById('sel-temp').value,
        group: document.getElementById('sel-group').value,
        depth: document.getElementById('sel-depth')?.value || '0.8',
        res: document.getElementById('sel-res')?.value || '1.0'
    };

    currentResult = ElectroEngine.calculateCable(DB, inputs);
    
    if (currentResult.status === 'OK') setUISuccess(currentResult);
    else {
        currentResult.ib = inputs.load; // fallback per UI
        setUIFatalError();
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
    const msgEl = document.getElementById('pv-compat-error-msg');
    if (!errCard) return;
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = msg;
    errCard.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
}

function pvHideCompatError() {
    const errCard = document.getElementById('pv-compat-error-card');
    if (errCard) errCard.classList.add('hidden');
}

function calculatePV() {
    const inputs = {
        vmaxdc: parseFloat(document.getElementById('in-pv-vmaxdc')?.value),
        nmppt: parseInt(document.getElementById('in-pv-nmppt')?.value) || 1,
        imax: parseFloat(document.getElementById('in-pv-imax')?.value),
        mpptmin: parseFloat(document.getElementById('in-pv-mpptmin')?.value),
        mpptmax: parseFloat(document.getElementById('in-pv-mpptmax')?.value),
        pmaxcc: parseFloat(document.getElementById('in-pv-pmaxcc')?.value),
        pac: parseFloat(document.getElementById('in-pv-pac')?.value),
        wp: parseFloat(document.getElementById('in-pv-wp')?.value),
        beta: parseFloat(document.getElementById('in-pv-beta')?.value),
        voc: parseFloat(document.getElementById('in-pv-voc')?.value),
        isc: parseFloat(document.getElementById('in-pv-isc')?.value),
        vmp: parseFloat(document.getElementById('in-pv-vmp')?.value),
        ntot: parseInt(document.getElementById('in-pv-ntot')?.value),
        lcavo: parseFloat(document.getElementById('in-pv-lcavo')?.value),
        tmin: parseFloat(document.getElementById('in-pv-tmin')?.value),
        tmax: parseFloat(document.getElementById('in-pv-tmax')?.value),
        protVal: parseFloat(document.getElementById('in-pv-prot-val')?.value) || 25,
        protType: document.getElementById('in-pv-prot-type')?.value || 'fuse',
        inverterName: document.getElementById('sel-preset-inverter')?.options[document.getElementById('sel-preset-inverter')?.selectedIndex]?.text || '',
        moduleName: document.getElementById('sel-preset-pannello')?.options[document.getElementById('sel-preset-pannello')?.selectedIndex]?.text || ''
    };

    // Clean names if they are placeholders
    if (inputs.inverterName.includes('--')) inputs.inverterName = '';
    if (inputs.moduleName.includes('--')) inputs.moduleName = '';

    if (Object.values(inputs).some(v => Number.isNaN(v))) return; 

    currentResult = ElectroEngine.calculatePV(inputs);

    if (currentResult.status === 'OK') {
        pvHideCompatError();
        const resData = document.getElementById('pv-res-data');
        const placeholder = document.getElementById('pv-res-placeholder');
        const card = document.getElementById('pv-result-card');
        const warning = document.getElementById('pv-res-warning');
        if (!resData || !placeholder || !card) return;

        placeholder.classList.add('hidden');
        resData.classList.remove('hidden');
        card.classList.remove('ok', 'error');
        card.classList.add('ok');

        // Dati generali
        document.getElementById('pv-res-kwp').textContent = currentResult.ptot.toFixed(2) + ' kWp';
        const dcacEl = document.getElementById('pv-res-dcac');
        if (dcacEl) dcacEl.textContent = currentResult.dcac;

        // Architecture summary
        document.getElementById('pv-res-arch-text').textContent = currentResult.isAsymmetric
            ? `${currentResult.nmppt} MPPT · Asimmetrica`
            : `${currentResult.nmppt} MPPT · ${currentResult.mpptConfig[0].moduli} mod/str · Simmetrica`;

        // Thermal limits grid
        document.getElementById('pv-res-range').textContent = `${currentResult.nmin} → ${currentResult.nmax} mod.`;
        
        // Calculate Voc @ Tmin and Vmp @ Tmax for the string (1 string)
        const voc_tmin_string = inputs.voc * (1 + (inputs.beta / 100) * (inputs.tmin - 25)) * currentResult.mpptConfig[0].moduli;
        const vmp_tmax_string = inputs.vmp * (1 + (inputs.beta / 100) * (inputs.tmax - 25)) * currentResult.mpptConfig[0].moduli;

        const vocTminEl = document.getElementById('pv-res-voc-tmin');
        const vmpTmaxEl = document.getElementById('pv-res-vmp-tmax');
        if (vocTminEl) vocTminEl.textContent = `${voc_tmin_string.toFixed(0)} V`;
        if (vmpTmaxEl) vmpTmaxEl.textContent = `${vmp_tmax_string.toFixed(0)} V`;

        // Quadro CC
        document.getElementById('pv-res-cavo').textContent = `${currentResult.cableSec} mm² | Iz: ${currentResult.izCavo} A | Caduta: ${currentResult.dvReal.toFixed(2)}%`;
        document.getElementById('pv-res-fuse').textContent = `${currentResult.fuse}A gPV`;
        document.getElementById('pv-res-sez').textContent = '> ' + currentResult.v_sez.toFixed(0) + ' V';
        document.getElementById('pv-res-isc-str').textContent = currentResult.isc.toFixed(2) + ' A';
        document.getElementById('pv-res-vstr').textContent = (currentResult.mpptConfig[0].moduli * inputs.vmp).toFixed(1) + ' V';

        // Dynamic MPPT rows
        const dynContainer = document.getElementById('pv-mppt-dynamic-rows');
        if (dynContainer) {
            dynContainer.innerHTML = '';
            currentResult.mpptConfig.forEach(cfg => {
                const badge = `MPPT ${cfg.mppt}`;
                const bgColor = currentResult.isAsymmetric ? 'var(--primary)' : 'var(--success)';
                dynContainer.innerHTML += `
                    <div class="mppt-row">
                        <div class="mppt-badge" style="background:${bgColor};color:#fff;">${badge}</div>
                        <div class="mppt-details">
                            <span class="mppt-text">1 stringa da <strong>${cfg.moduli}</strong> moduli</span>
                            <span class="mppt-voc">Voc_max: ${cfg.vsez.toFixed(0)} V</span>
                        </div>
                    </div>
                `;
                if (!currentResult.isAsymmetric) return; 
            });
            if (!currentResult.isAsymmetric && currentResult.mpptConfig.length > 1) {
                dynContainer.innerHTML += `<div class="mppt-warning" style="color:var(--success);border-color:var(--success);"><i data-lucide="check-circle-2" style="width:13px;height:13px;"></i> Tutte le ${currentResult.nmppt} stringhe identiche</div>`;
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
    } else {
        pvShowCompatError('ERRORE', currentResult.msg);
        pvResetResultCard();
    }
}


// Reset result card when a blocking error is shown
function pvResetResultCard() {
    const resData = document.getElementById('pv-res-data');
    const placeholder = document.getElementById('pv-res-placeholder');
    const card = document.getElementById('pv-result-card');
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
    } catch (e) { return []; }
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
        gamma: document.getElementById('in-pv-gamma')?.value,
        protVal: document.getElementById('in-pv-prot-val')?.value,
        protType: document.getElementById('in-pv-prot-type')?.value
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
        if (preset.protVal !== undefined) document.getElementById('in-pv-prot-val').value = preset.protVal;
        if (preset.protType !== undefined) {
            document.getElementById('in-pv-prot-type').value = preset.protType;
            syncCustomSelects('in-pv-prot-type');
        }
    }
    validateForm('sec-fotovoltaico');
    if (typeof calculatePV === 'function') calculatePV();
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
const PV_INPUT_IDS_ALL = ['in-pv-vmaxdc', 'in-pv-nmppt', 'in-pv-imax', 'in-pv-mpptmin', 'in-pv-mpptmax', 'in-pv-pmaxcc', 'in-pv-pac', 'in-pv-wp', 'in-pv-beta', 'in-pv-voc', 'in-pv-isc', 'in-pv-vmp', 'in-pv-ntot', 'in-pv-lcavo', 'in-pv-tmin', 'in-pv-tmax', 'in-pv-gamma', 'in-pv-prot-val', 'in-pv-prot-type'];

function buildUiState() {
    const uiState = {};
    const selects = ['sel-iso', 'sel-posa', 'sel-temp', 'sel-group', 'sel-depth', 'sel-res', 'sel-n-cavi', 'sel-unit-potenza', 'sel-parallel-spacing'];
    const inputIds = ['in-v', 'in-l', 'in-load', 'in-cosphi', 'in-dvmax', ...PV_INPUT_IDS_ALL];
    const pills = ['pill-sys', 'pill-input-type', 'pill-tens', 'pill-mat', 'pill-prot'];
    selects.forEach(id => { const el = document.getElementById(id); if (el) uiState[id] = el.value; });
    inputIds.forEach(id => { const el = document.getElementById(id); if (el) uiState[id] = el.value; });
    pills.forEach(id => { const el = document.querySelector(`#${id} .active`); if (el) uiState[id] = el.getAttribute('data-val'); });
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
            const detailStr = `Sezione: ${displaySec} mm² | Iz: ${(p.data.iz || 0).toFixed(1)} A`;
            listCavi.innerHTML += `
            <div class="archive-card cable">
                <div class="archive-card-header" onclick="restoreProject(${p.id})">
                    <div class="archive-card-icon"><i data-lucide="cable"></i></div>
                    <div class="archive-card-info">
                        <div class="archive-info-title">${p.name || 'Senza Nome'}</div>
                        <div class="archive-info-sub">
                            <div><i data-lucide="calendar" style="width:12px;height:12px;display:inline;margin-right:4px;"></i>${p.date || ''}</div>
                            <div style="margin-top:2px; color:var(--accent-cable); font-weight:700;">${detailStr}</div>
                        </div>
                    </div>
                </div>
                <div class="archive-card-actions">
                     <button class="icon-btn" style="color:var(--success)" onclick="restoreProject(${p.id})" title="Apri"><i data-lucide="external-link"></i></button>
                     <button class="icon-btn" style="color:var(--primary)" onclick="exportPDF(${p.id})" title="PDF"><i data-lucide="file-text"></i></button>
                     <button class="icon-btn text-error" onclick="deleteProj(${p.id})" title="Elimina"><i data-lucide="trash-2"></i></button>
                </div>
            </div>`;
        });
    }

    if (projFv.length === 0) {
        listFv.innerHTML = createEmpty('Nessun progetto Fotovoltaico.');
    } else {
        projFv.reverse().forEach(p => {
            const detailStr = `Range Moduli: ${p.data.nmin} - ${p.data.nmax}`;
            listFv.innerHTML += `
            <div class="archive-card fv">
                <div class="archive-card-header" onclick="restoreProject(${p.id})">
                    <div class="archive-card-icon"><i data-lucide="sun"></i></div>
                    <div class="archive-card-info">
                        <div class="archive-info-title">${p.name || 'Senza Nome'}</div>
                        <div class="archive-info-sub">
                            <div><i data-lucide="calendar" style="width:12px;height:12px;display:inline;margin-right:4px;"></i>${p.date || ''}</div>
                            <div style="margin-top:2px; color:var(--accent-fv); font-weight:700;">${detailStr}</div>
                        </div>
                    </div>
                </div>
                <div class="archive-card-actions">
                     <button class="icon-btn" style="color:var(--success)" onclick="restoreProject(${p.id})" title="Apri"><i data-lucide="external-link"></i></button>
                     <button class="icon-btn" style="color:var(--primary)" onclick="exportPDF(${p.id})" title="PDF"><i data-lucide="file-text"></i></button>
                     <button class="icon-btn text-error" onclick="deleteProj(${p.id})" title="Elimina"><i data-lucide="trash-2"></i></button>
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
            <div class="archive-card preset">
                <div class="archive-card-header" onclick="restorePresetInv('${inv.id}')">
                    <div class="archive-card-icon"><i data-lucide="cpu"></i></div>
                    <div class="archive-card-info">
                        <div class="archive-info-title">${inv.name}</div>
                        <div class="archive-info-sub">Preset Inverter</div>
                    </div>
                </div>
                <div class="archive-card-actions">
                     <button class="icon-btn" style="color:var(--accent-archive)" onclick="restorePresetInv('${inv.id}')" title="Usa"><i data-lucide="plus-circle"></i></button>
                     <button class="icon-btn text-error" onclick="deletePresetGlobal('${inv.id}')" title="Elimina"><i data-lucide="trash-2"></i></button>
                </div>
            </div>`;
        });
        presetPan.forEach(pan => {
            listPreset.innerHTML += `
            <div class="archive-card preset">
                <div class="archive-card-header" onclick="restorePresetPan('${pan.id}')">
                    <div class="archive-card-icon"><i data-lucide="layout-grid"></i></div>
                    <div class="archive-card-info">
                        <div class="archive-info-title">${pan.name}</div>
                        <div class="archive-info-sub">Preset Pannello</div>
                    </div>
                </div>
                <div class="archive-card-actions">
                     <button class="icon-btn" style="color:var(--accent-archive)" onclick="restorePresetPan('${pan.id}')" title="Usa"><i data-lucide="plus-circle"></i></button>
                     <button class="icon-btn text-error" onclick="deletePresetGlobal('${pan.id}')" title="Elimina"><i data-lucide="trash-2"></i></button>
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
        ['pill-sys', 'pill-input-type', 'pill-tens', 'pill-mat', 'pill-prot'].forEach(pillId => {
            if (ui[pillId]) {
                const group = document.getElementById(pillId);
                if (group) {
                    group.querySelectorAll('.pill').forEach(btn => btn.classList.remove('active'));
                    const targetBtn = group.querySelector(`[data-val="${ui[pillId]}"]`);
                    if (targetBtn) targetBtn.classList.add('active');
                }
            }
        });

        // Phase 1b: Restore sel-iso early because updateLists depends on it
        const selIso = document.getElementById('sel-iso');
        if (selIso && ui['sel-iso']) selIso.value = ui['sel-iso'];

        const selUnit = document.getElementById('sel-unit-potenza');
        if (selUnit && ui['sel-unit-potenza']) selUnit.value = ui['sel-unit-potenza'];

        // Phase 2: Populate dynamic selects with correct context
        updateLists();
    }

    // Phase 3: Set all saved inputs and selects, then fire change events
    Object.keys(ui).forEach(key => {
        const el = document.getElementById(key);
        if (el && el.tagName === 'INPUT' && el.type !== 'checkbox') {
            el.value = ui[key];
            if (isPv) el.dispatchEvent(new Event('input', { bubbles: true })); // Trigger event for validation later
        } else if (el && el.tagName === 'SELECT') {
            el.value = ui[key];
            if (el.classList.contains('upgraded')) syncCustomSelects(key);
            // ALWAYS dispatch change to ensure UI triggers (like temp/terra visibility) are hit
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (isPv) el.dispatchEvent(new Event('input', { bubbles: true }));
        } else if (key === 'ch-auto-parallel') {
            const check = document.getElementById('ch-auto-parallel');
            if (check) { 
                check.checked = ui[key]; 
                check.dispatchEvent(new Event('change', { bubbles: true })); 
            }
        }
    });

    // Phase 4: Validate and recalculate
    if (isPv) {
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
window.restorePresetInv = function (id) { loadPreset('inverter', id); navigateTo('sec-fotovoltaico'); showToast("Preset Inverter caricato!"); };
window.restorePresetPan = function (id) { loadPreset('pannello', id); navigateTo('sec-fotovoltaico'); showToast("Preset Pannello caricato!"); };
window.deletePresetGlobal = function (id) {
    if (id.startsWith('inv_')) {
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
    reader.onload = function (e) {
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
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const d = proj.data;
        const brandColor = [15, 76, 129]; // Classic Blue
        const darkBg = [33, 37, 41]; // Slate Dark
        const accentColor = [230, 126, 34]; // Orange accent for headers
        let startY = 75;

        // --- ENCODING HELPER (Moved to top) ---
        const safeStr = (str) => {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/\u00b7/g, ' \u00b7 ')
                .replace(/\u2264/g, ' \u2264 ')
                .replace(/\u2265/g, ' \u2265 ')
                .replace(/\u00b0/g, '\u00b0')
                .replace(/\u00b2/g, '\u00b2');
        };

        const renderMath = (doc, formula, centerX, y, fontSize) => {
            const mathMap = {
                '\\Delta': { char: 'D', font: 'Symbol' },
                '\\rho':   { char: 'r', font: 'Symbol' },
                '\\phi':   { char: 'f', font: 'Symbol' },
                '\\cdot':  { char: '\xd7', font: 'Symbol' }, // formal multiplication '×'
                '\\le':    { char: '\xa3', font: 'Symbol' }, // less equal '≤' (163)
                '\\ge':    { char: '\xb3', font: 'Symbol' }, // greater equal '≥' (179)
                '\\sqrt':  { char: '\xd6', font: 'Symbol' }, // radical '√' (214)
                '\\cos':   { char: 'cos', font: 'helvetica' },
                '\\sin':   { char: 'sin', font: 'helvetica' }
            };

            const parseToSegments = (str) => {
                if (!str) return [];
                const parts = str.split(/(\\\w+)/g);
                return parts.filter(p => p !== "").map(p => {
                    if (mathMap[p]) return { text: mathMap[p].char, font: mathMap[p].font, isCmd: true };
                    // Strip grouping braces if they were left over from LaTeX commands like \sqrt{3}
                    let clean = p.replace(/[\{\}]/g, '');
                    return { text: clean, font: 'helvetica', isCmd: false };
                });
            };

            const getSegsW = (segs, size) => {
                let w = 0;
                segs.forEach(s => {
                    doc.setFont(s.font, s.isCmd ? 'normal' : 'bolditalic');
                    doc.setFontSize(size);
                    w += doc.getTextWidth(s.text);
                });
                return w;
            };

            const drawSegs = (segs, startX, startY, size) => {
                let cx = startX;
                segs.forEach(s => {
                    doc.setFont(s.font, s.isCmd ? 'normal' : 'bolditalic');
                    doc.setFontSize(size);
                    doc.text(s.text, cx, startY);
                    cx += doc.getTextWidth(s.text);
                });
                return cx;
            };

            doc.setTextColor(0, 0, 0);

            if (formula.includes('\\frac')) {
                const fracMatch = formula.match(/(.*?)\\frac\{(.*?)\}\{(.*?)\}(.*)/);
                if (fracMatch) {
                    const segBefore = parseToSegments(fracMatch[1]);
                    const segNum = parseToSegments(fracMatch[2]);
                    const segDen = parseToSegments(fracMatch[3]);
                    const segAfter = parseToSegments(fracMatch[4]);

                    const wB = getSegsW(segBefore, fontSize);
                    const wN = getSegsW(segNum, fontSize * 0.85);
                    const wD = getSegsW(segDen, fontSize * 0.85);
                    const wA = getSegsW(segAfter, fontSize);
                    const fW = Math.max(wN, wD) + 4;
                    
                    let sx = centerX - ((wB + fW + wA) / 2);
                    if (wB > 0) sx = drawSegs(segBefore, sx, y + 1.5, fontSize);
                    
                    const fCenterX = sx + (fW / 2);
                    // Even tighter internal spacing
                    drawSegs(segNum, fCenterX - (wN / 2), y - 1.8, fontSize * 0.85);
                    drawSegs(segDen, fCenterX - (wD / 2), y + 4.5, fontSize * 0.85);
                    
                    doc.setLineWidth(0.4);
                    doc.setDrawColor(0, 0, 0);
                    doc.line(sx + 1, y, sx + fW - 1, y);
                    
                    if (wA > 0) drawSegs(segAfter, sx + fW + 1, y + 1.5, fontSize);
                    return;
                }
            }

            if (formula.includes('_{')) {
                const parts = formula.split(/(_{.*?})/g);
                const allSegs = parts.map(p => {
                    const isSub = p.startsWith('_{') && p.endsWith('}');
                    const content = isSub ? p.substring(2, p.length - 1) : p;
                    return { segs: parseToSegments(content), isSub: isSub };
                });

                let totalW = 0;
                allSegs.forEach(as => totalW += getSegsW(as.segs, as.isSub ? fontSize * 0.7 : fontSize));

                let sx = centerX - (totalW / 2);
                allSegs.forEach(as => {
                    sx = drawSegs(as.segs, sx, as.isSub ? y + 2 : y, as.isSub ? fontSize * 0.7 : fontSize);
                });
                return;
            }

            const segs = parseToSegments(formula);
            drawSegs(segs, centerX - (getSegsW(segs, fontSize) / 2), y, fontSize);
        };

        // Helper: Accented Section Title
        const drawSectionTitle = (text, y) => {
            doc.setFillColor(...brandColor);
            doc.rect(14, y - 4, 1.5, 5, 'F');
            doc.setTextColor(40, 40, 40);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.text(text.toUpperCase(), 18, y);
            return y + 8;
        };

        // Helper: Render text with centered formulas
        const renderSectionContent = (text, x, y, width) => {
            const mathMap = {
                '\\Delta': { char: 'D', font: 'Symbol' },
                '\\rho':   { char: 'r', font: 'Symbol' },
                '\\phi':   { char: 'f', font: 'Symbol' },
                '\\cdot':  { char: '\xd7', font: 'Symbol' }
            };

            const blocks = text.split(/(\[F\].*?\[\/F\])/g);
            let currentY = y;

            blocks.forEach(block => {
                if (block.startsWith('[F]') && block.endsWith('[/F]')) {
                    if (currentY > 260) { doc.addPage(); currentY = 25; }
                    const formula = block.substring(3, block.length - 4);
                    currentY += 6; // Increased space before the formula
                    renderMath(doc, formula, 105, currentY, 11.5);
                    currentY += 12; // Increased space after the formula
                    doc.setFont("helvetica", "normal");
                } else {
                    const cleanBlock = block.trim();
                    if (!cleanBlock) return;

                    const brParts = cleanBlock.split('\n');
                    brParts.forEach(bp => {
                        const richParts = [];
                        let processedText = bp.replace(/\[iF\](.*?)\[\/iF\]/g, (match, p1) => {
                            const placeholder = `\uE000${richParts.length}\uE000`;
                            richParts.push(p1);
                            return placeholder;
                        });

                        doc.setFont("helvetica", "normal");
                        doc.setFontSize(9.5);
                        doc.setTextColor(50, 50, 50);
                        
                        const lines = doc.splitTextToSize(safeStr(processedText), width);
                        lines.forEach(line => {
                            if (currentY > 275) { doc.addPage(); currentY = 25; doc.setFontSize(9.5); }
                            
                            let curX = x;
                            const lineParts = line.split(/(\uE000\d+\uE000)/g);
                            
                            lineParts.forEach(lp => {
                                if (lp.startsWith('\uE000') && lp.endsWith('\uE000')) {
                                    const idx = parseInt(lp.substring(1, lp.length - 1));
                                    const formula = richParts[idx];
                                    
                                    if (mathMap[formula]) {
                                        doc.setFont(mathMap[formula].font, "normal");
                                        doc.setFontSize(11);
                                        doc.text(mathMap[formula].char, curX, currentY);
                                        curX += doc.getTextWidth(mathMap[formula].char);
                                    } else {
                                        // Inline Subscript Support: e.g. [iF]\Delta V_{max}[/iF]
                                        if (formula.includes('_{')) {
                                            const subMatch = formula.match(/(.*)_{(.*)}/);
                                            if (subMatch) {
                                                const main = subMatch[1];
                                                const sub = subMatch[2];
                                                
                                                // Render main part
                                                if (mathMap[main]) {
                                                    doc.setFont(mathMap[main].font, "normal");
                                                    doc.setFontSize(11);
                                                    doc.text(mathMap[main].char, curX, currentY);
                                                    curX += doc.getTextWidth(mathMap[main].char);
                                                } else {
                                                    doc.setFont("helvetica", "bolditalic");
                                                    doc.setFontSize(11);
                                                    const cleanMain = main.replace(/\\/g, '');
                                                    doc.text(cleanMain, curX, currentY);
                                                    curX += doc.getTextWidth(cleanMain);
                                                }
                                                
                                                // Render subscript
                                                doc.setFont("helvetica", "bolditalic");
                                                doc.setFontSize(8);
                                                doc.text(sub, curX, currentY + 1.2);
                                                curX += doc.getTextWidth(sub);
                                                doc.setFontSize(9.5);
                                            }
                                        } else {
                                            doc.setFont("helvetica", "bolditalic");
                                            doc.setFontSize(11);
                                            const cleanCmd = formula.replace(/\\/g, '');
                                            doc.text(cleanCmd, curX, currentY);
                                            curX += doc.getTextWidth(cleanCmd);
                                        }
                                    }
                                    doc.setFont("helvetica", "normal");
                                    doc.setFontSize(9.5);
                                } else {
                                    doc.text(lp, curX, currentY);
                                    curX += doc.getTextWidth(lp);
                                }
                            });
                            currentY += 5.5;
                        });
                    });
                }
            });
            return currentY;
        };


        // Header Corporate (Dark & Modern)
        doc.setFillColor(...darkBg);
        doc.rect(0, 0, 210, 35, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.text("ELECTROSUITE", 14, 18);

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(180, 180, 180);
        doc.text("RELAZIONE TECNICA DI DIMENSIONAMENTO ESECUTIVO", 14, 26);

        // Metadata (Right Aligned)
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.text(`Data Documento: ${safeStr(proj.date)}`, 196, 18, { align: 'right' });
        doc.text(`Identificativo Progetto: ${safeStr(proj.name || 'Standard')}`, 196, 26, { align: 'right' });

        // Hero Box (The Result in Focus)
        let mainResultHeader = "";
        let mainResultVal = "";

        if (d.type === 'pv') {
            // Summary text removed per user request (was CONFIGURAZIONE IMPIANTO FV)
        } else {
            const multiplier = (d.inputs && d.inputs.isTri) ? '3x' : '';
            const nCavi = d.n || 1;
            const displaySec = (nCavi > 1)
                ? (d.inputs && d.inputs.isTri ? `${nCavi}x(${multiplier}${d.section})` : `${nCavi}x${d.section}`)
                : `${multiplier}${d.section}`;
            
            mainResultHeader = "CONDUTTORE ADOTTATO:";
            mainResultVal = `Sezione: ${displaySec} mm² | Iz Corretta: ${d.iz.toFixed(1)} A`;

            // Draw Hero Box ONLY for Cable Sizing
            doc.setFillColor(245, 250, 255);
            doc.setDrawColor(...brandColor);
            doc.setLineWidth(0.3);
            doc.roundedRect(14, 42, 182, 20, 2, 2, 'FD');

            doc.setTextColor(...brandColor);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(9);
            doc.text(mainResultHeader, 18, 50);

            doc.setFontSize(14);
            doc.setTextColor(20, 20, 20);
            doc.text(safeStr(mainResultVal), 18, 57);
        }

        // --- COMPONENT MODELS (Prominent for PV) ---
        if (d.type === 'pv') {
            let modelY = 48;
            if (d.inputs.inverterName || d.inputs.moduleName) {
                doc.setFontSize(10);
                doc.setTextColor(60, 60, 60);
                doc.setFont("helvetica", "bold");
                let modelText = "";
                if (d.inputs.moduleName) modelText += `PRESET MODULO: ${d.inputs.moduleName.toUpperCase()}`;
                if (d.inputs.inverterName) {
                   if (modelText) modelText += "  |  ";
                   modelText += `PRESET INVERTER: ${d.inputs.inverterName.toUpperCase()}`;
                }
                doc.text(safeStr(modelText), 14, modelY);
                startY = modelY + 10;
            } else {
                startY = 45;
            }
        } else {
            startY = 75;
        }

        // Standard autoTable theme configuration
        const cleanTableTheme = {
            theme: 'plain',
            styles: {
                font: 'helvetica',
                fontSize: 8.5,
                cellPadding: 3,
                textColor: [60, 60, 60],
                lineColor: [235, 235, 235],
                lineWidth: { bottom: 0.1 }
            },
            headStyles: {
                fillColor: [248, 249, 250],
                textColor: [33, 37, 41],
                fontStyle: 'bold',
                lineWidth: { bottom: 0.4 },
                lineColor: brandColor
            },
            alternateRowStyles: {
                fillColor: [254, 254, 254]
            },
        };


        if (proj.data.type === 'pv') {
            const d = proj.data;

            startY = drawSectionTitle("Specifiche Componenti Inverter", startY);
            const invBody = [];
            if (d.inputs.inverterName) invBody.push(['Preset Selezionato', safeStr(d.inputs.inverterName.toUpperCase()), '-']);
            invBody.push(
                ['Tensione Massima DC (Vmaxdc)', d.inputs.vmaxdc, 'V'],
                ['Range MPPT Operativo (Min/Max)', `${d.inputs.mpptmin} \u2013 ${d.inputs.mpptmax}`, 'V'],
                ['Corrente Massima MPPT (Imax)', d.inputs.imax, 'A'],
                ['Potenza Massima Ingresso CC', d.inputs.pmaxcc, 'kW'],
                ...(d.inputs.pac != null && !isNaN(d.inputs.pac) ? [['Potenza Nominale CA', d.inputs.pac, 'kW']] : []),
                ['Numero di MPPT indipendenti', d.inputs.nmppt, '-']
            );

            doc.autoTable({
                ...cleanTableTheme,
                startY: startY,
                head: [['Dato Tecnico Inverter', 'Valore', 'Unit\u00e0']],
                body: invBody,
            });

            startY = doc.lastAutoTable.finalY + 10;
            startY = drawSectionTitle("Specifiche Modulo Fotovoltaico", startY);
            const modBody = [];
            if (d.inputs.moduleName) modBody.push(['Preset Selezionato', safeStr(d.inputs.moduleName.toUpperCase()), '-']);
            modBody.push(
                ['Potenza di Picco (Wp)', d.inputs.wp, 'Wp'],
                ['Tensione Voc / Vmp STC', `${d.inputs.voc} V / ${d.inputs.vmp} V`, '-'],
                ['Corrente Isc STC', d.inputs.isc, 'A'],
                ['Coeff. Temperatura Beta (Voc)', d.inputs.beta, '%/\u00b0C'],
                ['Protezione Sottesa (Max)', `${d.inputs.protVal} A (${d.inputs.protType === 'fuse' ? 'Fusibile' : 'OCPR'})`, '-'],
                ...(d.inputs.gamma != null ? [['Coeff. Temp. Gamma (Pmax)', d.inputs.gamma, '%/\u00b0C']] : []),
                ['Range Temperatura Progetto', `${d.inputs.tmin}\u00b0C a ${d.inputs.tmax}\u00b0C`, '-'],
                ['Numero Moduli Totali', d.inputs.ntot, 'pz']
            );

            doc.autoTable({
                ...cleanTableTheme,
                startY: startY,
                head: [['Dato Tecnico Modulo', 'Valore', 'Unit\u00e0']],
                body: modBody,
            });

            startY = doc.lastAutoTable.finalY + 10;
            startY = drawSectionTitle("Configurazione Stringhe per MPPT", startY);
            const mpptRows = d.mpptConfig.map(cfg => [
                `Ingresso MPPT ${cfg.mppt}`,
                `${cfg.moduli} moduli in serie`,
                `${cfg.vsez != null ? cfg.vsez.toFixed(1) : '--'} V`,
                `${(cfg.moduli * (d.inputs ? d.inputs.vmp : 0)).toFixed(1)} V`
            ]);
            doc.autoTable({
                ...cleanTableTheme,
                startY: startY,
                head: [['Canale', 'Configurazione', 'Voc Max (-10\u00b0C)', 'Vmp STC']],
                body: mpptRows,
            });

            startY = doc.lastAutoTable.finalY + 10;
            startY = drawSectionTitle("Dimensionamento Quadro CC", startY);
            doc.autoTable({
                ...cleanTableTheme,
                startY: startY,
                head: [['Elemento Quadro CC', 'Specifica']],
                body: [
                    ['Sezione Cavo Solare CC', `${d.cableSec} mm\u00b2`],
                    ['Portata Cavo alla Posa (Iz)', `${d.izCavo} A`],
                    ['Caduta di Tensione (Delta V%)', `${typeof d.cableSec === 'number' ? d.dvReal.toFixed(2) : '--'} %`],
                    ['Protezione di Stringa', `${d.fuse}A gPV`],
                    ['Scaricatore Sovratensioni (SPD)', `Ucpv >= ${d.v_sez.toFixed(0)} V`],
                ],
            });

            startY = doc.lastAutoTable.finalY + 10;
            startY = drawSectionTitle("Sintesi Verifiche Elettriche", startY);
            doc.autoTable({
                ...cleanTableTheme,
                startY: startY,
                head: [['Verifica Normativa', 'Esito', 'Dettaglio Tecnico']],
                body: [
                    ['Over-Current (Isc <= Imax MPPT)', 'SUPERATA', safeStr(`Isc = ${d.inputs.isc} A <= Imax = ${d.inputs.imax} A`)],
                    ['Over-Voltage a Tmin (Vstr <= Vmax)', 'SUPERATA', safeStr(`Vstr_max = ${d.v_sez.toFixed(1)} V <= ${d.inputs.vmaxdc} V`)],
                    ['Under-Voltage a Tmax (Vstr >= Vmin)', 'SUPERATA', safeStr(`Vstr_min >= ${d.inputs.mpptmin} V`)],
                    ['Power Saturation (Ptot <= Pmaxcc)', 'SUPERATA', safeStr(`Ptot = ${d.ptot.toFixed(2)} kW <= Pmaxcc = ${d.inputs.pmaxcc} kW`)],
                    ['Rapporto DC/AC (Ptot / Pac)', 'VERIFICATO', safeStr(`Ratio = ${d.dcac || (d.ptot/(d.inputs.pac||1)).toFixed(2)}`)],
                ],
                columnStyles: {
                    1: { fontStyle: 'bold', textColor: [39, 174, 96], halign: 'center' }
                }
            });

            if (d.isAsymmetric) {
                let asymY = doc.lastAutoTable.finalY + 6;
                doc.setFontSize(8);
                doc.setFont('helvetica', 'italic');
                doc.setTextColor(80, 80, 80);
                doc.text(`Nota: Configurazione asimmetrica – i ${d.inputs.ntot} moduli non si dividono equamente su ${d.inputs.nmppt} MPPT.`, 15, asymY);
            }

            // --- NUOVA PAGINA: RELAZIONE TECNICA E METODOLOGIA (PV) ---
            doc.addPage();
            let yPos = 30;
            const marginX = 14;
            const maxW = 182;

            // Titolo Pagina con Sfondo Moderno
            doc.setFillColor(...brandColor);
            doc.rect(marginX, yPos - 12, maxW, 14, 'F');
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(255, 255, 255);
            doc.text("APPROFONDIMENTO TECNICO E METODOLOGIA DI CALCOLO (PV)", marginX + 5, yPos - 2.5);

            yPos += 12;

            const sections = [
                {
                    title: "1. Dimensionamento Cavi Solari (Lato Corrente Continua)",
                    text: "Le sezioni dei cavi solari sono calcolate per garantire che la portata Iz, opportunamente declassata in base ai fattori di correzione per temperatura e tipo di posa (Norme CEI-UNEL e CEI 64-8), sia sempre superiore alla corrente massima della stringa. La caduta di tensione percentuale ([iF]\\Delta V[/iF]%) sul tratto in Corrente Continua \u00e8 verificata tramite la formula: [F]\\Delta V = \\frac{2 \\cdot L \\cdot I \\cdot \\rho}{S}[/F] dove [iF]\\rho[/iF] \u00e8 la resistivit\u00e0 del rame alla temperatura di esercizio, L \u00e8 la lunghezza della linea e I \u00e8 la corrente di impiego."
                },
                {
                    title: "2. Protezione contro le Sovracorrenti (Fusibili Lato CC)",
                    text: "Il dimensionamento delle protezioni di stringa (fusibili gPV) rispetta la Norma CEI 64-8, art. 712. Per configurazioni con 1 o 2 stringhe in parallelo per singolo MPPT indipendente, la protezione non \u00e8 normativamente richiesta in quanto le correnti inverse non possono superare la portata del modulo. Per 3 o pi\u00f9 stringhe in parallelo, la taglia nominale del fusibile (In) \u00e8 calcolata per rispettare il range: [F]1,1 \\cdot Isc_{max} \\le In \\le Limite Modulo[/F] Isc_{max} \u00e8 pari alla Isc in STC maggiorata del 25%: [F]Isc_{max} = Isc \\cdot 1,25[/F] Il 'Limite Modulo' corrisponde alla Taglia Max Fusibile dichiarata dal costruttore, oppure al valore della Corrente Inversa Massima (I_MOD_MAX_OCPR) moltiplicata per 1,35."
                },
                {
                    title: "3. Protezione contro le Sovratensioni (SPD Lato CC)",
                    text: "La scelta dello Scaricatore di Sovratensione (SPD) lato continua viene effettuata verificando che la tensione massima continuativa dell'SPD (Ucpv) sia maggiore o uguale alla massima tensione a vuoto generata dalla stringa (Voc_{max}). La Voc_{max} viene calcolata partendo dalla Voc in condizioni STC e applicando il coefficiente di temperatura del pannello (Beta) riferito alla temperatura minima di progetto dell'impianto (es. -10\u00b0C)."
                }
            ];

            sections.forEach(s => {
                if (yPos > 260) { doc.addPage(); yPos = 25; }
                
                // Accent Line for Section
                doc.setDrawColor(...brandColor);
                doc.setLineWidth(0.5);
                doc.line(marginX, yPos, marginX + 10, yPos);

                doc.setFont("helvetica", "bold");
                doc.setFontSize(10.5);
                doc.setTextColor(...brandColor);
                doc.text(s.title, marginX, yPos + 6);
                yPos += 12;

                yPos = renderSectionContent(s.text, marginX + 2, yPos, maxW - 6);
            });

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

            startY = drawSectionTitle("Dati di Riferimento Sistema", startY);
            doc.autoTable({
                ...cleanTableTheme,
                startY: startY,
                head: [['Parametro di Progetto', 'Valore', 'Unit\u00e0']],
                body: [
                    ['Architettura del sistema', pSys, '-'],
                    ['Tensione di Esercizio (V)', paramIns.v ? paramIns.v : '--', 'V'],
                    ['Lunghezza Tratta Linea', paramIns.l ? paramIns.l : '--', 'm'],
                    ...(paramIns.load != null ? [['Potenza / Carico Nominale', paramIns.load, unitLabel]] : []),
                    ...(!isKva ? [['Fattore di Potenza cos(phi)', paramIns.cosphi != null ? paramIns.cosphi : '--', '-']] : [])
                ],
            });

            startY = doc.lastAutoTable.finalY + 10;
            startY = drawSectionTitle("Metodo di Posa e Conduttori", startY);
            const posaVal = paramIns.posa || '';
            let rawPosaDesc = proj.uiState && proj.uiState['sel-posa-text'] ? proj.uiState['sel-posa-text'] : formatPosaName(posaVal);
            let posaDesc = rawPosaDesc.replace(/<[^>]*>?/gm, '').trim();
            let matDesc = paramIns.mat === 'rame' ? 'Rame' : 'Alluminio';
            let isoDesc = paramIns.iso === 'pvc_70C' ? 'PVC (70\u00b0C)' : 'EPR / XLPE (90\u00b0C)';

            doc.autoTable({
                ...cleanTableTheme,
                startY: startY,
                head: [['Caratteristica Posa', 'Specifica Tecnica']],
                body: [
                    ['Metodo di Posa', posaDesc],
                    ['Materiale Conduttore', matDesc],
                    ['Materiale Isolante', isoDesc]
                ],
            });

            startY = doc.lastAutoTable.finalY + 10;
            startY = drawSectionTitle("Fattori di Correzione (K)", startY);
            if (d.kFactors) {
                const kArr = [];
                const tempCond = proj.uiState ? (proj.uiState['sel-temp'] + '\u00b0C') : '--';
                const groupCond = proj.uiState ? ('Gruppo ' + proj.uiState['sel-group']) : '--';
                const isInterrata = posaVal && posaVal.includes('interrato');

                kArr.push(['K1', 'Temperatura ambiente', tempCond, d.kFactors.k1.toFixed(3)]);
                kArr.push(['K2', 'Raggruppamento circuiti', groupCond, d.kFactors.k2.toFixed(3)]);
                if (isInterrata) {
                    kArr.push(['K3', 'Profondit\u00e0 di posa', proj.uiState['sel-depth'] + ' m', d.kFactors.k3.toFixed(3)]);
                    kArr.push(['K4', 'Resistivit\u00e0 termica', proj.uiState['sel-res'] + ' K\u00b7m/W', d.kFactors.k4.toFixed(3)]);
                }
                kArr.push(['Ktot', 'Coefficiente Globale Applicato', '--', d.kFactors.ktot.toFixed(3)]);

                doc.autoTable({
                    ...cleanTableTheme,
                    startY: startY,
                    head: [['Sigla', 'Descrizione Fattore', 'Condizione', 'Valore K']],
                    body: kArr,
                });
            }

            startY = doc.lastAutoTable.finalY + 10;
            startY = drawSectionTitle("Sintesi Risultati di Calcolo", startY);
            const multiplier = paramIns.isTri ? '3x' : '';
            const nCavi = d.n || 1;
            const displaySec = (nCavi > 1)
                ? (paramIns.isTri ? `${nCavi}x(${multiplier}${d.section})` : `${nCavi}x${d.section}`)
                : `${multiplier}${d.section}`;

            let valIn = (d.In !== undefined && d.In !== null) ? d.In : (d.in || null);
            let inStr = valIn != null ? valIn + ' A' : 'N/A';
            let coordCheckStr = 'N/A';
            let protTypeStr = d.protType === 'mcb' ? 'Interruttore (MCB)' : (d.protType === 'fuse' ? 'Fusibile gG' : 'N/A');

            if ((paramIns.v || 0) > 1000) {
                protTypeStr = 'ANSI 51 (MV Protection)';
                inStr = 'Set by Project';
                coordCheckStr = 'Termica Iz >= Ib verificata.';
            } else {
                if (d.protType === 'mcb') {
                    coordCheckStr = `Superata: Ib <= In <= Iz (${d.ib.toFixed(1)} <= ${valIn} <= ${d.iz.toFixed(1)})`;
                } else {
                    coordCheckStr = `Superata: Ib <= In <= 0.9*Iz (${d.ib.toFixed(1)} <= ${valIn} <= ${(0.9 * d.iz).toFixed(1)})`;
                }
            }

            doc.autoTable({
                ...cleanTableTheme,
                startY: startY,
                head: [['Variabile di Output', 'Valore Progetto']],
                body: [
                    ['Corrente di Impiego (Ib)', d.ib.toFixed(2) + ' A'],
                    ['Portata Corretta (Iz)', d.iz.toFixed(2) + ' A'],
                    ['Sezione Commerciale', displaySec + ' mm\u00b2'],
                    ['Caduta di Tensione (Delta V)', d.dv.toFixed(2) + ' %'],
                    ['Taglia Protezione (In)', inStr],
                    ['Coordinamento (Norma CEI 64-8)', coordCheckStr]
                ],
                columnStyles: {
                    1: { fontStyle: 'bold' }
                }
            });

            // --- NUOVA PAGINA: RELAZIONE TECNICA (CABLING) ---
            doc.addPage();
            let yPosMethod = 25;
            const marginXM = 14;
            const maxWM = 182;

            doc.setFillColor(...brandColor);
            doc.rect(marginXM, yPosMethod - 12, maxWM, 14, 'F');
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.setTextColor(255, 255, 255);
            doc.text("APPROFONDIMENTO TECNICO E CRITERI DI DIMENSIONAMENTO", marginXM + 5, yPosMethod - 2.5);

            yPosMethod += 12;

            let methodSections = [];
            const isTri = d.inputs && d.inputs.isTri;
            const isMT = (paramIns.v || 0) > 1000;

            if (!isTri) {
                // 1) MONOFASE
                methodSections = [
                    {
                        title: "1. Calcolo della Corrente di Impiego (Ib)",
                        text: "La corrente di impiego viene determinata in base alla potenza del carico immessa a progetto e alle caratteristiche della rete di alimentazione. Per i circuiti in corrente alternata monofase, il calcolo della corrente assorbita si basa sulla seguente relazione: [F]Ib = \\frac{P \\cdot 1000}{V \\cdot cos\\phi}[/F] dove P \u00e8 la potenza attiva espressa in kW, V \u00e8 la tensione nominale del sistema (tipicamente 230 V) e [iF]cos\\phi[/iF] \u00e8 il fattore di potenza del carico. Per potenze espresse in kVA, il termine del fattore di potenza viene omesso dal denominatore."
                    },
                    {
                        title: "2. Portata del Cavo (Iz) e Fattori di Correzione",
                        text: "La portata nominale del conduttore (I0) viene estratta in base al tipo di isolante (es. PVC, EPR/XLPE) e al metodo di posa, in stretta conformit\u00e0 alle tabelle CEI-UNEL 35024 (posa in aria) e CEI-UNEL 35026 (posa interrata). Tale portata tabellare viene opportunamente declassata applicando i coefficienti di correzione per ottenere la portata effettiva di impiego (Iz):\nK1: Fattore di correzione per temperatura ambiente (riferimento normativo 30\u00b0C in aria, 20\u00b0C nel terreno).\nK2: Fattore di correzione per raggruppamento di pi\u00f9 circuiti o cavi posati in prossimit\u00e0.\nK3: Fattore di correzione per la profondit\u00e0 di posa (applicabile solo ai cavi interrati, riferimento 0.8 m).\nK4: Fattore di correzione per la resistivit\u00e0 termica del terreno (riferimento 1.5 K\u00b7m/W).\nLa portata effettiva \u00e8 calcolata come: [F]Iz = I0 \\cdot K1 \\cdot K2 \\cdot K3 \\cdot K4 \\cdot n[/F] dove n rappresenta il numero di conduttori in parallelo."
                    },
                    {
                        title: "3. Coordinamento delle Protezioni contro i Sovraccarichi",
                        text: "Il dimensionamento del conduttore e la scelta del dispositivo di protezione vengono eseguiti nel rigoroso rispetto delle condizioni imposte dalla Norma CEI 64-8. Affinch\u00e9 il cavo sia protetto contro il sovraccarico, la corrente nominale (o di regolazione) del dispositivo di protezione (In) deve soddisfare la disuguaglianza fondamentale: [F]Ib \\le In \\le Iz[/F] L'algoritmo di calcolo verifica iterativamente le sezioni commerciali fino a individuare la sezione minima che garantisce l'esito positivo di tale coordinamento termico."
                    },
                    {
                        title: "4. Verifica della Caduta di Tensione (Delta V)",
                        text: "A garanzia della corretta alimentazione delle utenze finali, viene verificata la caduta di tensione lungo la linea, tenendo conto sia della componente resistiva che di quella reattiva del cavo e considerando sia il conduttore di fase che quello di neutro. Per i sistemi monofase, la caduta di tensione percentuale viene calcolata tramite l'equazione: [F]\\Delta V% = \\frac{2 \\cdot L \\cdot Ib \\cdot (R \\cdot cos\\phi + X \\cdot sin\\phi)}{1000 \\cdot V} \\cdot 100[/F] dove L \u00e8 la lunghezza della tratta in metri, R e X sono rispettivamente la resistenza e la reattanza chilometrica del cavo (in Ohm/km) alla temperatura di regime ordinario. Il software valida la sezione solo se il valore ottenuto risulta strettamente inferiore o uguale al limite massimo [iF]\\Delta V_{max}[/iF] impostato dal progettista."
                    }
                ];
            } else if (!isMT) {
                // 2) TRIFASE BT
                methodSections = [
                    {
                        title: "1. Calcolo della Corrente di Impiego (Ib)",
                        text: "La corrente di impiego viene determinata in base alla potenza del carico immessa a progetto e alle caratteristiche della rete di alimentazione. Per i sistemi trifase, il calcolo della corrente assorbita si basa sulla seguente relazione: [F]Ib = \\frac{P \\cdot 1000}{\\sqrt{3} \\cdot V \\cdot cos\\phi}[/F] dove P \u00e8 la potenza attiva espressa in kW, V \u00e8 la tensione concatenata in Volt e cos phi \u00e8 il fattore di potenza del carico. Per potenze espresse in kVA, il termine del fattore di potenza viene omesso dal denominatore."
                    },
                    {
                        title: "2. Portata del Cavo (Iz) e Fattori di Correzione",
                        text: "La portata nominale del conduttore (I0) viene estratta in base al tipo di isolante (es. PVC, EPR/XLPE) e al metodo di posa, in stretta conformit\u00e0 alle tabelle CEI-UNEL 35024 (posa in aria) e CEI-UNEL 35026 (posa interrata). Tale portata tabellare viene opportunamente declassata applicando i coefficienti di correzione per ottenere la portata effettiva di impiego (Iz):\nK1: Fattore di correzione per temperatura ambiente (riferimento normativo 30\u00b0C in aria, 20\u00b0C nel terreno).\nK2: Fattore di correzione per raggruppamento di pi\u00f9 circuiti o cavi posati in prossimit\u00e0.\nK3: Fattore di correzione per la profondit\u00e0 di posa (applicabile solo ai cavi interrati, riferimento 0.8 m).\nK4: Fattore di correzione per la resistivit\u00e0 termica del terreno (riferimento 1.5 K\u00b7m/W).\nLa portata effettiva \u00e8 calcolata come: [F]Iz = I0 \\cdot K1 \\cdot K2 \\cdot K3 \\cdot K4 \\cdot n[/F] dove n rappresenta il numero di conduttori in parallelo per fase."
                    },
                    {
                        title: "3. Coordinamento delle Protezioni contro i Sovraccarichi",
                        text: "Il dimensionamento del conduttore e la scelta del dispositivo di protezione vengono eseguiti nel rigoroso rispetto delle condizioni imposte dalla Norma CEI 64-8. Affinch\u00e9 il cavo sia protetto contro il sovraccarico, la corrente nominale (o di regolazione) del dispositivo di protezione (In) deve soddisfare la disuguaglianza fondamentale: [F]Ib \\le In \\le Iz[/F] L'algoritmo di calcolo verifica iterativamente le sezioni commerciali fino a individuare la sezione minima che garantisce l'esito positivo di tale coordinamento termico."
                    },
                    {
                        title: "4. Verifica della Caduta di Tensione (Delta V)",
                        text: "A garanzia della corretta alimentazione delle utenze finali, viene verificata la caduta di tensione lungo la linea, tenendo conto sia della componente resistiva che di quella reattiva del cavo. Per i sistemi trifase, la caduta di tensione percentuale viene calcolata tramite l'equazione: [F]\\Delta V% = \\frac{\\sqrt{3} \\cdot L \\cdot Ib \\cdot (R \\cdot cos\\phi + X \\cdot sin\\phi)}{1000 \\cdot V} \\cdot 100[/F] dove L \u00e8 la lunghezza della tratta in metri, R e X sono rispettivamente la resistenza e la reattanza chilometrica del cavo (in Ohm/km) alla temperatura di regime ordinario. Il software valida la sezione solo se il valore ottenuto risulta strettamente inferiore o uguale al limite massimo [iF]\\Delta V_{max}[/iF] impostato dal progettista."
                    }
                ];
            } else {
                // 3) TRIFASE MT
                methodSections = [
                    {
                        title: "1. Calcolo della Corrente di Impiego (Ib)",
                        text: "La corrente di impiego viene determinata in base alla potenza del carico immessa a progetto e alle caratteristiche della rete di alimentazione. Per i sistemi trifase, il calcolo della corrente assorbita si basa sulla seguente relazione: [F]Ib = \\frac{P \\cdot 1000}{\\sqrt{3} \\cdot V \\cdot cos\\phi}[/F] dove P \u00e8 la potenza attiva espressa in kW, V \u00e8 la tensione concatenata in Volt e [iF]cos\\phi[/iF] \u00e8 il fattore di potenza del carico. Per potenze espresse in kVA, il termine del fattore di potenza viene omesso dal denominatore."
                    },
                    {
                        title: "2. Portata del Cavo (Iz) e Fattori di Correzione",
                        text: "La portata nominale del conduttore (I0) viene estratta in base al tipo di isolante (es. PVC, EPR/XLPE) e al metodo di posa, in stretta conformit\u00e0 alle tabelle CEI-UNEL 35024 (posa in aria) e CEI-UNEL 35026 (posa interrata). Per gli impianti in Media Tensione si fa riferimento alla Norma CEI 11-17. Tale portata tabellare viene opportunamente declassata applicando i coefficienti di correzione per ottenere la portata effettiva di impiego (Iz):\nK1: Fattore di correzione per temperatura ambiente (riferimento normativo 30\u00b0C in aria, 20\u00b0C nel terreno).\nK2: Fattore di correzione per raggruppamento di pi\u00f9 circuiti o cavi posati in prossimit\u00e0.\nK3: Fattore di correzione per la profondit\u00e0 di posa (applicabile solo ai cavi interrati, riferimento 0.8 m).\nK4: Fattore di correzione per la resistivit\u00e0 termica del terreno (riferimento 1.5 K[iF]\\cdot[/iF]m/W).\nLa portata effettiva \u00e8 calcolata come: [F]Iz = I0 \\cdot K1 \\cdot K2 \\cdot K3 \\cdot K4 \\cdot n[/F] dove n rappresenta il numero di conduttori in parallelo per fase."
                    },
                    {
                        title: "3. Verifica della Caduta di Tensione (Delta V)",
                        text: "A garanzia della corretta alimentazione delle utenze finali, viene verificata la caduta di tensione lungo la linea, tenendo conto sia della componente resistiva che di quella reattiva del cavo. Per i sistemi trifase, la caduta di tensione percentuale viene calcolata tramite l'equazione: [F]\\Delta V% = \\frac{\\sqrt{3} \\cdot L \\cdot Ib \\cdot (R \\cdot cos\\phi + X \\cdot sin\\phi)}{1000 \\cdot V} \\cdot 100[/F] dove L \u00e8 la lunghezza della tratta in metri, R e X sono rispettivamente la resistenza e la reattanza chilometrica del cavo (in Ohm/km) alla temperatura di regime ordinario. Il software valida la sezione solo se il valore ottenuto risulta strettamente inferiore o uguale al limite massimo [iF]\\Delta V_{max}[/iF] impostato dal progettista."
                    }
                ];
            }

            methodSections.forEach(s => {
                doc.setDrawColor(...brandColor);
                doc.setLineWidth(0.5);
                doc.line(marginXM, yPosMethod, marginXM + 10, yPosMethod);

                doc.setFont("helvetica", "bold");
                doc.setFontSize(10.5);
                doc.setTextColor(...brandColor);
                doc.text(s.title, marginXM, yPosMethod + 6);
                yPosMethod += 12;

                yPosMethod = renderSectionContent(s.text, marginXM + 2, yPosMethod, maxWM - 6);
            });
        }

        // -- Footer (Page numbers & Branding) --
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            
            // Footer Line
            doc.setDrawColor(220, 220, 220);
            doc.setLineWidth(0.2);
            doc.line(14, 282, 196, 282);

            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);
            doc.setTextColor(120, 120, 120);
            doc.text("Relazione Generata da ElectroSuite v4.0 \u2014 Professional Electrical Design Suite", 14, 288);
            doc.text(`Pagina ${i} di ${totalPages}`, 196, 288, { align: "right" });
        }

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
// Initializing icons on load
if (window.lucide) {
    window.lucide.createIcons();
}
