# Configuración de Stripe para Sistema de Suscripciones

Este documento describe cómo configurar Stripe para el sistema de suscripciones del proyecto.

## Prerequisitos

- Cuenta de Stripe (https://stripe.com)
- Stripe CLI instalado (para webhooks locales)

## 1. Instalar Stripe CLI

### Windows (con Scoop)
```bash
scoop bucket add stripe https://github.com/stripe/scoop-stripe-cli.git
scoop install stripe
```

### Descargar manualmente
Descarga desde: https://github.com/stripe/stripe-cli/releases

## 2. Crear Productos en Test Mode

1. Ve al dashboard de Stripe: https://dashboard.stripe.com/test/products
2. Crea 4 productos con los siguientes detalles:

### Free Plan
- **Nombre**: Free
- **Precio**: Sin precio (producto de referencia, no se vende)
- **Descripción**: Plan gratuito con hasta 3 clientes

### Starter Plan
- **Nombre**: Starter
- **Precio**: $19/mes (o el precio que prefieras)
- **Tipo**: Recurrente mensual
- **Descripción**: Plan starter con hasta 15 clientes
- **Copia el Price ID** (ej: `price_test_abc123`)

### Pro Plan
- **Nombre**: Pro
- **Precio**: $49/mes (o el precio que prefieras)
- **Tipo**: Recurrente mensual
- **Descripción**: Plan profesional con hasta 40 clientes
- **Copia el Price ID** (ej: `price_test_def456`)

### Elite Plan
- **Nombre**: Elite
- **Precio**: $99/mes (o el precio que prefieras)
- **Tipo**: Recurrente mensual
- **Descripción**: Plan elite con clientes ilimitados
- **Copia el Price ID** (ej: `price_test_ghi789`)

## 3. Configurar Variables de Entorno

Actualiza el archivo `.env` en el backend con las siguientes variables:

```bash
# Stripe Test Mode
STRIPE_SECRET_KEY=sk_test_your_actual_test_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
STRIPE_PRICE_ID_STARTER=price_test_abc123
STRIPE_PRICE_ID_PRO=price_test_def456
STRIPE_PRICE_ID_ELITE=price_test_ghi789
```

### Obtener STRIPE_SECRET_KEY
1. Ve a: https://dashboard.stripe.com/test/apikeys
2. Copia la "Secret key" (comienza con `sk_test_`)

### Obtener STRIPE_WEBHOOK_SECRET (para desarrollo local)
Ejecuta el siguiente comando y copia el webhook signing secret:
```bash
stripe listen --forward-to http://localhost:8080/subscriptions/webhook
```

El output mostrará algo como:
```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx
```

## 4. Configurar Webhooks para Producción

Para producción, configura un webhook en el dashboard:

1. Ve a: https://dashboard.stripe.com/webhooks
2. Click en "Add endpoint"
3. URL del endpoint: `https://tu-api.com/subscriptions/webhook`
4. Selecciona los siguientes eventos:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copia el "Signing secret" y actualiza `STRIPE_WEBHOOK_SECRET` en producción

## 5. Testing Local

### Iniciar el Stack de Desarrollo

**Terminal 1: Backend**
```bash
cd c:\code\trainer\backend
pnpm run dev
```

**Terminal 2: Stripe CLI (webhooks)**
```bash
stripe listen --forward-to http://localhost:8080/subscriptions/webhook
```

**Terminal 3: Frontend**
```bash
cd c:\code\trainer\web
npm run dev
```

### Escenarios de Prueba

#### 1. Upgrade de FREE a STARTER
1. Login como trainer
2. Ve a `/trainer/billing`
3. Click en "Actualizar Plan" para Starter
4. Usa tarjeta de prueba: `4242 4242 4242 4242`
5. Cualquier fecha futura y CVC (ej: 12/34, 123)
6. Completa el checkout
7. Verifica que el webhook se procesa en Terminal 2
8. Verifica que el plan se actualizó en la UI

#### 2. Límite de Clientes
1. Crea un trainer con plan FREE
2. Invita 3 clientes
3. Intenta invitar un 4to cliente → Debería mostrar error
4. Actualiza a plan STARTER
5. Ahora puedes invitar hasta 15 clientes

#### 3. Customer Portal
1. Con un plan pagado activo
2. Ve a `/trainer/billing`
3. Click en "Gestionar Suscripción"
4. Se abre el Stripe Customer Portal
5. Puedes cancelar, cambiar tarjeta, ver facturas

### Tarjetas de Prueba

| Escenario | Número | CVV | Fecha |
|-----------|--------|-----|-------|
| Pago exitoso | `4242 4242 4242 4242` | Cualquiera | Cualquier fecha futura |
| Pago rechazado | `4000 0000 0000 9995` | Cualquiera | Cualquier fecha futura |
| Requiere autenticación | `4000 0025 0000 3155` | Cualquiera | Cualquier fecha futura |

## 6. Migración de Base de Datos

Antes de usar el sistema, ejecuta la migración para crear las tablas y backfill:

```bash
cd c:\code\trainer\backend
pnpm exec prisma migrate deploy
```

Esto creará:
- La tabla `Subscription`
- Los enums `SubscriptionPlan` y `SubscriptionStatus`
- Suscripciones FREE para todos los trainers existentes

## 7. Debugging

### Ver eventos de Stripe
```bash
# Ver últimos eventos
stripe events list --limit 10

# Ver detalles de un evento específico
stripe events retrieve evt_xxxxx
```

### Logs de Webhooks
Los webhooks se registran automáticamente en los logs del backend. Busca:
- `[SubscriptionsService] Processing webhook event: <event_type>`
- Errores de idempotencia si un evento se procesa dos veces

## 8. Transición a Producción

1. **Cambiar a Live Mode**:
   - Crea los mismos productos en live mode
   - Obtén las claves live: `sk_live_` y los price IDs `price_live_`
   - Actualiza el `.env` de producción

2. **Configurar Webhook en Producción**:
   - Endpoint debe ser HTTPS
   - Configura el webhook en dashboard (ver paso 4)
   - Actualiza `STRIPE_WEBHOOK_SECRET` con el signing secret de producción

3. **Testing en Producción**:
   - Usa tarjetas reales o de prueba en modo live
   - Verifica que los webhooks se reciben correctamente
   - Monitorea los logs

## Notas Importantes

- ⚠️ **Nunca** commitear claves secretas al repositorio
- ⚠️ Las claves de test (`sk_test_`) no funcionan en producción
- ⚠️ El webhook signing secret es diferente entre local/producción
- ⚠️ Los price IDs son diferentes entre test y live mode
- ✅ El Customer Portal de Stripe maneja cancelaciones/cambios automáticamente
- ✅ La idempotencia de webhooks está implementada (campo `stripeEventId`)
