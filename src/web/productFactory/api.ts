declare global {
  interface Window { __TOONFLOW_API_BASE__?: string; }
}

let apiRoot = "";

function token() {
  return localStorage.getItem("token") || localStorage.getItem("Authorization") || sessionStorage.getItem("token") || sessionStorage.getItem("Authorization") || "";
}

function normalizeRoot(value: string) {
  const root = value.trim().replace(/\/+$/, "");
  if (!root) throw new Error("未取得后端服务地址");
  return /\/api$/i.test(root) ? root : `${root}/api`;
}

async function getRoot() {
  if (apiRoot) return apiRoot;
  const configured = window.__TOONFLOW_API_BASE__ || localStorage.getItem("apiBaseUrl") || "";
  if (configured) return apiRoot = normalizeRoot(configured);
  if (location.protocol !== "file:") return apiRoot = normalizeRoot(location.origin);
  const response = await fetch("toonflow://getAppUrl");
  if (!response.ok) throw new Error(`获取后端服务地址失败（${response.status}）`);
  const result = await response.json();
  return apiRoot = normalizeRoot(result?.url || "");
}

export async function apiUrl(path: string) {
  const root = await getRoot();
  const suffix = path.trim().replace(/^\/?api(?:\/|$)/i, "").replace(/^\/+/, "");
  return `${root}/${suffix}`;
}

export async function apiPost<T = any>(path: string, payload: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token()) headers.Authorization = token();
  const response = await fetch(await apiUrl(path), { method: "POST", headers, body: JSON.stringify(payload || {}) });
  const result = await response.json().catch(() => null);
  if (!response.ok || (result?.code !== undefined && ![0, 200].includes(Number(result.code)))) throw new Error(result?.message || `请求失败（${response.status}）`);
  return Object.prototype.hasOwnProperty.call(result || {}, "data") ? result.data : result;
}

export async function apiDownload(path: string, payload: unknown, fileName: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token()) headers.Authorization = token();
  const response = await fetch(await apiUrl(path), { method: "POST", headers, body: JSON.stringify(payload) });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.message || `导出失败（${response.status}）`);
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}
