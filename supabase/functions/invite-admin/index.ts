import { withSupabase } from 'npm:@supabase/server@^1'

const SITE_URL = 'https://gabproti.github.io/spfly-gestao-treinamentos/'

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Método não permitido.' }, { status: 405 })
    }

    const callerId = ctx.userClaims?.id
    if (!callerId) {
      return Response.json({ error: 'Sessão inválida.' }, { status: 401 })
    }

    const { data: admin, error: adminError } = await ctx.supabase
      .from('admin_users')
      .select('id')
      .eq('id', callerId)
      .eq('active', true)
      .maybeSingle()

    if (adminError || !admin) {
      return Response.json({ error: 'Somente administradores podem enviar convites.' }, { status: 403 })
    }

    let email = ''
    try {
      const body = await request.json()
      email = String(body.email || '').trim().toLowerCase()
    } catch {
      return Response.json({ error: 'Dados inválidos.' }, { status: 400 })
    }

    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'Informe um e-mail válido.' }, { status: 400 })
    }

    const { data: invited, error: inviteError } = await ctx.supabaseAdmin.auth.admin
      .inviteUserByEmail(email, { redirectTo: SITE_URL })

    if (inviteError || !invited.user) {
      return Response.json({ error: inviteError?.message || 'Não foi possível enviar o convite.' }, { status: 400 })
    }

    const { error: insertError } = await ctx.supabaseAdmin.from('admin_users').insert({
      id: invited.user.id,
      email,
      invited_by: callerId,
      active: true,
    })

    if (insertError) {
      // Sem o cadastro na lista de administradores, a conta não acessa os dados.
      return Response.json({ error: 'Convite enviado, mas a autorização falhou. Contate o responsável pelo projeto.' }, { status: 500 })
    }

    return Response.json({ ok: true, email })
  }),
}
