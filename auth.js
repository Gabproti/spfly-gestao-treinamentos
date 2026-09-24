(function () {
  'use strict';

  const config = window.SPFLY_CONFIG || {};
  const screen = document.getElementById('authScreen');
  const app = document.getElementById('app');
  const loginCard = document.getElementById('loginCard');
  const setPasswordCard = document.getElementById('setPasswordCard');
  const profileCard = document.getElementById('profileCard');
  const inviteFlow = /(?:^|[&#?])type=invite(?:&|$)/.test(window.location.hash + window.location.search);
  let client;
  let version = 0;
  let saving = false;
  let currentUser = null;

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
    const { data, error } = await client.from('app_state')
      .select('version, employees, trainings').eq('id', 1).single();
    if (error) throw error;
    version = Number(data.version);
    employees = Array.isArray(data.employees) ? data.employees : [];
    trainings = Array.isArray(data.trainings) ? data.trainings : [];
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
      .select('id, active, full_name').eq('id', user.id).maybeSingle();
    if (adminError || !admin?.active) {
      await client.auth.signOut();
      currentUser = null;
      showLogin('Esta conta não tem acesso de administrador.');
      return;
    }

    currentUser = user;
    if (inviteFlow) {
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

    document.getElementById('currentAdminName').textContent = admin.full_name;
    screen.hidden = true;
    app.classList.add('authenticated');
    showPage(document.querySelector('.page.active')?.id || 'dashboard');
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
      .select('email, full_name, active, created_at').order('created_at');
    if (error) {
      container.textContent = 'Não foi possível carregar os administradores.';
      return;
    }
    container.replaceChildren();
    for (const admin of data || []) {
      const row = document.createElement('div');
      row.className = 'commitment-item';
      row.style.marginBottom = '8px';
      const email = document.createElement('strong');
      email.textContent = admin.full_name?.trim() ? `${admin.full_name} (${admin.email})` : admin.email + ' — cadastro pendente';
      const status = document.createElement('span');
      status.className = 'badge ' + (admin.active ? 'badge-green' : 'badge-red');
      status.textContent = admin.active ? 'Ativo' : 'Inativo';
      row.append(email, status);
      container.append(row);
    }
    if (!data?.length) container.textContent = 'Nenhuma conta encontrada.';
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
    employees = [];
    trainings = [];
    showLogin();
  }

  window.SPFLY_AUTH = { persist, renderAdmins, uploadFile, deleteFile, previewFile, editProfile, logout };

  if (!window.supabase?.createClient || !config.url || !config.publishableKey) {
    showLogin('Não foi possível carregar a configuração de acesso.');
    return;
  }

  client = window.supabase.createClient(config.url, config.publishableKey);

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
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      message('setPasswordMessage', error.message);
      return;
    }
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

  document.getElementById('inviteAdminForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('inviteAdminEmail').value.trim().toLowerCase();
    const button = event.target.querySelector('button[type=submit]');
    button.disabled = true;
    document.getElementById('inviteAdminMessage').textContent = 'Enviando...';
    try {
      const { data, error } = await client.functions.invoke('invite-admin', { body: { email } });
      if (error || data?.error) throw new Error(data?.error || error.message);
      document.getElementById('inviteAdminMessage').textContent = 'Convite enviado para ' + email + '.';
      document.getElementById('inviteAdminEmail').value = '';
      await renderAdmins();
    } catch (error) {
      document.getElementById('inviteAdminMessage').textContent = 'Não foi possível enviar o convite: ' + error.message;
    } finally {
      button.disabled = false;
    }
  });

  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      app.classList.remove('authenticated');
      showLogin();
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !currentUser || saving) return;
    const { data, error } = await client.from('app_state').select('version').eq('id', 1).single();
    if (!error && Number(data.version) !== version) {
      await loadSharedState();
      showPage(document.querySelector('.page.active')?.id || 'dashboard');
    }
  });

  bootstrap().catch((error) => showLogin('Falha na conexão: ' + error.message));
})();
