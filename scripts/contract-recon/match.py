# Map 一期 source sheets/addressees -> DB tenant ids (heuristic + manual table)
import json, collections, re
d=json.load(open('out/all.json',encoding='utf-8'))
db=json.load(open('out/db-snapshot.json',encoding='utf-8'))
def norm(s): return re.sub(r'[\s（）()【】\[\]、,，·.。]','',s or '').replace('有限公司','').replace('佛山市','').replace('广东','').replace('佛山','')
ten=db['tenant']
keys=collections.defaultdict(set)
for t in ten:
    for nm in [t['company_name'],t['contact_name']]+(t['aliases'] or '').split(','):
        if nm and nm.strip(): keys[norm(nm)].add(t['id'])
ns=[n for n in d['notices'] if n['zone']=='一期']
sheets=collections.defaultdict(collections.Counter)
for n in ns: sheets[n['sheet']][n['addressee']]+=1
res={}
for sh,addrs in sorted(sheets.items()):
    cands=collections.Counter()
    for a in list(addrs)+[sh]:
        k=norm(a)
        for kk,ids in keys.items():
            if not kk or not k: continue
            if kk==k: 
                for i in ids: cands[i]+=10
            elif len(kk)>=2 and (kk in k or k in kk):
                for i in ids: cands[i]+=1
    res[sh]={'addr':dict(addrs),'cands':[(i,next(t['company_name'] for t in ten if t['id']==i),s) for i,s in cands.most_common(4)]}
json.dump(res,open('out/p1-match-auto.json','w',encoding='utf-8'),ensure_ascii=False,indent=0)
for sh,r in res.items(): print(sh,'|',list(r['addr'])[:2],'|',r['cands'][:3])
