import test from "node:test";
import assert from "node:assert/strict";
import { parseProductFactoryCsv } from "../../src/lib/productFactory/csvParser";

test("CSV 支持 BOM、引号逗号和图片路径字段", () => {
  const rows = parseProductFactoryCsv('\uFEFFsku,name,description,image_files\r\nA-1,"咖啡杯, 黑色","含有""防滑""底座","A-1/front.png|A-1/detail.png"');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "A-1");
  assert.equal(rows[0].name, "咖啡杯, 黑色");
  assert.equal(rows[0].description, '含有"防滑"底座');
  assert.equal(rows[0].image_files, "A-1/front.png|A-1/detail.png");
});

test("CSV 校验必填列、未闭合引号和 500 行限制", () => {
  assert.throws(() => parseProductFactoryCsv("sku,description\nA,测试"), /name/);
  assert.throws(() => parseProductFactoryCsv('sku,name\nA,"测试'), /未闭合/);
  const rows = Array.from({ length: 501 }, (_, index) => `${index},商品${index}`).join("\n");
  assert.throws(() => parseProductFactoryCsv(`sku,name\n${rows}`), /500/);
});
