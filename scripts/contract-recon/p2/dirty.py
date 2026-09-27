import re
txt=open('compare.txt',encoding='utf-8').read().split('\n')
out=[];sheet=None;grp=[];dirty=set()
def flush():
    global grp
    if grp:
        body='\n'.join(grp)
        if re.search(r'MISS|DBONLY|AREA|LANDCHK|NONE|OK×|DORM-DIFF',body):
            out.append(body); dirty.add(sheet)
    grp=[]
for l in txt:
    if l.startswith('===='):
        flush(); sheet=l[20:]; out.append(l)
    elif l.startswith('['):
        flush(); grp=[l]
    else: grp.append(l)
flush()
open('compare-dirty.txt','w',encoding='utf-8').write('\n'.join(out))
allsheets=[l[20:] for l in txt if l.startswith('====')]
print('clean:',[s for s in allsheets if s not in dirty])
