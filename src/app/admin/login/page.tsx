import { adminConfigured } from "@/affiliate/admin-auth";

export const dynamic = "force-dynamic";

export default async function AdminLogin({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  return <main className="admin-login-page"><div className="admin-login-card">
    <span className="admin-kicker">FraldaCerta</span><h1>Acesso administrativo</h1>
    {adminConfigured() ? <form action="/api/admin/login" method="post"><label htmlFor="admin-password">Senha</label><input id="admin-password" name="password" type="password" autoComplete="current-password" required /><button type="submit">Entrar</button>{erro && <p role="alert">Senha inválida. Tente novamente.</p>}</form> : <p>Configure as credenciais administrativas para habilitar o painel.</p>}
  </div></main>;
}
