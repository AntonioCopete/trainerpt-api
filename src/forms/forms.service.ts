import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateFormTemplateDto,
  AssignFormTemplateDto,
  UpdateFormTemplateDto,
  SubmitAssignmentDto,
  PresignedUploadUrlDto,
  PHOTO_URLS_BATCH_MAX,
} from './dto/create-form-template.dto';
import { S3UploadService } from './s3-upload.service';
import { Prisma } from 'generated/prisma/client';
import { TranslationService } from '../common/services/translation.service';
import { BrevoEmailService } from '../common/services/brevo-email.service';
import { assertValidFormTemplateSchema } from './form-template-schema';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** Fecha límite legible (componentes UTC internos, sin mencionar zona al usuario). */
function formatDueDateForEmail(d: Date): string {
  const day = d.getUTCDate();
  const month = MONTHS_ES[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${day} de ${month} de ${year}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Colores alineados con el correo de magic link (tema oscuro + acento).
 * Opcional: EMAIL_PAGE_BG, EMAIL_CARD_BG, EMAIL_CARD_BORDER, EMAIL_ACCENT_COLOR,
 * EMAIL_ACCENT_COLOR_END (gradiente CTA), EMAIL_TEXT_COLOR, EMAIL_TEXT_MUTED, EMAIL_LINK_COLOR.
 */
function getFormReminderEmailTheme() {
  return {
    pageBg: '#000000',
    cardBg: '#171717',
    cardBorder: '#262626',
    accent: '#ff5722',
    accentEnd: '#ff3d00',
    textPrimary: '#fafafa',
    textMuted: '#a3a3a3',
    linkColor: '#ffab91',
  };
}

/**
 * Plantilla transaccional tema oscuro (magic link): fondo negro, tarjeta carbón, CTA en acento.
 */
function buildFormReminderEmailHtml(opts: {
  brandName: string;
  recipientEmail: string;
  preheader: string;
  headline: string;
  greetingLine: string;
  bodyParagraphs: string[];
  ctaLabel: string;
  ctaUrl: string;
  footnote?: string;
}): string {
  const t = getFormReminderEmailTheme();
  const footnoteText = opts.footnote?.trim();
  const footnoteBlock = footnoteText
    ? `<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:${t.textMuted};border-top:1px solid ${t.cardBorder};padding-top:20px;text-align:center;">${escapeHtml(footnoteText)}</p>`
    : '';
  const bodyBlocks = opts.bodyParagraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${t.textPrimary};text-align:center;">${p}</p>`,
    )
    .join('');
  const href = escapeHtml(opts.ctaUrl);
  const font =
    "ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:${t.pageBg};-webkit-font-smoothing:antialiased;font-family:${font};">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(opts.preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:${t.pageBg};">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;background-color:${t.cardBg};border-radius:16px;border:1px solid ${t.cardBorder};">
        <tr>
          <td style="padding:40px 28px 36px;text-align:center;">
            <p style="margin:0 0 28px;font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${t.accent};">${escapeHtml(opts.brandName)}</p>
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:600;color:${t.textPrimary};letter-spacing:-0.02em;">${escapeHtml(opts.headline)}</h1>
            <p style="margin:0 0 20px;font-size:16px;line-height:1.55;color:${t.textPrimary};">${opts.greetingLine}</p>
            ${bodyBlocks}
            <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:28px auto 24px;">
              <tr>
                <td style="border-radius:10px;background-color:${t.accent};background-image:linear-gradient(180deg,${t.accent} 0%,${t.accentEnd} 100%);">
                  <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:50px;v-text-anchor:middle;width:280px;" arcsize="14%" fillcolor="${t.accent}"><w:anchorlock/><center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:600;">${escapeHtml(opts.ctaLabel)}</center></v:roundrect><![endif]-->
                  <!--[if !mso]><!-- -->
                  <a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;font-family:${font};">${escapeHtml(opts.ctaLabel)}</a>
                  <!--<![endif]-->
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:${t.textMuted};text-align:center;">Si el botón no funciona, copia y pega este enlace en el navegador:</p>
            <p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;text-align:left;color:${t.textMuted};"><a href="${href}" style="color:${t.linkColor};text-decoration:underline;">${href}</a></p>
            ${footnoteBlock}
            <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:${t.textMuted};text-align:center;">Enviado a ${escapeHtml(opts.recipientEmail)} — ${escapeHtml(opts.brandName)}</p>
            <p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:${t.textMuted};text-align:center;">No respondas a este mensaje.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

@Injectable()
export class FormsService {
  // Tiempo previo (en horas) durante el cual el member puede empezar a responder.
  // Interpretamos dueAt como fin de día UTC; por eso usamos UTC y un intervalo fijo en horas.
  private readonly RESPONSE_WINDOW_MS = 72 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Upload: S3UploadService,
    private readonly translationService: TranslationService,
    private readonly brevoEmail: BrevoEmailService,
  ) {}

  async getTemplates(trainerId: string) {
    const templates = await this.prisma.formTemplate.findMany({
      where: {
        trainerId,
        isArchived: false,
        deletedAt: null,
      },
    });
    return templates;
  }

  async getArchivedTemplates(trainerId: string) {
    const templates = await this.prisma.formTemplate.findMany({
      where: {
        trainerId,
        isArchived: true,
        deletedAt: null,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
    return templates;
  }

  async getTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        trainerId,
        id: templateId,
        deletedAt: null,
      },
    });
    return template;
  }

  async createTemplate(trainerId: string, dto: CreateFormTemplateDto) {
    assertValidFormTemplateSchema(dto.schema);
    const template = await this.prisma.formTemplate.create({
      data: {
        trainerId,
        name: dto.name,
        description: dto.description,
        schema: dto.schema as any,
      },
    });

    return template;
  }

  async duplicateTemplate(trainerId: string, templateId: string) {
    const existing = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
      },
    });

    if (!existing) {
      return null;
    }

    // Buscar cuántas copias existen ya con este nombre base (excluyendo borradas)
    const existingCopies = await this.prisma.formTemplate.count({
      where: {
        trainerId,
        deletedAt: null,
        name: {
          startsWith: `${existing.name} (copia`,
        },
      },
    });

    // También verificar si existe el nombre base + " (copia)"
    const exactCopy = await this.prisma.formTemplate.findFirst({
      where: {
        trainerId,
        deletedAt: null,
        name: `${existing.name} (copia)`,
      },
    });

    let newName: string;
    if (!exactCopy && existingCopies === 0) {
      newName = `${existing.name} (copia)`;
    } else {
      newName = `${existing.name} (copia ${existingCopies + 1})`;
    }

    const duplicated = await this.prisma.formTemplate.create({
      data: {
        trainerId,
        name: newName,
        description: existing.description,
        schema: existing.schema as any,
      },
    });

    return duplicated;
  }

  async archiveTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
        isArchived: false, // Solo archivar si no está ya archivada
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found or already archived');
    }

    return await this.prisma.formTemplate.update({
      where: { id: templateId },
      data: { isArchived: true },
    });
  }

  async restoreTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
        isArchived: true, // Solo restaurar si está archivada
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found or not archived');
    }

    return await this.prisma.formTemplate.update({
      where: { id: templateId },
      data: { isArchived: false },
    });
  }

  async deleteTemplate(trainerId: string, templateId: string) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
        isArchived: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found or already deleted');
    }

    return await this.prisma.formTemplate.update({
      where: { id: templateId },
      data: { deletedAt: new Date() },
    });
  }

  async updateTemplate(
    trainerId: string,
    templateId: string,
    dto: UpdateFormTemplateDto,
  ) {
    const existing = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        deletedAt: null,
      },
    });

    if (!existing) {
      throw new NotFoundException('Template not found');
    }

    const data: any = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.schema !== undefined) {
      assertValidFormTemplateSchema(dto.schema);
      data.schema = dto.schema as any;
    }

    return await this.prisma.formTemplate.update({
      where: { id: templateId },
      data,
    });
  }

  async assignTemplate(
    trainerId: string,
    templateId: string,
    dto: AssignFormTemplateDto,
  ) {
    const template = await this.prisma.formTemplate.findFirst({
      where: {
        id: templateId,
        trainerId,
        isArchived: false,
        deletedAt: null,
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    const link = await this.prisma.trainerMemberLink.findUnique({
      where: {
        trainerId_memberId: {
          trainerId,
          memberId: dto.memberId,
        },
      },
    });

    if (!link) {
      throw new ForbiddenException('Member is not linked to trainer');
    }

    // Verificar si ya existe un assignment pendiente del mismo template
    const existingPending = await this.prisma.formAssignment.findFirst({
      where: {
        trainerId,
        memberId: dto.memberId,
        templateId: template.id,
        status: 'pending',
      },
    });

    if (existingPending) {
      throw new ForbiddenException(
        'Member already has a pending assignment for this template',
      );
    }

    const dueAt = this.toUtcEndOfDay(dto.dueAt);
    const now = new Date();
    if (dueAt.getTime() < now.getTime()) {
      throw new BadRequestException('dueAt must be today or a future date');
    }
    const windowStart = new Date(dueAt.getTime() - this.RESPONSE_WINDOW_MS);

    const assignment = await this.prisma.formAssignment.create({
      data: {
        trainerId,
        memberId: dto.memberId,
        templateId: template.id,
        schemaSnapshot: template.schema as any,
        dueAt,
        windowStart,
        repeat: dto.repeat || 'none',
      },
    });

    return assignment;
  }

  /**
   * Get assignments:
   * - templateId: trainer view → assignments for that template (trainerId + templateId).
   * - memberId: trainer view → assignments for that member (trainerId + memberId).
   * - neither: member view → current user's assignments (memberId = userId).
   */
  async getAssignments(userId: string, memberId?: string, templateId?: string) {
    const includeTemplate = {
      template: {
        select: { id: true, name: true, description: true },
      },
    };

    if (templateId) {
      const template = await this.prisma.formTemplate.findFirst({
        where: { id: templateId, trainerId: userId },
      });
      if (!template) {
        throw new NotFoundException('Template not found');
      }
      const where: {
        trainerId: string;
        templateId: string;
        memberId?: string;
      } = { trainerId: userId, templateId };
      if (memberId) where.memberId = memberId;
      return this.prisma.formAssignment.findMany({
        where,
        include: {
          ...includeTemplate,
          member: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (memberId) {
      const link = await this.prisma.trainerMemberLink.findUnique({
        where: {
          trainerId_memberId: { trainerId: userId, memberId },
        },
      });
      if (!link) {
        throw new ForbiddenException('Member is not linked to trainer');
      }
      return this.prisma.formAssignment.findMany({
        where: { trainerId: userId, memberId },
        include: includeTemplate,
        orderBy: { createdAt: 'desc' },
      });
    }

    // Caso "member view": no viene `memberId` ni `templateId` en query,
    // así que asumimos que el usuario actual es el member.
    // En esa vista ocultamos assignments cancelados (`archived`).
    return this.prisma.formAssignment.findMany({
      where: { memberId: userId, status: { not: 'archived' } },
      include: includeTemplate,
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAssignment(userId: string, assignmentId: string) {
    const assignment = await this.prisma.formAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        template: {
          select: { id: true, name: true, description: true },
        },
        responses: {
          orderBy: { submittedAt: 'desc' },
        },
      },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    const isMember = assignment.memberId === userId;
    const isTrainer = assignment.trainerId === userId;

    if (!isMember && !isTrainer) {
      throw new ForbiddenException(
        'You are not allowed to access this assignment',
      );
    }

    // Si el usuario es el member y el trainer lo canceló, ocultamos el assignment.
    if (isMember && assignment.status === 'archived') {
      throw new NotFoundException('Assignment not found');
    }

    return assignment;
  }

  private parseSchemaSnapshot(schemaSnapshot: unknown): Array<{
    id: string;
    type: string;
    label: string;
    unit?: string;
    order: number;
  }> {
    if (!Array.isArray(schemaSnapshot)) {
      return [];
    }
    return schemaSnapshot
      .map((raw: unknown, i: number) => {
        const o =
          raw !== null && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : {};
        const orderRaw = o.order;
        const order = typeof orderRaw === 'number' ? orderRaw : i;
        const idRaw = o.id;
        const id =
          typeof idRaw === 'string' && idRaw.length > 0
            ? idRaw
            : `field_${order}`;
        const typeRaw = o.type;
        const type = typeof typeRaw === 'string' ? typeRaw : '';
        const labelRaw = o.label;
        const fallbackLabel = typeof idRaw === 'string' ? idRaw : id;
        const label =
          typeof labelRaw === 'string' && labelRaw.length > 0
            ? labelRaw
            : fallbackLabel;
        const unitRaw = o.unit;
        const unit =
          typeof unitRaw === 'string' && unitRaw.trim() !== ''
            ? unitRaw
            : undefined;
        return { id, type, label, unit, order };
      })
      .filter((f) => f.id.length > 0);
  }

  private parseNumericAnswer(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    return null;
  }

  /**
   * En progreso agregamos métricas por clave canónica para unir:
   * - campos por defecto (`weight`)
   * - campos creados "desde cero" con label equivalente (`Peso`)
   */
  private canonicalProgressMetricId(field: {
    id: string;
    type: string;
    label: string;
  }): string {
    if (field.type !== 'number') return field.id;
    const norm = (v: string) =>
      v
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    const idNorm = norm(field.id);
    const labelNorm = norm(field.label);
    const key = idNorm || labelNorm;
    const byLabel = labelNorm;

    if (
      key === 'weight' ||
      byLabel === 'peso' ||
      byLabel === 'peso_corporal' ||
      byLabel === 'body_weight'
    ) {
      return 'weight';
    }

    if (key === 'age' || byLabel === 'edad') {
      return 'age';
    }

    return field.id;
  }

  private async fetchMemberProgressPayload(opts: {
    memberId: string;
    trainerId?: string;
  }) {
    const where: Prisma.FormAssignmentWhereInput = {
      memberId: opts.memberId,
      status: 'completed',
    };
    if (opts.trainerId) {
      where.trainerId = opts.trainerId;
    }

    const assignments = await this.prisma.formAssignment.findMany({
      where,
      include: {
        template: { select: { id: true, name: true } },
        responses: { orderBy: { submittedAt: 'asc' } },
      },
    });

    const numberFieldMap = new Map<
      string,
      { id: string; label: string; unit?: string }
    >();
    const photoFieldMap = new Map<string, { id: string; label: string }>();

    for (const a of assignments) {
      const fields = this.parseSchemaSnapshot(a.schemaSnapshot);
      for (const f of fields) {
        const metricId = this.canonicalProgressMetricId(f);
        if (f.type === 'number' && !numberFieldMap.has(metricId)) {
          numberFieldMap.set(metricId, {
            id: metricId,
            label: f.label || f.id,
            ...(f.unit ? { unit: f.unit } : {}),
          });
        }
        if (f.type === 'photo' && !photoFieldMap.has(f.id)) {
          photoFieldMap.set(f.id, { id: f.id, label: f.label || f.id });
        }
      }
    }

    const points: Array<{
      assignmentId: string;
      templateId: string | null;
      templateName: string;
      submittedAt: string;
      numbers: Record<string, number>;
      photoKeys: Record<string, string>;
    }> = [];

    for (const a of assignments) {
      const fields = this.parseSchemaSnapshot(a.schemaSnapshot);
      const numberFields = fields
        .filter((f) => f.type === 'number')
        .map((f) => ({
          sourceId: f.id,
          metricId: this.canonicalProgressMetricId(f),
        }));
      const photoIds = new Set(
        fields.filter((f) => f.type === 'photo').map((f) => f.id),
      );

      for (const r of a.responses) {
        const answers = (r.answers ?? {}) as Record<string, unknown>;
        const numbers: Record<string, number> = {};
        const photoKeys: Record<string, string> = {};

        for (const field of numberFields) {
          const n = this.parseNumericAnswer(answers[field.sourceId]);
          if (n !== null) {
            numbers[field.metricId] = n;
          }
        }
        for (const id of photoIds) {
          const v = answers[id];
          if (typeof v === 'string' && v.trim() !== '') {
            photoKeys[id] = v.trim();
          }
        }

        points.push({
          assignmentId: a.id,
          templateId: a.templateId,
          templateName: a.template?.name ?? 'Formulario',
          submittedAt: r.submittedAt.toISOString(),
          numbers,
          photoKeys,
        });
      }
    }

    points.sort(
      (x, y) =>
        new Date(x.submittedAt).getTime() - new Date(y.submittedAt).getTime(),
    );

    const collator = new Intl.Collator('es');
    return {
      points,
      numberFields: [...numberFieldMap.values()].sort((a, b) =>
        collator.compare(a.label, b.label),
      ),
      photoFields: [...photoFieldMap.values()].sort((a, b) =>
        collator.compare(a.label, b.label),
      ),
    };
  }

  async getMemberProgressForTrainer(trainerId: string, memberId: string) {
    const link = await this.prisma.trainerMemberLink.findUnique({
      where: {
        trainerId_memberId: { trainerId, memberId },
      },
    });
    if (!link) {
      throw new ForbiddenException('Member is not linked to trainer');
    }
    return this.fetchMemberProgressPayload({ trainerId, memberId });
  }

  async getMemberProgressForSelf(memberId: string) {
    return this.fetchMemberProgressPayload({ memberId });
  }

  async getPresignedReadUrlsBatch(userId: string, keys: string[]) {
    const unique = [
      ...new Set(
        keys
          .map((k) => (typeof k === 'string' ? k.trim() : ''))
          .filter(Boolean),
      ),
    ].slice(0, PHOTO_URLS_BATCH_MAX);

    const urls: Record<string, string> = {};
    for (const key of unique) {
      try {
        const { url } = await this.getPresignedReadUrl(userId, key);
        urls[key] = url;
      } catch {
        // clave inválida o sin permiso: se omite
      }
    }
    return { urls };
  }

  async cancelAssignment(
    trainerId: string,
    assignmentId: string,
  ): Promise<{ cancelledCount: number }> {
    const assignment = await this.prisma.formAssignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        trainerId: true,
        memberId: true,
        templateId: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }

    if (assignment.trainerId !== trainerId) {
      throw new ForbiddenException(
        'You are not allowed to cancel this assignment',
      );
    }

    if (!assignment.templateId) {
      throw new BadRequestException(
        'Cannot cancel this assignment because it is missing templateId',
      );
    }

    // Cancelamos el pending actual para ese member + plantilla.
    // Esto evita:
    // - que el member pueda enviar (bloqueo por status archived)
    // - que el cron o el flujo recurrente creen el siguiente (porque no habrá pending)
    const res = await this.prisma.formAssignment.updateMany({
      where: {
        trainerId,
        memberId: assignment.memberId,
        templateId: assignment.templateId,
        status: 'pending',
      },
      data: { status: 'archived' },
    });

    return { cancelledCount: res.count };
  }

  async submitAssignment(
    memberId: string,
    assignmentId: string,
    dto: SubmitAssignmentDto,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.formAssignment.findUnique({
        where: { id: assignmentId, memberId },
      });

      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }

      // Seguridad de flujo:
      // Si el member se desvinculó del trainer, no permitir enviar
      // ni disparar la creación del "siguiente" recurrente.
      const link = await tx.trainerMemberLink.findUnique({
        where: {
          trainerId_memberId: {
            trainerId: assignment.trainerId,
            memberId,
          },
        },
      });
      if (!link) {
        throw new ForbiddenException(
          'Member is not linked to this trainer anymore',
        );
      }

      const now = new Date();

      // Validar ventana de respuesta
      if (assignment.windowStart && now < assignment.windowStart) {
        throw new ForbiddenException(
          'Cannot submit assignment before window start',
        );
      }

      // Validar deadline
      if (assignment.dueAt && now > assignment.dueAt) {
        throw new ForbiddenException('Assignment deadline has passed');
      }

      // Validar estado
      if (assignment.status === 'completed') {
        throw new ForbiddenException('Assignment already completed');
      }

      if (assignment.status === 'missed') {
        throw new ForbiddenException('Assignment already missed');
      }

      if (assignment.status === 'archived') {
        throw new ForbiddenException('Assignment has been cancelled');
      }

      // Evitar carreras: solo uno debe poder marcar como completed.
      const completionUpdate = await tx.formAssignment.updateMany({
        where: { id: assignmentId, memberId, status: 'pending' },
        data: { status: 'completed' },
      });

      if (completionUpdate.count !== 1) {
        throw new ForbiddenException(
          'Assignment already processed by another request',
        );
      }

      const response = await tx.formResponse.create({
        data: {
          assignmentId,
          memberId,
          answers: dto.answers as any,
        },
      });

      // 🔥 HÍBRIDO: Si es recurrente, crear el siguiente inmediatamente
      if (assignment.repeat !== 'none') {
        await this.createNextRecurringAssignment(tx, assignment);
      }

      return response;
    });

    return result;
  }

  private async createNextRecurringAssignment(
    tx: any,
    parent: any,
  ): Promise<void> {
    if (!parent.dueAt || parent.repeat === 'none') {
      return;
    }

    // Seguridad de flujo: si el member se desvinculó del trainer,
    // no crear el siguiente recurrente.
    const link = await tx.trainerMemberLink.findUnique({
      where: {
        trainerId_memberId: {
          trainerId: parent.trainerId,
          memberId: parent.memberId,
        },
      },
    });
    if (!link) {
      return;
    }

    // Idempotencia ante pings/requests repetidos: no creemos otro hijo
    // si ya existe uno para esta instancia (parentAssignmentId).
    const existingChild = await tx.formAssignment.findFirst({
      where: { parentAssignmentId: parent.id },
      select: { id: true },
    });
    if (existingChild) {
      return;
    }

    const nextDueAt = this.calculateNextDueAt(parent.dueAt, parent.repeat);
    const windowStart = new Date(nextDueAt.getTime() - this.RESPONSE_WINDOW_MS);

    await tx.formAssignment.create({
      data: {
        trainerId: parent.trainerId,
        memberId: parent.memberId,
        templateId: parent.templateId,
        schemaSnapshot: parent.schemaSnapshot,
        repeat: parent.repeat,
        dueAt: nextDueAt,
        windowStart,
        parentAssignmentId: parent.id,
        status: 'pending',
      },
    });
  }

  private toUtcEndOfDay(dateStr: string): Date {
    // Frontend envia YYYY-MM-DD. Lo interpretamos como UTC "fin de día".
    const [yyyy, mm, dd] = dateStr.split('-').map((v) => Number(v));
    return new Date(Date.UTC(yyyy, mm - 1, dd, 23, 59, 59, 999));
  }

  private calculateNextDueAt(currentDueAt: Date, repeat: string): Date {
    // Trabajar en UTC para evitar problemas de zona horaria
    const current = new Date(currentDueAt.toISOString());

    if (repeat === 'weekly') {
      current.setUTCDate(current.getUTCDate() + 7);
    } else if (repeat === 'monthly') {
      current.setUTCMonth(current.getUTCMonth() + 1);
    }

    // Garantizar que siempre sea "fin de día" (para que el vencimiento sea por fecha)
    current.setUTCHours(23, 59, 59, 999);
    return current;
  }

  async getPresignedUploadUrl(
    memberId: string,
    assignmentId: string,
    dto: PresignedUploadUrlDto,
  ) {
    const assignment = await this.prisma.formAssignment.findUnique({
      where: { id: assignmentId, memberId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    if (assignment.status === 'completed' || assignment.status === 'archived') {
      throw new ForbiddenException(
        'Cannot upload files to a completed or cancelled assignment',
      );
    }
    return this.s3Upload.getPresignedUploadUrl(
      assignmentId,
      memberId,
      dto.filename,
      dto.contentType,
    );
  }

  async getPresignedReadUrl(userId: string, key: string) {
    if (!this.s3Upload.isAllowedKey(key)) {
      throw new ForbiddenException('Invalid photo key');
    }
    const parts = key.split('/');
    const assignmentId = parts[0];
    if (!assignmentId) {
      throw new ForbiddenException('Invalid photo key');
    }
    const assignment = await this.prisma.formAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment) {
      throw new NotFoundException('Assignment not found');
    }
    const canRead =
      assignment.memberId === userId || assignment.trainerId === userId;
    if (!canRead) {
      throw new ForbiddenException('You cannot access this photo');
    }
    return this.s3Upload.getPresignedReadUrl(key);
  }

  /**
   * Cron job endpoint to process overdue assignments
   * This should be called by Cloud Scheduler daily
   */
  async processOverdueAssignments() {
    // Obtener timestamp actual en UTC
    // Nota: new Date() siempre devuelve UTC internamente,
    // pero lo hacemos explícito para claridad
    const now = new Date();

    console.log(
      `[CRON] Processing overdue assignments at ${now.toISOString()}`,
    );

    // Find all pending assignments that are overdue (one-off + recurring)
    const overdueAssignments = await this.prisma.formAssignment.findMany({
      where: {
        status: 'pending',
        dueAt: { lt: now }, // Prisma compara UTC con UTC automáticamente
      },
    });

    console.log(
      `[CRON] Found ${overdueAssignments.length} overdue assignments`,
    );

    const results: Array<{
      id: string;
      status: string;
      error?: string;
    }> = [];

    for (const assignment of overdueAssignments) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Idempotencia / anti-race:
          // Solo avanzamos si este assignment sigue exactamente en pending.
          const missedUpdate = await tx.formAssignment.updateMany({
            where: {
              id: assignment.id,
              status: 'pending',
              dueAt: { lt: now },
            },
            data: { status: 'missed' },
          });

          if (missedUpdate.count !== 1) {
            return;
          }

          // Re-leer el parent dentro del tx para no depender de un snapshot viejo.
          const parent = await tx.formAssignment.findUnique({
            where: { id: assignment.id },
            select: {
              id: true,
              dueAt: true,
              repeat: true,
              trainerId: true,
              memberId: true,
              templateId: true,
              schemaSnapshot: true,
            },
          });

          if (!parent) {
            return;
          }

          // Create next recurring assignment only for recurring cadence
          if (parent.repeat !== 'none') {
            await this.createNextRecurringAssignment(tx, parent);
          }
        });

        results.push({ id: assignment.id, status: 'processed' });
      } catch (error: any) {
        results.push({
          id: assignment.id,
          status: 'error',
          error: error.message,
        });
      }
    }

    return {
      processed: results.filter((r) => r.status === 'processed').length,
      results,
      timestamp: now.toISOString(), // Devolver en formato ISO UTC para claridad
    };
  }

  /**
   * Recordatorios por email. Tras processOverdueAssignments: solo pending con ventana válida.
   * Idempotencia: claim atómico con reminder*SentAt, revertir a null si Brevo falla.
   * CTA: WEB_URL + FORMS_MEMBER_PATH (defecto /member/forms) + ?assignmentId=
   */
  async sendFormAssignmentReminders(): Promise<{
    windowSent: number;
    dueSent: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let windowSent = 0;
    let dueSent = 0;
    const now = new Date();

    const formsBaseUrl = this.buildMemberFormsBaseUrl();

    const windowCandidates = await this.prisma.formAssignment.findMany({
      where: {
        status: 'pending',
        reminderWindowSentAt: null,
        windowStart: { not: null, lte: now },
        dueAt: { not: null, gt: now },
        member: { deleted: false },
      },
      include: {
        member: { select: { email: true, fullName: true } },
        template: { select: { name: true } },
      },
    });

    const emailBrandName = 'TrainerPT';

    for (const a of windowCandidates) {
      const email = a.member.email?.trim();
      if (!email) {
        errors.push(`window ${a.id}: member has no email`);
        continue;
      }

      const claimedAt = new Date();
      const claim = await this.prisma.formAssignment.updateMany({
        where: {
          id: a.id,
          status: 'pending',
          reminderWindowSentAt: null,
          windowStart: { not: null, lte: now },
          dueAt: { not: null, gt: now },
        },
        data: { reminderWindowSentAt: claimedAt },
      });

      if (claim.count !== 1) {
        continue;
      }

      const formName = a.template?.name?.trim() || 'Formulario';
      const cta = this.appendAssignmentQuery(formsBaseUrl, a.id);
      const subject = `Ya puedes completar: ${formName}`;
      const greeting = `Hola${a.member.fullName ? ` ${escapeHtml(a.member.fullName)}` : ''},`;
      const html = buildFormReminderEmailHtml({
        brandName: emailBrandName,
        recipientEmail: email,
        preheader: `Ya puedes completar: ${formName}`,
        headline: 'Formulario disponible',
        greetingLine: greeting,
        bodyParagraphs: [
          `Tu entrenador te ha asignado <strong>${escapeHtml(formName)}</strong>. La ventana para responder ya está abierta.`,
          'Pulsa el botón para ir al formulario en la app.',
        ],
        ctaLabel: 'Abrir formulario',
        ctaUrl: cta,
      });

      try {
        await this.brevoEmail.sendTransactional({
          to: email,
          subject,
          html,
          text: [
            `${emailBrandName}`,
            '',
            `Hola${a.member.fullName ? ` ${a.member.fullName}` : ''},`,
            '',
            `Ya puedes rellenar el formulario "${formName}".`,
            '',
            cta,
            '',
            `Enviado a ${email} — ${emailBrandName}`,
            'No respondas a este mensaje.',
          ].join('\n'),
        });
        windowSent += 1;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`window ${a.id}: ${msg}`);
        await this.prisma.formAssignment.updateMany({
          where: { id: a.id, reminderWindowSentAt: claimedAt },
          data: { reminderWindowSentAt: null },
        });
      }
    }

    const endTodayUtc = this.endOfUtcDay(now);

    const dueCandidates = await this.prisma.formAssignment.findMany({
      where: {
        status: 'pending',
        reminderDueSentAt: null,
        dueAt: { not: null, gte: now, lte: endTodayUtc },
        member: { deleted: false },
      },
      include: {
        member: { select: { email: true, fullName: true } },
        template: { select: { name: true } },
      },
    });

    for (const a of dueCandidates) {
      const email = a.member.email?.trim();
      if (!email) {
        errors.push(`due ${a.id}: member has no email`);
        continue;
      }

      const claimedAt = new Date();
      const claim = await this.prisma.formAssignment.updateMany({
        where: {
          id: a.id,
          status: 'pending',
          reminderDueSentAt: null,
          dueAt: { not: null, gte: now, lte: endTodayUtc },
        },
        data: { reminderDueSentAt: claimedAt },
      });

      if (claim.count !== 1) {
        continue;
      }

      const formName = a.template?.name?.trim() || 'Formulario';
      const dueHuman = formatDueDateForEmail(a.dueAt!);
      const cta = this.appendAssignmentQuery(formsBaseUrl, a.id);
      const subject = `Último día para entregar: ${formName}`;
      const greeting = `Hola${a.member.fullName ? ` ${escapeHtml(a.member.fullName)}` : ''},`;
      const html = buildFormReminderEmailHtml({
        brandName: emailBrandName,
        recipientEmail: email,
        preheader: `Último día: ${formName}`,
        headline: 'Último día para entregar',
        greetingLine: greeting,
        bodyParagraphs: [
          `Hoy es el último día para entregar <strong>${escapeHtml(formName)}</strong>.`,
          `Fecha límite: <strong>${escapeHtml(dueHuman)}</strong>.`,
        ],
        ctaLabel: 'Entregar ahora',
        ctaUrl: cta,
      });

      try {
        await this.brevoEmail.sendTransactional({
          to: email,
          subject,
          html,
          text: [
            `${emailBrandName}`,
            '',
            `Hola${a.member.fullName ? ` ${a.member.fullName}` : ''},`,
            '',
            `Hoy es el último día para entregar "${formName}".`,
            `Fecha límite: ${dueHuman}`,
            '',
            cta,
            '',
            `Enviado a ${email} — ${emailBrandName}`,
            'No respondas a este mensaje.',
          ].join('\n'),
        });
        dueSent += 1;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`due ${a.id}: ${msg}`);
        await this.prisma.formAssignment.updateMany({
          where: { id: a.id, reminderDueSentAt: claimedAt },
          data: { reminderDueSentAt: null },
        });
      }
    }

    return { windowSent, dueSent, errors };
  }

  private endOfUtcDay(d: Date): Date {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    return new Date(Date.UTC(y, m, day, 23, 59, 59, 999));
  }

  /** WEB_URL sin slash final + FORMS_MEMBER_PATH (defecto /member/forms). */
  private buildMemberFormsBaseUrl(): string {
    const web = (process.env.WEB_URL ?? '').replace(/\/$/, '');
    const pathRaw = process.env.FORMS_MEMBER_PATH?.trim() || '/member/forms';
    const path = pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`;
    return `${web}${path}`;
  }

  private appendAssignmentQuery(baseUrl: string, assignmentId: string): string {
    return `${baseUrl}/${assignmentId}`;
  }

  async syncExercisesFromFreeDb() {
    type FreeExerciseItem = {
      id?: string;
      name?: string;
      category?: string | null;
      equipment?: string | null;
      force?: string | null;
      level?: string | null;
      mechanic?: string | null;
      primaryMuscles?: string[];
      secondaryMuscles?: string[];
      instructions?: string[];
      images?: string[];
    };

    const datasetUrl =
      process.env.FREE_EXERCISE_DB_URL ||
      'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json';
    const imageBaseUrl =
      process.env.FREE_EXERCISE_DB_IMAGE_BASE_URL ||
      'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';
    const maxItems = Number(process.env.EXERCISE_SYNC_MAX_ITEMS || 0);

    const res = await fetch(datasetUrl);
    if (!res.ok) {
      const body = await res.text();
      throw new BadRequestException(
        `Free exercise DB sync failed: ${res.status} ${res.statusText} - ${body}`,
      );
    }

    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new BadRequestException(
        'Free exercise DB payload must be an array',
      );
    }

    const allItems = data as FreeExerciseItem[];
    const items =
      Number.isFinite(maxItems) && maxItems > 0
        ? allItems.slice(0, maxItems)
        : allItems;
    let totalFetched = 0;
    let totalUpserted = 0;
    let totalSkipped = 0;
    const skippedByReason: Record<string, number> = {};
    const translationCache = new Map<string, string | null>();

    const normalizeEsText = (value: string | null): string | null => {
      if (!value) return null;
      const trimmed = value.trim();
      if (!trimmed) return null;
      const lowered = trimmed.toLowerCase();
      if (lowered === 'null' || lowered === 'undefined' || lowered === 'n/a') {
        return null;
      }
      return trimmed;
    };

    const capitalizeFirst = (value: string): string =>
      value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;

    const sanitizeEsArray = (values: string[] | null): string[] | null => {
      if (!values || values.length === 0) return null;
      const cleaned = values
        .map((v) => normalizeEsText(v))
        .filter((v): v is string => Boolean(v))
        .map((v) => v.toLowerCase());
      return cleaned.length > 0 ? cleaned : null;
    };

    // Traducciones canónicas de anatomía fitness (evita errores del traductor general).
    const muscleMap: Record<string, string> = {
      abdominals: 'abdominales',
      abductors: 'abductores',
      adductors: 'aductores',
      biceps: 'bíceps',
      calves: 'pantorrillas',
      chest: 'pecho',
      forearms: 'antebrazos',
      glutes: 'glúteos',
      hamstrings: 'isquiotibiales',
      lats: 'dorsales',
      'lower back': 'lumbar',
      quadriceps: 'cuádriceps',
      shoulders: 'hombros',
      triceps: 'tríceps',
      traps: 'trapecios',
    };

    const translateMuscleTerm = async (term: string): Promise<string> => {
      const normalized = term.trim().toLowerCase();
      if (!normalized) return term;
      const canonical = muscleMap[normalized];
      if (canonical) return canonical;
      const translated = await translateCached(term);
      return (translated || term).toLowerCase();
    };

    const translateCached = async (text: string): Promise<string | null> => {
      const normalized = text.trim();
      if (!normalized) return null;
      const cacheKey = normalized.toLowerCase();
      if (translationCache.has(cacheKey)) {
        return translationCache.get(cacheKey) ?? null;
      }

      const translated = await this.translationService.translateText(
        normalized,
        {
          to: 'es',
        },
      );
      const trimmed = normalizeEsText(translated?.trim() || null);
      const isSame =
        trimmed !== null &&
        trimmed.localeCompare(normalized, undefined, {
          sensitivity: 'base',
        }) === 0;
      const finalText = !trimmed || isSame ? null : trimmed;

      translationCache.set(cacheKey, finalText);
      return finalText;
    };

    const toStablePositiveInt = (value: string) => {
      let hash = 0;
      for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) | 0;
      }
      return Math.abs(hash) || 1;
    };

    for (const item of items) {
      totalFetched += 1;
      const name = item.name?.trim() || '';
      const category = item.category?.trim() || null;
      const instructions = Array.isArray(item.instructions)
        ? item.instructions
            .map((step) => (typeof step === 'string' ? step.trim() : ''))
            .filter((step) => step.length > 0)
        : [];

      if (!name || !item.id) {
        totalSkipped += 1;
        const reason = !name ? 'invalid_name' : 'missing_id';
        skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
        continue;
      }

      const translatedNameRaw = await translateCached(name);
      const translatedName = translatedNameRaw
        ? capitalizeFirst(translatedNameRaw)
        : null;

      const translatedInstructionsRaw = await Promise.all(
        instructions.map((step) => translateCached(step)),
      );
      const hasAnyInstructionTranslation = translatedInstructionsRaw.some((v) =>
        Boolean(v),
      );
      const translatedInstructions = hasAnyInstructionTranslation
        ? instructions.map(
            (step, idx) => translatedInstructionsRaw[idx] || step,
          )
        : [];
      const description = instructions.length > 0 ? instructions : null;
      const translatedDescription = hasAnyInstructionTranslation
        ? translatedInstructions.length > 0
          ? translatedInstructions
          : null
        : description;
      const legacyDescriptionText = description ? description.join('\n') : null;

      const imageUrls = Array.isArray(item.images)
        ? item.images
            .map((path) => `${imageBaseUrl}${String(path).replace(/^\/+/, '')}`)
            .filter(Boolean)
        : [];

      const equipment = item.equipment ? [item.equipment] : [];
      const muscles = Array.isArray(item.primaryMuscles)
        ? item.primaryMuscles
        : [];
      const musclesSecondary = Array.isArray(item.secondaryMuscles)
        ? item.secondaryMuscles
        : [];
      const categoryNameEsRaw = category
        ? await translateCached(category)
        : null;
      const categoryNameEs = categoryNameEsRaw
        ? categoryNameEsRaw.toLowerCase()
        : null;

      const equipmentEsRaw =
        equipment.length > 0
          ? await Promise.all(equipment.map((value) => translateCached(value)))
          : [];
      const hasAnyEquipmentTranslation = equipmentEsRaw.some((v) => Boolean(v));
      const rawEquipmentEs = hasAnyEquipmentTranslation
        ? equipment.map((value, idx) => {
            const translated = normalizeEsText(equipmentEsRaw[idx] || null);
            const finalValue = translated || value;
            return finalValue.toLowerCase();
          })
        : null;
      const equipmentEs = sanitizeEsArray(rawEquipmentEs);

      const musclesEsRaw =
        muscles.length > 0
          ? await Promise.all(
              muscles.map((value) => translateMuscleTerm(value)),
            )
          : [];
      const hasAnyMuscleTranslation = musclesEsRaw.some((v) => Boolean(v));
      const rawMusclesEs = hasAnyMuscleTranslation
        ? muscles.map((value, idx) => {
            const translated = normalizeEsText(musclesEsRaw[idx] || null);
            const finalValue = translated || value;
            return finalValue.toLowerCase();
          })
        : null;
      const musclesEs = sanitizeEsArray(rawMusclesEs);

      const musclesSecondaryEsRaw =
        musclesSecondary.length > 0
          ? await Promise.all(
              musclesSecondary.map((value) => translateMuscleTerm(value)),
            )
          : [];
      const hasAnySecondaryMuscleTranslation = musclesSecondaryEsRaw.some((v) =>
        Boolean(v),
      );
      const rawMusclesSecondaryEs = hasAnySecondaryMuscleTranslation
        ? musclesSecondary.map((value, idx) => {
            const translated = normalizeEsText(
              musclesSecondaryEsRaw[idx] || null,
            );
            const finalValue = translated || value;
            return finalValue.toLowerCase();
          })
        : null;
      const musclesSecondaryEs = sanitizeEsArray(rawMusclesSecondaryEs);
      const equipmentEsValue = equipmentEs
        ? (equipmentEs as Prisma.InputJsonValue)
        : Prisma.DbNull;
      const musclesEsValue = musclesEs
        ? (musclesEs as Prisma.InputJsonValue)
        : Prisma.DbNull;
      const musclesSecondaryEsValue = musclesSecondaryEs
        ? (musclesSecondaryEs as Prisma.InputJsonValue)
        : Prisma.DbNull;

      const externalId = toStablePositiveInt(item.id);

      const baseRaw = {
        source: 'free-exercise-db',
        author: 'free-exercise-db',
        force: item.force ?? null,
        level: item.level ?? null,
        mechanic: item.mechanic ?? null,
        original: item,
      } as Prisma.InputJsonValue;

      try {
        await this.prisma.exercise.upsert({
          where: {
            source_externalId: {
              source: 'free_exercise_db' as any,
              externalId,
            },
          },
          create: {
            source: 'free_exercise_db' as any,
            externalId,
            externalUuid: item.id,
            name,
            nameEs: translatedName,
            description: description as Prisma.InputJsonValue | null,
            descriptionEs:
              translatedDescription as Prisma.InputJsonValue | null,
            categoryId: null,
            categoryName: category,
            categoryNameEs: categoryNameEs ?? null,
            equipment: equipment as Prisma.InputJsonValue,
            equipmentEs: equipmentEsValue,
            muscles: muscles as Prisma.InputJsonValue,
            musclesEs: musclesEsValue,
            musclesSecondary: musclesSecondary as Prisma.InputJsonValue,
            musclesSecondaryEs: musclesSecondaryEsValue,
            images: imageUrls.map((url) => ({
              image: url,
            })) as Prisma.InputJsonValue,
            videos: [] as Prisma.InputJsonValue,
            license: Prisma.JsonNull,
            lastUpdateAt: null,
            lastUpdateGlobal: null,
            raw: baseRaw,
            isArchived: false,
            deletedAt: null,
          } as any,
          update: {
            externalUuid: item.id,
            name,
            nameEs: translatedName,
            description: description as Prisma.InputJsonValue | null,
            descriptionEs:
              translatedDescription as Prisma.InputJsonValue | null,
            categoryId: null,
            categoryName: category,
            categoryNameEs: categoryNameEs ?? null,
            equipment: equipment as Prisma.InputJsonValue,
            equipmentEs: equipmentEsValue,
            muscles: muscles as Prisma.InputJsonValue,
            musclesEs: musclesEsValue,
            musclesSecondary: musclesSecondary as Prisma.InputJsonValue,
            musclesSecondaryEs: musclesSecondaryEsValue,
            images: imageUrls.map((url) => ({
              image: url,
            })) as Prisma.InputJsonValue,
            videos: [] as Prisma.InputJsonValue,
            license: Prisma.JsonNull,
            lastUpdateAt: null,
            lastUpdateGlobal: null,
            raw: baseRaw,
            isArchived: false,
            deletedAt: null,
          } as any,
        });
      } catch (error) {
        const errorName =
          typeof error === 'object' && error !== null && 'name' in error
            ? String((error as { name?: unknown }).name || '')
            : '';
        const errorMessage =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: unknown }).message || '')
            : '';

        const isDescriptionStringMismatch =
          (errorName === 'PrismaClientValidationError' ||
            errorMessage.includes('PrismaClientValidationError')) &&
          errorMessage.includes(
            'Argument `description`: Invalid value provided',
          );
        const isMissingColumn =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2022';
        if (!isMissingColumn && !isDescriptionStringMismatch) throw error;

        // Fallback para bases desalineadas: escribimos un subconjunto de columnas.
        const existing = await this.prisma.exercise.findFirst({
          where: { source: 'free_exercise_db' as any, externalId },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.exercise.update({
            where: { id: existing.id },
            data: {
              name,
              description: legacyDescriptionText,
              categoryName: category,
              images: imageUrls.map((url) => ({
                image: url,
              })) as Prisma.InputJsonValue,
              videos: [] as Prisma.InputJsonValue,
              raw: baseRaw,
              isArchived: false,
              deletedAt: null,
            } as any,
          });
        } else {
          await this.prisma.exercise.create({
            data: {
              source: 'free_exercise_db' as any,
              externalId,
              name,
              description: legacyDescriptionText,
              categoryName: category,
              images: imageUrls.map((url) => ({
                image: url,
              })) as Prisma.InputJsonValue,
              videos: [] as Prisma.InputJsonValue,
              raw: baseRaw,
              isArchived: false,
              deletedAt: null,
            } as any,
          });
        }
      }
      totalUpserted += 1;
    }

    return {
      ok: true,
      source: 'free-exercise-db',
      fetched: totalFetched,
      upserted: totalUpserted,
      skipped: totalSkipped,
      skippedByReason,
      maxItems: maxItems > 0 ? maxItems : null,
      syncedAt: new Date().toISOString(),
    };
  }
}
