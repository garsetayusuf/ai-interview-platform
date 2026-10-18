import { z } from "zod";

export const vacancySkillSchema = z.object({
  skill_label: z.string().min(1).max(255),
  expected_level: z.number().int().min(1).max(5),
});
export const vacancySchema = z.object({
  role_title: z.string().min(1).max(255),
  culture_dimensions: z.string().max(5000).optional(),
  competency_expectations: z.string().max(5000).optional(),
  skills: z.array(vacancySkillSchema).min(1),
});
export const overrideSchema = z.object({
  override_level: z.number().int().min(1).max(5),
  assessor_notes: z.string().max(2000),
});
export const candidateNameSchema = z.string().max(255).optional();
export type VacancyValues = z.infer<typeof vacancySchema>;
