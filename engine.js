// --- ENGINE.JS: MOTORE DI CALCOLO ELETTROSUITE ---
const ElectroEngine = {
    calculateIb: function (p, v, cosphi, isTri, isKva = false) {
        if (isKva) return isTri ? (p * 1000) / (Math.sqrt(3) * v) : (p * 1000) / v;
        return isTri ? (p * 1000) / (Math.sqrt(3) * v * cosphi) : (p * 1000) / (v * cosphi);
    },

    getKFactors: function (DB, inputs, nConductors = 1) {
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

    calculateCable: function (DB, inputs) {
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
                    const izEff = portateSchema[s] * kF.ktot * N;

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
            const reqStringhe = parseInt(inputs.nStringhe) || 1; // Stringhe richieste dall'utente

            let max_iter = 50;
            let ns_min = 1;

            // Variabile per tracciare lo scenario peggiore (parallelo massimo effettivo) per i cavi
            let maxStringheEffettive = reqStringhe; 

            if (ntot > 0) {
                // 1. Ripartizione moduli sugli MPPT (permette asimmetria tra gli MPPT)
                const baseModuli = Math.floor(ntot / nmppt);
                const remModuli = ntot % nmppt;
                
                // Array dei possibili carichi sui singoli MPPT (es. [10, 11] se 21 moduli su 2 MPPT)
                const mpptConfigs = [];
                if (baseModuli > 0) mpptConfigs.push(baseModuli);
                if (remModuli > 0) mpptConfigs.push(baseModuli + 1);
                
                maxStringheEffettive = 1; // Resettiamo per calcolare il vero caso peggiore
                let maxModuliInSerie = 1;
                let minModuliInSerie = 999;

                for (const moduli of mpptConfigs) {
                    let stringhe = reqStringhe;
                    let ns = moduli / stringhe;

                    // 2. Verifica simmetria stringhe sullo stesso MPPT. 
                    // Se non divisibili, forza tutto su 1 sola stringa in serie
                    if (moduli % stringhe !== 0) {
                        stringhe = 1;
                        ns = moduli;
                    }

                    // 3. VERIFICA SALVAVITA 1: Tensione Massima Inverter a Freddo
                    const voc_tmin_test = voc * (1 + (tmin - 25) * (beta / 100));
                    const vstr_max_test = voc_tmin_test * ns;

                    if (vstr_max_test > vmaxdc) {
                         return {
                             status: 'ERROR',
                             errType: 'OVERVOLTAGE_MPPT',
                             msg: `ERRORE GEOMETRIA: I ${moduli} moduli su un MPPT non sono divisibili per le ${reqStringhe} stringhe in parallelo richieste. Il software ha forzato il collegamento in un'unica stringa in serie, ma la tensione a vuoto a freddo (${vstr_max_test.toFixed(1)}V) supererebbe il limite assoluto dell'inverter (${vmaxdc}V). Modifica il numero di pannelli.`
                         };
                    }

                    // 4. VERIFICA SALVAVITA 2: Corrente Massima Ingresso MPPT
                    const istr_max_test = (isc * 1.25) * stringhe;
                    
                    if (istr_max_test > imax) {
                         return {
                             status: 'ERROR',
                             errType: 'OVERCURRENT_MPPT',
                             msg: `ERRORE CORRENTE: La configurazione di questo MPPT (${stringhe} stringa/e in parallelo) genera una corrente massima di ${istr_max_test.toFixed(1)}A. Questo valore supera la capacità di ingresso dell'MPPT dell'inverter (${imax}A). Modifica i pannelli o l'inverter.`
                         };
                    }

                    // Aggiorniamo le variabili per i cicli e i calcoli successivi
                    if (stringhe > maxStringheEffettive) maxStringheEffettive = stringhe;
                    if (ns > maxModuliInSerie) maxModuliInSerie = ns;
                    if (ns < minModuliInSerie) minModuliInSerie = ns;
                }

                // Fissiamo i limiti del ciclo successivo per controllare Vmp_min e logiche inverter
                ns_min = minModuliInSerie;
                max_iter = maxModuliInSerie;
            }

            // 5. CALCOLO CORRENTE DI DISCESA (Caso peggiore per dimensionamento Cavi e Fusibili)
            const voc_tmin = voc * (1 + (beta / 100) * (tmin - 25));
            const vmp_tmax = vmp * (1 + (beta / 100) * (tmax - 25));

            const mpptConfig = [];
            let currentRem = ntot % nmppt;
            const pTot = (ntot * wp) / 1000;
            
            for (let i = 0; i < nmppt; i++) {
                let moduliMppt = Math.floor(ntot / nmppt) + (currentRem > 0 ? 1 : 0);
                if (currentRem > 0) currentRem--;
                
                let sEff = reqStringhe;
                if (moduliMppt % sEff !== 0) sEff = 1;
                
                let nsMppt = moduliMppt / sEff;
                const iscMppt = isc * sEff;
                const iscMaxMppt = (isc * 1.25) * sEff;

                // Independent cable/fuse calculation per MPPT
                const maxDvVoltsMppt = 0.015 * (nsMppt * vmp);
                let cableSecMppt = [4, 6, 10, 16, 25, 35].find(s => s >= (2 * lcavo * iscMppt) / (56 * maxDvVoltsMppt)) || 4;
                const izBaseMppt = { 4: 44, 6: 57, 10: 79, 16: 107, 25: 142, 35: 175 }[cableSecMppt] || 44;
                const izEffMppt = izBaseMppt * 0.58;

                const fuseMinMppt = isc * 1.25; 
                const fuseMaxMppt = Math.min(protVal, izEffMppt);
                let fuseMppt = [10, 12, 15, 20, 25, 30, 32, 40].find(f => f >= fuseMinMppt) || 15;

                const dvMppt = (((2 * lcavo * (isc * sEff)) / (56 * cableSecMppt)) / (nsMppt * vmp)) * 100;

                mpptConfig.push({ 
                    mppt: i + 1, 
                    moduli: nsMppt, 
                    stringhe: sEff, 
                    vstr: nsMppt * vmp, 
                    vmin: nsMppt * vmp_tmax,
                    vsez: nsMppt * voc_tmin, 
                    iscMax: iscMaxMppt,
                    fuse: fuseMppt,
                    cable: cableSecMppt,
                    izEff: izEffMppt,
                    dv: dvMppt,
                    valid: true 
                });
            }

            const allModuliSame = mpptConfig.length > 0 ? mpptConfig.every(m => m.moduli === mpptConfig[0].moduli) : true;
            const allStringsSame = mpptConfig.length > 0 ? mpptConfig.every(m => m.stringhe === mpptConfig[0].stringhe) : true;
            const isAsymmetric = !allModuliSame || !allStringsSame;

            // Global display values (worst case)
            const mainCable = Math.max(...mpptConfig.map(m => typeof m.cable === 'number' ? m.cable : 0));
            const mainFuse = Math.max(...mpptConfig.map(m => m.fuse));
            const mainIzEff = Math.min(...mpptConfig.map(m => m.izEff));

            const finalResult = { 
                type: 'pv', 
                status: 'OK', 
                nmin: Math.min(...mpptConfig.map(m => m.moduli)), 
                nmax: Math.max(...mpptConfig.map(m => m.moduli)), 
                ntot: ntot, 
                nmppt, 
                mpptConfig, 
                isAsymmetric, 
                ptot: pTot, 
                dcac: (pac > 0 ? pTot / pac : pTot / pmaxcc).toFixed(2), 
                cableSec: mainCable, 
                dvReal: Math.max(...mpptConfig.map(m => (((2 * lcavo * (isc * m.stringhe)) / (56 * (typeof m.cable === 'number' ? m.cable : 4))) / (m.moduli * vmp)) * 100)),
                fuse: mainFuse, 
                v_sez: Math.max(...mpptConfig.map(m => m.vsez)), 
                isc: isc, 
                izBase: Math.min(...mpptConfig.map(m => {
                        const b = { 4: 44, 6: 57, 10: 79, 16: 107, 25: 142, 35: 175 }[m.cable];
                        return b || 44;
                })), 
                izEff: mainIzEff, 
                inputs 
            };

            return finalResult || { status: 'ERROR', msg: 'Parametri non validi' };
        } catch (e) { return { status: 'ERROR', msg: e.message }; }
    }
};
