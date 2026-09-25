(function () {
  'use strict';

  let client, access, currentUser, employees = [];
  let tracks = [], courses = [], enrollments = [], progress = [];
  let selectedTrack = null, selectedTab = 'courses', focusedEnrollment = null;
  let editingTrack = null, editingCourse = null, busy = false;
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const manager = () => access?.access_role === 'admin';
  const employeeRole = () => access?.access_role === 'usuario' && !!access?.employee_id && access?.allowed_pages?.includes('capacitation');
  const canUpload = () => employeeRole() && access?.editable_pages?.includes('capacitation');
  const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; };
  const date = key => { const [y,m,d] = String(key || '').split('-').map(Number); return new Date(y, m-1, d, 12); };
  const addDays = (key, days) => { const d = date(key); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const fmtDate = key => key ? new Intl.DateTimeFormat('pt-BR').format(date(key)) : '—';
  const fmtTime = value => value ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '—';
  const percent = (done, total) => total ? Math.round(done / total * 100) : 0;
  const employeeName = id => employees.find(person => String(person.id) === String(id))?.name || `Funcionário #${id}`;
  const employeeMat = id => employees.find(person => String(person.id) === String(id))?.mat || '';
  const trackCourses = id => courses.filter(course => course.track_id === id).sort((a,b) => a.sort_order-b.sort_order || a.name.localeCompare(b.name,'pt-BR'));
  const activeCourses = id => trackCourses(id).filter(course => course.active);
  const trackEnrollments = id => enrollments.filter(enrollment => enrollment.track_id === id);
  const courseProgress = (enrollmentId, courseId) => progress.find(item => item.enrollment_id === enrollmentId && item.course_id === courseId);
  const remaining = due => Math.round((date(due) - date(today())) / 86400000);
  const timeUsed = enrollment => {
    const total = Math.max(1, Math.round((date(enrollment.due_date)-date(enrollment.start_date))/86400000));
    const elapsed = Math.round((date(today())-date(enrollment.start_date))/86400000);
    return Math.max(0,Math.min(100,Math.round(elapsed/total*100)));
  };
  const deadline = enrollment => {
    const left = remaining(enrollment.due_date);
    if (left < 0) return `<span class="cap-due-alert">${Math.abs(left)} dia(s) em atraso</span>`;
    return left === 0 ? '<strong>Vence hoje</strong>' : `${left} dia(s) restante(s)`;
  };
  const notice = (id, text, error = false) => { const node = $(id); if (!node) return; node.textContent = text; node.className = text ? `cap-toast${error ? ' error' : ''}` : ''; };
  const empty = text => `<div class="cap-empty">${safe(text)}</div>`;
  const badge = (label, tone = 'gray') => `<span class="cap-badge cap-badge-${tone}">${safe(label)}</span>`;
  const bar = value => `<div class="cap-progress-line" role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"><span style="width:${value}%"></span></div>`;
  function enrollmentStats(enrollment) {
    const list = activeCourses(enrollment.track_id);
    const done = list.filter(course => courseProgress(enrollment.id, course.id)?.completed_at).length;
    const started = list.filter(course => { const p = courseProgress(enrollment.id, course.id); return p?.started_at && !p.completed_at; }).length;
    const overdue = remaining(enrollment.due_date) < 0 && done < list.length ? list.length - done : 0;
    const pct = percent(done, list.length);
    return { total:list.length, done, started, overdue, pct, pending:list.length-done,
      status: overdue ? 'Em atraso' : list.length && done === list.length ? 'Concluído' : started || done ? 'Em andamento' : 'Não iniciado' };
  }
  function courseState(enrollment, course) {
    const item = courseProgress(enrollment.id, course.id);
    if (item?.completed_at) return ['Concluído','green'];
    if (item?.certificate_path && item.validation_status !== 'rejected') return ['Aguardando validação','orange'];
    if (remaining(enrollment.due_date) < 0) return ['Em atraso','red'];
    if (item?.started_at) return ['Em andamento','orange'];
    return ['Não iniciado','gray'];
  }
  function certificateState(item) {
    if (!item?.certificate_path) return ['Pendente','gray'];
    if (item.validation_status === 'approved') return ['Aprovado','green'];
    if (item.validation_status === 'rejected') return ['Rejeitado','red'];
    return ['Aguardando validação','orange'];
  }
  async function load() {
    if (!client || !access) return;
    async function allRows(table) {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const {data,error} = await client.from(table).select('*').order('id').range(offset,offset+999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) return rows;
      }
    }
    [tracks,courses,enrollments,progress] = await Promise.all(
      ['cap_tracks','cap_courses','cap_enrollments','cap_progress'].map(allRows));
  }
  function configure(nextClient, nextAccess, nextUser, nextEmployees) {
    client = nextClient; access = nextAccess; currentUser = nextUser; employees = nextEmployees || [];
    if (employeeRole()) { employees = []; selectedTrack = null; focusedEnrollment = null; }
  }
  async function render() {
    if (!client || !access) return;
    const page = document.querySelector('.page.active')?.id;
    if (!['pageCapacitation','pageCapTrackDetail'].includes(page)) return;
    const target = page === 'pageCapacitation' ? $('capTrackGrid') : $('capTrackHero');
    target.innerHTML = empty('Carregando capacitações...');
    try { await load(); if (page === 'pageCapacitation') renderList(); else renderDetail(); }
    catch (error) { target.innerHTML = empty('Não foi possível carregar as capacitações. ' + error.message); }
  }
  function refresh() { render(); }
  function renderList() {
    const mine = employeeRole();
    $('capPageTitle').textContent = mine ? 'Minhas Capacitações' : 'Capacitação';
    $('capListTitle').textContent = mine ? 'Minhas Trilhas' : 'Trilhas de Capacitação';
    $('capListHint').textContent = mine ? 'Consulte seus cursos e envie certificados para conferência.' : 'Acompanhe cursos, prazos e certificados em um só lugar.';
    $('capNewTrackButton').hidden = !manager();
    const visible = tracks.filter(track => !mine || trackEnrollments(track.id).length);
    const eStats = enrollments.map(enrollmentStats);
    const uniquePeople = new Set(enrollments.map(item => item.employee_id));
    const values = [visible.length, uniquePeople.size, eStats.reduce((sum,s) => sum+s.done,0), eStats.reduce((sum,s) => sum+s.started,0), eStats.reduce((sum,s) => sum+s.overdue,0)];
    const labels = [mine?'Minhas trilhas':'Trilhas cadastradas',mine?'Inscrições':'Funcionários inscritos','Cursos concluídos','Em andamento','Em atraso'];
    const icons = ['🎓','♙','✓','◷','!'];
    $('capKpis').innerHTML = values.map((value,i) => `<div class="cap-kpi"><div class="cap-kpi-icon">${icons[i]}</div><div><div class="cap-kpi-value">${value}</div><div class="cap-kpi-label">${labels[i]}</div></div></div>`).join('');
    $('capTrackGrid').innerHTML = visible.length ? visible.map(track => {
      const participants = trackEnrollments(track.id), enrolledStats = participants.map(enrollmentStats);
      const completion = participants.length ? Math.round(enrolledStats.reduce((sum,s) => sum+s.pct,0)/participants.length) : 0;
      const mineEnrollment = mine ? participants[0] : null;
      const shownPct = mineEnrollment ? enrollmentStats(mineEnrollment).pct : completion;
      const days = mineEnrollment ? `<span>Prazo: ${fmtDate(mineEnrollment.due_date)}</span><span>${deadline(mineEnrollment)}</span>` : `<span>Prazo: ${track.duration_days} dias</span><span>${participants.length} funcionário(s)</span>`;
      const status = mineEnrollment && enrollmentStats(mineEnrollment).overdue ? badge('Em atraso','red') : badge(track.status,track.status==='Ativa'?'green':'gray');
      return `<button type="button" class="cap-track-card" data-cap-action="track" data-id="${safe(track.id)}"><div class="cap-card-head"><h3>${safe(track.name)}</h3>${status}</div><p>${safe(track.description || 'Sem descrição.')}</p><div class="cap-meta"><span>${safe(track.track_type)}</span><span>${trackCourses(track.id).filter(c=>c.active).length} curso(s)</span>${days}</div>${bar(shownPct)}<div class="cap-card-foot"><span>Progresso ${mine?'individual':'médio'}</span><strong>${shownPct}%</strong></div></button>`;
    }).join('') : empty(mine ? 'Você ainda não foi inscrito em uma trilha.' : 'Nenhuma trilha cadastrada. Crie a primeira trilha para começar.');
  }
  function choices(target, excludeEnrolled = false) {
    const enrolled = new Set(excludeEnrolled ? trackEnrollments(selectedTrack).map(item => String(item.employee_id)) : []);
    const list = employees.filter(person => person.status !== 'Inativo' && !enrolled.has(String(person.id))).sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
    $(target).innerHTML = list.length ? list.map(person => `<label data-search="${safe((person.name+' '+(person.mat||'')).toLocaleLowerCase('pt-BR'))}"><input type="checkbox" value="${safe(person.id)}"><span>${safe(person.name)}</span><small>${safe(person.mat||'')}</small></label>`).join('') : empty('Nenhum funcionário disponível. Cadastre um funcionário primeiro.');
  }
  function filterEmployees() {
    for (const [list,search] of [['capEmployeeChoices','capEmployeeSearch'],['capEnrollChoices','capEnrollSearch']]) {
      const value = $(search)?.value.trim().toLocaleLowerCase('pt-BR') || '';
      $(list)?.querySelectorAll('label[data-search]').forEach(item => { item.hidden = !item.dataset.search.includes(value); });
    }
  }
  function newTrack() {
    if (!manager()) return;
    editingTrack = null; $('capTrackForm').reset(); $('capTrackFormTitle').textContent = 'Nova Trilha';
    $('capTrackStart').value = today(); $('capTrackDays').value = 30; $('capTrackAudience').hidden = false;
    $('capEmployeeSearch').value = ''; choices('capEmployeeChoices'); notice('capTrackFormMessage',''); showPage('pageCapTrackForm');
  }
  function editTrack(id) {
    if (!manager()) return;
    const item = tracks.find(track => track.id === id); if (!item) return;
    editingTrack = id; $('capTrackFormTitle').textContent = 'Editar Trilha';
    $('capTrackName').value = item.name; $('capTrackDescription').value = item.description;
    $('capTrackType').value = item.track_type; $('capTrackDays').value = item.duration_days;
    $('capTrackStart').value = item.start_date; $('capTrackStatus').value = item.status;
    $('capTrackAudience').hidden = true; notice('capTrackFormMessage',''); showPage('pageCapTrackForm');
  }
  function cancelTrackForm() { if (editingTrack) openTrack(editingTrack); else showPage('pageCapacitation'); }
  async function saveTrack(event) {
    event.preventDefault(); if (!manager() || busy) return;
    const days = Number($('capTrackDays').value);
    if (!Number.isInteger(days) || days < 1 || days > 3650) { notice('capTrackFormMessage','Informe um prazo entre 1 e 3650 dias.',true); return; }
    const fields = { name:$('capTrackName').value.trim(), description:$('capTrackDescription').value.trim(),
      track_type:$('capTrackType').value, duration_days:days, start_date:$('capTrackStart').value,
      status:$('capTrackStatus').value, updated_at:new Date().toISOString() };
    const selected = [...$('capEmployeeChoices').querySelectorAll('input:checked')].map(input => Number(input.value));
    busy = true; notice('capTrackFormMessage','Salvando trilha...');
    try {
      const query = editingTrack ? client.from('cap_tracks').update(fields).eq('id',editingTrack) : client.from('cap_tracks').insert(fields);
      const { data, error } = await query.select('id').single(); if (error) throw error;
      const id = data.id;
      if (!editingTrack && selected.length) {
        const rows = selected.map(employee_id => ({track_id:id, employee_id, start_date:fields.start_date,
          due_date:addDays(fields.start_date,days), enrolled_by:currentUser.id}));
        const result = await client.from('cap_enrollments').insert(rows); if (result.error) throw result.error;
      }
      selectedTrack = id; selectedTab = 'courses'; focusedEnrollment = null; editingTrack = null;
      closeCourseEditor(); closeEnrollEditor(); await load(); showPage('pageCapTrackDetail');
    } catch (error) { notice('capTrackFormMessage','Não foi possível salvar: '+error.message,true); }
    finally { busy = false; }
  }
  function openTrack(id) { selectedTrack = id; selectedTab = 'courses'; focusedEnrollment = null; closeCourseEditor(); closeEnrollEditor(); showPage('pageCapTrackDetail'); }
  function selectTab(tab) { if (!manager() && tab === 'employees') return; selectedTab = tab; renderDetail(); }
  function renderDetail() {
    const track = tracks.find(item => item.id === selectedTrack);
    if (!track) { $('capTrackHero').innerHTML = empty('Trilha não encontrada.'); return; }
    const participants = trackEnrollments(track.id);
    const mine = employeeRole(), enrollment = mine ? participants[0] : null;
    const stats = enrollment ? enrollmentStats(enrollment) : null;
    const mean = participants.length ? Math.round(participants.reduce((sum,item) => sum+enrollmentStats(item).pct,0)/participants.length) : 0;
    $('capTrackActions').innerHTML = manager() ? `<button type="button" class="btn btn-secondary" data-cap-action="edit-track" data-id="${safe(track.id)}">Editar Trilha</button>` : '';
    $('capDetailTabs').hidden = !manager();
    $('capDetailTabs').querySelectorAll('button').forEach(button => button.classList.toggle('active',button.dataset.capTab === selectedTab));
    $('capDetailCourses').hidden = selectedTab !== 'courses'; $('capDetailEmployees').hidden = selectedTab !== 'employees';
    $('capTrackHero').innerHTML = `${badge(track.status,track.status==='Ativa'?'green':'gray')} <span class="muted">${safe(track.track_type)}</span><h1>${safe(track.name)}</h1><p>${safe(track.description || 'Sem descrição.')}</p>
      ${enrollment ? `<div class="cap-status-line"><strong>Seu prazo: ${fmtDate(enrollment.due_date)}</strong>${deadline(enrollment)}${badge(stats.status,stats.overdue?'red':stats.pct===100?'green':'orange')}</div>${bar(stats.pct)}<div class="cap-card-foot">Prazo utilizado <strong>${timeUsed(enrollment)}%</strong></div>` : ''}
      <div class="cap-hero-stats"><div><strong>${activeCourses(track.id).length}</strong><span>Cursos ativos</span></div><div><strong>${track.duration_days} dias</strong><span>Prazo da trilha</span></div><div><strong>${enrollment?stats.done:participants.length}</strong><span>${enrollment?'Cursos concluídos':'Funcionários inscritos'}</span></div><div><strong>${enrollment?stats.pct:mean}%</strong><span>${enrollment?'Seu progresso':'Progresso médio'}</span></div></div>`;
    if (selectedTab === 'courses') renderCourses(track,enrollment);
    else renderEmployees(track);
  }
  function renderCourses(track, enrollment, reviewEnrollment = null) {
    const list = trackCourses(track.id).filter(course => manager() || course.active || courseProgress(enrollment?.id,course.id)?.completed_at);
    const viewed = reviewEnrollment || enrollment;
    $('capDetailCourses').innerHTML = `<div class="cap-section-head"><div><h2>Cursos da Trilha</h2><p class="muted">${manager()?'Links externos, ordem, conclusão e certificados.':'Acesse o curso e envie o certificado para validação.'}</p></div>${manager()?'<button type="button" class="btn btn-primary" data-cap-action="new-course">+ Adicionar Curso</button>':''}</div>
      <div class="cap-course-list">${list.length ? list.map(course => {
        const item = viewed ? courseProgress(viewed.id,course.id) : null;
        const state = viewed ? courseState(viewed,course) : null;
        const certificate = course.certificate_required ? certificateState(item) : null;
        const url = validUrl(course.external_url);
        return `<article class="cap-course"><div class="cap-course-head"><div><h3><span class="cap-course-order">${course.sort_order}.</span>${safe(course.name)}</h3><p>${safe(course.description || 'Sem descrição.')}</p></div>${state?badge(state[0],state[1]):badge(course.active?'Ativo':'Inativo',course.active?'green':'gray')}</div>
          <div class="cap-course-meta"><span>◷ ${course.duration_minutes} min</span><span>Certificado ${course.certificate_required?'obrigatório':'opcional'}</span>${!course.active?'<span>Curso inativo</span>':''}${item?.completed_at?`<span>Concluído em ${fmtTime(item.completed_at)}</span>`:''}</div>
          ${certificate?`<div class="cap-status-line">Certificado: ${badge(certificate[0],certificate[1])}${item?.certificate_name?`<span class="cap-certificate-name">${safe(item.certificate_name)} · ${fmtTime(item.certificate_uploaded_at)}</span>`:''}${item?.validation_status==='rejected'?`<span class="cap-due-alert">Motivo: ${safe(item.rejection_reason||'Não informado')}</span>`:''}</div>`:''}
          <div class="cap-course-actions">${url && !reviewEnrollment?`<a class="btn btn-secondary" href="${safe(url)}" target="_blank" rel="noopener noreferrer">${manager()?'Abrir link ↗':'Acessar curso ↗'}</a>`:''}
            ${canUpload() && enrollment && track.status==='Ativa' && course.active && course.certificate_required && (!item?.certificate_path || item.validation_status==='rejected')?`<label class="btn btn-secondary">${item?.certificate_path?'Enviar novo certificado':'Anexar certificado'} <input class="cap-file-input" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" data-cap-upload="${safe(course.id)}"></label>`:''}
            ${item?.certificate_path?`<button type="button" class="btn btn-secondary" data-cap-action="certificate" data-id="${safe(item.id)}">Ver certificado</button>`:''}
            ${manager()?`<button type="button" class="btn btn-secondary" data-cap-action="edit-course" data-id="${safe(course.id)}">Editar Curso</button>`:''}</div></article>`;
      }).join('') : empty('Esta trilha ainda não tem cursos.')} </div>`;
  }
  function validUrl(value) { try { const parsed = new URL(value); return ['http:','https:'].includes(parsed.protocol) ? parsed.href : ''; } catch { return ''; } }
  function showCourseEditor(id = null) {
    if (!manager()) return;
    editingCourse = id; $('capCourseForm').reset();
    const item = courses.find(course => course.id === id);
    $('capCourseFormTitle').textContent = item ? 'Editar Curso' : 'Adicionar Curso';
    $('capCourseName').value = item?.name || ''; $('capCourseDescription').value = item?.description || '';
    $('capCourseUrl').value = item?.external_url || ''; $('capCourseMinutes').value = item?.duration_minutes || 40;
    $('capCourseOrder').value = item?.sort_order || trackCourses(selectedTrack).length+1;
    $('capCourseCertificate').value = String(item?.certificate_required || false);
    $('capCourseActive').value = String(item?.active ?? true);
    notice('capCourseFormMessage',''); $('capCourseEditor').hidden = false; $('capCourseEditor').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function closeCourseEditor() { $('capCourseEditor').hidden = true; editingCourse = null; }
  async function saveCourse(event) {
    event.preventDefault(); if (!manager() || busy || !selectedTrack) return;
    const url = validUrl($('capCourseUrl').value.trim());
    if (!url) { notice('capCourseFormMessage','Use um link http ou https válido.',true); return; }
    const fields = {name:$('capCourseName').value.trim(),description:$('capCourseDescription').value.trim(),external_url:url,
      duration_minutes:Number($('capCourseMinutes').value),sort_order:Number($('capCourseOrder').value),
      certificate_required:$('capCourseCertificate').value==='true',active:$('capCourseActive').value==='true',updated_at:new Date().toISOString()};
    if (!Number.isInteger(fields.duration_minutes) || fields.duration_minutes < 1 || !Number.isInteger(fields.sort_order) || fields.sort_order < 1) {
      notice('capCourseFormMessage','Revise a carga horária e a ordem do curso.',true); return;
    }
    busy = true; notice('capCourseFormMessage','Salvando curso...');
    try {
      const { error } = editingCourse ? await client.from('cap_courses').update(fields).eq('id',editingCourse)
        : await client.from('cap_courses').insert({...fields,track_id:selectedTrack});
      if (error) throw error; closeCourseEditor(); await load(); renderDetail();
    } catch (error) { notice('capCourseFormMessage','Não foi possível salvar: '+error.message,true); }
    finally { busy = false; }
  }
  function showEnrollEditor() {
    if (!manager()) return; $('capEnrollSearch').value = ''; choices('capEnrollChoices',true);
    $('capEnrollEditor').hidden = false; $('capEnrollEditor').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function closeEnrollEditor() { $('capEnrollEditor').hidden = true; }
  async function saveEnrollments() {
    if (!manager() || busy || !selectedTrack) return;
    const ids = [...$('capEnrollChoices').querySelectorAll('input:checked')].map(input => Number(input.value));
    if (!ids.length) { alert('Selecione ao menos um funcionário.'); return; }
    const track = tracks.find(item => item.id === selectedTrack); if (!track) return;
    busy = true;
    try {
      const rows = ids.map(employee_id => ({track_id:track.id,employee_id,start_date:track.start_date,
        due_date:addDays(track.start_date,track.duration_days),enrolled_by:currentUser.id}));
      const { error } = await client.from('cap_enrollments').insert(rows); if (error) throw error;
      closeEnrollEditor(); await load(); renderDetail();
    } catch (error) { alert('Não foi possível inscrever: '+error.message); }
    finally { busy = false; }
  }
  function renderEmployees(track) {
    const list = trackEnrollments(track.id).sort((a,b) => employeeName(a.employee_id).localeCompare(employeeName(b.employee_id),'pt-BR'));
    $('capDetailEmployees').innerHTML = `<div class="cap-section-head"><div><h2>Funcionários</h2><p class="muted">Progresso individual, prazos e certificados.</p></div><button type="button" class="btn btn-primary" data-cap-action="enroll">+ Inscrever funcionários</button></div>
      ${list.length ? `<div class="cap-people-table card"><table><thead><tr><th>Funcionário</th><th>Progresso</th><th>Concluídos</th><th>Pendentes</th><th>Prazo</th><th>Status</th><th></th></tr></thead><tbody>${list.map(enrollment => {
        const stats = enrollmentStats(enrollment);
        return `<tr><td><strong>${safe(employeeName(enrollment.employee_id))}</strong><br><span class="muted">${safe(employeeMat(enrollment.employee_id))}</span></td><td>${bar(stats.pct)} ${stats.pct}%</td><td>${stats.done}</td><td>${stats.pending}${stats.overdue?` · <span class="cap-due-alert">${stats.overdue} atrasado(s)</span>`:''}</td><td>${fmtDate(enrollment.due_date)}</td><td>${badge(stats.status,stats.overdue?'red':stats.pct===100?'green':'orange')}</td><td><button type="button" class="btn btn-secondary" data-cap-action="employee" data-id="${safe(enrollment.id)}">Ver evolução</button></td></tr>`;
      }).join('')}</tbody></table></div>` : empty('Nenhum funcionário inscrito nesta trilha.')}
      <div id="capEmployeeFocus" class="cap-employee-focus"></div>`;
    if (focusedEnrollment) renderEmployeeFocus();
  }
  function renderEmployeeFocus() {
    const enrollment = enrollments.find(item => item.id === focusedEnrollment && item.track_id === selectedTrack);
    const node = $('capEmployeeFocus'); if (!node || !enrollment) return;
    const stats = enrollmentStats(enrollment);
    node.innerHTML = `<div class="card"><h3>${safe(employeeName(enrollment.employee_id))}</h3><p class="muted">Início: ${fmtDate(enrollment.start_date)} · Prazo: ${fmtDate(enrollment.due_date)} · ${deadline(enrollment)} · Prazo utilizado: ${timeUsed(enrollment)}%</p><p>Concluídos ${stats.done} de ${stats.total} · Pendentes ${stats.pending} · Certificados enviados ${activeCourses(selectedTrack).filter(course=>courseProgress(enrollment.id,course.id)?.certificate_path).length}</p>${bar(stats.pct)}<div class="cap-course-list">${trackCourses(selectedTrack).map(course => {
      const item = courseProgress(enrollment.id,course.id), state = courseState(enrollment,course);
      const cert = course.certificate_required ? certificateState(item) : null;
      return `<div class="cap-course"><div class="cap-course-head"><strong>${safe(course.name)}</strong>${badge(state[0],state[1])}</div><div class="cap-status-line">${course.active?'Ativo':'Inativo'} · ${item?.completed_at?'Concluído em '+fmtTime(item.completed_at):'Pendente'}${cert?` · Certificado ${badge(cert[0],cert[1])}`:''}</div>${item?.certificate_name?`<div class="cap-certificate-name">${safe(item.certificate_name)} · ${fmtTime(item.certificate_uploaded_at)}</div>`:''}${item?.certificate_path?`<button type="button" class="btn btn-secondary" data-cap-action="certificate" data-id="${safe(item.id)}">Ver certificado</button>`:''}${item?.certificate_path && item.validation_status==='pending'?`<button type="button" class="btn btn-primary" data-cap-action="approve" data-id="${safe(item.id)}" ${item.certificate_viewed_at?'':'disabled title="Abra o certificado antes de aprovar"'}>Aprovar certificado</button><button type="button" class="btn btn-danger" data-cap-action="reject" data-id="${safe(item.id)}">Rejeitar</button>`:''}${!course.certificate_required && !item?.completed_at?`<button type="button" class="btn btn-primary" data-cap-action="complete" data-id="${safe(course.id)}">Confirmar conclusão</button>`:''}</div>`;
    }).join('')}</div></div>`;
  }
  async function setState(courseId, nextState) {
    const enrollment = enrollments.find(item => item.id === focusedEnrollment); if (!manager() || !enrollment || busy) return;
    busy = true;
    try { const { error } = await client.rpc('cap_set_course_state',{target_enrollment:enrollment.id,target_course:courseId,next_state:nextState});
      if (error) throw error; await load(); renderDetail(); renderList(); }
    catch (error) { alert('Não foi possível atualizar o curso: '+error.message); }
    finally { busy = false; }
  }
  async function uploadCertificate(courseId, file) {
    if (!canUpload() || !file || busy) return;
    const enrollment = trackEnrollments(selectedTrack)[0]; if (!enrollment) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const types = {pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'};
    if (!types[ext] || file.type && file.type !== types[ext] || file.size > 10*1024*1024 || file.size === 0) {
      alert('Envie PDF, JPG, JPEG ou PNG de até 10 MB.'); return;
    }
    const signature = new Uint8Array(await file.slice(0,8).arrayBuffer());
    const validSignature = ext === 'pdf' ? String.fromCharCode(...signature.slice(0,5)) === '%PDF-'
      : ext === 'png' ? [137,80,78,71,13,10,26,10].every((byte,i) => signature[i] === byte)
      : signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
    if (!validSignature) { alert('O conteúdo do arquivo não corresponde ao formato informado.'); return; }
    if (!confirm('Confirma o envio deste certificado para conferência do administrador? Enquanto estiver pendente ou após aprovação, você não poderá substituí-lo.')) return;
    busy = true;
    try {
      const path = `${enrollment.id}/${courseId}/${crypto.randomUUID()}.${ext}`;
      const uploaded = await client.storage.from('cap-certificates').upload(path,file,{contentType:types[ext],upsert:false});
      if (uploaded.error) throw uploaded.error;
      const attached = await client.rpc('cap_attach_certificate',{target_enrollment:enrollment.id,target_course:courseId,object_path:path,file_name:file.name.slice(0,200)});
      if (attached.error) throw attached.error;
      await load(); renderDetail();
    } catch (error) { alert('Não foi possível anexar o certificado: '+error.message); }
    finally { busy = false; }
  }
  async function reviewCertificate(progressId, decision) {
    if (!manager() || busy) return;
    const item = progress.find(row => row.id === progressId);
    if (!item?.certificate_path || item.validation_status !== 'pending') return;
    const reason = decision === 'rejected' ? prompt('Explique o que precisa ser corrigido no certificado:') : null;
    if (decision === 'rejected' && (reason === null || reason.trim().length < 3)) return;
    if (decision === 'approved' && !confirm('Você conferiu o documento e confirma que ele pertence ao funcionário e ao curso? Após aprovar, ele ficará bloqueado para alterações.')) return;
    busy = true;
    try {
      const {error} = await client.rpc('cap_review_certificate',{target_progress:progressId,decision,reason});
      if (error) throw error;
      await load(); renderDetail();
    } catch (error) { alert('Não foi possível validar o certificado: '+error.message); }
    finally { busy = false; }
  }
  async function viewCertificate(progressId) {
    const item = progress.find(row => row.id === progressId);
    if (!item?.certificate_path) return;
    const tab = window.open('about:blank','_blank');
    try {
      const {data,error} = await client.storage.from('cap-certificates').createSignedUrl(item.certificate_path,60);
      if (error) throw error;
      if (manager() && !item.certificate_viewed_at) await client.rpc('cap_mark_certificate_viewed',{target_progress:item.id});
      if (tab) tab.location.href = data.signedUrl;
      else window.location.href = data.signedUrl;
      await load(); if (document.querySelector('.page.active')?.id === 'pageCapTrackDetail') renderDetail();
    } catch (error) { if (tab) tab.close(); alert('Não foi possível abrir o certificado: '+error.message); }
  }
  function delegate(event) {
    const button = event.target.closest('[data-cap-action]'); if (!button) return;
    const {capAction:action,id} = button.dataset;
    if (action==='track') openTrack(id);
    if (action==='edit-track') editTrack(id);
    if (action==='new-course') showCourseEditor();
    if (action==='edit-course') showCourseEditor(id);
    if (action==='enroll') showEnrollEditor();
    if (action==='employee') { focusedEnrollment=id; renderEmployeeFocus(); $('capEmployeeFocus').scrollIntoView({behavior:'smooth'}); }
    if (action==='complete') setState(id,'completed');
    if (action==='approve') reviewCertificate(id,'approved');
    if (action==='reject') reviewCertificate(id,'rejected');
    if (action==='certificate') viewCertificate(id);
  }
  $('capTrackForm').addEventListener('submit',saveTrack);
  $('capCourseForm').addEventListener('submit',saveCourse);
  $('pageCapacitation').addEventListener('click',delegate);
  $('pageCapTrackDetail').addEventListener('click',delegate);
  $('pageCapTrackDetail').addEventListener('change',event => {
    const input = event.target.closest('[data-cap-upload]');
    if (input) uploadCertificate(input.dataset.capUpload,input.files?.[0]);
  });
  window.SPFLY_CAP = {configure,render,refresh,newTrack,filterEmployees,cancelTrackForm,selectTab,closeCourseEditor,closeEnrollEditor,saveEnrollments};
  window.SPFLY_CAP_TEST = {addDays,remaining,percent,validUrl};
})();
