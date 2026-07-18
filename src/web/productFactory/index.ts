import "./styles.css";
import { apiDownload, apiPost, fileAsDataUrl } from "./api";
import { renderCanvas } from "./canvas";
import type { Artifact, FactoryGraph, FactoryItem, ModelOption, Project, Workspace } from "./types";

declare global {
  interface Window {
    __TOONFLOW_PRODUCT_FACTORY__?: boolean;
    __TOONFLOW_NORMALIZE_PRODUCT_PROMO_URL__?: () => boolean;
  }
}

const shouldBootstrap = !window.__TOONFLOW_PRODUCT_FACTORY__;
if (shouldBootstrap) {
  window.__TOONFLOW_PRODUCT_FACTORY__ = true;
}

const ROUTE = "/product-factory";
const LEGACY_ROUTE = "/product-promo";
const MARKER = "__TOONFLOW_PRODUCT_FACTORY_V1__";
const LEGACY_MARKER = "__TOONFLOW_PRODUCT_PROMO_V1__";
const ROOT_ID = "tf-product-factory-root";
const STEPS = ["品牌设置", "商品与参考图", "输出套餐", "批量出图", "图片审核", "批量视频", "素材导出"];
const imageSlotNames: Record<string, string> = { main_clean: "干净主图", scene_studio: "棚拍场景", scene_lifestyle: "生活场景", scene_detail: "材质特写" };
const videoSlotNames: Record<string, string> = { video_hero: "英雄镜头", video_lifestyle: "生活镜头" };

const state = {
  root: null as HTMLElement | null,
  host: null as HTMLElement | null,
  projects: [] as Project[],
  imageModels: [] as ModelOption[],
  videoModels: [] as ModelOption[],
  workspace: null as Workspace | null,
  items: [] as FactoryItem[],
  selected: new Set<number>(),
  step: 0,
  productPage: 1,
  productPageSize: 50,
  projectId: 0,
  pollTimer: 0,
  renderTimer: 0,
  csvImageMatches: new Map<number, string[]>(),
};

function h(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

function modelKey(model?: ModelOption) { return model ? `${model.id}:${model.value}` : ""; }
function modelLabel(model?: ModelOption) { return model ? `${model.label || model.value}${model.name ? ` · ${model.name}` : ""}` : "未命名模型"; }
function routeInfo() {
  const raw = location.hash.replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  return { path: (path || "/").replace(/\/+$/, "") || "/", projectId: Number(params.get("projectId") || 0) };
}
function navigate(projectId?: number) { location.hash = `${ROUTE}${projectId ? `?projectId=${projectId}` : ""}`; }
function isFactoryRoute() { return [ROUTE, LEGACY_ROUTE].includes(routeInfo().path); }

function toast(message: string, type = "info") {
  if (!state.root) return;
  let stack = state.root.querySelector<HTMLElement>(".pf-toasts");
  if (!stack) { stack = document.createElement("div"); stack.className = "pf-toasts"; state.root.appendChild(stack); }
  const item = document.createElement("div"); item.className = `pf-toast pf-${type}`; item.textContent = message; stack.appendChild(item);
  setTimeout(() => item.remove(), 3600);
}

function ensureVueRoute() {
  const root: any = document.querySelector("#app") || document.body.firstElementChild;
  const router = root?.__vue_app__?.config?.globalProperties?.$router;
  if (!router?.getRoutes || !router?.addRoute) return true;
  if (!router.hasRoute?.("toonflow-product-factory")) {
    const workbench = router.getRoutes().find((record: any) => record.path === "/workbench");
    const component = workbench?.components?.default;
    if (!component) return false;
    router.addRoute({ path: ROUTE, name: "toonflow-product-factory", component, meta: { title: "商品视觉工厂" } });
  }
  const current = router.currentRoute?.value;
  if (routeInfo().path === ROUTE && current?.name !== "toonflow-product-factory") {
    void router.replace(location.hash.replace(/^#/, "")).catch(() => undefined);
    return false;
  }
  return true;
}

function injectMenu() {
  const box = document.querySelector(".menu .itemBox");
  if (!box) return;
  let item = document.getElementById("tf-product-factory-menu");
  document.getElementById("tf-product-promo-menu")?.remove();
  if (!item) {
    item = document.createElement("div");
    item.id = "tf-product-factory-menu";
    item.innerHTML = `<button type="button" aria-label="商品视觉工厂"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4.5 7.5 7.5 4.2 7.5-4.2M12 12v8.5M8 5l8 4.5"/></svg></button><span>商品视觉工厂</span>`;
    item.addEventListener("click", () => navigate());
    box.appendChild(item);
  }
  item.classList.toggle("active", routeInfo().path === ROUTE);
}

function ensureRoot() {
  const host = document.querySelector<HTMLElement>(".viewBox") || document.querySelector<HTMLElement>("#app");
  if (!host) return null;
  if (host.id === "app") host.classList.add("pf-standalone-host");
  let root = document.getElementById(ROOT_ID);
  if (!root) { root = document.createElement("div"); root.id = ROOT_ID; host.appendChild(root); }
  host.classList.add("pf-host-active"); state.root = root; state.host = host;
  return root;
}

function cleanup() {
  clearInterval(state.pollTimer); state.pollTimer = 0;
  document.getElementById(ROOT_ID)?.remove();
  state.host?.classList.remove("pf-host-active", "pf-standalone-host"); state.root = null; state.host = null; state.projectId = 0;
}

function scheduleRender() {
  if (state.renderTimer) return;
  state.renderTimer = window.setTimeout(() => { state.renderTimer = 0; void renderRoute(); }, 40);
}

async function renderRoute() {
  injectMenu();
  document.querySelectorAll(".card").forEach((card) => card.classList.toggle("pf-hidden-native", !isFactoryRoute() && String(card.textContent || "").includes("__TOONFLOW_PRODUCT_")));
  if (routeInfo().path === "/") { navigate(); return; }
  if (routeInfo().path === LEGACY_ROUTE) { navigate(routeInfo().projectId || undefined); return; }
  if (routeInfo().path !== ROUTE) { cleanup(); return; }
  if (!ensureVueRoute()) { setTimeout(scheduleRender, 100); return; }
  const root = ensureRoot(); if (!root) return;
  root.innerHTML = `<div class="pf-loading"><span></span>正在加载商品视觉工厂…</div>`;
  try {
    if (routeInfo().projectId) await openWorkspace(routeInfo().projectId);
    else await renderProjects();
  } catch (error) {
    root.innerHTML = `<div class="pf-error"><h2>加载失败</h2><p>${h(error instanceof Error ? error.message : error)}</p><button class="pf-btn pf-primary" data-retry>重新加载</button></div>`;
    root.querySelector("[data-retry]")?.addEventListener("click", scheduleRender);
  }
}

async function loadModels() {
  if (state.imageModels.length || state.videoModels.length) return;
  [state.imageModels, state.videoModels] = await Promise.all([
    apiPost("/api/productFactory/models/list", { type: "image" }),
    apiPost("/api/productFactory/models/list", { type: "video" }),
  ]);
}

function projectDescription(project: Project) {
  const intro = String(project.intro || "");
  return intro.includes("\n") ? intro.split("\n").slice(1).join("\n") : intro.startsWith("__TOONFLOW_") ? "" : intro;
}

async function renderProjects() {
  await loadModels();
  const projects = await apiPost<Project[]>("/api/project/getProject", { includeCommerce: true });
  state.projects = projects.filter((project) => project.projectType === "commerce" || String(project.intro || "").includes(LEGACY_MARKER));
  state.root!.innerHTML = `<div class="pf-page"><header class="pf-top"><div><span class="pf-eyebrow">PRODUCT CONTENT OPERATIONS</span><h1>商品视觉工厂</h1><p>从 SKU 与参考图开始，批量生产一致、可审核、可追溯的图片和视频素材。</p></div><button class="pf-btn pf-primary" data-new>＋ 新建工厂项目</button></header><main class="pf-projects">${state.projects.length ? state.projects.map((project) => `<article class="pf-project" data-open="${project.id}"><div class="pf-project-icon">◆</div><div><small>${project.projectType === "commerce" ? "视觉工厂" : "待迁移的旧宣传片"}</small><h3>${h(project.name || "未命名项目")}</h3><p>${h(projectDescription(project) || "尚未填写活动简介")}</p><div class="pf-tags"><span>${h(project.imageQuality || "2K")}</span><span>${h(project.imageModel || "图片模型未配置")}</span><span>${h(project.videoModel || "视频模型未配置")}</span></div></div></article>`).join("") : `<div class="pf-empty"><div>◇</div><h2>从第一个商品活动开始</h2><p>一个项目可以管理多个 SKU，并共享品牌基调和默认输出套餐。</p><button class="pf-btn pf-primary" data-new>创建项目</button></div>`}</main></div>`;
  state.root!.querySelectorAll<HTMLElement>("[data-open]").forEach((card) => card.addEventListener("click", () => navigate(Number(card.dataset.open))));
  state.root!.querySelectorAll("[data-new]").forEach((button) => button.addEventListener("click", showProjectModal));
}

function modelOptions(models: ModelOption[], selected = "") {
  const options = models.map((model) => `<option value="${h(modelKey(model))}" ${modelKey(model) === selected ? "selected" : ""}>${h(modelLabel(model))}</option>`).join("");
  return selected && !models.some((model) => modelKey(model) === selected)
    ? `<option value="${h(selected)}" selected>${h(selected)} · 当前配置不支持参考图</option>${options}`
    : options;
}

function modal(title: string, body: string) {
  const layer = document.createElement("div"); layer.className = "pf-modal-layer";
  layer.innerHTML = `<section class="pf-modal"><header><h2>${h(title)}</h2><button data-close>×</button></header><div class="pf-modal-body">${body}</div></section>`;
  state.root!.appendChild(layer); layer.querySelector("[data-close]")?.addEventListener("click", () => layer.remove());
  return layer;
}

function showProjectModal() {
  const layer = modal("新建商品视觉工厂", `<form class="pf-form" data-project-form><label>项目名称<input name="name" required placeholder="例如：秋季新品首发"></label><label>活动简介<textarea name="intro" placeholder="这次活动要解决什么传播目标？"></textarea></label><div class="pf-grid2"><label>图片模型<select name="imageModel" required>${modelOptions(state.imageModels)}</select></label><label>视频模型<select name="videoModel" required>${modelOptions(state.videoModels)}</select></label></div><div class="pf-grid2"><label>图片画质<select name="imageQuality"><option>2K</option><option>1K</option><option>4K</option></select></label><label>视频输入模式<input name="mode" value="singleImage"></label></div><button class="pf-btn pf-primary" type="submit">创建并进入</button></form>`);
  layer.querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement));
    try {
      const created = await apiPost<{ id: number }>("/api/project/addProject", { ...data, projectType: "commerce", intro: `${MARKER}\n${data.intro || ""}`, type: "商品", artStyle: "", directorManual: "", videoRatio: "16:9" });
      layer.remove(); navigate(created.id);
    } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); }
  });
}

async function openWorkspace(projectId: number) {
  state.projectId = projectId; state.selected.clear(); state.productPage = 1;
  await loadModels();
  const projects = await apiPost<Project[]>("/api/project/getProject", { includeCommerce: true });
  const project = projects.find((item) => Number(item.id) === projectId);
  if (!project) throw new Error("项目不存在");
  if (String(project.intro || "").includes(LEGACY_MARKER)) {
    let legacyCanvas: unknown = null;
    try { legacyCanvas = JSON.parse(localStorage.getItem(`toonflow.productPromo.v1.${projectId}`) || "null"); } catch { /* preserve invalid legacy data */ }
    const migration = await apiPost<any>("/api/productFactory/migration/importLegacy", { projectId, legacyCanvas });
    if (migration.warning) toast(migration.warning, "info"); else toast("旧产品宣传片已迁移，旧本地画布仍保留", "success");
  }
  await reloadWorkspace(); renderWorkspace(); startPolling();
}

async function reloadWorkspace() {
  const [workspace, firstPage] = await Promise.all([
    apiPost<Workspace>("/api/productFactory/workspace/get", { projectId: state.projectId }),
    apiPost<{ items: FactoryItem[] }>("/api/productFactory/products/list", { projectId: state.projectId, page: 1, pageSize: 100 }),
  ]);
  state.workspace = workspace;
  const pageCount = Math.ceil(Number((firstPage as any).total || firstPage.items.length) / 100);
  const remaining = pageCount > 1
    ? await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => apiPost<{ items: FactoryItem[] }>("/api/productFactory/products/list", { projectId: state.projectId, page: index + 2, pageSize: 100 })))
    : [];
  state.items = [firstPage, ...remaining].flatMap((page) => page.items);
  const valid = new Set(state.items.map((item) => item.id));
  for (const id of state.selected) if (!valid.has(id)) state.selected.delete(id);
  state.productPage = Math.min(state.productPage, Math.max(1, Math.ceil(state.items.length / state.productPageSize)));
}

function renderWorkspace() {
  const workspace = state.workspace!;
  state.root!.innerHTML = `<div class="pf-shell"><header class="pf-worktop"><button class="pf-back" data-back>←</button><div><small>商品视觉工厂</small><h1>${h(workspace.project.name)}</h1></div><div class="pf-model-pills"><span>图片 · ${h(workspace.project.imageModel || "未配置")}</span><span>视频 · ${h(workspace.project.videoModel || "未配置")}</span></div></header><nav class="pf-steps">${STEPS.map((step, index) => `<button class="${index === state.step ? "active" : ""}" data-step="${index}"><b>${index + 1}</b><span>${step}</span></button>`).join("")}</nav><main class="pf-workbody"><div data-step-body></div></main></div>`;
  state.root!.querySelector("[data-back]")?.addEventListener("click", () => navigate());
  state.root!.querySelectorAll<HTMLElement>("[data-step]").forEach((button) => button.addEventListener("click", () => { state.step = Number(button.dataset.step); renderWorkspace(); }));
  renderStep();
}

function selectedIds() { return [...state.selected]; }
function stepBody() { return state.root!.querySelector<HTMLElement>("[data-step-body]")!; }
function sectionHead(title: string, text: string, action = "") { return `<div class="pf-section-head"><div><span>STEP ${state.step + 1}</span><h2>${title}</h2><p>${text}</p></div>${action}</div>`; }

function renderStep() {
  if (state.step === 0) renderBrandStep();
  else if (state.step === 1) renderProductsStep();
  else if (state.step === 2) renderPackStep();
  else if (state.step === 3) renderGenerateStep("image");
  else if (state.step === 4) renderReviewStep();
  else if (state.step === 5) renderGenerateStep("video");
  else renderExportStep();
}

function renderBrandStep() {
  const { config, project } = state.workspace!;
  stepBody().innerHTML = `${sectionHead("品牌与活动设置", "品牌约束会进入每个商品提示词；模型仍使用项目原有配置。")}<form class="pf-panel pf-form" data-brand><div class="pf-grid2"><label>品牌名称<input name="brandName" value="${h(config.brandName)}"></label><label>活动目标<input name="campaignBrief" value="${h(config.campaignBrief)}"></label></div><label>视觉基调<textarea name="visualTone">${h(config.visualTone)}</textarea></label><label>禁止内容<textarea name="forbiddenContent">${h(config.forbiddenContent)}</textarea></label><div><strong>品牌参考图（最多 5 张）</strong><div class="pf-refs">${state.workspace!.brandReferences.map((ref) => `<figure><img src="${h(ref.url)}"><figcaption>${h(ref.fileName)}</figcaption><div><button type="button" data-delete-brand-ref="${ref.id}">删除</button></div></figure>`).join("")}<button type="button" class="pf-upload-tile" data-brand-upload>＋<span>上传品牌参考</span></button></div></div><div class="pf-grid2"><label>图片模型<select name="imageModel">${modelOptions(state.imageModels, project.imageModel)}</select></label><label>视频模型<select name="videoModel">${modelOptions(state.videoModels, project.videoModel)}</select></label></div><div class="pf-grid2"><label>图片并发（1–5）<input type="number" name="imageConcurrency" min="1" max="5" value="${config.imageConcurrency}"></label><label>视频并发（1–2）<input type="number" name="videoConcurrency" min="1" max="2" value="${config.videoConcurrency}"></label></div><button class="pf-btn pf-primary">保存设置</button></form><aside class="pf-note"><strong>兼容说明</strong><p>这里不新增或改写 Vendor 配置，只保存项目选择并读取模型已有能力；老模型没有语言/参考图元数据时会自动使用安全默认值。</p></aside>`;
  stepBody().querySelector("form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const values: any = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement));
    try {
      await apiPost("/api/productFactory/workspace/update", { projectId: state.projectId, ...values, imageConcurrency: Number(values.imageConcurrency), videoConcurrency: Number(values.videoConcurrency) });
      await apiPost("/api/project/editProject", { ...project, id: state.projectId, projectType: "commerce", imageModel: values.imageModel, videoModel: values.videoModel, intro: project.intro || MARKER, type: project.type || "商品", artStyle: project.artStyle || "", directorManual: project.directorManual || "", videoRatio: project.videoRatio || "16:9", imageQuality: project.imageQuality || "2K", mode: project.mode || "singleImage" });
      await reloadWorkspace(); renderWorkspace(); toast("品牌与模型设置已保存", "success");
    } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); }
  });
  stepBody().querySelector("[data-brand-upload]")?.addEventListener("click", chooseBrandReferences);
  stepBody().querySelectorAll<HTMLElement>("[data-delete-brand-ref]").forEach((button) => button.addEventListener("click", async () => { await apiPost("/api/productFactory/references/delete", { projectId: state.projectId, referenceId: Number(button.dataset.deleteBrandRef) }); await reloadWorkspace(); renderWorkspace(); }));
}

function chooseBrandReferences() { const input = document.createElement("input"); input.type = "file"; input.accept = "image/jpeg,image/png,image/webp"; input.multiple = true; input.onchange = async () => { try { for (const file of [...(input.files || [])].slice(0, 5)) await apiPost("/api/productFactory/references/upload", { projectId: state.projectId, scope: "brand", fileName: file.name, mimeType: file.type, dataBase64: await fileAsDataUrl(file) }); await reloadWorkspace(); renderWorkspace(); toast("品牌参考图已上传", "success"); } catch (error) { toast((error as Error).message, "error"); } }; input.click(); }

function renderProductsStep() {
  const totalPages = Math.max(1, Math.ceil(state.items.length / state.productPageSize));
  const pageItems = state.items.slice((state.productPage - 1) * state.productPageSize, state.productPage * state.productPageSize);
  const rows = pageItems.map((item) => `<article class="pf-item"><div class="pf-item-check"><input type="checkbox" data-select="${item.id}" ${state.selected.has(item.id) ? "checked" : ""}></div><div class="pf-item-main"><div class="pf-item-title"><div><small>${h(item.sku)}</small><h3>${h(item.name)}</h3><p>${h(item.category || "未分类")} · <span class="pf-state">${h(item.state)}</span></p></div><div><button class="pf-btn" data-prompt="${item.id}">提示词</button><button class="pf-btn" data-canvas="${item.id}">高级画布</button><button class="pf-btn pf-danger" data-delete-item="${item.id}">删除</button></div></div><div class="pf-refs">${item.references.map((ref) => `<figure class="${ref.isPrimary ? "primary" : ""}"><img src="${h(ref.url)}"><figcaption>${ref.isPrimary ? "主参考" : h(ref.fileName)}${(ref.width || 0) < 512 || (ref.height || 0) < 512 ? " · 低分辨率" : ""}</figcaption><div>${ref.isPrimary ? "" : `<button data-primary="${ref.id}" data-product="${item.id}">设为主图</button>`}<button data-delete-ref="${ref.id}">删除</button></div></figure>`).join("")}<button class="pf-upload-tile" data-upload="${item.id}">＋<span>上传参考图</span></button></div></div></article>`).join("");
  stepBody().innerHTML = `${sectionHead("商品与参考图", "支持手工、CSV 与 SKU 文件夹导入；批量任务只处理勾选商品。", `<div class="pf-actions"><button class="pf-btn" data-csv>导入 CSV</button><button class="pf-btn" data-folder>匹配 SKU 文件夹</button></div>`)}<form class="pf-panel pf-inline-form" data-product-form><input name="sku" required placeholder="SKU（必填）"><input name="name" required placeholder="商品名称（必填）"><input name="category" placeholder="分类"><input name="sellingPoints" placeholder="卖点，用 | 分隔"><button class="pf-btn pf-primary">添加商品</button></form><div class="pf-selection"><button class="pf-btn" data-select-all>全选</button><span>已选 ${state.selected.size} / ${state.items.length} 个 SKU</span><div class="pf-pagination"><button class="pf-btn" data-page="${state.productPage - 1}" ${state.productPage <= 1 ? "disabled" : ""}>上一页</button><span>${state.productPage} / ${totalPages}</span><button class="pf-btn" data-page="${state.productPage + 1}" ${state.productPage >= totalPages ? "disabled" : ""}>下一页</button></div></div><section class="pf-item-list">${rows || `<div class="pf-empty small"><h3>还没有商品</h3><p>先手工添加一条，或导入包含 sku、name 的 CSV。</p></div>`}</section>`;
  const body = stepBody();
  body.querySelector("[data-product-form]")?.addEventListener("submit", async (event) => { event.preventDefault(); try { await apiPost("/api/productFactory/products/upsert", { projectId: state.projectId, ...Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement)) }); await reloadWorkspace(); renderWorkspace(); toast("商品已添加", "success"); } catch (error) { toast(String((error as Error).message), "error"); } });
  body.querySelectorAll<HTMLInputElement>("[data-select]").forEach((input) => input.addEventListener("change", () => { const id = Number(input.dataset.select); input.checked ? state.selected.add(id) : state.selected.delete(id); renderProductsStep(); }));
  body.querySelector("[data-select-all]")?.addEventListener("click", () => { if (state.selected.size === state.items.length) state.selected.clear(); else state.items.forEach((item) => state.selected.add(item.id)); renderProductsStep(); });
  body.querySelectorAll<HTMLElement>("[data-page]").forEach((button) => button.addEventListener("click", () => { state.productPage = Math.max(1, Math.min(totalPages, Number(button.dataset.page))); renderProductsStep(); }));
  body.querySelectorAll<HTMLElement>("[data-delete-item]").forEach((button) => button.addEventListener("click", async () => { if (!confirm("删除商品及其本地素材？此操作不可恢复。")) return; await apiPost("/api/productFactory/products/delete", { projectId: state.projectId, productIds: [Number(button.dataset.deleteItem)] }); await reloadWorkspace(); renderWorkspace(); }));
  body.querySelectorAll<HTMLElement>("[data-upload]").forEach((button) => button.addEventListener("click", () => chooseReferences(Number(button.dataset.upload))));
  body.querySelectorAll<HTMLElement>("[data-primary]").forEach((button) => button.addEventListener("click", async () => { await apiPost("/api/productFactory/references/setPrimary", { projectId: state.projectId, productId: Number(button.dataset.product), referenceId: Number(button.dataset.primary) }); await reloadWorkspace(); renderWorkspace(); }));
  body.querySelectorAll<HTMLElement>("[data-delete-ref]").forEach((button) => button.addEventListener("click", async () => { await apiPost("/api/productFactory/references/delete", { projectId: state.projectId, referenceId: Number(button.dataset.deleteRef) }); await reloadWorkspace(); renderWorkspace(); }));
  body.querySelectorAll<HTMLElement>("[data-prompt]").forEach((button) => button.addEventListener("click", () => void showPromptModal(Number(button.dataset.prompt))));
  body.querySelectorAll<HTMLElement>("[data-canvas]").forEach((button) => button.addEventListener("click", () => showCanvas(Number(button.dataset.canvas))));
  body.querySelector("[data-csv]")?.addEventListener("click", chooseCsv);
  body.querySelector("[data-folder]")?.addEventListener("click", chooseFolder);
}

async function uploadFiles(productId: number, files: File[]) {
  const item = state.items.find((candidate) => candidate.id === productId);
  for (const [index, file] of files.slice(0, 10).entries()) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) continue;
    await apiPost("/api/productFactory/references/upload", { projectId: state.projectId, productId, scope: "product", fileName: file.name, mimeType: file.type, dataBase64: await fileAsDataUrl(file), isPrimary: !item?.references.length && index === 0 });
  }
}
function chooseReferences(productId: number) { const input = document.createElement("input"); input.type = "file"; input.accept = "image/jpeg,image/png,image/webp"; input.multiple = true; input.onchange = async () => { try { await uploadFiles(productId, [...(input.files || [])]); await reloadWorkspace(); renderWorkspace(); toast("参考图已上传", "success"); } catch (error) { toast((error as Error).message, "error"); } }; input.click(); }
function chooseCsv() { const input = document.createElement("input"); input.type = "file"; input.accept = ".csv,text/csv"; input.onchange = async () => { const file = input.files?.[0]; if (!file) return; try { const result = await apiPost<any>("/api/productFactory/products/import", { projectId: state.projectId, csvText: await file.text() }); state.csvImageMatches.clear(); for (const match of result.imageMatches || []) state.csvImageMatches.set(Number(match.productId), match.imageFiles || []); await reloadWorkspace(); renderWorkspace(); toast(`已导入/更新 ${result.imported} 个商品，${result.errors.length} 行失败`, result.errors.length ? "info" : "success"); } catch (error) { toast((error as Error).message, "error"); } }; input.click(); }
function chooseFolder() { const input = document.createElement("input"); input.type = "file"; input.multiple = true; input.setAttribute("webkitdirectory", ""); input.accept = "image/jpeg,image/png,image/webp"; input.onchange = async () => { const files = [...(input.files || [])]; let matched = 0; for (const item of state.items) { const sku = item.sku.toLowerCase(); const exact = (state.csvImageMatches.get(item.id) || []).map((path) => path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()); const byExact = files.filter((file) => { const relative = String((file as any).webkitRelativePath || file.name).replace(/\\/g, "/").toLowerCase(); return exact.some((wanted) => relative === wanted || relative.endsWith(`/${wanted}`)); }); const byFolder = files.filter((file) => String((file as any).webkitRelativePath || "").toLowerCase().split("/").slice(0, -1).includes(sku)); const byPrefix = files.filter((file) => file.name.toLowerCase().startsWith(`${sku}_`)); const candidates = [...new Set(byExact.length ? byExact : byFolder.length ? byFolder : byPrefix)]; if (candidates.length) { await uploadFiles(item.id, candidates); matched += candidates.length; } } await reloadWorkspace(); renderWorkspace(); toast(`已匹配并导入 ${matched} 张图片`, matched ? "success" : "info"); }; input.click(); }

function renderPackStep() {
  const pack = state.workspace!.config.defaultPack;
  stepBody().innerHTML = `${sectionHead("默认输出套餐", "默认每个 SKU 生成 8 张图片与 4 条视频；自定义画布不会被自动覆盖。")}
  <form class="pf-panel pf-form" data-pack><div class="pf-pack-summary"><div><b>4</b><span>图片角色</span></div><i>×</i><div><b>2</b><span>画幅比例</span></div><i>+</i><div><b>2</b><span>视频角色</span></div><i>×</i><div><b>2</b><span>画幅比例</span></div><strong>= 12 个任务 / SKU</strong></div><div class="pf-grid2"><label>图片画质<select name="imageQuality"><option ${pack.imageQuality === "1K" ? "selected" : ""}>1K</option><option ${pack.imageQuality === "2K" ? "selected" : ""}>2K</option><option ${pack.imageQuality === "4K" ? "selected" : ""}>4K</option></select></label><label>视频分辨率<input name="videoResolution" value="${h(pack.videoResolution)}"></label><label>视频时长（秒）<input type="number" min="1" max="30" name="videoDuration" value="${pack.videoDuration}"></label><label class="pf-check"><input type="checkbox" name="videoAudio" ${pack.videoAudio ? "checked" : ""}>生成音频</label></div><div class="pf-slot-grid">${Object.entries(imageSlotNames).map(([key, value]) => `<div><small>IMAGE · ${key}</small><strong>${value}</strong></div>`).join("")}${Object.entries(videoSlotNames).map(([key, value]) => `<div class="video"><small>VIDEO · ${key}</small><strong>${value}</strong></div>`).join("")}</div><button class="pf-btn pf-primary">保存默认套餐</button></form>`;
  stepBody().querySelector("form")?.addEventListener("submit", async (event) => { event.preventDefault(); const values: any = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement)); try { await apiPost("/api/productFactory/workspace/update", { projectId: state.projectId, defaultPack: { ...pack, imageQuality: values.imageQuality, videoResolution: values.videoResolution, videoDuration: Number(values.videoDuration), videoAudio: values.videoAudio === "on" } }); await reloadWorkspace(); renderWorkspace(); toast("默认套餐已保存；自定义工作流保持不变", "success"); } catch (error) { toast((error as Error).message, "error"); } });
}

function renderGenerateStep(phase: "image" | "video") {
  const title = phase === "image" ? "批量生成商品图片" : "批量生成商品视频";
  const text = phase === "image" ? "服务端会重新编译并锁定最终提示词，提交前先预览任务数量。" : "只有通过人工审核并指定来源图的槽位才会进入视频队列。";
  stepBody().innerHTML = `${sectionHead(title, text, `<button class="pf-btn pf-primary" data-start>${phase === "image" ? "预览并生成图片" : "预览并生成视频"}</button>`)}<div class="pf-panel"><div class="pf-batch-info"><strong>当前范围</strong><p>${state.selected.size ? `已勾选 ${state.selected.size} 个 SKU` : "尚未勾选 SKU，请在“商品与参考图”步骤明确选择"}</p><label class="pf-check"><input type="checkbox" data-regenerate> 重新生成已有成功槽位（会创建新候选并产生费用）</label></div><div class="pf-progress" data-progress>正在读取任务状态…</div></div>`;
  stepBody().querySelector("[data-start]")?.addEventListener("click", () => void previewAndStart(phase));
  void refreshProgress();
}

async function previewAndStart(phase: "image" | "video") {
  const productIds = selectedIds(); if (!productIds.length) { toast("请先添加并选择商品", "info"); return; }
  try {
    const regenerate = Boolean(stepBody().querySelector<HTMLInputElement>("[data-regenerate]")?.checked);
    const plan = await apiPost<any>("/api/productFactory/jobs/preview", { projectId: state.projectId, productIds, phase, regenerate });
    const warning = plan.warnings?.length ? `\n\n提示：${plan.warnings.join("；")}` : "";
    if (!confirm(`将创建 ${plan.summary.taskCount} 个${phase === "image" ? "图片" : "视频"}任务，跳过 ${plan.summary.skippedCount} 个槽位。\n任务将调用当前项目模型并可能产生费用。${warning}\n\n确认入队？`)) return;
    const result = await apiPost<any>("/api/productFactory/jobs/start", { projectId: state.projectId, productIds, phase, regenerate, confirmed: true });
    toast(`已加入 ${result.jobIds.length} 个任务`, "success"); await reloadWorkspace(); renderWorkspace();
  } catch (error) { toast((error as Error).message, "error"); }
}

async function refreshProgress() {
  if (!state.projectId || ![3, 5].includes(state.step)) return;
  try {
    const progress = await apiPost<any>("/api/productFactory/jobs/progress", { projectId: state.projectId, ...(state.selected.size ? { productIds: selectedIds() } : {}) });
    const host = state.root?.querySelector<HTMLElement>("[data-progress]"); if (!host) return;
    host.innerHTML = `<div class="pf-stat-grid">${["queued", "running", "success", "failed", "paused", "interrupted"].map((key) => `<div><b>${progress.counts[key] || 0}</b><span>${key}</span></div>`).join("")}</div><div class="pf-job-list">${progress.jobs.slice(0, 20).map((job: any) => `<div><span>${h(job.slotKey)} · ${h(job.aspectRatio)}</span><em class="state-${h(job.state)}">${h(job.state)}</em><small>${h(job.errorReason || "")}</small></div>`).join("")}</div><div class="pf-actions"><button class="pf-btn" data-resume>恢复暂停/中断任务</button><button class="pf-btn" data-retry-failed>重试失败任务</button></div>`;
    host.querySelector("[data-resume]")?.addEventListener("click", async () => { await apiPost("/api/productFactory/jobs/resume", { projectId: state.projectId }); toast("可恢复任务已重新入队", "success"); void refreshProgress(); });
    host.querySelector("[data-retry-failed]")?.addEventListener("click", async () => { const ids = progress.jobs.filter((job: any) => ["failed", "interrupted"].includes(job.state)).map((job: any) => job.id); if (!ids.length) return toast("没有可重试任务", "info"); await apiPost("/api/productFactory/jobs/retry", { projectId: state.projectId, jobIds: ids }); toast("失败任务已重试", "success"); void refreshProgress(); });
  } catch { /* polling remains non-blocking */ }
}

function renderReviewStep() {
  const cards = state.items.map((item) => {
    const images = item.artifacts.filter((artifact) => artifact.mediaType === "image" && artifact.state === "success");
    return `<article class="pf-review-product"><header><div><small>${h(item.sku)}</small><h3>${h(item.name)}</h3></div><button class="pf-btn pf-primary" data-submit-review="${item.id}">保存审核</button></header><div class="pf-review-grid">${images.length ? images.map((artifact) => `<label class="pf-artifact ${artifact.approved ? "approved" : ""}"><input type="radio" name="review-${item.id}-${h(artifact.slotKey)}-${h(artifact.aspectRatio)}" value="${artifact.id}" ${artifact.approved ? "checked" : ""}><img src="${h(artifact.url)}"><span>${h(imageSlotNames[artifact.slotKey] || artifact.slotKey)} · ${h(artifact.aspectRatio)} · v${artifact.version}${artifact.inputChanged ? " · 输入已变化" : ""}</span></label>`).join("") : `<p>尚无成功图片，请先完成批量出图。</p>`}</div></article>`;
  }).join("");
  stepBody().innerHTML = `${sectionHead("图片审核与视频来源", "每个图片槽位选择一个候选；保存后默认把棚拍图映射到英雄视频、生活图映射到生活视频。")}<section class="pf-review-list">${cards || `<div class="pf-empty small"><p>暂无商品。</p></div>`}</section>`;
  stepBody().querySelectorAll<HTMLElement>("[data-submit-review]").forEach((button) => button.addEventListener("click", async () => { const productId = Number(button.dataset.submitReview); const selections = [...stepBody().querySelectorAll<HTMLInputElement>(`input[name^="review-${productId}-"]:checked`)].map((input) => ({ artifactId: Number(input.value) })); try { await apiPost("/api/productFactory/review/submit", { projectId: state.projectId, productId, selections }); await reloadWorkspace(); renderWorkspace(); toast("审核结果与视频来源已保存", "success"); } catch (error) { toast((error as Error).message, "error"); } }));
}

function renderExportStep() {
  const ready = state.items.map((item) => ({ item, images: item.artifacts.filter((artifact) => artifact.mediaType === "image" && artifact.state === "success" && artifact.approved).length, videos: item.artifacts.filter((artifact) => artifact.mediaType === "video" && artifact.state === "success").length }));
  stepBody().innerHTML = `${sectionHead("导出商品素材包", "ZIP 按 SKU 分目录，包含已批准图片、成功视频和 manifest.csv。", `<button class="pf-btn pf-primary" data-export>导出 ZIP</button>`)}<div class="pf-panel"><table class="pf-table"><thead><tr><th>选择</th><th>SKU</th><th>商品</th><th>批准图片</th><th>成功视频</th><th>状态</th></tr></thead><tbody>${ready.map(({ item, images, videos }) => `<tr><td><input type="checkbox" data-export-id="${item.id}" ${state.selected.size ? state.selected.has(item.id) ? "checked" : "" : "checked"}></td><td>${h(item.sku)}</td><td>${h(item.name)}</td><td>${images}</td><td>${videos}</td><td>${h(item.state)}</td></tr>`).join("")}</tbody></table></div>`;
  stepBody().querySelector("[data-export]")?.addEventListener("click", async () => { const productIds = [...stepBody().querySelectorAll<HTMLInputElement>("[data-export-id]:checked")].map((input) => Number(input.dataset.exportId)); if (!productIds.length) return toast("请选择导出商品", "info"); try { await apiDownload("/api/productFactory/export/create", { projectId: state.projectId, productIds }, `product-factory-${state.projectId}.zip`); toast("素材包已开始下载", "success"); } catch (error) { toast((error as Error).message, "error"); } });
}

async function showPromptModal(productId: number) {
  const layer = modal("结构化商品提示词", `<div class="pf-prompt-controls"><select data-media><option value="image">图片</option><option value="video">视频</option></select><select data-slot></select><select data-ratio><option>9:16</option><option>16:9</option></select><button class="pf-btn" data-load>加载预览</button></div><div data-prompt-content class="pf-loading compact">正在编译提示词…</div>`);
  const media = layer.querySelector<HTMLSelectElement>("[data-media]")!; const slot = layer.querySelector<HTMLSelectElement>("[data-slot]")!; const ratio = layer.querySelector<HTMLSelectElement>("[data-ratio]")!;
  const updateSlots = () => { const values = media.value === "image" ? imageSlotNames : videoSlotNames; slot.innerHTML = Object.entries(values).map(([key, label]) => `<option value="${key}">${label}</option>`).join(""); };
  const load = async () => {
    updateSlots(); const preview = await apiPost<any>("/api/productFactory/prompts/preview", { projectId: state.projectId, productId, mediaType: media.value, slotKey: slot.value, aspectRatio: ratio.value });
    const content = layer.querySelector<HTMLElement>("[data-prompt-content]")!;
    content.innerHTML = `<div class="pf-prompt-meta"><span>${h(preview.result.templateId)}</span><span>语言：${h(preview.result.language)}</span><span>签名：${h(preview.signature.slice(0, 12))}</span></div>${["goal", "creative", "craft"].map((key) => `<label>${key}<textarea data-section="${key}">${h(preview.result.sections[key])}</textarea></label>`).join("")}<details><summary>查看锁定区段和最终编译文本</summary><pre>${h(preview.result.compiledPrompt)}</pre></details><div class="pf-actions"><button class="pf-btn" data-polish ${state.workspace?.aiPolishAvailable ? "" : "disabled title=\"请先配置 universalAi\""}>AI 润色创意区段</button><button class="pf-btn" data-reset>恢复当前模板</button><button class="pf-btn" data-upgrade>升级到最新版</button><button class="pf-btn pf-primary" data-save>保存覆盖</button></div>`;
    content.querySelector("[data-save]")?.addEventListener("click", async () => { const overrides = Object.fromEntries([...content.querySelectorAll<HTMLTextAreaElement>("[data-section]")].map((area) => [area.dataset.section, area.value])); await apiPost("/api/productFactory/prompts/saveOverride", { projectId: state.projectId, productId, mediaType: media.value, slotKey: slot.value, aspectRatio: ratio.value, overrides }); toast("提示词覆盖已保存，锁定约束会在生成时重新追加", "success"); });
    content.querySelector("[data-reset]")?.addEventListener("click", async () => { if (!confirm("恢复当前内置模板？自定义创意区段将被清除。")) return; await apiPost("/api/productFactory/prompts/reset", { projectId: state.projectId, productId, mediaType: media.value, slotKey: slot.value, aspectRatio: ratio.value }); await load(); toast("已恢复内置模板 v2", "success"); });
    content.querySelector("[data-upgrade]")?.addEventListener("click", async () => { if (!confirm("升级到最新商品模板会清除该节点的旧版或自定义创意区段，确认继续？")) return; const result = await apiPost<any>("/api/productFactory/prompts/upgrade", { projectId: state.projectId, productId, mediaType: media.value, slotKey: slot.value, aspectRatio: ratio.value }); await load(); toast(`已升级到模板 v${result.upgradedTo}`, "success"); });
    content.querySelector("[data-polish]")?.addEventListener("click", async () => { try {
      const result = await apiPost<any>("/api/productFactory/prompts/polish", { projectId: state.projectId, productId, mediaType: media.value, slotKey: slot.value, aspectRatio: ratio.value });
      content.querySelector(".pf-polish-diff")?.remove();
      const diff = document.createElement("section");
      diff.className = "pf-polish-diff";
      diff.innerHTML = `<header><strong>AI 润色候选差异</strong><span>尚未保存</span></header>${Object.keys(result.candidate).map((key) => `<div><b>${h(key)}</b><del>${h(result.original[key])}</del><ins>${h(result.candidate[key])}</ins></div>`).join("")}`;
      content.querySelector("details")?.before(diff);
      for (const [key, value] of Object.entries(result.candidate)) { const area = content.querySelector<HTMLTextAreaElement>(`[data-section="${key}"]`); if (area) area.value = String(value); }
      toast("AI 润色候选与差异已展示，请检查后再保存", "success");
    } catch (error) { toast((error as Error).message, "error"); } });
  };
  updateSlots(); media.addEventListener("change", updateSlots); layer.querySelector("[data-load]")?.addEventListener("click", () => void load()); await load();
}

function showCanvas(productId: number) {
  const item = state.items.find((candidate) => candidate.id === productId); if (!item) return;
  const layer = modal(`${item.sku} · 高级工作流`, `<div class="pf-canvas-wrap" data-canvas-host></div><div class="pf-actions"><button class="pf-btn" data-sync>同步项目默认模板</button></div>`);
  const save = async (graph: FactoryGraph) => { await apiPost("/api/productFactory/workflow/update", { projectId: state.projectId, productId, graph }); toast("工作流已保存", "success"); };
  renderCanvas(layer.querySelector<HTMLElement>("[data-canvas-host]")!, structuredClone(item.workflow.graph), save);
  layer.querySelector("[data-sync]")?.addEventListener("click", async () => { if (!confirm("同步默认模板会覆盖该 SKU 的自定义节点位置和提示词覆盖，确认继续？")) return; const workflow = await apiPost<any>("/api/productFactory/workflow/syncTemplate", { projectId: state.projectId, productId }); renderCanvas(layer.querySelector<HTMLElement>("[data-canvas-host]")!, workflow.graph, save); });
}

function startPolling() { clearInterval(state.pollTimer); state.pollTimer = window.setInterval(() => void refreshProgress(), 3000); }

function bootstrap() {
  const normalizeLegacyPath = window.__TOONFLOW_NORMALIZE_PRODUCT_PROMO_URL__;
  if (normalizeLegacyPath) normalizeLegacyPath();
  const originalPush = history.pushState.bind(history); const originalReplace = history.replaceState.bind(history);
  history.pushState = (...args) => { originalPush(...args); scheduleRender(); };
  history.replaceState = (...args) => { originalReplace(...args); scheduleRender(); };
  window.addEventListener("hashchange", scheduleRender); window.addEventListener("popstate", scheduleRender);
  new MutationObserver(() => { injectMenu(); if (isFactoryRoute() && !document.getElementById(ROOT_ID)) scheduleRender(); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleRender); else scheduleRender();
}

if (shouldBootstrap) bootstrap();
