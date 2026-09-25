(function () {
  'use strict';

  const config = window.SPFLY_CONFIG || {};
  const screen = document.getElementById('authScreen');
  const app = document.getElementById('app');
  const loginCard = document.getElementById('loginCard');
  const setPasswordCard = document.getElementById('setPasswordCard');
  const profileCard = document.getElementById('profileCard');
  const linkType = (window.location.hash + window.location.search).match(/(?:^|[&#?])type=(invite|recovery)(?:&|$)/)?.[1] || '';
  let recoveryFlow = linkType === 'recovery';
  let firstAccessFlow = false;
  let client;
  let version = 0;
  let saving = false;
  let currentUser = null;
  let currentAccess = null;

  const pageNames = { dashboard: 'dashboard', pageEmployees: 'employees', pageNewEmployee: 'employees',
    pageTrainings: 'trainings', pageNewTraining: 'trainings', pageTrainingDetail: 'trainings',
    pageReportEmployee: 'reports', pageReportTraining: 'reports', pageReportSector: 'reports',
    pageCapacitation: 'capacitation', pageCapTrackForm: 'capacitation', pageCapTrackDetail: 'capacitation' };
  const roleNames = { admin: 'Administrador', rh: 'RH', usuario: 'Usuário', funcionario: 'Funcionário' };
  function canPage(pageId) {
    if (!currentAccess?.active || currentAccess.must_change_password) return false;
    if (currentAccess.access_role === 'admin') return true;
    const page = pageNames[pageId];
    if (!page) return false;
    if (currentAccess.access_role === 'rh') return page === 'employees' || page === 'trainings' || page === 'capacitation';
    if (currentAccess.access_role === 'funcionario') return page === 'capacitation';
    return currentAccess.access_role === 'usuario' && currentAccess.allowed_pages?.includes(page);
  }
  function applyAccess() {
    document.querySelectorAll('.nav-btn[data-page]').forEach(button => { button.hidden = !canPage(button.dataset.page); });
    document.querySelectorAll('.nav-btn[data-menu]').forEach(button => {
      button.hidden = button.dataset.menu === 'reports' ? !canPage('pageReportEmployee') : currentAccess.access_role !== 'admin';
    });
    document.querySelectorAll('[data-requires-page]').forEach(button => { button.hidden = !canPage(button.dataset.requiresPage); });
    document.getElementById('globalSearch').parentElement.hidden = !canPage('pageEmployees');
  }

  function message(id, text, success = false) {
    const element = document.getElementById(id);
    element.textContent = text;
    element.classList.toggle('success', success);
  }

  function showLogin(text = '') {
    app.classList.remove('authenticated');
    screen.hidden = false;
    loginCard.hidden = false;
    setPasswordCard.hidden = true;
    profileCard.hidden = true;
    message('loginMessage', text);
  }

  function showPasswordSetup() {
    app.classList.remove('authenticated');
    screen.hidden = false;
    loginCard.hidden = true;
    setPasswordCard.hidden = false;
    profileCard.hidden = true;
    document.getElementById('passwordSetupTitle').textContent = firstAccessFlow ? 'Trocar senha inicial' : recoveryFlow ? 'Redefinir senha' : 'Definir senha';
    document.getElementById('passwordSetupDescription').textContent = firstAccessFlow ? 'Para liberar seu acesso, escolha uma senha diferente da inicial, com pelo menos 12 caracteres.' : recoveryFlow ? 'Escolha uma nova senha para sua conta.' : 'Crie a senha da sua conta.';
  }

  function showProfileSetup(fullName = '') {
    app.classList.remove('authenticated');
    screen.hidden = false;
    loginCard.hidden = true;
    setPasswordCard.hidden = true;
    profileCard.hidden = false;
    document.getElementById('profileFullName').value = fullName;
    message('profileMessage', '');
  }

  async function loadSharedState() {
    const { data, error } = await client.rpc('load_portal_state');
    if (error) throw error;
    const state = Array.isArray(data) ? data[0] : data;
    version = Number(state.version);
    employees = Array.isArray(state.employees) ? state.employees : [];
    trainings = Array.isArray(state.trainings) ? state.trainings : [];
  }

  async function bootstrap() {
    const { data: userData, error: userError } = await client.auth.getUser();
    const user = userData?.user;
    if (userError || !user) {
      currentUser = null;
      showLogin();
      return;
    }

    const { data: admin, error: adminError } = await client.from('admin_users')
      .select('id, active, full_name, access_role, allowed_pages, must_change_password, employee_id').eq('id', user.id).maybeSingle();
    if (adminError || !admin?.active) {
      await client.auth.signOut();
      currentUser = null;
      showLogin('Esta conta não tem acesso ao portal.');
      return;
    }

    currentUser = user;
    currentAccess = admin;
    firstAccessFlow = Boolean(admin.must_change_password);
    if (linkType || firstAccessFlow) {
      showPasswordSetup();
      return;
    }
    if (!admin.full_name?.trim()) {
      showProfileSetup();
      return;
    }

    try {
      await loadSharedState();
    } catch (error) {
      showLogin('Não foi possível carregar os dados compartilhados: ' + error.message);
      return;
    }
    window.SPFLY_CAP?.configure(client, admin, user, employees);
    renderCreateEmployeeOptions();

    const displayName = admin.full_name.trim();
    const initials = displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('pt-BR');
    document.getElementById('currentAdminName').textContent = displayName;
    document.getElementById('sidebarAdminName').textContent = displayName;
    document.getElementById('topbarAdminInitials').textContent = initials;
    document.getElementById('sidebarAdminInitials').textContent = initials;
    document.getElementById('topbarAccessRole').textContent = roleNames[admin.access_role] || 'Usuário';
    document.getElementById('sidebarAccessRole').textContent = roleNames[admin.access_role] || 'Usuário';
    applyAccess();
    screen.hidden = true;
    app.classList.add('authenticated');
    const firstPage = admin.access_role === 'rh' ? 'pageEmployees'
      : admin.access_role === 'funcionario' ? 'pageCapacitation'
      : admin.access_role === 'usuario' ? ['dashboard','pageEmployees','pageTrainings','pageReportEmployee'].find(canPage)
      : 'dashboard';
    const currentPage = document.querySelector('.page.active')?.id;
    showPage(currentPage && canPage(currentPage) ? currentPage : firstPage);
  }

  async function persist(nextEmployees, nextTrainings) {
    if (!currentUser || saving) {
      alert('Aguarde o salvamento atual antes de fazer outra alteração.');
      return false;
    }
    saving = true;
    app.style.pointerEvents = 'none';
    app.setAttribute('aria-busy', 'true');
    try {
      const { data, error } = await client.rpc('save_app_state', {
        expected_version: version,
        next_employees: nextEmployees,
        next_trainings: nextTrainings,
      });
      if (error) throw error;
      version = Number(data);
      return true;
    } catch (error) {
      alert('Alteração não salva: ' + error.message + '\nOs dados serão recarregados do servidor.');
      try {
        await loadSharedState();
        const activePage = document.querySelector('.page.active')?.id || 'dashboard';
        showPage(activePage);
      } catch {
        app.classList.remove('authenticated');
        showLogin('Não foi possível recarregar os dados. Atualize a página antes de continuar.');
      }
      return false;
    } finally {
      saving = false;
      app.style.pointerEvents = '';
      app.removeAttribute('aria-busy');
    }
  }

  async function renderAdmins() {
    const container = document.getElementById('adminList');
    container.textContent = 'Carregando...';
    const { data, error } = await client.from('admin_users')
      .select('id, email, full_name, active, access_role, allowed_pages, must_change_password, employee_id, created_at').order('created_at');
    if (error) {
      container.textContent = 'Não foi possível carregar os acessos.';
      return;
    }
    container.replaceChildren();
    for (const admin of data || []) {
      const row = document.createElement('div');
      row.className = 'access-row';
      const header = document.createElement('div');
      header.className = 'access-row-head';
      const name = document.createElement('strong');
      name.textContent = admin.full_name?.trim() ? `${admin.full_name} (${admin.email})` : admin.email + ' — cadastro pendente';
      const badge = document.createElement('span');
      badge.className = 'badge ' + (admin.active ? 'badge-green' : 'badge-red');
      badge.textContent = admin.active ? 'Ativo' : 'Inativo';
      header.append(name, badge);
      if (admin.must_change_password) {
        const pending = document.createElement('small');
        pending.className = 'pending-password';
        pending.textContent = 'Aguardando troca da senha inicial';
        header.append(pending);
      }
      const controls = document.createElement('div');
      controls.className = 'access-controls';
      const role = document.createElement('select');
      role.setAttribute('aria-label', 'Perfil de ' + admin.email);
      for (const [value, label] of Object.entries(roleNames)) {
        if (value === 'funcionario' && !admin.employee_id) continue;
        const option = document.createElement('option'); option.value = value; option.textContent = label; role.append(option);
      }
      role.value = admin.access_role || 'admin';
      const checks = document.createElement('div');
      checks.className = 'access-checks';
      for (const [value, label] of Object.entries({ dashboard:'Início', employees:'Funcionários', trainings:'Treinamentos', reports:'Relatórios' })) {
        const wrapper = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.value = value; checkbox.checked = (admin.allowed_pages || []).includes(value);
        wrapper.append(checkbox, ' ' + label); checks.append(wrapper);
      }
      const updateVisibility = () => { checks.hidden = role.value !== 'usuario'; };
      role.addEventListener('change', updateVisibility); updateVisibility();
      const save = document.createElement('button');
      save.type = 'button'; save.className = 'btn btn-secondary'; save.textContent = 'Salvar acesso';
      save.disabled = admin.id === currentUser?.id || !admin.active;
      save.addEventListener('click', async () => {
        const pages = Array.from(checks.querySelectorAll('input:checked')).map(input => input.value);
        if (role.value === 'usuario' && !pages.length) { alert('Escolha ao menos uma tela.'); return; }
        save.disabled = true; save.textContent = 'Salvando...';
        const { error: saveError } = await client.rpc('set_portal_access', { target_id: admin.id, next_role: role.value, next_pages: pages });
        if (saveError) { alert('Não foi possível salvar o acesso: ' + saveError.message); save.disabled = false; save.textContent = 'Salvar acesso'; return; }
        await renderAdmins();
      });
      controls.append(role, checks, save);
      row.append(header, controls);
      container.append(row);
    }
    if (!data?.length) container.textContent = 'Nenhuma conta encontrada.';
  }

  function updateCreateRole() {
    const role = document.getElementById('createRole').value;
    document.getElementById('createPages').hidden = role !== 'usuario';
    document.getElementById('createEmployeeLink').hidden = role !== 'funcionario';
    document.getElementById('createEmployeeId').required = role === 'funcionario';
    document.getElementById('createUserName').readOnly = role === 'funcionario';
    if (role === 'funcionario') updateCreateEmployeeName();
  }

  function renderCreateEmployeeOptions() {
    const select = document.getElementById('createEmployeeId');
    const previous = select.value;
    select.replaceChildren(new Option('Selecione um funcionário', ''));
    for (const employee of employees.filter(item => item.status !== 'Inativo').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
      select.add(new Option(`${employee.name} — ${employee.mat}`, String(employee.id)));
    }
    if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
    updateCreateEmployeeName();
  }

  function updateCreateEmployeeName() {
    const employee = employees.find(item => String(item.id) === document.getElementById('createEmployeeId').value);
    if (employee) document.getElementById('createUserName').value = employee.name;
  }

  async function uploadFile(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('Cada arquivo deve ter no máximo 10 MB.');
    const safeName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const path = crypto.randomUUID() + '/' + safeName;
    const { error } = await client.storage.from('training-files').upload(path, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });
    if (error) throw error;
    return { name: file.name, type: file.type || '', path };
  }

  async function deleteFile(item) {
    if (!item?.path) return;
    const { error } = await client.storage.from('training-files').remove([item.path]);
    if (error) throw error;
  }

  async function editProfile() {
    const { data, error } = await client.from('admin_users')
      .select('full_name').eq('id', currentUser.id).single();
    if (error) {
      alert('Não foi possível abrir o cadastro: ' + error.message);
      return;
    }
    showProfileSetup(data.full_name || '');
  }

  async function previewFile(item, title) {
    if (!item?.name) {
      alert('Arquivo não encontrado.');
      return;
    }
    let url = item.dataUrl || '';
    if (item.path) {
      const { data, error } = await client.storage.from('training-files')
        .createSignedUrl(item.path, 60);
      if (error) {
        alert('Não foi possível abrir o arquivo: ' + error.message);
        return;
      }
      url = data.signedUrl;
    }
    const body = document.getElementById('modalBody');
    body.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'notice';
    heading.textContent = item.name;
    body.append(heading);
    if (url && item.type?.startsWith('image/')) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = item.name;
      image.style.cssText = 'max-width:100%;max-height:65vh;display:block;margin:auto;border-radius:8px';
      body.append(image);
    } else if (url && item.type === 'application/pdf') {
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.title = item.name;
      frame.style.cssText = 'width:100%;height:65vh;border:1px solid var(--border);border-radius:8px';
      body.append(frame);
    } else if (url) {
      const link = document.createElement('a');
      link.className = 'btn btn-primary';
      link.href = url;
      link.download = item.name;
      link.textContent = 'Baixar arquivo';
      body.append(link);
    } else {
      const note = document.createElement('p');
      note.textContent = 'Esta versão anterior registrou apenas o nome do arquivo.';
      body.append(note);
    }
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modal').classList.add('open');
  }

  async function logout() {
    await client.auth.signOut();
    currentUser = null;
    currentAccess = null;
    employees = [];
    trainings = [];
    showLogin();
  }

  window.SPFLY_AUTH = { persist, renderAdmins, uploadFile, deleteFile, previewFile, editProfile, logout, canPage, updateCreateRole, renderCreateEmployeeOptions, updateCreateEmployeeName };

  if (!window.supabase?.createClient || !config.url || !config.publishableKey) {
    showLogin('Não foi possível carregar a configuração de acesso.');
    return;
  }

  client = window.supabase.createClient(config.url, config.publishableKey);

  document.getElementById('toggleLoginPassword').addEventListener('click', () => {
    const input = document.getElementById('loginPassword');
    const button = document.getElementById('toggleLoginPassword');
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? 'Ocultar' : 'Mostrar';
    button.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
  });

  document.getElementById('forgotPassword').addEventListener('click', async () => {
    const emailInput = document.getElementById('loginEmail');
    const email = emailInput.value.trim();
    if (!email || !emailInput.checkValidity()) {
      message('loginMessage', 'Informe um e-mail válido para receber o link de recuperação.');
      emailInput.focus();
      return;
    }
    const button = document.getElementById('forgotPassword');
    button.disabled = true;
    message('loginMessage', 'Enviando o link de recuperação...');
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    button.disabled = false;
    message('loginMessage', error ? 'Não foi possível enviar o link: ' + error.message : 'Se houver uma conta para este e-mail, você receberá um link de recuperação.', !error);
  });

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    message('loginMessage', 'Verificando...');
    const { error } = await client.auth.signInWithPassword({ email, password });
    document.getElementById('loginPassword').value = '';
    if (error) {
      message('loginMessage', 'E-mail ou senha inválidos.');
      return;
    }
    await bootstrap();
  });

  document.getElementById('setPasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('newPassword').value;
    if (password !== document.getElementById('confirmPassword').value) {
      message('setPasswordMessage', 'As senhas não coincidem.');
      return;
    }
    message('setPasswordMessage', 'Salvando...');
    if (firstAccessFlow) {
      const { data, error } = await client.functions.invoke('invite-admin', {
        body: { action: 'change-first-password', password },
      });
      if (error || data?.error) {
        message('setPasswordMessage', data?.error || error?.message || 'Não foi possível alterar a senha.');
        return;
      }
    } else {
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        message('setPasswordMessage', error.message);
        return;
      }
    }
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    window.history.replaceState({}, '', window.location.pathname);
    window.location.reload();
  });

  document.getElementById('profileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fullName = document.getElementById('profileFullName').value.trim().replace(/\s+/g, ' ');
    if (fullName.length < 2 || fullName.length > 120) {
      message('profileMessage', 'Informe um nome entre 2 e 120 caracteres.');
      return;
    }
    const button = event.target.querySelector('button[type=submit]');
    button.disabled = true;
    message('profileMessage', 'Salvando...');
    const { error } = await client.from('admin_users').update({ full_name: fullName })
      .eq('id', currentUser.id).select('full_name').single();
    button.disabled = false;
    if (error) {
      message('profileMessage', 'Não foi possível salvar o nome: ' + error.message);
      return;
    }
    await bootstrap();
  });

  document.getElementById('createUserForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const fullName = document.getElementById('createUserName').value.trim().replace(/\s+/g, ' ');
    const email = document.getElementById('createUserEmail').value.trim().toLowerCase();
    const role = document.getElementById('createRole').value;
    const pages = Array.from(document.querySelectorAll('#createPages input:checked')).map(input => input.value);
    const employeeId = role === 'funcionario' ? Number(document.getElementById('createEmployeeId').value) : null;
    const result = document.getElementById('createdUserResult');
    result.hidden = true;
    result.replaceChildren();
    if (role === 'usuario' && !pages.length) {
      document.getElementById('createUserMessage').textContent = 'Escolha ao menos uma tela para o usuário.';
      return;
    }
    if (role === 'funcionario' && !employeeId) {
      document.getElementById('createUserMessage').textContent = 'Selecione o cadastro do funcionário.';
      return;
    }
    const button = event.target.querySelector('button[type=submit]');
    button.disabled = true;
    document.getElementById('createUserMessage').textContent = 'Criando conta...';
    try {
      const { data, error } = await client.functions.invoke('invite-admin', {
        body: { action: 'create-user', fullName, email, role, pages, employeeId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Erro desconhecido.');
      document.getElementById('createUserMessage').textContent = 'Usuário criado com sucesso.';
      const title = document.createElement('strong'); title.textContent = fullName + ' — ' + email;
      const password = document.createElement('code'); password.textContent = data.initialPassword;
      const note = document.createElement('p'); note.textContent = 'Senha inicial. Compartilhe apenas com esta pessoa. Ela deverá escolher outra senha no primeiro acesso.';
      result.append(title, password, note);
      result.hidden = false;
      document.getElementById('createUserName').value = '';
      document.getElementById('createUserEmail').value = '';
      document.getElementById('createRole').value = 'admin';
      document.getElementById('createEmployeeId').value = '';
      document.querySelectorAll('#createPages input').forEach(input => { input.checked = false; });
      updateCreateRole();
      await renderAdmins();
    } catch (error) {
      document.getElementById('createUserMessage').textContent = 'Não foi possível criar o usuário: ' + error.message;
    } finally {
      button.disabled = false;
    }
  });

  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      recoveryFlow = true;
      showPasswordSetup();
      return;
    }
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      app.classList.remove('authenticated');
      showLogin();
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !currentUser || saving) return;
    await bootstrap();
  });

  bootstrap().catch((error) => showLogin('Falha na conexão: ' + error.message));
})();
