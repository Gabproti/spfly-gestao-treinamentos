(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  const minutes = value => Math.round(Number(value || 0));
  const hours = value => (value / 60).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2}) + ' h';
  const isoDate = value => {
    if (!value) return '';
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0,10);
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
  };
  const fmtDate = value => value ? `${value.slice(8,10)}/${value.slice(5,7)}/${value.slice(0,4)}` : '—';
  const modality = value => ['Online','Presencial','Híbrido'].includes(value) ? value : value === 'Local' ? 'Presencial' : 'Não informada';
  let allRows = [], visibleRows = [], revision = 0;

  function buildRows(people, trainings, tracks, courses, enrollments, progress, employeeSystems = [], courseGrants = []) {
    const personById = new Map(people.map(person => [String(person.id),person]));
    const trackById = new Map(tracks.filter(track => !track.deleted_at).map(track => [track.id,track]));
    const progressByPair = new Map(progress.map(item => [`${item.enrollment_id}:${item.course_id}`,item]));
    const systemsByEmployee=new Map();
    for(const item of employeeSystems){const key=String(item.employee_id);if(!systemsByEmployee.has(key))systemsByEmployee.set(key,new Set());systemsByEmployee.get(key).add(item.system_code)}
    const grants=new Set(courseGrants.map(item=>`${item.employee_id}:${item.course_id}`));
    const enrollByTrack = new Map();
    for (const enrollment of enrollments) {
      if (enrollment.removed_at || !trackById.has(enrollment.track_id)) continue;
      if (!enrollByTrack.has(enrollment.track_id)) enrollByTrack.set(enrollment.track_id,[]);
      enrollByTrack.get(enrollment.track_id).push(enrollment);
    }
    const rows = [];
    for (const course of courses) {
      const track = trackById.get(course.track_id);
      if (!track) continue;
      const members = enrollByTrack.get(track.id) || [null];
      for (const enrollment of members) {
        if(enrollment){const codes=track.system_codes||[];const direct=grants.has(`${enrollment.employee_id}:${course.id}`);
          const person=personById.get(String(enrollment.employee_id));
          const sectors=Array.isArray(track.sectors)?track.sectors:(track.sector?[track.sector]:[]);
          if(!direct && (enrollment.individual_only || sectors.length && !sectors.includes(person?.sector) ||
            codes.length && !codes.some(code=>systemsByEmployee.get(String(enrollment.employee_id))?.has(code))))continue;}
        const progressRow = enrollment ? progressByPair.get(`${enrollment.id}:${course.id}`) : null;
        if (!course.active && !progressRow?.completed_at) continue;
        const person = enrollment ? personById.get(String(enrollment.employee_id)) : null;
        const duration = minutes(course.duration_minutes);
        const completed = !!progressRow?.completed_at;
        rows.push({key:`cap:${course.id}`,source:'Capacitação',track:track.name,course:course.name,
          modality:modality(course.modality || track.modality),system:[...(track.system_codes||[])].sort().join(' + ')||'Não classificado',employeeId:enrollment?.employee_id ?? null,
          employee:person?.name || (enrollment ? `Funcionário #${enrollment.employee_id}` : ''),sector:person?.sector||'Não informado',
          durationMinutes:duration,realizedMinutes:completed&&enrollment?duration:0,
          completedOn:completed?isoDate(progressRow.completed_at):'',status:completed?'Concluído':'Pendente'});
      }
    }
    for (const training of trainings.filter(item => !item.deletedAt && item.status !== 'Cancelado')) {
      const participants = training.participants?.length ? training.participants : [null];
      const duration = Math.round(Number(training.workload || 0)*60) || 0;
      const completed = training.status === 'Ministrado';
      for (const employeeId of participants) {
        const person = employeeId == null ? null : personById.get(String(employeeId));
        rows.push({key:`training:${training.id}`,source:'Treinamento',track:'',course:training.name,
          modality:modality(training.modality),system:'Não classificado',employeeId,
          employee:person?.name || (employeeId == null ? '' : `Funcionário #${employeeId}`),sector:person?.sector||'Não informado',
          durationMinutes:duration,realizedMinutes:completed&&employeeId!=null?duration:0,
          completedOn:completed?isoDate(training.deliveredAt || training.date):'',status:completed?'Concluído':'Pendente'});
      }
    }
    return rows.sort((a,b) => (b.completedOn || '').localeCompare(a.completedOn || '') || a.course.localeCompare(b.course,'pt-BR') || a.employee.localeCompare(b.employee,'pt-BR'));
  }

  async function fetchAll(table) {
    const rows = [], client = window.SPFLY_AUTH.getClient();
    for (let offset = 0; ; offset += 1000) {
      const {data,error} = await client.from(table).select('*').order(table==='cap_course_grants'?'course_id':table==='cap_employee_systems'?'employee_id':'id').range(offset,offset+999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) return rows;
    }
  }
  async function render(people,trainings) {
    const current = ++revision;
    $('hoursMessage').textContent = 'Carregando carga horária...';
    $('hoursSummary').replaceChildren();$('hoursByEmployee').replaceChildren();$('hoursByCourse').replaceChildren();$('hoursBySector').replaceChildren();$('hoursDetails').replaceChildren();
    const select=$('hoursEmployee'),previous=select.value;
    select.innerHTML='<option value="">Todos os funcionários</option>'+people.slice().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(person=>`<option value="${safe(person.id)}">${safe(person.name)}</option>`).join('');
    select.value=previous;
    const sectors=$('hoursSector'),selectedSector=sectors.value;
    sectors.innerHTML='<option value="">Todos os setores</option>'+[...new Set(people.map(person=>person.sector).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).map(sector=>`<option value="${safe(sector)}">${safe(sector)}</option>`).join('');
    sectors.value=selectedSector;
    try {
      const [tracks,courses,enrollments,progress,employeeSystems,courseGrants]=await Promise.all(['cap_tracks','cap_courses','cap_enrollments','cap_progress','cap_employee_systems','cap_course_grants'].map(fetchAll));
      if (current!==revision) return;
      allRows=buildRows(people,trainings,tracks,courses,enrollments,progress,employeeSystems,courseGrants);
      filter();
    } catch (error) { if(current===revision)$('hoursMessage').textContent='Não foi possível carregar o relatório: '+error.message; }
  }
  function filter() {
    const term=fold($('hoursSearch').value.trim()),person=$('hoursEmployee').value,sector=$('hoursSector').value,mode=$('hoursModality').value,system=$('hoursSystem').value,
      status=$('hoursStatus').value,from=$('hoursFrom').value,to=$('hoursTo').value;
    visibleRows=allRows.filter(row => (!term || fold(`${row.course} ${row.track}`).includes(term))
      && (!person || String(row.employeeId)===person) && (!sector || row.sector===sector) && (!mode || row.modality===mode) && (!system || row.system===system)
      && (!status || row.status===status) && (!from && !to || !!row.completedOn && (!from || row.completedOn>=from) && (!to || row.completedOn<=to)));
    $('hoursMessage').textContent=visibleRows.length?`${visibleRows.length} registro(s) encontrado(s). Horas realizadas contam somente conclusões com funcionário vinculado.`:'Nenhum registro encontrado para os filtros.';
    const completed=visibleRows.filter(row=>row.realizedMinutes>0);
    const total=completed.reduce((sum,row)=>sum+row.realizedMinutes,0);
    $('hoursSummary').innerHTML=`<div class="hours-kpis">${card('Horas realizadas',hours(total))}${card('Conclusões',completed.length)}${card('Funcionários',new Set(completed.map(row=>String(row.employeeId))).size)}${card('Cursos/treinamentos',new Set(visibleRows.map(row=>row.key)).size)}</div>`;
    const byEmployee=group(visibleRows.filter(row=>row.employee),row=>String(row.employeeId),row=>row.employee);
    const byCourse=group(visibleRows,row=>row.key,row=>row.track?`${row.course} · ${row.track}`:row.course);
    const bySector=group(visibleRows.filter(row=>row.employeeId!=null),row=>row.sector,row=>row.sector);
    $('hoursByEmployee').innerHTML=summaryPanel('Por funcionário','Funcionário',byEmployee);
    $('hoursByCourse').innerHTML=summaryPanel('Por curso ou treinamento','Curso / origem',byCourse,true);
    $('hoursBySector').innerHTML=summaryPanel('Por setor','Setor',bySector);
    $('hoursDetails').innerHTML=`<h3>Detalhamento</h3><div class="table-scroll"><table><thead><tr><th>Origem / trilha</th><th>Curso ou treinamento</th><th>Setor</th><th>Sistema</th><th>Carga horária</th><th>Modalidade</th><th>Funcionário</th><th>Conclusão</th><th>Situação</th><th>Horas realizadas</th></tr></thead><tbody>${visibleRows.map(row=>`<tr><td>${safe(row.track||row.source)}</td><td>${safe(row.course)}</td><td>${safe(row.sector)}</td><td>${safe(row.system)}</td><td>${hours(row.durationMinutes)}</td><td>${safe(row.modality)}</td><td>${safe(row.employee||'—')}</td><td>${fmtDate(row.completedOn)}</td><td>${safe(row.status)}</td><td>${hours(row.realizedMinutes)}</td></tr>`).join('')||'<tr><td colspan="10" class="empty">Nenhum registro.</td></tr>'}</tbody></table></div>`;
  }
  function card(label,value){return `<div class="card kpi"><div><div class="num">${safe(value)}</div><div class="label">${safe(label)}</div></div></div>`;}
  function group(rows,keyOf,labelOf){
    const groups=new Map();
    for(const row of rows){const key=keyOf(row);if(!groups.has(key))groups.set(key,{label:labelOf(row),source:row.source,durationMinutes:row.durationMinutes,realizedMinutes:0,completed:0});
      const group=groups.get(key);group.realizedMinutes+=row.realizedMinutes;if(row.realizedMinutes>0)group.completed++;}
    return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));
  }
  function summaryTable(title,label,rows,course=false){return `${title?`<h3>${title}</h3>`:''}<div class="table-scroll"><table><thead><tr><th>${label}</th>${course?'<th>Carga horária do curso</th>':''}<th>Conclusões</th><th>Horas realizadas</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${safe(row.label)}${course?` <span class="muted">· ${safe(row.source)}</span>`:''}</td>${course?`<td>${hours(row.durationMinutes)}</td>`:''}<td>${row.completed}</td><td>${hours(row.realizedMinutes)}</td></tr>`).join('')||`<tr><td colspan="${course?4:3}" class="empty">Nenhum registro.</td></tr>`}</tbody></table></div>`;}
  function summaryPanel(title,label,rows,course=false){
    const ranked=rows.filter(row=>row.realizedMinutes>0).sort((a,b)=>b.realizedMinutes-a.realizedMinutes).slice(0,5);
    const maximum=Math.max(1,...ranked.map(row=>row.realizedMinutes));
    const bars=ranked.length?ranked.map(row=>`<div class="hours-bar-row"><span title="${safe(row.label)}">${safe(row.label)}</span><div class="hours-bar-track"><i style="width:${Math.round(row.realizedMinutes/maximum*100)}%"></i></div><strong>${hours(row.realizedMinutes)}</strong></div>`).join(''):'<p class="muted">Sem horas concluídas para estes filtros.</p>';
    return `<h3>${title}</h3><div class="hours-bars">${bars}</div><details class="hours-total-list"><summary>Ver totais completos (${rows.length})</summary>${summaryTable('',label,rows,course)}</details>`;
  }
  function printExtract(){
    if(!visibleRows.length){alert('Não há dados para imprimir.');return;}
    const popup=window.open('','_blank');
    if(!popup){alert('Permita a abertura da janela para imprimir o extrato.');return;}
    const people=group(visibleRows.filter(row=>row.employee),row=>String(row.employeeId),row=>row.employee);
    const courses=group(visibleRows,row=>row.key,row=>row.track?`${row.course} · ${row.track}`:row.course);
    const sectors=group(visibleRows.filter(row=>row.employeeId!=null),row=>row.sector,row=>row.sector);
    const total=visibleRows.reduce((sum,row)=>sum+row.realizedMinutes,0);
    const from=$('hoursFrom').value,to=$('hoursTo').value;
    const period=from||to?`${from?fmtDate(from):'Início'} até ${to?fmtDate(to):'hoje'}`:'Todos os períodos';
    const logo=new URL('spfly_print_logo.png',location.href).href;
    const detail=visibleRows.map(row=>`<tr><td>${safe(row.employee||'—')}</td><td>${safe(row.sector)}</td><td>${safe(row.track||'—')}</td><td>${safe(row.course)}</td><td>${safe(row.modality)}</td><td>${fmtDate(row.completedOn)}</td><td>${hours(row.realizedMinutes)}</td></tr>`).join('');
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Extrato de Treinamentos e Carga Horária</title><style>@page{size:A4 landscape;margin:14mm}body{font:11px Arial,sans-serif;color:#18202a}header{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #ed5b2a;padding-bottom:10px}header img{width:135px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:20px 0 8px}p{margin:6px 0}.metrics{display:flex;gap:22px;margin:16px 0;font-weight:bold}table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border-bottom:1px solid #d5d9dd;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#f0f2f4}tr{break-inside:avoid}thead{display:table-header-group}.small th:first-child,.small td:first-child{width:60%}@media screen{body{max-width:1100px;margin:26px auto;padding:0 20px}}</style></head><body><header><img src="${logo}" alt="SPFLY Logística"><div><h1>Extrato de Treinamentos e Carga Horária</h1><p>Período: ${safe(period)}</p></div></header><div class="metrics"><span>Horas realizadas: ${hours(total)}</span><span>Conclusões: ${visibleRows.filter(row=>row.realizedMinutes>0).length}</span><span>Funcionários: ${people.length}</span></div>${summaryTable('Total por funcionário','Funcionário',people)}${summaryTable('Total por setor','Setor',sectors)}${summaryTable('Total por curso ou treinamento','Curso / origem',courses,true)}<h2>Detalhamento</h2><table><thead><tr><th>Funcionário</th><th>Setor</th><th>Trilha</th><th>Curso ou treinamento</th><th>Modalidade</th><th>Conclusão</th><th>Horas</th></tr></thead><tbody>${detail}</tbody></table></body></html>`);
    popup.onload=()=>popup.print();
    popup.document.close();
  }
  function csvCell(value){const text=String(value??'');const guarded=/^[=+@\-\t\r]/.test(text)?`'${text}`:text;return `"${guarded.replace(/"/g,'""')}"`;}
  function exportCsv(){
    if(!visibleRows.length){alert('Não há dados para exportar.');return;}
    const people=group(visibleRows.filter(row=>row.employee),row=>String(row.employeeId),row=>row.employee);
    const courses=group(visibleRows,row=>row.key,row=>row.track?`${row.course} · ${row.track}`:row.course);
    const sectors=group(visibleRows.filter(row=>row.employeeId!=null),row=>row.sector,row=>row.sector);
    const header=['Origem','Trilha','Curso ou treinamento','Setor','Sistema','Carga horária (h)','Modalidade','Funcionário','Conclusão','Situação','Horas realizadas (h)'];
    const rows=visibleRows.map(row=>[row.source,row.track,row.course,row.sector,row.system,(row.durationMinutes/60).toFixed(2).replace('.',','),row.modality,row.employee,fmtDate(row.completedOn),row.status,(row.realizedMinutes/60).toFixed(2).replace('.',',')]);
    const decimal=value=>(value/60).toFixed(2).replace('.',',');
    const sections=[
      ['TOTAL POR FUNCIONÁRIO'],['Funcionário','Conclusões','Horas realizadas (h)'],
      ...people.map(row=>[row.label,row.completed,decimal(row.realizedMinutes)]),[],
      ['TOTAL POR CURSO'],['Curso / trilha','Origem','Carga horária do curso (h)','Conclusões','Horas realizadas (h)'],
      ...courses.map(row=>[row.label,row.source,decimal(row.durationMinutes),row.completed,decimal(row.realizedMinutes)]),[],
      ['TOTAL POR SETOR'],['Setor','Conclusões','Horas realizadas (h)'],
      ...sectors.map(row=>[row.label,row.completed,decimal(row.realizedMinutes)]),[],
      ['DETALHAMENTO'],header,...rows
    ];
    const csv='\uFEFF'+sections.map(row=>row.map(csvCell).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='spfly-carga-horaria-cursos.csv';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.SPFLY_HOURS={render,filter,exportCsv,printExtract};
  window.SPFLY_HOURS_TEST={buildRows,modality,isoDate};
})();
