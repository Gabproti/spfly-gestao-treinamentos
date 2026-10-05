(function () {
  'use strict';
  let client = null;
  let access = null;
  let getEmployees = () => [];
  let competencies = [], models = [], links = [], assessments = [], items = [];
  let competencyId = null, modelId = null, modelChoices = [], assessmentId = null, frozenItems = [], editingAssessment = false;
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
    .map(x => competencies.find(c => c.id === x.competency_id)).filter(Boolean); }
  function totalWeight(rows) { return rows.reduce((sum,x) => sum + Number(x.max_weight ?? x.weight ?? 0), 0); }
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
      if (page === 'pagePerfHistory') renderHistory();
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
    $('perfCompetencyList').innerHTML = competencies.length ? `<div class="table-scroll"><table><thead><tr><th>Competência</th><th>Significado</th><th>Peso máximo</th><th>Status</th><th>Ação</th></tr></thead><tbody>${competencies.map(c => `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.meaning)}</td><td>${fmt(c.max_weight)}%</td><td><span class="badge ${c.active?'badge-green':'badge-red'}">${c.active?'Ativa':'Inativa'}</span></td><td><button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.editCompetency('${c.id}')">Editar</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nenhuma competência cadastrada.</div>';
  }
  function editCompetency(id = null) {
    competencyId = id;
    const c = competencies.find(x => x.id === id);
    $('perfCompetencyTitle').textContent = c ? 'Editar competência' : 'Nova competência';
    $('perfCompetencyName').value = c?.name || '';
    $('perfCompetencyMeaning').value = c?.meaning || '';
    $('perfCompetencyWeight').value = c?.max_weight ?? '';
    $('perfCompetencyActive').value = String(c?.active ?? true);
    message('perfCompetencyMessage',''); openDialog('perfCompetencyDialog');
  }
  async function saveCompetency() {
    if (!$('perfCompetencyForm').reportValidity()) return;
    const { error } = await client.rpc('perf_save_competency', {target_id:competencyId,
      next_name:$('perfCompetencyName').value.trim(),next_meaning:$('perfCompetencyMeaning').value.trim(),
      next_weight:Number($('perfCompetencyWeight').value),next_active:$('perfCompetencyActive').value === 'true'});
    if (error) { message('perfCompetencyMessage',error.message); return; }
    closeDialog('perfCompetencyDialog'); await refresh(); renderCompetencies();
  }
  function renderModels() {
    $('perfModelList').innerHTML = models.map(m => {
      const selected = modelItems(m.id), weight = totalWeight(selected);
      return `<div class="card perf-model-card"><div><h2>${esc(m.name)}</h2><div class="muted">${esc(m.audience || 'Público não informado')} · ${selected.length} competência(s) · Peso ${fmt(weight)}% · ${m.active?'Ativo':'Inativo'}</div></div><button class="btn btn-secondary" onclick="SPFLY_PERF.editModel('${m.id}')">Editar modelo</button></div>`;
    }).join('') || '<div class="card empty">Nenhum modelo encontrado.</div>';
  }
  function editModel(id = null) {
    modelId = id;
    const m = modelById(id);
    modelChoices = links.filter(x => x.model_id === id).sort((a,b) => a.display_order-b.display_order).map(x => x.competency_id);
    $('perfModelTitle').textContent = m ? 'Editar modelo' : 'Novo modelo';
    $('perfModelName').value = m?.name || '';
    $('perfModelAudience').value = m?.audience || '';
    $('perfModelActive').value = String(m?.active ?? true);
    message('perfModelMessage',''); renderModelChoices(); openDialog('perfModelDialog');
  }
  function renderModelChoices() {
    const available = competencies.filter(c => c.active && !modelChoices.includes(c.id));
    $('perfModelAdd').innerHTML = '<option value="">Selecionar competência</option>' + available.map(c => `<option value="${c.id}">${esc(c.name)} · ${fmt(c.max_weight)}%</option>`).join('');
    $('perfModelChoices').innerHTML = modelChoices.map((id,index) => {
      const c = competencies.find(x => x.id === id); if (!c) return '';
      return `<div class="perf-choice"><strong>${index+1}. ${esc(c.name)}</strong><small>${esc(c.meaning)} · ${fmt(c.max_weight)}%</small><span><button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.moveModelCompetency(${index},-1)" ${index===0?'disabled':''} aria-label="Mover para cima">↑</button> <button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.moveModelCompetency(${index},1)" ${index===modelChoices.length-1?'disabled':''} aria-label="Mover para baixo">↓</button> <button class="btn btn-secondary btn-sm" onclick="SPFLY_PERF.removeModelCompetency(${index})">Remover</button></span></div>`;
    }).join('') || '<div class="empty">Adicione competências ao modelo.</div>';
    const selected = modelChoices.map(id=>competencies.find(c=>c.id===id)).filter(Boolean);
    const sum = totalWeight(selected);
    $('perfModelTotal').textContent = `Peso total: ${fmt(sum)}%${sum===100?' · Pronto para avaliação':' · Para finalizar uma avaliação, o total deve ser 100%'}`;
  }
  function addModelCompetency() { const id=$('perfModelAdd').value; if (id && !modelChoices.includes(id)) { modelChoices.push(id); renderModelChoices(); } }
  function moveModelCompetency(index,offset) { const to=index+offset;if(to<0||to>=modelChoices.length)return;[modelChoices[index],modelChoices[to]]=[modelChoices[to],modelChoices[index]];renderModelChoices(); }
  function removeModelCompetency(index) { modelChoices.splice(index,1);renderModelChoices(); }
  async function saveModel() {
    const name=$('perfModelName').value.trim(); if(name.length<3){message('perfModelMessage','Informe o nome do modelo.');return;}
    const {data,error}=await client.rpc('perf_save_model',{target_id:modelId,next_name:name,
      next_audience:$('perfModelAudience').value.trim(),next_active:$('perfModelActive').value==='true'});
    if(error){message('perfModelMessage',error.message);return;}
    const {error:linkError}=await client.rpc('perf_set_model_competencies',{target_model:data,competency_ids:modelChoices});
    if(linkError){modelId=data;message('perfModelMessage','Modelo salvo, mas as competências não foram atualizadas: '+linkError.message);return;}
    closeDialog('perfModelDialog');await refresh();renderModels();
  }
  function renderHistory() {
    const term=$('perfHistorySearch').value.trim().toLocaleLowerCase('pt-BR'),status=$('perfHistoryStatus').value;
    const rows=assessments.filter(a=>(!status||a.status===status)&&(!term||[a.employee_name,a.model_name,a.evaluator,a.department].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(term))));
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
    return modelItems($('perfModel').value).map((c,i)=>({competency_id:c.id,competency_name:c.name,meaning:c.meaning,weight:c.max_weight,percentage:null,display_order:i+1}));
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
    $('perfResult').textContent=`Peso total: ${fmt(sum)}% · ${assessmentId && assessments.find(a=>a.id===assessmentId)?.status==='finalized'?'Resultado final':'Resultado parcial'}: ${fmt(total)}%${sum!==100?' · O modelo precisa somar 100% para finalizar.':''}`;
  }
  async function saveAssessment(finalize) {
    if(!canManage() || assessmentId)return;
    const model=$('perfModel').value,employee=Number($('perfEmployee').value),evaluator=$('perfEvaluator').value.trim(),date=$('perfDate').value;
    if(!model||!employee||evaluator.length<2||!date){message('perfEditorMessage','Preencha colaborador, modelo, responsável e data.');return;}
    const rows=currentRows(),scores=scoreMap();
    if(!rows.length){message('perfEditorMessage','O modelo precisa ter competências.');return;}
    if(Object.values(scores).some(v=>v!==null&&(!Number.isFinite(v)||v<0||v>100))){message('perfEditorMessage','Use avaliações entre 0% e 100%.');return;}
    if(finalize&&(totalWeight(rows)!==100||Object.values(scores).some(v=>v===null))){message('perfEditorMessage','Para finalizar, os pesos devem somar 100% e todas as avaliações devem estar preenchidas.');return;}
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
    if((a.status==='finalized'||finalize)&&(totalWeight(rows)!==100||Object.values(scores).some(v=>v===null))){message('perfEditorMessage','Para finalizar, os pesos devem somar 100% e todas as avaliações devem estar preenchidas.');return;}
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
    editCompetency,saveCompetency,editModel,saveModel,addModelCompetency,moveModelCompetency,removeModelCompetency,
    newAssessment,openAssessment,changeEmployee,changeModel,updateResult,saveAssessment,saveExisting,deleteAssessment,renderHistory,preview,closeDialog};
})();
