# Dump read-only snapshot of park_demo3 tables needed for recon (read-only SELECTs)
import pymysql, json, decimal, datetime
c=pymysql.connect(host='127.0.0.1',port=13306,user='root',password='root',database='park_demo3',charset='utf8mb4')
cur=c.cursor(pymysql.cursors.DictCursor)
def conv(o):
    if isinstance(o,decimal.Decimal): return str(o)
    if isinstance(o,(datetime.date,datetime.datetime)): return o.isoformat()
    return str(o)
out={}
for t,q in [('tenant','select * from tenant'),('contract','select * from contract'),
            ('term','select * from contract_billing_term'),('building','select * from building'),
            ('unit','select * from unit'),('contract_unit','select * from contract_unit'),
            ('btu','select * from billing_term_unit'),
            ('ledger','select tenant_id,tenant_name,company_id,period_year,period_month,factory_rent,factory_mgmt_fee,shop_rent,dorm_rent,dorm_facilities_fee,shop_mgmt_fee,factory_infra_maint,shop_infra_maint,dorm_infra_maint,elevator_maint,transformer_maint,land_use_tax,network_fee,access_ctrl_maint,office_other_fee,dorm_other_fee,basic_electricity,total_collected,note,extra_fees from monthly_ledger'),
            ('tenant_price_cfg','select * from tenant_price_cfg')]:
    try:
        cur.execute(q); out[t]=cur.fetchall()
    except Exception as e: out[t]=str(e)
json.dump(out,open('out/db-snapshot.json','w',encoding='utf-8'),ensure_ascii=False,default=conv)
print({k:len(v) for k,v in out.items()})
