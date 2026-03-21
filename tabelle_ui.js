const TABELLE_NORMATIVE_UI = {
    "k1_aria": {
        "titolo": "Tab. III - Fattori di correzione K1 per temperature dell'aria diverse da 30°C",
        "descrizione": "Applicabile a pose in aria libera, tubi, canali e passerelle.",
        "colonne": ["Temp. Ambiente (°C)", "PVC (70°C)", "EPR/XLPE (90°C)"],
        "dati": [
            ["10", "1.22", "1.15"], ["15", "1.17", "1.12"], ["20", "1.12", "1.08"],
            ["25", "1.06", "1.04"], ["30", "1.00", "1.00"], ["35", "0.94", "0.96"],
            ["40", "0.87", "0.91"], ["45", "0.79", "0.87"], ["50", "0.71", "0.82"],
            ["55", "0.61", "0.76"], ["60", "0.50", "0.71"], ["65", "-", "0.65"],
            ["70", "-", "0.58"], ["75", "-", "0.50"]
        ]
    },
    "k1_terreno": {
        "titolo": "Tab. II - Fattori di correzione K1 per temperature del terreno diverse da 20°C",
        "descrizione": "Applicabile a cavi interrati (in tubo o posa diretta).",
        "colonne": ["Temp. Terreno (°C)", "PVC (70°C)", "EPR/XLPE (90°C)"],
        "dati": [
            ["10", "1.10", "1.07"], ["15", "1.05", "1.04"], ["20", "1.00", "1.00"],
            ["25", "0.95", "0.96"], ["30", "0.89", "0.93"], ["35", "0.84", "0.89"],
            ["40", "0.77", "0.85"], ["45", "0.71", "0.80"], ["50", "0.63", "0.76"],
            ["55", "0.55", "0.71"], ["60", "0.45", "0.65"], ["65", "-", "0.60"],
            ["70", "-", "0.53"], ["75", "-", "0.46"], ["80", "-", "0.38"]
        ]
    },
    "k2_aria_multipolari": {
        "titolo": "Tab. V - Fattori K2 per raggruppamento in aria (Cavi Multipolari)",
        "descrizione": "Coefficienti di riduzione per più circuiti affiancati.",
        "colonne": ["Disposizione", "1", "2", "3", "4", "5", "6", "7", "8", "9+"],
        "dati": [
            ["In fascio / annegati", "1.00", "0.80", "0.70", "0.65", "0.60", "0.57", "0.54", "0.52", "0.50"],
            ["Singolo strato su muro", "1.00", "0.85", "0.79", "0.75", "0.73", "0.72", "0.72", "0.71", "0.70"],
            ["Strato a soffitto", "0.95", "0.81", "0.72", "0.68", "0.66", "0.64", "0.63", "0.61", "0.62"],
            ["Su passerelle perforate", "1.00", "0.88", "0.82", "0.77", "0.75", "0.73", "0.73", "0.72", "0.72"]
        ]
    },
    "k2_interrato_multipolari": {
        "titolo": "Fattori K2 per raggruppamento in tubo interrato (Multipolari)",
        "descrizione": "Distanza tra i tubi nel terreno.",
        "colonne": ["Num. Cavi", "A contatto", "0,25 m", "0,50 m", "1,00 m"],
        "dati": [
            ["2", "0.85", "0.90", "0.95", "0.95"],
            ["3", "0.75", "0.85", "0.90", "0.95"],
            ["4", "0.70", "0.80", "0.85", "0.90"],
            ["5", "0.65", "0.80", "0.85", "0.90"],
            ["6", "0.60", "0.80", "0.80", "0.90"]
        ]
    },
    "k2_interrato_unipolari": {
        "titolo": "Fattori K2 per raggruppamento in tubo interrato (Unipolari)",
        "descrizione": "Un cavo unipolare per ciascun tubo.",
        "colonne": ["Num. Circuiti", "A contatto", "0,25 m", "0,50 m", "1,00 m"],
        "dati": [
            ["2", "0.80", "0.90", "0.90", "0.95"],
            ["3", "0.70", "0.80", "0.85", "0.90"],
            ["4", "0.65", "0.75", "0.80", "0.90"],
            ["5", "0.60", "0.70", "0.80", "0.90"],
            ["6", "0.60", "0.70", "0.80", "0.90"]
        ]
    },
    "k3_profondita": {
        "titolo": "Tab. IV - Fattori di correzione K3 per profondità di posa",
        "descrizione": "Applicabile a posa interrata.",
        "colonne": ["Profondità (m)", "Fattore di correzione"],
        "dati": [
            ["0.5", "1.02"], ["0.8", "1.00"], ["1.0", "0.98"], ["1.2", "0.96"], ["1.5", "0.94"]
        ]
    },
    "k4_resistivita": {
        "titolo": "Tab. V - Fattori di correzione K4 per resistività termica del terreno",
        "descrizione": "Valori standard in K·m/W.",
        "colonne": ["Resistività (K·m/W)", "Cavi Unipolari", "Cavi Multipolari"],
        "dati": [
            ["1.0", "1.08", "1.06"],
            ["1.2", "1.05", "1.04"],
            ["1.5", "1.00", "1.00"],
            ["2.0", "0.90", "0.91"],
            ["2.5", "0.82", "0.84"]
        ]
    },
    "portate_pvc_aria": {
        "titolo": "Tab. I e II - Portate Cavi in Rame (PVC 70°C) in Aria",
        "descrizione": "Valori di portata (A) per posa in aria. Temp. ambiente 30°C.",
        "colonne": ["Metodo Posa", "Fasi", "1.5", "2.5", "4", "6", "10", "16", "25", "35", "50", "70", "95", "120", "150", "185", "240"],
        "dati": [
            ["A1 - Tubo incassato", "2", "14.5", "19.5", "26", "34", "46", "61", "80", "99", "119", "151", "182", "-", "-", "-", "-"],
            ["A1 - Tubo incassato", "3", "13.5", "18", "24", "31", "42", "56", "73", "89", "108", "136", "164", "-", "-", "-", "-"],
            ["B1 - Tubo a vista", "2", "17.5", "24", "32", "41", "57", "76", "101", "125", "151", "192", "232", "-", "-", "-", "-"],
            ["B1 - Tubo a vista", "3", "15.5", "21", "28", "36", "50", "68", "89", "110", "134", "171", "207", "-", "-", "-", "-"],
            ["C - A parete", "2", "19.5", "27", "36", "46", "63", "85", "112", "138", "168", "213", "258", "299", "344", "-", "-"],
            ["C - A parete", "3", "17.5", "24", "32", "41", "57", "76", "96", "119", "144", "184", "223", "259", "299", "-", "-"],
            ["E - Passerella Forata", "2", "15", "22", "30", "40", "51", "70", "94", "119", "148", "196", "238", "276", "319", "364", "430"],
            ["E - Passerella Forata", "3", "13.5", "18.5", "25", "34", "43", "60", "80", "101", "126", "168", "204", "238", "276", "319", "377"]
        ]
    },
    "portate_epr_aria": {
        "titolo": "Tab. I e II - Portate Cavi in Rame (EPR/XLPE 90°C) in Aria",
        "descrizione": "Valori di portata (A) per posa in aria. Temp. ambiente 30°C.",
        "colonne": ["Metodo Posa", "Fasi", "1.5", "2.5", "4", "6", "10", "16", "25", "35", "50", "70", "95", "120", "150", "185", "240"],
        "dati": [
            ["A1 - Tubo incassato", "2", "19", "26", "36", "45", "61", "81", "106", "131", "158", "200", "241", "278", "-", "-", "-"],
            ["A1 - Tubo incassato", "3", "17", "23", "31", "40", "54", "73", "95", "117", "141", "179", "216", "249", "-", "-", "-"],
            ["B1 - Tubo a vista", "2", "23", "31", "42", "54", "73", "98", "129", "158", "191", "243", "293", "339", "-", "-", "-"],
            ["B1 - Tubo a vista", "3", "20", "28", "37", "48", "66", "88", "117", "144", "175", "222", "269", "312", "-", "-", "-"],
            ["E - Passerella Forata", "2", "19", "26", "36", "49", "63", "86", "115", "149", "185", "246", "298", "346", "399", "456", "538"],
            ["E - Passerella Forata", "3", "17", "23", "32", "42", "54", "75", "100", "127", "158", "213", "258", "299", "344", "392", "461"]
        ]
    },
    "portate_interrati": {
        "titolo": "Tab. I e II - Portate Cavi in Rame Interrati",
        "descrizione": "Valori normativi in terra (D1 e D2). Temp. terreno 20°C. Profondità 0.8m.",
        "colonne": ["Isolante", "Posa", "Fasi", "1.5", "2.5", "4", "6", "10", "16", "25", "35", "50", "70", "95", "120", "150", "185", "240"],
        "dati": [
            ["PVC", "D1 - In Tubo", "2", "22", "29", "38", "47", "63", "81", "104", "125", "151", "185", "220", "253", "286", "-", "-"],
            ["PVC", "D1 - In Tubo", "3", "18", "24", "31", "39", "52", "67", "86", "103", "125", "153", "183", "210", "237", "-", "-"],
            ["EPR", "D1 - In Tubo", "2", "26", "34", "44", "56", "74", "96", "123", "147", "176", "216", "258", "295", "333", "380", "440"],
            ["EPR", "D1 - In Tubo", "3", "22", "29", "37", "46", "61", "79", "101", "122", "144", "178", "211", "240", "271", "308", "356"],
            ["EPR", "D2 - Diretto", "2", "27", "36", "47", "59", "79", "103", "133", "159", "190", "234", "279", "319", "361", "411", "477"],
            ["EPR", "D2 - Diretto", "3", "22", "29", "38", "48", "64", "83", "108", "128", "154", "190", "227", "259", "292", "332", "384"]
        ]
    }
};
