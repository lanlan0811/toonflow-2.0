import { upsertProductFactoryItem } from "@/lib/productFactory/service";
import { parseProductFactoryCsv } from "@/lib/productFactory/csvParser";

export { parseProductFactoryCsv } from "@/lib/productFactory/csvParser";

export async function importProductFactoryCsv(projectId: number, csvText: string) {
  const rows = parseProductFactoryCsv(csvText);
  const imported: number[] = [];
  const errors: Array<{ rowNumber: number; message: string }> = [];
  const imageMatches: Array<{ productId: number; sku: string; imageFiles: string[] }> = [];
  for (const row of rows) {
    try {
      const item = await upsertProductFactoryItem(projectId, {
        sku: String(row.sku || ""),
        name: String(row.name || ""),
        category: String(row.category || ""),
        description: String(row.description || ""),
        sellingPoints: String(row.selling_points || ""),
        attributes: String(row.attributes || ""),
      });
      imported.push(Number(item.id));
      imageMatches.push({ productId: Number(item.id), sku: String(row.sku || ""), imageFiles: String(row.image_files || "").split("|").map((value) => value.trim()).filter(Boolean) });
    } catch (error) {
      errors.push({ rowNumber: row.rowNumber, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { imported: imported.length, productIds: imported, errors, imageMatches };
}
