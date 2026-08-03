-- 退租表改判退场(2026-08-05 用户三态裁定):帷幄/周应佳/大为/孙洋洋/陈世邦 14 块是退租
-- (表撤了),不是临时停用——改走 removed_ym(该月起不产行),retired_ym 清空。
-- 历史月(2024-02 及更早)照常显示与计账。dev 库原有 2024-06 停用批次(10块)保持停用不动。
SET NAMES utf8mb4;
UPDATE meter SET removed_ym='2024-03', retired_ym=NULL
WHERE id IN (230,424,1424,286,287,292,559,561,562,867,869,870,425,303);
SELECT id, name, retired_ym, removed_ym FROM meter WHERE id IN (230,424,1424,286,287,292,559,561,562,867,869,870,425,303);
