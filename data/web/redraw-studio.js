(function redrawStudioBootstrap(){
  "use strict";
  if(window.__TOONFLOW_REDRAW_STUDIO__) return;
  window.__TOONFLOW_REDRAW_STUDIO__=true;

  const ROUTE_PATH="/redraw", ROUTE_NAME="toonflow-redraw", ROOT_ID="tf-redraw-root";
  const phases=[
    {title:"视频分析与转绘剧本",keys:["analyzeSource","createScript"]},
    {title:"原始资产与资产图",keys:["createOriginalAssets","generateOriginalAssetImages"]},
    {title:"衍生资产与资产图",keys:["createDerivedAssets","generateDerivedAssetImages"]},
    {title:"分镜表、分镜面板与分镜图",keys:["buildStoryboards","generateStoryboardImages"]},
    {title:"视频片段、保真复核与成片",keys:["generateVideoPrompts","generateVideos","assembleOutput"]}
  ];
  const app={root:null,host:null,workspace:null,projectId:null,timer:null,renderTimer:null,vueSync:false};

  function route(){
    const raw=String(location.hash||"").replace(/^#/,"");
    const q=raw.indexOf("?");
    return {path:(q>=0?raw.slice(0,q):raw)||"/",query:new URLSearchParams(q>=0?raw.slice(q+1):"")};
  }
  function active(){return route().path===ROUTE_PATH;}
  function getRouter(){const el=document.getElementById("app"), vue=el&&el.__vue_app__;return vue&&vue.config&&vue.config.globalProperties&&vue.config.globalProperties.$router;}
  function ensureRoute(){
    const router=getRouter();
    if(!router||!router.getRoutes||!router.addRoute) return false;
    if(!router.hasRoute(ROUTE_NAME)){
      const base=router.getRoutes().find(r=>r.path==="/workbench")||router.getRoutes().find(r=>r.path==="/script");
      const component=base&&base.components&&base.components.default;
      if(!component) return false;
      router.addRoute({path:ROUTE_PATH,name:ROUTE_NAME,component,meta:{title:"转绘"}});
    }
    const current=router.currentRoute&&router.currentRoute.value;
    if(active()&&current&&current.name!==ROUTE_NAME&&!app.vueSync){
      app.vueSync=true;
      Promise.resolve(router.replace(String(location.hash).replace(/^#/,""))).finally(()=>{app.vueSync=false;schedule();});
      return false;
    }
    return true;
  }
  function token(){return localStorage.getItem("token")||localStorage.getItem("Authorization")||sessionStorage.getItem("token")||sessionStorage.getItem("Authorization")||"";}
  function apiRoot(){return location.protocol==="file:"?fetch("toonflow://getAppUrl").then(r=>r.json()).then(v=>{const value=String(v.url).replace(/\/+$/,"");return /\/api$/i.test(value)?value:value+"/api";}):Promise.resolve(location.origin+"/api");}
  async function post(path,body){
    const root=await apiRoot(), headers={"Content-Type":"application/json"}, auth=token(); if(auth) headers.authorization=auth;
    const response=await fetch(root+path,{method:"POST",headers,body:JSON.stringify(body||{})});
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data||data.code!==200) throw new Error(data&&data.message||`请求失败 ${response.status}`);
    return data.data;
  }
  function escape(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
  function notice(message,type){
    let node=document.getElementById("tf-redraw-toast"); if(!node){node=document.createElement("div");node.id="tf-redraw-toast";document.body.appendChild(node);}
    node.className=type||"";node.textContent=message;node.hidden=false;clearTimeout(node._timer);node._timer=setTimeout(()=>node.hidden=true,4200);
  }
  function statusLabel(state){return ({running:"执行中",success:"已完成",empty:"无新增项",failed:"失败",stale:"已过期",confirmed:"已确认"})[state]||"未开始";}
  function ensureRoot(){
    const host=document.querySelector(".viewBox"); if(!host) return null;
    let root=document.getElementById(ROOT_ID); if(!root){root=document.createElement("div");root.id=ROOT_ID;host.appendChild(root);}
    host.classList.add("tf-redraw-host-active");app.root=root;app.host=host;return root;
  }
  function cleanup(){if(app.timer)clearInterval(app.timer);app.timer=null;if(app.root)app.root.remove();if(app.host)app.host.classList.remove("tf-redraw-host-active");app.root=null;app.workspace=null;}
  async function load(silent){
    if(!app.projectId)return;
    try{app.workspace=await post("/redraw/workspace/get",{projectId:app.projectId});render();startPolling();}
    catch(error){if(!silent)notice(error.message,"error");}
  }
  function startPolling(){
    const running=app.workspace&&app.workspace.steps.some(s=>s.run&&s.run.state==="running");
    if(running&&!app.timer)app.timer=setInterval(()=>load(true),3000);
    if(!running&&app.timer){clearInterval(app.timer);app.timer=null;}
  }
  async function runStep(step,retry,compulsory){
    try{
      const confirmCost=step==="generateVideos"?window.confirm("视频生成最多会为每个片段产生 3 次费用（首次 + 2 次保真重试）。确认继续？"):false;
      if(step==="generateVideos"&&!confirmCost)return;
      await post("/redraw/workflow/run",{projectId:app.projectId,step,action:"run",retryFailed:!!retry,compulsory:!!compulsory,confirmCost});
      notice("步骤已开始执行");await load(true);
    }catch(error){notice(error.message,"error");}
  }
  async function completeStep(step){try{await post("/redraw/workflow/run",{projectId:app.projectId,step,action:"complete"});notice("阶段已人工确认");await load(true);}catch(error){notice(error.message,"error");}}
  async function confirmShots(){try{await post("/redraw/shot/confirm",{projectId:app.projectId});notice("视频分析结果已确认");await load(true);}catch(error){notice(error.message,"error");}}

  function stepCard(step){
    const run=step.run||{}, running=run.state==="running";
    const checkpoint=step.key==="createScript"||step.key==="generateDerivedAssetImages"||step.key==="generateStoryboardImages";
    return `<article class="tf-redraw-step ${escape(run.state||"")}">
      <div><span class="tf-redraw-step-order">${step.order/10}</span><h3>${escape(step.label)}</h3><p>${escape(step.description)}</p></div>
      <div class="tf-redraw-step-state"><span>${statusLabel(run.state)}</span>${run.errorReason?`<small>${escape(run.errorReason)}</small>`:""}</div>
      <div class="tf-redraw-actions">
        <button data-run="${step.key}" ${running?"disabled":""}>执行当前步骤</button>
        <button class="ghost" data-retry="${step.key}" ${running?"disabled":""}>仅重试失败项</button>
        <button class="ghost" data-force="${step.key}" ${running?"disabled":""}>强制重生成</button>
        ${step.key==="analyzeSource"?`<button class="confirm" data-confirm-shots>确认分析</button>`:""}
        ${checkpoint?`<button class="confirm" data-complete="${step.key}" ${!['success','empty'].includes(run.state)?"disabled":""}>完成本阶段</button>`:""}
      </div>
    </article>`;
  }
  function sourceSection(w){
    const s=w.source, style=s.targetStyle||{};
    return `<section class="tf-redraw-panel tf-redraw-source"><div class="tf-redraw-panel-title"><div><b>1. 源视频与目标风格</b><span>剧情、对白、动作、镜头时间轴与原音轨一比一保留；只转换视觉表现。</span></div><button class="danger ghost" id="tf-redraw-reset">重置转绘流程</button></div>
      <div class="tf-redraw-source-grid"><div class="tf-redraw-video-box">${s.url?`<video controls preload="metadata" src="${escape(s.url)}"></video><p>${escape(s.originalName)} · ${(s.durationMs/1000).toFixed(2)}s · ${s.width}×${s.height} · ${Number(s.fps||0).toFixed(2)}fps ${s.hasAudio?"· 原音轨":"· 静音"}</p>`:`<label class="tf-redraw-upload">选择 MP4 / MOV / WebM<input id="tf-redraw-video-file" type="file" accept="video/mp4,video/quicktime,video/webm"><small>最长 20 分钟，最大 2GB；比例须为 16:9 或 9:16</small></label>`}</div>
      <div class="tf-redraw-style"><label>目标风格说明<textarea id="tf-redraw-style-desc" placeholder="例如：亚洲真人风格转欧美真人风格，或动漫风格转真人风格">${escape(style.description||"")}</textarea></label><label>视觉手册 / 约束<textarea id="tf-redraw-style-manual">${escape(style.visualManual||"")}</textarea></label>
      <div class="tf-redraw-checks">${[["transformCharacters","人物"],["transformCostumes","服装"],["transformScenes","场景"],["transformProps","道具"],["transformMedium","媒介质感"],["burnSubtitles","检测到字幕时重新烧录"]].map(([key,label])=>`<label><input type="checkbox" data-style-key="${key}" ${style[key]!==false?"checked":""}>${label}</label>`).join("")}</div>
      <div class="tf-redraw-actions"><button id="tf-redraw-save-style">保存目标风格</button><label class="tf-redraw-ref-button">上传参考图<input id="tf-redraw-ref-file" type="file" accept="image/png,image/jpeg,image/webp"></label></div>
      <div class="tf-redraw-refs">${w.references.map(r=>`<figure><img src="${escape(r.url)}"><figcaption>${escape(r.label||r.kind)} ${r.kind!=="sourceEvidence"?`<button data-del-ref="${r.id}">×</button>`:""}</figcaption></figure>`).join("")||"<small>可上传人物、场景或整体风格参考图</small>"}</div></div></div></section>`;
  }
  function shotsSection(w){
    if(!w.shots.length)return "";
    return `<section class="tf-redraw-panel"><div class="tf-redraw-panel-title"><div><b>逐镜分析校对</b><span>修改任一边界、动作或对白都会使剧本及下游结果过期。</span></div></div><div class="tf-redraw-shot-list">${w.shots.map((s,i)=>`<article class="tf-redraw-shot" data-shot-row="${s.id}"><header><b>镜头 ${i+1}</b><span>${(s.startMs/1000).toFixed(3)}s → ${(s.endMs/1000).toFixed(3)}s</span></header><div class="tf-redraw-shot-fields"><label>开始 ms<input data-field="startMs" type="number" value="${s.startMs}"></label><label>结束 ms<input data-field="endMs" type="number" value="${s.endMs}"></label><label>场景<input data-field="scene" value="${escape(s.scene)}"></label><label>人物（逗号分隔）<input data-field="characters" value="${escape((s.characters||[]).join(','))}"></label><label class="wide">动作<textarea data-field="actions">${escape(s.actions)}</textarea></label><label class="wide">对白（原文）<textarea data-field="dialogue">${escape(s.dialogue)}</textarea></label><label>情绪<input data-field="emotion" value="${escape(s.emotion)}"></label><label>景别 / 运镜<input data-field="camera" value="${escape(s.camera)}"></label><label>声音<input data-field="sound" value="${escape(s.sound)}"></label></div><button data-save-shot="${s.id}">保存镜头修改</button></article>`).join("")}</div></section>`;
  }
  function assetsSection(w){
    if(!w.assets.length)return "";
    return `<section class="tf-redraw-panel"><div class="tf-redraw-panel-title"><div><b>资产预览</b><span>原始资产与衍生资产均落入现有资产体系。</span></div></div><div class="tf-redraw-assets">${w.assets.map(a=>`<article>${a.image&&a.image.url?`<img src="${escape(a.image.url)}">`:`<div class="placeholder">待生成</div>`}<b>${escape(a.name)}</b><span>${a.assetsId?"衍生资产":"原始资产"} · ${escape(a.type)}</span><p>${escape(a.describe)}</p></article>`).join("")}</div></section>`;
  }
  function segmentsSection(w){
    if(!w.segments.length)return "";
    return `<section class="tf-redraw-panel"><div class="tf-redraw-panel-title"><div><b>视频片段与保真复核</b><span>85 分通过；硬失败会自动重试 2 次，仍失败需人工处理。</span></div></div><div class="tf-redraw-segments">${w.segments.map((s,i)=>`<article><header><b>片段 ${i+1}</b><span class="state ${escape(s.state)}">${escape(s.state)}</span></header>${s.videoUrl?`<video controls preload="metadata" src="${escape(s.videoUrl)}"></video>`:""}<p>${(s.startMs/1000).toFixed(3)}s - ${(s.endMs/1000).toFixed(3)}s · 保真 ${s.fidelityScore==null?"—":s.fidelityScore+"/100"} · 尝试 ${Number(s.retryCount||0)+1}</p>${s.errorReason?`<small>${escape(s.errorReason)}</small>`:""}${s.videoId&&s.state!=="approved"?`<button data-accept-segment="${s.id}">人工接受</button>`:""}</article>`).join("")}</div></section>`;
  }
  function outputsSection(w){
    if(!w.outputs.length)return "";
    return `<section class="tf-redraw-panel"><div class="tf-redraw-panel-title"><div><b>成片历史</b><span>输出 MP4、质量报告与 SRT。</span></div></div><div class="tf-redraw-outputs">${w.outputs.map(o=>`<article><b>${new Date(o.createTime).toLocaleString()}</b><span>${escape(o.state)}</span>${o.url?`<video controls src="${escape(o.url)}"></video><div><a href="${escape(o.url)}" download>下载 MP4</a>${o.srtUrl?`<a href="${escape(o.srtUrl)}" download>下载 SRT</a>`:""}</div>`:""}${o.errorReason?`<small>${escape(o.errorReason)}</small>`:""}</article>`).join("")}</div></section>`;
  }
  function bind(){
    document.querySelectorAll("[data-run]").forEach(n=>n.onclick=()=>runStep(n.dataset.run,false,false));
    document.querySelectorAll("[data-retry]").forEach(n=>n.onclick=()=>runStep(n.dataset.retry,true,false));
    document.querySelectorAll("[data-force]").forEach(n=>n.onclick=()=>runStep(n.dataset.force,false,true));
    document.querySelectorAll("[data-complete]").forEach(n=>n.onclick=()=>completeStep(n.dataset.complete));
    document.querySelectorAll("[data-confirm-shots]").forEach(n=>n.onclick=confirmShots);
    const back=document.getElementById("tf-redraw-back");if(back)back.onclick=()=>location.hash="#/project";
    const upload=document.getElementById("tf-redraw-video-file");if(upload)upload.onchange=()=>uploadVideo(upload.files[0]);
    const saveStyle=document.getElementById("tf-redraw-save-style");if(saveStyle)saveStyle.onclick=saveTargetStyle;
    const ref=document.getElementById("tf-redraw-ref-file");if(ref)ref.onchange=()=>uploadReference(ref.files[0]);
    const reset=document.getElementById("tf-redraw-reset");if(reset)reset.onclick=resetWorkflow;
    document.querySelectorAll("[data-del-ref]").forEach(n=>n.onclick=()=>deleteReference(Number(n.dataset.delRef)));
    document.querySelectorAll("[data-save-shot]").forEach(n=>n.onclick=()=>saveShot(Number(n.dataset.saveShot)));
    document.querySelectorAll("[data-accept-segment]").forEach(n=>n.onclick=()=>acceptSegment(Number(n.dataset.acceptSegment)));
  }
  async function uploadVideo(file){
    if(!file)return;try{notice("正在流式上传并探测视频…");const root=await apiRoot(),headers={"Content-Type":file.type,"X-File-Name":encodeURIComponent(file.name)},auth=token();if(auth)headers.authorization=auth;const response=await fetch(root+`/redraw/source/upload?projectId=${app.projectId}`,{method:"POST",headers,body:file});const data=await response.json();if(!response.ok||data.code!==200)throw new Error(data.message||"上传失败");notice("源视频上传完成");await load(true);}catch(error){notice(error.message,"error");}
  }
  function collectStyle(){const current=app.workspace.source.targetStyle||{};document.querySelectorAll("[data-style-key]").forEach(n=>current[n.dataset.styleKey]=n.checked);current.description=document.getElementById("tf-redraw-style-desc").value;current.visualManual=document.getElementById("tf-redraw-style-manual").value;current.referenceIds=(app.workspace.references||[]).filter(r=>r.kind!=="sourceEvidence").map(r=>r.id);return current;}
  async function saveTargetStyle(){try{await post("/redraw/workspace/update",{projectId:app.projectId,targetStyle:collectStyle()});notice("目标风格已保存");await load(true);}catch(error){notice(error.message,"error");}}
  async function uploadReference(file){if(!file)return;try{const base64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});await post("/redraw/reference/upload",{projectId:app.projectId,base64,label:file.name,kind:"style"});notice("参考图已上传");await load(true);}catch(error){notice(error.message,"error");}}
  async function deleteReference(id){try{await post("/redraw/reference/delete",{projectId:app.projectId,id});await load(true);}catch(error){notice(error.message,"error");}}
  async function resetWorkflow(){if(!window.confirm("将清除视频分析及全部下游剧本、资产、分镜、视频和成片；源视频与参考图保留。继续？"))return;try{await post("/redraw/source/reset",{projectId:app.projectId});notice("流程已重置");await load(true);}catch(error){notice(error.message,"error");}}
  async function saveShot(id){const row=document.querySelector(`[data-shot-row="${id}"]`),get=k=>row.querySelector(`[data-field="${k}"]`).value,shot=app.workspace.shots.find(s=>s.id===id);try{await post("/redraw/shot/update",{projectId:app.projectId,id,startMs:Number(get("startMs")),endMs:Number(get("endMs")),scene:get("scene"),characters:get("characters").split(/[,，]/).map(v=>v.trim()).filter(Boolean),actions:get("actions"),emotion:get("emotion"),camera:get("camera"),dialogue:get("dialogue"),sound:get("sound"),assetClues:shot.assetClues||[]});notice("镜头已保存，下游结果已标为过期");await load(true);}catch(error){notice(error.message,"error");}}
  async function acceptSegment(segmentId){if(!window.confirm("人工接受将允许该未通过片段参与最终合成。确认？"))return;try{await post("/redraw/segment/accept",{projectId:app.projectId,segmentId,accepted:true});await load(true);}catch(error){notice(error.message,"error");}}
  function render(){
    if(!app.root||!app.workspace)return;const w=app.workspace;
    app.root.innerHTML=`<div class="tf-redraw-shell"><header class="tf-redraw-topbar"><button id="tf-redraw-back">← 我的项目</button><div><h1>${escape(w.project.name)} · 转绘</h1><p>源短剧剧情内容一比一复刻工作区</p></div><span>${escape(w.project.videoRatio)}</span></header><main>${sourceSection(w)}${phases.map((phase,index)=>`<section class="tf-redraw-panel"><div class="tf-redraw-panel-title"><div><b>${index+2}. ${phase.title}</b><span>按阶段执行、确认和续跑；上游变更会自动使下游过期。</span></div></div><div class="tf-redraw-steps">${phase.keys.map(key=>stepCard(w.steps.find(s=>s.key===key))).join("")}</div></section>`).join("")}${shotsSection(w)}${assetsSection(w)}${segmentsSection(w)}${outputsSection(w)}</main></div>`;
    bind();
  }
  async function renderRoute(){
    if(!active()){cleanup();return;}if(!ensureRoute()){setTimeout(schedule,80);return;}
    const root=ensureRoot();if(!root)return;const id=Number(route().query.get("projectId"));if(!id){root.innerHTML="<div class='tf-redraw-empty'>缺少 projectId</div>";return;}if(app.projectId!==id){app.projectId=id;app.workspace=null;}if(!app.workspace){root.innerHTML="<div class='tf-redraw-loading'>正在加载转绘工作区…</div>";await load(false);}
  }
  function schedule(){if(app.renderTimer)return;app.renderTimer=setTimeout(()=>{app.renderTimer=null;renderRoute();},30);}
  function boot(){window.addEventListener("hashchange",schedule);new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});schedule();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();
