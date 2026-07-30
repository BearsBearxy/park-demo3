-- V70__pool_rename.sql — 池位置化改名 + 受益人首批(任务B,scripts/derive_pool_location.py 生成)。
-- 依赖 V69:alloc_rule.floor_label/side/fee_name 与 alloc_rule_member.acct_month。
-- 幂等:UPDATE 按主键;INSERT 走 ON DUPLICATE KEY。低置信度池不改(见 scripts/pool-rename-2026-07-30.tsv)。

-- ── 定位回填 + 池名重生成 ──
UPDATE alloc_rule SET building_id=30, floor_label=NULL, side=NULL, fee_name='消防', name='二期 一车间·消防' WHERE id=2;  -- 旧名:一车间消防
UPDATE alloc_rule SET building_id=30, floor_label=NULL, side=NULL, fee_name='电梯+低压电房照明', name='二期 一车间·电梯+低压电房照明' WHERE id=3;  -- 旧名:一车间电梯+低压电房照明
UPDATE alloc_rule SET building_id=NULL, floor_label=NULL, side=NULL, fee_name='消防水稳压泵', name='二期园区·消防水稳压泵' WHERE id=4;  -- 旧名:一车间消防水稳压泵
UPDATE alloc_rule SET building_id=31, floor_label=NULL, side=NULL, fee_name='消防', name='二期 二车间·消防' WHERE id=5;  -- 旧名:二车间消防
UPDATE alloc_rule SET building_id=31, floor_label=NULL, side=NULL, fee_name='电梯+低压电房照明', name='二期 二车间·电梯+低压电房照明' WHERE id=6;  -- 旧名:二车间电梯+低压电房照明
UPDATE alloc_rule SET building_id=32, floor_label=NULL, side=NULL, fee_name='消防', name='二期 三车间·消防' WHERE id=7;  -- 旧名:三车间消防
UPDATE alloc_rule SET building_id=32, floor_label=NULL, side=NULL, fee_name='电梯+低压电房照明', name='二期 三车间·电梯+低压电房照明' WHERE id=8;  -- 旧名:三车间电梯+低压电房照明
UPDATE alloc_rule SET building_id=NULL, floor_label=NULL, side=NULL, fee_name='消防设施', name='二期园区·消防设施' WHERE id=9;  -- 旧名:园区消防设施
UPDATE alloc_rule SET building_id=33, floor_label=NULL, side=NULL, fee_name='消防', name='二期 四车间·消防' WHERE id=10;  -- 旧名:四车间消防
UPDATE alloc_rule SET building_id=33, floor_label=NULL, side=NULL, fee_name='电梯+低压电房照明', name='二期 四车间·电梯+低压电房照明' WHERE id=11;  -- 旧名:四车间电梯+低压电房照明
UPDATE alloc_rule SET building_id=33, floor_label=NULL, side=NULL, fee_name='电梯加价档', name='二期 四车间·电梯加价档' WHERE id=12;  -- 旧名:广联分摊
UPDATE alloc_rule SET building_id=NULL, floor_label=NULL, side=NULL, fee_name='绿化水泵', name='二期园区·绿化水泵' WHERE id=13;  -- 旧名:四车间绿化水泵
UPDATE alloc_rule SET building_id=34, floor_label=NULL, side=NULL, fee_name='消防', name='二期 五车间·消防' WHERE id=14;  -- 旧名:五车间消防
UPDATE alloc_rule SET building_id=34, floor_label=NULL, side=NULL, fee_name='广告字灯', name='二期 五车间·广告字灯' WHERE id=15;  -- 旧名:五车间广告字灯（消防分表）
UPDATE alloc_rule SET building_id=34, floor_label=NULL, side=NULL, fee_name='电梯+低压电房照明', name='二期 五车间·电梯+低压电房照明' WHERE id=16;  -- 旧名:五车间电梯+低压电房照明
UPDATE alloc_rule SET building_id=34, floor_label=NULL, side=NULL, fee_name='广告字灯（火炬园）', name='二期 五车间·广告字灯（火炬园）' WHERE id=17;  -- 旧名:五车间广告字灯（火炬园）
UPDATE alloc_rule SET building_id=NULL, floor_label=NULL, side=NULL, fee_name='路灯', name='二期园区·路灯' WHERE id=18;  -- 旧名:五车间保安亭、路灯等
UPDATE alloc_rule SET building_id=NULL, floor_label=NULL, side=NULL, fee_name='充电桩、保安亭', name='二期园区·充电桩、保安亭' WHERE id=19;  -- 旧名:五车间充电桩/保安亭
UPDATE alloc_rule SET building_id=35, floor_label=NULL, side=NULL, fee_name='消防', name='二期 六车间·消防' WHERE id=20;  -- 旧名:六车间消防
UPDATE alloc_rule SET building_id=35, floor_label=NULL, side=NULL, fee_name='广告字灯', name='二期 六车间·广告字灯' WHERE id=21;  -- 旧名:六车间广告字灯（消防分表）
UPDATE alloc_rule SET building_id=35, floor_label=NULL, side=NULL, fee_name='电梯+低压电房照明', name='二期 六车间·电梯+低压电房照明' WHERE id=22;  -- 旧名:六车间电梯+低压电房照明
UPDATE alloc_rule SET building_id=41, floor_label=NULL, side=NULL, fee_name='净电', name='一期 招商中心·净电' WHERE id=23;  -- 旧名:招商中心净电
UPDATE alloc_rule SET building_id=NULL, floor_label=NULL, side=NULL, fee_name='公共电（园区损耗池）', name='一期园区·公共电（园区损耗池）' WHERE id=24;  -- 旧名:园区公共电
UPDATE alloc_rule SET building_id=NULL, floor_label=NULL, side=NULL, fee_name='路灯', name='一期园区·路灯' WHERE id=25;  -- 旧名:园区路灯
UPDATE alloc_rule SET building_id=13, floor_label='一楼', side='东侧', fee_name='公共用电', name='一期 A座·一楼东侧·公共用电' WHERE id=26;  -- 旧名:旭化成1东公
UPDATE alloc_rule SET building_id=13, floor_label='二楼', side='东侧', fee_name='公共用电', name='一期 A座·二楼东侧·公共用电' WHERE id=27;  -- 旧名:旭化成2东公
UPDATE alloc_rule SET building_id=13, floor_label='二楼', side='西侧', fee_name='公共用电', name='一期 A座·二楼西侧·公共用电' WHERE id=28;  -- 旧名:A2西侧公共
UPDATE alloc_rule SET building_id=13, floor_label='三楼', side='西侧', fee_name='公共用电', name='一期 A座·三楼西侧·公共用电' WHERE id=29;  -- 旧名:A3西侧公共
UPDATE alloc_rule SET building_id=41, floor_label='四楼', side=NULL, fee_name='公共用电', name='一期 招商中心·四楼·公共用电' WHERE id=30;  -- 旧名:中大4楼公共
UPDATE alloc_rule SET building_id=41, floor_label='四楼', side=NULL, fee_name='空调外机', name='一期 招商中心·四楼·空调外机' WHERE id=31;  -- 旧名:4楼空调外机电
UPDATE alloc_rule SET building_id=13, floor_label='四楼', side='东侧', fee_name='公共用电', name='一期 A座·四楼东侧·公共用电' WHERE id=32;  -- 旧名:A4东侧公共
UPDATE alloc_rule SET building_id=13, floor_label='四楼', side='西侧', fee_name='走廊灯', name='一期 A座·四楼西侧·走廊灯' WHERE id=33;  -- 旧名:A4西侧走廊灯
UPDATE alloc_rule SET building_id=13, floor_label='四楼', side='西侧', fee_name='应急灯', name='一期 A座·四楼西侧·应急灯' WHERE id=34;  -- 旧名:A4西侧消防灯
UPDATE alloc_rule SET building_id=13, floor_label='五楼', side='东侧', fee_name='公共用电', name='一期 A座·五楼东侧·公共用电' WHERE id=35;  -- 旧名:戎合A501公共
UPDATE alloc_rule SET building_id=13, floor_label='五楼', side='西侧', fee_name='公共用电', name='一期 A座·五楼西侧·公共用电' WHERE id=36;  -- 旧名:鑫皇公共
UPDATE alloc_rule SET building_id=13, floor_label='六楼', side='东侧', fee_name='走廊灯', name='一期 A座·六楼东侧·走廊灯' WHERE id=37;  -- 旧名:A6东侧走廊灯
UPDATE alloc_rule SET building_id=13, floor_label='六楼', side='东侧', fee_name='应急灯', name='一期 A座·六楼东侧·应急灯' WHERE id=38;  -- 旧名:A6东侧消防灯
UPDATE alloc_rule SET building_id=13, floor_label='六楼', side='西侧', fee_name='公共用电', name='一期 A座·六楼西侧·公共用电' WHERE id=39;  -- 旧名:可莱恩A602公共电
UPDATE alloc_rule SET building_id=13, floor_label=NULL, side=NULL, fee_name='电梯', name='一期 A座·电梯' WHERE id=40;  -- 旧名:A东侧货梯
-- 池41  待人工(低):戎合B101公共电
-- 池42  待人工(低):杨文正公共电
UPDATE alloc_rule SET building_id=20, floor_label='二楼', side='东侧', fee_name='公共用电', name='一期 B座·二楼东侧·公共用电' WHERE id=43;  -- 旧名:可莱恩B201东侧公共电
UPDATE alloc_rule SET building_id=20, floor_label='二楼', side='西侧', fee_name='公共用电', name='一期 B座·二楼西侧·公共用电' WHERE id=44;  -- 旧名:可莱恩B201西侧公共电
UPDATE alloc_rule SET building_id=20, floor_label='三楼', side='东侧', fee_name='公共用电', name='一期 B座·三楼东侧·公共用电' WHERE id=45;  -- 旧名:欧培仪东侧公共
UPDATE alloc_rule SET building_id=20, floor_label='三楼', side='西侧', fee_name='公共用电', name='一期 B座·三楼西侧·公共用电' WHERE id=46;  -- 旧名:欧培仪西侧公共
UPDATE alloc_rule SET building_id=20, floor_label='四楼', side='东侧', fee_name='公共用电', name='一期 B座·四楼东侧·公共用电' WHERE id=47;  -- 旧名:碧沃丰B401东侧公共电
UPDATE alloc_rule SET building_id=20, floor_label='四楼', side='西侧', fee_name='公共用电', name='一期 B座·四楼西侧·公共用电' WHERE id=48;  -- 旧名:碧沃丰B401西侧公共电
UPDATE alloc_rule SET building_id=20, floor_label=NULL, side=NULL, fee_name='楼梯间', name='一期 B座·楼梯间' WHERE id=49;  -- 旧名:B东侧楼梯间
UPDATE alloc_rule SET building_id=20, floor_label=NULL, side=NULL, fee_name='货梯', name='一期 B座·货梯' WHERE id=50;  -- 旧名:B东侧货梯
-- 池51  待人工(低):高建军C公共
UPDATE alloc_rule SET building_id=21, floor_label='二楼', side='东侧', fee_name='公共用电', name='一期 C座·二楼东侧·公共用电' WHERE id=52;  -- 旧名:力美C201东侧公共电
UPDATE alloc_rule SET building_id=21, floor_label='二楼', side=NULL, fee_name='消防', name='一期 C座·二楼·消防' WHERE id=53;  -- 旧名:C2消防
UPDATE alloc_rule SET building_id=21, floor_label='二楼', side=NULL, fee_name='走廊灯', name='一期 C座·二楼·走廊灯' WHERE id=54;  -- 旧名:C2走廊
UPDATE alloc_rule SET building_id=21, floor_label='三楼', side='东侧', fee_name='公共用电', name='一期 C座·三楼东侧·公共用电' WHERE id=55;  -- 旧名:力美C301东侧公共电
UPDATE alloc_rule SET building_id=21, floor_label='四楼', side='东侧', fee_name='公共用电', name='一期 C座·四楼东侧·公共用电' WHERE id=56;  -- 旧名:道磁C401东侧公共电
UPDATE alloc_rule SET building_id=21, floor_label='四楼', side='西侧', fee_name='公共用电', name='一期 C座·四楼西侧·公共用电' WHERE id=57;  -- 旧名:可莱恩C402西侧公共电
UPDATE alloc_rule SET building_id=21, floor_label=NULL, side=NULL, fee_name='楼梯间', name='一期 C座·楼梯间' WHERE id=58;  -- 旧名:C东侧楼梯间
UPDATE alloc_rule SET building_id=21, floor_label=NULL, side='东侧', fee_name='货梯', name='一期 C座·东侧·货梯' WHERE id=59;  -- 旧名:C东侧货梯电表1
UPDATE alloc_rule SET building_id=21, floor_label=NULL, side='西侧', fee_name='货梯', name='一期 C座·西侧·货梯' WHERE id=60;  -- 旧名:C西侧货梯
UPDATE alloc_rule SET building_id=22, floor_label='一楼', side='东侧', fee_name='公共用电', name='一期 D座·一楼东侧·公共用电' WHERE id=61;  -- 旧名:邱彩云东侧公共电
UPDATE alloc_rule SET building_id=22, floor_label='二楼', side='东侧', fee_name='公共用电', name='一期 D座·二楼东侧·公共用电' WHERE id=62;  -- 旧名:D201东侧电
UPDATE alloc_rule SET building_id=22, floor_label='二楼', side='西侧', fee_name='公共用电', name='一期 D座·二楼西侧·公共用电' WHERE id=63;  -- 旧名:D201西侧电
UPDATE alloc_rule SET building_id=22, floor_label='三楼', side='东侧', fee_name='公共用电', name='一期 D座·三楼东侧·公共用电' WHERE id=64;  -- 旧名:金纳D301东侧公共电
UPDATE alloc_rule SET building_id=22, floor_label='三楼', side='西侧', fee_name='公共用电', name='一期 D座·三楼西侧·公共用电' WHERE id=65;  -- 旧名:金纳D301西侧公共电
UPDATE alloc_rule SET building_id=22, floor_label='四楼', side='东侧', fee_name='公共用电', name='一期 D座·四楼东侧·公共用电' WHERE id=66;  -- 旧名:飞度东侧公共电
UPDATE alloc_rule SET building_id=22, floor_label='四楼', side='西侧', fee_name='公共用电', name='一期 D座·四楼西侧·公共用电' WHERE id=67;  -- 旧名:一元兰欣西侧公共电
UPDATE alloc_rule SET building_id=22, floor_label=NULL, side=NULL, fee_name='楼梯间', name='一期 D座·楼梯间' WHERE id=68;  -- 旧名:D东侧楼梯间
UPDATE alloc_rule SET building_id=22, floor_label=NULL, side='东侧', fee_name='货梯', name='一期 D座·东侧·货梯' WHERE id=69;  -- 旧名:D东侧货梯
UPDATE alloc_rule SET building_id=22, floor_label=NULL, side='西侧', fee_name='货梯', name='一期 D座·西侧·货梯' WHERE id=70;  -- 旧名:D西侧货梯
UPDATE alloc_rule SET building_id=23, floor_label='二楼', side='东侧', fee_name='公共用电', name='一期 E座·二楼东侧·公共用电' WHERE id=71;  -- 旧名:E二楼东侧公共电
UPDATE alloc_rule SET building_id=23, floor_label='二楼', side='西侧', fee_name='公共用电', name='一期 E座·二楼西侧·公共用电' WHERE id=72;  -- 旧名:天玛E201西侧公共电
UPDATE alloc_rule SET building_id=23, floor_label='三楼', side='东侧', fee_name='公共用电', name='一期 E座·三楼东侧·公共用电' WHERE id=73;  -- 旧名:翔海E301东侧公共电
UPDATE alloc_rule SET building_id=23, floor_label='三楼', side='西侧', fee_name='公共用电', name='一期 E座·三楼西侧·公共用电' WHERE id=74;  -- 旧名:翔海E301西侧公共电
UPDATE alloc_rule SET building_id=23, floor_label='四楼', side='东侧', fee_name='公共用电', name='一期 E座·四楼东侧·公共用电' WHERE id=75;  -- 旧名:翔海E401东侧公共电
UPDATE alloc_rule SET building_id=23, floor_label='四楼', side='西侧', fee_name='公共用电', name='一期 E座·四楼西侧·公共用电' WHERE id=76;  -- 旧名:翔海E401西侧公共电
UPDATE alloc_rule SET building_id=23, floor_label=NULL, side=NULL, fee_name='楼梯间', name='一期 E座·楼梯间' WHERE id=77;  -- 旧名:E东侧楼梯间
UPDATE alloc_rule SET building_id=23, floor_label=NULL, side='东侧', fee_name='货梯', name='一期 E座·东侧·货梯' WHERE id=78;  -- 旧名:E东侧货梯
UPDATE alloc_rule SET building_id=23, floor_label=NULL, side='西侧', fee_name='货梯', name='一期 E座·西侧·货梯' WHERE id=79;  -- 旧名:E西侧货梯
UPDATE alloc_rule SET building_id=24, floor_label='一楼', side='东侧', fee_name='公共用电', name='一期 F座·一楼东侧·公共用电' WHERE id=80;  -- 旧名:思汗F101东侧公共电
UPDATE alloc_rule SET building_id=24, floor_label='二楼', side='东侧', fee_name='公共用电', name='一期 F座·二楼东侧·公共用电' WHERE id=81;  -- 旧名:优凯F201东侧公共电
UPDATE alloc_rule SET building_id=24, floor_label='二楼', side='西侧', fee_name='公共用电', name='一期 F座·二楼西侧·公共用电' WHERE id=82;  -- 旧名:优凯F201西侧公共电
UPDATE alloc_rule SET building_id=24, floor_label='三楼', side='东侧', fee_name='公共用电', name='一期 F座·三楼东侧·公共用电' WHERE id=83;  -- 旧名:优凯F301东侧公共电
UPDATE alloc_rule SET building_id=24, floor_label='三楼', side='西侧', fee_name='公共用电', name='一期 F座·三楼西侧·公共用电' WHERE id=84;  -- 旧名:优凯F301西侧公共电
UPDATE alloc_rule SET building_id=24, floor_label='四楼', side='东侧', fee_name='公共用电', name='一期 F座·四楼东侧·公共用电' WHERE id=85;  -- 旧名:F401东侧公共电
UPDATE alloc_rule SET building_id=24, floor_label='四楼', side='西侧', fee_name='公共用电', name='一期 F座·四楼西侧·公共用电' WHERE id=86;  -- 旧名:F401西侧公共电
UPDATE alloc_rule SET building_id=24, floor_label=NULL, side=NULL, fee_name='楼梯间', name='一期 F座·楼梯间' WHERE id=87;  -- 旧名:F东侧楼梯间
UPDATE alloc_rule SET building_id=24, floor_label=NULL, side='东侧', fee_name='货梯', name='一期 F座·东侧·货梯' WHERE id=88;  -- 旧名:F东侧货梯
UPDATE alloc_rule SET building_id=24, floor_label=NULL, side='西侧', fee_name='货梯', name='一期 F座·西侧·货梯' WHERE id=89;  -- 旧名:F西侧货梯
UPDATE alloc_rule SET building_id=NULL, floor_label=NULL, side=NULL, fee_name='路灯', name='宿舍区·路灯' WHERE id=90;  -- 旧名:宿舍路灯公摊
UPDATE alloc_rule SET building_id=NULL, floor_label=NULL, side=NULL, fee_name='绿化水', name='宿舍区·绿化水' WHERE id=91;  -- 旧名:宿舍绿化水公摊

-- ── 受益人首批(acct_month=''=默认长期行) ──
-- 池2   一车间消防 → 该车间在租租户自动带出(合同 building_id=30,15 户;与账册已分摊列行数核对一致)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (2,2,NULL,''),(2,3,NULL,''),(2,4,NULL,''),(2,5,NULL,''),(2,7,NULL,''),(2,8,NULL,''),(2,9,NULL,''),(2,10,NULL,''),(2,11,NULL,''),(2,12,NULL,''),(2,13,NULL,''),(2,14,NULL,''),(2,360,NULL,''),(2,377,NULL,''),(2,378,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池3   一车间电梯+低压电房照明 → 该车间在租租户自动带出(合同 building_id=30,15 户;与账册已分摊列行数核对一致)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (3,2,NULL,''),(3,3,NULL,''),(3,4,NULL,''),(3,5,NULL,''),(3,7,NULL,''),(3,8,NULL,''),(3,9,NULL,''),(3,10,NULL,''),(3,11,NULL,''),(3,12,NULL,''),(3,13,NULL,''),(3,14,NULL,''),(3,360,NULL,''),(3,377,NULL,''),(3,378,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池4   一车间消防水稳压泵 → 园区/期级池,受益人=该期(宿舍区)在租租户自动带出(拍板#5),不落库
-- 池5   二车间消防 → 该车间在租租户自动带出(合同 building_id=31,5 户;与账册已分摊列行数核对一致)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (5,16,NULL,''),(5,17,NULL,''),(5,18,NULL,''),(5,19,NULL,''),(5,365,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池6   二车间电梯+低压电房照明 → 该车间在租租户自动带出(合同 building_id=31,5 户;与账册已分摊列行数核对一致)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (6,16,NULL,''),(6,17,NULL,''),(6,18,NULL,''),(6,19,NULL,''),(6,365,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池7   三车间消防 → 该车间在租租户自动带出(合同 building_id=32,9 户;与账册已分摊列行数核对一致)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (7,20,NULL,''),(7,21,NULL,''),(7,22,NULL,''),(7,23,NULL,''),(7,25,NULL,''),(7,26,NULL,''),(7,27,NULL,''),(7,375,NULL,''),(7,376,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池8   三车间电梯+低压电房照明 → 账册三车间电梯 S40『三车间企业(嘉荣、艾派斯)』T40=4层仅两户承担(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (8,375,NULL,''),(8,20,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池9   园区消防设施 → 园区/期级池,受益人=该期(宿舍区)在租租户自动带出(拍板#5),不落库
-- 池10  四车间消防 → 该车间在租租户自动带出(合同 building_id=33,6 户;与账册已分摊列行数核对一致)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (10,28,NULL,''),(10,29,NULL,''),(10,30,NULL,''),(10,31,NULL,''),(10,32,NULL,''),(10,33,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池11  四车间电梯+低压电房照明 → 该车间在租租户自动带出(合同 building_id=33,6 户;与账册已分摊列行数核对一致)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (11,28,NULL,''),(11,29,NULL,''),(11,30,NULL,''),(11,31,NULL,''),(11,32,NULL,''),(11,33,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池12  广联分摊 → 账册V64 三户引全层价+100元(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (12,28,NULL,''),(12,29,NULL,''),(12,30,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池13  四车间绿化水泵 → 园区/期级池,受益人=该期(宿舍区)在租租户自动带出(拍板#5),不落库
-- 池14  五车间消防 → 该车间在租租户自动带出(合同 building_id=34,10 户;与账册已分摊列行数核对一致);账册归属切割:-方凯鑫(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (14,48,NULL,''),(14,49,NULL,''),(14,56,NULL,''),(14,61,NULL,''),(14,62,NULL,''),(14,63,NULL,''),(14,64,NULL,''),(14,65,NULL,''),(14,66,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池15  五车间广告字灯（消防分表） → 无受益人:单价档0.005叠进园区消防设施V46,不直接向户收
-- 池16  五车间电梯+低压电房照明 → 该车间在租租户自动带出(合同 building_id=34,10 户;与账册已分摊列行数核对一致)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (16,48,NULL,''),(16,49,NULL,''),(16,53,NULL,''),(16,56,NULL,''),(16,61,NULL,''),(16,62,NULL,''),(16,63,NULL,''),(16,64,NULL,''),(16,65,NULL,''),(16,66,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池17  五车间广告字灯（火炬园） → 账册X89『收取火炬园，五车间电梯表冲减』,P70=670.06度单独向火炬园收(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (17,1,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池18  五车间保安亭、路灯等 → 园区/期级池,受益人=该期(宿舍区)在租租户自动带出(拍板#5),不落库
-- 池19  五车间充电桩/保安亭 → 无受益人:S101『不分摊』,成本全额挂亏(Y101=-1717.05)
-- 池20  六车间消防 → 该车间在租租户自动带出(合同 building_id=35,11 户;与账册已分摊列行数核对一致);账册归属切割:+方凯鑫(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (20,50,NULL,''),(20,51,NULL,''),(20,52,NULL,''),(20,53,NULL,''),(20,54,NULL,''),(20,55,NULL,''),(20,57,NULL,''),(20,58,NULL,''),(20,59,NULL,''),(20,60,NULL,''),(20,67,NULL,''),(20,68,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池21  六车间广告字灯（消防分表） → 无受益人:同上(六车间广告字→V46)
-- 池22  六车间电梯+低压电房照明 → 该车间在租租户自动带出(合同 building_id=35,11 户;与账册已分摊列行数核对一致)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (22,50,NULL,''),(22,51,NULL,''),(22,52,NULL,''),(22,54,NULL,''),(22,55,NULL,''),(22,57,NULL,''),(22,58,NULL,''),(22,59,NULL,''),(22,60,NULL,''),(22,67,NULL,''),(22,68,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池23  招商中心净电 → 无受益人:总表净额经 fold_qty 折入一期园区公摊池,不直接向租户收
-- 池24  园区公共电 → 园区/期级池,受益人=该期(宿舍区)在租租户自动带出(拍板#5),不落库
-- 池25  园区路灯 → 园区/期级池,受益人=该期(宿舍区)在租租户自动带出(拍板#5),不落库
-- 池26  旭化成1东公 → 绑定表用途字段『公共用电/旭化成 停用』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (26,361,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池27  旭化成2东公 → 绑定表用途字段『公共用电/旭化成』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (27,361,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池28  A2西侧公共 → 账册A2西侧公共 AA15=1734.73=五户面积和,已逐户核实(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (28,101,NULL,''),(28,104,NULL,''),(28,117,NULL,''),(28,365,NULL,''),(28,371,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池29  A3西侧公共 → 账册A3西侧公共 范围列7户;AA16=2293.34 只含前6户面积(建奕超基数收取)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (29,119,NULL,''),(29,120,NULL,''),(29,130,NULL,''),(29,115,NULL,''),(29,134,NULL,''),(29,358,NULL,''),(29,280,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池30  中大4楼公共 → 待人工:中大4楼公共『已停用』,受益人存疑
-- 池31  4楼空调外机电 → 待人工:4楼空调外机电『已停用』,zh G17 曾按 AC18×7 用作双成空调风机费
-- 池32  A4东侧公共 → 账册A4东侧公共 名单4户,但 zh 表实收6户(精锐佳/炳记/帷幄/幸悦/重瞳/林观平445)三者不一致 ⚠租户档未匹配:精锐佳(低)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (32,359,NULL,''),(32,270,NULL,''),(32,134,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池33  A4西侧走廊灯 → 账册A4西侧 名单5户面积和575.59≠AA20=734.02;zh 实收8户(另含黄路生/沈振/周应佳)(低)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (33,116,NULL,''),(33,122,NULL,''),(33,193,NULL,''),(33,148,NULL,''),(33,368,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池34  A4西侧消防灯 → 同 A4 西侧走廊灯(双表同池,行20/21 共基数)(低)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (34,116,NULL,''),(34,122,NULL,''),(34,193,NULL,''),(34,148,NULL,''),(34,368,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池35  戎合A501公共 → 绑定表用途字段『公共用电/戎合』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (35,262,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池36  鑫皇公共 → 绑定表用途字段『公共用电/鑫皇』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (36,113,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池37  A6东侧走廊灯 → 账册A6东侧 AA24=1417.26=五户面积和已核实;zh 另对林观平620(95.43㎡)收取(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (37,109,NULL,''),(37,110,NULL,''),(37,117,NULL,''),(37,127,NULL,''),(37,149,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池38  A6东侧消防灯 → 同 A6 东侧走廊灯(双表同池,行24/25 共基数)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (38,109,NULL,''),(38,110,NULL,''),(38,117,NULL,''),(38,127,NULL,''),(38,149,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池39  可莱恩A602公共电 → 绑定表用途字段『公共用电/可莱恩 停用』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (39,107,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池40  A东侧货梯 → 待人工:A座四梯合并÷12487.04『A座计费面积』,与在租面积17424.19不符;孵化器户走固定额,需人工勾全A座在租户
-- 池41  戎合B101公共电 → 旧池名含租户名『戎合』(无表用途依据)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (41,262,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池42  杨文正公共电 → 旧池名含租户名『杨文正』(无表用途依据)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (42,125,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池43  可莱恩B201东侧公共电 → 绑定表用途字段『公共用电/可莱恩』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (43,107,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池44  可莱恩B201西侧公共电 → 绑定表用途字段『公共用电/可莱恩』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (44,107,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池45  欧培仪东侧公共 → 绑定表用途字段『公共用电/雷莱』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (45,114,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池46  欧培仪西侧公共 → 绑定表用途字段『公共用电/雷莱』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (46,114,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池47  碧沃丰B401东侧公共电 → 绑定表用途字段『公共用电/碧沃丰』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (47,103,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池48  碧沃丰B401西侧公共电 → 绑定表用途字段『公共用电/碧沃丰』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (48,103,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池49  B东侧楼梯间 → 账册B座楼梯间 分摊系数4=首层两户各0.5份+2F/3F/4F各1份(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (49,125,0.5,''),(49,129,0.5,''),(49,107,1,''),(49,114,1,''),(49,103,1,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池50  B东侧货梯 → 账册B座货梯 系数3=2F/3F/4F各一整份(首层不摊)(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (50,107,NULL,''),(50,114,NULL,''),(50,103,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池51  高建军C公共 → 旧池名含租户名『高建军』(无表用途依据)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (51,149,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池52  力美C201东侧公共电 → 旧池名含租户名『力美』(无表用途依据)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (52,105,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池53  C2消防 → 待人工:账册C2消防 范围列9户(顺心鸿…优硕达),AA=1503.10 只含8户面积,doc 未逐户列名
-- 池54  C2走廊 → 待人工:同 C2 走廊(双表同池)
-- 池55  力美C301东侧公共电 → 旧池名含租户名『力美』(无表用途依据)(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (55,105,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池56  道磁C401东侧公共电 → 待人工:账册行54『道磁C401空租,AE54=0手输』,租户档无『道磁』
-- 池57  可莱恩C402西侧公共电 → 绑定表用途字段『公共用电/可莱恩』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (57,107,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池58  C东侧楼梯间 → 待人工:C座楼梯间4份:1F高建军+杨道扬/卢志华/诺玲(两套面积基数2562/2322)+2F九户+3F各半+4F可莱恩半份
-- 池59  C东侧货梯电表1 → 待人工:C座东侧货梯:2楼各户按面积+3F陈相钊整份
-- 池60  C西侧货梯 → 待人工:C座西侧货梯:2楼各户按面积+3F邹同稳整份+4F可莱恩C402整份
-- 池61  邱彩云东侧公共电 → 待人工:账册行63 受益人=宇劲/邱彩云D101/叶子涛D103,前两者租户档缺失(D101 现为胡广清)
-- 池62  D201东侧电 → 绑定表用途字段『公共用电/汤周杰』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (62,131,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池63  D201西侧电 → 绑定表用途字段『公共用电/汤周杰』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (63,131,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池64  金纳D301东侧公共电 → 绑定表用途字段『公共用电/金纳』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (64,99,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池65  金纳D301西侧公共电 → 绑定表用途字段『公共用电/金纳』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (65,99,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池66  飞度东侧公共电 → 绑定表用途字段『公共用电/飞度』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (66,357,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池67  一元兰欣西侧公共电 → 绑定表用途字段『公共用电/一元兰欣』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (67,112,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池68  D东侧楼梯间 → 待人工:D座楼梯间实收5份>分母4;『宇劲』『邱彩云』租户档缺失(D101 现为胡广清)
-- 池69  D东侧货梯 → 账册D座货梯 2F/3F各摊两梯,4F飞度只收东梯(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (69,131,NULL,''),(69,99,NULL,''),(69,357,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池70  D西侧货梯 → 账册D座货梯 4F一元兰欣只收西梯(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (70,131,NULL,''),(70,99,NULL,''),(70,112,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池71  E二楼东侧公共电 → 绑定表用途字段『公共用电/张文意』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (71,369,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池72  天玛E201西侧公共电 → 绑定表用途字段『公共用电/天玛』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (72,128,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池73  翔海E301东侧公共电 → 绑定表用途字段『公共用电/翔海』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (73,265,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池74  翔海E301西侧公共电 → 绑定表用途字段『公共用电/翔海』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (74,265,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池75  翔海E401东侧公共电 → 绑定表用途字段『公共用电/翔海』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (75,265,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池76  翔海E401西侧公共电 → 绑定表用途字段『公共用电/翔海』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (76,265,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池77  E东侧楼梯间 → 账册E座楼梯间 信成洋半份;翔海走 zh 下段专表并入户内用量(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (77,123,0.5,''),(77,127,1,''),(77,128,1,''),(77,369,1,''),(77,265,1,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池78  E东侧货梯 → 账册E座东侧货梯 张文意整份;翔海走专表(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (78,369,NULL,''),(78,265,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池79  E西侧货梯 → 账册E座西侧货梯 天玛整份;翔海走专表(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (79,128,NULL,''),(79,265,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池80  思汗F101东侧公共电 → 绑定表用途字段『公共用电/思汗』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (80,102,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池81  优凯F201东侧公共电 → 绑定表用途字段『公共用电/桑尼号』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (81,152,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池82  优凯F201西侧公共电 → 绑定表用途字段『公共用电/桑尼号』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (82,152,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池83  优凯F301东侧公共电 → 绑定表用途字段『公共用电/桑尼号』(高)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (83,152,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池84  优凯F301西侧公共电 → 账册 zh F79『已合计三楼的公摊』:F201+F301 东西四表同归桑尼号(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (84,152,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池85  F401东侧公共电 → 待人工:账册行91-92 受益人=张执盛,租户档缺失(F401 现为博浩);zh F82 是唯一引 AD 列而非 AC 列的下游公式
-- 池86  F401西侧公共电 → 待人工:同池85(F401 西侧表)
-- 池87  F东侧楼梯间 → 账册F座楼梯间 4户各整份,第4户『张执盛』租户档缺失(F401 现为博浩)待补(中)
INSERT INTO alloc_rule_member (rule_id,tenant_id,weight,acct_month) VALUES (87,102,NULL,''),(87,152,NULL,''),(87,157,NULL,'')
  ON DUPLICATE KEY UPDATE weight=VALUES(weight);
-- 池88  F东侧货梯 → 待人工:F座东侧货梯:思汗/桑尼号/曾绍良/张执盛组合收取,doc 未拆到户
-- 池89  F西侧货梯 → 待人工:F座西侧货梯(+200度全在西梯):同上未拆到户
-- 池90  宿舍路灯公摊 → 园区/期级池,受益人=该期(宿舍区)在租租户自动带出(拍板#5),不落库
-- 池91  宿舍绿化水公摊 → 园区/期级池,受益人=该期(宿舍区)在租租户自动带出(拍板#5),不落库
