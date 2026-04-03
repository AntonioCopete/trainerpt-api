# TrainerPT Backend

## 📚 Documentación

- **[RECURRING-ASSIGNMENTS.md](./RECURRING-ASSIGNMENTS.md)** - Guía completa de assignments recurrentes y configuración de Cloud Scheduler
- **[IMPLEMENTATION-SUMMARY.md](./IMPLEMENTATION-SUMMARY.md)** - Resumen de implementación de features recurrentes
- **[ROBUSTNESS.md](./ROBUSTNESS.md)** - Mejoras de robustez implementadas

## Deploy automático con GitHub Actions

Cada push a `main` ejecuta automáticamente:

1. ✅ Migraciones de base de datos (1 sola vez)
2. ✅ Deploy a Cloud Run

## Configuración inicial (una sola vez)

### Opción A: Workload Identity Federation (Recomendado - Sin keys)

#### 1. Crear Workload Identity Pool

```bash
PROJECT_ID="tu-project-id"
REPO="tu-usuario/tu-repo"  # Ejemplo: antoniocb/trainer

# Crear pool
gcloud iam workload-identity-pools create "github" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions Pool"

# Crear provider
gcloud iam workload-identity-pools providers create-oidc "github-provider" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="github" \
  --display-name="GitHub Provider" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Crear service account
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions"

# Dar permisos al service account
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:github-actions@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:github-actions@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Permitir que GitHub Actions use el service account
gcloud iam service-accounts add-iam-policy-binding \
  "github-actions@${PROJECT_ID}.iam.gserviceaccount.com" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}"
```

**Nota**: Reemplaza `PROJECT_NUMBER` con el número de tu proyecto (lo encuentras en Cloud Console).

#### 2. Configurar GitHub Secrets

```
DATABASE_URL           = postgresql://user:pass@host:5432/db
WIF_PROVIDER          = projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-provider
WIF_SERVICE_ACCOUNT   = github-actions@PROJECT_ID.iam.gserviceaccount.com
```

### Opción B: Service Account Key (Más simple pero menos seguro)

Si prefieres la forma simple con JSON key:

```bash
# Crear SA
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions"

# Dar permisos
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:github-actions@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:github-actions@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Crear key
gcloud iam service-accounts keys create key.json \
  --iam-account=github-actions@PROJECT_ID.iam.gserviceaccount.com
```

GitHub Secrets:

```
DATABASE_URL    = postgresql://user:pass@host:5432/db
GCP_SA_KEY      = (contenido completo del key.json)
```

Y cambiar en `.github/workflows/deploy.yml`:

```yaml
- uses: google-github-actions/auth@v2
  with:
    credentials_json: ${{ secrets.GCP_SA_KEY }}
```

### 3. Configurar variables de entorno en Cloud Run (solo primera vez)

Ve a Cloud Run Console → `trainerpt-prod-api` → Edit & Deploy New Revision → Variables:

```
PORT=8080
WEB_URL=https://tu-frontend.com
SUPABASE_JWT_ISSUER=https://xxx.supabase.co/auth/v1
SUPABASE_JWT_AUDIENCE=authenticated
GCS_BUCKET=trainerpt-dev
```

Y en "Secrets":

- `DATABASE_URL` → Reference secret `DATABASE_URL_PROD:latest`

Y en "Security":

- Service account: `trainerpt-api@PROJECT_ID.iam.gserviceaccount.com`

### 4. Crear secret DATABASE_URL en GCP Secret Manager (para Cloud Run)

```bash
echo -n "postgresql://user:pass@host:5432/db" | \
  gcloud secrets create DATABASE_URL_PROD --data-file=-
```

### 5. Crear service account para Cloud Run (acceso a GCS)

```bash
gcloud iam service-accounts create trainerpt-api \
  --display-name="TrainerPT API"

# Dar acceso al bucket
gsutil iam ch serviceAccount:trainerpt-api@PROJECT_ID.iam.gserviceaccount.com:objectAdmin \
  gs://trainerpt-dev
```

## Uso

```bash
git add .
git commit -m "update"
git push origin main
```

GitHub Actions automáticamente:

- Ejecuta migraciones
- Despliega a Cloud Run
- Si algo falla, no despliega

## Ventajas

✅ **Migraciones ejecutan 1 sola vez** en GitHub Actions (no en cada contenedor)  
✅ **Si migración falla, deploy se cancela** automáticamente  
✅ **Logs separados**: migraciones vs app  
✅ **Startup rápido**: contenedores solo inician el server  
✅ **Zero race conditions**: solo 1 runner ejecuta migraciones

## Deploy manual (opcional)

Si necesitas deployar sin GitHub Actions:

```bash
# 1. Ejecutar migraciones localmente
pnpm run db:update

# 2. Deploy
gcloud run deploy trainerpt-prod-api \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated
```

## Stripe

Development
Install stripe cli
stripe login
stripe listen --forward-to http://localhost:3000/subscriptions/webhook
