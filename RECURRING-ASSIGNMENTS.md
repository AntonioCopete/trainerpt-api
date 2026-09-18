# Configuración de Recurring Assignments

## Overview

Los assignments recurrentes (weekly/monthly) ahora están completamente soportados con un sistema híbrido:

1. **Lazy creation**: Cuando el member responde, el siguiente assignment se crea automáticamente
2. **Cron cleanup**: Un job diario marca como "missed" los assignments vencidos y crea el siguiente

## ⚠️ Importante: Fechas en UTC

**Todas las fechas se manejan en UTC** para evitar problemas de zona horaria:

- ✅ PostgreSQL almacena timestamps en UTC automáticamente
- ✅ `new Date()` en JavaScript crea fechas en UTC internamente
- ✅ Las operaciones de fecha (sumar días/meses) usan métodos UTC (`setUTCDate`, `setUTCMonth`)
- ✅ Las comparaciones de fechas funcionan correctamente sin importar la zona horaria del servidor

**Esto garantiza que:**

- Un assignment con `dueAt = "2026-03-20"` vence al fin de día UTC (23:59:59.999Z), sin importar dónde esté el servidor
- Cloud Scheduler ejecuta a las 02:00 UTC si configuras `--time-zone=UTC`
- No hay ambigüedad con cambios de horario de verano

## Estados de Assignment

- `pending`: Esperando respuesta del member
- `completed`: Member respondió a tiempo
- `missed`: Member no respondió antes de `dueAt`
- `archived`: Archivado manualmente

## Ventana de Respuesta

Para assignments recurrentes con `dueAt` definido:

- **Window Start**: `dueAt - 72 horas` → Member puede empezar a responder
- **Due At**: Fecha límite DURA → Después de esto = missed
- **No hay período de gracia después de dueAt**

## Configurar Cloud Scheduler (GCP)

### 1. Generar CRON_SECRET_TOKEN

```bash
# Generar token seguro
openssl rand -base64 32

# Example output (do not commit a real token):
# <CRON_SECRET_TOKEN>
```

### 2. Agregar secret en Cloud Run

```bash
# Opción A: Via Cloud Console
# 1. Ir a Cloud Run > Tu servicio > Edit & Deploy New Revision
# 2. En "Secrets" agregar:
#    - CRON_SECRET_TOKEN = <tu-token-generado>

# Opción B: Via gcloud
gcloud run services update trainerpt-backend \
  --update-secrets CRON_SECRET_TOKEN=cron-secret-token:latest \
  --region us-central1
```

### 3. Crear Cloud Scheduler Job

```bash
gcloud scheduler jobs create http process-overdue-assignments \
  --schedule="0 2 * * *" \
  --uri="https://trainerpt-backend-XXXXX.run.app/forms/internal/cron/process-overdue" \
  --http-method=POST \
  --headers="Authorization=Bearer <CRON_SECRET_TOKEN>" \
  --location=us-central1 \
  --time-zone="UTC"
```

**Parámetros:**

- `--schedule`: Cron expression (2 AM diario UTC)
- `--uri`: URL de tu servicio en Cloud Run
- `--headers`: Token de autorización (debe coincidir con CRON_SECRET_TOKEN)
- `--time-zone`: **UTC** para evitar problemas de zona horaria y cambios de horario de verano

### 4. Verificar el Job

```bash
# Listar jobs
gcloud scheduler jobs list --location=us-central1

# Ejecutar manualmente (para testing)
gcloud scheduler jobs run process-overdue-assignments --location=us-central1

# Ver logs
gcloud scheduler jobs describe process-overdue-assignments --location=us-central1
```

## Testing Local

### 1. Configurar .env

```bash
# .env
CRON_SECRET_TOKEN=dev-local-token-123
```

### 2. Llamar endpoint manualmente

```bash
curl -X POST http://localhost:3000/forms/internal/cron/process-overdue \
  -H "Authorization: Bearer dev-local-token-123"
```

### 3. Respuesta esperada

```json
{
  "processed": 2,
  "results": [
    { "id": "uuid-1", "status": "processed" },
    { "id": "uuid-2", "status": "processed" }
  ],
  "timestamp": "2026-03-18T20:00:00.000Z"
}
```

## Flujo Completo

### Caso 1: Member responde a tiempo

```
1. Trainer crea assignment recurrente (weekly, dueAt: 2026-03-20)
   → status: pending, windowStart: 2026-03-18

2. Member responde (2026-03-19)
   → Assignment #1: status = completed
   → Assignment #2: creado automáticamente (dueAt: 2026-03-27)

3. Cron ejecuta (2026-03-21 02:00 AM)
   → No encuentra Assignment #1 (ya está completed)
   → Processed: 0
```

### Caso 2: Member NO responde

```
1. Trainer crea assignment recurrente (weekly, dueAt: 2026-03-20)
   → status: pending, windowStart: 2026-03-18

2. Pasa dueAt sin respuesta (2026-03-21 00:01)
   → Assignment #1: sigue en pending
   → Member intenta responder → Error: "Deadline has passed"

3. Cron ejecuta (2026-03-21 02:00 AM)
   → Encuentra Assignment #1 (pending + dueAt < now)
   → Assignment #1: status = missed
   → Assignment #2: creado automáticamente (dueAt: 2026-03-27)
   → Processed: 1
```

## Costos

- **Cloud Scheduler**: GRATIS para los primeros 3 jobs/mes
- **Después**: $0.10 por millón de invocaciones
- **Estimado**: $0.003/mes para 1 job diario

## Monitoreo

Ver logs del cron job en Cloud Run:

```bash
gcloud run services logs read trainerpt-backend \
  --filter="textPayload:process-overdue" \
  --limit=50 \
  --region=us-central1
```

## Troubleshooting

### Error: "CRON_SECRET_TOKEN not configured"

Asegúrate de que la variable de entorno está configurada en Cloud Run.

### Error: "Invalid cron token"

El token en el header de Cloud Scheduler no coincide con CRON_SECRET_TOKEN.

### El job no se ejecuta

Verifica:

1. El job está habilitado: `gcloud scheduler jobs describe ...`
2. La URL es correcta (incluye https://)
3. El servicio de Cloud Run está deployed y corriendo
