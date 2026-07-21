declare global { interface Window { __TOONFLOW_API_BASE__?: string; } }

let cachedRoot = "";
function token() { return localStorage.getItem("token") || localStorage.getItem("Authorization") || sessionStorage.getItem("token") || sessionStorage.getItem("Authorization") || ""; }
function normalizeRoot(value: string) { const root = value.trim().replace(/\/+$/, ""); if (!root) throw new Error("未取得后端服务地址"); return /\/api$/i.test(root) ? root : `${root}/api`; }
async function root() {
  if (cachedRoot) return cachedRoot;
  const configured = window.__TOONFLOW_API_BASE__ || localStorage.getItem("apiBaseUrl") || "";
  if (configured) return cachedRoot = normalizeRoot(configured);
  if (location.protocol !== "file:") return cachedRoot = normalizeRoot(location.origin);
  const response = await fetch("toonflow://getAppUrl"); if (!response.ok) throw new Error("获取后端服务地址失败");
  const result = await response.json(); return cachedRoot = normalizeRoot(result?.url || "");
}
export async function apiUrl(path: string) { return `${await root()}/${path.replace(/^\/?api(?:\/|$)/i, "").replace(/^\/+/, "")}`; }
export async function apiPost<T = any>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }; if (token()) headers.Authorization = token();
  const response = await fetch(await apiUrl(path), { method: "POST", headers, body: JSON.stringify(body || {}) });
  const result = await response.json().catch(() => null);
  if (!response.ok || (result?.code !== undefined && ![0, 200].includes(Number(result.code)))) {
    const error = new Error(result?.message || `请求失败（${response.status}）`) as Error & { status?: number }; error.status = response.status; throw error;
  }
  return Object.prototype.hasOwnProperty.call(result || {}, "data") ? result.data : result;
}
export function fileAsDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error || new Error("文件读取失败")); reader.readAsDataURL(file); }); }
export function downloadUrl(url: string, name: string) { const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.target = "_blank"; anchor.rel = "noopener"; anchor.click(); }

