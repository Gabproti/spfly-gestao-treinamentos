(function () {
  'use strict';

  let client, access, currentUser, employees = [], sectors = [];
  let tracks = [], courses = [], enrollments = [], progress = [];
  let selectedTrack = null, selectedTab = 'courses', focusedEnrollment = null;
  let editingTrack = null, editingCourse = null, busy = false, loadRevision = 0, previewRevision = 0, previewPath = null, previewName = '';
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
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
  const trackSectors = track => Array.isArray(track?.sectors) ? track.sectors : (track?.sector ? [track.sector] : []);
  const sectorNames = () => [...new Set([...sectors,...employees.map(person => person.sector),...tracks.flatMap(trackSectors)].map(value => String(value || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'pt-BR'));
  function fillSectorSelect(id, selected = '') {
    const names = sectorNames();
    if (selected && !names.includes(selected)) names.push(selected);
    const select = $(id);
    select.innerHTML = `<option value="">Todos os setores</option>${names.sort((a,b) => a.localeCompare(b,'pt-BR')).map(sector => `<option value="${safe(sector)}">${safe(sector)}</option>`).join('')}`;
    select.value = selected;
  }
  function fillTrackSectorChoices(selected = []) {
    const names = [...new Set([...sectorNames(),...selected])].sort((a,b) => a.localeCompare(b,'pt-BR'));
    $('capTrackSectors').innerHTML = `<label><input type="checkbox" value="" ${selected.length ? '' : 'checked'}> Todos os setores</label>${names.map(name => `<label><input type="checkbox" value="${safe(name)}" ${selected.includes(name) ? 'checked' : ''}> ${safe(name)}</label>`).join('')}`;
  }
  const chosenTrackSectors = () => [...$('capTrackSectors').querySelectorAll('input:checked')].map(input => input.value).filter(Boolean);
  const sectorLabel = track => trackSectors(track).join(', ') || 'Todos os setores';
  const certificateMode = track => track?.certificate_mode || 'per_course';
  const modalityLabel = item => item?.modality || 'Não informada';
  const fileViewLabel = path => /\.pdf$/i.test(path || '') ? 'Visualizar PDF' : 'Ver certificado';
  const sequenceLabel = track => track?.sequence_name ? `${track.sequence_name} · ${track.sequence_order || 1}ª etapa` : '';
  const trackCertificateState = enrollment => certificateState(enrollment?.track_certificate_path ? {
    certificate_path:enrollment.track_certificate_path,validation_status:enrollment.track_validation_status
  } : null);
  const statusTone = status => status === 'Concluído' ? 'green' : status === 'Em atraso' || status === 'Rejeitado' ? 'red' : 'orange';
  const trackCourses = id => courses.filter(course => course.track_id === id).sort((a,b) => a.sort_order-b.sort_order || a.name.localeCompare(b.name,'pt-BR'));
  const activeCourses = id => trackCourses(id).filter(course => course.active);
  const trackEnrollments = id => enrollments.filter(enrollment => enrollment.track_id === id && !enrollment.removed_at);
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
    const track = tracks.find(item => item.id === enrollment.track_id);
    const needsFinal = certificateMode(track) === 'after_all' && list.length && done === list.length;
    const finalState = needsFinal ? trackCertificateState(enrollment)[0] : '';
    return { total:list.length, done, started, overdue, pct, pending:list.length-done,
      status: overdue ? 'Em atraso' : needsFinal ? (finalState === 'Concluído' ? 'Concluído' : finalState === 'Pendente' ? 'Aguardando certificado' : finalState) : list.length && done === list.length ? 'Concluído' : started || done ? 'Em andamento' : 'Não iniciado' };
  }
  function courseState(enrollment, course) {
    const item = courseProgress(enrollment.id, course.id);
    if (item?.completed_at) return ['Concluído','green'];
    if (item?.certificate_path && item.validation_status !== 'rejected') return ['Certificado anexado','orange'];
    if (item?.course_finished_at && course.certificate_required) return ['Aguardando certificado','orange'];
    if (remaining(enrollment.due_date) < 0) return ['Em atraso','red'];
    if (item?.started_at) return ['Em andamento','orange'];
    return ['Não iniciado','gray'];
  }
  function certificateState(item) {
    if (!item?.certificate_path) return ['Pendente','gray'];
    if (item.validation_status === 'approved') return ['Concluído','green'];
    if (item.validation_status === 'rejected') return ['Rejeitado','red'];
    return ['Certificado anexado','orange'];
  }
  function certificateSummary(enrollment) {
    const track = tracks.find(item => item.id === enrollment.track_id);
    if (certificateMode(track) === 'after_all') {
      const state = trackCertificateState(enrollment);
      return badge(state[0],state[1]);
    }
    const required = activeCourses(enrollment.track_id).filter(course => course.certificate_required);
    if (!required.length) return badge('Não exigido','gray');
    const states = required.map(course => certificateState(courseProgress(enrollment.id,course.id))[0]);
    const completed = states.filter(state => state === 'Concluído').length;
    const attached = states.filter(state => state === 'Certificado anexado').length;
    const rejected = states.filter(state => state === 'Rejeitado').length;
    if (completed === required.length) return badge('Concluído','green');
    const pending = required.length-completed-attached-rejected;
    const labels = [completed?`${completed} concluído(s)`:null,attached?`${attached} anexado(s)`:null,pending?`${pending} pendente(s)`:null,rejected?`${rejected} rejeitado(s)`:null].filter(Boolean);
    return badge(labels.join(' · '),rejected?'red':attached||completed?'orange':'gray');
  }
  async function load() {
    if (!client || !access) return;
    const revision = ++loadRevision;
    async function allRows(table) {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const {data,error} = await client.from(table).select('*').order('id').range(offset,offset+999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) return rows;
      }
    }
    const rows = await Promise.all(['cap_tracks','cap_courses','cap_enrollments','cap_progress'].map(allRows));
    if (revision !== loadRevision) return false;
    [tracks,courses,enrollments,progress] = rows;
    return true;
  }
  function configure(nextClient, nextAccess, nextUser, nextEmployees) {
    loadRevision++;
    client = nextClient; access = nextAccess; currentUser = nextUser; employees = nextEmployees || [];
    if (employeeRole()) { employees = []; selectedTrack = null; focusedEnrollment = null; }
  }
  async function render() {
    if (!client || !access) return;
    const page = document.querySelector('.page.active')?.id;
    if (!['pageCapacitation','pageCapTrackDetail'].includes(page)) return;
    const target = page === 'pageCapacitation' ? $('capTrackGrid') : $('capTrackHero');
    target.innerHTML = empty('Carregando capacitações...');
    try { if (!await load()) return; if (page === 'pageCapacitation') renderList(); else renderDetail(); }
    catch (error) { target.innerHTML = empty('Não foi possível carregar as capacitações. ' + error.message); }
  }
  function refresh() { render(); }
  function renderList() {
    const mine = employeeRole();
    $('capPageTitle').textContent = mine ? 'Minhas Capacitações' : 'Capacitação';
    $('capListTitle').textContent = mine ? 'Minhas Trilhas' : 'Trilhas de Capacitação';
    $('capListHint').textContent = mine ? 'Consulte seus cursos e envie certificados para conferência.' : 'Acompanhe cursos, prazos e certificados em um só lugar.';
    $('capNewTrackButton').hidden = !manager();
    const sectorFilter = $('capSectorFilter');
    fillSectorSelect('capSectorFilter',sectorFilter.value);
    sectorFilter.hidden = mine;
    const selectedSector = mine ? '' : sectorFilter.value;
    const term = fold($('capTrackSearch').value.trim());
    const visible = tracks.filter(track => (!mine || trackEnrollments(track.id).length) && (!selectedSector || !trackSectors(track).length || trackSectors(track).includes(selectedSector)) && (!term || [track.name,track.description,track.sequence_name].some(value => fold(value).includes(term)))).sort((a,b) => (a.sequence_name || '').localeCompare(b.sequence_name || '','pt-BR') || (a.sequence_order || 1)-(b.sequence_order || 1) || a.name.localeCompare(b.name,'pt-BR'));
    const visibleIds = new Set(visible.map(track => track.id));
    const filteredEnrollments = enrollments.filter(item => visibleIds.has(item.track_id));
    const eStats = filteredEnrollments.map(enrollmentStats);
    const uniquePeople = new Set(filteredEnrollments.map(item => item.employee_id));
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
      return `<button type="button" class="cap-track-card" data-cap-action="track" data-id="${safe(track.id)}"><div class="cap-card-head"><h3>${safe(track.name)}</h3>${status}</div><p>${safe(track.description || 'Sem descrição.')}</p><div class="cap-meta"><span>${safe(track.track_type)}</span><span>Modalidade: ${safe(modalityLabel(track))}</span>${track.sequence_name?`<span>Sequência: ${safe(sequenceLabel(track))}</span>`:''}<span>Setores: ${safe(sectorLabel(track))}</span><span>${trackCourses(track.id).filter(c=>c.active).length} curso(s)</span>${days}</div>${bar(shownPct)}<div class="cap-card-foot"><span>Progresso ${mine?'individual':'médio'}</span><strong>${shownPct}%</strong></div></button>`;
    }).join('') : empty(term ? 'Nenhuma trilha encontrada para esta busca.' : mine ? 'Você ainda não foi inscrito em uma trilha.' : selectedSector ? 'Nenhuma trilha destinada a este setor.' : 'Nenhuma trilha cadastrada. Crie a primeira trilha para começar.');
  }
  function filterTracks() { renderList(); }
  function choices(target, excludeEnrolled = false) {
    const enrolled = new Set(excludeEnrolled ? trackEnrollments(selectedTrack).map(item => String(item.employee_id)) : []);
    const selected = target === 'capEmployeeChoices' ? chosenTrackSectors() : trackSectors(tracks.find(track => track.id === selectedTrack));
    const checked = new Set([...$(target).querySelectorAll('input:checked')].map(input => input.value));
    const list = employees.filter(person => person.status !== 'Inativo' && !enrolled.has(String(person.id)) && (!selected.length || selected.includes(person.sector))).sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
    $(target).innerHTML = list.length ? list.map(person => `<label data-search="${safe((person.name+' '+(person.mat||'')).toLocaleLowerCase('pt-BR'))}"><input type="checkbox" value="${safe(person.id)}" ${checked.has(String(person.id))?'checked':''}><span>${safe(person.name)}</span><small>${safe(person.mat||'')} · ${safe(person.sector || 'Sem setor')}</small></label>`).join('') : empty(selected.length ? 'Nenhum funcionário ativo disponível nos setores selecionados.' : 'Nenhum funcionário disponível. Cadastre um funcionário primeiro.');
  }
  function changeTrackSector(event) {
    if (event?.target?.value === '') $('capTrackSectors').querySelectorAll('input:not([value=""])').forEach(input => input.checked = false);
    $('capTrackSectors').querySelector('input[value=""]').checked = !chosenTrackSectors().length;
    if (!$('capTrackAudience').hidden) { choices('capEmployeeChoices'); filterEmployees(); }
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
    $('capTrackSequenceNames').innerHTML = [...new Set(tracks.map(item => item.sequence_name).filter(Boolean))].map(name => `<option value="${safe(name)}"></option>`).join('');
    $('capTrackStart').value = today(); $('capTrackDays').value = 30; $('capTrackModality').value = ''; $('capTrackAudience').hidden = false;
    fillTrackSectorChoices();
    $('capEmployeeSearch').value = ''; choices('capEmployeeChoices'); notice('capTrackFormMessage',''); showPage('pageCapTrackForm');
  }
  function editTrack(id) {
    if (!manager()) return;
    const item = tracks.find(track => track.id === id); if (!item) return;
    editingTrack = id; $('capTrackFormTitle').textContent = 'Editar Trilha';
    $('capTrackSequenceNames').innerHTML = [...new Set(tracks.map(item => item.sequence_name).filter(Boolean))].map(name => `<option value="${safe(name)}"></option>`).join('');
    $('capTrackName').value = item.name; $('capTrackDescription').value = item.description;
    $('capTrackSequence').value = item.sequence_name || ''; $('capTrackSequenceOrder').value = item.sequence_order || 1;
    $('capTrackCertificateMode').value = certificateMode(item);
    $('capTrackType').value = item.track_type; $('capTrackModality').value = item.modality || ''; $('capTrackDays').value = item.duration_days;
    fillTrackSectorChoices(trackSectors(item));
    $('capTrackStart').value = item.start_date; $('capTrackStatus').value = item.status;
    $('capTrackAudience').hidden = true; notice('capTrackFormMessage',''); showPage('pageCapTrackForm');
  }
  function cancelTrackForm() { if (editingTrack) openTrack(editingTrack); else showPage('pageCapacitation'); }
  async function saveTrack(event) {
    event.preventDefault(); if (!manager() || busy) return;
    const days = Number($('capTrackDays').value);
    if (!Number.isInteger(days) || days < 1 || days > 3650) { notice('capTrackFormMessage','Informe um prazo entre 1 e 3650 dias.',true); return; }
    const sequenceOrder = Number($('capTrackSequenceOrder').value || 1);
    if (!Number.isInteger(sequenceOrder) || sequenceOrder < 1 || sequenceOrder > 999) { notice('capTrackFormMessage','Informe uma posição de 1 a 999 para a sequência.',true); return; }
    if (!['Online','Presencial','Híbrido'].includes($('capTrackModality').value)) { notice('capTrackFormMessage','Selecione a modalidade da trilha.',true); return; }
    if (editingTrack && $('capTrackCertificateMode').value !== certificateMode(tracks.find(item => item.id === editingTrack)) && enrollments.some(item => item.track_id === editingTrack)) { notice('capTrackFormMessage','Não é possível trocar o modo de certificado de uma trilha que já teve inscritos.',true); return; }
    const fields = { name:$('capTrackName').value.trim(), description:$('capTrackDescription').value.trim(),
      track_type:$('capTrackType').value, modality:$('capTrackModality').value, sectors:chosenTrackSectors(), duration_days:days, start_date:$('capTrackStart').value,
      sequence_name:$('capTrackSequence').value.trim(),sequence_order:sequenceOrder,certificate_mode:$('capTrackCertificateMode').value,
      status:$('capTrackStatus').value, updated_at:new Date().toISOString() };
    if (editingTrack && fields.sectors.length && trackEnrollments(editingTrack).some(item => !fields.sectors.includes(employees.find(person => String(person.id) === String(item.employee_id))?.sector))) {
      notice('capTrackFormMessage','Remova da trilha os funcionários de outros setores antes de alterar o setor destinatário.',true); return;
    }
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
    const related = track.sequence_name ? tracks.filter(item => item.sequence_name === track.sequence_name && (manager() || trackEnrollments(item.id).length)).sort((a,b) => (a.sequence_order || 1)-(b.sequence_order || 1) || a.name.localeCompare(b.name,'pt-BR')) : [];
    $('capTrackActions').innerHTML = manager() ? `<button type="button" class="btn btn-secondary" data-cap-action="edit-track" data-id="${safe(track.id)}">Editar Trilha</button><button type="button" class="btn btn-danger" data-cap-action="delete-track" data-id="${safe(track.id)}">Excluir Trilha</button>` : '';
    $('capDetailTabs').hidden = !manager();
    $('capDetailTabs').querySelectorAll('button').forEach(button => button.classList.toggle('active',button.dataset.capTab === selectedTab));
    $('capDetailCourses').hidden = selectedTab !== 'courses'; $('capDetailEmployees').hidden = selectedTab !== 'employees';
    $('capTrackHero').innerHTML = `${badge(track.status,track.status==='Ativa'?'green':'gray')} <span class="muted">${safe(track.track_type)} · Modalidade: ${safe(modalityLabel(track))} · Setores: ${safe(sectorLabel(track))} · Certificado: ${certificateMode(track)==='after_all'?'único ao final':'por curso'}</span><h1>${safe(track.name)}</h1><p>${safe(track.description || 'Sem descrição.')}</p>
      ${related.length>1?`<div class="cap-sequence"><strong>Sequência: ${safe(track.sequence_name)}</strong><div>${related.map(item => `<button type="button" class="btn btn-secondary" data-cap-action="track" data-id="${safe(item.id)}" ${item.id===track.id?'disabled aria-current="step"':''}>${item.sequence_order || 1}. ${safe(item.name)}</button>`).join('')}</div><small>As trilhas podem ser acessadas em qualquer ordem.</small></div>`:''}
      ${enrollment ? `<div class="cap-status-line"><strong>Seu prazo: ${fmtDate(enrollment.due_date)}</strong>${deadline(enrollment)}${badge(stats.status,statusTone(stats.status))}</div>${bar(stats.pct)}<div class="cap-card-foot">Prazo utilizado <strong>${timeUsed(enrollment)}%</strong></div>` : ''}
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
        const certificate = certificateMode(track)==='per_course' && course.certificate_required ? certificateState(item) : null;
        const url = validUrl(course.external_url);
        return `<article class="cap-course"><div class="cap-course-head"><div><h3><span class="cap-course-order">${course.sort_order}.</span>${safe(course.name)}</h3><p>${safe(course.description || 'Sem descrição.')}</p></div>${state?badge(state[0],state[1]):badge(course.active?'Ativo':'Inativo',course.active?'green':'gray')}</div>
          <div class="cap-course-meta"><span>◷ ${course.duration_minutes} min</span><span>Modalidade: ${safe(modalityLabel(course))}</span><span>${certificateMode(track)==='after_all'?'Certificado único ao final':`Certificado ${course.certificate_required?'obrigatório':'opcional'}`}</span>${!course.active?'<span>Curso inativo</span>':''}${item?.completed_at?`<span>Concluído em ${fmtTime(item.completed_at)}</span>`:''}</div>
          ${certificate?`<div class="cap-status-line">Certificado: ${badge(certificate[0],certificate[1])}${item?.certificate_name?`<span class="cap-certificate-name">${safe(item.certificate_name)} · ${fmtTime(item.certificate_uploaded_at)}</span>`:''}${item?.validation_status==='rejected'?`<span class="cap-due-alert">Motivo: ${safe(item.rejection_reason||'Não informado')}</span>`:''}</div>`:''}
          <div class="cap-course-actions">${canUpload() && enrollment && track.status==='Ativa' && course.active && !item?.started_at?`<button type="button" class="btn btn-primary" data-cap-action="start-course" data-id="${safe(course.id)}">Iniciar</button>`:''}
            ${url && !reviewEnrollment && (manager() || item?.started_at)?`<a class="btn btn-secondary" href="${safe(url)}" target="_blank" rel="noopener noreferrer">${manager()?'Abrir link ↗':'Acessar curso ↗'}</a>`:''}
            ${canUpload() && enrollment && track.status==='Ativa' && course.active && item?.started_at && !item?.course_finished_at && !item?.completed_at?`<button type="button" class="btn btn-primary" data-cap-action="finish-course" data-id="${safe(course.id)}">Concluir</button>`:''}
            ${canUpload() && enrollment && track.status==='Ativa' && course.active && certificateMode(track)==='per_course' && course.certificate_required && item?.course_finished_at && (!item?.certificate_path || item.validation_status==='rejected')?`<label class="btn btn-secondary">${item?.certificate_path?'Enviar novo certificado':'Anexar certificado'} <input class="cap-file-input" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" data-cap-upload="${safe(course.id)}"></label>`:''}
            ${item?.certificate_path?`<button type="button" class="btn btn-secondary" data-cap-action="certificate" data-id="${safe(item.id)}">${fileViewLabel(item.certificate_path)}</button>`:''}
            ${manager()?`<button type="button" class="btn btn-secondary" data-cap-action="edit-course" data-id="${safe(course.id)}">Editar Curso</button>`:''}</div></article>`;
      }).join('') : empty('Esta trilha ainda não tem cursos.')} </div>${certificateMode(track)==='after_all' && enrollment ? renderTrackCertificate(enrollment) : ''}`;
  }
  function renderTrackCertificate(enrollment, adminView = false) {
    const stats = enrollmentStats(enrollment), state = trackCertificateState(enrollment);
    const ready = stats.total > 0 && stats.done === stats.total;
    const rejected = enrollment.track_validation_status === 'rejected';
    return `<div class="card cap-final-certificate"><h3>Certificado final da trilha</h3><p class="muted">${ready?'Todos os cursos ativos foram concluídos.':'Conclua todos os cursos ativos para liberar o envio.'}</p><div class="cap-status-line">Status: ${badge(state[0],state[1])}${enrollment.track_certificate_name?`<span class="cap-certificate-name">${safe(enrollment.track_certificate_name)} · ${fmtTime(enrollment.track_certificate_uploaded_at)}</span>`:''}</div>${rejected?`<div class="cap-rejection-reason"><strong>Motivo da recusa:</strong> ${safe(enrollment.track_rejection_reason || 'Não informado')}</div>`:''}<div class="cap-course-actions">${canUpload() && !adminView && ready && (!enrollment.track_certificate_path || rejected)?`<label class="btn btn-secondary">${rejected?'Enviar novo certificado':'Anexar certificado'} <input class="cap-file-input" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" data-cap-track-upload="${safe(enrollment.id)}"></label>`:''}${enrollment.track_certificate_path?`<button type="button" class="btn btn-secondary" data-cap-action="track-certificate" data-id="${safe(enrollment.id)}">${fileViewLabel(enrollment.track_certificate_path)}</button>`:''}${adminView && rejected?`<button type="button" class="btn btn-secondary" data-cap-action="edit-track-rejection" data-id="${safe(enrollment.id)}">Editar motivo</button>`:''}${adminView && enrollment.track_certificate_path && enrollment.track_validation_status==='pending'?`<button type="button" class="btn btn-primary" data-cap-action="approve-track-certificate" data-id="${safe(enrollment.id)}" ${enrollment.track_certificate_viewed_at?'':'disabled title="Abra o certificado antes de aprovar"'}>Aprovar certificado</button><button type="button" class="btn btn-danger" data-cap-action="reject-track-certificate" data-id="${safe(enrollment.id)}">Rejeitar</button>`:''}</div></div>`;
  }
  function validUrl(value) { try { const parsed = new URL(value); return ['http:','https:'].includes(parsed.protocol) ? parsed.href : ''; } catch { return ''; } }
  function showCourseEditor(id = null) {
    if (!manager()) return;
    editingCourse = id; $('capCourseForm').reset();
    const item = courses.find(course => course.id === id);
    $('capCourseFormTitle').textContent = item ? 'Editar Curso' : 'Adicionar Curso';
    $('capCourseName').value = item?.name || ''; $('capCourseDescription').value = item?.description || '';
    $('capCourseUrl').value = item?.external_url || ''; $('capCourseMinutes').value = item?.duration_minutes || 40;
    $('capCourseModality').value = item?.modality || tracks.find(track => track.id === selectedTrack)?.modality || '';
    $('capCourseOrder').value = item?.sort_order || trackCourses(selectedTrack).length+1;
    $('capCourseCertificate').value = String(item?.certificate_required || false);
    const finalMode = certificateMode(tracks.find(track => track.id === selectedTrack)) === 'after_all';
    $('capCourseCertificate').closest('.field').hidden = finalMode;
    if (finalMode) $('capCourseCertificate').value = 'false';
    $('capCourseActive').value = String(item?.active ?? true);
    notice('capCourseFormMessage',''); $('capCourseEditor').showModal(); $('capCourseName').focus();
  }
  function closeCourseEditor() { if ($('capCourseEditor').open) $('capCourseEditor').close(); editingCourse = null; }
  async function saveCourse(event) {
    event.preventDefault(); if (!manager() || busy || !selectedTrack) return;
    const url = validUrl($('capCourseUrl').value.trim());
    if (!url) { notice('capCourseFormMessage','Use um link http ou https válido.',true); return; }
    if (!['Online','Presencial','Híbrido'].includes($('capCourseModality').value)) { notice('capCourseFormMessage','Selecione a modalidade do curso.',true); return; }
    const fields = {name:$('capCourseName').value.trim(),description:$('capCourseDescription').value.trim(),external_url:url,
      duration_minutes:Number($('capCourseMinutes').value),modality:$('capCourseModality').value,sort_order:Number($('capCourseOrder').value),
      certificate_required:certificateMode(tracks.find(track => track.id === selectedTrack))==='per_course' && $('capCourseCertificate').value==='true',active:$('capCourseActive').value==='true',updated_at:new Date().toISOString()};
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
    const selected = trackSectors(tracks.find(track => track.id === selectedTrack));
    $('capEnrollHint').textContent = selected.length ? `Mostrando funcionários dos setores ${selected.join(', ')}. As inscrições existentes serão mantidas.` : 'Mostrando funcionários de todos os setores. As inscrições existentes serão mantidas.';
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
      const { error } = await client.rpc('cap_enroll_employees',{target_track:track.id,target_employee_ids:ids}); if (error) throw error;
      closeEnrollEditor(); await load(); renderDetail();
    } catch (error) { alert('Não foi possível inscrever: '+error.message); }
    finally { busy = false; }
  }
  function renderEmployees(track) {
    const list = trackEnrollments(track.id).sort((a,b) => employeeName(a.employee_id).localeCompare(employeeName(b.employee_id),'pt-BR'));
    $('capDetailEmployees').innerHTML = `<div class="cap-section-head"><div><h2>Funcionários</h2><p class="muted">Progresso individual, prazos e certificados.</p></div><button type="button" class="btn btn-primary" data-cap-action="enroll">+ Inscrever funcionários</button></div>
      ${list.length ? `<div class="cap-people-table card"><table><thead><tr><th>Funcionário</th><th>Progresso</th><th>Concluídos</th><th>Pendentes</th><th>Prazo</th><th>Status</th><th>Certificados</th><th></th></tr></thead><tbody>${list.map(enrollment => {
        const stats = enrollmentStats(enrollment);
        return `<tr><td><strong>${safe(employeeName(enrollment.employee_id))}</strong><br><span class="muted">${safe(employeeMat(enrollment.employee_id))}</span></td><td>${bar(stats.pct)} ${stats.pct}%</td><td>${stats.done}</td><td>${stats.pending}${stats.overdue?` · <span class="cap-due-alert">${stats.overdue} atrasado(s)</span>`:''}</td><td>${fmtDate(enrollment.due_date)}</td><td>${badge(stats.status,statusTone(stats.status))}</td><td>${certificateSummary(enrollment)}</td><td><button type="button" class="btn btn-secondary" data-cap-action="employee" data-id="${safe(enrollment.id)}">Ver evolução</button> <button type="button" class="btn btn-secondary" data-cap-action="remove-enrollment" data-id="${safe(enrollment.id)}">Remover da trilha</button></td></tr>`;
      }).join('')}</tbody></table></div>` : empty('Nenhum funcionário inscrito nesta trilha.')}
      <div id="capEmployeeFocus" class="cap-employee-focus"></div>`;
    if (focusedEnrollment) renderEmployeeFocus();
  }
  function renderEmployeeFocus() {
    const enrollment = enrollments.find(item => item.id === focusedEnrollment && item.track_id === selectedTrack);
    const node = $('capEmployeeFocus'); if (!node || !enrollment) return;
    const stats = enrollmentStats(enrollment);
    const track = tracks.find(item => item.id === selectedTrack);
    node.innerHTML = `<div class="card"><h3>${safe(employeeName(enrollment.employee_id))}</h3><p class="muted">Início: ${fmtDate(enrollment.start_date)} · Prazo: ${fmtDate(enrollment.due_date)} · ${deadline(enrollment)} · Prazo utilizado: ${timeUsed(enrollment)}%</p><p>Concluídos ${stats.done} de ${stats.total} · Pendentes ${stats.pending} · Certificados enviados ${certificateMode(track)==='after_all'?(enrollment.track_certificate_path?1:0):activeCourses(selectedTrack).filter(course=>courseProgress(enrollment.id,course.id)?.certificate_path).length}</p>${bar(stats.pct)}<div class="cap-course-list">${trackCourses(selectedTrack).map(course => {
      const item = courseProgress(enrollment.id,course.id), state = courseState(enrollment,course);
      const cert = certificateMode(track)==='per_course' && course.certificate_required ? certificateState(item) : null;
      const rejected = item?.validation_status === 'rejected';
      return `<div class="cap-course"><div class="cap-course-head"><strong>${safe(course.name)}</strong>${badge(state[0],state[1])}</div><div class="cap-status-line">${course.active?'Ativo':'Inativo'} · ${item?.completed_at?'Concluído em '+fmtTime(item.completed_at):item?.course_finished_at?'Finalizado pelo usuário':'Pendente'}${cert?` · Certificado ${badge(cert[0],cert[1])}`:''}</div>${item?.certificate_name?`<div class="cap-certificate-name">${safe(item.certificate_name)} · ${fmtTime(item.certificate_uploaded_at)}</div>`:''}${rejected?`<div class="cap-rejection-reason"><strong>Motivo da recusa:</strong> ${safe(item.rejection_reason||'Não informado')}</div>`:''}${item?.certificate_path?`<button type="button" class="btn btn-secondary" data-cap-action="certificate" data-id="${safe(item.id)}">${fileViewLabel(item.certificate_path)}</button>`:''}${rejected?`<button type="button" class="btn btn-secondary" data-cap-action="edit-rejection" data-id="${safe(item.id)}">Editar motivo</button>`:''}${item?.certificate_path && item.validation_status==='pending'?`<button type="button" class="btn btn-primary" data-cap-action="approve" data-id="${safe(item.id)}" ${item.certificate_viewed_at?'':'disabled title="Abra o certificado antes de aprovar"'}>Aprovar certificado</button><button type="button" class="btn btn-danger" data-cap-action="reject" data-id="${safe(item.id)}">Rejeitar</button>`:''}${(certificateMode(track)==='after_all' || !course.certificate_required) && !item?.completed_at?`<button type="button" class="btn btn-primary" data-cap-action="complete" data-id="${safe(course.id)}">Confirmar conclusão</button>`:''}</div>`;
    }).join('')}</div>${certificateMode(track)==='after_all'?renderTrackCertificate(enrollment,true):''}</div>`;
  }
  async function setState(courseId, nextState) {
    const enrollment = enrollments.find(item => item.id === focusedEnrollment); if (!manager() || !enrollment || busy) return;
    busy = true;
    try { const { error } = await client.rpc('cap_set_course_state',{target_enrollment:enrollment.id,target_course:courseId,next_state:nextState});
      if (error) throw error; await load(); renderDetail(); renderList(); }
    catch (error) { alert('Não foi possível atualizar o curso: '+error.message); }
    finally { busy = false; }
  }
  async function refreshCourseProgress(enrollmentId, courseId) {
    loadRevision++;
    const {data,error} = await client.from('cap_progress').select('*')
      .eq('enrollment_id',enrollmentId).eq('course_id',courseId).single();
    if (error) throw error;
    const index = progress.findIndex(item => item.id === data.id);
    if (index >= 0) progress[index] = data;
    else progress.push(data);
  }
  async function advanceCourse(courseId, nextState, button) {
    if (!canUpload()) return;
    if (busy) { alert('Aguarde a atualização do curso em andamento.'); return; }
    const enrollment = trackEnrollments(selectedTrack)[0];
    const course = courses.find(item => item.id === courseId && item.track_id === selectedTrack);
    if (!enrollment || !course || !course.active) return;
    const track = tracks.find(item => item.id === selectedTrack);
    if (nextState === 'finished' && !confirm(`Concluir o curso "${course.name}"?${certificateMode(track)==='per_course' && course.certificate_required?' Em seguida, anexe o certificado para validação.':''}`)) return;
    busy = true;
    const previousLabel = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Salvando...'; }
    let saved = false;
    try {
      const {error} = await client.rpc('cap_set_course_state',{target_enrollment:enrollment.id,target_course:courseId,next_state:nextState});
      if (error) throw error;
      saved = true;
      try { await refreshCourseProgress(enrollment.id,courseId); }
      catch (syncError) {
        // A operação já foi gravada. Mostre o novo estado mesmo se a leitura falhar.
        loadRevision++;
        let item = courseProgress(enrollment.id,courseId);
        if (!item) { item = {id:`local-${enrollment.id}-${courseId}`,enrollment_id:enrollment.id,course_id:courseId}; progress.push(item); }
        const now = new Date().toISOString();
        if (nextState === 'started') item.started_at ||= now;
        else { item.course_finished_at ||= now; if (certificateMode(track)==='after_all' || !course.certificate_required) item.completed_at ||= now; }
      }
      renderDetail();
    } catch (error) { alert(saved ? 'O curso foi atualizado, mas a tela não sincronizou. '+error.message : 'Não foi possível atualizar o curso: '+error.message); }
    finally { busy = false; if (button?.isConnected) { button.disabled = false; button.textContent = previousLabel; } }
  }
  async function uploadCertificate(courseId, file, trackLevel = false) {
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
      const path = `${enrollment.id}/${trackLevel?'track':courseId}/${crypto.randomUUID()}.${ext}`;
      const uploaded = await client.storage.from('cap-certificates').upload(path,file,{contentType:types[ext],upsert:false});
      if (uploaded.error) throw uploaded.error;
      const attached = trackLevel ? await client.rpc('cap_attach_track_certificate',{target_enrollment:enrollment.id,object_path:path,file_name:file.name.slice(0,200)}) : await client.rpc('cap_attach_certificate',{target_enrollment:enrollment.id,target_course:courseId,object_path:path,file_name:file.name.slice(0,200)});
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
  async function editRejectionReason(progressId) {
    if (!manager() || busy) return;
    const item = progress.find(row => row.id === progressId);
    if (!item?.certificate_path || item.validation_status !== 'rejected') return;
    const reason = prompt('Atualize o motivo da recusa do certificado:',item.rejection_reason || '');
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3 || trimmed.length > 1000) { alert('Informe um motivo de 3 a 1000 caracteres.'); return; }
    if (trimmed === item.rejection_reason) return;
    busy = true;
    try {
      const {error} = await client.rpc('cap_update_rejection_reason',{target_progress:progressId,new_reason:trimmed});
      if (error) throw error;
      await load(); renderDetail();
    } catch (error) { alert('Não foi possível alterar o motivo: '+error.message); }
    finally { busy = false; }
  }
  async function deleteTrack(id) {
    if (!manager() || busy) return;
    const track = tracks.find(item => item.id === id);
    if (!track || !confirm(`Excluir a trilha "${track.name}"? Ela deixará de aparecer para todos os usuários. O histórico e os certificados serão preservados.`)) return;
    busy = true;
    try {
      const {error} = await client.rpc('cap_archive_track',{target_track:id});
      if (error) throw error;
      selectedTrack = null; focusedEnrollment = null; await load(); showPage('pageCapacitation');
    } catch (error) { alert('Não foi possível excluir a trilha: '+error.message); }
    finally { busy = false; }
  }
  async function removeEnrollment(id) {
    if (!manager() || busy) return;
    const enrollment = enrollments.find(item => item.id === id && item.track_id === selectedTrack);
    if (!enrollment || !confirm(`Remover ${employeeName(enrollment.employee_id)} desta trilha e de todos os cursos dela? O histórico e os certificados serão preservados.`)) return;
    busy = true;
    try {
      const {error} = await client.rpc('cap_remove_enrollment',{target_enrollment:id});
      if (error) throw error;
      if (focusedEnrollment === id) focusedEnrollment = null;
      await load(); renderDetail();
    } catch (error) { alert('Não foi possível remover o funcionário: '+error.message); }
    finally { busy = false; }
  }
  async function openCertificatePreview(path, name = 'Certificado') {
    if (!path || !client) return false;
    const revision = ++previewRevision;
    const dialog = $('capCertificatePreview');
    $('capCertificatePreviewTitle').textContent = 'Certificado';
    $('capCertificatePreviewName').textContent = name;
    $('capCertificateViewer').textContent = 'Carregando arquivo...';
    previewPath = null; previewName = '';
    $('capCertificateOpenTab').hidden = true;
    $('capCertificateOpenTab').removeAttribute('href');
    if (!dialog.open) dialog.showModal();
    try {
      const {data,error} = await client.storage.from('cap-certificates').createSignedUrl(path,300);
      if (error) throw error;
      if (revision !== previewRevision || !dialog.open) return false;
      previewPath = path; previewName = name;
      $('capCertificateOpenTab').href = data.signedUrl;
      $('capCertificateOpenTab').hidden = false;
      const viewer = $('capCertificateViewer'); viewer.replaceChildren();
      const visual = /\.pdf$/i.test(path) ? document.createElement('iframe') : document.createElement('img');
      visual.src = data.signedUrl;
      if (visual.tagName === 'IFRAME') visual.title = name;
      else visual.alt = name;
      viewer.append(visual);
      return true;
    } catch (error) {
      if (revision === previewRevision && dialog.open) $('capCertificateViewer').textContent = 'Não foi possível abrir o arquivo: ' + error.message;
      return false;
    }
  }
  function closeCertificatePreview() {
    previewRevision++;
    previewPath = null; previewName = '';
    $('capCertificateOpenTab').hidden = true;
    $('capCertificateOpenTab').removeAttribute('href');
    $('capCertificateViewer').replaceChildren();
    if ($('capCertificatePreview').open) $('capCertificatePreview').close();
  }
  async function downloadCertificatePreview() {
    if (!previewPath) return;
    const {data,error} = await client.storage.from('cap-certificates').createSignedUrl(previewPath,60,{download:previewName});
    if (error) { alert('Não foi possível baixar o certificado: '+error.message); return; }
    const link=document.createElement('a');link.href=data.signedUrl;link.download=previewName;document.body.append(link);link.click();link.remove();
  }
  async function viewCertificate(progressId) {
    const item = progress.find(row => row.id === progressId);
    if (!item?.certificate_path) return;
    if (!await openCertificatePreview(item.certificate_path,item.certificate_name || 'Certificado')) return;
    if (manager() && !item.certificate_viewed_at) {
      const {error}=await client.rpc('cap_mark_certificate_viewed',{target_progress:item.id});
      if (error) { alert('O arquivo abriu, mas não foi possível registrar a conferência: '+error.message); return; }
      try { await refreshCourseProgress(item.enrollment_id,item.course_id); if (document.querySelector('.page.active')?.id === 'pageCapTrackDetail') renderDetail(); }
      catch (error) { alert('O arquivo abriu, mas a tela não sincronizou: '+error.message); }
    }
  }
  async function viewTrackCertificate(enrollmentId) {
    const item = enrollments.find(row => row.id === enrollmentId);
    if (!item?.track_certificate_path) return;
    if (!await openCertificatePreview(item.track_certificate_path,item.track_certificate_name || 'Certificado final')) return;
    if (manager() && !item.track_certificate_viewed_at) {
      const {error}=await client.rpc('cap_mark_track_certificate_viewed',{target_enrollment:item.id});
      if (error) { alert('O arquivo abriu, mas não foi possível registrar a conferência: '+error.message); return; }
      const {data,error:reloadError}=await client.from('cap_enrollments').select('*').eq('id',item.id).single();
      if (reloadError) { alert('O arquivo abriu, mas a tela não sincronizou: '+reloadError.message); return; }
      const index=enrollments.findIndex(row=>row.id===item.id);if(index>=0)enrollments[index]=data;
      if (document.querySelector('.page.active')?.id === 'pageCapTrackDetail') renderDetail();
    }
  }
  async function reviewTrackCertificate(enrollmentId, decision) {
    if (!manager() || busy) return;
    const item = enrollments.find(row => row.id === enrollmentId);
    if (!item?.track_certificate_path || item.track_validation_status !== 'pending') return;
    const reason = decision === 'rejected' ? prompt('Explique o que precisa ser corrigido no certificado:') : null;
    if (decision === 'rejected' && (reason === null || reason.trim().length < 3)) return;
    if (decision === 'approved' && !confirm('Você conferiu o certificado final desta trilha? Após aprovar, ele ficará bloqueado para alterações.')) return;
    busy = true;
    try {
      const {error} = await client.rpc('cap_review_track_certificate',{target_enrollment:enrollmentId,decision,reason});
      if (error) throw error; await load(); renderDetail();
    } catch (error) { alert('Não foi possível validar o certificado: '+error.message); }
    finally { busy = false; }
  }
  async function editTrackRejectionReason(enrollmentId) {
    if (!manager() || busy) return;
    const item = enrollments.find(row => row.id === enrollmentId);
    if (!item?.track_certificate_path || item.track_validation_status !== 'rejected') return;
    const reason = prompt('Atualize o motivo da recusa do certificado:',item.track_rejection_reason || '');
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3 || trimmed.length > 1000) { alert('Informe um motivo de 3 a 1000 caracteres.'); return; }
    busy = true;
    try {
      const {error} = await client.rpc('cap_update_track_rejection_reason',{target_enrollment:enrollmentId,new_reason:trimmed});
      if (error) throw error; await load(); renderDetail();
    } catch (error) { alert('Não foi possível alterar o motivo: '+error.message); }
    finally { busy = false; }
  }
  function canViewEmployeeHistory(employeeId) {
    return manager() || (employeeRole() && String(access.employee_id) === String(employeeId));
  }
  async function renderEmployeeHistory(employeeId) {
    const node = $('employeeCapHistory');
    if (!node || node.dataset.employeeId !== String(employeeId) || !canViewEmployeeHistory(employeeId)) return;
    try {
      const rows = [];
      for (let offset = 0; ; offset += 1000) {
        const {data,error} = await client.rpc('cap_employee_history',{target_employee_id:Number(employeeId)}).range(offset,offset+999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      if ($('employeeCapHistory') !== node || node.dataset.employeeId !== String(employeeId)) return;
      const visibleRows = rows.filter(row => !row.track_deleted_at && !row.removed_at);
      if (!visibleRows.length) { node.innerHTML = empty('Nenhuma capacitação registrada para este funcionário.'); return; }
      const enrollmentIds = [...new Set(visibleRows.map(row => row.enrollment_id))];
      const trackIds = [...new Set(visibleRows.map(row => row.track_id))];
      const [enrollmentResult,trackResult] = await Promise.all([
        client.from('cap_enrollments').select('id,track_certificate_path,track_certificate_name,track_certificate_uploaded_at,track_validation_status,track_rejection_reason').in('id',enrollmentIds),
        client.from('cap_tracks').select('id,certificate_mode').in('id',trackIds)
      ]);
      if (enrollmentResult.error) throw enrollmentResult.error;
      if (trackResult.error) throw trackResult.error;
      const historyEnrollments = new Map((enrollmentResult.data || []).map(item => [item.id,item]));
      const historyTracks = new Map((trackResult.data || []).map(item => [item.id,item]));
      const groups = new Map();
      for (const row of visibleRows) {
        if (!groups.has(row.enrollment_id)) groups.set(row.enrollment_id,{head:row,courses:[]});
        if (row.course_id) groups.get(row.enrollment_id).courses.push(row);
      }
      node.innerHTML = `<div class="employee-cap-history">${[...groups.values()].map(({head,courses:list}) => {
        const active = list.filter(item => item.course_active);
        const completed = active.filter(item => item.completed_at).length;
        const progressValue = percent(completed,active.length);
        const trackStatus = badge(head.track_status,head.track_status==='Concluída'?'green':'orange');
        const historyEnrollment = historyEnrollments.get(head.enrollment_id);
        const finalMode = certificateMode(historyTracks.get(head.track_id)) === 'after_all';
        const finalCertificate = finalMode ? `<div class="employee-cap-final"><strong>Certificado final:</strong> ${badge(trackCertificateState(historyEnrollment)[0],trackCertificateState(historyEnrollment)[1])}${historyEnrollment?.track_rejection_reason?`<div class="cap-rejection-reason">Motivo da recusa: ${safe(historyEnrollment.track_rejection_reason)}</div>`:''}${historyEnrollment?.track_certificate_path?`<button type="button" class="btn btn-secondary" data-cap-history-cert="${safe(historyEnrollment.track_certificate_path)}">${fileViewLabel(historyEnrollment.track_certificate_path)}</button>`:''}</div>` : '';
        return `<details class="employee-cap-track"><summary class="employee-cap-trigger"><strong>${safe(head.track_name)}</strong><span class="employee-cap-chevron" aria-hidden="true">⌄</span></summary><div class="employee-cap-expanded"><div class="employee-cap-head"><div class="muted">${safe(head.track_type)} · Início ${fmtDate(head.enrollment_start)} · Prazo ${fmtDate(head.enrollment_due)}</div>${trackStatus}</div><div class="employee-cap-summary"><span>${completed} de ${active.length} curso(s) ativo(s) concluído(s)</span><strong>${progressValue}%</strong></div>${bar(progressValue)}${finalCertificate}<div class="employee-cap-courses">${list.length ? list.map(item => {
          const state = item.completed_at ? badge('Concluído','green') : item.validation_status==='rejected' ? badge('Certificado rejeitado','red') : item.certificate_path ? badge('Certificado anexado','orange') : item.course_finished_at && item.certificate_required ? badge('Aguardando certificado','orange') : item.started_at ? badge('Em andamento','orange') : badge('Não iniciado','gray');
          const certificate = item.certificate_required ? certificateState(item) : null;
          return `<div class="employee-cap-course"><div><strong>${safe(item.course_name)}</strong>${!item.course_active?' <span class="muted">(inativo)</span>':''}<div class="muted">${item.completed_at?'Concluído em '+fmtTime(item.completed_at):item.course_finished_at?'Finalizado em '+fmtTime(item.course_finished_at):'Sem conclusão registrada'}</div>${item.validation_status==='rejected'?`<div class="cap-rejection-reason"><strong>Motivo da recusa:</strong> ${safe(item.rejection_reason||'Não informado')}</div>`:''}</div><div class="employee-cap-course-state">${state}${certificate?`<span>Certificado: ${badge(certificate[0],certificate[1])}</span>`:''}${item.certificate_path?`<button type="button" class="btn btn-secondary" data-cap-history-cert="${safe(item.certificate_path)}">${fileViewLabel(item.certificate_path)}</button>`:''}</div></div>`;
        }).join('') : empty('Nenhum curso registrado nesta trilha.')}</div></div></details>`;
      }).join('')}</div>`;
    } catch (error) {
      if ($('employeeCapHistory') === node) node.textContent = 'Não foi possível carregar o histórico: ' + error.message;
    }
  }
  async function viewHistoryCertificate(path) {
    if (!client || !path || !access) return;
    await openCertificatePreview(path,'Certificado da capacitação');
  }
  function delegate(event) {
    const button = event.target.closest('[data-cap-action]'); if (!button) return;
    const {capAction:action,id} = button.dataset;
    if (action==='track') openTrack(id);
    if (action==='edit-track') editTrack(id);
    if (action==='delete-track') deleteTrack(id);
    if (action==='new-course') showCourseEditor();
    if (action==='edit-course') showCourseEditor(id);
    if (action==='enroll') showEnrollEditor();
    if (action==='employee') { focusedEnrollment=id; renderEmployeeFocus(); $('capEmployeeFocus').scrollIntoView({behavior:'smooth'}); }
    if (action==='remove-enrollment') removeEnrollment(id);
    if (action==='complete') setState(id,'completed');
    if (action==='start-course') advanceCourse(id,'started',button);
    if (action==='finish-course') advanceCourse(id,'finished',button);
    if (action==='approve') reviewCertificate(id,'approved');
    if (action==='reject') reviewCertificate(id,'rejected');
    if (action==='edit-rejection') editRejectionReason(id);
    if (action==='certificate') viewCertificate(id);
    if (action==='track-certificate') viewTrackCertificate(id);
    if (action==='approve-track-certificate') reviewTrackCertificate(id,'approved');
    if (action==='reject-track-certificate') reviewTrackCertificate(id,'rejected');
    if (action==='edit-track-rejection') editTrackRejectionReason(id);
  }
  $('capTrackForm').addEventListener('submit',saveTrack);
  $('capCourseForm').addEventListener('submit',saveCourse);
  $('capCourseEditor').addEventListener('close',() => { editingCourse = null; });
  $('capCertificatePreview').addEventListener('close',closeCertificatePreview);
  $('pageCapacitation').addEventListener('click',delegate);
  $('pageCapTrackDetail').addEventListener('click',delegate);
  $('pageCapTrackDetail').addEventListener('change',event => {
    const input = event.target.closest('[data-cap-upload]');
    if (input) uploadCertificate(input.dataset.capUpload,input.files?.[0]);
    const trackInput = event.target.closest('[data-cap-track-upload]');
    if (trackInput) uploadCertificate(null,trackInput.files?.[0],true);
  });
  $('modalBody').addEventListener('click',event => {
    const button = event.target.closest('[data-cap-history-cert]');
    if (button) viewHistoryCertificate(button.dataset.capHistoryCert);
  });
  window.SPFLY_CAP = {configure,render,refresh,newTrack,filterTracks,changeTrackSector,filterEmployees,cancelTrackForm,selectTab,closeCourseEditor,closeCertificatePreview,downloadCertificatePreview,closeEnrollEditor,saveEnrollments,canViewEmployeeHistory,renderEmployeeHistory,updateEmployees(next){employees=next||[];},updateSectors(next){sectors=next||[];}};
  window.SPFLY_CAP_TEST = {addDays,remaining,percent,validUrl};
})();
