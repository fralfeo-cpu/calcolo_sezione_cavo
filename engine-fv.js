// --- ENGINE-FV.JS: MOTORE DI CALCOLO – DIMENSIONAMENTO FOTOVOLTAICO ---
const EngineFV = {
    calculatePV: function (inputs) {
        try {
            const { vmaxdc, imax, mpptmin, mpptmax, pmaxcc, pac, wp, beta, voc, isc, vmp, lcavo, tmin, tmax, protVal, protType } = inputs;
            const ntot = parseInt(inputs.ntot) || 0;
            const nmppt = parseInt(inputs.nmppt) || 1;
            const reqStringhe = parseInt(inputs.nStringhe) || 1; 

            let maxStringheEffettive = reqStringhe; 
            const mpptConfig = [];

            const voc_tmin = voc * (1 + (beta / 100) * (tmin - 25));
            const vmp_tmax = vmp * (1 + (beta / 100) * (tmax - 25));
            const vmp_tmin = vmp * (1 + (beta / 100) * (tmin - 25));

            if (ntot > 0) {
                // Optimized Asymmetric Distribution Algorithm (Voltage Balancing)
                let bestConfig = [];
                let foundConfig = false;

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
                         return { status: 'ERROR', errType: 'OVERVOLTAGE_MPPT', msg: `Sovratensione: ${ns} moduli in serie producono ${vsez_test.toFixed(1)} V (Voc a Tmin), limite inverter ${vmaxdc} V. Ridurre i moduli per stringa.` };
                    }

                    const istr_max_test = (isc * 1.25) * cfg.sEff;
                    if (istr_max_test > imax) {
                         return { status: 'ERROR', errType: 'OVERCURRENT_MPPT', msg: `Sovracorrente: ${cfg.sEff} string${cfg.sEff > 1 ? 'he' : 'a'} generano ${istr_max_test.toFixed(1)} A (1,25·Isc), limite MPPT ${imax} A. Ridurre le stringhe in parallelo.` };
                    }

                    const iscMppt = isc * cfg.sEff;
                    const maxDvVoltsMppt = 0.015 * (ns * vmp);
                    // sigma = 44 S·m/mm² per rame a 70°C (temperatura operativa cavi solari, Rif. CEI 82-25)
                    const sigmaRame70 = 44;
                    // K80C = sqrt((Tmax_cond - T_amb) / (Tmax_cond - T_ref)) con Tmax_cond=90°C, T_amb=80°C, T_ref=30°C
                    const K80C = Math.sqrt((90 - 80) / (90 - 30)); // ≈ 0.408 – posa cautelativa retro moduli (CEI 82-25)
                    // Verifica 1 – Cavo stringa: IB = 1,25·Isc (singola stringa), θa = 80°C cautelativo
                    const ibStringa = isc * 1.25;
                    const izLookup = { 4: 44, 6: 57, 10: 79, 16: 107, 25: 142, 35: 175 };
                    const cableSections = [4, 6, 10, 16, 25, 35];
                    // Selezione sezione: prima per ΔV ≤ 1,5%, poi upsizing per rispettare portata a 80°C
                    let cableSecMppt = cableSections.find(s => s >= (2 * lcavo * iscMppt) / (sigmaRame70 * maxDvVoltsMppt)) || 35;
                    for (const sec of cableSections) {
                        if (sec < cableSecMppt) continue;
                        cableSecMppt = sec;
                        if ((izLookup[sec] || 44) * K80C >= ibStringa) break;
                    }
                    const izBaseMppt = izLookup[cableSecMppt] || 44;
                    const izEffMppt = izBaseMppt * 0.58;
                    const iz80Mppt = izBaseMppt * K80C;
                    const fuseMinMppt = isc * 1.25;
                    const fuseMaxMppt = protType === 'fuse' ? protVal : protVal * 1.35;
                    const fuseMppt = [10, 12, 15, 20, 25, 30, 32, 40].find(f => f >= fuseMinMppt) || 15;
                    const cavoCheck = { ib: ibStringa, iz: iz80Mppt, ok: iz80Mppt >= ibStringa };
                    // Verifica 2 – Fusibile: 1,25·Isc ≤ In ≤ ImMAX
                    const fuseCheck = { min: fuseMinMppt, max: fuseMaxMppt, selected: fuseMppt, ok: fuseMppt >= fuseMinMppt && fuseMppt <= fuseMaxMppt };
                    // Verifica 3 – SPD: Uc ≥ 1,2·Uoc,stringa (requisito minimo di esercizio)
                    const spdCheck = { uoc: vsez_test, ucReq: vsez_test * 1.2 };

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
                        iz80: iz80Mppt,
                        fuse: fuseMppt,
                        dv: (2 * lcavo * iscMppt * 100) / (sigmaRame70 * cableSecMppt * (ns * vmp)),
                        cavoCheck,
                        fuseCheck,
                        spdCheck,
                        valid: true
                    });
                }
            }

            // Verifica Condizioni 2 e 3 (warning non bloccanti)
            const warnings = [];
            for (const cfg of mpptConfig) {
                const umpp_min = cfg.ns * vmp_tmax;
                const umpp_max = cfg.ns * vmp_tmin;
                if (umpp_min < mpptmin)
                    warnings.push({ cond: 2, mppt: cfg.mppt, value: umpp_min.toFixed(1), limit: mpptmin });
                if (umpp_max > mpptmax)
                    warnings.push({ cond: 3, mppt: cfg.mppt, value: umpp_max.toFixed(1), limit: mpptmax });
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
                warnings,
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

            return finalResult || { status: 'ERROR', msg: 'Parametri di progetto non validi. Verificare i dati inseriti.' };
        } catch (e) { return { status: 'ERROR', msg: 'Errore di calcolo: ' + e.message }; }
    }
};
