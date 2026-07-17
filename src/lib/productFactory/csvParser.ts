function parseCsvLine(line: string) {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(value.trim());
      value = "";
    } else value += char;
  }
  if (quoted) throw new Error("CSV 包含未闭合的引号");
  result.push(value.trim());
  return result;
}

export function parseProductFactoryCsv(csvText: string) {
  const lines = String(csvText || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV 至少需要表头和一行商品数据");
  if (lines.length - 1 > 500) throw new Error("CSV 单次最多导入 500 行");
  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  for (const field of ["sku", "name"]) if (!headers.includes(field)) throw new Error(`CSV 缺少必填字段：${field}`);
  return lines.slice(1).map((line, index): Record<string, string | number> & { rowNumber: number } => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column] || ""]));
    return { rowNumber: index + 2, ...row };
  });
}
