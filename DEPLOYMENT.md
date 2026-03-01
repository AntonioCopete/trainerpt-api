# TrainerPT Backend - Deployment Guide

## Pre-requisitos en GCP

### 1. Crear Artifact Registry (solo primera vez)

```bash
gcloud artifacts repositories create trainerpt \
  --repository-format=docker \
  --location=europe-west1 \
  --description="TrainerPT Docker images"
```

### 2. Dar permisos a Cloud Build

```bash
# Service account de Cloud Build
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
CLOUD_BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Permisos para ejecutar Cloud Run Jobs
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CLOUD_BUILD_SA}" \
  --role="roles/run.admin"

# Permisos para acceder a Secret Manager
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${CLOUD_BUILD_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

### 3. Configurar secretos en Secret Manager

Si no lo has hecho ya:

```bash
# DATABASE_URL (producción)
echo -n "postgresql://USER:PASSWORD@HOST:5432/DATABASE" | \
  gcloud secrets create DATABASE_URL_PROD --data-file=-

# O actualizar versión:
echo -n "postgresql://USER:PASSWORD@HOST:5432/DATABASE" | \
  gcloud secrets versions add DATABASE_URL_PROD --data-file=-
```

### 4. Configurar variables de entorno en Cloud Run

El servicio necesita estas variables (además de DATABASE_URL que viene del Job):

```bash
gcloud run services update trainerpt-prod-api \
  --region=europe-west1 \
  --set-env-vars="PORT=8080" \
  --set-env-vars="WEB_URL=https://tu-frontend.com" \
  --set-env-vars="SUPABASE_JWT_ISSUER=https://xxx.supabase.co/auth/v1" \
  --set-env-vars="SUPABASE_JWT_AUDIENCE=authenticated" \
  --set-env-vars="GCS_BUCKET=trainerpt-dev"
```

### 5. Service Account JSON para GCS

El contenedor necesita `GOOGLE_APPLICATION_CREDENTIALS`, pero en Cloud Run usa **Workload Identity**:

```bash
# Crear service account
gcloud iam service-accounts create trainerpt-api \
  --display-name="TrainerPT API Service Account"

# Dar acceso al bucket GCS
gsutil iam ch serviceAccount:trainerpt-api@PROJECT_ID.iam.gserviceaccount.com:objectAdmin \
  gs://trainerpt-dev

# Asignar al servicio Cloud Run
gcloud run services update trainerpt-prod-api \
  --region=europe-west1 \
  --service-account=trainerpt-api@PROJECT_ID.iam.gserviceaccount.com
```

**IMPORTANTE**: Modifica `s3-upload.service.ts` para NO usar el JSON en producción:

```typescript
constructor(private readonly config: ConfigService) {
  this.bucket = this.config.get<string>('GCS_BUCKET') ?? '';
  
  // En local usa JSON, en Cloud Run usa Workload Identity
  const keyFilename = this.config.get<string>('GOOGLE_APPLICATION_CREDENTIALS');
  this.storage = new Storage(
    keyFilename ? { keyFilename } : {} // Si no hay JSON, usa ADC
  );
}
```

## Desplegar

### Primera vez (crear el servicio)

```bash
# Build manual del Job de migraciones (primera vez)
docker build -t europe-west1-docker.pkg.dev/PROJECT_ID/trainerpt/trainerpt-prod-api:init .
docker push europe-west1-docker.pkg.dev/PROJECT_ID/trainerpt/trainerpt-prod-api:init

gcloud run jobs create trainerpt-prod-migrate \
  --image=europe-west1-docker.pkg.dev/PROJECT_ID/trainerpt/trainerpt-prod-api:init \
  --region=europe-west1 \
  --set-secrets="DATABASE_URL=DATABASE_URL_PROD:latest" \
  --command="sh" \
  --args="-c,pnpm run db:update" \
  --max-retries=0 \
  --task-timeout=5m

# Trigger Cloud Build
gcloud builds submit --config=cloudbuild.yaml
```

### Despliegues siguientes

```bash
gcloud builds submit --config=cloudbuild.yaml
```

O conecta con GitHub para CI/CD automático.

## Flujo de despliegue

1. **Build**: Construye imagen Docker multi-stage
2. **Push**: Sube imagen a Artifact Registry
3. **Migrate**: Ejecuta `prisma migrate deploy` en un Cloud Run Job
   - Si falla, el deploy se detiene ✅
   - Logs en Cloud Logging
4. **Deploy**: Solo si las migraciones pasan, despliega la nueva versión del servicio

## Ventajas vs buildpacks

✅ Control total del build
✅ Migraciones atómicas (fallan antes del deploy)
✅ Cacheo eficiente de layers
✅ `prisma` compila correctamente
✅ Logs claros de cada paso
✅ Rollback fácil (solo cambiar tag de imagen)

## Troubleshooting

### Error: "repository not found"

Crea el repositorio de Artifact Registry (paso 1).

### Error: "permission denied"

Da los permisos IAM necesarios (paso 2).

### Migraciones fallan pero servicio se despliega

Verifica que el Job de migraciones existe y tiene los secretos correctos.

### GCS auth error en Cloud Run

Verifica que el service account tiene permisos en el bucket y que el servicio usa ese SA.
