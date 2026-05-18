// --- ENGINE-FV.JS: MOTORE DI CALCOLO – DIMENSIONAMENTO FOTOVOLTAICO ---
const EngineFV = {
    calculatePV: function (inputs) {
        try {
            const { vmaxdc, imax, iscmax, mpptmin, mpptmax, pmaxcc, pac, wp, beta, voc, isc, imp, vmp, lcavo, tmin, tmax, protVal, protType } = inputs;
            const ntot = parseInt(inputs.ntot) || 0;
            const nmppt = parseInt(inputs.nmppt) || 1;
            const reqStringhe = parseInt(inputs.nStringhe) || 1; 

            if (!Number.isFinite(Number(vmaxdc)) || Number(vmaxdc) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'VmaxDc must be greater than 0.' };
            if (nmppt <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'NMppt must be at least 1.' };
            if (!Number.isFinite(Number(imax)) || Number(imax) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'Imax must be greater than 0.' };
            if (!Number.isFinite(Number(iscmax)) || Number(iscmax) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'IscMax must be greater than 0.' };
            if (Number(iscmax) < Number(imax))
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'IscMax must be >= Imax (short-circuit tolerance).' };
            if (reqStringhe <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'NStringhe must be at least 1.' };
            if (!Number.isFinite(Number(mpptmin)) || Number(mpptmin) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'MpptMin must be greater than 0.' };
            if (!Number.isFinite(Number(mpptmax)) || Number(mpptmax) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'MpptMax must be greater than 0.' };
            if (Number(mpptmax) < Number(mpptmin))
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'MpptMax must be >= MpptMin.' };
            if (!Number.isFinite(Number(wp)) || Number(wp) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'Wp (panel Watt-peak) must be greater than 0.' };
            if (!Number.isFinite(Number(voc)) || Number(voc) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'Voc must be greater than 0.' };
            if (!Number.isFinite(Number(vmp)) || Number(vmp) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'Vmp must be greater than 0.' };
            if (!Number.isFinite(Number(isc)) || Number(isc) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'Isc must be greater than 0.' };
            if (!Number.isFinite(Number(imp)) || Number(imp) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'Imp must be greater than 0.' };
            if (ntot <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'NTot must be at least 1.' };
            if (!Number.isFinite(Number(lcavo)) || Number(lcavo) <= 0)
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'LCavo (cable length) must be greater than 0.' };
            if (!Number.isFinite(Number(tmin)) || !Number.isFinite(Number(tmax)) || Number(tmin) >= Number(tmax))
                return { status: 'ERROR', errType: 'INVALID_INPUT', msg: 'TMin must be less than TMax.' };

            const mpptConfig = [];
            const iscMaxLimit = Number(iscmax);
            const izLookup = { 4: 44, 6: 57, 10: 79, 16: 107, 25: 142, 35: 175 };
            const cableSections = [4, 6, 10, 16, 25, 35];
            const sigmaRame70 = 44;
            const K80C = Math.sqrt((90 - 80) / (90 - 30));

            const selectCableSection = (cableLength, currentAmps, voltageRef, minSection = 4) => {
                const maxDvPercent = 1.0;
                const maxDvVolts = (maxDvPercent / 100) * voltageRef;
                const minSecForDv = (2 * cableLength * currentAmps) / (sigmaRame70 * maxDvVolts);
                const startSec = cableSections.find(s => s >= Math.max(minSection, minSecForDv)) || cableSections[cableSections.length - 1];

                for (const sec of cableSections) {
                    if (sec < startSec) continue;
                    const dv = (2 * cableLength * currentAmps * 100) / (sigmaRame70 * sec * voltageRef);
                    if (dv <= maxDvPercent) {
                        return { section: sec, dvExceeded: false };
                    }
                }

                return { section: cableSections[cableSections.length - 1], dvExceeded: true };
            };

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
                    if (istr_max_test > iscMaxLimit) {
                        return { status: 'ERROR', errType: 'OVERCURRENT_MPPT', msg: `Sovracorrente: ${cfg.sEff} string${cfg.sEff > 1 ? 'he' : 'a'} generano ${istr_max_test.toFixed(1)} A (1,25·Isc), limite Isc max ${iscMaxLimit} A. Ridurre le stringhe in parallelo.` };
                    }

                    const impMppt = imp * cfg.sEff;
                    if (impMppt > imax) {
                        return {
                            status: 'ERROR',
                            errType: 'OVERCURRENT_IDC_MPPT',
                            msg: `Corrente operativa: ${cfg.sEff} string${cfg.sEff > 1 ? 'he' : 'a'} generano ${impMppt.toFixed(1)} A (Imp totale), limite MPPT ${imax} A. Ridurre le stringhe in parallelo.`
                        };
                    }

                    const iscMppt = isc * cfg.sEff;
                    // CEI 82-25: per la caduta di tensione si usa la Vmp alla Tmax
                    // (tensione minima → caso peggiore per ΔV)
                    const vmpMpptForDv = ns * vmp_tmax;
                    const vmpMppt = ns * vmp;  // tensione MPP a STC (usata per output)
                    const ibStringa = isc * 1.25;
                    const ibStringaOperativo = imp * 1.25;

                    // Selezione sezione: prima per ΔV ≤ 1,0% (riferita a Vmp@Tmax), poi upsizing per portata a 80°C
                    const dvSelection = selectCableSection(lcavo, iscMppt, vmpMpptForDv);
                    let cableSecMppt = dvSelection.section;
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
                    const cavoCheckIb = Math.max(ibStringa, ibStringaOperativo);
                    const cavoCheck = { ib: cavoCheckIb, iz: iz80Mppt, ok: iz80Mppt >= cavoCheckIb };
                    // Verifica 2 – Fusibile: 1,25·Isc ≤ In ≤ ImMAX
                    const fuseCheck = { min: fuseMinMppt, max: fuseMaxMppt, selected: fuseMppt, ok: fuseMppt >= fuseMinMppt && fuseMppt <= fuseMaxMppt };
                    // Verifica 3 – SPD: Uc ≥ 1,2·Uoc,stringa (requisito minimo di esercizio)
                    const spdCheck = { uoc: vsez_test, ucReq: vsez_test * 1.2 };

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
                        dv: (2 * lcavo * iscMppt * 100) / (sigmaRame70 * cableSecMppt * vmpMpptForDv),
                        dvExceeded: dvSelection.dvExceeded,
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
                if (cfg.dvExceeded)
                    warnings.push({
                        cond: 4,
                        mppt: cfg.mppt,
                        value: cfg.dv.toFixed(2),
                        msg: `Caduta tensione cavo (${cfg.dv.toFixed(2)}%) supera il limite massimo di 1%. Sezione cavo: ${cfg.cable} mm² (massima disponibile). Verificare progettazione.`
                    });
            }

            const pTot = (ntot * wp) / 1000;

            // ── Guardia bloccante: potenza DC totale > Pmaxcc inverter ──────────
            // pmaxcc è in kW (come pTot); il check avviene PRIMA di restituire l'OK
            if (pmaxcc > 0 && pTot > pmaxcc) {
                return {
                    status: 'ERROR',
                    errType: 'OVERPOWER_DC',
                    msg: `Potenza CC totale (${pTot.toFixed(2)} kWp) supera la potenza massima CC dell'inverter (${pmaxcc} kW). Ridurre il numero di moduli.`
                };
            }

            const allModuliSame = mpptConfig.length > 0 ? mpptConfig.every(m => m.moduli === mpptConfig[0].moduli) : true;
            const allStringsSame = mpptConfig.length > 0 ? mpptConfig.every(m => m.stringhe === mpptConfig[0].stringhe) : true;
            const isAsymmetric = !allModuliSame || !allStringsSame;

            const mainCable = mpptConfig.length > 0 ? Math.max(...mpptConfig.map(m => m.cable)) : 0;
            const mainFuse = mpptConfig.length > 0 ? Math.max(...mpptConfig.map(m => m.fuse)) : 0;
            const mainIzEff = mpptConfig.length > 0 ? Math.min(...mpptConfig.map(m => m.izEff)) : 0;

            const denominatorWatts = pac > 0 ? pac : pmaxcc;
            const dcac = denominatorWatts > 0 ? (pTot / denominatorWatts).toFixed(2) : 'N/A';

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
                dcac,
                cableSec: mainCable, 
                dvReal: mpptConfig.length > 0 ? Math.max(...mpptConfig.map(m => m.dv)) : 0,
                dvExceeded: mpptConfig.some(m => m.dvExceeded),
                fuse: mainFuse, 
                v_sez: mpptConfig.length > 0 ? Math.max(...mpptConfig.map(m => m.vsez)) : 0, 
                isc: isc, 
                izBase: mpptConfig.length > 0 ? Math.min(...mpptConfig.map(m => {
                        return { 4: 44, 6: 57, 10: 79, 16: 107, 25: 142, 35: 175 }[m.cable] || 44;
                })) : 44, 
                izEff: mainIzEff, 
                inputs 
            };

            return finalResult || { status: 'ERROR', msg: 'Calcolo FV non riuscito. Controlla i valori inseriti e riprova.' };
        } catch (e) { return { status: 'ERROR', msg: e?.message || 'Calcolo FV non riuscito. Controlla i valori inseriti e riprova.' }; }
    }
};
