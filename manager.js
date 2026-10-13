(function () {
  'use strict';
  let client, access, data = {employees:[], managers:[], approvers:[], requests:[], courses:[], sectors:[]};
  let loading = false;
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => value ? new Date(value).toLocaleString('pt-BR') : '—';
  const statusNames = {requested:'Solicitado',immediate_approved:'Gestão imediata aprovou',manager_accepted:'Gestor atual aceitou',approved:'Aprovado',selecting:'Em seleção',completed:'Concluído',rejected:'Reprovado',cancelled:'Cancelado'};
  const active = () => document.querySelector('#pageManager.page.active');
  const isAdmin = () => access?.access_role === 'admin';
  const nameOf = id => data.employees.find(e => Number(e.id) === Number(id))?.name || `Funcionário #${id}`;
  const sectorOf = id => data.employees.find(e => Number(e.id) === Number(id))?.sector || '—';
  const actionNames = {approve:'Aprovar',start_selection:'Iniciar seleção',record_hires:'Registrar contratação',approve_immediate:'Aprovar gestão imediata',accept_manager:'Aceitar transferência',approve_final:'Aprovar e efetivar',reject:'Reprovar',cancel:'Cancelar',requested:'Solicitação registrada',manager_step_skipped:'Aceite repetido dispensado'};

  function configure(nextClient,nextAccess) { client=nextClient; access=nextAccess; }
  function message(text, error=false) { const el=$('managerMessage'); el.textContent=text; el.className=error?'manager-error':'muted'; }
  async function refresh() {
    if (!client || !active() || loading) return;
    loading=true; message('Carregando dados gerenciais...');
    try {
      const {data:result,error}=await client.rpc('hr_dashboard');
      if (error) throw error;
      data=result || data;
      message(''); render();
    } catch(error) { message('Não foi possível carregar a visão do gestor: '+error.message,true); }
    finally { loading=false; }
  }
  function setOptions(select,items,placeholder) {
    const previous=select.value;
    select.innerHTML=`<option value="">${safe(placeholder)}</option>`+items.join('');
    if ([...select.options].some(option=>option.value===previous)) select.value=previous;
  }
  function render() {
    if (!active()) return;
    const requests=data.requests||[], courses=data.courses||[];
    const pending=r=>!['completed','rejected','cancelled'].includes(r.status);
    const counts=[
      ['Funcionários vinculados',(data.employees||[]).filter(e=>!isAdmin()||e.manager_id).length,'team'],
      ['Vagas pendentes',requests.filter(r=>r.kind==='hire'&&pending(r)).reduce((n,r)=>n+r.quantity-r.filled_quantity,0),'hire'],
      ['Seleção em andamento',requests.filter(r=>r.kind==='hire'&&r.status==='selecting').length,'hire'],
      ['Transferências pendentes',requests.filter(r=>r.kind==='transfer'&&pending(r)).length,'pending'],
      ['Cursos em andamento',courses.filter(c=>c.started_at&&!c.completed_at).length,'started'],
      ['Cursos concluídos',courses.filter(c=>c.completed_at).length,'finished']
    ];
    $('managerKpis').innerHTML=counts.map(([label,value,filter])=>`<button type="button" class="manager-kpi" data-kpi="${filter}"><strong>${value}</strong><span>${safe(label)}</span></button>`).join('');
    $('managerTeam').innerHTML=data.employees?.length?`<div class="manager-table-wrap"><table><thead><tr><th>Nome</th><th>Setor</th><th>Cargo</th></tr></thead><tbody>${data.employees.map(e=>`<tr><td>${safe(e.name)}</td><td>${safe(e.sector)}</td><td>${safe(e.role)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Nenhum funcionário vinculado.</p>';
    const sectorItems=(data.sectors||[]).map(s=>`<option value="${safe(s)}">${safe(s)}</option>`);
    setOptions($('managerHireForm').elements.sector,sectorItems,'Selecione o setor');
    setOptions($('managerTransferForm').elements.sector,sectorItems,'Selecione o destino');
    setOptions($('managerTransferForm').elements.employee,(data.employees||[]).map(e=>`<option value="${Number(e.id)}">${safe(e.name)} · ${safe(e.sector)}</option>`),'Selecione um funcionário');
    setOptions($('managerSectorFilter'),sectorItems,'Todos os setores');
    renderAdmin(); renderRequests(); renderCourses();
  }
  function renderAdmin() {
    const box=$('managerAdmin'); box.hidden=!isAdmin(); if (!isAdmin()) return;
    const people=(data.employees||[]),managers=(data.managers||[]);
    box.innerHTML=`<div class="card"><h2>Vínculo de equipe</h2><p class="muted">Cada funcionário possui um gestor responsável. Selecione uma pessoa para vincular ou trocar o gestor.</p><div class="manager-filters"><input id="managerTeamSearch" type="search" placeholder="Buscar funcionário" oninput="SPFLY_MANAGER.filterTeam()"><select id="managerTeamEmployee"><option value="">Selecione o funcionário</option>${people.map(e=>`<option value="${Number(e.id)}">${safe(e.name)} · ${safe(e.sector)}</option>`).join('')}</select><select id="managerTeamManager"><option value="">Sem gestor</option>${managers.map(m=>`<option value="${safe(m.id)}">${safe(m.name)}</option>`).join('')}</select><button class="btn btn-primary" type="button" onclick="SPFLY_MANAGER.saveTeam()">Salvar vínculo</button></div><p class="muted" id="managerCurrentLink"></p></div>
      <div class="card"><h2>Gestão imediata</h2><p class="muted">Defina quem aprova a primeira etapa das transferências solicitadas por cada gestor. Sem responsável definido, a etapa cabe ao administrador.</p><div class="manager-filters"><select id="managerSupervisorOwner"><option value="">Selecione o gestor</option>${managers.map(m=>`<option value="${safe(m.id)}">${safe(m.name)}</option>`).join('')}</select><select id="managerSupervisor"><option value="">Administrador aprova</option>${(data.approvers||[]).map(a=>`<option value="${safe(a.id)}">${safe(a.name)} · ${a.role==='admin'?'Admin':'Gestor'}</option>`).join('')}</select><button class="btn btn-primary" type="button" onclick="SPFLY_MANAGER.saveSupervisor()">Salvar responsável</button></div></div>`;
    $('managerTeamEmployee').onchange=syncTeam;
    $('managerSupervisorOwner').onchange=syncSupervisor;
  }
  function filterTeam() {
    const term=$('managerTeamSearch').value.toLocaleLowerCase('pt-BR');
    [...$('managerTeamEmployee').options].forEach((option,index)=>{ if(index) option.hidden=!option.text.toLocaleLowerCase('pt-BR').includes(term); });
  }
  function syncTeam() {
    const employee=data.employees.find(e=>String(e.id)===$('managerTeamEmployee').value);
    $('managerTeamManager').value=employee?.manager_id||'';
    $('managerCurrentLink').textContent=employee ? 'Gestor atual: '+(data.managers.find(m=>m.id===employee.manager_id)?.name||'Não vinculado') : '';
  }
  function syncSupervisor() {
    $('managerSupervisor').value=data.managers.find(m=>m.id===$('managerSupervisorOwner').value)?.supervisor_id||'';
  }
  async function saveTeam() {
    const id=Number($('managerTeamEmployee').value), manager=$('managerTeamManager').value;
    if (!id) return message('Selecione um funcionário.',true);
    try {
      const current=data.employees.find(e=>Number(e.id)===id)?.manager_id;
      if (!manager && !current) return message('Este funcionário já está sem gestor.');
      const {error}=await client.rpc('hr_set_team',{target_manager:manager||current,target_employee:id,enabled:Boolean(manager)});
      if (error) throw error;
      await refresh(); message('Vínculo atualizado.');
    } catch(error) { message('Não foi possível salvar o vínculo: '+error.message,true); }
  }
  async function saveSupervisor() {
    const manager=$('managerSupervisorOwner').value,supervisor=$('managerSupervisor').value||null;
    if (!manager) return message('Selecione o gestor.',true);
    try {
      const {error}=await client.rpc('hr_set_supervisor',{target_manager:manager,target_supervisor:supervisor});
      if (error) throw error;
      await refresh(); message('Responsável atualizado.');
    } catch(error) { message('Não foi possível salvar o responsável: '+error.message,true); }
  }
  async function submit(kind,form) {
    const fields=form.elements;
    const employee=kind==='transfer'?Number(fields.employee.value):null;
    const args={next_kind:kind,target_employee:employee,next_sector:fields.sector.value,
      next_position:kind==='hire'?fields.position.value:'',next_quantity:kind==='hire'?Number(fields.quantity.value):1,
      next_reason:fields.reason.value.trim()};
    const button=form.querySelector('button[type=submit]'); button.disabled=true;
    try {
      const {data:id,error}=await client.rpc('hr_submit_request',args);
      if (error) throw error;
      form.reset(); await refresh(); message(`Solicitação #${id} registrada.`);
    } catch(error) { message('Não foi possível registrar a solicitação: '+error.message,true); }
    finally { button.disabled=false; }
  }
  function possibleActions(r) {
    const actor=access.id,admin=isAdmin(),actions=[];
    if (r.kind==='hire'&&admin) {
      if (r.status==='requested') actions.push('approve');
      if (r.status==='approved') actions.push('start_selection');
      if (r.status==='selecting') actions.push('record_hires');
    }
    if (r.kind==='transfer') {
      if (r.status==='requested' && ((admin&&!r.immediate_approver_id)||actor===r.immediate_approver_id)) actions.push('approve_immediate');
      if (r.status==='immediate_approved' && (admin||actor===r.current_manager_id)) actions.push('accept_manager');
      if (r.status==='manager_accepted' && admin) actions.push('approve_final');
    }
    if (!['completed','rejected','cancelled'].includes(r.status)) {
      if (admin || (r.kind==='transfer' &&
        (r.status==='requested'&&actor===r.immediate_approver_id ||
         r.status==='immediate_approved'&&actor===r.current_manager_id))) actions.push('reject');
      if (admin||actor===r.requester_id) actions.push('cancel');
    }
    return actions;
  }
  function renderRequests() {
    const selected=$('managerRequestFilter').value;
    const rows=(data.requests||[]).filter(r=>!selected||selected===r.kind||
      selected==='pending'&&!['completed','rejected','cancelled'].includes(r.status)||
      selected==='completed'&&r.status==='completed');
    $('managerRequests').innerHTML=rows.length?rows.map(r=>`<article class="manager-request"><div class="manager-request-head"><div><strong>#${r.id} · ${r.kind==='hire'?'Requisição de vagas':'Transferência'}</strong><div class="muted">${safe(r.kind==='transfer'?nameOf(r.employee_id):r.position_name)} · ${safe(r.target_sector)} · ${date(r.created_at)}</div></div><span class="badge ${r.status==='completed'?'badge-green':r.status==='rejected'||r.status==='cancelled'?'badge-red':''}">${safe(statusNames[r.status]||r.status)}</span></div><p>${safe(r.reason)}</p>${r.kind==='hire'?`<p><strong>Vagas:</strong> ${r.filled_quantity} preenchida(s) de ${r.quantity} · ${r.quantity-r.filled_quantity} restante(s)</p>`:`<p><strong>Setor:</strong> ${safe(r.current_sector)} → ${safe(r.target_sector)}</p>`}<details><summary>Histórico e etapas (${r.events?.length||0})</summary><ol class="manager-timeline">${(r.events||[]).map(e=>`<li><strong>${safe(actionNames[e.action]||e.action)}</strong><span>${date(e.created_at)} · ${safe(e.actor_name)} · ${safe(statusNames[e.next_status]||e.next_status)}</span>${e.note?`<p>${safe(e.note)}</p>`:''}</li>`).join('')}</ol></details><div class="actions">${possibleActions(r).map(action=>`<button type="button" class="btn ${action==='reject'||action==='cancel'?'btn-secondary':'btn-primary'}" data-request="${r.id}" data-action="${action}">${safe(actionNames[action])}</button>`).join('')}</div></article>`).join(''):'<p class="muted">Nenhuma solicitação para este filtro.</p>';
  }
  async function advance(id,action) {
    let note=null,filled=null;
    const request=(data.requests||[]).find(r=>Number(r.id)===Number(id));
    if (!request) return;
    if (action==='reject'||action==='cancel') {
      note=prompt('Informe a justificativa (mínimo 8 caracteres):');
      if (note===null) return;
      if (note.trim().length<8) return message('A justificativa precisa ter pelo menos 8 caracteres.',true);
    }
    if (action==='record_hires') {
      const input=prompt(`Quantidade total de vagas já preenchidas (atual: ${request.filled_quantity}; máximo: ${request.quantity}):`,String(request.quantity));
      if (input===null) return;
      filled=Number(input);
      if (!Number.isInteger(filled)||filled<=request.filled_quantity||filled>request.quantity) return message('Quantidade preenchida inválida.',true);
    }
    if (action==='approve_final'&&!confirm('Aprovar e alterar o setor do funcionário agora?')) return;
    try {
      const {error}=await client.rpc('hr_advance_request',{target_request:Number(id),next_action:action,action_note:note,next_filled:filled});
      if (error) throw error;
      await refresh(); message('Etapa registrada no histórico.');
    } catch(error) { message('Não foi possível atualizar a solicitação: '+error.message,true); }
  }
  function courseState(c) { return c.completed_at?'finished':c.started_at?'started':'pending'; }
  function renderCourses() {
    const term=$('managerCourseSearch').value.trim().toLocaleLowerCase('pt-BR'),
      sector=$('managerSectorFilter').value,status=$('managerCourseStatus').value;
    const rows=(data.courses||[]).filter(c=>(!term||`${c.course_name} ${c.track_name} ${nameOf(c.employee_id)}`.toLocaleLowerCase('pt-BR').includes(term)) &&
      (!sector||sectorOf(c.employee_id)===sector)&&(!status||courseState(c)===status));
    const grouped=new Map();
    rows.forEach(c=>{ const key=c.course_id; if(!grouped.has(key)) grouped.set(key,[]); grouped.get(key).push(c); });
    $('managerCourses').innerHTML=grouped.size?[...grouped.values()].map(items=>`<details class="manager-course"><summary><strong>${safe(items[0].course_name)}</strong><span>${safe(items[0].track_name)} · ${items.length} inscrito(s)</span></summary><div class="manager-table-wrap"><table><thead><tr><th>Funcionário</th><th>Setor</th><th>Inscrição</th><th>Status</th><th>Certificado</th></tr></thead><tbody>${items.map(c=>`<tr><td>${safe(nameOf(c.employee_id))}</td><td>${safe(sectorOf(c.employee_id))}</td><td>${date(c.enrolled_at)}</td><td>${courseState(c)==='finished'?'Concluído':courseState(c)==='started'?'Em andamento':'Pendente'}</td><td>${c.certificate_path?`<button class="btn btn-secondary" type="button" data-cert="${safe(c.certificate_path)}">Visualizar certificado</button>`:c.track_certificate_path?`<button class="btn btn-secondary" type="button" data-cert="${safe(c.track_certificate_path)}">Certificado da trilha</button>`:'—'}</td></tr>`).join('')}</tbody></table></div></details>`).join(''):'<p class="muted">Nenhuma inscrição encontrada.</p>';
  }
  async function openCertificate(path) {
    try {
      if (!window.SPFLY_CAP?.openCertificatePreview) throw new Error('Visualizador indisponível.');
      await window.SPFLY_CAP.openCertificatePreview(path,'Certificado da capacitação');
    } catch(error) { message('Não foi possível abrir o certificado: '+error.message,true); }
  }
  document.addEventListener('DOMContentLoaded',()=>{
    $('managerHireForm').addEventListener('submit',event=>{event.preventDefault();submit('hire',event.currentTarget);});
    $('managerTransferForm').addEventListener('submit',event=>{event.preventDefault();submit('transfer',event.currentTarget);});
    $('pageManager').addEventListener('click',event=>{
      const action=event.target.closest('[data-request]');
      if(action) return advance(action.dataset.request,action.dataset.action);
      const cert=event.target.closest('[data-cert]');
      if(cert) return openCertificate(cert.dataset.cert);
      const kpi=event.target.closest('[data-kpi]');
      if(kpi) {
        const filter=kpi.dataset.kpi;
        if(filter==='team') $('managerTeam').scrollIntoView({behavior:'smooth'});
        else if(filter==='started'||filter==='finished') { $('managerCourseStatus').value=filter;renderCourses();$('managerCourses').scrollIntoView({behavior:'smooth'}); }
        else { $('managerRequestFilter').value=filter;renderRequests();$('managerRequests').scrollIntoView({behavior:'smooth'}); }
      }
    });
  });
  window.SPFLY_MANAGER={configure,refresh,render,renderCourses,filterTeam,saveTeam,saveSupervisor};
})();
