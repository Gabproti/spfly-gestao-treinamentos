(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const auth = () => window.SPFLY_AUTH;
  const client = () => auth().getClient();
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const clean = value => String(value ?? '').trim();
  const digits = value => clean(value).replace(/\D/g, '');
  const headers = ['Nome','Tipo de documento','CPF/CNPJ','Matrícula','Data de nascimento','Data de admissão','Setor','Cargo','E-mail','Telefone','Status'];
  const keys = ['name','documentType','cpf','mat','birth','hire','sector','role','email','phone','status'];
  const aliases = {nome:'name',tipodedocumento:'documentType',cpfcnpj:'cpf',cpf:'cpf',cnpj:'cpf',documento:'cpf',matricula:'mat',
    datadenascimento:'birth',datadeadmissao:'hire',setor:'sector',cargo:'role',email:'email',telefone:'phone',status:'status'};
  let imported = [], importedFile = '', editingLine = null, currentEmployeeId = null;
  let externalCertificates = [], platformCertificates = [], editingCertificateId = null, savingCertificate = false, certificateLoad = 0;
  let attachments = [], editingAttachmentId = null, savingAttachment = false, attachmentLoad = 0;
  const normalize = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const error = (message, line) => ({message, line});

  function parseCsv(text) {
    const rows = []; let row = [], cell = '', quoted = false, line = 1, rowLine = 1;
    text = String(text).replace(/^\uFEFF/, '');
    const first = text.split(/\r?\n/,1)[0];
    const delimiter = (first.match(/;/g)||[]).length >= (first.match(/,/g)||[]).length ? ';' : ',';
    for (let i=0;i<text.length;i++) {
      const ch=text[i];
      if (ch==='"') { if (quoted && text[i+1]==='"') {cell+='"';i++;} else quoted=!quoted; }
      else if (ch===delimiter && !quoted) {row.push(cell);cell='';}
      else if ((ch==='\n'||ch==='\r') && !quoted) {
        row.push(cell); if (row.some(x=>clean(x))) rows.push({line:rowLine,cells:row});
        row=[];cell=''; if(ch==='\r'&&text[i+1]==='\n')i++; line++;rowLine=line;
      } else {cell+=ch;if(ch==='\n')line++;}
    }
    if (quoted) throw new Error('Há aspas sem fechamento no CSV.');
    row.push(cell);if(row.some(x=>clean(x)))rows.push({line:rowLine,cells:row});
    return rows;
  }
  function validDate(raw) {
    if (!clean(raw)) return '';
    let y,m,d; const value=clean(raw);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) [y,m,d]=value.split('-').map(Number);
    else if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) [d,m,y]=value.split('/').map(Number);
    else return null;
    const check=new Date(Date.UTC(y,m-1,d));
    return check.getUTCFullYear()===y&&check.getUTCMonth()===m-1&&check.getUTCDate()===d?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
  }
  function validDocument(value,type) {
    const d=digits(value), len=type==='CNPJ'?14:11;
    if (d.length!==len || /^(\d)\1+$/.test(d)) return false;
    if (type==='CPF') {
      for(let n=9;n<=10;n++){const sum=[...d.slice(0,n)].reduce((s,x,i)=>s+Number(x)*(n+1-i),0);if(Number(d[n])!==((sum*10)%11)%10)return false;}
      return true;
    }
    for(let n=12;n<=13;n++){
      const weights=n===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];
      const sum=[...d.slice(0,n)].reduce((s,x,i)=>s+Number(x)*weights[i],0);
      if(Number(d[n])!==(sum%11<2?0:11-sum%11))return false;
    }
    return true;
  }
  function validateImport() {
    const seenDocs=new Set(), seenMats=new Set();
    const existingDocs=new Set(employees.map(e=>digits(e.cpf)).filter(Boolean));
    const existingMats=new Set(employees.map(e=>clean(e.mat).toLowerCase()).filter(Boolean));
    const sectorNames=employeeSectors();
    for(const entry of imported){
      const r=entry.raw, issues=[];
      const name=clean(r.name), mat=clean(r.mat), doc=digits(r.cpf);
      const type=clean(r.documentType).toUpperCase() || (doc.length===14?'CNPJ':'CPF');
      if(!name)issues.push('Nome obrigatório');
      if(!mat)issues.push('Matrícula obrigatória');
      if(!['CPF','CNPJ'].includes(type))issues.push('Tipo de documento inválido');
      else if(!validDocument(doc,type))issues.push(type+' inválido');
      if(doc && existingDocs.has(doc))issues.push('Funcionário já cadastrado (documento)');
      if(mat && existingMats.has(mat.toLowerCase()))issues.push('Funcionário já cadastrado (matrícula)');
      if(doc && seenDocs.has(doc))issues.push('Documento duplicado no arquivo');
      if(mat && seenMats.has(mat.toLowerCase()))issues.push('Matrícula duplicada no arquivo');
      const sector=sectorNames.find(s=>s.toLocaleLowerCase('pt-BR')===clean(r.sector).toLocaleLowerCase('pt-BR'));
      if(!clean(r.sector))issues.push('Setor não informado');
      else if(!sector)issues.push('Setor inexistente');
      const birth=validDate(r.birth), hire=validDate(r.hire);
      if(birth===null)issues.push('Data de nascimento inválida');
      if(hire===null)issues.push('Data de admissão inválida');
      if(clean(r.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(r.email)))issues.push('E-mail inválido');
      const status=clean(r.status)||'Ativo';if(!['Ativo','Inativo'].includes(status))issues.push('Status inválido');
      if(entry.columnError)issues.push(entry.columnError);
      entry.errors=issues;
      entry.employee={name,mat,cpf:formatBrazilianDocument(doc,type),documentType:type,
        birth:birth||'',hire:hire||'',sector:sector||'',role:clean(r.role)||'Não informado',
        email:clean(r.email),phone:clean(r.phone),status};
      if(doc)seenDocs.add(doc);if(mat)seenMats.add(mat.toLowerCase());
    }
  }
  function renderImport() {
    const node=$('employeeImportPreview');if(!imported.length){node.innerHTML='<div class="empty">Selecione um arquivo CSV para conferir os registros.</div>';$('employeeImportConfirm').disabled=true;return;}
    validateImport();
    const good=imported.filter(x=>!x.errors.length), bad=imported.filter(x=>x.errors.length);
    const preview=[...bad,...good];
    node.innerHTML=`<div class="employee-import-summary"><span>Registros encontrados: <strong>${imported.length}</strong></span><span>Válidos: <strong>${good.length}</strong></span><span>Com erro: <strong>${bad.length}</strong></span></div><div class="help">${safe(importedFile)} · Corrija as linhas com erro abaixo ou selecione um CSV atualizado. Somente os registros válidos serão salvos.</div><div class="employee-import-table"><table><thead><tr><th>Linha</th><th>Nome</th><th>Documento</th><th>Matrícula</th><th>Setor</th><th>Validação</th><th>Ação</th></tr></thead><tbody>${preview.map(e=>`<tr><td>${e.line}</td><td>${safe(e.raw.name)}</td><td>${safe(e.raw.cpf)}</td><td>${safe(e.raw.mat)}</td><td>${safe(e.raw.sector)}</td><td>${e.errors.length?`<span class="employee-import-error">${safe(e.errors.join('; '))}</span>`:'<span class="badge badge-green">Válido</span>'}</td><td><button type="button" class="btn btn-secondary btn-sm" data-import-line="${e.line}">Corrigir</button></td></tr>`).join('')}</tbody></table></div>`;
    $('employeeImportConfirm').disabled=!good.length;
  }
  function openImport(){if(!auth().canEdit('employees'))return;imported=[];importedFile='';$('employeeImportFile').value='';renderImport();$('employeeImportDialog').showModal();}
  function closeImport(){$('employeeImportDialog').close();}
  function downloadTemplate(){
    const blob=new Blob(['\uFEFF'+headers.join(';')+'\r\n'],{type:'text/csv;charset=utf-8'});
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='modelo_importacao_funcionarios.csv';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }
  async function readImportFile(file){
    if(!file)return;
    try{
      if(!/\.csv$/i.test(file.name))throw new Error('Selecione um arquivo .csv. Use o modelo disponível nesta tela.');
      if(file.size>5*1024*1024)throw new Error('O arquivo deve ter no máximo 5 MB.');
      const rows=parseCsv(await file.text());if(rows.length<2)throw new Error('O arquivo não contém funcionários.');
      const columns=rows[0].cells.map(label=>aliases[normalize(label)]||null);
      for(const required of ['name','cpf','mat','sector'])if(!columns.includes(required))throw new Error('Coluna obrigatória ausente: '+headers[keys.indexOf(required)]);
      if(new Set(columns.filter(Boolean)).size!==columns.filter(Boolean).length)throw new Error('Há colunas repetidas no cabeçalho.');
      if(rows.length>5001)throw new Error('Importe no máximo 5.000 funcionários por arquivo.');
      imported=rows.slice(1).map(({line,cells})=>{
        const raw={};columns.forEach((key,i)=>{if(key)raw[key]=cells[i]||'';});
        return {line,raw,errors:[],employee:null,columnError:cells.length!==columns.length?'Quantidade de colunas diferente do cabeçalho':''};
      });
      importedFile=file.name;renderImport();
    }catch(e){imported=[];$('employeeImportPreview').innerHTML=`<div class="employee-error">${safe(e.message)}</div>`;$('employeeImportConfirm').disabled=true;}
  }
  function editImportLine(line){
    const entry=imported.find(x=>x.line===Number(line));if(!entry)return;
    editingLine=entry.line;$('employeeImportEditTitle').textContent='Corrigir linha '+entry.line;
    $('employeeImportEditForm').innerHTML=keys.map((key,i)=>`<div class="field"><label for="importField${i}">${safe(headers[i])}</label><input id="importField${i}" value="${safe(entry.raw[key])}" ${['birth','hire'].includes(key)?'placeholder="DD/MM/AAAA"':''}></div>`).join('');
    $('employeeImportEditDialog').showModal();
  }
  function closeImportEdit(){$('employeeImportEditDialog').close();editingLine=null;}
  function saveImportEdit(){
    const entry=imported.find(x=>x.line===editingLine);if(!entry)return;
    keys.forEach((key,i)=>entry.raw[key]=$('importField'+i).value);
    entry.columnError='';
    closeImportEdit();renderImport();
  }
  async function confirmImport(){
    if(!auth().canEdit('employees'))return;
    validateImport();const valid=imported.filter(x=>!x.errors.length);
    if(!valid.length)return;
    if(!confirm(`Importar ${valid.length} funcionário(s) válido(s)? ${imported.length-valid.length} linha(s) com erro serão ignoradas.`))return;
    const button=$('employeeImportConfirm');button.disabled=true;button.textContent='Importando...';
    try{
      const max=Math.max(Date.now(),...employees.map(e=>Number(e.id)||0));
      const next=[...employees,...valid.map((entry,i)=>({id:max+i+1,...entry.employee}))];
      if(!await auth().persist(next,trainings))return;
      employees=next;window.SPFLY_CAP?.updateEmployees(next);closeImport();renderEmployees();
      alert(`${valid.length} funcionário(s) importado(s). ${imported.length-valid.length} linha(s) com erro não foram gravadas.`);
    }finally{button.textContent='Confirmar importação';button.disabled=false;}
  }

  async function platformRows(employeeId){
    const history=[];
    for(let offset=0;;offset+=1000){
      const {data,error}=await client().rpc('cap_employee_history',{target_employee_id:Number(employeeId)}).range(offset,offset+999);
      if(error){if(error.code==='42501')return [];throw error;}
      history.push(...(data||[]));if(!data||data.length<1000)break;
    }
    const rows=history.filter(r=>!r.track_deleted_at&&!r.removed_at), result=[];
    for(const r of rows)if(r.certificate_path)result.push({id:'course:'+r.course_id,course_name:r.course_name||r.track_name,
      institution:'SPFLY',completed_on:r.completed_at?.slice(0,10)||r.course_finished_at?.slice(0,10)||'',
      workload_hours:null,expires_on:null,category:r.track_name,notes:'',file_path:r.certificate_path,file_name:r.certificate_name||'Certificado',origin:'Plataforma',bucket:'cap-certificates'});
    const ids=[...new Set(rows.map(r=>r.enrollment_id))];
    if(ids.length){const {data:enrollments,error:enrollmentError}=await client().from('cap_enrollments').select('id,track_id,track_certificate_path,track_certificate_name').in('id',ids);
      if(enrollmentError)throw enrollmentError;
      for(const e of enrollments||[])if(e.track_certificate_path){const track=rows.find(r=>r.enrollment_id===e.id);
        result.push({id:'track:'+e.id,course_name:track?.track_name||'Trilha',institution:'SPFLY',completed_on:'',workload_hours:null,
          expires_on:null,category:'Certificado final da trilha',notes:'',file_path:e.track_certificate_path,
          file_name:e.track_certificate_name||'Certificado final',origin:'Plataforma',bucket:'cap-certificates'});}}
    return result;
  }
  function certDate(value){if(!value)return '—';const [y,m,d]=value.slice(0,10).split('-');return `${d}/${m}/${y}`;}
  function certificateTable(){
    const editable=auth().canEdit('employees'), all=[...externalCertificates.map(x=>({...x,origin:'Externo',bucket:'employee-certificates'})),...platformCertificates];
    if(!all.length)return '<div class="empty">Nenhum certificado registrado.</div>';
    return `<div class="employee-cert-list"><table><thead><tr><th>Certificado</th><th>Instituição</th><th>Conclusão</th><th>Carga horária</th><th>Validade</th><th>Origem</th><th>Ações</th></tr></thead><tbody>${all.map((c,i)=>`<tr><td><strong>${safe(c.course_name)}</strong>${c.category?`<div class="employee-cert-meta">${safe(c.category)}</div>`:''}${c.notes?`<div class="employee-cert-meta">${safe(c.notes)}</div>`:''}</td><td>${safe(c.institution)}</td><td>${certDate(c.completed_on)}</td><td>${c.workload_hours?`${safe(c.workload_hours)}h`:'—'}</td><td>${certDate(c.expires_on)}</td><td><span class="badge ${c.origin==='Externo'?'badge-orange':'badge-green'}">${c.origin}</span></td><td><div class="employee-cert-actions"><button type="button" class="btn btn-secondary btn-sm" data-cert-view="${i}">Visualizar</button><button type="button" class="btn btn-secondary btn-sm" data-cert-download="${i}">Baixar</button>${editable&&c.origin==='Externo'?`<button type="button" class="btn btn-secondary btn-sm" data-cert-edit="${safe(c.id)}">Editar</button><button type="button" class="btn btn-danger btn-sm" data-cert-delete="${safe(c.id)}">Excluir</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`;
  }
  function drawCertificates(){
    const node=$('employeeCertificates');if(!node||Number(node.dataset.employeeId)!==currentEmployeeId)return;
    node.innerHTML=certificateTable();
  }
  async function renderCertificates(employeeId){
    if(!auth().canPage('pageEmployees'))return;
    const load=++certificateLoad;
    currentEmployeeId=Number(employeeId);externalCertificates=[];platformCertificates=[];
    let section=$('employeeCertificateSection');
    if(!section){section=document.createElement('section');section.id='employeeCertificateSection';$('modalBody').append(section);}
    section.innerHTML=`<hr><div class="modal-head"><h3>Certificados</h3>${auth().canEdit('employees')?`<button type="button" class="btn btn-primary" onclick="SPFLY_EMPLOYEE.openCertificateForm(${Number(employeeId)})">+ Adicionar certificado</button>`:''}</div><div id="employeeCertificates" data-employee-id="${Number(employeeId)}" class="muted">Carregando certificados...</div>`;
    try{
      const [external,platform]=await Promise.all([client().from('employee_certificates').select('*').eq('employee_id',Number(employeeId)).order('completed_on',{ascending:false}),platformRows(employeeId)]);
      if(external.error)throw external.error;
      if(load!==certificateLoad||currentEmployeeId!==Number(employeeId)||!$('employeeCertificates'))return;
      externalCertificates=external.data||[];platformCertificates=platform;drawCertificates();
    }catch(e){const node=$('employeeCertificates');if(node)node.textContent='Não foi possível carregar os certificados: '+e.message;}
  }
  function openCertificateForm(employeeId,certificateId=null){
    if(!auth().canEdit('employees'))return;
    currentEmployeeId=Number(employeeId);editingCertificateId=certificateId;
    const c=externalCertificates.find(x=>x.id===certificateId);
    $('employeeCertificateTitle').textContent=c?'Editar certificado externo':'Adicionar certificado externo';
    $('employeeCertificateForm').reset();
    for(const [id,value] of [['ecCourse',c?.course_name],['ecInstitution',c?.institution],['ecCategory',c?.category],['ecCompleted',c?.completed_on],['ecExpires',c?.expires_on],['ecHours',c?.workload_hours],['ecNotes',c?.notes]])$(id).value=value??'';
    $('employeeCertificateError').hidden=true;$('employeeCertificateDialog').showModal();
  }
  function closeCertificateForm(){if(savingCertificate)return;$('employeeCertificateDialog').close();editingCertificateId=null;}
  async function checkFile(file){
    if(file.size>10*1024*1024)throw new Error('O arquivo deve ter no máximo 10 MB.');
    const ext=file.name.split('.').pop().toLowerCase();
    if(!['pdf','jpg','jpeg','png'].includes(ext))throw new Error('Selecione PDF, JPG ou PNG.');
    const head=new Uint8Array(await file.slice(0,8).arrayBuffer());
    const valid=ext==='pdf'?String.fromCharCode(...head.slice(0,5))==='%PDF-':
      ext==='png'?head.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':
        head[0]===255&&head[1]===216&&head[2]===255;
    if(!valid)throw new Error('O conteúdo do arquivo não corresponde ao formato selecionado.');
    return {ext,mime:ext==='pdf'?'application/pdf':ext==='png'?'image/png':'image/jpeg'};
  }
  async function saveCertificate(){
    if(savingCertificate||!auth().canEdit('employees'))return;
    const form=$('employeeCertificateForm');if(!form.reportValidity())return;
    const old=externalCertificates.find(x=>x.id===editingCertificateId),file=$('ecFile').files[0];
    const err=$('employeeCertificateError');err.hidden=true;
    if(!old&&!file){err.textContent='Selecione o arquivo do certificado.';err.hidden=false;return;}
    const completed=$('ecCompleted').value,expires=$('ecExpires').value;
    if(expires&&expires<completed){err.textContent='A validade deve ser igual ou posterior à conclusão.';err.hidden=false;return;}
    savingCertificate=true;$('employeeCertificateSave').disabled=true;let uploadedPath=null;
    try{
      let path=old?.file_path||'',name=old?.file_name||'';
      if(file){const info=await checkFile(file);path=`${currentEmployeeId}/${crypto.randomUUID()}/${crypto.randomUUID()}.${info.ext}`;
        const upload=await client().storage.from('employee-certificates').upload(path,file,{contentType:info.mime,upsert:false});
        if(upload.error)throw upload.error;uploadedPath=path;name=file.name.slice(0,200);}
      const data={employee_id:currentEmployeeId,course_name:clean($('ecCourse').value),institution:clean($('ecInstitution').value),
        completed_on:completed,expires_on:expires||null,workload_hours:$('ecHours').value?Number($('ecHours').value):null,
        category:clean($('ecCategory').value),notes:clean($('ecNotes').value),file_path:path,file_name:name,updated_at:new Date().toISOString()};
      const query=old?client().from('employee_certificates').update(data).eq('id',old.id):client().from('employee_certificates').insert(data);
      const {error:dbError}=await query;if(dbError)throw dbError;
      uploadedPath=null;
      if(old&&file)await client().storage.from('employee-certificates').remove([old.file_path]);
      $('employeeCertificateDialog').close();editingCertificateId=null;
      await renderCertificates(currentEmployeeId);
    }catch(e){if(uploadedPath)await client().storage.from('employee-certificates').remove([uploadedPath]);err.textContent='Não foi possível salvar: '+e.message;err.hidden=false;}
    finally{savingCertificate=false;$('employeeCertificateSave').disabled=false;}
  }
  async function deleteCertificate(id){
    if(!auth().canEdit('employees'))return;const item=externalCertificates.find(x=>x.id===id);if(!item)return;
    if(!confirm(`Deseja realmente excluir o certificado "${item.course_name}"?`))return;
    const {error}=await client().from('employee_certificates').delete().eq('id',id);if(error){alert('Não foi possível excluir: '+error.message);return;}
    const removed=await client().storage.from('employee-certificates').remove([item.file_path]);
    if(removed.error)alert('O registro foi excluído, mas o arquivo privado não pôde ser removido: '+removed.error.message);
    await renderCertificates(currentEmployeeId);
  }
  async function openCertificate(index,download=false){
    const item=[...externalCertificates.map(x=>({...x,bucket:'employee-certificates'})),...platformCertificates][Number(index)];if(!item)return;
    const tab=download?null:window.open('about:blank','_blank');
    try{const {data,error}=await client().storage.from(item.bucket).createSignedUrl(item.file_path,60,download?{download:item.file_name}:{ });
      if(error)throw error;
      if(download){const a=document.createElement('a');a.href=data.signedUrl;a.download=item.file_name;a.click();}
      else if(tab)tab.location.href=data.signedUrl;else window.location.href=data.signedUrl;
    }catch(e){tab?.close();alert('Não foi possível abrir o certificado: '+e.message);}
  }
  function drawAttachments(){
    const node=$('employeeAttachments');if(!node||Number(node.dataset.employeeId)!==currentEmployeeId)return;
    const editable=auth().canEdit('employees');
    node.innerHTML=attachments.length?`<div class="employee-cert-list"><table><thead><tr><th>Anexo</th><th>Categoria</th><th>Arquivo</th><th>Incluído em</th><th>Ações</th></tr></thead><tbody>${attachments.map(item=>`<tr><td><strong>${safe(item.title)}</strong>${item.notes?`<div class="employee-cert-meta">${safe(item.notes)}</div>`:''}</td><td>${safe(item.category||'—')}</td><td>${safe(item.file_name)}</td><td>${certDate(item.created_at)}</td><td><div class="employee-cert-actions"><button type="button" class="btn btn-secondary btn-sm" data-attach-view="${safe(item.id)}">${['application/pdf','image/jpeg','image/png'].includes(item.mime_type)?'Visualizar':'Abrir/baixar'}</button><button type="button" class="btn btn-secondary btn-sm" data-attach-download="${safe(item.id)}">Baixar</button>${editable?`<button type="button" class="btn btn-secondary btn-sm" data-attach-edit="${safe(item.id)}">Editar</button><button type="button" class="btn btn-danger btn-sm" data-attach-delete="${safe(item.id)}">Excluir</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Nenhum anexo geral registrado.</div>';
  }
  async function renderAttachments(employeeId){
    if(!auth().canPage('pageEmployees'))return;
    const load=++attachmentLoad;currentEmployeeId=Number(employeeId);attachments=[];
    let section=$('employeeAttachmentSection');
    if(!section){section=document.createElement('section');section.id='employeeAttachmentSection';$('modalBody').append(section);}
    section.innerHTML=`<hr><div class="modal-head"><h3>Anexos gerais</h3>${auth().canEdit('employees')?`<button type="button" class="btn btn-primary" onclick="SPFLY_EMPLOYEE.openAttachmentForm(${Number(employeeId)})">+ Adicionar anexo</button>`:''}</div><div id="employeeAttachments" data-employee-id="${Number(employeeId)}" class="muted">Carregando anexos...</div>`;
    try{
      const {data,error}=await client().from('employee_attachments').select('*').eq('employee_id',Number(employeeId)).order('created_at',{ascending:false});
      if(error)throw error;
      if(load!==attachmentLoad||currentEmployeeId!==Number(employeeId)||!$('employeeAttachments'))return;
      attachments=data||[];drawAttachments();
    }catch(e){const node=$('employeeAttachments');if(node)node.textContent='Não foi possível carregar os anexos: '+e.message;}
  }
  function openAttachmentForm(employeeId,attachmentId=null){
    if(!auth().canEdit('employees'))return;
    currentEmployeeId=Number(employeeId);editingAttachmentId=attachmentId;
    const item=attachments.find(x=>x.id===attachmentId);
    $('employeeAttachmentTitle').textContent=item?'Editar anexo geral':'Adicionar anexo geral';
    $('employeeAttachmentForm').reset();
    $('eaTitle').value=item?.title||'';$('eaCategory').value=item?.category||'';$('eaNotes').value=item?.notes||'';
    $('employeeAttachmentError').hidden=true;$('employeeAttachmentDialog').showModal();
  }
  function closeAttachmentForm(){if(savingAttachment)return;$('employeeAttachmentDialog').close();editingAttachmentId=null;}
  async function checkAttachmentFile(file){
    if(file.size>10*1024*1024)throw new Error('O arquivo deve ter no máximo 10 MB.');
    const ext=file.name.split('.').pop().toLowerCase();
    const types={pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',
      docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain'};
    if(!types[ext])throw new Error('Selecione PDF, JPG, PNG, DOCX, XLSX ou TXT.');
    const head=new Uint8Array(await file.slice(0,8).arrayBuffer());
    const signature=ext==='pdf'?String.fromCharCode(...head.slice(0,5))==='%PDF-':
      ext==='png'?head.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':
      ['jpg','jpeg'].includes(ext)?head[0]===255&&head[1]===216&&head[2]===255:
      ['docx','xlsx'].includes(ext)?head[0]===80&&head[1]===75&&head[2]===3&&head[3]===4:
      file.size>0&&!head.includes(0);
    if(!signature)throw new Error('O conteúdo do arquivo não corresponde ao formato selecionado.');
    return {ext,mime:types[ext]};
  }
  async function saveAttachment(){
    if(savingAttachment||!auth().canEdit('employees'))return;
    if(!$('employeeAttachmentForm').reportValidity())return;
    const old=attachments.find(x=>x.id===editingAttachmentId),file=$('eaFile').files[0],err=$('employeeAttachmentError');err.hidden=true;
    if(!old&&!file){err.textContent='Selecione o arquivo do anexo.';err.hidden=false;return;}
    savingAttachment=true;$('employeeAttachmentSave').disabled=true;let uploadedPath=null;
    try{
      let path=old?.file_path||'',name=old?.file_name||'',mime=old?.mime_type||'';
      if(file){const info=await checkAttachmentFile(file);path=`${currentEmployeeId}/${crypto.randomUUID()}/${crypto.randomUUID()}.${info.ext}`;
        const upload=await client().storage.from('employee-attachments').upload(path,file,{contentType:info.mime,upsert:false});
        if(upload.error)throw upload.error;uploadedPath=path;name=file.name.slice(0,200);mime=info.mime;}
      const data={employee_id:currentEmployeeId,title:clean($('eaTitle').value),category:clean($('eaCategory').value),
        notes:clean($('eaNotes').value),file_path:path,file_name:name,mime_type:mime,updated_at:new Date().toISOString()};
      const query=old?client().from('employee_attachments').update(data).eq('id',old.id):client().from('employee_attachments').insert(data);
      const {error:dbError}=await query;if(dbError)throw dbError;
      uploadedPath=null;
      if(old&&file){const removed=await client().storage.from('employee-attachments').remove([old.file_path]);
        if(removed.error)alert('O anexo foi salvo, mas o arquivo anterior não pôde ser removido: '+removed.error.message);}
      $('employeeAttachmentDialog').close();editingAttachmentId=null;
      await renderAttachments(currentEmployeeId);
    }catch(e){if(uploadedPath)await client().storage.from('employee-attachments').remove([uploadedPath]);err.textContent='Não foi possível salvar: '+e.message;err.hidden=false;}
    finally{savingAttachment=false;$('employeeAttachmentSave').disabled=false;}
  }
  async function deleteAttachment(id){
    if(!auth().canEdit('employees'))return;const item=attachments.find(x=>x.id===id);if(!item)return;
    if(!confirm(`Deseja realmente excluir o anexo "${item.title}"?`))return;
    const {error}=await client().from('employee_attachments').delete().eq('id',id);
    if(error){alert('Não foi possível excluir: '+error.message);return;}
    const removed=await client().storage.from('employee-attachments').remove([item.file_path]);
    if(removed.error)alert('O registro foi excluído, mas o arquivo privado não pôde ser removido: '+removed.error.message);
    await renderAttachments(currentEmployeeId);
  }
  async function openAttachment(id,download=false){
    const item=attachments.find(x=>x.id===id);if(!item)return;
    const directDownload=download||!['application/pdf','image/jpeg','image/png'].includes(item.mime_type);
    const tab=directDownload?null:window.open('about:blank','_blank');
    try{
      const {data,error}=await client().storage.from('employee-attachments').createSignedUrl(item.file_path,60,directDownload?{download:item.file_name}:{});
      if(error)throw error;
      if(directDownload){const link=document.createElement('a');link.href=data.signedUrl;link.download=item.file_name;link.click();}
      else if(tab)tab.location.href=data.signedUrl;else window.location.href=data.signedUrl;
    }catch(e){tab?.close();alert('Não foi possível abrir o anexo: '+e.message);}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-import-line],[data-cert-view],[data-cert-download],[data-cert-edit],[data-cert-delete],[data-attach-view],[data-attach-download],[data-attach-edit],[data-attach-delete]');if(!button)return;
    if(button.dataset.importLine)editImportLine(button.dataset.importLine);
    if(button.dataset.certView)openCertificate(button.dataset.certView);
    if(button.dataset.certDownload)openCertificate(button.dataset.certDownload,true);
    if(button.dataset.certEdit)openCertificateForm(currentEmployeeId,button.dataset.certEdit);
    if(button.dataset.certDelete)deleteCertificate(button.dataset.certDelete);
    if(button.dataset.attachView)openAttachment(button.dataset.attachView);
    if(button.dataset.attachDownload)openAttachment(button.dataset.attachDownload,true);
    if(button.dataset.attachEdit)openAttachmentForm(currentEmployeeId,button.dataset.attachEdit);
    if(button.dataset.attachDelete)deleteAttachment(button.dataset.attachDelete);
  });
  window.SPFLY_EMPLOYEE={openImport,closeImport,downloadTemplate,readImportFile,closeImportEdit,saveImportEdit,confirmImport,
    renderCertificates,openCertificateForm,closeCertificateForm,saveCertificate,
    renderAttachments,openAttachmentForm,closeAttachmentForm,saveAttachment};
})();
