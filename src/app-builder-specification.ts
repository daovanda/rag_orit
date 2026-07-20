import { asRecord, getCaseInsensitiveValue, toArrayValues } from "./utils";

export type ApplicationPhase =
  | "app_service"
  | "table_column"
  | "domain_lookup_relation"
  | "window_tab_field"
  | "menu_permission"
  | "cache_verification";

export interface ApplicationSpecification {
  app?: Record<string, unknown>;
  services?: Record<string, unknown>[];
  appservices?: Record<string, unknown>[];
  service_bindings?: Record<string, unknown>[];
  tables?: Array<Record<string, unknown> & { columns?: Record<string, unknown>[] }>;
  domains?: Record<string, unknown>[];
  relations?: Record<string, unknown>[];
  windows?: Array<Record<string, unknown> & {
    tabs?: Array<Record<string, unknown> & { fields?: Record<string, unknown>[] }>;
  }>;
  menus?: Record<string, unknown>[];
  roleapps?: Record<string, unknown>[];
  rolemenus?: Record<string, unknown>[];
  accesses?: Record<string, unknown>[];
}

export interface CompiledSpecificationOperation {
  id: string;
  op: string;
  phase: ApplicationPhase;
  depends_on: string[];
  record?: Record<string, unknown>;
  id_value?: unknown;
}

export interface SpecificationPhasePlan {
  phase: ApplicationPhase;
  operation_ids: string[];
  depends_on_phases: ApplicationPhase[];
}

export interface SpecificationValidationIssue {
  code: string;
  entity: string;
  field?: string;
  expected?: unknown;
  actual?: unknown;
  evidence: Record<string, unknown>;
  repair_hint: string;
}

export interface SpecificationValidationContext {
  applications?: Record<string, unknown>[];
  services?: Record<string, unknown>[];
  tables?: Record<string, unknown>[];
  columns?: Record<string, unknown>[];
  domains?: Record<string, unknown>[];
  windows?: Record<string, unknown>[];
  tabs?: Record<string, unknown>[];
  fields?: Record<string, unknown>[];
  menus?: Record<string, unknown>[];
  roles?: Record<string, unknown>[];
  roleapps?: Record<string, unknown>[];
  rolemenus?: Record<string, unknown>[];
  accesses?: Record<string, unknown>[];
}

export interface CompiledApplicationSpecification {
  valid: boolean;
  operations: CompiledSpecificationOperation[];
  phases: SpecificationPhasePlan[];
  verification_targets: Array<Record<string, unknown>>;
  blocking_errors: SpecificationValidationIssue[];
  warnings: string[];
}

const PHASE_ORDER: ApplicationPhase[] = [
  "app_service",
  "table_column",
  "domain_lookup_relation",
  "window_tab_field",
  "menu_permission",
  "cache_verification"
];

const ID_FIELDS = new Set([
  "appid", "serviceid", "appserviceid", "tableid", "columnid", "domainid",
  "windowid", "tabid", "fieldid", "menuid", "roleappid", "rolemenuid", "accessid"
]);

export function compileApplicationSpecification(
  input: Record<string, unknown>,
  context: SpecificationValidationContext = {}
): CompiledApplicationSpecification {
  const specification = normalizeSpecification(input);
  const blockingErrors = validateApplicationSpecification(specification, context);
  if (blockingErrors.length) {
    return {
      valid: false,
      operations: [],
      phases: buildPhasePlans([]),
      verification_targets: [],
      blocking_errors: blockingErrors,
      warnings: []
    };
  }

  const operations: CompiledSpecificationOperation[] = [];
  const warnings: string[] = [];
  const refs = createReferenceRegistry();
  const appRecord = specification.app ? { ...specification.app } : undefined;
  let appOperationId: string | undefined;

  if (appRecord) {
    appOperationId = operationId("create_app", entityKey(appRecord, "main"));
    operations.push(createOperation(appOperationId, "create_app", "app_service", appRecord));
    registerRef(refs.app, appRecord, appOperationId);
  }

  specification.services?.forEach((service, index) => {
    const id = operationId("create_service", entityKey(service, String(index + 1)));
    operations.push(createOperation(id, "create_service", "app_service", stripNested(service)));
    registerRef(refs.service, service, id);
  });

  const serviceBindings = [...(specification.appservices ?? []), ...(specification.service_bindings ?? [])];
  serviceBindings.forEach((binding, index) => {
    const record = { ...binding };
    const dependencies: string[] = [];
    wireAppReference(record, appOperationId, dependencies);
    wireNamedReference(record, ["service_ref", "service", "service_name", "servicename"], "serviceid", refs.service, "serviceid", dependencies);
    operations.push(createOperation(
      operationId("create_appservice", entityKey(binding, String(index + 1))),
      "create_appservice",
      "app_service",
      record,
      dependencies
    ));
  });

  specification.tables?.forEach((table, tableIndex) => {
    const tableRecord = { ...table };
    delete tableRecord.columns;
    const tableId = operationId("create_table", entityKey(tableRecord, String(tableIndex + 1)));
    const dependencies: string[] = [];
    wireNamedReference(tableRecord, ["service_ref", "service", "service_name", "servicename"], "serviceid", refs.service, "serviceid", dependencies);
    operations.push(createOperation(tableId, "create_table", "table_column", tableRecord, dependencies));
    registerRef(refs.table, table, tableId);

    toRecords(table.columns).forEach((column, columnIndex) => {
      const columnRecord = stripRelationFields(column);
      const columnId = operationId(
        "create_column",
        `${entityKey(tableRecord, String(tableIndex + 1))}_${entityKey(column, String(columnIndex + 1))}`
      );
      columnRecord.tableid = columnRecord.tableid ?? `$${tableId}.tableid`;
      operations.push(createOperation(columnId, "create_column", "table_column", columnRecord, [tableId]));
      registerColumnRef(refs.column, table, column, columnId);
    });
  });

  specification.domains?.forEach((domain, index) => {
    const record = stripNested(domain);
    const id = operationId("create_domain", entityKey(domain, String(index + 1)));
    const dependencies: string[] = [];
    wireAppReference(record, appOperationId, dependencies);
    operations.push(createOperation(id, "create_domain", "domain_lookup_relation", record, dependencies));
    registerRef(refs.domain, domain, id);
  });

  specification.tables?.forEach(table => {
    const tableRef = resolveRef(refs.table, referenceValue(table));
    toRecords(table.columns).forEach(column => {
      const columnRef = resolveColumnRef(refs.column, table, column);
      if (!columnRef) return;
      const relationPatch = buildColumnRelationPatch(column, refs, table);
      if (!Object.keys(relationPatch.record).length) return;
      operations.push(createOperation(
        operationId("update_column_relation", entityKey(column, columnRef)),
        "update_column",
        "domain_lookup_relation",
        relationPatch.record,
        dedupe([columnRef, tableRef, ...relationPatch.dependencies].filter((value): value is string => Boolean(value))),
        `$${columnRef}.columnid`
      ));
    });
  });

  specification.windows?.forEach((window, windowIndex) => {
    const record = stripKeys(window, ["tabs"]);
    const id = operationId("create_window", entityKey(window, String(windowIndex + 1)));
    const dependencies: string[] = [];
    wireAppReference(record, appOperationId, dependencies);
    operations.push(createOperation(id, "create_window", "window_tab_field", record, dependencies));
    registerRef(refs.window, window, id);
  });

  specification.windows?.forEach((window, windowIndex) => {
    const windowRef = resolveRef(refs.window, referenceValue(window));
    const tabs = orderTabsParentFirst(toRecords(window.tabs));
    tabs.forEach((tab, tabIndex) => {
      const record = { ...tab };
      delete record.fields;
      const id = operationId(
        "create_tab",
        `${entityKey(window, String(windowIndex + 1))}_${entityKey(tab, String(tabIndex + 1))}`
      );
      const dependencies: string[] = [];
      if (windowRef) {
        record.windowid = record.windowid ?? `$${windowRef}.windowid`;
        dependencies.push(windowRef);
      }
      wireNamedReference(record, ["table_ref", "table", "table_name", "tablename"], "tableid", refs.table, "tableid", dependencies);
      const parentRef = resolveRef(refs.tab, ci(tab, "parenttab_ref") ?? ci(tab, "parent_tab") ?? ci(tab, "parent"));
      if (parentRef) {
        record.parenttabid = record.parenttabid ?? `$${parentRef}.tabid`;
        dependencies.push(parentRef);
      }
      operations.push(createOperation(id, "create_tab", "window_tab_field", record, dedupe(dependencies)));
      registerTabRef(refs.tab, window, tab, id);
    });
  });

  specification.windows?.forEach(window => {
    toRecords(window.tabs).forEach(tab => {
      const tabRef = resolveTabRef(refs.tab, window, tab);
      if (!tabRef) return;
      toRecords(tab.fields).forEach((field, fieldIndex) => {
        const record = { ...field };
        const id = operationId("create_field", `${entityKey(tab, tabRef)}_${entityKey(field, String(fieldIndex + 1))}`);
        record.tabid = record.tabid ?? `$${tabRef}.tabid`;
        const columnRef = resolveColumnRefForField(refs.column, tab, field);
        const dependencies = [tabRef];
        if (columnRef) {
          record.columnid = record.columnid ?? `$${columnRef}.columnid`;
          dependencies.push(columnRef);
        }
        wireNamedReference(record, ["domain_ref", "domain", "domain_name", "domainname"], "domainid", refs.domain, "domainid", dependencies);
        wireNamedReference(record, ["lookup_table", "link_table", "table_ref"], "linktableid", refs.table, "tableid", dependencies);
        operations.push(createOperation(id, "create_field", "window_tab_field", record, dedupe(dependencies)));
        registerFieldRef(refs.field, window, tab, field, id);
      });
    });
  });

  specification.windows?.forEach(window => {
    toRecords(window.tabs).forEach(tab => {
      const tabRef = resolveTabRef(refs.tab, window, tab);
      if (!tabRef) return;
      const patch = buildTabRelationPatch(window, tab, refs);
      if (!Object.keys(patch.record).length) return;
      operations.push(createOperation(
        operationId("update_tab_relation", entityKey(tab, tabRef)),
        "update_tab",
        "window_tab_field",
        patch.record,
        dedupe([tabRef, ...patch.dependencies]),
        `$${tabRef}.tabid`
      ));
    });
  });

  // Explicit relations are compiled only after planned tabs and fields have
  // references, otherwise a valid planned target would be silently skipped.
  specification.relations?.forEach((relation, index) => {
    const target = normalizeText(String(ci(relation, "target") ?? ci(relation, "entity") ?? "tab"));
    const targetRef = target === "column"
      ? resolveColumnRefFromValue(refs.column, ci(relation, "column_ref") ?? ci(relation, "column"))
      : resolveRef(refs.tab, ci(relation, "tab_ref") ?? ci(relation, "tab"));
    if (!targetRef) return;
    const idField = target === "column" ? "columnid" : "tabid";
    const patch = buildExplicitRelationPatch(relation, target, refs);
    operations.push(createOperation(
      operationId(`update_${target}_relation`, entityKey(relation, String(index + 1))),
      `update_${target}`,
      target === "column" ? "domain_lookup_relation" : "window_tab_field",
      patch.record,
      dedupe([targetRef, ...patch.dependencies]),
      `$${targetRef}.${idField}`
    ));
  });

  specification.menus?.forEach((menu, index) => {
    const record = { ...menu };
    const dependencies: string[] = [];
    wireAppReference(record, appOperationId, dependencies);
    wireNamedReference(record, ["window_ref", "window", "window_name", "windowname"], "linkwindowid", refs.window, "windowid", dependencies);
    const id = operationId("create_menu", entityKey(menu, String(index + 1)));
    operations.push(createOperation(id, "create_menu", "menu_permission", record, dedupe(dependencies)));
    registerRef(refs.menu, record, id);
  });

  specification.roleapps?.forEach((roleapp, index) => {
    const record = { ...roleapp };
    const dependencies: string[] = [];
    wireAppReference(record, appOperationId, dependencies);
    operations.push(createOperation(
      operationId("create_roleapp", entityKey(roleapp, String(index + 1))),
      "create_roleapp",
      "menu_permission",
      record,
      dependencies
    ));
  });

  specification.rolemenus?.forEach((rolemenu, index) => {
    const record = { ...rolemenu };
    const dependencies: string[] = [];
    wireNamedReference(record, ["menu_ref", "menu", "menu_name", "menuname"], "menuid", refs.menu, "menuid", dependencies);
    operations.push(createOperation(
      operationId("create_rolemenu", entityKey(rolemenu, String(index + 1))),
      "create_rolemenu",
      "menu_permission",
      record,
      dependencies
    ));
  });

  specification.accesses?.forEach((access, index) => {
    const record = { ...access };
    const dependencies: string[] = [];
    wireNamedReference(record, ["table_ref", "table", "table_name", "tablename"], "tableid", refs.table, "tableid", dependencies);
    operations.push(createOperation(
      operationId("create_access", entityKey(access, String(index + 1))),
      "create_access",
      "menu_permission",
      record,
      dependencies
    ));
  });

  const sorted = topologicalSort(operations);
  return {
    valid: true,
    operations: sorted,
    phases: buildPhasePlans(sorted),
    verification_targets: buildVerificationTargets(sorted),
    blocking_errors: [],
    warnings
  };
}

export function validateApplicationSpecification(
  specification: ApplicationSpecification,
  context: SpecificationValidationContext = {}
): SpecificationValidationIssue[] {
  const errors: SpecificationValidationIssue[] = [];
  const tables = toRecords(specification.tables);
  const domains = toRecords(specification.domains);
  const windows = toRecords(specification.windows);
  const menus = toRecords(specification.menus);
  const tableKeys = entityKeySet(tables, context.tables, ["tableid", "tablename", "alias"]);
  const domainKeys = entityKeySet(domains, context.domains, ["domainid", "domainname"]);
  const windowKeys = entityKeySet(windows, context.windows, ["windowid", "windowname"]);
  const menuKeys = entityKeySet(menus, context.menus, ["menuid", "menuname"]);
  const roleKeys = entityKeySet([], context.roles, ["roleid", "rolename"]);
  const columns = tables.flatMap(table => toRecords(table.columns).map(column => ({ table, column })));
  const columnKeys = new Set<string>();
  const allTables = [...tables, ...(context.tables ?? [])];

  for (const { table, column } of columns) {
    for (const key of referenceCandidates(column)) columnKeys.add(key);
    const tableKey = normalizeText(String(referenceValue(table) ?? ""));
    const columnKey = normalizeText(String(referenceValue(column) ?? ""));
    if (tableKey && columnKey) columnKeys.add(`${tableKey}.${columnKey}`);

    const domainRef = ci(column, "domain_ref") ?? ci(column, "domain") ?? ci(column, "domain_name") ?? ci(column, "domainname");
    if (hasValue(domainRef) && !hasReference(domainKeys, domainRef)) {
      errors.push(issue("domain_not_found", `column:${String(referenceValue(column) ?? "unknown")}`, "domainid", "existing or planned domain", domainRef, "Tạo domain trong specification hoặc dùng domainid/domain_ref hợp lệ."));
    }

    const lookupTable = ci(column, "lookup_table") ?? ci(column, "link_table") ?? ci(column, "linktableid");
    if (hasValue(lookupTable) && !isOperationReference(lookupTable) && !hasReference(tableKeys, lookupTable)) {
      errors.push(issue("lookup_table_not_found", `column:${String(referenceValue(column) ?? "unknown")}`, "linktableid", "existing or planned table", lookupTable, "Dùng table_ref hợp lệ cho lookup."));
    } else if (hasValue(lookupTable) && !isOperationReference(lookupTable)) {
      const linkColumn = ci(column, "linkcolumn") ?? ci(column, "mapcolumn");
      const targetTable = findRecordByReference(allTables, lookupTable, ["tableid", "tablename", "alias", "key", "ref"]);
      const targetColumns = targetTable ? columnsForTable(targetTable, tables, context) : [];
      if (!hasValue(linkColumn)) {
        errors.push(issue("lookup_column_missing", `column:${String(referenceValue(column) ?? "unknown")}`, "linkcolumn", "column in lookup table", linkColumn, "Lookup phải chỉ rõ linkcolumn/mapcolumn của table đích."));
      } else {
        const targetColumn = findRecordByReference(targetColumns, linkColumn, ["columnid", "columnname", "alias", "key", "ref"]);
        if (!targetColumn) {
          errors.push(issue("lookup_column_not_found", `column:${String(referenceValue(column) ?? "unknown")}`, "linkcolumn", "existing column in lookup table", linkColumn, "Dùng linkcolumn tồn tại trong linktableid/lookup_table."));
        } else if (!compatibleDataTypes(ci(column, "datatype") ?? ci(column, "columntype"), ci(targetColumn, "datatype") ?? ci(targetColumn, "columntype"))) {
          errors.push(issue("lookup_type_mismatch", `column:${String(referenceValue(column) ?? "unknown")}`, "linkcolumn", ci(column, "datatype") ?? ci(column, "columntype"), ci(targetColumn, "datatype") ?? ci(targetColumn, "columntype"), "Column lookup và column đích phải có datatype tương thích."));
        }
      }
    }
  }

  for (const window of windows) {
    const tabs = toRecords(window.tabs);
    const tabKeys = entityKeySet(tabs, context.tabs, ["tabid", "tabname"]);
    const windowFieldKeys = entityKeySet(
      tabs.flatMap(tab => toRecords(tab.fields)),
      context.fields,
      ["fieldid", "fieldname", "columnname"]
    );
    for (const tab of tabs) {
      const tableRef = ci(tab, "table_ref") ?? ci(tab, "table") ?? ci(tab, "table_name") ?? ci(tab, "tablename") ?? ci(tab, "tableid");
      const tabTable = findRecordByReference(allTables, tableRef, ["tableid", "tablename", "alias", "key", "ref"]);
      const tabColumns = tabTable ? columnsForTable(tabTable, tables, context) : [];
      if (!hasValue(tableRef) || (!isOperationReference(tableRef) && !hasReference(tableKeys, tableRef))) {
        errors.push(issue("tab_table_not_found", `tab:${String(referenceValue(tab) ?? "unknown")}`, "tableid", "existing or planned table", tableRef, "Mỗi tab phải chỉ rõ table_ref/tableid hợp lệ."));
      }

      const parentRef = ci(tab, "parenttab_ref") ?? ci(tab, "parent_tab") ?? ci(tab, "parent") ?? ci(tab, "parenttabid");
      if (hasValue(parentRef) && !isOperationReference(parentRef) && !hasReference(tabKeys, parentRef)) {
        errors.push(issue("parent_tab_not_in_window", `tab:${String(referenceValue(tab) ?? "unknown")}`, "parenttabid", "tab in the same window", parentRef, "Parent tab phải nằm trong cùng window."));
      }

      for (const field of toRecords(tab.fields)) {
        const columnRef = ci(field, "column_ref") ?? ci(field, "column") ?? ci(field, "column_name") ?? ci(field, "columnname") ?? ci(field, "columnid");
        if (!hasValue(columnRef) || (!isOperationReference(columnRef) && !hasReference(columnKeys, columnRef))) {
          errors.push(issue("field_column_not_found", `field:${String(referenceValue(field) ?? "unknown")}`, "columnid", "column in the tab table", columnRef, "Mỗi field phải map tới column hợp lệ."));
        } else if (!isOperationReference(columnRef) && tabTable && !findRecordByReference(tabColumns, columnRef, ["columnid", "columnname", "alias", "key", "ref"])) {
          errors.push(issue("field_column_wrong_table", `field:${String(referenceValue(field) ?? "unknown")}`, "columnid", `column of table ${String(referenceValue(tabTable) ?? tableRef)}`, columnRef, "Field chỉ được map tới column thuộc table của chính tab."));
        }
      }

      for (const relationField of ["linkparentfield_ref", "linkchildfield_ref", "relateparentfield_ref", "relatechildfield_ref"]) {
        const fieldRef = ci(tab, relationField);
        if (hasValue(fieldRef) && !hasReference(windowFieldKeys, fieldRef)) {
          errors.push(issue("tab_relation_field_not_found", `tab:${String(referenceValue(tab) ?? "unknown")}`, relationField, "field in related tab/window", fieldRef, "Dùng field_ref tồn tại trong specification hoặc metadata hiện tại."));
        }
      }

      validateTabRelationPairs(tab, tabs, tables, context, errors);
      validateTabAccessFlags(tab, specification.accesses ?? [], errors);
    }
  }

  validateExplicitRelations(specification.relations ?? [], windows, tables, context, errors);

  for (const menu of menus) {
    const windowRef = ci(menu, "window_ref") ?? ci(menu, "window") ?? ci(menu, "window_name") ?? ci(menu, "windowname") ?? ci(menu, "linkwindowid") ?? ci(menu, "windowid");
    const reportRef = ci(menu, "reportid");
    const layerRef = ci(menu, "layerid");
    if (!hasValue(windowRef) && !hasValue(reportRef) && !hasValue(layerRef)) {
      errors.push(issue("menu_target_missing", `menu:${String(referenceValue(menu) ?? "unknown")}`, "linkwindowid", "window/report/layer target", null, "Menu phải trỏ tới window, report hoặc layer được hỗ trợ."));
    } else if (hasValue(windowRef) && !isOperationReference(windowRef) && !hasReference(windowKeys, windowRef)) {
      errors.push(issue("menu_window_not_found", `menu:${String(referenceValue(menu) ?? "unknown")}`, "linkwindowid", "existing or planned window", windowRef, "Dùng window_ref/windowid hợp lệ."));
    }
  }

  validatePermissionDuplicates(specification, context, tableKeys, menuKeys, roleKeys, errors);
  validateNoMetadataIdMutation(specification, errors);
  return dedupeIssues(errors);
}

export function normalizeSpecification(input: Record<string, unknown>): ApplicationSpecification {
  const nested = asRecord(input.specification) ?? asRecord(input.application_specification) ?? input;
  return {
    app: asRecord(nested.app) ?? undefined,
    services: toRecords(nested.services),
    appservices: toRecords(nested.appservices ?? nested.app_services),
    service_bindings: toRecords(nested.service_bindings),
    tables: toRecords(nested.tables) as ApplicationSpecification["tables"],
    domains: toRecords(nested.domains),
    relations: toRecords(nested.relations),
    windows: toRecords(nested.windows) as ApplicationSpecification["windows"],
    menus: toRecords(nested.menus),
    roleapps: toRecords(nested.roleapps ?? nested.role_apps),
    rolemenus: toRecords(nested.rolemenus ?? nested.role_menus),
    accesses: toRecords(nested.accesses ?? nested.access)
  };
}

function validatePermissionDuplicates(
  specification: ApplicationSpecification,
  context: SpecificationValidationContext,
  tableKeys: Set<string>,
  menuKeys: Set<string>,
  roleKeys: Set<string>,
  errors: SpecificationValidationIssue[]
): void {
  const checks: Array<{
    entity: string;
    planned: Record<string, unknown>[];
    existing: Record<string, unknown>[];
    refField: string;
    refs: Set<string>;
  }> = [
    { entity: "roleapp", planned: toRecords(specification.roleapps), existing: context.roleapps ?? [], refField: "appid", refs: new Set() },
    { entity: "rolemenu", planned: toRecords(specification.rolemenus), existing: context.rolemenus ?? [], refField: "menuid", refs: menuKeys },
    { entity: "access", planned: toRecords(specification.accesses), existing: context.accesses ?? [], refField: "tableid", refs: tableKeys }
  ];

  for (const check of checks) {
    const seen = new Set<string>();
    for (const record of [...check.existing, ...check.planned]) {
      const roleRef = ci(record, "roleid") ?? ci(record, "role_ref") ?? ci(record, "role") ?? ci(record, "role_name");
      const targetRef = ci(record, check.refField)
        ?? ci(record, check.entity === "rolemenu" ? "menu_ref" : check.entity === "access" ? "table_ref" : "app_ref");
      if (!hasValue(roleRef) || !hasValue(targetRef)) continue;
      if (roleKeys.size && !isOperationReference(roleRef) && !hasReference(roleKeys, roleRef)) {
        errors.push(issue("permission_role_not_found", check.entity, "roleid", "existing role", roleRef, "Dùng roleid/role_ref hợp lệ."));
      }
      if (check.refs.size && !isOperationReference(targetRef) && !hasReference(check.refs, targetRef)) {
        errors.push(issue("permission_target_not_found", check.entity, check.refField, "existing or planned target", targetRef, "Dùng target reference hợp lệ."));
      }
      const key = `${normalizeText(String(roleRef))}:${normalizeText(String(targetRef))}`;
      if (seen.has(key)) {
        errors.push(issue("duplicate_permission", check.entity, check.refField, "unique role-target pair", key, "Bỏ permission trùng khỏi specification."));
      }
      seen.add(key);
    }
  }
}

function validateNoMetadataIdMutation(
  specification: ApplicationSpecification,
  errors: SpecificationValidationIssue[]
): void {
  const allRecords = [
    specification.app,
    ...toRecords(specification.services),
    ...toRecords(specification.appservices),
    ...toRecords(specification.tables),
    ...toRecords(specification.domains),
    ...toRecords(specification.windows),
    ...toRecords(specification.menus),
    ...toRecords(specification.roleapps),
    ...toRecords(specification.rolemenus),
    ...toRecords(specification.accesses)
  ].filter((record): record is Record<string, unknown> => Boolean(record));

  for (const record of allRecords) {
    if (String(ci(record, "action") ?? "create").toLowerCase() === "create") continue;
    for (const field of Object.keys(record)) {
      if (!ID_FIELDS.has(field.toLowerCase())) continue;
      errors.push(issue("metadata_id_mutation_forbidden", String(referenceValue(record) ?? "entity"), field, "immutable metadata ID", record[field], "Không update primary key/metadata ID; dùng id làm target và chỉ sửa field nghiệp vụ."));
    }
  }
}

function buildColumnRelationPatch(
  column: Record<string, unknown>,
  refs: ReturnType<typeof createReferenceRegistry>,
  table: Record<string, unknown>
): { record: Record<string, unknown>; dependencies: string[] } {
  const record: Record<string, unknown> = {};
  const dependencies: string[] = [];
  const domainRef = ci(column, "domain_ref") ?? ci(column, "domain") ?? ci(column, "domain_name") ?? ci(column, "domainname");
  const domainOperation = resolveRef(refs.domain, domainRef);
  if (domainOperation) {
    record.domainid = `$${domainOperation}.domainid`;
    dependencies.push(domainOperation);
  } else if (ci(column, "domainid") !== undefined) {
    record.domainid = ci(column, "domainid");
  }

  const lookupTable = ci(column, "lookup_table") ?? ci(column, "link_table") ?? ci(column, "lookup_table_ref");
  const tableOperation = resolveRef(refs.table, lookupTable);
  if (tableOperation) {
    record.linktableid = `$${tableOperation}.tableid`;
    dependencies.push(tableOperation);
  } else if (ci(column, "linktableid") !== undefined) {
    record.linktableid = ci(column, "linktableid");
  }
  for (const field of ["linkcolumn", "mapcolumn", "whereclause", "defaultvalue"]) {
    if (ci(column, field) !== undefined) record[field] = ci(column, field);
  }
  return { record, dependencies };
}

function buildTabRelationPatch(
  window: Record<string, unknown>,
  tab: Record<string, unknown>,
  refs: ReturnType<typeof createReferenceRegistry>
): { record: Record<string, unknown>; dependencies: string[] } {
  const record: Record<string, unknown> = {};
  const dependencies: string[] = [];
  const fieldMappings: Array<[string, string]> = [
    ["linkparentfield_ref", "linkparentfield"],
    ["linkchildfield_ref", "linkchildfield"],
    ["relateparentfield_ref", "relateparentfield"],
    ["relatechildfield_ref", "relatechildfield"]
  ];
  for (const [source, target] of fieldMappings) {
    const fieldRef = ci(tab, source);
    const fieldOperation = resolveFieldRef(refs.field, window, tab, fieldRef);
    if (fieldOperation) {
      record[target] = `$${fieldOperation}.fieldid`;
      dependencies.push(fieldOperation);
    } else if (ci(tab, target) !== undefined) {
      record[target] = ci(tab, target);
    }
  }
  const relateTable = ci(tab, "relate_table_ref") ?? ci(tab, "relatetable_ref");
  const tableOperation = resolveRef(refs.table, relateTable);
  if (tableOperation) {
    record.relatetableid = `$${tableOperation}.tableid`;
    dependencies.push(tableOperation);
  } else if (ci(tab, "relatetableid") !== undefined) {
    record.relatetableid = ci(tab, "relatetableid");
  }
  return { record, dependencies };
}

function buildExplicitRelationPatch(
  relation: Record<string, unknown>,
  target: string,
  refs: ReturnType<typeof createReferenceRegistry>
): { record: Record<string, unknown>; dependencies: string[] } {
  const record = stripKeys(relation, [
    "target", "entity", "relation_type", "kind",
    "column_ref", "column", "tab_ref", "tab"
  ]);
  const dependencies: string[] = [];

  if (target === "column") {
    const patch = buildColumnRelationPatch(relation, refs, {});
    return {
      record: { ...record, ...patch.record },
      dependencies: patch.dependencies
    };
  }

  const fieldMappings: Array<[string[], string]> = [
    [["linkparentfield_ref"], "linkparentfield"],
    [["linkchildfield_ref"], "linkchildfield"],
    [["relateparentfield_ref"], "relateparentfield"],
    [["relatechildfield_ref"], "relatechildfield"]
  ];
  for (const [aliases, targetField] of fieldMappings) {
    const fieldOperation = resolveRef(refs.field, firstValue(relation, aliases));
    if (!fieldOperation) continue;
    record[targetField] = `$${fieldOperation}.fieldid`;
    dependencies.push(fieldOperation);
  }

  const tableOperation = resolveRef(
    refs.table,
    firstValue(relation, ["relate_table_ref", "relatetable_ref"])
  );
  if (tableOperation) {
    record.relatetableid = `$${tableOperation}.tableid`;
    dependencies.push(tableOperation);
  }
  return { record, dependencies: dedupe(dependencies) };
}

function createReferenceRegistry() {
  return {
    app: new Map<string, string>(),
    service: new Map<string, string>(),
    table: new Map<string, string>(),
    column: new Map<string, string>(),
    domain: new Map<string, string>(),
    window: new Map<string, string>(),
    tab: new Map<string, string>(),
    field: new Map<string, string>(),
    menu: new Map<string, string>()
  };
}

function createOperation(
  id: string,
  op: string,
  phase: ApplicationPhase,
  record: Record<string, unknown>,
  dependsOn: string[] = [],
  idValue?: unknown
): CompiledSpecificationOperation {
  return {
    id,
    op,
    phase,
    depends_on: dedupe(dependsOn.filter(Boolean)),
    record: stripKeys(record, []),
    id_value: idValue
  };
}

function wireAppReference(record: Record<string, unknown>, appOperationId: string | undefined, dependencies: string[]): void {
  if (record.appid !== undefined || !appOperationId) return;
  record.appid = `$${appOperationId}.appid`;
  dependencies.push(appOperationId);
}

function wireNamedReference(
  record: Record<string, unknown>,
  sourceFields: string[],
  targetField: string,
  registry: Map<string, string>,
  resultIdField: string,
  dependencies: string[]
): void {
  if (record[targetField] !== undefined) return;
  const source = sourceFields.map(field => ci(record, field)).find(hasValue);
  const operation = resolveRef(registry, source);
  if (!operation) return;
  record[targetField] = `$${operation}.${resultIdField}`;
  dependencies.push(operation);
}

function registerRef(registry: Map<string, string>, record: Record<string, unknown>, operationIdValue: string): void {
  for (const key of referenceCandidates(record)) registry.set(key, operationIdValue);
}

function registerColumnRef(
  registry: Map<string, string>,
  table: Record<string, unknown>,
  column: Record<string, unknown>,
  operationIdValue: string
): void {
  registerRef(registry, column, operationIdValue);
  const tableKey = normalizeText(String(referenceValue(table) ?? ""));
  const columnKey = normalizeText(String(referenceValue(column) ?? ""));
  if (tableKey && columnKey) registry.set(`${tableKey}.${columnKey}`, operationIdValue);
}

function registerTabRef(
  registry: Map<string, string>,
  window: Record<string, unknown>,
  tab: Record<string, unknown>,
  operationIdValue: string
): void {
  registerRef(registry, tab, operationIdValue);
  const windowKey = normalizeText(String(referenceValue(window) ?? ""));
  const tabKey = normalizeText(String(referenceValue(tab) ?? ""));
  if (windowKey && tabKey) registry.set(`${windowKey}.${tabKey}`, operationIdValue);
}

function registerFieldRef(
  registry: Map<string, string>,
  window: Record<string, unknown>,
  tab: Record<string, unknown>,
  field: Record<string, unknown>,
  operationIdValue: string
): void {
  registerRef(registry, field, operationIdValue);
  const windowKey = normalizeText(String(referenceValue(window) ?? ""));
  const tabKey = normalizeText(String(referenceValue(tab) ?? ""));
  const fieldKey = normalizeText(String(referenceValue(field) ?? ""));
  if (tabKey && fieldKey) registry.set(`${tabKey}.${fieldKey}`, operationIdValue);
  if (windowKey && tabKey && fieldKey) registry.set(`${windowKey}.${tabKey}.${fieldKey}`, operationIdValue);
}

function resolveRef(registry: Map<string, string>, value: unknown): string | undefined {
  if (!hasValue(value)) return undefined;
  if (isOperationReference(value)) return String(value).match(/^\$([^.]+)\./)?.[1];
  for (const candidate of referenceCandidates({ ref: value })) {
    const found = registry.get(candidate);
    if (found) return found;
  }
  return registry.get(normalizeText(String(value)));
}

function resolveColumnRef(
  registry: Map<string, string>,
  table: Record<string, unknown>,
  column: Record<string, unknown>
): string | undefined {
  const tableKey = normalizeText(String(referenceValue(table) ?? ""));
  const columnKey = normalizeText(String(referenceValue(column) ?? ""));
  return registry.get(`${tableKey}.${columnKey}`) ?? resolveRef(registry, referenceValue(column));
}

function resolveColumnRefFromValue(registry: Map<string, string>, value: unknown): string | undefined {
  return resolveRef(registry, value);
}

function resolveColumnRefForField(
  registry: Map<string, string>,
  tab: Record<string, unknown>,
  field: Record<string, unknown>
): string | undefined {
  const tableRef = normalizeText(String(ci(tab, "table_ref") ?? ci(tab, "table") ?? ci(tab, "table_name") ?? ci(tab, "tablename") ?? ""));
  const columnRef = normalizeText(String(ci(field, "column_ref") ?? ci(field, "column") ?? ci(field, "column_name") ?? ci(field, "columnname") ?? ci(field, "fieldname") ?? ""));
  return registry.get(`${tableRef}.${columnRef}`) ?? registry.get(columnRef);
}

function resolveTabRef(
  registry: Map<string, string>,
  window: Record<string, unknown>,
  tab: Record<string, unknown>
): string | undefined {
  const windowKey = normalizeText(String(referenceValue(window) ?? ""));
  const tabKey = normalizeText(String(referenceValue(tab) ?? ""));
  return registry.get(`${windowKey}.${tabKey}`) ?? resolveRef(registry, referenceValue(tab));
}

function resolveFieldRef(
  registry: Map<string, string>,
  window: Record<string, unknown>,
  tab: Record<string, unknown>,
  value: unknown
): string | undefined {
  const windowKey = normalizeText(String(referenceValue(window) ?? ""));
  const tabKey = normalizeText(String(referenceValue(tab) ?? ""));
  const fieldKey = normalizeText(String(value ?? ""));
  return registry.get(`${windowKey}.${tabKey}.${fieldKey}`)
    ?? registry.get(`${tabKey}.${fieldKey}`)
    ?? registry.get(fieldKey);
}

function topologicalSort(operations: CompiledSpecificationOperation[]): CompiledSpecificationOperation[] {
  const remaining = new Map(operations.map(operation => [operation.id, operation]));
  const completed = new Set<string>();
  const output: CompiledSpecificationOperation[] = [];

  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter(operation => operation.depends_on.every(dependency => completed.has(dependency) || !remaining.has(dependency)))
      .sort((left, right) => phaseIndex(left.phase) - phaseIndex(right.phase) || left.id.localeCompare(right.id));
    if (!ready.length) {
      throw new Error(`Operation DAG có dependency cycle: ${[...remaining.keys()].join(", ")}`);
    }
    for (const operation of ready) {
      output.push(operation);
      completed.add(operation.id);
      remaining.delete(operation.id);
    }
  }
  return output;
}

function buildPhasePlans(operations: CompiledSpecificationOperation[]): SpecificationPhasePlan[] {
  return PHASE_ORDER.map((phase, index) => ({
    phase,
    operation_ids: operations.filter(operation => operation.phase === phase).map(operation => operation.id),
    depends_on_phases: index === 0 ? [] : [PHASE_ORDER[index - 1]]
  }));
}

function buildVerificationTargets(operations: CompiledSpecificationOperation[]): Array<Record<string, unknown>> {
  return operations
    .filter(operation => operation.op.startsWith("create_") || operation.op.startsWith("update_") || operation.op.startsWith("delete_"))
    .map(operation => ({
      operation_id: operation.id,
      action: operation.op.split("_")[0],
      entity: operation.op.replace(/^(create|update|delete)_/, ""),
      expected_record: operation.record,
      id_value: operation.id_value,
      phase: operation.phase
    }));
}

function orderTabsParentFirst(tabs: Record<string, unknown>[]): Record<string, unknown>[] {
  const pending = [...tabs];
  const ordered: Record<string, unknown>[] = [];
  const known = new Set<string>();
  while (pending.length) {
    const readyIndex = pending.findIndex(tab => {
      const parent = ci(tab, "parenttab_ref") ?? ci(tab, "parent_tab") ?? ci(tab, "parent");
      return !hasValue(parent) || known.has(normalizeText(String(parent)));
    });
    const index = readyIndex >= 0 ? readyIndex : 0;
    const [tab] = pending.splice(index, 1);
    ordered.push(tab);
    for (const key of referenceCandidates(tab)) known.add(key);
  }
  return ordered;
}

function entityKeySet(
  planned: Record<string, unknown>[],
  existing: Record<string, unknown>[] | undefined,
  fields: string[]
): Set<string> {
  const output = new Set<string>();
  for (const record of [...planned, ...(existing ?? [])]) {
    for (const key of referenceCandidates(record)) output.add(key);
    for (const field of fields) {
      const value = ci(record, field);
      if (hasValue(value)) output.add(normalizeText(String(value)));
    }
  }
  return output;
}

function referenceCandidates(record: Record<string, unknown>): string[] {
  const values = [
    ci(record, "key"), ci(record, "ref"), ci(record, "id"), ci(record, "name"),
    ci(record, "appid"), ci(record, "appname"), ci(record, "serviceid"), ci(record, "servicename"),
    ci(record, "tableid"), ci(record, "tablename"), ci(record, "alias"),
    ci(record, "columnid"), ci(record, "columnname"), ci(record, "domainid"), ci(record, "domainname"),
    ci(record, "windowid"), ci(record, "windowname"), ci(record, "tabid"), ci(record, "tabname"),
    ci(record, "fieldid"), ci(record, "fieldname"), ci(record, "menuid"), ci(record, "menuname"),
    ci(record, "roleid"), ci(record, "rolename")
  ];
  return dedupe(values.filter(hasValue).map(value => normalizeText(String(value))).filter(Boolean));
}

function referenceValue(record: Record<string, unknown>): unknown {
  return ci(record, "ref") ?? ci(record, "key") ?? ci(record, "name")
    ?? ci(record, "appname") ?? ci(record, "servicename") ?? ci(record, "tablename")
    ?? ci(record, "columnname") ?? ci(record, "domainname") ?? ci(record, "windowname")
    ?? ci(record, "tabname") ?? ci(record, "fieldname") ?? ci(record, "menuname");
}

function stripRelationFields(record: Record<string, unknown>): Record<string, unknown> {
  return stripKeys(record, [
    "domain_ref", "domain", "domain_name", "domainname",
    "lookup_table", "lookup_table_ref", "link_table", "linkcolumn", "linktableid", "mapcolumn"
  ]);
}

function stripNested(record: Record<string, unknown>): Record<string, unknown> {
  return stripKeys(record, ["columns", "tabs", "fields"]);
}

function stripKeys(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const blocked = new Set([
    "key", "ref",
    "app_ref", "app_name", "application", "application_name", "app",
    "service_ref", "service_name", "service",
    "table_ref", "table_name", "table",
    "window_ref", "window_name", "window",
    "tab_ref", "tab_name", "tab", "parent_tab", "parenttab_ref", "parent",
    "column_ref", "column_name", "column",
    "domain_ref", "domain_name", "domain",
    "lookup_table", "lookup_table_ref", "link_table",
    "menu_ref", "menu_name", "menu",
    "role_ref", "role_name", "role",
    "linkwindow_ref", "link_window", "linkwindow",
    "linkparentfield_ref", "linkchildfield_ref",
    "relateparentfield_ref", "relatechildfield_ref",
    "relate_table_ref", "relatetable_ref",
    ...keys
  ].map(key => key.toLowerCase()));
  return Object.fromEntries(Object.entries(record).filter(([key]) => !blocked.has(key.toLowerCase())));
}

function operationId(prefix: string, value: string): string {
  const suffix = normalizeText(value).replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "item";
  return `${prefix}_${suffix}`;
}

function entityKey(record: Record<string, unknown>, fallback: string): string {
  return String(referenceValue(record) ?? fallback);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "")
    .trim();
}

function phaseIndex(phase: ApplicationPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

function hasReference(registry: Set<string>, value: unknown): boolean {
  if (!hasValue(value)) return false;
  return registry.has(normalizeText(String(value)));
}

function findRecordByReference(
  records: Record<string, unknown>[],
  value: unknown,
  fields: string[]
): Record<string, unknown> | undefined {
  if (!hasValue(value)) return undefined;
  const normalized = normalizeText(String(value));
  return records.find(record => fields.some(field => {
    const candidate = ci(record, field);
    return hasValue(candidate) && normalizeText(String(candidate)) === normalized;
  }));
}

function columnsForTable(
  table: Record<string, unknown>,
  plannedTables: Record<string, unknown>[],
  context: SpecificationValidationContext
): Record<string, unknown>[] {
  const nested = toRecords(table.columns);
  if (nested.length) return nested;
  const tableId = ci(table, "tableid");
  const tableName = ci(table, "tablename");
  return [
    ...plannedTables.flatMap(item => toRecords(item.columns)),
    ...(context.columns ?? [])
  ].filter(column =>
    (hasValue(tableId) && normalizeText(String(ci(column, "tableid") ?? "")) === normalizeText(String(tableId)))
    || (hasValue(tableName) && normalizeText(String(ci(column, "tablename") ?? "")) === normalizeText(String(tableName)))
  );
}

function validateTabRelationPairs(
  tab: Record<string, unknown>,
  windowTabs: Record<string, unknown>[],
  plannedTables: Record<string, unknown>[],
  context: SpecificationValidationContext,
  errors: SpecificationValidationIssue[]
): void {
  const parentRef = ci(tab, "parenttab_ref") ?? ci(tab, "parent_tab") ?? ci(tab, "parent") ?? ci(tab, "parenttabid");
  const parentTab = findRecordByReference(
    [...windowTabs, ...(context.tabs ?? [])],
    parentRef,
    ["tabid", "tabname", "key", "ref"]
  );
  const pairs: Array<[string[], string[], string]> = [
    [["linkparentfield_ref", "linkparentfield"], ["linkchildfield_ref", "linkchildfield"], "link"],
    [["relateparentfield_ref", "relateparentfield"], ["relatechildfield_ref", "relatechildfield"], "relate"]
  ];

  for (const [parentFields, childFields, kind] of pairs) {
    const parentFieldRef = firstValue(tab, parentFields);
    const childFieldRef = firstValue(tab, childFields);
    if (!hasValue(parentFieldRef) && !hasValue(childFieldRef)) continue;
    if (!hasValue(parentFieldRef) || !hasValue(childFieldRef)) {
      errors.push(issue(
        "tab_relation_pair_incomplete",
        `tab:${String(referenceValue(tab) ?? "unknown")}`,
        `${kind}parentfield/${kind}childfield`,
        "both parent and child field references",
        { parent: parentFieldRef, child: childFieldRef },
        "Quan hệ tab phải có đủ field phía parent và child."
      ));
      continue;
    }
    if (!parentTab) {
      errors.push(issue(
        "tab_relation_parent_missing",
        `tab:${String(referenceValue(tab) ?? "unknown")}`,
        "parenttabid",
        "parent tab for relation",
        parentRef,
        "Khai báo parent_tab/parenttabid trước khi cấu hình cặp field quan hệ."
      ));
      continue;
    }

    const parentField = findRecordByReference(
      [...toRecords(parentTab.fields), ...(context.fields ?? [])],
      parentFieldRef,
      ["fieldid", "fieldname", "columnname", "key", "ref"]
    );
    const childField = findRecordByReference(
      [...toRecords(tab.fields), ...(context.fields ?? [])],
      childFieldRef,
      ["fieldid", "fieldname", "columnname", "key", "ref"]
    );
    if (!parentField || !childField) continue;
    const parentType = fieldDataType(parentField, parentTab, plannedTables, context);
    const childType = fieldDataType(childField, tab, plannedTables, context);
    if (!compatibleDataTypes(parentType, childType)) {
      errors.push(issue(
        "tab_relation_type_mismatch",
        `tab:${String(referenceValue(tab) ?? "unknown")}`,
        `${kind}parentfield/${kind}childfield`,
        parentType,
        childType,
        "Field parent và child phải map tới column có datatype tương thích."
      ));
    }
  }
}

function validateTabAccessFlags(
  tab: Record<string, unknown>,
  accesses: Record<string, unknown>[],
  errors: SpecificationValidationIssue[]
): void {
  const tableRef = ci(tab, "table_ref") ?? ci(tab, "table") ?? ci(tab, "tablename") ?? ci(tab, "tableid");
  if (!hasValue(tableRef)) return;
  const flags = ["noinsert", "noupdate", "nodelete", "noselect", "noexport"];
  for (const access of accesses) {
    const accessTable = ci(access, "table_ref") ?? ci(access, "table") ?? ci(access, "tablename") ?? ci(access, "tableid");
    if (!hasValue(accessTable) || normalizeText(String(accessTable)) !== normalizeText(String(tableRef))) continue;
    for (const flag of flags) {
      const tabFlag = ci(tab, flag);
      const accessFlag = ci(access, flag);
      if (toBooleanFlag(tabFlag) === true && hasValue(accessFlag) && toBooleanFlag(accessFlag) === false) {
        errors.push(issue(
          "tab_access_flag_conflict",
          `tab:${String(referenceValue(tab) ?? "unknown")}`,
          flag,
          true,
          accessFlag,
          `Tab chặn ${flag} ở UI nhưng access lại khai báo cho phép; hãy đồng bộ ý nghĩa quyền.`
        ));
      }
    }
  }
}

function validateExplicitRelations(
  relations: Record<string, unknown>[],
  windows: Record<string, unknown>[],
  tables: Record<string, unknown>[],
  context: SpecificationValidationContext,
  errors: SpecificationValidationIssue[]
): void {
  const allTabs = [...windows.flatMap(window => toRecords(window.tabs)), ...(context.tabs ?? [])];
  const allColumns = [...tables.flatMap(table => toRecords(table.columns)), ...(context.columns ?? [])];
  const plannedFieldLocations = windows.flatMap(window =>
    toRecords(window.tabs).flatMap(tab =>
      toRecords(tab.fields).map(field => ({ field, tab }))
    )
  );
  const contextFieldLocations = (context.fields ?? []).map(field => ({
    field,
    tab: findRecordByReference(
      context.tabs ?? [],
      ci(field, "tabid"),
      ["tabid", "tabname", "key", "ref"]
    ) ?? {}
  }));
  const fieldLocations = [...plannedFieldLocations, ...contextFieldLocations];
  for (const relation of relations) {
    const target = normalizeText(String(ci(relation, "target") ?? ci(relation, "entity") ?? "tab"));
    const ref = target === "column"
      ? ci(relation, "column_ref") ?? ci(relation, "column") ?? ci(relation, "columnid")
      : ci(relation, "tab_ref") ?? ci(relation, "tab") ?? ci(relation, "tabid");
    const records = target === "column" ? allColumns : allTabs;
    const fields = target === "column"
      ? ["columnid", "columnname", "key", "ref"]
      : ["tabid", "tabname", "key", "ref"];
    if (!['column', 'tab'].includes(target)) {
      errors.push(issue("relation_target_unsupported", `relation:${String(referenceValue(relation) ?? "unknown")}`, "target", "column or tab", target, "Chỉ cấu hình relation trên metadata n_column hoặc n_tab đã được chứng minh."));
      continue;
    }
    if (!hasValue(ref) || !findRecordByReference(records, ref, fields)) {
      errors.push(issue("relation_target_not_found", `relation:${String(referenceValue(relation) ?? "unknown")}`, `${target}_ref`, `existing or planned ${target}`, ref, "Dùng target reference tồn tại trong specification hoặc metadata hiện tại."));
    }

    const relationKind = normalizeText(String(ci(relation, "relation_type") ?? ci(relation, "kind") ?? ""));
    if (relationKind.includes("many")) {
      const required = [
        ["relatetableid", "relate_table_ref"],
        ["relateparentfield", "relateparentfield_ref"],
        ["relatechildfield", "relatechildfield_ref"]
      ];
      for (const aliases of required) {
        if (!hasValue(firstValue(relation, aliases))) {
          errors.push(issue("many_to_many_relation_incomplete", `relation:${String(referenceValue(relation) ?? "unknown")}`, aliases[0], "explicit relation table and parent/child fields", undefined, "Many-to-many phải khai báo relatetableid cùng relateparentfield/relatechildfield."));
        }
      }

      const relationTableRef = firstValue(relation, ["relatetableid", "relate_table_ref"]);
      if (hasValue(relationTableRef) && !findRecordByReference(
        [...tables, ...(context.tables ?? [])],
        relationTableRef,
        ["tableid", "tablename", "alias", "key", "ref"]
      )) {
        errors.push(issue(
          "relation_table_not_found",
          `relation:${String(referenceValue(relation) ?? "unknown")}`,
          "relatetableid",
          "existing or planned relation table",
          relationTableRef,
          "Dùng relate_table_ref/relatetableid tồn tại trong specification hoặc metadata hiện tại."
        ));
      }

      const parentFieldRef = firstValue(relation, ["relateparentfield", "relateparentfield_ref"]);
      const childFieldRef = firstValue(relation, ["relatechildfield", "relatechildfield_ref"]);
      const parentLocation = findFieldLocation(fieldLocations, parentFieldRef);
      const childLocation = findFieldLocation(fieldLocations, childFieldRef);
      if (hasValue(parentFieldRef) && !parentLocation) {
        errors.push(issue(
          "relation_field_not_found",
          `relation:${String(referenceValue(relation) ?? "unknown")}`,
          "relateparentfield",
          "existing or planned field",
          parentFieldRef,
          "Dùng relateparentfield_ref trỏ tới field tồn tại."
        ));
      }
      if (hasValue(childFieldRef) && !childLocation) {
        errors.push(issue(
          "relation_field_not_found",
          `relation:${String(referenceValue(relation) ?? "unknown")}`,
          "relatechildfield",
          "existing or planned field",
          childFieldRef,
          "Dùng relatechildfield_ref trỏ tới field tồn tại."
        ));
      }
      if (parentLocation && childLocation && !compatibleDataTypes(
        fieldDataType(parentLocation.field, parentLocation.tab, tables, context),
        fieldDataType(childLocation.field, childLocation.tab, tables, context)
      )) {
        errors.push(issue(
          "relation_field_type_mismatch",
          `relation:${String(referenceValue(relation) ?? "unknown")}`,
          "relateparentfield/relatechildfield",
          fieldDataType(parentLocation.field, parentLocation.tab, tables, context),
          fieldDataType(childLocation.field, childLocation.tab, tables, context),
          "Hai field của quan hệ many-to-many phải có datatype tương thích."
        ));
      }
    }
  }
}

function findFieldLocation(
  locations: Array<{ field: Record<string, unknown>; tab: Record<string, unknown> }>,
  reference: unknown
): { field: Record<string, unknown>; tab: Record<string, unknown> } | undefined {
  if (!hasValue(reference)) return undefined;
  const normalized = normalizeText(String(reference));
  return locations.find(({ field }) => referenceCandidates(field).includes(normalized));
}

function fieldDataType(
  field: Record<string, unknown>,
  tab: Record<string, unknown>,
  plannedTables: Record<string, unknown>[],
  context: SpecificationValidationContext
): unknown {
  const direct = ci(field, "datatype") ?? ci(field, "columntype");
  if (hasValue(direct)) return direct;
  const tableRef = ci(tab, "table_ref") ?? ci(tab, "table") ?? ci(tab, "tablename") ?? ci(tab, "tableid");
  const table = findRecordByReference(
    [...plannedTables, ...(context.tables ?? [])],
    tableRef,
    ["tableid", "tablename", "alias", "key", "ref"]
  );
  const columnRef = ci(field, "column_ref") ?? ci(field, "column") ?? ci(field, "columnname") ?? ci(field, "columnid");
  const column = table
    ? findRecordByReference(columnsForTable(table, plannedTables, context), columnRef, ["columnid", "columnname", "alias", "key", "ref"])
    : undefined;
  return column ? ci(column, "datatype") ?? ci(column, "columntype") : undefined;
}

function compatibleDataTypes(left: unknown, right: unknown): boolean {
  if (!hasValue(left) || !hasValue(right)) return true;
  return dataTypeFamily(left) === dataTypeFamily(right);
}

function dataTypeFamily(value: unknown): string {
  const type = normalizeText(String(value));
  if (/(tinyint|smallint|bigint|int|decimal|numeric|float|real|money|number)/.test(type)) return "number";
  if (/(bit|bool)/.test(type)) return "boolean";
  if (/(date|time)/.test(type)) return "datetime";
  if (/(uniqueidentifier|uuid)/.test(type)) return "uuid";
  if (/(char|text|string|nvarchar|varchar)/.test(type)) return "text";
  return type;
}

function firstValue(record: Record<string, unknown>, fields: string[]): unknown {
  return fields.map(field => ci(record, field)).find(hasValue);
}

function toBooleanFlag(value: unknown): boolean | undefined {
  if (!hasValue(value)) return undefined;
  if (value === true || value === 1 || ["1", "true", "yes", "y"].includes(String(value).toLowerCase())) return true;
  if (value === false || value === 0 || ["0", "false", "no", "n"].includes(String(value).toLowerCase())) return false;
  return undefined;
}

function isOperationReference(value: unknown): boolean {
  return typeof value === "string" && /^\$[A-Za-z0-9_-]+\.[A-Za-z0-9_]+$/.test(value.trim());
}

function issue(
  code: string,
  entity: string,
  field: string,
  expected: unknown,
  actual: unknown,
  repairHint: string
): SpecificationValidationIssue {
  return {
    code,
    entity,
    field,
    expected,
    actual,
    evidence: { source: "application_specification", entity, field },
    repair_hint: repairHint
  };
}

function dedupeIssues(errors: SpecificationValidationIssue[]): SpecificationValidationIssue[] {
  const seen = new Set<string>();
  return errors.filter(error => {
    const key = JSON.stringify([error.code, error.entity, error.field, error.actual]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function ci(record: Record<string, unknown>, key: string): unknown {
  return getCaseInsensitiveValue(record, key);
}

function toRecords(value: unknown): Record<string, unknown>[] {
  return toArrayValues(value).filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}
