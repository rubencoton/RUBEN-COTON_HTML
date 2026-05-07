import json, glob, os
KWS = ['Sonar', 'Sala Apolo', 'oferta', 'RUBEN COTON ha', 'RUBEN COTON es', 'RUBEN COTON anim', 'RUBEN COTON cre', 'RUBEN COTON pin']
for f in sorted(glob.glob('C:/Users/elrub/Desktop/CARPETA CODEX/01_PROYECTOS/RUBEN-COTON_HTML/tests/outputs/*.json')):
    if '_REPORTE' in f: continue
    try:
        d = json.load(open(f, encoding='utf-8'))
        e = d['result'].get('audit', {}).get('errores', [])
        if e:
            t = d['result'].get('textos', {})
            print('=', os.path.basename(f).replace('.json',''), '::', e[0])
            txt = (t.get('intro','') + ' ' + t.get('cuerpo','') + ' ' + t.get('cta',''))
            for kw in KWS:
                if kw.lower() in txt.lower():
                    idx = txt.lower().find(kw.lower())
                    print('  ', kw, ':', txt[max(0,idx-30):idx+90])
            print()
    except Exception as ex: print('ERR', f, ex)
