(function(){
  'use strict';
  let client=null,access=null,getEmployees=()=>[],getTrainings=()=>[];
  let records=[],models=[],loading=null,editor=null;
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const canView=()=>!!access?.active&&!access.must_change_password&&
    (access.access_role==='admin'||['employees','trainings'].every(p=>(access.allowed_pages||[]).includes(p)));
  const canManage=()=>!!access?.active&&!access.must_change_password&&
    (access.access_role==='admin'||['employees','trainings'].every(p=>(access.editable_pages||[]).includes(p)));
  const participantIds=t=>Array.isArray(t?.participants)?t.participants.map(Number).filter(Number.isFinite):[];
  const trainingById=id=>getTrainings().find(t=>Number(t.id)===Number(id)&&!t.deletedAt);
  const employeeById=id=>getEmployees().find(e=>Number(e.id)===Number(id));
  const validRecord=(t,eid)=>records.find(r=>Number(r.training_id)===Number(t.id)&&Number(r.employee_id)===Number(eid)&&!r.deleted_at);
  const fmt=value=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const dateBR=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'—';
  function configure(nextClient,nextAccess,employeeGetter,trainingGetter){
    client=nextClient;access=nextAccess;getEmployees=employeeGetter;getTrainings=trainingGetter;
    if(!$('efficacyEditor')){
      const dialog=document.createElement('dialog');dialog.id='efficacyEditor';dialog.className='employee-dialog efficacy-editor';
      dialog.innerHTML=`<div class="modal-head"><h2 id="efficacyEditorTitle">Avaliação de eficácia</h2><button type="button" class="close" onclick="SPFLY_EFFICACY.closeEditor()" aria-label="Fechar">✕</button></div>
        <p id="efficacyEditorPerson" class="muted"></p><div class="form-grid">
        <div class="field full"><label for="efficacyModel">Modelo / formulário utilizado *</label><select id="efficacyModel"></select></div>
        <div class="field"><label for="efficacyDate">Data da avaliação *</label><input id="efficacyDate" type="date"></div>
        <div class="field"><label for="efficacyScore">Resultado / nota (%) *</label><input id="efficacyScore" type="number" min="0" max="100" step="0.01"></div>
        <div class="field"><label for="efficacyResult">Eficácia *</label><select id="efficacyResult"><option value="">Selecione</option><option>Eficaz</option><option>Não eficaz</option></select></div>
        <div class="field"><label for="efficacyEvaluator">Responsável pela avaliação *</label><input id="efficacyEvaluator" maxlength="160"></div>
        <div class="field full"><label for="efficacyNotes">Evidência / justificativa *</label><textarea id="efficacyNotes" maxlength="2000"></textarea></div></div>
        <div id="efficacyMessage" role="status"></div><div class="actions"><button type="button" class="btn btn-secondary" onclick="SPFLY_EFFICACY.closeEditor()">Fechar</button><button type="button" id="efficacySave" class="btn btn-primary" onclick="SPFLY_EFFICACY.save()">Salvar avaliação</button></div>`;
      document.body.append(dialog);
    }
    refresh().catch(()=>{});
  }
  async function refresh(){
    if(!canView()||!client)return;
    if(loading)return loading;
    loading=(async()=>{
      const [reviews,forms]=await Promise.all([
        client.from('training_efficacy_reviews').select('*'),client.from('perf_models').select('*')]);
      if(reviews.error)throw reviews.error;if(forms.error)throw forms.error;
      records=reviews.data||[];models=forms.data||[];
    })().finally(()=>{loading=null});
    return loading;
  }
  function summary(t){
    const ids=participantIds(t),done=ids.filter(id=>validRecord(t,id)).length;
    return {total:ids.length,done,pending:ids.length-done,percent:ids.length?Math.round(done/ids.length*100):0};
  }
  function badge(t){
    if(!canView())return '<span class="muted">—</span>';
    if(t.deletedAt)return '<span class="badge badge-black">Excluído</span>';
    if(t.status==='Cancelado')return '<span class="badge badge-black">Cancelado</span>';
    if(t.status!=='Ministrado')return '<span class="badge badge-blue">Aguardando treinamento</span>';
    const s=summary(t);
    if(!s.total)return '<span class="badge badge-blue">Sem participantes</span>';
    return `<span class="badge ${s.pending?'badge-orange':'badge-green'}">${s.done}/${s.total} concluídas</span>`;
  }
  async function renderTraining(t){
    const node=$('trainingEfficacy');if(!node||!canView())return;
    try{await refresh()}catch(error){node.textContent='Não foi possível carregar avaliações: '+error.message;return}
    if(!node.isConnected||Number(node.dataset.trainingId)!==Number(t.id))return;
    const ids=participantIds(t),s=summary(t),ready=t.status==='Ministrado';
    node.innerHTML=`<div class="efficacy-summary"><span><b>${s.total}</b> participantes</span><span><b>${s.done}</b> concluídas</span><span><b>${s.pending}</b> pendentes</span><span><b>${s.percent}%</b> conclusão</span></div>
      ${ids.length?`<div class="table-scroll"><table><thead><tr><th>Funcionário</th><th>Modelo / formulário</th><th>Status</th><th>Eficácia</th><th>Nota</th><th>Ações</th></tr></thead><tbody>${ids.map(id=>{
        const e=employeeById(id),r=validRecord(t,id);
        return `<tr><td><strong>${esc(e?.name||'Funcionário não encontrado')}</strong></td><td>${esc(r?.model_name||'—')}</td>
          <td><span class="badge ${r?'badge-green':'badge-orange'}">${r?'Concluída':'Pendente'}</span></td><td>${esc(r?.result||'—')}</td><td>${r?fmt(r.score)+'%':'—'}</td>
          <td class="efficacy-actions">${r?`<button class="btn btn-secondary btn-sm" onclick="SPFLY_EFFICACY.openEditor(${Number(t.id)},${id},true)">Visualizar</button>
            ${canManage()?`<button class="btn btn-secondary btn-sm" onclick="SPFLY_EFFICACY.openEditor(${Number(t.id)},${id},false)">Editar</button><button class="btn btn-secondary btn-sm perf-delete" onclick="SPFLY_EFFICACY.remove('${r.id}')">Excluir</button>`:''}`
          :ready&&canManage()?`<button class="btn btn-primary btn-sm" onclick="SPFLY_EFFICACY.openEditor(${Number(t.id)},${id},false)">Avaliar</button>`:'—'}</td></tr>`;
      }).join('')}</tbody></table></div>`:'<div class="empty">Informe os participantes para gerar as avaliações individuais.</div>'}
      ${!ready?'<p class="muted">As avaliações ficam disponíveis após concluir o treinamento.</p>':''}`;
    window.renderTrainings?.();
  }
  async function openEditor(trainingId,employeeId,readOnly=false){
    const t=trainingById(trainingId),e=employeeById(employeeId);
    if(!canView()||!t||!e||!participantIds(t).includes(Number(employeeId))||t.status!=='Ministrado')return;
    try{await refresh()}catch(error){alert('Não foi possível abrir a avaliação: '+error.message);return}
    const record=validRecord(t,employeeId);
    if(!record&&!canManage())return;
    editor={trainingId:Number(trainingId),employeeId:Number(employeeId),recordId:record?.id||null,readOnly:readOnly||!canManage()};
    $('efficacyEditorTitle').textContent=record?(editor.readOnly?'Visualizar avaliação de eficácia':'Editar avaliação de eficácia'):'Avaliar participante';
    $('efficacyEditorPerson').textContent=`${e.name} · ${t.name}`;
    const available=models.filter(m=>m.active||m.id===record?.model_id);
    $('efficacyModel').innerHTML='<option value="">Selecione</option>'+available.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    if(record?.model_id&&!available.some(m=>m.id===record.model_id))
      $('efficacyModel').insertAdjacentHTML('beforeend',`<option value="${esc(record.model_id)}">${esc(record.model_name)} (histórico)</option>`);
    $('efficacyModel').value=record?.model_id||'';
    const today=new Date();
    $('efficacyDate').value=record?.reviewed_on||`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    $('efficacyResult').value=record?.result||'';$('efficacyScore').value=record?.score??'';
    $('efficacyNotes').value=record?.notes||'';$('efficacyEvaluator').value=record?.evaluator||access?.full_name||'';
    ['efficacyModel','efficacyDate','efficacyResult','efficacyScore','efficacyNotes','efficacyEvaluator'].forEach(id=>$(id).disabled=editor.readOnly);
    $('efficacySave').hidden=editor.readOnly;$('efficacyMessage').textContent='';$('efficacyEditor').showModal();
  }
  function closeEditor(){editor=null;$('efficacyEditor')?.close()}
  async function save(){
    if(!editor||editor.readOnly||!canManage())return;
    const model=$('efficacyModel').value,date=$('efficacyDate').value,result=$('efficacyResult').value,
      scoreText=$('efficacyScore').value,score=Number(scoreText),notes=$('efficacyNotes').value.trim(),evaluator=$('efficacyEvaluator').value.trim();
    const t=trainingById(editor.trainingId),trainingDate=t?.date?.split('/').reverse().join('-');
    if(!model||!date||trainingDate&&date<trainingDate||date>new Date().toISOString().slice(0,10)||
      !scoreText||!Number.isFinite(score)||score<0||score>100||!['Eficaz','Não eficaz'].includes(result)||notes.length<3||evaluator.length<2){
      $('efficacyMessage').textContent='Preencha modelo, data válida, resultado, nota de 0% a 100%, evidência e responsável.';return;
    }
    const button=$('efficacySave');button.disabled=true;
    try{
      const {error}=await client.rpc('training_efficacy_save',{target_id:editor.recordId,
        target_training_id:editor.trainingId,target_employee_id:editor.employeeId,target_model_id:model,
        next_reviewed_on:date,next_result:result,next_score:score,next_notes:notes,next_evaluator:evaluator});
      if(error)throw error;
      const id=editor.trainingId;closeEditor();await refresh();
      const current=trainingById(id);if(current)await renderTraining(current);
      renderEmployeeHistoryIfOpen();renderReportsIfOpen();
    }catch(error){$('efficacyMessage').textContent='Não foi possível salvar: '+error.message}
    finally{button.disabled=false}
  }
  async function remove(id){
    if(!canManage()||!confirm('Excluir esta avaliação de eficácia? O participante voltará ao status Pendente.'))return;
    const r=records.find(x=>x.id===id);if(!r)return;
    const {error}=await client.rpc('training_efficacy_delete',{target_id:id});
    if(error){alert('Não foi possível excluir: '+error.message);return}
    await refresh();const t=trainingById(r.training_id);if(t)await renderTraining(t);
    renderEmployeeHistoryIfOpen();renderReportsIfOpen();
  }
  function rowsForEmployee(id){return getTrainings().filter(t=>!t.deletedAt&&t.status==='Ministrado'&&participantIds(t).includes(Number(id)))
    .map(t=>({t,r:validRecord(t,id)}));}
  async function renderEmployeeHistory(id){
    const node=$('employeeEfficacyHistory');if(!node||!canView())return;
    try{await refresh()}catch(error){node.textContent='Não foi possível carregar avaliações: '+error.message;return}
    if(!node.isConnected||Number(node.dataset.employeeId)!==Number(id))return;
    const rows=rowsForEmployee(id);
    node.innerHTML=rows.length?`<div class="table-scroll"><table><thead><tr><th>Treinamento</th><th>Data</th><th>Modelo</th><th>Avaliação de eficácia</th><th>Eficácia</th><th>Nota</th></tr></thead><tbody>${rows.map(({t,r})=>`<tr>
      <td>${esc(t.name)}</td><td>${esc(t.date)}</td><td>${esc(r?.model_name||'—')}</td><td>${r?'Concluída':'Pendente'}</td><td>${esc(r?.result||'—')}</td><td>${r?fmt(r.score)+'%':'—'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Nenhum treinamento registrado.</div>';
  }
  function reportRows(){return getTrainings().filter(t=>!t.deletedAt&&t.status==='Ministrado').flatMap(t=>participantIds(t).map(id=>({t,e:employeeById(id),r:validRecord(t,id)})));}
  async function renderTrainingReport(){
    const node=$('trainingEfficacyReport');if(!node||!canView())return;
    try{await refresh()}catch(error){node.textContent='Não foi possível carregar o relatório de eficácia: '+error.message;return}
    const rows=reportRows();
    const completed=getTrainings().filter(t=>!t.deletedAt&&t.status==='Ministrado');
    const aggregate=completed.length?`<div class="table-scroll"><table><thead><tr><th>Treinamento</th><th>Participantes</th><th>Concluídas</th><th>Pendentes</th><th>Conclusão</th><th>Média das notas</th></tr></thead><tbody>${completed.map(t=>{
      const s=summary(t),scores=participantIds(t).map(id=>validRecord(t,id)?.score).filter(x=>x!==undefined);
      const average=scores.length?fmt(scores.reduce((sum,value)=>sum+Number(value),0)/scores.length)+'%':'—';
      return `<tr><td>${esc(t.name)}</td><td>${s.total}</td><td>${s.done}</td><td>${s.pending}</td><td>${s.percent}%</td><td>${average}</td></tr>`;
    }).join('')}</tbody></table></div>`:'<div class="empty">Nenhum treinamento concluído.</div>';
    node.innerHTML=`<h3>Resumo de eficácia por treinamento</h3>${aggregate}<h3>Avaliações de eficácia por participante</h3>${rows.length?`<div class="table-scroll"><table><thead><tr><th>Funcionário</th><th>Treinamento</th><th>Data do treinamento</th><th>Formulário</th><th>Data da avaliação</th><th>Status</th><th>Eficácia</th><th>Nota</th><th>Responsável</th></tr></thead><tbody>${rows.map(({t,e,r})=>`<tr><td>${esc(e?.name||'Funcionário não encontrado')}</td><td>${esc(t.name)}</td><td>${esc(t.date)}</td><td>${esc(r?.model_name||'—')}</td><td>${dateBR(r?.reviewed_on)}</td><td>${r?'Concluída':'Pendente'}</td><td>${esc(r?.result||'—')}</td><td>${r?fmt(r.score)+'%':'—'}</td><td>${esc(r?.evaluator||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Nenhum participante em treinamentos concluídos.</div>'}`;
  }
  async function renderEmployeeReport(id){
    const node=$('employeeEfficacyReport');if(!node||!canView()||!id)return;
    try{await refresh()}catch(error){node.textContent='Não foi possível carregar as avaliações: '+error.message;return}
    const rows=rowsForEmployee(id);
    node.innerHTML=`<h3>Avaliações de eficácia</h3>${rows.length?`<div class="table-scroll"><table><thead><tr><th>Treinamento</th><th>Data</th><th>Formulário</th><th>Data da avaliação</th><th>Status</th><th>Eficácia</th><th>Nota</th><th>Responsável</th></tr></thead><tbody>${rows.map(({t,r})=>`<tr><td>${esc(t.name)}</td><td>${esc(t.date)}</td><td>${esc(r?.model_name||'—')}</td><td>${dateBR(r?.reviewed_on)}</td><td>${r?'Concluída':'Pendente'}</td><td>${esc(r?.result||'—')}</td><td>${r?fmt(r.score)+'%':'—'}</td><td>${esc(r?.evaluator||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Nenhum registro.</div>'}`;
  }
  function renderEmployeeHistoryIfOpen(){const node=$('employeeEfficacyHistory');if(node?.isConnected)renderEmployeeHistory(Number(node.dataset.employeeId))}
  function renderReportsIfOpen(){if($('pageReportTraining')?.classList.contains('active'))renderTrainingReport();
    if($('pageReportEmployee')?.classList.contains('active'))renderEmployeeReport(Number($('reportEmpSelect')?.value));}
  async function recordsForTraining(trainingId){
    if(!canView())return [];
    await refresh();
    return records.filter(r=>Number(r.training_id)===Number(trainingId)&&!r.deleted_at);
  }
  window.SPFLY_EFFICACY={configure,refresh,canView,canManage,badge,summary,renderTraining,renderEmployeeHistory,
    renderTrainingReport,renderEmployeeReport,recordsForTraining,openEditor,closeEditor,save,remove};
})();
