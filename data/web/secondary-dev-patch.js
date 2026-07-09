(function(){
  if (window.__TOONFLOW_SECONDARY_DEV_PATCH__) return;
  window.__TOONFLOW_SECONDARY_DEV_PATCH__ = true;

  const stateLabels = { idle:'未开始', ready:'可执行', generating:'生成中', success:'已完成', failed:'失败', partial:'部分完成' };
  const defaultStepConfigs = [
    {key:'polishOriginalAssetPrompts',label:'润色原始资产提示词',progressKey:'originalAssets',description:'补全原始资产生成提示词。'},
    {key:'generateOriginalAssetImages',label:'生成原始资产图',progressKey:'originalAssetImages',description:'批量生成原始资产图片。'},
    {key:'polishDerivedAssetPrompts',label:'生成衍生资产',progressKey:'derivedAssets',description:'生成并补全衍生资产提示词。'},
    {key:'generateDerivedAssetImages',label:'生成衍生资产图',progressKey:'derivedAssetImages',description:'批量生成衍生资产图片。'},
    {key:'generateStoryboardImages',label:'生成分镜图',progressKey:'storyboardImages',description:'根据分镜面板生成图片。'},
    {key:'generateVideoPrompts',label:'生成视频提示词',progressKey:'videoPrompts',description:'按轨道生成视频提示词。'},
    {key:'generateVideos',label:'生成视频',progressKey:'videos',description:'提交视频生成任务。'}
  ];
  let stepConfigs = defaultStepConfigs.slice();
  let parsedRows = [];
  let parsedMeta = {};
  let selectedFile = null;
  let storyboardRows = [];
  let currentAssets = [];
  let selectedStoryboardIds = [];
  let editingStoryboard = null;
  let progressTimer = null;
  let listTimer = null;

  function el(tag, attrs, children){
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function(k){
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'on') Object.keys(attrs[k]).forEach(function(ev){ node.addEventListener(ev, attrs[k][ev]); });
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function(child){ node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child); });
    return node;
  }
  function $(id){ return document.getElementById(id); }
  function setStatus(id, msg, type){ const node=$(id); if(!node) return; node.className='tf-sd-status '+(type||''); node.textContent=msg||''; }
  function getToken(){ return localStorage.getItem('token') || localStorage.getItem('Authorization') || sessionStorage.getItem('token') || sessionStorage.getItem('Authorization') || ''; }
  async function post(url, body){
    const token = getToken();
    const headers = {'Content-Type':'application/json'};
    if (token) headers.authorization = token.startsWith('Bearer ') ? token : token;
    const res = await fetch(url, {method:'POST', headers, body: JSON.stringify(body || {})});
    const data = await res.json().catch(function(){ return null; });
    if (!res.ok || (data && data.code && data.code !== 200)) throw new Error((data && (data.message || data.msg)) || ('请求失败：'+res.status));
    return data;
  }
  function getQueryNumber(names){
    const hash = location.hash || '';
    const search = location.search || '';
    const all = [search, hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''].join('&');
    for (const name of names) {
      const m = all.match(new RegExp('[?&#]'+name+'=([0-9]+)'));
      if (m) return Number(m[1]);
    }
    const path = (location.pathname + hash);
    for (const name of names) {
      const m = path.match(new RegExp(name+'[/=:-]([0-9]+)', 'i'));
      if (m) return Number(m[1]);
    }
    return null;
  }
  function getProjectId(){
    const pageField = $('tf-sm-project-id');
    const legacyField = $('tf-sd-project-id');
    const fieldValue = pageField && pageField.value ? pageField.value : legacyField && legacyField.value ? legacyField.value : '';
    const value = fieldValue ? Number(fieldValue) : getQueryNumber(['projectId','project','pid']);
    if(!value) throw new Error('请先选择或填写 projectId');
    return value;
  }
  function getScriptId(){ const node = $('tf-sd-script-id'); const v = (node && node.value || '').trim(); return v ? Number(v) : null; }
  function escapeHtml(s){ return String(s == null ? '' : s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function isStoryboardRoute(){ return /storyboard-table|storyboardManage|storyboard-management/i.test(location.pathname + location.hash); }
  function guessIds(){
    const pid = getQueryNumber(['projectId','project','pid']);
    const sid = getQueryNumber(['scriptId','script','sid']);
    ['tf-sd-project-id','tf-sm-project-id'].forEach(function(id){ if (pid && $(id) && !$(id).value) $(id).value = String(pid); });
    if (sid && $('tf-sd-script-id') && !$('tf-sd-script-id').value) $('tf-sd-script-id').value = String(sid);
  }
  function projectTypeLabel(type){ return type === 'storyboard' ? '基于分镜表' : type === 'novel' ? '基于小说原文' : '基于剧本'; }

  function renderPreview(rows, targetId){
    const box = $(targetId || 'tf-sd-preview'); if(!box) return;
    if (!rows.length) { box.innerHTML = '<div class="tf-sd-help" style="padding:10px">暂无解析结果</div>'; return; }
    const head = '<table class="tf-sd-table"><thead><tr><th>镜号</th><th>画面内容</th><th>时长</th><th>场景/轨道</th><th>角色</th><th>道具</th></tr></thead><tbody>';
    const body = rows.slice(0,80).map(function(r,i){
      return '<tr><td>'+escapeHtml(r.shotNo||i+1)+'</td><td>'+escapeHtml(r.visualContent||r.videoDesc||r.prompt||'')+'</td><td>'+(r.duration||'')+'</td><td>'+escapeHtml(r.scene||r.track||'')+'</td><td>'+escapeHtml((r.roleNames||[]).join('、'))+'</td><td>'+escapeHtml((r.toolNames||[]).join('、'))+'</td></tr>';
    }).join('');
    const foot = '</tbody></table>' + (rows.length>80?'<div class="tf-sd-help" style="padding:8px">仅展示前 80 条，共 '+rows.length+' 条</div>':'');
    box.innerHTML = head + body + foot;
  }

  function renderWarnings(warnings, targetId){
    const box = $(targetId); if(!box) return;
    box.innerHTML = (warnings || []).length ? warnings.slice(0,8).map(function(item){ return '<div>'+escapeHtml(item)+'</div>'; }).join('') : '';
  }

  function readSelectedFile(){
    return new Promise(function(resolve, reject){
      if (!selectedFile) return resolve({});
      const reader = new FileReader();
      reader.onerror = function(){ reject(new Error('文件读取失败')); };
      reader.onload = function(){
        const name = selectedFile.name || '';
        const payload = {filename:name, mimeType:selectedFile.type || ''};
        if (/\.docx$/i.test(name)) payload.base64 = String(reader.result || '');
        else payload.content = String(reader.result || '');
        resolve(payload);
      };
      if (/\.docx$/i.test(selectedFile.name || '')) reader.readAsDataURL(selectedFile); else reader.readAsText(selectedFile, 'utf-8');
    });
  }

  async function parseStoryboard(target){
    try{
      const prefix = target === 'page' ? 'tf-sm' : 'tf-sd';
      const filePayload = await readSelectedFile();
      const contentNode = $(prefix+'-import-content');
      const content = contentNode ? contentNode.value.trim() : '';
      if (!content && !filePayload.content && !filePayload.base64) throw new Error('请先粘贴内容或上传分镜表文件');
      setStatus(prefix+'-import-status','正在解析...');
      const formatNode = $(prefix+'-import-format');
      const body = Object.assign({format:(formatNode && formatNode.value) || 'auto'}, filePayload);
      if (content && !body.base64) body.content = content;
      const res = await post('/api/storyboardImport/parse', body);
      parsedRows = (res.data && res.data.data) || [];
      parsedMeta = (res.data && res.data.meta) || {};
      renderPreview(parsedRows, prefix+'-preview');
      renderWarnings((res.data && res.data.warnings) || [], prefix+'-warnings');
      setStatus(prefix+'-import-status','解析完成：'+parsedRows.length+' 条','ok');
    }catch(e){ setStatus((target === 'page' ? 'tf-sm' : 'tf-sd')+'-import-status',e.message,'err'); }
  }

  async function commitStoryboard(target){
    const prefix = target === 'page' ? 'tf-sm' : 'tf-sd';
    try{
      const projectId = getProjectId();
      if (!parsedRows.length) throw new Error('请先解析分镜表');
      setStatus(prefix+'-import-status','正在提交入库...');
      const body = {projectId, data: parsedRows, meta: parsedMeta, options:{createScriptAssets:true,useReferenceAssetDescriptions:true,writeStoryboardIndex:true}};
      const sid = getScriptId();
      if (sid) body.scriptId = sid;
      const scriptNameNode = $(prefix+'-script-name');
      const scriptName = scriptNameNode && scriptNameNode.value ? scriptNameNode.value.trim() : '';
      if (scriptName) body.scriptName = scriptName;
      const res = await post('/api/storyboardImport/commit', body);
      const total = (res.data && res.data.total) || 0;
      setStatus(prefix+'-import-status','提交成功：'+total+' 条分镜已写入','ok');
      await refreshStoryboardList();
      await refreshProgress(target);
    }catch(e){ setStatus(prefix+'-import-status',e.message,'err'); }
  }

  async function loadConfig(target){
    try{
      const res = await post('/api/production/workflow/getConfig', {});
      const data = res && res.data;
      if (data && Array.isArray(data.steps) && data.steps.length) {
        stepConfigs = data.steps.filter(function(step){ return step.key !== 'extractOriginalAssets'; });
        stepConfigs.forEach(function(step){ if(step.key === 'polishOriginalAssetPrompts') step.label = '从分镜表生成原始资产'; });
      }
      renderSteps(null, target);
    }catch(e){ renderSteps(null, target); setStatus((target === 'page' ? 'tf-sm' : 'tf-sd')+'-workflow-status','流程配置加载失败，将使用内置配置：'+e.message,'warn'); }
  }

  function renderSteps(progress, target){
    const prefix = target === 'page' ? 'tf-sm' : 'tf-sd';
    const box = $(prefix+'-steps'); if(!box) return;
    box.innerHTML = '';
    stepConfigs.forEach(function(step){
      const p = progress && progress.steps ? progress.steps[step.progressKey] : null;
      const st = p && p.state || 'idle';
      const count = p && typeof p.total !== 'undefined' ? ' · '+p.total : '';
      const item = el('div',{class:'tf-sd-step'},[
        el('div',{class:'tf-sd-step-main'},[
          el('div',{class:'tf-sd-step-name',text:step.label || step.key}),
          el('div',{class:'tf-sd-step-desc',text:(step.description || '') + count})
        ]),
        el('div',{class:'tf-sd-step-actions'},[
          el('span',{class:'tf-sd-chip '+st,text:stateLabels[st] || st}),
          el('button',{class:'tf-sd-btn tf-sd-mini primary',text:'执行',on:{click:function(){ runStep(step.key, target); }}})
        ])
      ]);
      box.appendChild(item);
    });
  }

  async function refreshProgress(target){
    const prefix = target === 'page' ? 'tf-sm' : 'tf-sd';
    try{
      const projectId = getProjectId();
      setStatus(prefix+'-workflow-status','正在刷新流程状态...');
      const body = {projectId};
      const sid = getScriptId(); if (sid) body.scriptId = sid;
      const res = await post('/api/production/workflow/getProgress', body);
      renderSteps(res.data, target);
      setStatus(prefix+'-workflow-status','状态已刷新：'+new Date().toLocaleTimeString(),'ok');
      return res.data;
    }catch(e){ setStatus(prefix+'-workflow-status',e.message,'err'); }
  }

  async function runStep(step, target){
    const prefix = target === 'page' ? 'tf-sm' : 'tf-sd';
    try{
      const projectId = getProjectId();
      const body = {projectId, step};
      const sid = getScriptId(); if (sid) body.scriptId = sid;
      body.concurrentCount = Number(($(prefix+'-concurrent-count')||{}).value || 5);
      body.groupSize = Number(($(prefix+'-group-size')||{}).value || 5);
      body.compulsory = !!(($(prefix+'-compulsory')||{}).checked);
      body.audio = !!(($(prefix+'-audio')||{}).checked);
      setStatus(prefix+'-workflow-status','正在执行：'+step+' ...');
      const res = await post('/api/production/workflow/runStep', body);
      const info = res.data || {};
      setStatus(prefix+'-workflow-status',(info.status === 'skipped' ? '跳过：' : '已启动：') + (info.reason || step) + '\n可执行对象：' + ((info.prepared && info.prepared.total) || 0),'ok');
      await refreshStoryboardList();
      await refreshProgress(target);
    }catch(e){ setStatus(prefix+'-workflow-status',e.message,'err'); }
  }

  async function refreshStoryboardList(){
    const box = $('tf-sm-list');
    if (!box) return;
    try{
      const projectId = getProjectId();
      const keyword = (($('tf-sm-search')||{}).value || '').trim();
      box.innerHTML = '<div class="tf-sd-help" style="padding:12px">正在加载分镜表...</div>';
      const res = await post('/api/storyboardImport/list', {projectId, keyword, page:1, pageSize:200});
      const rows = (res.data && res.data.data) || [];
      const assets = (res.data && res.data.assets) || [];
      storyboardRows = rows;
      currentAssets = assets;
      selectedStoryboardIds = selectedStoryboardIds.filter(function(id){ return rows.some(function(row){ return row.id === id; }); });
      renderStoryboardList(rows);
      renderAssets(assets);
    }catch(e){ box.innerHTML = '<div class="tf-sd-status err" style="padding:12px">'+escapeHtml(e.message)+'</div>'; }
  }

  function renderStoryboardList(rows){
    const box = $('tf-sm-list'); if(!box) return;
    if(!rows.length){ box.innerHTML = '<div class="tf-sd-empty">暂无分镜表数据</div>'; return; }
    const allChecked = rows.length && rows.every(function(row){ return selectedStoryboardIds.includes(row.id); });
    const toolbar = '<div class="tf-sm-table-actions"><button class="tf-sd-btn tf-sd-mini warn" data-action="bulk-delete">批量删除</button><span class="tf-sd-help">已选择 '+selectedStoryboardIds.length+' 条</span></div>';
    const head = '<table class="tf-sd-table tf-sm-main-table"><thead><tr><th><input type="checkbox" data-action="toggle-all" '+(allChecked?'checked':'')+'></th><th>镜号</th><th>画面内容</th><th>时长</th><th>场景/轨道</th><th>资产</th><th>分镜图状态</th><th>操作</th></tr></thead><tbody>';
    const body = rows.map(function(r,i){
      const shot = (r.videoDesc || '').match(/镜号[:：]\s*([^\n]+)/);
      const checked = selectedStoryboardIds.includes(r.id) ? 'checked' : '';
      return '<tr><td><input type="checkbox" data-action="toggle-one" data-id="'+r.id+'" '+checked+'></td><td>'+escapeHtml(r.index || (shot && shot[1]) || i+1)+'</td><td>'+escapeHtml(r.videoDesc || r.prompt || '')+'</td><td>'+escapeHtml(r.duration || '')+'</td><td>'+escapeHtml(r.track || '')+'</td><td>'+escapeHtml(((r.assets||[]).map(function(a){return a.name;}).join('、')))+'</td><td><span class="tf-sd-chip '+(r.state==='生成失败'?'failed':r.state==='生成成功'||r.state==='已完成'?'success':'idle')+'">'+escapeHtml(r.state || '未生成')+'</span></td><td><button class="tf-sd-btn tf-sd-mini" data-action="edit" data-id="'+r.id+'">编辑</button><button class="tf-sd-btn tf-sd-mini warn" data-action="delete" data-id="'+r.id+'">删除</button></td></tr>';
    }).join('');
    box.innerHTML = toolbar + head + body + '</tbody></table>';
    bindStoryboardListActions(box);
  }

  function bindStoryboardListActions(box){
    box.querySelectorAll('[data-action]').forEach(function(node){
      node.addEventListener('click', function(e){
        const action = node.getAttribute('data-action');
        const id = Number(node.getAttribute('data-id'));
        if (action === 'edit') openEditStoryboard(id);
        if (action === 'delete') deleteStoryboards([id]);
        if (action === 'bulk-delete') deleteStoryboards(selectedStoryboardIds.slice());
      });
      node.addEventListener('change', function(){
        const action = node.getAttribute('data-action');
        const id = Number(node.getAttribute('data-id'));
        if (action === 'toggle-one') toggleStoryboardSelection(id, node.checked);
        if (action === 'toggle-all') toggleAllStoryboardSelection(node.checked);
      });
    });
  }

  function toggleStoryboardSelection(id, checked){
    if (!id) return;
    selectedStoryboardIds = checked ? Array.from(new Set(selectedStoryboardIds.concat(id))) : selectedStoryboardIds.filter(function(item){ return item !== id; });
    renderStoryboardList(storyboardRows);
  }

  function toggleAllStoryboardSelection(checked){
    selectedStoryboardIds = checked ? storyboardRows.map(function(row){ return row.id; }).filter(Boolean) : [];
    renderStoryboardList(storyboardRows);
  }

  async function deleteStoryboards(ids){
    try{
      if (!ids.length) throw new Error('请先选择分镜');
      if (!window.confirm('确认删除选中的 '+ids.length+' 条分镜吗？')) return;
      const projectId = getProjectId();
      await post('/api/storyboardImport/delete', {projectId, ids});
      selectedStoryboardIds = selectedStoryboardIds.filter(function(id){ return !ids.includes(id); });
      await refreshStoryboardList();
      await refreshProgress('page');
    }catch(e){ window.$message ? window.$message.error(e.message) : alert(e.message); }
  }

  function openEditStoryboard(id){
    editingStoryboard = storyboardRows.find(function(row){ return row.id === id; });
    if (!editingStoryboard) return;
    const dialog = $('tf-sm-edit-dialog');
    if (!dialog) return;
    $('tf-sm-edit-prompt').value = editingStoryboard.prompt || '';
    $('tf-sm-edit-video-desc').value = editingStoryboard.videoDesc || '';
    $('tf-sm-edit-duration').value = editingStoryboard.duration || 3;
    $('tf-sm-edit-track').value = editingStoryboard.track || '默认分组';
    $('tf-sm-edit-generate-image').checked = Number(editingStoryboard.shouldGenerateImage) !== 0;
    renderEditAssetOptions(editingStoryboard.assets || []);
    dialog.classList.add('open');
  }

  function closeEditStoryboard(){
    editingStoryboard = null;
    const dialog = $('tf-sm-edit-dialog');
    if (dialog) dialog.classList.remove('open');
  }

  function renderEditAssetOptions(selectedAssets){
    const box = $('tf-sm-edit-assets'); if(!box) return;
    const selectedIds = (selectedAssets || []).map(function(asset){ return asset.id; });
    if (!currentAssets.length) { box.innerHTML = '<div class="tf-sd-help">暂无可关联资产</div>'; return; }
    box.innerHTML = currentAssets.map(function(asset){
      const checked = selectedIds.includes(asset.id) ? 'checked' : '';
      return '<label class="tf-sm-asset-option"><input type="checkbox" value="'+asset.id+'" '+checked+'> <span>'+escapeHtml(asset.name)+' · '+escapeHtml(asset.type || '')+'</span></label>';
    }).join('');
  }

  async function saveStoryboardEdit(){
    try{
      if (!editingStoryboard) throw new Error('没有正在编辑的分镜');
      const projectId = getProjectId();
      const assetIds = Array.from(document.querySelectorAll('#tf-sm-edit-assets input:checked')).map(function(node){ return Number(node.value); }).filter(Boolean);
      const body = {
        id: editingStoryboard.id,
        projectId,
        prompt: $('tf-sm-edit-prompt').value.trim() || '分镜',
        videoDesc: $('tf-sm-edit-video-desc').value.trim() || $('tf-sm-edit-prompt').value.trim() || '分镜',
        duration: Number($('tf-sm-edit-duration').value || 3),
        track: $('tf-sm-edit-track').value.trim() || '默认分组',
        shouldGenerateImage: $('tf-sm-edit-generate-image').checked ? 1 : 0,
        associateAssetsIds: assetIds
      };
      await post('/api/storyboardImport/update', body);
      closeEditStoryboard();
      await refreshStoryboardList();
      await refreshProgress('page');
    }catch(e){ setStatus('tf-sm-edit-status', e.message, 'err'); }
  }

  function renderAssets(assets){
    const box = $('tf-sm-assets'); if(!box) return;
    if(!assets.length){ box.innerHTML = '<div class="tf-sd-empty">暂无原始资产，导入分镜表后会自动生成角色、场景、道具。</div>'; return; }
    const groups = assets.reduce(function(result, asset){ const type = asset.type || 'other'; (result[type] = result[type] || []).push(asset); return result; }, {});
    const title = {role:'角色资产',scene:'场景资产',tool:'道具资产',other:'其他资产'};
    box.innerHTML = Object.keys(groups).map(function(type){
      return '<div class="tf-sm-asset-group"><h4>'+escapeHtml(title[type] || type)+'</h4><div class="tf-sm-assets-grid">'+groups[type].map(function(asset){
        return '<div class="tf-sm-asset-card"><div class="tf-sm-asset-title">'+escapeHtml(asset.name)+'</div><div class="tf-sm-asset-desc">'+escapeHtml(asset.describe || asset.prompt || '')+'</div><div class="tf-sd-help">'+(asset.imageId?'已有图片':'未生成图片')+'</div></div>';
      }).join('')+'</div></div>';
    }).join('');
  }

  function toggleAutoRefresh(on){
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    if (on) progressTimer = setInterval(function(){ refreshProgress(isStoryboardRoute() ? 'page' : undefined).catch(function(){}); }, 5000);
  }

  function field(label,type,id,placeholder,options){
    let input;
    if (type === 'textarea') input = el('textarea',{id:id,placeholder:placeholder||''});
    else if (type === 'select') input = el('select',{id:id},(options||[]).map(function(v){return el('option',{value:v,text:v});}));
    else input = el('input',{id:id,placeholder:placeholder||'',value:placeholder && /^\d+$/.test(placeholder) ? placeholder : ''});
    return el('div',{class:'tf-sd-field'},[el('label',{text:label}), input]);
  }

  function buildLegacyUI(){
    const root = el('div',{id:'tf-secondary-dev-root'},[
      el('div',{class:'tf-sd-panel',id:'tf-sd-panel'},[
        el('div',{class:'tf-sd-header'},[
          el('div',{},[el('div',{class:'tf-sd-title',text:'分镜表管理'}), el('div',{class:'tf-sd-sub',text:'分镜表导入 · 原始资产 · 生产流程'})]),
          el('button',{class:'tf-sd-close',text:'×',title:'关闭',on:{click:function(){ $('tf-sd-panel').classList.remove('open'); }}})
        ]),
        el('div',{class:'tf-sd-body'},[
          el('div',{class:'tf-sd-grid'},[
            field('项目ID projectId','input','tf-sd-project-id','必填'),
            field('内部剧本ID scriptId','input','tf-sd-script-id','可选'),
            field('分镜表名称','input','tf-sd-script-name','分镜表导入')
          ]),
          el('div',{class:'tf-sd-row'},[
            el('button',{class:'tf-sd-btn',text:'自动识别ID',on:{click:guessIds}}),
            el('button',{class:'tf-sd-btn primary',text:'刷新流程状态',on:{click:function(){ refreshProgress(); }}}),
            el('button',{class:'tf-sd-btn',text:'打开分镜表管理页',on:{click:function(){ const id=getProjectId(); history.pushState(null,'','/storyboard-table?projectId='+id); renderStoryboardPage(); }}}),
            el('label',{class:'tf-sd-help'},[el('input',{type:'checkbox',id:'tf-sd-auto-refresh'}),' 自动每 5 秒刷新'])
          ]),
          buildImportSection('tf-sd', false),
          buildWorkflowSection('tf-sd')
        ])
      ]),
      el('button',{class:'tf-sd-fab',text:'分镜表管理',on:{click:function(){ const p=$('tf-sd-panel'); p.classList.toggle('open'); if(p.classList.contains('open')) { guessIds(); loadConfig(); } }}})
    ]);
    document.body.appendChild(root);
    $('tf-sd-auto-refresh').addEventListener('change', function(e){ toggleAutoRefresh(e.target.checked); });
    renderSteps(null);
    guessIds();
  }

  function buildImportSection(prefix, withFile){
    const children = [
      el('h3',{text:'1. 新建分镜表'}),
      el('div',{class:'tf-sd-help',html:'支持 TXT 标准格式、Markdown 表格和 Word DOCX 表格版。分镜表会自动生成角色、场景、道具原始资产。'}),
      el('div',{class:'tf-sd-grid '+(withFile?'tf-sm-import-grid':''),style:withFile?'grid-template-columns:180px 1fr 1fr':''},[
        field('格式','select',prefix+'-import-format','', ['auto','txt-standard','markdown','docx','json','csv','text']),
        withFile ? el('div',{class:'tf-sd-field'},[el('label',{text:'上传文件'}),el('input',{id:prefix+'-file',type:'file',accept:'.txt,.md,.docx',on:{change:function(e){ selectedFile = e.target.files && e.target.files[0] || null; }}})]) : field('分镜表内容','textarea',prefix+'-import-content','粘贴分镜表内容，或逐行输入画面描述'),
        withFile ? field('分镜表内容','textarea',prefix+'-import-content','也可以直接粘贴 TXT 或 Markdown 内容') : el('span',{})
      ]),
      el('div',{class:'tf-sd-row'},[
        el('button',{class:'tf-sd-btn primary',text:'解析预览',on:{click:function(){ parseStoryboard(prefix==='tf-sm'?'page':undefined); }}}),
        el('button',{class:'tf-sd-btn warn',text:'确认导入分镜表',on:{click:function(){ commitStoryboard(prefix==='tf-sm'?'page':undefined); }}})
      ]),
      el('div',{id:prefix+'-preview',class:'tf-sd-preview'},[el('div',{class:'tf-sd-help',style:'padding:10px',text:'暂无解析结果'})]),
      el('div',{id:prefix+'-warnings',class:'tf-sd-status warn'}),
      el('div',{id:prefix+'-import-status',class:'tf-sd-status'})
    ];
    return el('div',{class:'tf-sd-section'},children);
  }

  function buildWorkflowSection(prefix){
    return el('div',{class:'tf-sd-section'},[
      el('h3',{text:'3. 生产流程'}),
      el('div',{class:'tf-sd-grid'},[
        field('并发数','input',prefix+'-concurrent-count','5'),
        field('分组大小','input',prefix+'-group-size','5'),
        el('div',{class:'tf-sd-field'},[el('label',{text:'选项'}),el('label',{class:'tf-sd-help'},[el('input',{type:'checkbox',id:prefix+'-compulsory'}),' 强制重生成']),el('br'),el('label',{class:'tf-sd-help'},[el('input',{type:'checkbox',id:prefix+'-audio'}),' 视频带音频'])])
      ]),
      el('div',{id:prefix+'-steps',class:'tf-sd-steps'}),
      el('div',{id:prefix+'-workflow-status',class:'tf-sd-status'})
    ]);
  }

  function buildEditDialog(){
    return el('div',{id:'tf-sm-edit-dialog',class:'tf-sm-dialog'},[
      el('div',{class:'tf-sm-dialog-mask',on:{click:closeEditStoryboard}}),
      el('div',{class:'tf-sm-dialog-panel'},[
        el('div',{class:'tf-sm-dialog-header'},[
          el('div',{},[el('div',{class:'tf-sd-title',text:'编辑分镜'}),el('div',{class:'tf-sd-help',text:'修改画面内容、时长、轨道和关联资产。'})]),
          el('button',{class:'tf-sd-close',text:'×',on:{click:closeEditStoryboard}})
        ]),
        el('div',{class:'tf-sm-dialog-body'},[
          el('div',{class:'tf-sd-grid'},[
            field('时长（秒）','input','tf-sm-edit-duration','3'),
            field('场景/轨道','input','tf-sm-edit-track','默认分组'),
            el('div',{class:'tf-sd-field'},[el('label',{text:'生成分镜图'}),el('label',{class:'tf-sd-help'},[el('input',{type:'checkbox',id:'tf-sm-edit-generate-image'}),' 需要生成'])])
          ]),
          field('分镜图提示词','textarea','tf-sm-edit-prompt',''),
          field('画面内容 / 视频描述','textarea','tf-sm-edit-video-desc',''),
          el('div',{class:'tf-sd-field'},[el('label',{text:'关联原始资产'}),el('div',{id:'tf-sm-edit-assets',class:'tf-sm-edit-assets'})]),
          el('div',{id:'tf-sm-edit-status',class:'tf-sd-status'})
        ]),
        el('div',{class:'tf-sm-dialog-footer'},[
          el('button',{class:'tf-sd-btn',text:'取消',on:{click:closeEditStoryboard}}),
          el('button',{class:'tf-sd-btn primary',text:'保存',on:{click:saveStoryboardEdit}})
        ])
      ])
    ]);
  }

  function renderStoryboardPage(){
    let root = $('tf-storyboard-page-root');
    if (!isStoryboardRoute()) { if(root) root.classList.remove('open'); return; }
    if (!root) {
      root = el('div',{id:'tf-storyboard-page-root'},[
        el('div',{class:'tf-sm-shell'},[
          el('div',{class:'tf-sm-header'},[
            el('div',{class:'tf-sm-title-wrap'},[
              el('div',{class:'tf-sm-icon',html:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-13Zm3 1v11h2v-11H7Zm4 0v4h2v-4h-2Zm0 6v5h2v-5h-2Zm4-6v11h2v-11h-2Z"/></svg>'}),
              el('div',{},[el('h1',{text:'分镜表管理'}),el('div',{class:'tf-sd-help',text:'基于分镜表填写、解析原始资产，并继续完成短剧生产流程。'})])
            ]),
            el('button',{class:'tf-sd-btn',text:'返回项目',on:{click:function(){ history.back(); }}})
          ]),
          el('div',{class:'tf-sm-toolbar'},[
            field('项目ID','input','tf-sm-project-id',''),
            el('div',{class:'tf-sd-field tf-sm-search-field'},[el('label',{text:'搜索'}),el('input',{id:'tf-sm-search',placeholder:'搜索分镜表名称 / 镜号 / 场景 / 画面内容',on:{keydown:function(e){ if(e.key==='Enter') refreshStoryboardList(); }}})]),
            el('button',{class:'tf-sd-btn primary tf-sm-toolbar-btn',text:'搜索',on:{click:refreshStoryboardList}}),
            el('button',{class:'tf-sd-btn primary tf-sm-toolbar-btn',text:'+ 新建分镜表',on:{click:function(){ $('tf-sm-import-section').scrollIntoView({behavior:'smooth',block:'start'}); }}})
          ]),
          el('div',{class:'tf-sm-main'},[
            el('div',{class:'tf-sm-left'},[
              el('div',{id:'tf-sm-import-section'},[buildImportSection('tf-sm', true)]),
              el('div',{class:'tf-sd-section'},[el('h3',{text:'2. 分镜表列表'}),el('div',{id:'tf-sm-list',class:'tf-sd-preview tf-sm-list'},[el('div',{class:'tf-sd-help',style:'padding:10px',text:'暂无数据'})])])
            ]),
            el('div',{class:'tf-sm-right'},[
              el('div',{class:'tf-sd-section'},[el('h3',{text:'原始资产'}),el('div',{id:'tf-sm-assets',class:'tf-sm-assets'},[el('div',{class:'tf-sd-help',text:'导入分镜表后自动生成角色、场景、道具。'})])]),
              buildWorkflowSection('tf-sm')
            ])
          ])
        ]),
        buildEditDialog()
      ]);
      document.body.appendChild(root);
    }
    root.classList.add('open');
    guessIds();
    loadConfig('page');
    refreshStoryboardList();
    refreshProgress('page');
    if (listTimer) clearInterval(listTimer);
    listTimer = setInterval(function(){ if(isStoryboardRoute()) refreshStoryboardList(); }, 15000);
  }

  function hookHistory(){
    const rawPush = history.pushState;
    const rawReplace = history.replaceState;
    history.pushState = function(){ const result = rawPush.apply(this, arguments); setTimeout(renderStoryboardPage, 0); return result; };
    history.replaceState = function(){ const result = rawReplace.apply(this, arguments); setTimeout(renderStoryboardPage, 0); return result; };
    window.addEventListener('popstate', renderStoryboardPage);
  }

  function patchProjectCards(){
    document.querySelectorAll('.card').forEach(function(card){
      card.querySelectorAll('*').forEach(function(node){
        if (node.childNodes.length === 1 && node.textContent === '基于小说剧本') node.textContent = '基于剧本';
      });
    });
  }

  function buildUI(){
    buildLegacyUI();
    hookHistory();
    renderStoryboardPage();
    setInterval(patchProjectCards, 1200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI); else buildUI();
})();
