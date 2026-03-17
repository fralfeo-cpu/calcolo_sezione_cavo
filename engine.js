// --- ENGINE.JS: MOTORE DI CALCOLO ELETTROSUITE ---
const ElectroEngine = {
    calculateIb: function(p, v, cosphi, isTri, isKva = false) {
        if (isKva) return isTri ? (p * 1000) / (Math.sqrt(3) * v) : (p * 1000) / v;
        return isTri ? (p * 1000) / (Math.sqrt(3) * v * cosphi) : (p * 1000) / (v * cosphi);
    },

    getKFactors: function(DB, inputs, nConductors = 1) {
        const { tens, posa, temp, group, depth, res, spacing } = inputs;
        // Calcola il moltiplicatore dei paralleli in base alla posa
        const parallelMultiplier = (spacing === 'spaced') ? 1 : nConductors;

        // Correzione MT: usa la tabella a 90C
        const iso = (tens === 'mt_media_tensione') ? 'epr_xlpe_90C' : inputs.iso;
        const env = posa && posa.includes('interrato') ? 'terreno' : 'aria';
        const kData = DB.fattori_correzione;
        
        let k1 = 1, k2 = 1, k3 = 1, k4 = 1;
        try {
            if (env === 'terreno') {
                k1 = kData.k1_temperatura_terreno[iso]?.[temp] || 1;
                const effGroup = Math.min(parseInt(group) * parallelMultiplier, 5).toString(); 
                let matchedK2 = kData.k2_raggruppamento_interrato[effGroup];
                if (!matchedK2) {
                    const keys = Object.keys(kData.k2_raggruppamento_interrato).map(Number).sort((a, b) => b - a);
                    matchedK2 = kData.k2_raggruppamento_interrato[keys[0]];
                }
                k2 = matchedK2 || 1;
                k3 = kData.k3_profondita_interrato[depth] || 1;
                k4 = kData.k4_resistivita_terreno[res] || 1;
            } else {
                k1 = kData.k1_temperatura_aria[iso]?.[temp] || 1;
                const effGroup = Math.min(parseInt(group) * parallelMultiplier, 6).toString();
                let matchedK2 = kData.k2_raggruppamento_aria[effGroup];
                if (!matchedK2) {
                    const keys = Object.keys(kData.k2_raggruppamento_aria).map(Number).sort((a, b) => b - a);
                    matchedK2 = kData.k2_raggruppamento_aria[keys[0]];
                }
                k2 = matchedK2 || 1;
            }
        } catch (e) { console.error("Errore Fattori K:", e); }
        return { k1, k2, k3, k4, ktot: k1 * k2 * k3 * k4 };
    },

    calculateCable: function(DB, inputs) {
        try {
            const { isTri, v, l, dvMax, inputType, load, cosphi, unitaPotenza, tens, mat, iso, posa, baseN, isAutoParallel, protType } = inputs;

            let ib = (inputType === 'p') ? this.calculateIb(load, v, cosphi, isTri, unitaPotenza === 'kva') : load;
            if (ib <= 0) return { status: 'INVALID_INPUT' };

            let portateSchema = (tens === 'bt_bassa_tensione') 
                ? (DB.portate_bt_bassa_tensione[iso]?.[mat]?.[posa] || DB.portate_bt_bassa_tensione[iso]?.['rame']?.[posa])
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
                    const iz = portateSchema[s] * kF.ktot * N;

                    if (iz >= ib) {
                        if (!firstValidSection) firstValidSection = s;
                        let In = null, isCoordOk = false;

                        if (tens === 'mt_media_tensione') {
                            In = 'ANSI_51';
                            isCoordOk = true; 
                        } else {
                            for (let val of inArray) { if (val >= ib) { In = val; break; } }
                            if (In === null) continue; 
                            isCoordOk = (protType === 'mcb') ? (In <= iz) : (In <= 0.9 * iz);
                        }
                        if (!isCoordOk) continue; 

                        const R = paramElettrici[s].R / N; 
                        const X = paramElettrici[s].X / N; 
                        const dvVolts = (k_phase * l * ib * (R * cosphi + X * sinphi)) / 1000;
                        const dvPerc = (dvVolts / v) * 100;

                        if (dvPerc <= dvMax) {
                            validSection = s; finalIz = iz; finalDv = dvPerc; finalN = N; finalKF = kF; finalIn = In;
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

    calculatePV: function(inputs) {
        try {
            const { vmaxdc, nmppt, imax, mpptmin, mpptmax, pmaxcc, pac, wp, beta, voc, isc, vmp, ntot, lcavo, tmin, tmax, protVal, protType } = inputs;
            const voc_tmin = voc * (1 + (beta / 100) * (tmin - 25));
            const vmp_tmax = vmp * (1 + (beta / 100) * (tmax - 25));
            const nmax = Math.min(Math.floor(vmaxdc / voc_tmin), Math.floor(mpptmax / vmp_tmax));
            const nmin = Math.ceil(mpptmin / vmp_tmax);
            
            let resto = ntot % nmppt;
            const isAsymmetric = resto !== 0;
            const mpptConfig = [];
            for (let i = 0; i < nmppt; i++) {
                let n_mod = Math.floor(ntot / nmppt) + (resto > 0 ? 1 : 0);
                if (resto > 0) resto--;
                mpptConfig.push({ mppt: i + 1, moduli: n_mod, vstr: n_mod * vmp, vsez: n_mod * voc_tmin, valid: (n_mod >= nmin && n_mod <= nmax) });
            }

            if (isc > imax) return { status: 'ERROR', errType: 'OVERCURRENT', msg: 'Corrente stringa > Imax Inverter' };
            if (mpptConfig[0].moduli * voc_tmin > vmaxdc) return { status: 'ERROR', errType: 'OVERVOLTAGE', msg: 'Tensione > Vmax Inverter' };
            if (mpptConfig[mpptConfig.length - 1].moduli * vmp_tmax < mpptmin) return { status: 'ERROR', errType: 'UNDERVOLTAGE', msg: 'Tensione < Vmppt min' };
            const ptot = (ntot * wp) / 1000;
            if (ptot > pmaxcc) return { status: 'ERROR', errType: 'POWERSATURATION', msg: 'Ptot > Pmax Inverter' };
            if (isAsymmetric && mpptConfig.some(cfg => !cfg.valid)) return { status: 'ERROR', errType: 'ASYMMETRY', msg: 'Ripartizione asimmetrica invalida' };

            const maxDvVolts = 0.015 * (mpptConfig[0].moduli * vmp);
            let cableSec = [4, 6, 10, 16, 25, 35].find(s => s >= (2 * lcavo * isc) / (56 * maxDvVolts)) || '>35';
            const izCavo = { 4: 44, 6: 57, 10: 79, 16: 107, 25: 142, 35: 175 }[cableSec] || '--';
            let dvReal = typeof cableSec === 'number' ? (((2 * lcavo * isc) / (56 * cableSec)) / (mpptConfig[0].moduli * vmp)) * 100 : 0;

            const fuseMin = 1.1 * (isc * 1.25);
            const fuseMax = (protType === 'fuse') ? protVal : (protVal * 1.35);
            let fuse = [10, 12, 15, 20, 25, 30, 32, 40].find(f => f >= fuseMin);
            if (!fuse || fuse > fuseMax) return { status: 'ERROR', errType: 'FUSE', msg: `Fusibile ${fuseMin.toFixed(1)}A > Max sopportabile` };

            return { type: 'pv', status: 'OK', nmin, nmax, ntot, nmppt, mpptConfig, isAsymmetric, ptot, dcac: (pac > 0 ? ptot/pac : ptot/pmaxcc).toFixed(2), cableSec, dvReal, fuse, v_sez: mpptConfig[0].vsez, isc, izCavo, inputs };
        } catch (e) { return { status: 'ERROR', msg: e.message }; }
    }
};
