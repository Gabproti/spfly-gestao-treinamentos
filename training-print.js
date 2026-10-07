(function(){
  'use strict';
  const DOCUMENT_REVISIONS=Object.freeze({attendance:'00',extract:'00'});
  const DOCUMENT_CODES=Object.freeze({extract:'F - 5.0 - 000'});
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const filled=value=>value===null||value===undefined||String(value).trim()===''?'Não informado':esc(value);
  const dateTime=value=>{if(!value)return 'Não informado';const d=new Date(value);return Number.isNaN(d.getTime())?'Não informado':d.toLocaleString('pt-BR')};
  const participantIds=t=>Array.isArray(t.participants)?t.participants.map(Number):[];
  const employeeDocument=e=>[e?.cpf,e?.mat].filter(Boolean).join(' / ')||'—';
  const trainingTime=(t,position)=>t[position+'Time']||((String(t.time||'').match(/\b\d{1,2}:\d{2}\b/g)||[])[position==='start'?0:1])||null;
  function header(title,revision,code){return `<header class="training-print-header"><img src="spfly_logo.png" alt="SPFLY Logística"><div><strong>${esc(title)}</strong><small>SPFLY · Gestão de Treinamentos</small></div><b>${code?esc(code):`REV. ${esc(revision)}`}</b></header>`}
  function info(label,value){return `<div class="training-print-field"><b>${esc(label)}</b><span>${filled(value)}</span></div>`}
  function attendanceMarkup(t,employees){
    const people=participantIds(t).map(id=>employees.find(e=>Number(e.id)===id));
    return `${header('Lista de Presença',DOCUMENT_REVISIONS.attendance)}<main class="training-print-main">
      <h1>Lista de Presença</h1><div class="training-print-grid">
      ${info('Treinamento',t.name)}${info('Data',t.date)}${info('Horário de início',trainingTime(t,'start'))}
      ${info('Horário de término',trainingTime(t,'end'))}${info('Carga horária',t.workload?`${t.workload} h`:null)}
      ${info('Instrutor / responsável',t.resp)}${info('Local / acesso',t.modality==='Online'?t.onlineInfo:t.base||t.place)}
      ${info('Setor / público-alvo',t.targetSector||t.audience||t.sector)}${info('Modalidade',t.modality==='Local'?'Presencial':t.modality)}
      </div><table class="training-print-table attendance-table"><thead><tr><th>Nº</th><th>Nome do funcionário</th><th>CPF / Matrícula</th><th>Setor</th><th>Assinatura</th></tr></thead>
      <tbody>${people.length?people.map((e,i)=>`<tr><td>${String(i+1).padStart(2,'0')}</td><td>${esc(e?.name||'Funcionário não encontrado')}</td><td>${esc(employeeDocument(e))}</td><td>${esc(e?.sector||'—')}</td><td class="signature-cell"><span></span></td></tr>`).join(''):
      '<tr><td colspan="5" class="training-print-empty">Nenhum participante cadastrado.</td></tr>'}</tbody></table>
      <p class="training-print-footnote">Assinatura do participante confirma sua presença neste treinamento.</p></main>`;
  }
  function extractMarkup(t,employees,reviews){
    const people=participantIds(t).map(id=>({id,e:employees.find(e=>Number(e.id)===id)}))
      .sort((a,b)=>String(a.e?.name||'').localeCompare(String(b.e?.name||''),'pt-BR',{sensitivity:'base'}));
    const reviewByEmployee=new Map(reviews.map(r=>[Number(r.employee_id),r]));
    const legacy=Array.isArray(t.efficacyReviews)?t.efficacyReviews:[];
    return `${header('Relatório de Treinamento',DOCUMENT_REVISIONS.extract,DOCUMENT_CODES.extract)}<main class="training-print-main training-print-report">
      <h1>Relatório de Treinamento</h1><section><h2>Dados do treinamento</h2><div class="training-print-grid">
      ${info('Nome',t.name)}${info('Descrição',t.desc)}${info('Categoria',t.cat)}${info('Data',t.date)}
      ${info('Horário de início',trainingTime(t,'start'))}${info('Horário de término',trainingTime(t,'end'))}
      ${info('Carga horária',t.workload?`${t.workload} h`:null)}${info('Instrutor / responsável',t.resp)}
      ${info('Modalidade',t.modality==='Local'?'Presencial':t.modality)}
      ${info('Local / acesso',t.modality==='Online'?t.onlineInfo:t.base||t.place)}
      ${info('Status',t.status==='Ministrado'?'Concluído':t.status)}${info('Conclusão',dateTime(t.finalizedAt||t.deliveredAt))}
      ${info('Período para revisão',t.reviewDays?`${t.reviewDays} dias`:null)}${info('Método de revisão',t.reviewMethod)}
      ${info('Observações',t.obs)}${t.cancelReason?info('Motivo do cancelamento',t.cancelReason):''}
      </div></section>
      <section><h2>Participantes (${people.length})</h2><table class="training-print-table training-print-participants"><colgroup><col style="width:38%"><col style="width:27%"><col style="width:19%"><col style="width:16%"></colgroup><thead><tr><th>Funcionário</th><th>CPF / Matrícula</th><th>Setor</th><th>Participação</th></tr></thead><tbody>
      ${people.length?people.map(({e})=>`<tr><td>${esc(e?.name||'Funcionário não encontrado')}</td><td>${esc(employeeDocument(e))}</td><td>${esc(e?.sector||'—')}</td><td>Presente</td></tr>`).join(''):
      '<tr><td colspan="4" class="training-print-empty">Nenhum participante cadastrado.</td></tr>'}</tbody></table></section>
      <section><h2>Avaliações de eficácia individuais</h2><table class="training-print-table"><thead><tr><th>Funcionário</th><th>Formulário</th><th>Data</th><th>Status</th><th>Eficácia</th><th>Nota</th><th>Responsável</th></tr></thead><tbody>
      ${people.length?people.map(({id,e})=>{const r=reviewByEmployee.get(id);return `<tr><td>${esc(e?.name||'Funcionário não encontrado')}</td><td>${esc(r?.model_name||'—')}</td><td>${r?esc(String(r.reviewed_on).slice(0,10).split('-').reverse().join('/')):'—'}</td><td>${r?'Concluída':'Pendente'}</td><td>${esc(r?.result||'—')}</td><td>${r?esc(Number(r.score).toLocaleString('pt-BR',{maximumFractionDigits:2}))+'%':'—'}</td><td>${esc(r?.evaluator||'—')}</td></tr>`}).join(''):
      '<tr><td colspan="7" class="training-print-empty">Nenhum participante cadastrado.</td></tr>'}</tbody></table>
      ${legacy.length?`<h3>Registros anteriores sem vínculo individual</h3><p>Estes registros antigos não compõem os indicadores individuais.</p><ul>${legacy.map(r=>`<li>${esc(r.reviewedOn||'Sem data')} · ${esc(r.result||'—')} · ${esc(r.method||'—')}</li>`).join('')}</ul>`:''}</section>
      ${Array.isArray(t.statusChanges)&&t.statusChanges.length?`<section><h2>Histórico de status</h2><ul>${t.statusChanges.map(c=>`<li>${esc(dateTime(c.at))} · ${esc(c.from||'—')} → ${esc(c.to||'—')} · ${esc(c.reason||'Sem motivo')}</li>`).join('')}</ul></section>`:''}
      </main>`;
  }
  async function currentState(trainingId){
    const {data,error}=await window.SPFLY_AUTH.getClient().rpc('load_portal_state');
    if(error)throw error;
    const state=Array.isArray(data)?data[0]:data;
    const t=(state?.trainings||[]).find(x=>Number(x.id)===Number(trainingId)&&!x.deletedAt);
    if(!t)throw new Error('Treinamento não encontrado. Atualize a página.');
    return {training:t,employees:Array.isArray(state.employees)?state.employees:[]};
  }
  function clearPrint(){document.body.classList.remove('print-training-document');const node=document.getElementById('trainingPrintDocument');if(node)node.innerHTML=''}
  async function print(type,trainingId){
    if(!window.SPFLY_AUTH?.canPage('pageTrainingDetail'))return;
    if(type==='extract'&&!window.SPFLY_EFFICACY?.canView()){alert('O extrato requer acesso às avaliações de eficácia.');return}
    try{
      const {training,employees}=await currentState(trainingId);
      const reviews=type==='extract'?await window.SPFLY_EFFICACY.recordsForTraining(trainingId):[];
      const node=document.getElementById('trainingPrintDocument');
      node.innerHTML=type==='attendance'?attendanceMarkup(training,employees):extractMarkup(training,employees,reviews);
      document.body.classList.add('print-training-document');
      window.addEventListener('afterprint',clearPrint,{once:true});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.print();
    }catch(error){clearPrint();alert('Não foi possível preparar a impressão: '+error.message)}
  }
  window.SPFLY_PRINT={attendance:id=>print('attendance',id),extract:id=>print('extract',id),revisions:DOCUMENT_REVISIONS};
})();
