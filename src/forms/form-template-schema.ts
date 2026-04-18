import { BadRequestException } from '@nestjs/common';

/**
 * Debe coincidir con `getDefaultTemplateFields()` en web (ids y tipos).
 * Si cambias los defaults en el cliente, actualiza esta lista.
 */
export const BASE_FORM_TEMPLATE_SCHEMA: ReadonlyArray<{
  id: string;
  type: 'text' | 'number' | 'photo';
}> = [
  { id: 'weight', type: 'number' },
  { id: 'shoulders', type: 'number' },
  { id: 'chest', type: 'number' },
  { id: 'biceps', type: 'number' },
  { id: 'waist', type: 'number' },
  { id: 'hips', type: 'number' },
  { id: 'quadriceps', type: 'number' },
  { id: 'calves', type: 'number' },
  { id: 'front', type: 'photo' },
  { id: 'side', type: 'photo' },
  { id: 'back', type: 'photo' },
];

const ALLOWED_TYPES = new Set(['text', 'number', 'photo']);

/**
 * Valida el JSON `schema` de FormTemplate: array de campos con ids únicos
 * y presencia de todos los campos base con el tipo esperado.
 */
export function assertValidFormTemplateSchema(schema: unknown): void {
  if (!Array.isArray(schema)) {
    throw new BadRequestException('schema must be a non-empty array');
  }

  const byId = new Map<string, { type: string }>();

  for (let i = 0; i < schema.length; i++) {
    const raw = schema[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException(`schema[${i}] must be an object`);
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id.trim()) {
      throw new BadRequestException(
        `schema[${i}].id must be a non-empty string`,
      );
    }
    if (typeof item.type !== 'string' || !ALLOWED_TYPES.has(item.type)) {
      throw new BadRequestException(
        `schema[${i}].type must be one of: text, number, photo`,
      );
    }
    if (byId.has(item.id)) {
      throw new BadRequestException(`Duplicate field id: ${item.id}`);
    }
    byId.set(item.id, { type: item.type });
  }

  for (const base of BASE_FORM_TEMPLATE_SCHEMA) {
    const found = byId.get(base.id);
    if (!found) {
      throw new BadRequestException(`Missing base field: ${base.id}`);
    }
    if (found.type !== base.type) {
      throw new BadRequestException(
        `Base field ${base.id} must have type ${base.type}`,
      );
    }
  }
}
