import { describe, expect, it } from "vitest";
import { __buildAppBuilderInventoryForTest } from "../src/zilcode";

describe("Zilcode App Builder inventory associations", () => {
  it("uses field.tabid as the authoritative tab relation and tableid only as a missing-tabid fallback", () => {
    const inventory = __buildAppBuilderInventoryForTest({
      applications: [{ appid: 1, appname: "Shared table tabs" }],
      services: [{ serviceid: 10 }],
      appservices: [{ appserviceid: 11, appid: 1, serviceid: 10 }],
      tables: [{ tableid: 20, serviceid: 10, tablename: "shared_table" }],
      columns: [],
      windows: [{ windowid: 40, appid: 1, windowname: "Shared" }],
      tabs: [
        { tabid: 50, windowid: 40, tableid: 20, tabname: "First" },
        { tabid: 51, windowid: 40, tableid: 20, tabname: "Second" }
      ],
      fields: [
        { fieldid: 501, tabid: 50, tableid: 20, fieldname: "First only" },
        { fieldid: 511, tabid: 51, tableid: 20, fieldname: "Second only" },
        { fieldid: 599, tableid: 20, fieldname: "Legacy fallback" }
      ],
      menus: [],
      domains: [],
      caches: [],
      roleapps: [],
      rolemenus: [],
      accesses: [],
      archives: [],
      workflows: [],
      wfsteps: [],
      reports: [],
      layers: []
    }) as { apps: Array<{ windows: Array<{ tabs: Array<{ tabid: number; fields: Array<{ fieldid: number }> }> }> }> };

    const tabs = inventory.apps[0].windows[0].tabs;
    expect(tabs.find(tab => tab.tabid === 50)?.fields.map(field => field.fieldid)).toEqual([501, 599]);
    expect(tabs.find(tab => tab.tabid === 51)?.fields.map(field => field.fieldid)).toEqual([511, 599]);
  });
});
