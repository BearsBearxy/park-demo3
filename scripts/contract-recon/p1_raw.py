# print raw notice rows: python p1_raw.py <sheet> <ym> [<ym>...]   (read-only)
import json, sys
A=json.load(open('out/all.json',encoding='utf-8'))
sh=sys.argv[1]; yms=set(sys.argv[2:])
for n in A['notices']:
    if n['zone']!='一期' or '@' in n['book'] or n['sheet']!=sh or (yms and n['ym'] not in yms): continue
    print(f"--- {n['book']}!{sh} ym={n['ym']} title@R{n['titleRow']} {n['title']} | addr={n['addressee']} | hdr@R{n['headerRow']}={n['header']} total={n['total']} imgs={n['images']} signer={n['signer']}")
    for r in n['rows']:
        print('   ', {k:v for k,v in r.items() if k not in ('locFilled',)})
