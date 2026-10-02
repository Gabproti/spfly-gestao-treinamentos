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

  function buildRows(people, trainings, tracks, courses, enrollments, progress) {
    const personById = new Map(people.map(person => [String(person.id),person]));
    const trackById = new Map(tracks.filter(track => !track.deleted_at).map(track => [track.id,track]));
    const progressByPair = new Map(progress.map(item => [`${item.enrollment_id}:${item.course_id}`,item]));
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
        const progressRow = enrollment ? progressByPair.get(`${enrollment.id}:${course.id}`) : null;
        if (!course.active && !progressRow?.completed_at) continue;
        const person = enrollment ? personById.get(String(enrollment.employee_id)) : null;
        const duration = minutes(course.duration_minutes);
        const completed = !!progressRow?.completed_at;
        rows.push({key:`cap:${course.id}`,source:'Capacitação',track:track.name,course:course.name,
          modality:modality(course.modality || track.modality),employeeId:enrollment?.employee_id ?? null,
          employee:person?.name || (enrollment ? `Funcionário #${enrollment.employee_id}` : ''),
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
          modality:modality(training.modality),employeeId,
          employee:person?.name || (employeeId == null ? '' : `Funcionário #${employeeId}`),
          durationMinutes:duration,realizedMinutes:completed&&employeeId!=null?duration:0,
          completedOn:completed?isoDate(training.deliveredAt || training.date):'',status:completed?'Concluído':'Pendente'});
      }
    }
    return rows.sort((a,b) => (b.completedOn || '').localeCompare(a.completedOn || '') || a.course.localeCompare(b.course,'pt-BR') || a.employee.localeCompare(b.employee,'pt-BR'));
  }

  async function fetchAll(table) {
    const rows = [], client = window.SPFLY_AUTH.getClient();
    for (let offset = 0; ; offset += 1000) {
      const {data,error} = await client.from(table).select('*').order('id').range(offset,offset+999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) return rows;
    }
  }
  async function render(people,trainings) {
    const current = ++revision;
    $('hoursMessage').textContent = 'Carregando carga horária...';
    $('hoursSummary').replaceChildren();$('hoursByEmployee').replaceChildren();$('hoursByCourse').replaceChildren();$('hoursDetails').replaceChildren();
    const select=$('hoursEmployee'),previous=select.value;
    select.innerHTML='<option value="">Todos os funcionários</option>'+people.slice().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(person=>`<option value="${safe(person.id)}">${safe(person.name)}</option>`).join('');
    select.value=previous;
    try {
      const [tracks,courses,enrollments,progress]=await Promise.all(['cap_tracks','cap_courses','cap_enrollments','cap_progress'].map(fetchAll));
      if (current!==revision) return;
      allRows=buildRows(people,trainings,tracks,courses,enrollments,progress);
      filter();
    } catch (error) { if(current===revision)$('hoursMessage').textContent='Não foi possível carregar o relatório: '+error.message; }
  }
  function filter() {
    const term=fold($('hoursSearch').value.trim()),person=$('hoursEmployee').value,mode=$('hoursModality').value,
      status=$('hoursStatus').value,from=$('hoursFrom').value,to=$('hoursTo').value;
    visibleRows=allRows.filter(row => (!term || fold(`${row.course} ${row.track}`).includes(term))
      && (!person || String(row.employeeId)===person) && (!mode || row.modality===mode)
      && (!status || row.status===status) && (!from && !to || !!row.completedOn && (!from || row.completedOn>=from) && (!to || row.completedOn<=to)));
    $('hoursMessage').textContent=visibleRows.length?`${visibleRows.length} registro(s) encontrado(s). Horas realizadas contam somente conclusões com funcionário vinculado.`:'Nenhum registro encontrado para os filtros.';
    const completed=visibleRows.filter(row=>row.realizedMinutes>0);
    const total=completed.reduce((sum,row)=>sum+row.realizedMinutes,0);
    $('hoursSummary').innerHTML=`<div class="cards" style="margin:16px 0">${card('Horas realizadas',hours(total))}${card('Conclusões',completed.length)}${card('Cursos/treinamentos',new Set(visibleRows.map(row=>row.key)).size)}</div>`;
    const byEmployee=group(visibleRows.filter(row=>row.employee),row=>String(row.employeeId),row=>row.employee);
    const byCourse=group(visibleRows,row=>row.key,row=>row.track?`${row.course} · ${row.track}`:row.course);
    $('hoursByEmployee').innerHTML=summaryTable('Total por funcionário','Funcionário',byEmployee);
    $('hoursByCourse').innerHTML=summaryTable('Total por curso','Curso / origem',byCourse,true);
    $('hoursDetails').innerHTML=`<h3>Detalhamento</h3><div class="table-scroll"><table><thead><tr><th>Origem / trilha</th><th>Curso</th><th>Carga horária</th><th>Modalidade</th><th>Funcionário</th><th>Conclusão</th><th>Situação</th><th>Horas realizadas</th></tr></thead><tbody>${visibleRows.map(row=>`<tr><td>${safe(row.track||row.source)}</td><td>${safe(row.course)}</td><td>${hours(row.durationMinutes)}</td><td>${safe(row.modality)}</td><td>${safe(row.employee||'—')}</td><td>${fmtDate(row.completedOn)}</td><td>${safe(row.status)}</td><td>${hours(row.realizedMinutes)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">Nenhum registro.</td></tr>'}</tbody></table></div>`;
  }
  function card(label,value){return `<div class="card kpi"><div><div class="num">${safe(value)}</div><div class="label">${safe(label)}</div></div></div>`;}
  function group(rows,keyOf,labelOf){
    const groups=new Map();
    for(const row of rows){const key=keyOf(row);if(!groups.has(key))groups.set(key,{label:labelOf(row),source:row.source,durationMinutes:row.durationMinutes,realizedMinutes:0,completed:0});
      const group=groups.get(key);group.realizedMinutes+=row.realizedMinutes;if(row.realizedMinutes>0)group.completed++;}
    return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'));
  }
  function summaryTable(title,label,rows,course=false){return `<h3>${title}</h3><div class="table-scroll"><table><thead><tr><th>${label}</th>${course?'<th>Carga horária do curso</th>':''}<th>Conclusões</th><th>Horas realizadas</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${safe(row.label)}${course?` <span class="muted">· ${safe(row.source)}</span>`:''}</td>${course?`<td>${hours(row.durationMinutes)}</td>`:''}<td>${row.completed}</td><td>${hours(row.realizedMinutes)}</td></tr>`).join('')||`<tr><td colspan="${course?4:3}" class="empty">Nenhum registro.</td></tr>`}</tbody></table></div>`;}
  function csvCell(value){const text=String(value??'');const guarded=/^[=+@\-\t\r]/.test(text)?`'${text}`:text;return `"${guarded.replace(/"/g,'""')}"`;}
  function exportCsv(){
    if(!visibleRows.length){alert('Não há dados para exportar.');return;}
    const people=group(visibleRows.filter(row=>row.employee),row=>String(row.employeeId),row=>row.employee);
    const courses=group(visibleRows,row=>row.key,row=>row.track?`${row.course} · ${row.track}`:row.course);
    const header=['Origem','Trilha','Curso','Carga horária (h)','Modalidade','Funcionário','Conclusão','Situação','Horas realizadas (h)'];
    const rows=visibleRows.map(row=>[row.source,row.track,row.course,(row.durationMinutes/60).toFixed(2).replace('.',','),row.modality,row.employee,fmtDate(row.completedOn),row.status,(row.realizedMinutes/60).toFixed(2).replace('.',',')]);
    const decimal=value=>(value/60).toFixed(2).replace('.',',');
    const sections=[
      ['TOTAL POR FUNCIONÁRIO'],['Funcionário','Conclusões','Horas realizadas (h)'],
      ...people.map(row=>[row.label,row.completed,decimal(row.realizedMinutes)]),[],
      ['TOTAL POR CURSO'],['Curso / trilha','Origem','Carga horária do curso (h)','Conclusões','Horas realizadas (h)'],
      ...courses.map(row=>[row.label,row.source,decimal(row.durationMinutes),row.completed,decimal(row.realizedMinutes)]),[],
      ['DETALHAMENTO'],header,...rows
    ];
    const csv='\uFEFF'+sections.map(row=>row.map(csvCell).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='spfly-carga-horaria-cursos.csv';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.SPFLY_HOURS={render,filter,exportCsv};
  window.SPFLY_HOURS_TEST={buildRows,modality,isoDate};
})();
