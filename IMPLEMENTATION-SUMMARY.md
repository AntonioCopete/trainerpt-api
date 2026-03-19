# ✅ Implementación de Recurring Assignments - Completada

## 🎯 Resumen de Cambios

Se ha implementado completamente el sistema de assignments recurrentes (weekly/monthly) con enfoque híbrido.

## 📦 Archivos Modificados/Creados

### Schema y Base de Datos
- ✅ `prisma/schema.prisma`
  - Agregado estado `missed` a `AssignmentStatus`
  - Agregados campos: `windowStart`, `parentAssignmentId`
  - Agregada relación self-referencial `RecurringChain`
  - Agregado índice `@@index([status, dueAt])` para cron
  - Migración aplicada: `20260318203610_add_recurring_assignments_support`

### DTOs
- ✅ `src/forms/dto/create-form-template.dto.ts`
  - Agregado campo `repeat?: 'none' | 'weekly' | 'monthly'` a `AssignFormTemplateDto`

### Service
- ✅ `src/forms/forms.service.ts`
  - `assignTemplate()`: Calcula `windowStart` y guarda `repeat`
  - `submitAssignment()`: Validaciones de ventana y deadline + creación lazy del siguiente
  - `createNextRecurringAssignment()`: Método privado para crear siguiente assignment
  - `calculateNextDueAt()`: Calcula próximo dueAt según cadencia
  - `processOverdueAssignments()`: Endpoint de cron para marcar missed y crear siguientes

### Controller
- ✅ `src/forms/forms.controller.ts`
  - Agregado endpoint `POST /forms/internal/cron/process-overdue`

### Guards
- ✅ `src/common/guards/cron-auth.guard.ts`
  - Guard para proteger endpoint de cron con `CRON_SECRET_TOKEN`

### Documentación
- ✅ `RECURRING-ASSIGNMENTS.md`
  - Guía completa de configuración de Cloud Scheduler
  - Flujos de uso
  - Troubleshooting
- ✅ `.env.example`
  - Agregado `CRON_SECRET_TOKEN`

## 🔄 Flujo Implementado

### Caso 1: Member responde a tiempo (90% casos)
```
1. Trainer asigna (repeat='weekly', dueAt='2026-03-20')
   → Assignment #1: status='pending', windowStart='2026-03-18'

2. Member responde (2026-03-19)
   → submitAssignment():
     - Valida windowStart ✅
     - Valida dueAt ✅
     - Marca #1 como 'completed'
     - Crea #2 automáticamente (dueAt='2026-03-27')

3. Cron ejecuta (2026-03-21 02:00)
   → No encuentra #1 (ya completed)
   → Processed: 0
```

### Caso 2: Member NO responde (10% casos)
```
1. Trainer asigna (repeat='weekly', dueAt='2026-03-20')
   → Assignment #1: status='pending'

2. Pasa deadline (2026-03-21 00:01)
   → Member intenta responder
   → Error: "Assignment deadline has passed" ❌

3. Cron ejecuta (2026-03-21 02:00)
   → processOverdueAssignments():
     - Encuentra #1 (status='pending', dueAt < now)
     - Marca #1 como 'missed'
     - Crea #2 (dueAt='2026-03-27')
   → Processed: 1
```

## 🛡️ Validaciones Implementadas

En `submitAssignment()`:
1. ✅ No permitir responder antes de `windowStart` (-48h)
2. ✅ No permitir responder después de `dueAt`
3. ✅ No permitir responder si status = 'completed'
4. ✅ No permitir responder si status = 'missed'

## 📝 Estados de Assignment

| Estado | Descripción |
|--------|-------------|
| `pending` | Esperando respuesta del member |
| `completed` | Member respondió a tiempo |
| `missed` | Member no respondió antes de dueAt |
| `archived` | Archivado manualmente |

## 🚀 Próximos Pasos (Deployment)

### 1. Agregar variable de entorno en local
```bash
# .env
CRON_SECRET_TOKEN=$(openssl rand -base64 32)
```

### 2. Configurar en Cloud Run
```bash
# Crear secret en GCP Secret Manager
echo -n "$(openssl rand -base64 32)" | \
  gcloud secrets create cron-secret-token --data-file=-

# Actualizar Cloud Run service
gcloud run services update trainerpt-backend \
  --update-secrets CRON_SECRET_TOKEN=cron-secret-token:latest \
  --region us-central1
```

### 3. Crear Cloud Scheduler Job
```bash
# Obtener URL de tu servicio
SERVICE_URL=$(gcloud run services describe trainerpt-backend \
  --region us-central1 --format 'value(status.url)')

# Crear job (ejecuta diariamente a las 2 AM)
gcloud scheduler jobs create http process-overdue-assignments \
  --schedule="0 2 * * *" \
  --uri="${SERVICE_URL}/forms/internal/cron/process-overdue" \
  --http-method=POST \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=cron-secret-token)" \
  --location=us-central1 \
  --time-zone="America/New_York"
```

### 4. Testing
```bash
# Ejecutar manualmente
gcloud scheduler jobs run process-overdue-assignments \
  --location=us-central1

# Ver logs
gcloud run services logs read trainerpt-backend \
  --filter="textPayload:process-overdue" \
  --limit=10
```

## 💰 Costos
- Cloud Scheduler: **GRATIS** (primeros 3 jobs/mes)
- Estimado mensual: **$0.003**

## 📊 Endpoints Nuevos

### POST /forms/template/:templateId/assign
```json
{
  "memberId": "uuid",
  "dueAt": "2026-03-20T23:59:59Z",
  "repeat": "weekly"  // ← NUEVO: 'none' | 'weekly' | 'monthly'
}
```

### POST /forms/internal/cron/process-overdue
```bash
# Headers:
Authorization: Bearer <CRON_SECRET_TOKEN>

# Response:
{
  "processed": 2,
  "results": [
    { "id": "uuid-1", "status": "processed" },
    { "id": "uuid-2", "status": "processed" }
  ],
  "timestamp": "2026-03-18T20:00:00.000Z"
}
```

## ✅ Build Status
- Compilación: ✅ EXITOSA
- Migración: ✅ APLICADA
- Tests: ⏳ PENDIENTE (requiere testing manual)

## 🔍 Para Verificar

1. Crear assignment recurrente
2. Responder antes de dueAt → Verificar que se crea el siguiente
3. No responder y esperar a que pase dueAt → Intentar responder (debe fallar)
4. Ejecutar cron manualmente → Verificar que marca como missed y crea siguiente
