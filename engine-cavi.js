// --- ENGINE-CAVI.JS: MOTORE DI CALCOLO – DIMENSIONAMENTO CAVI ---
const EngineCavi = {
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

                // Fattore K4 (Resistività terreno) - logica Famiglia
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

            // Fattore K2 (Raggruppamento) - logica basata su Famiglia
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
            // DRY: For BT, always use 'rame' as source of truth for base ampacity
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
    }
};
