# Mi cuenta: cambiar email y contraseña

En **Configuración → Mi cuenta** cada usuario puede cambiar el email y la contraseña de su cuenta
(Supabase Auth, el mismo proyecto que usa la app). En la demo la tarjeta aparece deshabilitada.

- **Email**: `supabase.auth.updateUser({ email }, { emailRedirectTo: window.location.origin })`.
  Supabase manda un mail de confirmación; con **Secure email change** activo (Authentication →
  Providers → Email) manda un link al email actual y otro al nuevo, y hay que abrir los dos. El
  cambio se aplica recién al confirmar. Al volver (`#...&type=email_change`), el CRM muestra «Tu
  email ahora es X» y actualiza el perfil local (`src/features/auth/EmailChangeNotice.tsx`).
- **Contraseña**: `updateUser({ password })`, mínimo 8 caracteres. Si Supabase pide
  reautenticación (**Secure password change** y sesión de más de 24 h), el CRM manda un código por
  mail (`reauthenticate()`) y lo pide antes de guardar (`updateUser({ password, nonce })`).

Validación y mensajes de error: `src/lib/accountAuth.ts` (pruebas: `npm run test:cuenta`).

## Configuración necesaria en Supabase (una vez)

Para que los links de los mails (confirmar cambio de email, restablecer contraseña, confirmar
alta) vuelvan al CRM y no a la app, el dominio del CRM tiene que estar permitido como destino:

- Supabase → **Authentication → URL Configuration → Redirect URLs → Add URL** →
  `https://propmatch-crm-taupe.vercel.app/**`
- Para probar en local, también `http://localhost:5180/**`.
- **No cambiar el Site URL**: lo usa la app. Si el destino que pide el CRM no está en la lista,
  Supabase manda al usuario al Site URL (la app) en vez de al CRM.

Si se agrega un dominio propio para el CRM, sumarlo a la lista con el mismo formato (`https://<dominio>/**`).
