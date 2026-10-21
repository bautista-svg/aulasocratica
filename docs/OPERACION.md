# Operación: despliegue, configuración, backups y recuperación

## Dónde corre

| Pieza | Dónde | Detalle |
|---|---|---|
| App (web + API) | Coolify, proyecto **Aula Socrática**, entorno *production*, app `aulasocratica` | Build con `Dockerfile` desde `github.com/bautista-svg/aulasocratica` (privado, rama `main`, clave de despliegue de solo lectura) |
| Dominio | `https://aulasocratica.becode.com.ar` | Cloudflare (proxy) → Traefik de Coolify (certificado Let's Encrypt) |
| Base de datos | Coolify, `aulasocratica-db` (postgres:17-alpine) | Sin puerto público; la app la usa por la red interna de Docker |
| Archivos subidos | Volumen persistente `aulasocratica-data` montado en `/data` | `DATA_DIR=/data`, subcarpeta `uploads/` |
| Secretos | Variables de entorno de la app en Coolify | Copia local fuera del repo: `C:\Users\gonib\Downloads\coolify-conexion\aulasocratica-secrets.env` |

Es **una sola instancia** a propósito: el límite de solicitudes y el aviso en vivo al docente viven en memoria.
Para escalar a varias réplicas hay que mover ambos a Postgres o Redis.

## Variables de entorno

| Variable | Obligatoria | Ejemplo / valor | Para qué |
|---|---|---|---|
| `NODE_ENV` | sí | `production` | Activa HSTS, cookies `Secure`, validaciones de producción |
| `PORT` | sí | `3000` | Puerto interno (Coolify expone 3000) |
| `DATABASE_URL` | sí | `postgres://aula:…@<host-interno>:5432/aula` | Conexión a Postgres (URL interna de Coolify) |
| `DATABASE_POOL_MAX` | no | `10` | Conexiones máximas |
| `DATA_DIR` | sí | `/data` | Archivos subidos (volumen persistente) |
| `PUBLIC_URL` | sí | `https://aulasocratica.becode.com.ar` | Origen permitido (CSRF), cookies seguras |
| `TRUST_PROXY` | sí | `true` | Tomar la IP real de `CF-Connecting-IP` / `X-Forwarded-For` |
| `ANTHROPIC_API_KEY` | para IA | `sk-ant-…` | Claude |
| `ANTHROPIC_WORKSPACE_ID` | si la key no es de un workspace | `wrkspc_…` | Header `anthropic-workspace-id` (keys de usuario/organización). **En producción está cargada**: sin ella toda la IA responde 401 |
| `ANTHROPIC_BASE_URL` | no | — | Solo para pruebas locales con la IA simulada (`scripts/dev/fake-claude.mjs`); vacío en producción |
| `AI_MODEL` | no | `claude-haiku-5-5` | Modelo |
| `AI_DAILY_USD_PER_WORKSPACE` | no | `3` | Tope diario de gasto en IA por espacio docente, en USD (calculado con el uso real y los precios del modelo) |
| `AI_DAILY_USD_GLOBAL` | no | `40` | Tope diario de gasto en IA de todo el sitio, en USD |
| `AI_DAILY_REPLIES_PER_STUDENT` | no | `150` | Respuestas del tutor por alumno, por día y por actividad |
| `STORAGE_QUOTA_MB_PER_WORKSPACE` | no | `2048` | Espacio en disco por espacio docente (subidas, duplicados, Crear con IA) |
| `ADMIN_PASSWORD` | no | 28 caracteres aleatorios | Habilita `/admin` (vacío = deshabilitado) |
| `LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error` |

Si la IA no está configurada o la key no funciona, la app sigue andando: los docentes ven un aviso y las acciones con IA
explican por qué no están disponibles. Estado de la IA: `GET /api/health/ai` (requiere sesión docente).

## Desplegar

1. `git push origin main` (desde esta carpeta).
2. Coolify construye la imagen y la reemplaza cuando el health check (`GET /api/health`, que verifica la base) responde 200.
   Si el nuevo contenedor no queda sano, Coolify mantiene el anterior.
3. Las migraciones de base se aplican solas al arrancar (`drizzle/*.sql`, con lock para que no corran dos a la vez).

Disparar un deploy manual por API:

```bash
curl -X POST -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "content-type: application/json" \
  -d '{"uuid":"<COOLIFY_APP_UUID>","force":false}' https://coolify.becode.com.ar/api/v1/deploy
```

## Volver a una versión anterior (rollback)

- **Código**: en Coolify → app `aulasocratica` → *Deployments* → elegir un deployment anterior → *Redeploy*, o
  `git revert <commit> && git push`.
- **Base**: las migraciones solo agregan; si una migración nueva hubiera que deshacerla, se escribe una migración
  inversa (nunca se edita una migración ya aplicada).

## Backups

- **Base**: backup programado de Coolify sobre `aulasocratica-db`, todos los días a las 06:00 UTC (03:00 en Argentina),
  `pg_dump` de la base `aula`, se conservan los últimos 14 (y como máximo 30 días) en el servidor.
  Ver/forzar en Coolify → `aulasocratica-db` → *Backups*.
- **Archivos**: el volumen `aulasocratica-data`. Copia manual desde el servidor:
  `docker run --rm -v aulasocratica-data:/data -v $(pwd):/out alpine tar czf /out/aula-data-$(date +%F).tgz -C /data .`
- Recomendación pendiente: configurar un destino S3 en Coolify para tener una copia fuera de la VPS.

## Restaurar

Base (desde un dump de Coolify, formato custom de `pg_dump`):

```bash
# 1. Detener la app en Coolify (para que nadie escriba durante la restauración).
# 2. Copiar el dump al contenedor de la base y restaurar:
docker cp aula-backup.dmp <contenedor-db>:/tmp/aula.dmp
docker exec -it <contenedor-db> pg_restore -U aula -d aula --clean --if-exists /tmp/aula.dmp
# 3. Iniciar la app. Verificar GET /api/health.
```

Archivos:

```bash
docker run --rm -v aulasocratica-data:/data -v $(pwd):/in alpine sh -c "cd /data && tar xzf /in/aula-data-AAAA-MM-DD.tgz"
```

## Retención de datos (automática)

Tarea en el proceso (`src/server/services/retention.ts`, cada 6 h):
- Espacios sin cuenta y sin contenido: se borran a los 30 días sin uso.
- Espacios sin cuenta con contenido: se borran a los 12 meses sin uso.
- Espacios con cuenta: se conservan hasta que el docente los borra.
- Sesiones vencidas, respuestas del tutor interrumpidas (más de 10 min), registros de auditoría (180 días) y de uso de IA (400 días).

## Monitoreo

- Logs JSON por stdout (Coolify → app → *Logs*). Nunca contienen mensajes de alumnos ni secretos.
- `GET /api/health` → `{"status":"ok","db":"ok"}`; 503 si la base no responde.
- `/admin` (con `ADMIN_PASSWORD`): totales, uso de IA por día y por propósito con costo estimado, espacios y suspensión.
