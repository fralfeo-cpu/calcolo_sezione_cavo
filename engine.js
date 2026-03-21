// --- ENGINE.JS: MOTORE DI CALCOLO ELETTROSUITE ---
const ElectroEngine = {
    calculateIb: function (p, v, cosphi, isTri, isKva = false) {
        if (isKva) return isTri ? (p * 1000) / (Math.sqrt(3) * v) : (p * 1000) / v;
        return isTri ? (p * 1000) / (Math.sqrt(3) * v * cosphi) : (p * 1000) / (v * cosphi);
    },

    getKFactors: function (DB, inputs, nConductors = 1) {
        const { tens, posa, temp, group, depth, res, spacing, iso, mat } = inputs;
        const parallelMultiplier = (spacing === 'spaced') ? 1 : nConductors;
        const kData = DB.fattori_correzione;
        const isInterrato = posa && posa.includes('interrato');

        let k1 = 1, k2 = 1, k3 = 1, k4 = 1;
        try {
            // Fattore K1 (Temperatura)
            if (isInterrato) {
                k1 = kData.k1_temperatura_terreno[iso]?.[temp] || 1;
                k3 = kData.k3_profondita_interrato[depth] || 1;
                
                // Fattore K4 (Resistività terreno) - Nuova logica Famiglia
                let fK4 = (tens === 'bt_bassa_tensione') ?
                    (DB.portate_bt_bassa_tensione[iso]?.[mat]?.[posa]?.famiglia_k4 ||
                     DB.portate_bt_bassa_tensione[iso]?.['rame']?.[posa]?.famiglia_k4) : "multipolari";
                
                if (fK4 && kData.k4_resistivita_terreno[fK4]) {
                    k4 = kData.k4_resistivita_terreno[fK4][res] || 1;
                } else {
                    k4 = kData.k4_resistivita_terreno.multipolari[res] || 1;
                }
            } else {
                k1 = kData.k1_temperatura_aria[iso]?.[temp] || 1;
            }

            // Fattore K2 (Raggruppamento) - Nuova logica basata su Famiglia
            let famiglia = null;
            if (tens === 'bt_bassa_tensione') {
                famiglia = DB.portate_bt_bassa_tensione[iso]?.[mat]?.[posa]?.famiglia_k2 ||
                           DB.portate_bt_bassa_tensione[iso]?.['rame']?.[posa]?.famiglia_k2;
            }

            if (famiglia && kData.k2_raggruppamento[famiglia]) {
                let gData = kData.k2_raggruppamento[famiglia];
                
                // Gestione nidificazione per distanza (Interrati)
                if (isInterrato && typeof gData["a_contatto"] === 'object') {
                    const distKey = inputs.distanza || "a_contatto";
                    gData = gData[distKey] || gData["a_contatto"];
                }

                const effGroup = (parseInt(group) * parallelMultiplier).toString();
                let matchedK2 = gData[effGroup];
                if (!matchedK2) {
                    const keys = Object.keys(gData).map(Number).sort((a, b) => b - a);
                    matchedK2 = gData[keys[0]];
                }
                k2 = matchedK2 || 1;
            } else {
                k2 = 1; // Default
            }
        } catch (e) { console.error("Errore Fattori K:", e); }
        return { k1, k2, k3, k4, ktot: k1 * k2 * k3 * k4 };
    },

    calculateCable: function (DB, inputs) {
        try {
            const { isTri, v, l, dvMax, inputType, load, cosphi, unitaPotenza, tens, mat, iso, posa, baseN, isAutoParallel, protType } = inputs;

            let ib = (inputType === 'p') ? this.calculateIb(load, v, cosphi, isTri, unitaPotenza === 'kva') : load;
            if (ib <= 0) return { status: 'INVALID_INPUT' };

            const phaseKey = isTri ? 'trifase' : 'monofase';
            // DRY: For BT, we always use 'rame' as source of truth for base ampacity
            const effectiveMatKey = (tens === 'bt_bassa_tensione') ? 'rame' : mat;

            let portateSchema = (tens === 'bt_bassa_tensione')
                ? (DB.portate_bt_bassa_tensione[iso]?.[effectiveMatKey]?.[posa]?.[phaseKey])
                : (DB.portate_mt_media_tensione.xlpe_epr_90C?.[mat]?.[posa] || DB.portate_mt_media_tensione.xlpe_epr_90C?.['rame']?.[posa]);

            if (!portateSchema) return { status: 'NO_SCHEMA' };
            const paramElettrici = DB.parametri_elettrici[tens]?.[mat];
            if (!paramElettrici) return { status: 'NO_PARAMS' };

            const k_phase = isTri ? Math.sqrt(3) : 2;
            const phi = Math.acos(cosphi);
            const sinphi = Math.sin(phi);

            const sezioni = Object.keys(portateSchema).sort((a, b) => parseFloat(a) - parseFloat(b));
            const inArray = [2, 4, 6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250];

            let validSection = null, finalIz = 0, finalDv = 0, finalN = 1, finalKF = null, finalIn = null, firstValidSection = null;
            const maxN = isAutoParallel ? 20 : baseN;

            for (let N = baseN; N <= maxN; N++) {
                const kF = this.getKFactors(DB, inputs, N);

                for (let s of sezioni) {
                    if (!paramElettrici[s]) continue;
                    
                    let baseAmpacity = portateSchema[s];
                    
                    // DRY Logic: Aluminum in BT is 0.78 * Copper, and starts from 16mmq
                    if (tens === 'bt_bassa_tensione' && mat === 'alluminio') {
                        if (parseFloat(s) < 16) continue;
                        baseAmpacity = Math.round(baseAmpacity * 0.78 * 10) / 10;
                    }

                    const izEff = baseAmpacity * kF.ktot * N;

                    if (izEff >= ib) {
                        if (!firstValidSection) firstValidSection = s;
                        let protVal = null, isProtected = false;

                        if (tens === 'mt_media_tensione') {
                            protVal = 'ANSI_51';
                            isProtected = true;
                        } else {
                            for (let val of inArray) { if (val >= ib) { protVal = val; break; } }
                            if (protVal === null) continue;

                            // Definiamo la condizione di coordinamento In <= Iz (o In <= 0.9*Iz per fusibili)
                            let limitIz = izEff;
                            if (protType === 'fuse') {
                                limitIz = 0.9 * izEff; // Condizione In <= 0.9 * Iz per garantire I2 <= 1.45 * Iz
                            }

                            const cond1 = ib <= protVal; // Ib <= In
                            const cond2 = protVal <= limitIz; // In <= Iz (o 0.9*Iz)
                            isProtected = cond1 && cond2;
                        }

                        if (!isProtected) continue;

                        const R = paramElettrici[s].R / N;
                        const X = paramElettrici[s].X / N;
                        const dvVolts = (k_phase * l * ib * (R * cosphi + X * sinphi)) / 1000;
                        const dvPerc = (dvVolts / v) * 100;

                        if (dvPerc <= dvMax) {
                            validSection = s; finalIz = izEff; finalDv = dvPerc; finalN = N; finalKF = kF; finalIn = protVal;
                            break;
                        }
                    }
                }
                if (validSection) break;
            }

            if (validSection) {
                return { type: 'cable', status: 'OK', section: validSection, n: finalN, ib, iz: finalIz, dv: finalDv, In: finalIn, protType, hasAutoIncreased: (validSection !== firstValidSection), kFactors: finalKF, inputs };
            } else {
                return { type: 'cable', status: (isAutoParallel && maxN === 20) ? 'OUT_OF_SCALE' : 'SECTION_INSUFFICIENT', ib, iz: 0, dv: 0, section: '-' };
            }
        } catch (e) { return { status: 'ERROR', error: e.message }; }
    },

    calculatePV: function (inputs) {
        try {
            const { vmaxdc, imax, mpptmin, mpptmax, pmaxcc, pac, wp, beta, voc, isc, vmp, lcavo, tmin, tmax, protVal, protType } = inputs;
            const ntot = parseInt(inputs.ntot) || 0;
            const nmppt = parseInt(inputs.nmppt) || 1;
            const reqStringhe = parseInt(inputs.nStringhe) || 1; 

            let maxStringheEffettive = reqStringhe; 
            const mpptConfig = [];

            if (ntot > 0) {
                // Optimized Asymmetric Distribution Algorithm (Voltage Balancing)
                let bestConfig = [];
                let foundConfig = false;
                const voc_tmin = voc * (1 + (beta / 100) * (tmin - 25));
                const vmp_tmax = vmp * (1 + (beta / 100) * (tmax - 25));

                for (let k = nmppt; k >= 0; k--) {
                    const M = k * reqStringhe + (nmppt - k);
                    const ns = Math.floor(ntot / M);
                    const rem = ntot % M;

                    for (let j = 0; j <= k; j++) {
                        const l = rem - j * reqStringhe;
                        if (l >= 0 && l <= (nmppt - k)) {
                            for (let i = 0; i < j; i++) bestConfig.push({ moduli: (ns + 1) * reqStringhe, sEff: reqStringhe });
                            for (let i = 0; i < k - j; i++) bestConfig.push({ moduli: ns * reqStringhe, sEff: reqStringhe });
                            for (let i = 0; i < l; i++) bestConfig.push({ moduli: ns + 1, sEff: 1 });
                            for (let i = 0; i < (nmppt - k - l); i++) bestConfig.push({ moduli: ns, sEff: 1 });
                            foundConfig = true;
                            break;
                        }
                    }
                    if (foundConfig) break;
                }

                for (const cfg of bestConfig) {
                    const ns = cfg.moduli / cfg.sEff;
                    const vsez_test = ns * voc_tmin;

                    if (vsez_test > vmaxdc) {
                         return { status: 'ERROR', errType: 'OVERVOLTAGE_MPPT', msg: `ERRORE TENSIONE: La configurazione bilanciata (${ns} moduli in serie) genera ${vsez_test.toFixed(1)}V, superando il limite dell'inverter (${vmaxdc}V).` };
                    }

                    const istr_max_test = (isc * 1.25) * cfg.sEff;
                    if (istr_max_test > imax) {
                         return { status: 'ERROR', errType: 'OVERCURRENT_MPPT', msg: `ERRORE CORRENTE: L'ingresso con ${cfg.sEff} stringhe supera il limite MPPT (${imax}A).` };
                    }

                    const iscMppt = isc * cfg.sEff;
                    const maxDvVoltsMppt = 0.015 * (ns * vmp);
                    let cableSecMppt = [4, 6, 10, 16, 25, 35].find(s => s >= (2 * lcavo * iscMppt) / (56 * maxDvVoltsMppt)) || 4;
                    const izBaseMppt = { 4: 44, 6: 57, 10: 79, 16: 107, 25: 142, 35: 175 }[cableSecMppt] || 44;
                    const izEffMppt = izBaseMppt * 0.58;
                    const fuseMinMppt = isc * 1.25; 
                    const fuseMppt = [10, 12, 15, 20, 25, 30, 32, 40].find(f => f >= fuseMinMppt) || 15;

                    if (cfg.sEff > maxStringheEffettive) maxStringheEffettive = cfg.sEff;

                    mpptConfig.push({
                        mppt: mpptConfig.length + 1,
                        moduli: ns,
                        stringhe: cfg.sEff,
                        ns: ns,
                        vstr: ns * vmp,
                        vmin: ns * vmp_tmax,
                        vsez: vsez_test,
                        iscTot: iscMppt,
                        iscMax: (isc * 1.25) * cfg.sEff,
                        cable: cableSecMppt,
                        izEff: izEffMppt,
                        fuse: fuseMppt,
                        dv: (2 * lcavo * iscMppt * 100) / (56 * cableSecMppt * (ns * vmp)),
                        valid: true
                    });
                }
            }

            const pTot = (ntot * wp) / 1000;
            const allModuliSame = mpptConfig.length > 0 ? mpptConfig.every(m => m.moduli === mpptConfig[0].moduli) : true;
            const allStringsSame = mpptConfig.length > 0 ? mpptConfig.every(m => m.stringhe === mpptConfig[0].stringhe) : true;
            const isAsymmetric = !allModuliSame || !allStringsSame;

            const mainCable = mpptConfig.length > 0 ? Math.max(...mpptConfig.map(m => m.cable)) : 0;
            const mainFuse = mpptConfig.length > 0 ? Math.max(...mpptConfig.map(m => m.fuse)) : 0;
            const mainIzEff = mpptConfig.length > 0 ? Math.min(...mpptConfig.map(m => m.izEff)) : 0;

            const finalResult = { 
                type: 'pv', 
                status: 'OK', 
                nmin: mpptConfig.length > 0 ? Math.min(...mpptConfig.map(m => m.moduli)) : 0, 
                nmax: mpptConfig.length > 0 ? Math.max(...mpptConfig.map(m => m.moduli)) : 0, 
                ntot: ntot, 
                nmppt, 
                mpptConfig, 
                isAsymmetric, 
                ptot: pTot, 
                dcac: (pac > 0 ? pTot / pac : pTot / pmaxcc).toFixed(2), 
                cableSec: mainCable, 
                dvReal: mpptConfig.length > 0 ? Math.max(...mpptConfig.map(m => m.dv)) : 0,
                fuse: mainFuse, 
                v_sez: mpptConfig.length > 0 ? Math.max(...mpptConfig.map(m => m.vsez)) : 0, 
                isc: isc, 
                izBase: mpptConfig.length > 0 ? Math.min(...mpptConfig.map(m => {
                        return { 4: 44, 6: 57, 10: 79, 16: 107, 25: 142, 35: 175 }[m.cable] || 44;
                })) : 44, 
                izEff: mainIzEff, 
                inputs 
            };

            return finalResult || { status: 'ERROR', msg: 'Parametri non validi' };
        } catch (e) { return { status: 'ERROR', msg: e.message }; }
    }
};
