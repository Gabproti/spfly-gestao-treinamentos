(function () {
  'use strict';
  let client = null;
  let access = null;
  let getEmployees = () => [];
  let competencies = [], models = [], links = [], assessments = [], items = [];
  let competencyId = null, modelId = null, modelChoices = [], assessmentId = null, frozenItems = [], editingAssessment = false;
  let importRows = [];
  let xlsxLoading = null;
  let importReadVersion = 0;
  let loading = null;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => Number(n || 0).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const dateBR = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
  const canManage = () => !!access?.active && !access.must_change_password &&
    (access.access_role === 'admin' || (access.editable_pages || []).includes('employees') && (access.editable_pages || []).includes('trainings'));
  const canView = () => !!access?.active && !access.must_change_password &&
    (access.access_role === 'admin' || (access.allowed_pages || []).includes('employees') && (access.allowed_pages || []).includes('trainings'));
  function message(id, value) { $(id).textContent = value || ''; }
  function employeeById(id) { return getEmployees().find(e => String(e.id) === String(id)); }
  function modelById(id) { return models.find(m => m.id === id); }
  function modelItems(id) { return links.filter(x => x.model_id === id).sort((a,b) => a.display_order-b.display_order)
    .map(x => { const c=competencies.find(c => c.id === x.competency_id); return c ? {...c,weight:Number(x.weight)} : null; }).filter(Boolean); }
  function totalWeight(rows) { return rows.reduce((sum,x) => sum + Number(x.weight || 0), 0); }
  function openDialog(id) { const d = $(id); if (!d.open) d.showModal(); }
  function closeDialog(id) { $(id).close(); }
  async function refresh() {
    if (!canView()) return;
    if (loading) return loading;
    loading = (async () => {
      const names = ['perf_competencies','perf_models','perf_model_competencies','perf_assessments','perf_assessment_items'];
      const results = await Promise.all(names.map(name => client.from(name).select('*')));
      const error = results.find(r => r.error)?.error;
      if (error) throw error;
      [competencies,models,links,assessments,items] = results.map(r => r.data || []);
      competencies.sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
      assessments.sort((a,b) => b.evaluation_date.localeCompare(a.evaluation_date) || b.created_at.localeCompare(a.created_at));
    })().finally(() => { loading = null; });
    return loading;
  }
  async function render(page) {
    if (!canView()) return;
    try {
      await refresh();
      if (page === 'pagePerfAssessments') renderOverview();
      if (page === 'pagePerfCompetencies') renderCompetencies();
      if (page === 'pagePerfModels') renderModels();
      if (page === 'pagePerfHistory') { populateHistoryFilters(); renderHistory(); }
    } catch (error) {
      const id = {pagePerfAssessments:'perfOverview',pagePerfCompetencies:'perfCompetencyList',pagePerfModels:'perfModelList',pagePerfHistory:'perfHistoryList'}[page];
      if (id) $(id).textContent = 'Não foi possível carregar avaliações: ' + error.message;
    }
  }
  function renderOverview() {
    const done = assessments.filter(a => a.status === 'finalized').length;
    const drafts = assessments.length-done;
    $('perfOverview').innerHTML = `<div class="perf-summary"><div><strong>${models.filter(m=>m.active).length}</strong><span>modelos ativos</span></div><div><strong>${competencies.filter(c=>c.active).length}</strong><span>competências ativas</span></div><div><strong>${drafts}</strong><span>rascunhos</span></div><div><strong>${done}</strong><span>finalizadas</span></div></div><div class="actions">${canManage()?'<button class="btn btn-secondary" onclick="showPage(\'pagePerfCompetencies\')">Competências</button><button class="btn btn-secondary" onclick="showPage(\'pagePerfModels\')">Modelos</button>':''}<button class="btn btn-secondary" onclick="showPage('pagePerfHistory')">Ver histórico</button></div>`;
  }
  function renderCompetencies() {
    $('perfCompetencyList').innerHTML = competencies.length ? `<div class="table-scroll"><table><thead><tr><th>Competência</th><th>Significado</th><th>Status</th><th>Ações</th></tr></thead><tbody>${competencies.map(c => `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.meaning)}</td><td><span class="badge ${c.active?'badge-green':'badge-red'}">${c.active?'Ativo':'Inativo'}</span></td><td>${canManage()?`<div class="perf-row-actions"><button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.editCompetency('${c.id}')">Editar</button>${c.active?`<button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.inactivateCompetency('${c.id}')">Inativar</button>`:''}</div>`:'—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nenhuma competência cadastrada.</div>';
  }
  function editCompetency(id = null) {
    competencyId = id;
    const c = competencies.find(x => x.id === id);
    $('perfCompetencyTitle').textContent = c ? 'Editar competência' : 'Nova competência';
    $('perfCompetencyName').value = c?.name || '';
    $('perfCompetencyMeaning').value = c?.meaning || '';
    $('perfCompetencyActive').value = String(c?.active ?? true);
    message('perfCompetencyMessage',''); openDialog('perfCompetencyDialog');
  }
  async function saveCompetency() {
    if (!canManage()) return;
    if (!$('perfCompetencyForm').reportValidity()) return;
    const { error } = await client.rpc('perf_save_competency_v34', {target_id:competencyId,
      next_name:$('perfCompetencyName').value.trim(),next_meaning:$('perfCompetencyMeaning').value.trim(),
      next_active:$('perfCompetencyActive').value === 'true'});
    if (error) { message('perfCompetencyMessage',error.message); return; }
    closeDialog('perfCompetencyDialog'); await refresh(); renderCompetencies();
  }
  async function inactivateCompetency(id) {
    if (!canManage()) return;
    const c = competencies.find(x => x.id === id);
    if (!c || !c.active || !window.confirm(`Inativar a competência “${c.name}”?`)) return;
    const {error} = await client.rpc('perf_save_competency_v34', {target_id:c.id,
      next_name:c.name,next_meaning:c.meaning,next_active:false});
    if (error) { alert('Não foi possível inativar: ' + error.message); return; }
    await refresh(); renderCompetencies();
  }
  const competencyKey = value => String(value ?? '').trim().toLocaleLowerCase('pt-BR');
  const normalizeHeader = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .trim().toLowerCase().replace(/\s+/g,' ');
  function openImport() {
    if (!canManage()) return;
    importReadVersion++;
    importRows = [];
    $('perfImportFile').value = '';
    message('perfImportMessage','');
    renderImportPreview();
    openDialog('perfImportDialog');
  }
  function renderImportPreview() {
    const valid = importRows.length > 0 && importRows.every(row => row.issues.length === 0);
    $('perfImportConfirm').disabled = !valid;
    $('perfImportPreview').innerHTML = importRows.length ? `<div class="table-scroll"><table><thead><tr><th>Linha</th><th>Competência</th><th>Significado</th><th>Situação</th></tr></thead><tbody>${importRows.map(row => `<tr><td>${row.line}</td><td>${esc(row.name)}</td><td>${esc(row.meaning)}</td><td class="${row.issues.length?'perf-import-error':'perf-import-valid'}">${esc(row.issues.join('; ') || 'Válida')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Selecione uma planilha para conferir as competências.</div>';
    if (importRows.length) message('perfImportMessage',valid?`${importRows.length} competência(s) pronta(s) para importar.`:'Corrija as linhas indicadas na planilha e selecione o arquivo novamente.');
  }
  async function ensureExcelReader() {
    if (window.XLSX) return;
    if (!xlsxLoading) xlsxLoading = new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      script.async=true;
      script.onload=()=>window.XLSX?resolve():reject(new Error('O leitor de Excel não iniciou.'));
      script.onerror=()=>reject(new Error('Não foi possível carregar o leitor de Excel.'));
      document.head.appendChild(script);
    }).catch(error=>{xlsxLoading=null;throw error;});
    return xlsxLoading;
  }
  async function readImportFile(file) {
    const readVersion = ++importReadVersion;
    importRows = [];
    renderImportPreview();
    message('perfImportMessage','');
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name) || file.size > 5*1024*1024) {
      message('perfImportMessage','Selecione um arquivo Excel .xlsx ou .xls com até 5 MB.'); return;
    }
    try {
      message('perfImportMessage','Lendo planilha...');
      await ensureExcelReader();
      if (readVersion !== importReadVersion) return;
      const workbook = window.XLSX.read(await file.arrayBuffer(),{type:'array',cellText:true});
      if (readVersion !== importReadVersion) return;
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('A primeira aba está vazia.');
      const matrix = window.XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''});
      if (!matrix.length) throw new Error('A primeira aba está vazia.');
      const headers = matrix[0].map(normalizeHeader);
      const positions = ['competencia','significado'].map(label => headers.indexOf(label));
      if (positions.some(i=>i<0)) throw new Error('A primeira linha deve conter Competência e Significado.');
      const data = matrix.slice(1).map((cells,i)=>({cells,line:i+2})).filter(({cells})=>cells.some(cell=>String(cell??'').trim()));
      if (!data.length) throw new Error('A planilha não contém competências.');
      if (data.length>500) throw new Error('Importe no máximo 500 competências por arquivo.');
      const seen = new Set();
      const existing = new Set(competencies.map(c=>competencyKey(c.name)));
      importRows = data.map(({cells,line})=>{
        const name=String(cells[positions[0]]??'').trim(),meaning=String(cells[positions[1]]??'').trim();
        const issues=[];
        if (name.length<2 || name.length>160) issues.push('Informe a competência (2 a 160 caracteres)');
        if (meaning.length<2 || meaning.length>2000) issues.push('Informe o significado (2 a 2000 caracteres)');
        const key=competencyKey(name);
        if (key && (seen.has(key)||existing.has(key))) issues.push('Competência duplicada');
        seen.add(key);
        return {line,name,meaning,issues};
      });
      renderImportPreview();
    } catch (error) { if (readVersion === importReadVersion) message('perfImportMessage','Não foi possível ler a planilha: '+error.message); }
  }
  async function confirmImport() {
    if (!canManage() || !importRows.length || importRows.some(row=>row.issues.length)) return;
    const button=$('perfImportConfirm'); button.disabled=true; button.textContent='Importando...';
    const next_rows=importRows.map(({name,meaning})=>({name,meaning}));
    try {
      const {data,error}=await client.rpc('perf_import_competencies_v34',{next_rows});
      if (error) throw error;
      closeDialog('perfImportDialog'); importRows=[]; await refresh(); renderCompetencies();
      $('perfCompetencyNotice').textContent=`${data} competência(s) importada(s) com sucesso.`;
    } catch (error) {
      message('perfImportMessage','Não foi possível importar: '+error.message);
      button.disabled=false;
    } finally { button.textContent='Confirmar importação'; }
  }
  function renderModels() {
    $('perfModelList').innerHTML = models.map(m => {
      const selected = modelItems(m.id), weight = totalWeight(selected);
      return `<div class="card perf-model-card"><div><h2>${esc(m.name)}</h2><div class="muted">${esc(m.audience || 'Público não informado')} · ${selected.length} competência(s) · Peso ${fmt(weight)}% · ${m.active?'Ativo':'Inativo'}</div></div>${canManage()?`<button class="btn btn-secondary" onclick="SPFLY_PERF.editModel('${m.id}')">Editar modelo</button>`:''}</div>`;
    }).join('') || '<div class="card empty">Nenhum modelo encontrado.</div>';
  }
  function editModel(id = null) {
    if (!canManage()) return;
    modelId = id;
    const m = modelById(id);
    modelChoices = links.filter(x => x.model_id === id).sort((a,b) => a.display_order-b.display_order)
      .map(x => ({id:x.competency_id,weight:Number(x.weight)}));
    $('perfModelTitle').textContent = m ? 'Editar modelo' : 'Novo modelo';
    $('perfModelName').value = m?.name || '';
    $('perfModelAudience').value = m?.audience || '';
    $('perfModelActive').value = String(m?.active ?? true);
    message('perfModelMessage',''); renderModelChoices(); openDialog('perfModelDialog');
  }
  function renderModelChoices() {
    const available = competencies.filter(c => c.active && !modelChoices.some(choice=>choice.id===c.id));
    $('perfModelAdd').innerHTML = '<option value="">Selecionar competência</option>' + available.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    $('perfModelChoices').innerHTML = modelChoices.map((choice,index) => {
      const c = competencies.find(x => x.id === choice.id); if (!c) return '';
      return `<div class="perf-choice"><strong>${index+1}. ${esc(c.name)}</strong><small>${esc(c.meaning)}</small><label class="perf-weight-label">Peso (%) <input class="perf-model-weight" type="number" min="0" max="100" step="0.01" value="${esc(choice.weight)}" oninput="SPFLY_PERF.updateModelWeight(${index},this.value)" aria-label="Peso de ${esc(c.name)}"></label><span><button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.moveModelCompetency(${index},-1)" ${index===0?'disabled':''} aria-label="Mover para cima">↑</button> <button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.moveModelCompetency(${index},1)" ${index===modelChoices.length-1?'disabled':''} aria-label="Mover para baixo">↓</button> <button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.removeModelCompetency(${index})">Remover</button></span></div>`;
    }).join('') || '<div class="empty">Adicione competências ao modelo.</div>';
    updateModelTotal();
  }
  function updateModelTotal() { const sum=totalWeight(modelChoices); $('perfModelTotal').textContent = Number.isFinite(sum)?`Total dos pesos: ${fmt(sum)}%`:'Informe o peso de todas as competências.'; }
  function updateModelWeight(index,value) { if(modelChoices[index]) { modelChoices[index].weight=value===''?NaN:Number(value); updateModelTotal(); } }
  function addModelCompetency() { const id=$('perfModelAdd').value; if (id && !modelChoices.some(c=>c.id===id)) { modelChoices.push({id,weight:0}); renderModelChoices(); } }
  function moveModelCompetency(index,offset) { const to=index+offset;if(to<0||to>=modelChoices.length)return;[modelChoices[index],modelChoices[to]]=[modelChoices[to],modelChoices[index]];renderModelChoices(); }
  function removeModelCompetency(index) { modelChoices.splice(index,1);renderModelChoices(); }
  async function saveModel() {
    if (!canManage()) return;
    const name=$('perfModelName').value.trim(); if(name.length<3){message('perfModelMessage','Informe o nome do modelo.');return;}
    if(modelChoices.some(x=>!Number.isFinite(x.weight)||x.weight<0||x.weight>100||
      Math.abs(Math.round(x.weight*100)-x.weight*100)>1e-8)){
      message('perfModelMessage','Informe pesos entre 0% e 100%, com até duas casas decimais.');return;
    }
    const {data,error}=await client.rpc('perf_save_model',{target_id:modelId,next_name:name,
      next_audience:$('perfModelAudience').value.trim(),next_active:$('perfModelActive').value==='true'});
    if(error){message('perfModelMessage',error.message);return;}
    const {error:linkError}=await client.rpc('perf_set_model_competencies_v34',{target_model:data,
      next_items:modelChoices.map(({id,weight})=>({competency_id:id,weight}))});
    if(linkError){modelId=data;message('perfModelMessage','Modelo salvo, mas as competências não foram atualizadas: '+linkError.message);return;}
    closeDialog('perfModelDialog');await refresh();renderModels();
  }
  function populateHistoryFilters() {
    const fields=[['perfHistoryDepartment','department','Todos os departamentos'],
      ['perfHistoryModel','model_name','Todos os modelos'],['perfHistoryEvaluator','evaluator','Todos os responsáveis']];
    fields.forEach(([id,key,label])=>{
      const element=$(id),previous=element.value;
      const values=[...new Set(assessments.map(a=>String(a[key]||'').trim()).filter(Boolean))]
        .sort((a,b)=>a.localeCompare(b,'pt-BR'));
      element.innerHTML=`<option value="">${label}</option>`+values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
      if(values.includes(previous))element.value=previous;
    });
  }
  function renderHistory() {
    const term=$('perfHistorySearch').value.trim().toLocaleLowerCase('pt-BR'),status=$('perfHistoryStatus').value;
    const department=$('perfHistoryDepartment').value,model=$('perfHistoryModel').value,
      evaluator=$('perfHistoryEvaluator').value,from=$('perfHistoryFrom').value,to=$('perfHistoryTo').value;
    const rows=assessments.filter(a=>(!status||a.status===status) &&
      (!term||String(a.employee_name||'').toLocaleLowerCase('pt-BR').includes(term)) &&
      (!department||a.department===department) && (!model||a.model_name===model) &&
      (!evaluator||a.evaluator===evaluator) && (!from||a.evaluation_date>=from) &&
      (!to||a.evaluation_date<=to));
    $('perfHistoryList').innerHTML = rows.length ? `<div class="table-scroll"><table><thead><tr><th>Colaborador</th><th>Departamento / cargo</th><th>Modelo</th><th>Responsável</th><th>Data</th><th>Resultado</th><th>Status</th><th>Ações</th></tr></thead><tbody>${rows.map(a=>{
      const actions=`<div class="perf-row-actions"><button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.openAssessment('${a.id}',false)">Visualizar</button>${canManage()?`<button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.openAssessment('${a.id}',true)">Editar</button>`:''}<button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.preview('${a.id}')">Imprimir</button>${canManage()?`<button class="btn btn-secondary btn-sm perf-delete" onclick="SPFLY_PERF.deleteAssessment('${a.id}')">Excluir</button>`:''}</div>`;
      return `<tr><td><strong>${esc(a.employee_name)}</strong></td><td>${esc(a.department)}<br><small>${esc(a.position_name)}</small></td><td>${esc(a.model_name)}</td><td>${esc(a.evaluator)}</td><td>${dateBR(a.evaluation_date)}</td><td>${a.final_result===null?'—':fmt(a.final_result)+'%'}</td><td><span class="badge ${a.status==='finalized'?'badge-green':'badge-orange'}">${a.status==='finalized'?'Finalizada':'Rascunho'}</span></td><td>${actions}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">Nenhuma avaliação encontrada.</div>';
  }
  function fillAssessmentFields(a=null) {
    $('perfEmployee').innerHTML = '<option value="">Selecione</option>'+getEmployees().map(e=>`<option value="${esc(e.id)}">${esc(e.name)} — ${esc(e.mat||'')}</option>`).join('');
    if(a && !employeeById(a.employee_id)) $('perfEmployee').insertAdjacentHTML('beforeend',`<option value="${esc(a.employee_id)}">${esc(a.employee_name)} (histórico)</option>`);
    $('perfModel').innerHTML = '<option value="">Selecione</option>'+models.filter(m=>m.active||m.id===a?.model_id).map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');
    $('perfEmployee').value = a?.employee_id ?? '';
    $('perfModel').value = a?.model_id ?? '';
    $('perfEvaluator').value = a?.evaluator || access?.full_name || '';
    const today=new Date();
    $('perfDate').value = a?.evaluation_date || `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    ['perfEmployee','perfModel'].forEach(id=>$(id).disabled=!!a || !canManage());
    ['perfEmployeeName','perfDepartment','perfPosition','perfAdmission'].forEach(id=>$(id).readOnly=!a || !editingAssessment);
    ['perfEvaluator','perfDate'].forEach(id=>$(id).readOnly=!editingAssessment);
    $('perfEditorActions').innerHTML = !editingAssessment
      ? '<button type="button" class="btn btn-secondary" onclick="SPFLY_PERF.preview()">Visualizar impressão</button>'
      : a ? `<button type="button" class="btn btn-primary" onclick="SPFLY_PERF.saveExisting(false)">Salvar alterações</button>${a.status==='draft'?'<button type="button" class="btn btn-secondary" onclick="SPFLY_PERF.saveExisting(true)">Finalizar avaliação</button>':''}<button type="button" class="btn btn-secondary" onclick="SPFLY_PERF.preview()">Visualizar impressão</button>`
        : '<button type="button" class="btn btn-secondary" onclick="SPFLY_PERF.saveAssessment(false)">Salvar rascunho</button><button type="button" class="btn btn-primary" onclick="SPFLY_PERF.saveAssessment(true)">Finalizar avaliação</button><button type="button" class="btn btn-secondary" onclick="SPFLY_PERF.preview()">Visualizar impressão</button>';
    $('perfEditorTitle').textContent = a ? (editingAssessment?'Editar avaliação':'Visualizar avaliação') : 'Nova Avaliação';
    message('perfEditorMessage','');changeEmployee();changeModel();
  }
  function newAssessment() { if(!canManage())return; assessmentId=null;frozenItems=[];editingAssessment=true;fillAssessmentFields();showPage('pagePerfEditor'); }
  function openAssessment(id,edit=false) {
    const a=assessments.find(x=>x.id===id);if(!a)return;
    editingAssessment=!!edit && canManage();
    assessmentId=id;frozenItems=items.filter(x=>x.assessment_id===id).sort((x,y)=>x.display_order-y.display_order);
    fillAssessmentFields(a);showPage('pagePerfEditor');
  }
  function changeEmployee() {
    const current=assessments.find(x=>x.id===assessmentId),e=employeeById($('perfEmployee').value);
    $('perfEmployeeName').value=current?.employee_name??e?.name??'';
    $('perfDepartment').value=current?.department??e?.sector??'';
    $('perfPosition').value=current?.position_name??e?.role??'';
    $('perfAdmission').value=current?.admission_date??e?.hire??'';
  }
  function currentRows() {
    if(assessmentId)return frozenItems;
    return modelItems($('perfModel').value).map((c,i)=>({competency_id:c.id,competency_name:c.name,meaning:c.meaning,weight:c.weight,percentage:null,display_order:i+1}));
  }
  function changeModel() {
    const a=assessments.find(x=>x.id===assessmentId),rows=currentRows();
    $('perfScoreTable').innerHTML=rows.length?`<div class="table-scroll"><table><thead><tr><th>Competência</th><th>Significado</th><th>Peso</th><th>Avaliação (%)</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${esc(r.competency_name)}</strong></td><td>${esc(r.meaning)}</td><td>${fmt(r.weight)}%</td><td><input class="perf-score" data-competency="${r.competency_id}" type="number" min="0" max="100" step="0.01" value="${r.percentage??''}" ${!editingAssessment?'readonly':''} oninput="SPFLY_PERF.updateResult()" aria-label="Avaliação de ${esc(r.competency_name)}"></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Selecione um modelo com competências configuradas.</p>';
    updateResult();
  }
  function scoreMap(){const map={};document.querySelectorAll('.perf-score').forEach(input=>{map[input.dataset.competency]=input.value===''?null:Number(input.value)});return map;}
  function updateResult() {
    const rows=currentRows(),scores=scoreMap(),sum=totalWeight(rows);
    const total=rows.reduce((n,r)=>n+(scores[r.competency_id]===null?0:Number(r.weight)*scores[r.competency_id]/100),0);
    $('perfResult').textContent=`Peso total: ${fmt(sum)}% · ${assessmentId && assessments.find(a=>a.id===assessmentId)?.status==='finalized'?'Resultado final':'Resultado parcial'}: ${fmt(total)}%`;
  }
  async function saveAssessment(finalize) {
    if(!canManage() || assessmentId)return;
    const model=$('perfModel').value,employee=Number($('perfEmployee').value),evaluator=$('perfEvaluator').value.trim(),date=$('perfDate').value;
    if(!model||!employee||evaluator.length<2||!date){message('perfEditorMessage','Preencha colaborador, modelo, responsável e data.');return;}
    const rows=currentRows(),scores=scoreMap();
    if(!rows.length){message('perfEditorMessage','O modelo precisa ter competências.');return;}
    if(Object.values(scores).some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>100))){message('perfEditorMessage','Use avaliações entre 0% e 100%.');return;}
    if(finalize&&Object.values(scores).some(v=>v===null)){message('perfEditorMessage','Preencha todas as avaliações antes de finalizar.');return;}
    const {data,error}=await client.rpc('perf_save_assessment',{target_id:assessmentId,target_model:model,target_employee_id:employee,
      next_evaluator:evaluator,next_date:date,next_scores:scores,finalize});
    if(error){message('perfEditorMessage','Não foi possível salvar: '+error.message);return;}
    assessmentId=data;await refresh();openAssessment(data,!finalize);message('perfEditorMessage',finalize?'Avaliação finalizada.':'Rascunho salvo.');
  }
  async function saveExisting(finalize) {
    if(!canManage() || !assessmentId || !editingAssessment)return;
    const a=assessments.find(x=>x.id===assessmentId),rows=currentRows(),scores=scoreMap();
    const name=$('perfEmployeeName').value.trim(),department=$('perfDepartment').value.trim(),
      position=$('perfPosition').value.trim(),admission=$('perfAdmission').value||null,
      evaluator=$('perfEvaluator').value.trim(),date=$('perfDate').value;
    if(!a || name.length<2 || evaluator.length<2 || !date){message('perfEditorMessage','Preencha nome do colaborador, responsável e data.');return;}
    if(Object.values(scores).some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>100))){message('perfEditorMessage','Use avaliações entre 0% e 100%.');return;}
    if((a.status==='finalized'||finalize)&&Object.values(scores).some(v=>v===null)){message('perfEditorMessage','Preencha todas as avaliações antes de finalizar.');return;}
    const {error}=await client.rpc('perf_update_assessment',{target_id:assessmentId,next_employee_name:name,
      next_department:department,next_position:position,next_admission_date:admission,
      next_evaluator:evaluator,next_date:date,next_scores:scores,next_finalize:!!finalize});
    if(error){message('perfEditorMessage','Não foi possível alterar: '+error.message);return;}
    const id=assessmentId;await refresh();openAssessment(id,false);
    message('perfEditorMessage',finalize?'Avaliação finalizada.':'Alterações salvas.');
  }
  async function deleteAssessment(id) {
    if(!canManage() || !assessments.some(a=>a.id===id))return;
    if(!window.confirm('Tem certeza que deseja excluir esta avaliação? Essa ação não poderá ser desfeita.'))return;
    const {error}=await client.rpc('perf_delete_assessment',{target_id:id});
    if(error){alert('Não foi possível excluir a avaliação: '+error.message);return;}
    if(assessmentId===id){assessmentId=null;editingAssessment=false;}
    await refresh();renderHistory();
  }
  function printMarkup(a,rows){
    const total=a.final_result===null?rows.reduce((s,r)=>s+(r.percentage===null?0:Number(r.weight)*Number(r.percentage)/100),0):Number(a.final_result);
    return `<div class="perf-paper"><div class="perf-paper-head"><img src="spfly_logo.png" alt="SPFLY Logística"><div><small>SPFLY · GESTÃO DE TREINAMENTOS</small><h1>Avaliação de Desempenho</h1><p>${esc(a.model_name)}</p></div></div><div class="perf-paper-meta"><div><b>Colaborador</b>${esc(a.employee_name)}</div><div><b>Departamento</b>${esc(a.department||'—')}</div><div><b>Cargo</b>${esc(a.position_name||'—')}</div><div><b>Data de admissão</b>${dateBR(a.admission_date)}</div><div><b>Responsável</b>${esc(a.evaluator)}</div><div><b>Data da avaliação</b>${dateBR(a.evaluation_date)}</div></div><table><thead><tr><th>Competência</th><th>Significado</th><th>Peso</th><th>Avaliação</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.competency_name)}</td><td>${esc(r.meaning)}</td><td>${fmt(r.weight)}%</td><td>${r.percentage===null?'—':fmt(r.percentage)+'%'}</td></tr>`).join('')}</tbody></table><div class="perf-print-result">Resultado Final da Avaliação: ${a.status==='finalized'?fmt(total)+'%':'Rascunho · '+fmt(total)+'% parcial'}</div></div>`;
  }
  function preview(id=null) {
    const a=id?assessments.find(x=>x.id===id):assessments.find(x=>x.id===assessmentId);
    if(a){
      const liveRows=editingAssessment&&!id&&assessmentId===a.id
        ? currentRows().map(r=>({...r,percentage:scoreMap()[r.competency_id]}))
        : items.filter(x=>x.assessment_id===a.id).sort((x,y)=>x.display_order-y.display_order);
      const shown=editingAssessment&&!id&&assessmentId===a.id
        ? {...a,employee_name:$('perfEmployeeName').value,department:$('perfDepartment').value,
            position_name:$('perfPosition').value,admission_date:$('perfAdmission').value||null,
            evaluator:$('perfEvaluator').value,evaluation_date:$('perfDate').value,final_result:null} : a;
      $('perfPrintContent').innerHTML=printMarkup(shown,liveRows);openDialog('perfPrintDialog');return;
    }
    const employee=employeeById($('perfEmployee').value),model=modelById($('perfModel').value),rows=currentRows(),scores=scoreMap();
    if(!employee||!model||!rows.length){message('perfEditorMessage','Selecione colaborador e modelo antes de visualizar a impressão.');return;}
    const draft={status:'draft',employee_name:employee.name,department:employee.sector,position_name:employee.role,
      admission_date:employee.hire,model_name:model.name,evaluator:$('perfEvaluator').value,evaluation_date:$('perfDate').value,final_result:null};
    $('perfPrintContent').innerHTML=printMarkup(draft,rows.map(r=>({...r,percentage:scores[r.competency_id]})));
    openDialog('perfPrintDialog');
  }
  window.SPFLY_PERF={configure(c,a,employees){client=c;access=a;getEmployees=employees;refresh().catch(()=>{});},render,refresh,
    editCompetency,saveCompetency,inactivateCompetency,openImport,readImportFile,confirmImport,
    editModel,saveModel,addModelCompetency,updateModelWeight,moveModelCompetency,removeModelCompetency,
    newAssessment,openAssessment,changeEmployee,changeModel,updateResult,saveAssessment,saveExisting,deleteAssessment,renderHistory,preview,closeDialog};
})();
