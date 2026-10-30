import { withSupabase } from 'npm:@supabase/server@^1'

const allowedPages = new Set(['dashboard', 'employees', 'trainings', 'reports', 'capacitation'])
const editablePages = new Set(['employees', 'trainings', 'capacitation'])
const allowedRoles = new Set(['admin', 'usuario', 'gestor'])

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status })
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method !== 'POST') return errorResponse('Método não permitido.', 405)
    const callerId = ctx.userClaims?.id
    if (!callerId) return errorResponse('Sessão inválida.', 401)

    let body: Record<string, unknown>
    try { body = await request.json() } catch { return errorResponse('Dados inválidos.', 400) }

    if (body.action === 'change-first-password') {
      const password = String(body.password || '')
      const initialPassword = Deno.env.get('SPFLY_INITIAL_PASSWORD')
      if (!initialPassword) return errorResponse('Senha inicial não configurada no servidor.', 503)
      if (password.length < 12 || password.length > 128 || password === initialPassword) {
        return errorResponse('Escolha uma senha diferente da inicial, com 12 a 128 caracteres.', 400)
      }
      const { data: member, error: memberError } = await ctx.supabase
        .from('admin_users').select('id, must_change_password').eq('id', callerId).eq('active', true).maybeSingle()
      if (memberError || !member?.must_change_password) return errorResponse('Troca de senha não permitida.', 403)

      const { error: passwordError } = await ctx.supabaseAdmin.auth.admin.updateUserById(callerId, { password })
      if (passwordError) return errorResponse('Não foi possível alterar a senha: ' + passwordError.message, 400)
      const { error: accessError } = await ctx.supabaseAdmin.from('admin_users')
        .update({ must_change_password: false }).eq('id', callerId)
      if (accessError) return errorResponse('Senha alterada, mas a liberação do acesso falhou. Contate o administrador.', 500)
      return Response.json({ ok: true })
    }

    if (!['create-user', 'deactivate-user', 'reset-user-password'].includes(String(body.action))) {
      return errorResponse('Ação inválida.', 400)
    }
    const { data: admin, error: adminError } = await ctx.supabase
      .from('admin_users').select('id, access_role, must_change_password')
      .eq('id', callerId).eq('active', true).maybeSingle()
    if (adminError || admin?.access_role !== 'admin' || admin.must_change_password) {
      return errorResponse('Somente administradores podem gerenciar acessos.', 403)
    }

    if (body.action === 'deactivate-user' || body.action === 'reset-user-password') {
      const targetId = String(body.targetId || '').toLowerCase()
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)) {
        return errorResponse('Usuário inválido.', 400)
      }
      if (targetId === callerId) return errorResponse('Você não pode alterar seu próprio acesso por esta opção.', 400)
      const { data: target, error: targetError } = await ctx.supabaseAdmin.from('admin_users')
        .select('id, email, active, access_role, must_change_password').eq('id', targetId).maybeSingle()
      if (targetError || !target) return errorResponse('Conta não encontrada.', 404)
      if (!target.active) return errorResponse('Esta conta já está inativa.', 400)

      if (body.action === 'deactivate-user') {
        if (target.access_role === 'admin') {
          const { count, error: countError } = await ctx.supabaseAdmin.from('admin_users')
            .select('id', { count: 'exact', head: true }).eq('access_role', 'admin').eq('active', true)
          if (countError || count === null) return errorResponse('Não foi possível conferir os administradores ativos.', 503)
          if (count <= 1) return errorResponse('É necessário manter ao menos um administrador ativo.', 400)
        }
        if (target.access_role === 'gestor') {
          const { error: archiveError } = await ctx.supabase.rpc('hr_archive_manager_v56', { target_manager: targetId })
          if (archiveError) return errorResponse(archiveError.message, 400)
        } else {
          const { data: updated, error: updateError } = await ctx.supabaseAdmin.from('admin_users')
            .update({ active: false }).eq('id', targetId).eq('active', true).select('id').maybeSingle()
          if (updateError || !updated) return errorResponse('Não foi possível inativar a conta.', 500)
        }
        return Response.json({ ok: true })
      }

      const initialPassword = Deno.env.get('SPFLY_INITIAL_PASSWORD')
      if (!initialPassword || initialPassword.length < 6) return errorResponse('Senha inicial não configurada no servidor.', 503)
      const { error: flagError } = await ctx.supabaseAdmin.from('admin_users')
        .update({ must_change_password: true }).eq('id', targetId).eq('active', true)
      if (flagError) return errorResponse('Não foi possível preparar a troca de senha.', 500)
      const { error: passwordError } = await ctx.supabaseAdmin.auth.admin.updateUserById(targetId, { password: initialPassword })
      if (passwordError) {
        await ctx.supabaseAdmin.from('admin_users').update({ must_change_password: target.must_change_password }).eq('id', targetId)
        return errorResponse('Não foi possível redefinir a senha.', 500)
      }
      return Response.json({ ok: true, initialPassword })
    }

    const email = String(body.email || '').trim().toLowerCase()
    let fullName = String(body.fullName || '').trim().replace(/\s+/g, ' ')
    const role = String(body.role || '')
    const pages = Array.isArray(body.pages) ? body.pages : []
    const edits = Array.isArray(body.edits) ? body.edits : []
    let employeeId: number | null = null
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse('Informe um e-mail válido.', 400)
    if (!allowedRoles.has(role) || pages.some(page => typeof page !== 'string' || !allowedPages.has(page)) ||
        edits.some(page => typeof page !== 'string' || !editablePages.has(page) || !pages.includes(page)) ||
        (role === 'usuario' && pages.length === 0)) {
      return errorResponse('Perfil ou telas inválidos.', 400)
    }
    if (role === 'usuario' && pages.includes('capacitation')) {
      employeeId = Number(body.employeeId)
      if (!Number.isSafeInteger(employeeId) || employeeId <= 0) return errorResponse('Selecione um funcionário válido.', 400)
      const { data: state, error: stateError } = await ctx.supabaseAdmin.from('app_state')
        .select('employees').eq('id', 1).single()
      if (stateError) return errorResponse('Não foi possível conferir o cadastro do funcionário.', 503)
      const employee = (Array.isArray(state.employees) ? state.employees : [])
        .find((item: { id?: number; name?: string; status?: string }) => Number(item.id) === employeeId)
      if (!employee || employee.status === 'Inativo') return errorResponse('Funcionário não encontrado ou inativo.', 400)
      if (!fullName) fullName = String(employee.name || '').trim().replace(/\s+/g, ' ')
    }
    if (fullName.length < 2 || fullName.length > 120) return errorResponse('Informe um nome entre 2 e 120 caracteres.', 400)
    const initialPassword = Deno.env.get('SPFLY_INITIAL_PASSWORD')
    if (!initialPassword || initialPassword.length < 6) return errorResponse('Senha inicial não configurada no servidor.', 503)

    const { data: created, error: createError } = await ctx.supabaseAdmin.auth.admin.createUser({
      email, password: initialPassword, email_confirm: true,
    })
    if (createError || !created.user) return errorResponse(createError?.message || 'Não foi possível criar a conta.', 400)

    const { error: insertError } = await ctx.supabaseAdmin.from('admin_users').insert({
      id: created.user.id, email, full_name: fullName, invited_by: callerId, active: true,
      access_role: role, allowed_pages: role === 'usuario' ? [...new Set(pages)] : [],
      editable_pages: role === 'usuario' ? [...new Set(edits)] : [],
      employee_id: employeeId,
      must_change_password: true,
    })
    if (insertError) {
      await ctx.supabaseAdmin.auth.admin.deleteUser(created.user.id)
      return errorResponse('Não foi possível autorizar a conta. Nenhum acesso foi criado.', 500)
    }
    return Response.json({ ok: true, email, fullName, initialPassword })
  }),
}
