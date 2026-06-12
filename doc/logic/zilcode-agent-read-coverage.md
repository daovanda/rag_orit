# Zilcode Agent Read Coverage Map

Tai lieu nay la ban do hieu biet cho agent khi doc Zilcode. Muc tieu la giup
agent tra loi theo luong nghiep vu va quan he metadata, khong do JSON dai ra
cho nguoi dung.

Tai lieu duoc tong hop tu:

- ERD `zil.pdf`.
- Frontend/runtime trong `dai_viet/`.
- OpenAPI contract `api.json`.
- Read/write implementation hien tai trong `src/zilcode.ts`,
  `src/app-builder-graph.ts`, `src/app-builder-write.ts`.
- Smoke test thuc te va app mau da tao bang API.

## 1. Mo hinh cot loi

Zilcode la nen tang metadata-driven. App, man hinh, bang, cot, menu, quyen va
runtime khong nam trong code rieng cua tung app; chung duoc mo ta bang metadata.

Luong doc dung:

```text
session
  -> site / user / role / org
  -> app
  -> appservice
  -> service
  -> table
  -> column

app
  -> window
  -> tab
  -> field

app
  -> menu
  -> window / report / map layer / exec action

role
  -> roleapp / rolemenu / access
```

Ket luan quan trong:

- `window` la man hinh UI, khong phai du lieu that.
- `tab` la cau noi giua UI va `table`.
- `field` la cach hien thi/edit cua `column` trong mot `tab`.
- `table` / `column` la metadata cua nguon du lieu that ben duoi service.
- App dung table qua `appservice -> service -> table`, khong nen chi dua vao
  `appid` tren table.

## 2. Entity da doc duoc trong graph

Agent read graph hien tai da doc cac nhom sau:

| Nhom | Bang metadata | Y nghia | Trang thai |
| --- | --- | --- | --- |
| App | `n_app` | Ung dung con, theme, icon, app type, link | Da doc |
| Service | `n_service` | Nguon du lieu/backend: sqlrest, arcgis, basemap | Da doc |
| App-Service | `n_appservice` | Binding app voi service | Da doc |
| Table | `n_table` | Metadata bang/view/procedure/layer data | Da doc |
| Column | `n_column` | Metadata cot, datatype, lookup, domain, key | Da doc |
| Domain | `n_domain` | List/select value, status, color | Da doc |
| Window | `n_window` | Man hinh nghiep vu | Da doc |
| Tab | `n_tab` | Tab root/child/relation/view/workflow | Da doc |
| Field | `n_field` | UI field mapping toi column/domain/lookup | Da doc |
| Menu | `n_menu` | Dieu huong toi window/report/layer/action | Da doc |
| Cache | `n_cache` | Cache window config/layout | Da doc |
| Role | `n_role` | Vai tro nguoi dung | Da doc |
| Role App | `n_roleapp` | Role duoc vao app nao | Da doc |
| Role Menu | `n_rolemenu` | Role duoc thay menu nao | Da doc |
| Access | `n_access` | Quyen CRUD/export/archive theo table | Da doc |
| User | `n_user` | Tai khoan | Da doc |
| Role User | `n_roleuser` | User thuoc role nao | Da doc |
| Org | `n_org` | Don vi/to chuc | Da doc |
| Org User | `n_orguser` | User thuoc org nao | Da doc |
| Site | `n_site` | Pham vi tenant/company | Da doc |
| Workflow | `n_workflow` | Dinh nghia BPMN/workflow | Da doc metadata |
| Workflow Step | `n_wfstep` | Step, role/user/window gan voi workflow | Da doc metadata |
| Report | `n_report` | Cau hinh bao cao | Da doc metadata |
| Map | `n_map` | Cau hinh ban do | Da doc metadata neu co |
| Layer | `n_layer` | GIS layer / map layer | Da doc metadata neu co |
| Archive | `n_archive` | Cau hinh archive/attach/history theo table | Da doc metadata neu co |

### 2.1. Doi chieu ERD `zil.pdf`

Bang nay la checklist truc tiep tu ERD App Builder. Muc tieu khong phai noi
agent da ghi duoc moi thu, ma la tach ro: da doc duoc gi, y nghia la gi, va
pham vi write nao da an toan.

| Bang ERD | Vai tro trong Zilcode | Read graph | Write hien tai |
| --- | --- | --- | --- |
| `n_app` | Root cua ung dung; appname, apptype, theme, start exec, icon, site scope | Da doc | Core create/update/delete metadata |
| `n_appservice` | Bridge app -> service; app dung table thong qua service binding | Da doc | Core create/delete binding |
| `n_service` | Nguon du lieu/backend: sqlrest, arcgis, basemap, credential/url | Da doc | Chi bind/reuse trong App Builder core; sua service can contract rieng |
| `n_table` | Metadata table/view/layer data nam trong service | Da doc | Core metadata create/update/delete; khong tu dong tao/xoa physical DB table |
| `n_column` | Metadata column: datatype, key, lookup, domain, default, link column | Da doc | Core metadata create/update/delete; alter physical column la SQLCloud contract rieng |
| `n_domain` | Domain/list/status/select value cho column/field | Da doc | Core create/update/delete metadata |
| `n_window` | Man hinh UI cua app | Da doc | Core create/update/delete metadata |
| `n_tab` | Tab trong window, gan table, relation, workflow, permission flags | Da doc | Core create/update/delete metadata |
| `n_field` | UI field trong tab, map ve column/domain/lookup/display logic | Da doc | Core create/update/delete metadata |
| `n_menu` | Dieu huong; link window/report/layer/exec action va parent tree | Da doc | Core create/update/delete metadata |
| `n_cache` | Cache layout/config cua window/app sau khi metadata duoc build | Da doc | Xoa/refresh cache khi thay UI/menu/window/tab/field |
| `n_roleapp` | Role duoc truy cap app nao | Da doc | Core create/delete app permission |
| `n_rolemenu` | Role duoc thay/menu nao, co whereclause scope | Da doc | Core create/delete menu permission |
| `n_access` | Quyen table theo role: noinsert, noupdate, nodelete, noselect, noexport, noattach | Da doc | Core create/update/delete table access |
| `n_role` | Role master | Da doc | Chua coi la core write mac dinh; tac dong rong den permission |
| `n_roleuser` | Gan user vao role | Da doc | Da doc dependency; write day du can identity policy |
| `n_user` | Tai khoan nguoi dung | Da doc summary, khong doc password/PIN | Khong nam trong App Builder core write |
| `n_org` | To chuc/don vi, co parent tree va site scope | Da doc | Khong nam trong App Builder core write |
| `n_orguser` | Gan user vao org | Da doc | Da doc dependency; write day du can identity policy |
| `n_archive` | Cau hinh archive/history/attach theo table | Da doc neu co | Delete cascade metadata; full archive write contract chua chot |
| `n_site` | Tenant/site scope, database/server/url/options | Da doc | Khong nam trong App Builder core write |
| `n_workflow` | BPMN/workflow definition cua app | Da doc metadata | Chua co write contract day du |
| `n_wfstep` | Step workflow gan role/user/window/status | Da doc metadata | Chua co write contract day du |
| `n_report` | Report metadata, table binding, content/config | Da doc metadata | Chua co write contract day du |
| `n_map` | Cau hinh map/GIS workbook/subtype/center | Da doc metadata neu co | Chua co write contract day du |
| `n_layer` | GIS layer, service/table/maplayer binding | Da doc metadata neu co | Chua co write contract day du |

Canh ERD/graph toi thieu phai giu:

```text
n_app -> n_appservice -> n_service -> n_table -> n_column
n_app -> n_window -> n_tab -> n_field
n_tab -> n_table
n_field -> n_column
n_column/n_field -> n_domain
n_column/n_field -> linked table/column
n_app -> n_menu -> n_window/report/layer
n_role -> n_roleapp -> n_app
n_role -> n_rolemenu -> n_menu
n_role -> n_access -> n_table
n_role -> n_roleuser -> n_user
n_org -> n_orguser -> n_user
n_table -> n_archive
n_window -> n_cache
n_workflow -> n_wfstep -> role/user/window
n_map -> n_layer -> table/service
```

Neu mot cau tra loi cua agent noi ve “toan bo Zilcode”, no phai phan biet:

- **Da doc duoc trong graph**: cac bang/canh tren co node/edge/fact.
- **Da write an toan**: chi nhom App Builder core da co prepare/apply/verify.
- **Can write layer rieng**: SQLCloud physical schema, source editor,
  workflow/report/GIS full runtime, upload/proxy/query.

## 3. Cac canh quan he can agent uu tien

Core data:

```text
app -> appservice -> service -> table -> column
column -> domain
column -> linked table / linked column
table -> archive
```

Core UI:

```text
app -> window -> tab -> field
tab -> table
field -> column
field -> domain
field -> linked table / linked column
tab -> parent tab
tab -> relation table
tab -> workflow
```

Navigation:

```text
app -> menu
menu -> window
menu -> report
menu -> map layer
menu -> exec action
menu -> parent menu
```

Security:

```text
role -> roleapp -> app
role -> rolemenu -> menu
role -> access -> table
role -> roleuser -> user
org -> orguser -> user
```

Runtime:

```text
app -> workflow -> wfstep
wfstep -> role
wfstep -> user
wfstep -> window
app -> report
report -> table
map -> layer
layer -> table
layer -> service
```

## 4. Fact model cho cau tra loi

Graph tool khong chi tra nodes/edges. No can tra `answer_facts` de final answer
dien giai dung muc nguoi dung can:

- `flow_summary`: luong doc chinh da thay trong graph.
- `tables_summary`: cac table lien quan, key/display/cache/readonly/columns.
- `windows_summary`: window, tab, field, table binding.
- `menus_summary`: menu, parent, link window/report/layer.
- `permissions_summary`: roleapp/rolemenu/access tac dong den app/table/menu.
- `runtime_summary`: workflow/report/GIS/archive/user-org-site co ton tai khong.
- `workflow_summary`: workflow va step lien quan.
- `report_summary`: report va table/menu lien quan.
- `map_layer_summary`: map/layer/service/table/menu lien quan.
- `user_org_summary`: user/role/org/site scope.
- `site_summary`: tenant/site scope.
- `archive_summary`: archive theo table.
- `verified_relations`: canh da doc truc tiep tu graph.
- `dependency_summary`: node nao dang phu thuoc target, dung cho update/delete.
- `write_contract_summary`: table API, required fields, defaults, delete cascade.
- `creation_readiness`: du/chua du thong tin de prepare change.
- `operation_plan_facts`: thu tu operation an toan va buoc verify.
- `inferred_notes`: suy luan phai ghi ro la suy luan, khong phai fact.
- `truncated`: canh bao neu context bi cat.
- `scope`: node/source ma answer_facts bao phu.

Nguyen tac tra loi:

- Noi ro "da thay trong graph" khi co relation/fact truc tiep.
- Noi ro "suy doan/khuyen nghi" khi chi suy luan tu pattern.
- Khong list tat ca bang/window neu user khong hoi danh sach.
- Neu user hoi "luong hoat dong", uu tien mo ta flow truoc, list sau.

### 4.1. Semantic guide trong source

Ngoai tai lieu nay, y nghia may-doc cua Zilcode nam trong:

```text
src/zilcode-semantic.ts
```

File nay gom:

- `ZILCODE_CORE_FLOWS`: cac luong app/data/UI/menu/quyen/runtime.
- `ZILCODE_SEMANTIC_ENTITIES`: y nghia 26 bang ERD, primary key, field quan
  trong, relation, read/write status va safety note.
- `ZILCODE_RUNTIME_BOUNDARIES`: ranh gioi App Builder metadata voi SQLCloud,
  source runtime, upload va proxy.
- `ZILCODE_API_CONTRACTS`: phan loai 29 path trong `api.json` theo session,
  data CRUD, SQLCloud physical schema, source, upload, proxy va attendance
  runtime.
- `ZILCODE_AGENT_ANSWER_RULES`: quy tac de final answer giai thich theo fact
  da verify, khong suy doan thanh su that.

`app_builder_creation_schema` tra kem `semantic_guide` tu file nay. Nhu vay
model co the doc duoc "bang nay dung de lam gi" ngay trong tool result, thay vi
phai tu suy luan tu ten bang/cot.

## 5. Write capability hien tai

Da co write contract va apply flow cho nhom App Builder loi:

| Operation | Trang thai |
| --- | --- |
| create/update/delete app | Ho tro core; delete app la cascade metadata, khong xoa physical data |
| create/update/delete table metadata | Ho tro core; delete cascade field/tab/access/archive/column metadata |
| create/update/delete column metadata | Ho tro core |
| create/update/delete window | Ho tro core; delete cascade cache/field/tab/menu/rolemenu |
| create/update/delete tab | Ho tro core |
| create/update/delete field | Ho tro core |
| create/update/delete menu | Ho tro core |
| create/update/delete domain | Ho tro core |
| roleapp / rolemenu / access | Ho tro tao/cap nhat/xoa metadata quyen co ban |
| workflow/report/map/layer/archive | Da doc metadata, chua coi la write contract day du |

Bat buoc giu preview/apply:

```text
read graph -> creation schema -> prepare change -> user confirm -> apply change -> re-read verify
```

Agent khong duoc noi da tao/sua/xoa neu apply chua thanh cong.

## 6. App mau da tao bang API

App thuc te da tao de kiem chung:

```text
appid: 107
appname: Quan ly phong tro Codex 1781200182040
```

Thanh phan da tao:

- 4 domain: room status, contract status, tenant status, payment status.
- 5 table metadata:
  - rooms
  - tenants
  - contracts
  - invoices
  - payments
- 39 column metadata.
- 5 window.
- 5 tab.
- 39 field.
- 1 parent menu + 5 child menus.
- 1 appservice binding.
- roleapp, rolemenu, access cho cac table/menu.

Luu y: khi doc detail app, co the thay nhieu table hon so table vua tao neu app
dung chung serviceid voi app khac. Khi bao cao, can phan biet:

- "table da tao boi plan/script"
- "table dang visible qua service binding"

Lenh verify co the chay lai:

```text
npx tsx scripts/verify-room-rental-app.ts
```

Verifier nay chi doc metadata va kiem tra app phong tro co du 5 table, 39 column,
4 domain, 5 window, 5 tab, 39 field, 6 menu, roleapp/rolemenu va access. Neu can
kiem tra app khac, truyen `ROOM_RENTAL_APPID`.

## 7. Coverage con thieu de noi "toan bo Zilcode"

Chua nen overclaim la agent da write duoc moi nhom runtime. Cac phan can them:

1. Workflow write contract:
   - create/update/delete `n_workflow`, `n_wfstep`
   - validate BPMN content, role/user/window binding
   - verify step orphan/dependency

2. Report write contract:
   - create/update/delete `n_report`
   - validate report JSON/slice/filter/table binding
   - menu -> report binding

3. GIS/map/layer write contract:
   - create/update/delete map/layer metadata neu backend cho phep
   - validate arcgis service, layer id, table.maplayer, menu.maplayer
   - phan biet sqlrest va arcgis write path

4. Source/SQLCloud:
   - API co source/table/view/procedure/schema/database endpoints
   - can policy rieng vi co the tac dong physical schema/code
   - khong nen cho model tu viet SQL raw

5. Physical data/schema:
   - hien tai App Builder metadata co the tao table metadata
   - neu can tao physical DB table that, phai dung Table/Column API rieng va
     transaction/rollback/verify rieng

## 8. Runtime/API audit tu `api.json` va `dai_viet`

OpenAPI `api.json` co 29 path, chia thanh cac nhom:

| Nhom API | Endpoint mau | Y nghia voi agent |
| --- | --- | --- |
| Token/session | `/rest/token`, `/rest/token/roleorg`, `/rest/token/app/{id}`, `/rest/token/cache/{winid}` | Login, chon role/org, load app metadata, load window cache |
| Data | `/rest/{database}/{schema}/data/{table}` | CRUD record business/metadata qua SqlREST |
| Table/schema | `/rest/{database}/{schema}/table`, `/table/{name}` | Quan ly physical table/view metadata cua DB service |
| Column | `/column/{table}`, `/column/{table}/alter` | Doc/sua physical column schema |
| View | `/view`, `/view/{name}`, `/view/{name}/edit` | Tao/sua/xoa view SQL |
| Procedure | `/procedure`, `/procedure/{name}`, `/procedure/{name}/edit` | Tao/sua/xoa stored procedure |
| Query | `/query` | Chay query doc/ghi; rui ro cao |
| Source | `/rest/source/{d1}/{d2}` | Quan ly file/site source |
| Upload | `/rest/upload/{d1}/{d2}/{d3}` | Attachment/media upload |
| Proxy | `/rest/proxy` | Proxy request ngoai |
| Database/schema | `/rest/database`, `/rest/{database}/schema` | Liet ke/quan ly DB/schema |

Nguon runtime trong `dai_viet` da doi chieu:

| Module | File | Ket luan |
| --- | --- | --- |
| Main app loader | `js/index.js` | Dung token API de login/chon role/org/load app/cache; build menu; map report/GIS/workflow |
| NUT client core | `js/nut.js` | Dinh nghia URL runtime, ERD field order cho window/tab/field/menu, render type, file ext, configWindow, lookup cache, report/upload helpers |
| Dynamic window | `js/window.js` | Render window/tab/field; CRUD record qua `urlview`/`urledit`; enforce access flags; attachment/map/report actions |
| File manager | `js/fileman.js` | Source/upload file manager: list folder, preview text/image/doc, save content, upload file, create/delete folder/file |
| Workflow designer | `bpmnwf/index.js` | Tao/sua/xoa `n_workflow` va `n_wfstep`; step can role/user/window binding |
| SQLCloud | `sqlcloud/index.js` | Tao/sua/xoa physical table/view/procedure, alter column, query; can write policy rieng |
| Source editor | `sourceeditor/index.js` | Quan ly site/app source files qua `NUT.URL_SOURCE` va file manager |
| HTML report | `htmlreport/index.js` | Report cu dung window/cache dang `windowtype=report`; report body/filter/parameter nam trong cache |
| DataRock analyst | `datarock/index.js` | Analyst report runtime dung `n_report` voi `reporttype=analyst`, bind table qua `nv_appservice_table`, co ArcGIS/proxy data path |
| GIS | `js/agmap.js` | ArcGIS runtime, `maplayer`, FeatureLayer, table/layer binding, editor/select/query |

Lenh verify static:

```text
npx tsx scripts/smoke-zilcode-runtime-contract.ts
```

Script nay kiem tra:

- `api.json` co du endpoint runtime quan trong.
- Moi path trong `api.json` duoc phan loai trong `ZILCODE_API_CONTRACTS`.
- `dai_viet` co dung cac module/token/source/sqlcloud/workflow/report/GIS nhu audit.

Ket luan thiet ke:

- Metadata App Builder va physical schema la hai lop khac nhau.
- Agent co the tao app metadata hoan chinh bang App Builder write layer hien tai.
- Neu user yeu cau tao physical table/view/procedure/source file/query SQL, can mot
  write layer rieng voi confirm, policy, dependency scan, backup/verify.
- Khong nen tron endpoint SQLCloud vao `app_builder_prepare_change`; nen tao
  namespace tool rieng, vi rui ro cua physical DB cao hon metadata.

## 9. Huong xay read layer de agent hieu toan bo Zilcode

Kien truc nen giu:

```text
User question
  -> intent/router
  -> graph overview/search/subgraph/detail
  -> answer facts
  -> final answer synthesis
```

Trong do:

1. `graph_overview`
   - Tra skeleton toan he thong: node id, label, type, counts.
   - Khong tra full detail.

2. `graph_search`
   - Resolve ten tu nhien sang node.
   - Tra candidates va ly do match.

3. `graph_subgraph`
   - Mo vung lien quan theo depth.
   - Dung cho cau hoi ve dependency/impact.

4. `node_detail`
   - Tra detail cua node duoc chon.
   - Kem `answer_facts` da compact.

5. `creation_schema`
   - Tra contract ghi, required fields, defaults, operation order.
   - Dung truoc khi prepare create/update/delete.

6. `prepare_change`
   - Materialize plan thanh operations chuan API.
   - Validate required/default/dependency.
   - Luu pending plan.

7. `apply_change`
   - Chi chay sau confirm.
   - Apply theo thu tu an toan.
   - Tra result + errors + references.

8. `verify_after_apply`
   - Re-read graph/node detail.
   - So sanh expected vs actual.

## 10. Cach agent nen dien giai cho nguoi dung

Dung mau tu duy:

```text
Ban dang hoi ve [scope].

Trong graph minh thay:
- fact 1
- fact 2

Luong hoat dong cua phan nay la:
role/app/menu/window/tab/table/field...

Anh huong neu sua/xoa:
- dependency 1
- dependency 2

Neu muon thuc hien:
- can them thong tin nao
- hoac co the prepare plan ngay
```

Khong dung mau:

```text
Day la tat ca JSON/table/window/field...
```

Neu context bi cat hoac chi la suy luan, phai noi ro.
