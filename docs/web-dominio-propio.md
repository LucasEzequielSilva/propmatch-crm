# Web de la inmobiliaria con dominio propio

La web pública de cada inmobiliaria vive en `https://<app>/sitio/<slug>` (y cada propiedad en
`/sitio/<slug>/p/<id>`). El slug sale de Publicaciones → tarjeta **Mi web** («Copiar link»), con la
forma `nombre-<8 hex>` (ver `shared/publicSite.ts`).

Para que se vea en un dominio de la inmobiliaria (p. ej. `www.lopezpropiedades.com.ar`) hay tres
pasos. Ninguno toca la base.

## 1. Agregar el dominio en el proyecto de Vercel

Sin este paso Vercel no responde en ese dominio, aunque el DNS apunte bien.

- Vercel → proyecto del CRM → **Settings → Domains → Add** → `www.lopezpropiedades.com.ar`
  (y, si la quieren sin `www`, también `lopezpropiedades.com.ar` con redirección a la `www`).
- Por CLI: `vercel domains add www.lopezpropiedades.com.ar <proyecto>`.
- Vercel muestra qué registro DNS espera y lo verifica solo. El certificado HTTPS lo emite Vercel.

## 2. DNS en el proveedor del dominio (NIC Argentina, DonWeb, GoDaddy, Cloudflare…)

| Host | Tipo | Valor |
| --- | --- | --- |
| `www` | CNAME | `cname.vercel-dns.com` |
| `@` (dominio raíz) | A | `76.76.21.21` |

Usar exactamente los valores que muestra Vercel en el paso 1 (pueden cambiar). Con Cloudflare, dejar
el registro en «DNS only» (nube gris) hasta que Vercel verifique. La propagación tarda de minutos a
unas horas.

Si la inmobiliaria ya tiene un sitio en ese dominio y no quiere cambiarlo, hay dos alternativas: un
subdominio (`propiedades.lopezpropiedades.com.ar` → CNAME, mismos pasos) o insertar la web con el
código de **Mi web → Insertar en mi sitio** (iframe, sin DNS).

## 3. Mapear el dominio al slug (servir la web en la raíz)

El front lee la variable de entorno de build `VITE_CUSTOM_DOMAINS` y, si el host está en la lista,
muestra solo la web de esa inmobiliaria en la raíz: `/` = catálogo y `/p/<id>` = propiedad. El CRM
no se expone en ese dominio (`src/features/sitio/CustomDomainApp.tsx`, `customDomain.ts`).

```
VITE_CUSTOM_DOMAINS=www.lopezpropiedades.com.ar=lopez-propiedades-1ffdbb92,lopezpropiedades.com.ar=lopez-propiedades-1ffdbb92
```

- Se carga en Vercel → Settings → Environment Variables (Production) y hace falta **un deploy nuevo**
  porque se lee al compilar.
- `CUSTOM_DOMAINS` (misma forma, sin `VITE_`) la usa el servidor para la vista previa de los links
  (Open Graph). Si no está, usa `VITE_CUSTOM_DOMAINS`.
- Los links `/sitio/<slug>/…` también funcionan en el dominio propio.

### Vista previa de links (WhatsApp, Facebook) en el dominio propio

`vercel.json` manda a los bots de `/sitio/*` a `/api/web?action=og`. Para la raíz de un dominio
propio hay que agregar, por dominio, dos reglas ANTES de la regla `/(.*)` (no pueden ser genéricas
porque romperían la raíz del CRM):

```json
{
  "source": "/",
  "has": [
    { "type": "host", "value": "www.lopezpropiedades.com.ar" },
    { "type": "header", "key": "user-agent", "value": ".*(facebookexternalhit|Facebot|meta-externalagent|WhatsApp|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot).*" }
  ],
  "destination": "/api/web?action=og"
},
{
  "source": "/p/:id",
  "has": [
    { "type": "host", "value": "www.lopezpropiedades.com.ar" },
    { "type": "header", "key": "user-agent", "value": ".*(facebookexternalhit|Facebot|meta-externalagent|WhatsApp|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot).*" }
  ],
  "destination": "/api/web?action=og&id=:id"
}
```

`api/_lib/routes/web/og.ts` resuelve el slug por el host (con `CUSTOM_DOMAINS`) y arma la URL
canónica en la raíz.

## Cuando haya muchas inmobiliarias

La lista en una variable de entorno sirve para pocas. A escala conviene una tabla
`agency_domains (domain text primary key, agency_id uuid)` y que `/api/web/site` acepte `?host=`:
el front le pediría el slug al servidor en vez de leer la variable. Vercel también permite agregar
dominios por API (`POST /v10/projects/{id}/domains`), así que se podría ofrecer desde Configuración.
No está hecho: requiere aprobación (base compartida con la app y un token de Vercel en el servidor).

## Marca

El logo, los colores y los datos de contacto de la web salen de Configuración → **Marca de tu
inmobiliaria** (publicada en `property-photos/<agency_id>/branding/`, ver `shared/brand.ts`).
